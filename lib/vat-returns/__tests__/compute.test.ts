/**
 * Worked examples of the VAT return preparation (lib/vat-returns), on
 * plain values: entries -> classify -> compute -> settlement. Fictitious
 * figures, in cents. Sources: forms and notices 3310-CA3-SD (cerfa
 * 10963*31, notice 50449#29) and 3517-S-SD (cerfa 11417*27, notice
 * 51306#18), BOI-TVA-DECLA-20-20, PCG art. 944-44.
 */

import { describe, expect, it } from 'vitest'
import { classifyEntries, inferRate, isSettlementEntry, splitInvoiceVat, type VatEntry, type VatInvoiceSource } from '../classify'
import { computeVatReturn, roundEuros, type VatReturnComputation } from '../compute'
import { planSettlement, resolveRootCode, sameLines, settlementReference } from '../settlement'

let counter = 0
/** An entry from [code, debit, credit] lines, in cents. */
function entry(lines: Array<[string, number, number]>, extra: Partial<VatEntry> = {}): VatEntry {
  counter += 1
  return {
    id: `e${counter}`,
    number: `VE${String(counter).padStart(4, '0')}`,
    date: '2026-09-15',
    journalCode: 'VE',
    reference: null,
    lines: lines.map(([code, debitCents, creditCents]) => ({ code, debitCents, creditCents })),
    ...extra,
  }
}

const sale = (base: number, vat: number, revenue = '706000', collected = '445710') =>
  entry([
    ['411000', base + vat, 0],
    [revenue, 0, base],
    [collected, 0, vat],
  ])
const purchase = (base: number, vat: number, expense = '6064', deductible = '445660') =>
  entry(
    [
      [expense, base, 0],
      [deductible, vat, 0],
      ['401000', 0, base + vat],
    ],
    { journalCode: 'AC' },
  )

const line = (c: VatReturnComputation, code: string) => {
  const found = c.lines.find((l) => l.code === code)
  if (!found) throw new Error(`line ${code} missing`)
  return found
}

describe('rate of an entry (CGI art. 278 to 281 nonies: 20 %, 10 %, 5,5 %, 2,1 %)', () => {
  it('reads the one French rate whose VAT on the base matches within a cent per line', () => {
    expect(inferRate(2000, 10_000)).toBe(2000)
    expect(inferRate(100, 1_000)).toBe(1000)
    expect(inferRate(55, 1_000)).toBe(550)
    expect(inferRate(21, 1_000)).toBe(210)
    // 833,33 € TTC split at 20 %: base 694,44, VAT 138,89 (1 cent of rounding)
    expect(inferRate(13_889, 69_444)).toBe(2000)
    // Two rates mixed without an invoice: no single rate fits
    expect(inferRate(2_055, 11_000)).toBeNull()
    expect(inferRate(0, 1_000)).toBeNull()
  })

  it('splits an invoice between 44571 and 44574 as the posting plan did (goods due now, services on payment, CGI art. 269, 2, c)', () => {
    const invoice: VatInvoiceSource = {
      lines: [
        { rateBp: 2000, baseCents: 30_000, nature: 'GOODS' },
        { rateBp: 2000, baseCents: 70_000, nature: 'SERVICES' },
      ],
      breakdown: [{ rateBp: 2000, baseCents: 100_000, vatCents: 20_000 }],
    }
    expect(splitInvoiceVat(invoice, true)).toEqual([{ rateBp: 2000, dueBaseCents: 30_000, dueVatCents: 6_000, pendingBaseCents: 70_000, pendingVatCents: 14_000 }])
    expect(splitInvoiceVat(invoice, false)[0]).toMatchObject({ dueBaseCents: 100_000, dueVatCents: 20_000, pendingVatCents: 0 })
  })
})

describe('CA3 of a month with several rates (notice 3310-CA3-SD, lines A1, 08, 9B, 09, T6, 16, 19, 20, 23, TD, 28)', () => {
  const mixedInvoice: VatInvoiceSource = {
    lines: [
      { rateBp: 2000, baseCents: 50_000, nature: 'GOODS' },
      { rateBp: 550, baseCents: 20_000, nature: 'GOODS' },
    ],
    breakdown: [
      { rateBp: 2000, baseCents: 50_000, vatCents: 10_000 },
      { rateBp: 550, baseCents: 20_000, vatCents: 1_100 },
    ],
  }
  const entries = [
    sale(1_000_000, 200_000), // 10 000 € at 20 %
    sale(100_000, 10_000, '707000'), // 1 000 € at 10 %
    sale(10_000, 210), // 100 € at 2,1 %
    // One invoice at two rates: its VAT breakdown gives the bases
    entry(
      [
        ['411000', 81_100, 0],
        ['707000', 0, 70_000],
        ['445710', 0, 11_100],
      ],
      { invoice: mixedInvoice },
    ),
    purchase(500_000, 100_000), // 44566
    purchase(200_000, 40_000, '2183', '445620'), // 44562, a computer
  ]
  const movements = classifyEntries(entries)
  const ca3 = computeVatReturn({ form: 'CA3', movements, creditCarriedCents: 0 })

  it('declares each rate on its line, base and tax rounded to the euro', () => {
    expect(line(ca3, 'A1')).toMatchObject({ baseCents: 1_180_000, base: 11_800, box: '0979' })
    expect(line(ca3, '08')).toMatchObject({ box: '0207', baseCents: 1_050_000, amountCents: 210_000, base: 10_500, amount: 2_100 })
    expect(line(ca3, '9B')).toMatchObject({ box: '0151', base: 1_000, amount: 100 })
    expect(line(ca3, '09')).toMatchObject({ box: '0105', base: 200, amount: 11 })
    expect(line(ca3, 'T6')).toMatchObject({ box: '1010', base: 100, amount: 2 })
    expect(line(ca3, '16')).toMatchObject({ amount: 2_213, status: 'total' })
  })

  it('deducts fixed assets on line 19 and other goods and services on line 20', () => {
    expect(line(ca3, '19')).toMatchObject({ box: '0703', amount: 400 })
    expect(line(ca3, '20')).toMatchObject({ box: '0702', amount: 1_000 })
    expect(line(ca3, '23').amount).toBe(1_400)
    expect(line(ca3, 'TD')).toMatchObject({ box: '8900', amount: 813 })
    expect(line(ca3, '28').amount).toBe(813)
    expect(line(ca3, '25').amount).toBe(0)
    expect(ca3.result).toEqual({ kind: 'due', dueEuros: 813, creditEuros: 0, booksNetCents: 81_310 })
  })

  it('lists what Kledg cannot know as lines to fill by hand', () => {
    expect(['A2', 'E1', 'F2', '5B', '2C', '26', '29'].map((code) => line(ca3, code).status)).toEqual(Array(7).fill('manual'))
    // B4 is read from the subaccount 44528 (art. 283-1): computed, 0 here
    expect(line(ca3, 'B4')).toMatchObject({ status: 'computed', base: 0 })
  })

  it('books the settlement: VAT accounts cleared, 44551 by the declared amount, the rounding to 658 or 758', () => {
    const nets = new Map<string, number>([
      ['445710', -221_310],
      ['445660', 100_000],
      ['445620', 40_000],
    ])
    const lines = planSettlement({
      period: { id: '2026-09', form: 'CA3', label: 'septembre 2026' },
      periodNetByCode: nets,
      creditCarried: { cents: 0, code: '44567' },
      acomptes: null,
      dueEuros: 813,
      creditEuros: 0,
    })
    expect(lines).toEqual([
      { code: '445620', label: 'TVA sur immobilisations', debitCents: 0, creditCents: 40_000 },
      { code: '445660', label: 'TVA sur autres biens et services', debitCents: 0, creditCents: 100_000 },
      { code: '445710', label: 'TVA collectée', debitCents: 221_310, creditCents: 0 },
      { code: '44551', label: 'TVA à décaisser', debitCents: 0, creditCents: 81_300 },
      { code: '758', label: 'Indemnités et autres produits', debitCents: 0, creditCents: 10 },
    ])
    expect(lines.reduce((s, l) => s + l.debitCents - l.creditCents, 0)).toBe(0)
    expect(settlementReference({ id: '2026-09', form: 'CA3' })).toBe('TVA-CA3-2026-09')
    expect(sameLines(lines, [...lines].reverse())).toBe(true)
  })

  it('takes the chart’s own code for an account named by its root (445510 for 44551)', () => {
    expect(resolveRootCode('44551', ['445510', '44551000'])).toBe('445510')
    expect(resolveRootCode('44567', ['44567'])).toBe('44567')
    expect(resolveRootCode('658', ['6588', '65800'])).toBe('6588')
    expect(resolveRootCode('758', [])).toBe('758')
  })
})

describe('intra-Community acquisitions and autoliquidation (CGI art. 283, 2; notice: lines B2, A3, 17)', () => {
  const goods = entry(
    [
      ['607000', 300_000, 0],
      ['445660', 60_000, 0],
      ['445200', 0, 60_000],
      ['401000', 0, 300_000],
    ],
    { journalCode: 'AC' },
  )
  const services = entry(
    [
      ['622600', 50_000, 0],
      ['445660', 10_000, 0],
      ['445200', 0, 10_000],
      ['401000', 0, 50_000],
    ],
    { journalCode: 'AC' },
  )
  const ca3 = computeVatReturn({ form: 'CA3', movements: classifyEntries([goods, services]), creditCarriedCents: 0 })

  it('declares goods on B2 and services of a supplier not established in France on A3, both taxed on line 08', () => {
    expect(line(ca3, 'B2')).toMatchObject({ box: '0031', base: 3_000 })
    expect(line(ca3, 'A3')).toMatchObject({ box: '0044', base: 500 })
    expect(line(ca3, '08')).toMatchObject({ base: 3_500, amount: 700 })
    expect(line(ca3, '17')).toMatchObject({ box: '0035', amount: 600 })
  })

  it('deducts the self-assessed VAT on line 20: nothing to pay', () => {
    expect(line(ca3, '20').amount).toBe(700)
    expect(ca3.result).toMatchObject({ kind: 'nil', dueEuros: 0, creditEuros: 0 })
  })

  it('puts the services on line AC of the CA12 and the goods on the rate lines', () => {
    const ca12 = computeVatReturn({ form: 'CA12', movements: classifyEntries([goods, services]), creditCarriedCents: 0 })
    expect(line(ca12, 'AC')).toMatchObject({ box: '0044', base: 500, amount: 100 })
    expect(line(ca12, '5A')).toMatchObject({ base: 3_000, amount: 600 })
  })
})

// R3 QUAL-20, checked on the 2026 notices: CA3 line A3 holds the services of
// any supplier not established in France (CGI art. 259, 1° and 283-2), inside
// or outside the EU; B2 and line 17 the intra-Community acquisitions of
// goods; B4 the purchases of art. 283-1, second paragraph. The CA12 has no
// acquisition line (rate lines), AB for art. 283-1 and AC for art. 283-2.
describe('services from outside the EU and purchases of art. 283-1 (notices 3310-CA3-SD and 3517-S-SD 2026: A3, B2, B4, 17, AB, AC)', () => {
  // A US software (Notion) self-assessed by the rules library or simple mode: 6511 / 44566 / 4452
  const usSoftware = entry(
    [
      ['651100', 1_000, 0],
      ['445660', 200, 0],
      ['445200', 0, 200],
      ['512000', 0, 1_000],
    ],
    { journalCode: 'BQ' },
  )
  // Goods located in France bought from a supplier not established there (art. 283-1): subaccount 44528
  const art2831 = entry(
    [
      ['607000', 100_000, 0],
      ['445660', 20_000, 0],
      ['445280', 0, 20_000],
      ['401000', 0, 100_000],
    ],
    { journalCode: 'AC' },
  )
  const euGoods = entry(
    [
      ['607000', 50_000, 0],
      ['445660', 10_000, 0],
      ['445200', 0, 10_000],
      ['401000', 0, 50_000],
    ],
    { journalCode: 'AC' },
  )
  const movements = classifyEntries([usSoftware, art2831, euGoods])
  const ca3 = computeVatReturn({ form: 'CA3', movements, creditCarriedCents: 0 })

  it('declares a US service on A3, art. 283-1 purchases on B4 and only intra-Community goods on B2 and line 17', () => {
    expect(line(ca3, 'A3')).toMatchObject({ box: '0044', base: 10 })
    expect(line(ca3, 'B4')).toMatchObject({ box: '0040', base: 1_000, status: 'computed' })
    expect(line(ca3, 'B2')).toMatchObject({ box: '0031', base: 500 })
    expect(line(ca3, '17')).toMatchObject({ box: '0035', amount: 100 })
    // All taxed on line 08 and deducted on line 20: nothing to pay
    expect(line(ca3, '08')).toMatchObject({ base: 1_510, amount: 302 })
    expect(line(ca3, '20').amount).toBe(302)
    expect(ca3.result.kind).toBe('nil')
  })

  it('puts art. 283-1 purchases on line AB of the CA12, services on AC, goods on the rate lines', () => {
    const ca12 = computeVatReturn({ form: 'CA12', movements, creditCarriedCents: 0 })
    expect(line(ca12, 'AB')).toMatchObject({ box: '0040', base: 1_000, amount: 200 })
    expect(line(ca12, 'AC')).toMatchObject({ box: '0044', base: 10, amount: 2 })
    expect(line(ca12, '5A')).toMatchObject({ base: 500, amount: 100 })
    expect(line(ca12, '16').amount).toBe(302)
  })
})

describe('credit carried forward (line 22 repeats line 27 of the previous return; 44567)', () => {
  const entries = [sale(100_000, 20_000), purchase(400_000, 80_000)]
  const ca3 = computeVatReturn({ form: 'CA3', movements: classifyEntries(entries), creditCarriedCents: 150_000 })

  it('adds the credit to the deductible VAT and carries the new credit on lines 25 and 27', () => {
    expect(line(ca3, '22')).toMatchObject({ box: '8001', amount: 1_500 })
    expect(line(ca3, '23').amount).toBe(2_300)
    expect(line(ca3, '25')).toMatchObject({ box: '0705', amount: 2_100 })
    expect(line(ca3, '27')).toMatchObject({ box: '8003', amount: 2_100 })
    expect(line(ca3, 'TD').amount).toBe(0)
    expect(ca3.result).toEqual({ kind: 'credit', dueEuros: 0, creditEuros: 2_100, booksNetCents: -210_000 })
  })

  it('settles into 44567: the old credit used, the new credit carried', () => {
    const lines = planSettlement({
      period: { id: '2026-09', form: 'CA3', label: 'septembre 2026' },
      periodNetByCode: new Map([
        ['445710', -20_000],
        ['445660', 80_000],
      ]),
      creditCarried: { cents: 150_000, code: '445670' },
      acomptes: null,
      dueEuros: 0,
      creditEuros: 2_100,
    })
    expect(lines).toEqual([
      { code: '445660', label: 'TVA sur autres biens et services', debitCents: 0, creditCents: 80_000 },
      { code: '445710', label: 'TVA collectée', debitCents: 20_000, creditCents: 0 },
      // The credit used (1 500 €) and the credit carried (2 100 €) net on 44567
      { code: '445670', label: 'Crédit de TVA à reporter', debitCents: 60_000, creditCents: 0 },
    ])
  })
})

describe('regularisations (notice: never a negative amount; B5 and 21 for sales credit notes, 15 for supplier credit notes)', () => {
  const creditNote = entry([
    ['706000', 50_000, 0],
    ['445710', 10_000, 0],
    ['411000', 0, 60_000],
  ])
  const supplierCreditNote = entry(
    [
      ['401000', 12_000, 0],
      ['6064', 0, 10_000],
      ['445660', 0, 2_000],
    ],
    { journalCode: 'AC' },
  )
  const ca3 = computeVatReturn({ form: 'CA3', movements: classifyEntries([sale(200_000, 40_000), creditNote, supplierCreditNote]), creditCarriedCents: 0 })

  it('keeps the sales of the period on 08 and moves the credit note to B5 and 21', () => {
    expect(line(ca3, '08')).toMatchObject({ base: 2_000, amount: 400 })
    expect(line(ca3, 'B5')).toMatchObject({ box: '0036', base: 500 })
    expect(line(ca3, '21')).toMatchObject({ box: '0059', amount: 100 })
  })

  it('pays back the VAT of a supplier credit note on line 15', () => {
    expect(line(ca3, '15')).toMatchObject({ box: '0600', amount: 20 })
    expect(line(ca3, '16').amount).toBe(420)
    expect(ca3.result.dueEuros).toBe(320)
  })
})

describe('what Kledg leaves out or reports', () => {
  it('skips opening, closing and settlement entries, and reads sales without VAT as non-taxed (E2)', () => {
    const opening = entry([['445710', 0, 99_999], ['890000', 99_999, 0]], { journalCode: 'AN' })
    const settlement = entry([['445710', 50_000, 0], ['445510', 0, 50_000]], { journalCode: 'OD' })
    const export_ = entry([['411000', 300_000, 0], ['707000', 0, 300_000]])
    expect(isSettlementEntry(settlement)).toBe(true)
    const m = classifyEntries([opening, settlement, export_])
    expect(m.entries).toBe(1)
    const ca3 = computeVatReturn({ form: 'CA3', movements: m, creditCarriedCents: 0 })
    expect(line(ca3, 'E2')).toMatchObject({ box: '0033', base: 3_000 })
    expect(line(ca3, '16').amount).toBe(0)
  })

  it('keeps VAT whose rate it cannot read in the total and asks to split it', () => {
    const mixed = entry([
      ['411000', 13_055, 0],
      ['706000', 0, 6_000],
      ['707000', 0, 5_000],
      ['445710', 0, 2_055],
    ])
    const m = classifyEntries([mixed])
    expect(m.unidentified).toEqual([{ id: mixed.id, number: mixed.number, date: '2026-09-15', vatCents: 2_055, baseCents: 11_000, kind: 'collected' }])
    const ca3 = computeVatReturn({ form: 'CA3', movements: m, creditCarriedCents: 0 })
    expect(line(ca3, '?')).toMatchObject({ status: 'manual', base: 110, amount: 21 })
    expect(line(ca3, '16').amount).toBe(21)
  })

  it('reports VAT accounts the return does not read (taxes assimilées 44578)', () => {
    const m = classifyEntries([entry([['411000', 1_000, 0], ['445780', 0, 1_000]])])
    expect(m.unhandled).toEqual([{ code: '445780', netCents: -1_000, entries: 1 }])
  })

  it('declares VAT on receipts when the payment moves it from 44574 to 44571 (CGI art. 269, 2, c)', () => {
    const invoice: VatInvoiceSource = {
      lines: [
        { rateBp: 2000, baseCents: 100_000, nature: 'SERVICES' },
        { rateBp: 1000, baseCents: 50_000, nature: 'SERVICES' },
      ],
      breakdown: [
        { rateBp: 2000, baseCents: 100_000, vatCents: 20_000 },
        { rateBp: 1000, baseCents: 50_000, vatCents: 5_000 },
      ],
    }
    const posted = entry([['411000', 175_000, 0], ['706000', 0, 150_000], ['445740', 0, 25_000]], { invoice, date: '2026-08-20' })
    const transfer = entry([['445740', 12_500, 0], ['445710', 0, 12_500]], { journalCode: 'OD', vatTransferOf: [invoice] })
    const m = classifyEntries([posted, transfer])
    expect(m.pendingCollectedCents).toBe(12_500)
    expect(m.nonTaxedSalesCents).toBe(0)
    expect(m.collected).toEqual([
      { rateBp: 2000, baseCents: 50_000, vatCents: 10_000 },
      { rateBp: 1000, baseCents: 25_000, vatCents: 2_500 },
    ])
  })
})

describe('CA12 with acomptes and the annual regularisation (notice 3517-S-SD, lines 28 to 35 and 57; BOI-TVA-DECLA-20-20-30-10)', () => {
  const year = [
    sale(10_000_000, 2_000_000), // 100 000 € at 20 %
    purchase(4_000_000, 800_000),
    entry([['445810', 300_000, 0], ['512000', 0, 300_000]], { journalCode: 'BQ', date: '2026-07-21' }), // acompte de juillet
    entry([['445810', 200_000, 0], ['512000', 0, 200_000]], { journalCode: 'BQ', date: '2026-12-21' }), // acompte de décembre
  ]
  const ca12 = computeVatReturn({ form: 'CA12', movements: classifyEntries(year), creditCarriedCents: 0 })

  it('deducts the acomptes paid from the VAT of the year: balance due on line 33', () => {
    expect(line(ca12, '5A')).toMatchObject({ box: '0207', base: 100_000, amount: 20_000 })
    expect(line(ca12, '16').amount).toBe(20_000)
    expect(line(ca12, '20')).toMatchObject({ box: '0702', amount: 8_000 })
    expect(line(ca12, '28')).toMatchObject({ box: '8900', amount: 12_000 })
    expect(line(ca12, '30')).toMatchObject({ box: '0018', amount: 5_000 })
    expect(line(ca12, '33').amount).toBe(7_000)
    expect(line(ca12, '34').amount).toBe(0)
    expect(ca12.result).toMatchObject({ kind: 'due', dueEuros: 7_000, creditEuros: 0, booksNetCents: 700_000 })
  })

  it('gives next year acomptes from line 57: 55 % in July, 40 % in December', () => {
    expect(line(ca12, '57').amount).toBe(12_000)
    expect(ca12.acomptes).toEqual({ paidCents: 500_000, nextBaseEuros: 12_000, nextDue: true, nextJulyEuros: 6_600, nextDecemberEuros: 4_800 })
  })

  it('turns acomptes above the VAT of the year into an overpayment (34) and a surplus (35)', () => {
    const over = computeVatReturn({
      form: 'CA12',
      movements: classifyEntries([sale(1_000_000, 200_000), entry([['445810', 500_000, 0], ['512000', 0, 500_000]], { journalCode: 'BQ' })]),
      creditCarriedCents: 0,
    })
    expect(line(over, '28').amount).toBe(2_000)
    expect(line(over, '33').amount).toBe(0)
    expect(line(over, '34').amount).toBe(3_000)
    expect(line(over, '35')).toMatchObject({ box: '0020', amount: 3_000 })
    expect(over.result).toMatchObject({ kind: 'credit', creditEuros: 3_000 })
    expect(over.acomptes).toMatchObject({ nextBaseEuros: 2_000, nextDue: true })
    // Line 57 under 1 000 €: no acompte the next year
    const small = computeVatReturn({ form: 'CA12', movements: classifyEntries([sale(400_000, 80_000)]), creditCarriedCents: 0 })
    expect(small.acomptes).toMatchObject({ nextBaseEuros: 800, nextDue: false, nextJulyEuros: 0, nextDecemberEuros: 0 })
  })

  it('carries the previous credit on line 24 and settles the acomptes from 44581', () => {
    const withCredit = computeVatReturn({ form: 'CA12', movements: classifyEntries(year), creditCarriedCents: 100_000 })
    expect(line(withCredit, '24')).toMatchObject({ box: '0058', amount: 1_000 })
    expect(withCredit.result.dueEuros).toBe(6_000)
    const lines = planSettlement({
      period: { id: '2026', form: 'CA12', label: 'année 2026' },
      periodNetByCode: new Map([
        ['445710', -2_000_000],
        ['445660', 800_000],
        ['445810', 500_000],
        ['512000', -500_000],
      ]),
      creditCarried: { cents: 100_000, code: '44567' },
      acomptes: { cents: 500_000, code: '445810' },
      dueEuros: 6_000,
      creditEuros: 0,
    })
    expect(lines).toEqual([
      { code: '445660', label: 'TVA sur autres biens et services', debitCents: 0, creditCents: 800_000 },
      { code: '445710', label: 'TVA collectée', debitCents: 2_000_000, creditCents: 0 },
      { code: '44567', label: 'Crédit de TVA à reporter', debitCents: 0, creditCents: 100_000 },
      { code: '445810', label: 'Acomptes, régime simplifié d’imposition', debitCents: 0, creditCents: 500_000 },
      { code: '44551', label: 'TVA à décaisser', debitCents: 0, creditCents: 600_000 },
    ])
  })
})

describe('rounding to the euro (notices: 0,50 € and more count for one)', () => {
  it('rounds half up', () => {
    expect([roundEuros(0), roundEuros(49), roundEuros(50), roundEuros(149), roundEuros(150), roundEuros(-150)]).toEqual([0, 0, 1, 1, 2, -2])
  })

  it('adds the rounded lines for the totals, as the form does', () => {
    // 20 % on 100,40 € = 20,08 €, 10 % on 100,40 € = 10,04 €: 20 + 10 = 30, the books 30,12 €
    const ca3 = computeVatReturn({ form: 'CA3', movements: classifyEntries([sale(10_040, 2_008), sale(10_040, 1_004)]), creditCarriedCents: 0 })
    expect(line(ca3, '16').amount).toBe(30)
    expect(ca3.result).toMatchObject({ dueEuros: 30, booksNetCents: 3_012 })
  })
})
