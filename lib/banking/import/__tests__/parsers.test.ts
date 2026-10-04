import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { parseStatementFile } from '../parse'
import { decodeText } from '../encoding'
import { BANK_PRESETS } from '../presets'
import type { ParseResult } from '../types'

const fixture = (name: string) => new Uint8Array(readFileSync(path.join(__dirname, 'fixtures', name)))
const parse = (name: string, options = {}) => parseStatementFile(fixture(name), options)

/** [date, cents, label] of each transaction. */
const lines = (r: ParseResult) => r.transactions.map((t) => [t.bookingDate, t.amountCents, t.label])

describe('CSV presets', () => {
  it.each([
    ['bnp-paribas.csv', 'bnp-paribas', [['2026-03-02', -8420, 'PRLV SEPA EDF CLIENTS PARTICULIERS'], ['2026-03-03', 120000, 'VIR SEPA RECU DE SARL EXEMPLE FACTURE 2026-014'], ['2026-03-04', -480, 'FACTURE CARTE DU 030326 BOULANGERIE DU PARC']]],
    ['societe-generale.csv', 'societe-generale', [['2026-03-05', -1250, 'CARTE X1234 04/03 CAFÉ DES ARTS'], ['2026-03-04', 240000, 'VIR RECU 1234567 DE: SAS DÉMO FACTURE F-0042'], ['2026-03-02', -123456, 'PRELEVEMENT EUROPEEN 98765 DE: URSSAF']]],
    ['credit-agricole.csv', 'credit-agricole', [['2026-03-06', -1999, 'PRELEVEMENT FREE MOBILE REF 123'], ['2026-03-05', 150000, 'VIREMENT EN VOTRE FAVEUR CLIENT ÉTOILE'], ['2026-03-05', -840, 'PAIEMENT PAR CARTE PHARMACIE']]],
    ['bpce.csv', 'bpce', [['2026-03-03', -95000, 'PRLV SEPA SCI DES LILAS LOYER MARS 2026'], ['2026-03-04', 360000, 'VIR SEPA CLIENT ALPHA FACTURE 2026-031']]],
    ['credit-mutuel.csv', 'credit-mutuel-cic', [['2026-03-02', -2699, 'PAIEMENT CB 0103 LIBRAIRIE'], ['2026-03-03', 50000, 'VIR M DUPONT']]],
    ['credit-mutuel-montant.csv', 'credit-mutuel-cic-montant', [['2026-03-02', -2699, 'PAIEMENT CB 0103 LIBRAIRIE'], ['2026-03-03', 50000, 'VIR M DUPONT']]],
    ['la-banque-postale.csv', 'la-banque-postale', [['2026-03-05', 25000, 'VIREMENT DE M MARTIN'], ['2026-03-04', -6325, 'ACHAT CB SUPERMARCHE 03.03.26']]],
    ['boursobank.csv', 'boursobank', [['2026-03-04', -2390, 'CARTE 03/03/26 LIBRAIRIE DU CENTRE'], ['2026-03-05', 171870, 'VIR SEPA CLIENT BETA Facture 12']]],
    ['shine.csv', 'shine', [['2026-03-03', -2900, 'Abonnement logiciel'], ['2026-03-04', 120000, 'Paiement facture F-7 Acompte']]],
    ['qonto.csv', 'qonto', [['2026-03-03', -12000, 'Fournisseur Delta'], ['2026-03-04', 250000, 'Client Epsilon']]],
    ['qonto-fr.csv', 'qonto-fr', [['2026-03-03', -12000, 'Fournisseur Delta'], ['2026-03-04', 250000, 'Client Epsilon']]],
    ['revolut-business.csv', 'revolut-business', [['2026-03-02', -1500, 'Hebergement Web'], ['2026-03-03', 150000, 'Paiement Client Zeta']]],
  ])('%s is read with the %s preset', async (file, preset, expected) => {
    const result = await parse(file)
    expect(result.format).toBe('csv')
    expect(result.tabular?.preset?.id).toBe(preset)
    expect(result.tabular?.confidence).toBe('high')
    expect(result.errors).toEqual([])
    expect(lines(result)).toEqual(expected)
  })

  it('has a fixture for every preset', async () => {
    const covered = new Set<string>()
    for (const file of ['bnp-paribas', 'societe-generale', 'credit-agricole', 'bpce', 'credit-mutuel', 'credit-mutuel-montant', 'la-banque-postale', 'boursobank', 'shine', 'qonto', 'qonto-fr', 'revolut-business']) {
      covered.add((await parse(`${file}.csv`)).tabular!.preset!.id)
    }
    expect([...covered].sort()).toEqual(BANK_PRESETS.map((p) => p.id).sort())
  })

  it('cites a source for every preset', () => {
    for (const preset of BANK_PRESETS) expect(preset.source).toMatch(/^https:\/\//)
  })

  it('keeps value dates, references and bank ids', async () => {
    const bpce = await parse('bpce.csv')
    expect(bpce.transactions[0]).toMatchObject({ valueDate: '2026-03-03', reference: 'REF0001' })
    const qonto = await parse('qonto.csv')
    expect(qonto.transactions[0]).toMatchObject({ bankReference: 'org-1-transaction-101', reference: 'Facture D-88', counterparty: 'Fournisseur Delta' })
  })

  it('skips entries the bank has not booked (pending, processing)', async () => {
    expect((await parse('qonto.csv')).warnings[0]).toMatch(/1 opération non comptabilisée/)
    expect((await parse('revolut-business.csv')).transactions.map((t) => t.bankReference)).not.toContain('6601a1b2-0000-4000-8000-000000000003')
  })
})

describe('CSV detection without a preset', () => {
  it('reads a tab separated Windows-1252 file with a preamble, Débit/Crédit and two-digit years', async () => {
    const result = await parse('generic.tsv')
    expect(result.encoding).toBe('windows-1252')
    expect(result.tabular).toMatchObject({ delimiter: '\t', headerRow: 2, dateFormat: 'dd/mm/yy', confidence: 'high' })
    expect(result.tabular?.preset).toBeUndefined()
    expect(lines(result)).toEqual([
      ['2026-03-01', -350, 'Frais bancaires'],
      ['2026-03-02', 15000, 'Remise chèque n° 1234'],
      ['2026-03-02', -350, 'Frais bancaires'],
    ])
    expect(result.transactions[0].valueDate).toBe('2026-03-02')
  })

  it('finds columns by content when the file has no header', async () => {
    const result = await parse('headerless.csv')
    expect(result.tabular).toMatchObject({ headerRow: -1, confidence: 'low', mapping: { date: 0, label: 1, amount: 2 } })
    expect(result.tabular?.headers).toEqual(['Colonne 1', 'Colonne 2', 'Colonne 3'])
    expect(lines(result)).toEqual([
      ['2026-03-05', -4510, 'ACHAT FOURNITURES'],
      ['2026-03-06', 30000, 'VIREMENT CLIENT'],
      ['2026-03-07', -1999, 'ABONNEMENT TELEPHONE'],
    ])
  })

  it('skips a narrower preamble in a file without header', async () => {
    const csv = 'Export du compte\n\n05/03/2026;ACHAT;-45,10\n06/03/2026;VIREMENT;300,00\n'
    const result = await parseStatementFile(new TextEncoder().encode(csv))
    expect(result.tabular?.mapping).toMatchObject({ date: 0, label: 1, amount: 2 })
    expect(result.transactions.map((t) => [t.line, t.amountCents])).toEqual([[3, -4510], [4, 30000]])
  })

  it('applies a mapping, date format and decimal separator forced by the user', async () => {
    const csv = 'Quand,Quoi,Combien\n03/04/2026,Achat,"1,234.50"\n'
    const auto = await parseStatementFile(new TextEncoder().encode(csv))
    expect(auto.tabular?.confidence).toBe('low')
    const forced = await parseStatementFile(new TextEncoder().encode(csv), {
      mapping: { date: 0, label: 1, amount: 2 },
      dateFormat: 'mm/dd/yyyy',
      decimalSeparator: '.',
      headerRow: 0,
    })
    expect(lines(forced)).toEqual([['2026-03-04', 123450, 'Achat']])
  })

  it('reports bad lines with their line number and keeps the good ones', async () => {
    const result = await parse('bad-amount.csv')
    expect(lines(result)).toEqual([['2026-03-01', -1000, 'OK']])
    expect(result.errors).toEqual([
      { line: 3, message: 'Ligne 3 : montant « douze euros » illisible.' },
      { line: 4, message: 'Ligne 4 : date « 31/02/2026 » illisible (format attendu dd/mm/yyyy).' },
    ])
  })

  it('says which column is missing', async () => {
    const result = await parseStatementFile(new TextEncoder().encode('Nom;Ville\nDupont;Lyon\n'))
    expect(result.errors.map((e) => e.message)).toEqual([
      'Colonne de date introuvable : choisissez-la dans la correspondance des colonnes.',
      'Colonne de montant introuvable : choisissez Montant, ou Débit et Crédit.',
    ])
  })

  it('rejects a line with both a debit and a credit', async () => {
    const result = await parseStatementFile(new TextEncoder().encode('Date;Libellé;Débit;Crédit\n01/03/2026;X;10,00;5,00\n'))
    expect(result.errors[0].message).toBe('Ligne 2 : débit et crédit renseignés sur la même ligne.')
  })

  it('ignores balance footers and zero amounts', async () => {
    const csv = 'Date;Libellé;Montant\n01/03/2026;Achat;-5,00\n02/03/2026;Contrôle carte;0,00\n;Solde au 02/03/2026;1 000,00\n'
    const result = await parseStatementFile(new TextEncoder().encode(csv))
    expect(lines(result)).toEqual([['2026-03-01', -500, 'Achat']])
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual(['1 ligne de montant nul ignorée.'])
  })
})

describe('encodings', () => {
  const csv = 'Date;Libellé;Montant\n01/03/2026;Café crème à Évry;-3,50\n'
  const expected = [['2026-03-01', -350, 'Café crème à Évry']]

  it('UTF-8 without BOM', async () => {
    const r = await parseStatementFile(new TextEncoder().encode(csv))
    expect(r.encoding).toBe('utf-8')
    expect(lines(r)).toEqual(expected)
  })

  it('UTF-8 with BOM (the BOM does not end up in the first header)', async () => {
    const r = await parseStatementFile(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(csv)]))
    expect(r.tabular?.headers[0]).toBe('Date')
    expect(lines(r)).toEqual(expected)
  })

  it('Windows-1252 / Latin-1', async () => {
    const bytes = new Uint8Array([...csv].map((c) => c.charCodeAt(0)))
    const r = await parseStatementFile(bytes)
    expect(r.encoding).toBe('windows-1252')
    expect(lines(r)).toEqual(expected)
  })

  it('UTF-16 with BOM', async () => {
    const units = [0xfeff, ...[...csv].map((c) => c.charCodeAt(0))]
    const bytes = new Uint8Array(units.flatMap((u) => [u & 0xff, u >> 8]))
    expect(decodeText(bytes).encoding).toBe('utf-16le')
    expect(lines(await parseStatementFile(bytes))).toEqual(expected)
  })

  it('Windows-1252 euro sign and typographic apostrophe', () => {
    expect(decodeText(new Uint8Array([0x80, 0x20, 0x92])).text).toBe('€ ’')
  })
})

describe('Excel', () => {
  it('reads an .xlsx sheet with real dates and numbers', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Opérations')
    sheet.addRow(['Relevé du compte courant'])
    sheet.addRow([])
    sheet.addRow(['Date', 'Libellé', 'Débit', 'Crédit'])
    sheet.addRow([new Date(Date.UTC(2026, 2, 3)), 'Prélèvement assurance', 45.1, null])
    sheet.addRow([new Date(Date.UTC(2026, 2, 4)), 'Virement client', null, 1200])
    sheet.addRow(['05/03/2026', 'Frais', '1,05', null])
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer())
    const result = await parseStatementFile(bytes)
    expect(result.format).toBe('xlsx')
    expect(result.tabular?.sheetNames).toEqual(['Opérations'])
    expect(lines(result)).toEqual([
      ['2026-03-03', -4510, 'Prélèvement assurance'],
      ['2026-03-04', 120000, 'Virement client'],
      ['2026-03-05', -105, 'Frais'],
    ])
  })

  it('rejects a missing sheet', async () => {
    const workbook = new ExcelJS.Workbook()
    workbook.addWorksheet('A').addRow(['Date', 'Montant'])
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer())
    await expect(parseStatementFile(bytes, { sheetName: 'B' })).rejects.toThrow('Feuille « B » introuvable dans le classeur.')
  })
})

describe('camt.053', () => {
  it('reads booked entries of every statement, with references, counterparties and value dates', async () => {
    const result = await parse('camt053.xml')
    expect(result.format).toBe('camt053')
    expect(result.accounts.map((a) => a.iban)).toEqual(['FR7630006000011234567890189', 'FR7630006000019876543210123'])
    expect(result.transactions[0]).toEqual({
      bookingDate: '2026-03-02',
      valueDate: '2026-03-03',
      amountCents: 125000,
      currency: 'EUR',
      label: 'SARL Client Exemple Facture 2026-021',
      reference: 'FACT-2026-021',
      bankReference: 'BQ-0001',
      counterparty: 'SARL Client Exemple',
      account: 'FR7630006000011234567890189',
      line: 1,
    })
    // DBIT is negative; NOTPROVIDED is not a reference; entities are decoded
    expect(result.transactions[1]).toMatchObject({ amountCents: -8990, reference: undefined, counterparty: 'Opérateur Télécom & Fils' })
  })

  it('splits a batch entry whose details add up to the entry amount', async () => {
    const result = await parse('camt053.xml')
    const batch = result.transactions.filter((t) => t.bookingDate === '2026-03-04')
    expect(batch.map((t) => [t.amountCents, t.label, t.reference, t.bankReference])).toEqual([
      [10000, 'Adhérent Un Cotisation mars', 'ADH-001', 'BQ-0003/1'],
      [20000, 'Adhérent Deux Cotisation trimestre', 'ADH-002', 'BQ-0003/2'],
    ])
  })

  it('keeps a batch whole when its details do not add up', async () => {
    const xml = new TextDecoder().decode(fixture('camt053.xml')).replace('<Amt Ccy="EUR">200.00</Amt>', '<Amt Ccy="EUR">150.00</Amt>')
    const result = await parseStatementFile(new TextEncoder().encode(xml))
    const batch = result.transactions.filter((t) => t.bookingDate === '2026-03-04')
    expect(batch.map((t) => [t.amountCents, t.label, t.bankReference])).toEqual([[30000, 'REMISE PRLV SEPA 2 OPERATIONS (lot de 2 opérations)', 'BQ-0003']])
  })

  it('skips pending entries (v02 <Sts>PDNG</Sts> and v08 <Sts><Cd>PDNG</Cd></Sts>)', async () => {
    const v2 = await parse('camt053.xml')
    expect(v2.transactions.some((t) => t.bankReference === 'BQ-0004')).toBe(false)
    expect(v2.warnings).toEqual(['1 écriture non comptabilisée (statut autre que BOOK) ignorée.'])
    const v8 = await parse('camt053-v08.xml')
    expect(lines(v8)).toEqual([['2026-03-06', -1500, 'Parking Municipal Ticket 4521 Mars']])
    expect(v8.warnings).toHaveLength(1)
  })

  it('takes the calendar day of a DtTm without timezone shift', async () => {
    const xml = new TextDecoder()
      .decode(fixture('camt053-v08.xml'))
      .replace('<BookgDt><Dt>2026-03-06</Dt></BookgDt>', '<BookgDt><DtTm>2026-03-06T23:59:00-05:00</DtTm></BookgDt>')
    expect((await parseStatementFile(new TextEncoder().encode(xml))).transactions[0].bookingDate).toBe('2026-03-06')
  })
})

describe('OFX / QFX', () => {
  it('reads OFX 1.x SGML in Windows-1252 with decimal commas', async () => {
    const result = await parse('statement-v1.ofx')
    expect(result.format).toBe('ofx')
    expect(result.encoding).toBe('windows-1252')
    expect(result.accounts).toEqual([{ accountId: '12345678901', currency: 'EUR' }])
    expect(result.transactions.map((t) => [t.bookingDate, t.amountCents, t.label, t.bankReference, t.reference])).toEqual([
      ['2026-03-02', -4590, 'CB STATION SERVICE CARTE 01/03 STATION SERVICE ÉTÉ', '2026030200001', undefined],
      ['2026-03-03', 98000, 'VIR RECU CLIENT THETA', '2026030300002', undefined],
      ['2026-03-04', -12000, 'CHEQUE 0001234', '2026030400003', '0001234'],
    ])
  })

  it('reads OFX 2.x XML (QFX), PAYEE names and skips pending transactions', async () => {
    const result = await parse('statement-v2.qfx')
    expect(result.transactions.map((t) => [t.bookingDate, t.amountCents, t.label, t.bankReference])).toEqual([
      ['2026-03-05', -123456, 'Loyer bureau Loyer mars & charges', 'QFX-0001'],
      ['2026-03-06', 7500, 'Client Iota', 'QFX-0002'],
    ])
    expect(result.warnings).toEqual(['1 opération en attente ignorée.'])
  })
})

describe('downloadable example files (public/examples)', () => {
  const example = (name: string) => parseStatementFile(new Uint8Array(readFileSync(path.join(__dirname, '../../../../public/examples', name))))

  it.each([
    ['exemple-releve.csv', 'csv', 6],
    ['exemple-releve.ofx', 'ofx', 4],
    ['exemple-releve-camt053.xml', 'camt053', 4],
  ])('%s parses cleanly', async (name, format, count) => {
    const result = await example(name)
    expect(result.format).toBe(format)
    expect(result.errors).toEqual([])
    expect(result.transactions).toHaveLength(count)
    if (result.tabular) expect(result.tabular.confidence).toBe('high')
  })
})

describe('malformed files: clear French errors', () => {
  it.each([
    ['broken.xml', 'Fichier camt.053 invalide : XML mal formé ou tronqué.'],
    ['camt052.xml', 'Fichier camt.052 ou camt.054 non pris en charge : exportez le relevé au format camt.053.'],
    ['entity-bomb.xml', 'Fichier XML refusé : les entités DOCTYPE ne sont pas acceptées.'],
    ['fake.pdf', 'Les relevés PDF ne sont pas pris en charge : exportez vos opérations en CSV, OFX ou camt.053 depuis votre espace bancaire.'],
    ['no-ofx-statement.ofx', 'Fichier OFX sans relevé de compte (STMTRS).'],
  ])('%s', async (file, message) => {
    await expect(parse(file)).rejects.toMatchObject({ name: 'ValidationError', message })
  })

  it('empty, binary, legacy .xls and unknown XML files', async () => {
    await expect(parseStatementFile(new Uint8Array())).rejects.toThrow('Le fichier est vide.')
    await expect(parseStatementFile(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]))).rejects.toThrow(/Excel 97-2003/)
    await expect(parseStatementFile(new Uint8Array([1, 2, 3, 0, 5, 6]))).rejects.toThrow(/Fichier illisible/)
    await expect(parseStatementFile(new TextEncoder().encode('<html><body>x</body></html>'))).rejects.toThrow(/Fichier XML non reconnu/)
    await expect(parseStatementFile(new TextEncoder().encode('\n\n  \n'))).rejects.toThrow('Le fichier ne contient aucune ligne.')
    await expect(parseStatementFile(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))).rejects.toMatchObject({ name: 'ValidationError' })
  })

  it('never throws anything but a ValidationError on random bytes', async () => {
    let seed = 7
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648)
    for (let i = 0; i < 200; i++) {
      const bytes = new Uint8Array(1 + (next() % 300)).map(() => next() % 256)
      try {
        await parseStatementFile(bytes)
      } catch (error) {
        expect((error as Error).name).toBe('ValidationError')
      }
    }
  })
})
