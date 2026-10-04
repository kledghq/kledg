/**
 * FEC export, LPF art. A47 A-1 and BOI-CF-IOR-60-40-20 (sources in
 * lib/fec/format.ts). The golden file is the byte-exact expected output of a
 * small ledger: any change to the format must be deliberate.
 */

import { readFileSync } from 'fs'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildFec, fecRecords, sortFecEntries } from '../export'
import { FEC_FIELDS, fecFileName, isOpeningJournal, normalizeSiren, sanitizeFecField } from '../format'
import { validateFec } from '../validator'
import { GOLDEN_LEDGER } from './fixtures/ledger'

const GOLDEN_FILE = path.join(__dirname, 'fixtures', '123456789FEC20251231.txt')

describe('FEC export', () => {
  const originalTz = process.env.TZ
  afterEach(() => {
    process.env.TZ = originalTz
  })

  it('produces the golden file byte for byte', () => {
    expect(Buffer.from(buildFec(GOLDEN_LEDGER), 'utf8').equals(readFileSync(GOLDEN_FILE))).toBe(true)
  })

  it.each(['UTC', 'Europe/Paris', 'Pacific/Kiritimati', 'America/Los_Angeles'])(
    'does not depend on the server timezone (%s)',
    (tz) => {
      process.env.TZ = tz
      expect(buildFec(GOLDEN_LEDGER)).toBe(readFileSync(GOLDEN_FILE, 'utf8'))
    },
  )

  it('passes the A47 A-1 validator', () => {
    const report = validateFec(readFileSync(GOLDEN_FILE, 'utf8'), { fileName: '123456789FEC20251231.txt', closingDate: '20251231' })
    expect(report.errors).toEqual([])
    expect(report.warnings).toEqual([])
    expect(report.stats).toMatchObject({
      records: 10,
      entries: 4,
      totalDebit: '12400,30',
      totalCredit: '12400,30',
      separator: 'tab',
      numbering: 'global',
    })
  })

  it('writes the 18 fields in order, tab separated, CR/LF records, header first', () => {
    const content = buildFec(GOLDEN_LEDGER)
    const rows = content.split('\r\n')
    expect(rows.pop()).toBe('') // every record ends with CR/LF
    expect(rows[0]).toBe(FEC_FIELDS.join('\t'))
    for (const row of rows) expect(row.split('\t')).toHaveLength(18)
    expect(content).not.toMatch(/[^\r]\n/)
  })

  it('lists the opening entries (à-nouveaux) first, then the validation order', () => {
    const order = sortFecEntries(GOLDEN_LEDGER).map((e) => `${e.journalCode}${e.entryNumber}`)
    expect(order).toEqual(['AN3', 'VE1', 'BQ2', 'AC4'])
    expect(isOpeningJournal('an')).toBe(true)
    expect(isOpeningJournal('OU')).toBe(true)
    expect(isOpeningJournal('VE')).toBe(false)
  })

  it('formats dates AAAAMMJJ, amounts with a decimal comma and no thousands separator', () => {
    const records = fecRecords(GOLDEN_LEDGER)
    const opening = records[0]
    expect(opening.EcritureDate).toBe('20250101')
    expect(opening.Debit).toBe('10000,00')
    expect(opening.Credit).toBe('0,00')
    const sale = records.find((r) => r.CompteNum === '706000')!
    expect(sale.Credit).toBe('1000,00')
    expect(sale.PieceDate).toBe('20250314')
  })

  it('keeps auxiliary accounts, lettrage and foreign currency amounts', () => {
    const records = fecRecords(GOLDEN_LEDGER)
    const client = records.find((r) => r.JournalCode === 'VE' && r.CompteNum === '411000')!
    expect(client).toMatchObject({ CompAuxNum: 'C0001', CompAuxLib: 'Dupont SARL', EcritureLet: 'AA', DateLet: '20250410' })
    const supplier = records.find((r) => r.CompteNum === '401000')!
    expect(supplier).toMatchObject({ Montantdevise: '-0,35', Idevise: 'USD', CompAuxNum: 'F0001' })
  })

  it('takes the validation day in France for ValidDate', () => {
    const records = fecRecords(GOLDEN_LEDGER)
    // 2025-03-31T22:30Z is 1 April in Paris; 2025-12-31T23:30Z is 1 January 2026
    expect(records.find((r) => r.JournalCode === 'VE')!.ValidDate).toBe('20250401')
    expect(records.find((r) => r.JournalCode === 'AC')!.ValidDate).toBe('20260101')
  })

  it('never leaves PieceRef, PieceDate or EcritureLib blank', () => {
    const records = fecRecords(GOLDEN_LEDGER)
    const purchase = records.filter((r) => r.JournalCode === 'AC')
    expect(purchase.every((r) => r.PieceRef === '4' && r.PieceDate === '20251231')).toBe(true)
    const entry = { ...GOLDEN_LEDGER[2], description: null, lines: [{ ...GOLDEN_LEDGER[2].lines[0], description: null }] }
    expect(fecRecords([entry])[0].EcritureLib).toBe('Redevances')
  })

  it('sums 0,10 + 0,20 exactly', () => {
    const purchase = fecRecords(GOLDEN_LEDGER).filter((r) => r.JournalCode === 'AC')
    expect(purchase.map((r) => [r.Debit, r.Credit])).toEqual([
      ['0,10', '0,00'],
      ['0,20', '0,00'],
      ['0,00', '0,30'],
    ])
  })

  it('writes the largest Decimal(15, 2) amount exactly', () => {
    const entry = {
      ...GOLDEN_LEDGER[3],
      lines: [
        { ...GOLDEN_LEDGER[3].lines[0], debit: '9999999999999.99' },
        { ...GOLDEN_LEDGER[3].lines[1], credit: '9999999999999.99' },
      ],
    }
    const records = fecRecords([entry])
    expect(records[0].Debit).toBe('9999999999999,99')
    expect(validateFec(buildFec([entry])).valid).toBe(true)
  })

  it('removes separators and line breaks from text fields', () => {
    expect(sanitizeFecField('Achat\tfictif')).toBe('Achat fictif')
    expect(sanitizeFecField('A|B')).toBe('A B')
    expect(sanitizeFecField('ligne1\r\nligne2')).toBe('ligne1 ligne2')
    expect(sanitizeFecField(null)).toBe('')
  })

  it('names the file SirenFECAAAAMMJJ after the closing date', () => {
    expect(fecFileName('123456789', '20251231')).toBe('123456789FEC20251231.txt')
    expect(normalizeSiren('123 456 789')).toBe('123456789')
    expect(normalizeSiren('12345678')).toBeNull()
  })
})
