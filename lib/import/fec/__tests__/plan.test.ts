/**
 * FEC import, without database: decoding, parsing and planning (which
 * entries are imported, which are refused and why). Format: LPF art. A47 A-1
 * (tab or "|" separator, ASCII / ISO 8859-15 / UTF-8, AAAAMMJJ dates, decimal
 * comma), numbering global or per journal (BOI-CF-IOR-60-40-20 § 100).
 */

import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { FEC_FIELDS } from '@/lib/fec/format'
import { decodeFecBytes, parseFecAmount, parseFecDay, parseFecFile } from '../parser'
import { cleanEntryNumber, planFecImport, standardFiscalYear, type PlanContext } from '../plan'

const fixture = (name: string) => new Uint8Array(readFileSync(path.join(__dirname, 'fixtures', name)))

const ctx = (overrides: Partial<PlanContext> = {}): PlanContext => ({
  closingMonth: 12,
  closingDay: 31,
  foundationDay: null,
  fiscalYears: [],
  existingNumbers: new Map(),
  ...overrides,
})

type Row = Partial<Record<(typeof FEC_FIELDS)[number], string>>
const HEADER = FEC_FIELDS.join('\t')
function row(values: Row): string {
  const merged: Row = {
    JournalCode: 'OD',
    JournalLib: 'Opérations diverses',
    EcritureNum: '1',
    EcritureDate: '20250115',
    CompteNum: '512000',
    CompteLib: 'Banque',
    PieceRef: 'P1',
    PieceDate: '20250115',
    EcritureLib: 'Test',
    Debit: '',
    Credit: '',
    ValidDate: '20250115',
    ...values,
  }
  return FEC_FIELDS.map((f) => merged[f] ?? '').join('\t')
}
const fec = (...rows: string[]) => [HEADER, ...rows].join('\r\n') + '\r\n'
const plan = (content: string, context = ctx()) => planFecImport(parseFecFile(content).lines, context)

describe('decodeFecBytes', () => {
  it('reads ISO 8859-15 files (accents and euro sign)', () => {
    const { text, encoding } = decodeFecBytes(fixture('other-software-2024.txt'))
    expect(encoding).toBe('ISO-8859-15')
    expect(text).toContain('Café des Arts')
    expect(text).toContain('12 € HT')
  })

  it('reads UTF-8 with or without BOM', () => {
    const utf8 = new TextEncoder().encode('JournalCode\tÉcriture €')
    expect(decodeFecBytes(utf8)).toEqual({ text: 'JournalCode\tÉcriture €', encoding: 'UTF-8' })
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8])
    expect(decodeFecBytes(withBom).text).toBe('JournalCode\tÉcriture €')
  })
})

describe('parseFecFile', () => {
  it('reads pipe separated files with CR/LF records', () => {
    const parsed = parseFecFile(decodeFecBytes(fixture('other-software-2024.txt')).text)
    expect(parsed.separator).toBe('pipe')
    expect(parsed.errors).toEqual([])
    expect(parsed.lines).toHaveLength(14)
    expect(parsed.lines[0]).toMatchObject({ lineNumber: 2, JournalCode: 'AN', Debit: '5000,00', Credit: '' })
    expect(parsed.lines[2]).toMatchObject({ CompAuxNum: 'CLI001', CompAuxLib: 'Café des Arts', EcritureLet: 'A', DateLet: '20240415' })
  })

  it('matches field names whatever their case and reads Montant + Sens', () => {
    const header = FEC_FIELDS.map((f) => (f === 'Debit' ? 'Montant' : f === 'Credit' ? 'Sens' : f.toUpperCase())).join('\t')
    const content = [header, row({ Debit: '12,50', Credit: 'D' }), row({ CompteNum: '706000', Debit: '12,50', Credit: 'C' })].join('\n')
    const parsed = parseFecFile(content)
    expect(parsed.lines.map((l) => [l.Debit, l.Credit])).toEqual([['12,50', '0'], ['0', '12,50']])
    expect(parsed.warnings.join()).toContain('Montant')
  })

  it('reports records with a wrong number of fields', () => {
    const parsed = parseFecFile(fec(row({}), 'OD\tbroken'))
    expect(parsed.errors).toEqual([{ line: 3, message: '2 zones au lieu de 18 (séparateur dans un libellé ?)' }])
  })

  it('refuses a file without the mandatory fields', () => {
    expect(() => parseFecFile('JournalCode\tDebit\nOD\t1')).toThrow(/zones absentes/)
  })
})

describe('amounts and dates', () => {
  it('reads FEC amounts exactly', () => {
    expect(parseFecAmount('1234,56')).toBe(123456)
    expect(parseFecAmount('')).toBe(0)
    expect(parseFecAmount('0,00')).toBe(0)
    expect(parseFecAmount('1234.56')).toBe(123456)
    expect(parseFecAmount('1 234,56')).toBe(123456)
    expect(parseFecAmount('-0,35')).toBe(-35)
    expect(parseFecAmount('9999999999999,99')).toBe(999999999999999)
    expect(parseFecAmount('1,005')).toBeNull()
    expect(parseFecAmount('abc')).toBeNull()
  })

  it('reads AAAAMMJJ (and tolerated formats) as calendar days', () => {
    expect(parseFecDay('20251231')).toBe('2025-12-31')
    expect(parseFecDay('2025-12-31')).toBe('2025-12-31')
    expect(parseFecDay('31/12/2025')).toBe('2025-12-31')
    expect(parseFecDay('20250230')).toBeNull()
  })
})

describe('standardFiscalYear', () => {
  it('uses the closing year as the year number', () => {
    expect(standardFiscalYear('2025-12-31', 12, 31)).toEqual({ year: 2025, start: '2025-01-01', end: '2025-12-31' })
    expect(standardFiscalYear('2025-01-01', 12, 31)).toEqual({ year: 2025, start: '2025-01-01', end: '2025-12-31' })
    expect(standardFiscalYear('2024-10-01', 9, 30)).toEqual({ year: 2025, start: '2024-10-01', end: '2025-09-30' })
    expect(standardFiscalYear('2024-02-29', 2, 29)).toEqual({ year: 2024, start: '2023-03-01', end: '2024-02-29' })
  })

  it('starts the first fiscal year at the foundation date', () => {
    expect(standardFiscalYear('2025-06-01', 12, 31, '2025-03-10')).toEqual({ year: 2025, start: '2025-03-10', end: '2025-12-31' })
  })
})

describe('planFecImport', () => {
  it('imports every entry of a file written by another software, losing nothing', () => {
    const parsed = parseFecFile(decodeFecBytes(fixture('other-software-2024.txt')).text)
    const result = planFecImport(parsed.lines, ctx())
    expect(result.refused).toEqual([])
    expect(result.fiscalYears).toEqual([{ year: 2024, start: '2024-01-01', end: '2024-12-31' }])
    // 6 entries, 14 lines: nothing dropped
    expect(result.entries.map((e) => e.entryNumber)).toEqual(['AN-1', 'VT-1', 'AC-1', 'BQ-1', 'BQ-2', 'VT-2'])
    expect(result.entries.reduce((n, e) => n + e.lines.length, 0)).toBe(14)
    expect(result.warnings.join()).toContain('numérotation par journal')

    const sale = result.entries.find((e) => e.entryNumber === 'VT-1')!
    expect(sale.lines.map((l) => l.accountCode)).toEqual(['411000', '706000', '445710'])
    expect(sale).toMatchObject({ reference: 'F240001', pieceDay: '2024-03-12', validDay: '2024-03-13', description: 'Facture F240001 Café des Arts' })
    expect(sale.lines[0]).toMatchObject({
      auxiliaryAccountNumber: 'CLI001',
      auxiliaryAccountLabel: 'Café des Arts',
      letteringCode: 'A',
      letteringDay: '2024-04-15',
      debitCents: 180000,
    })
    const purchase = result.entries.find((e) => e.entryNumber === 'AC-1')!
    expect(purchase.lines.map((l) => [l.debitCents, l.creditCents, l.currencyAmountCents, l.currencyCode])).toEqual([
      [10, 0, 11, 'USD'],
      [20, 0, 22, 'USD'],
      [0, 30, -33, 'USD'],
    ])
    expect(result.accounts.get(2024)?.get('4011DUBOIS')).toBe('Fournisseur Dubois')
    expect(result.journals.get('AN')).toBe('A nouveaux')
  })

  it('refuses the unbalanced entry, with its line and amounts', () => {
    const parsed = parseFecFile(decodeFecBytes(fixture('unbalanced-2024.txt')).text)
    const result = planFecImport(parsed.lines, ctx())
    expect(result.refused).toEqual([
      { entry: 'VT n° 2', line: 14, reason: 'écriture non équilibrée : débit 1234567,89, crédit 1234567,88' },
    ])
  })

  it('keeps a global numbering as is and groups lines of an entry anywhere in the file', () => {
    const result = plan(
      fec(
        row({ EcritureNum: '1', Debit: '10,00' }),
        row({ EcritureNum: '2', JournalCode: 'VE', Debit: '5,00' }),
        row({ EcritureNum: '1', CompteNum: '706000', Credit: '10,00' }),
        row({ EcritureNum: '2', JournalCode: 'VE', CompteNum: '706000', Credit: '5,00' }),
      ),
    )
    expect(result.refused).toEqual([])
    expect(result.entries.map((e) => [e.journalCode, e.entryNumber, e.lines.length])).toEqual([
      ['OD', '1', 2],
      ['VE', '2', 2],
    ])
  })

  it('skips zero lines but keeps the entry', () => {
    const result = plan(fec(row({ Debit: '10,00' }), row({ CompteNum: '471000', Debit: '0,00', Credit: '0,00' }), row({ CompteNum: '706000', Credit: '10,00' })))
    expect(result.entries[0].lines).toHaveLength(2)
    expect(result.warnings.join()).toContain('1 ligne sans montant')
  })

  it('refuses entries precisely (French reasons)', () => {
    const result = plan(
      fec(
        row({ EcritureNum: '1', EcritureDate: '2025-13-01', Debit: '1,00' }),
        row({ EcritureNum: '2', Debit: '1,00', Credit: '1,00' }),
        row({ EcritureNum: '2', CompteNum: '706000', Credit: '0,00' }),
        row({ EcritureNum: '3', Debit: '1,005' }),
        row({ EcritureNum: '3', CompteNum: '706000', Credit: '1,005' }),
        row({ EcritureNum: '4', Debit: '1,00' }),
        row({ EcritureNum: '5', CompteNum: '', Debit: '1,00' }),
        row({ EcritureNum: '5', CompteNum: '706000', Credit: '1,00' }),
      ),
    )
    expect(result.entries).toEqual([])
    expect(result.refused.map((r) => `${r.entry}: ${r.reason}`)).toEqual([
      "OD n° 1: date d'écriture « 2025-13-01 » invalide (format AAAAMMJJ attendu)",
      'OD n° 2: ligne 3 : débit et crédit renseignés sur la même ligne',
      'OD n° 3: ligne 5 : débit « 1,005 » illisible ; ligne 6 : crédit « 1,005 » illisible',
      'OD n° 4: moins de deux lignes avec un montant (partie double)',
      'OD n° 5: ligne 8 : numéro de compte (CompteNum) absent',
    ])
  })

  it('refuses entries of a closed fiscal year and numbers already used', () => {
    const fiscalYears = [
      { id: 'fy2024', year: 2024, startDate: new Date('2024-01-01T00:00:00Z'), endDate: new Date('2024-12-31T00:00:00Z'), isClosed: true },
      { id: 'fy2025', year: 2025, startDate: new Date('2025-01-01T00:00:00Z'), endDate: new Date('2025-12-31T00:00:00Z'), isClosed: false },
    ]
    const result = plan(
      fec(
        row({ EcritureNum: '1', EcritureDate: '20241231', Debit: '1,00' }),
        row({ EcritureNum: '1', EcritureDate: '20241231', CompteNum: '706000', Credit: '1,00' }),
        row({ EcritureNum: '7', Debit: '1,00' }),
        row({ EcritureNum: '7', CompteNum: '706000', Credit: '1,00' }),
        row({ EcritureNum: '8', Debit: '1,00' }),
        row({ EcritureNum: '8', CompteNum: '706000', Credit: '1,00' }),
      ),
      ctx({ fiscalYears, existingNumbers: new Map([['fy2025', new Set(['7'])]]) }),
    )
    expect(result.refused.map((r) => r.reason)).toEqual([
      "l'exercice 2024 est clôturé : aucune écriture ne peut y être importée",
      "le n° 7 existe déjà dans l'exercice 2025 (fichier déjà importé ?)",
    ])
    expect(result.entries.map((e) => e.entryNumber)).toEqual(['8'])
    expect(result.fiscalYears).toEqual([
      { year: 2024, start: '2024-01-01', end: '2024-12-31', id: 'fy2024' },
      { year: 2025, start: '2025-01-01', end: '2025-12-31', id: 'fy2025' },
    ])
  })

  it('places 31/12 and 01/01 in the right fiscal year whatever the stored time of the bounds', () => {
    // Bounds stored at local midnight by a server in Paris (23:00 UTC the day before)
    const fiscalYears = [
      { id: 'fy2025', year: 2025, startDate: new Date('2024-12-31T23:00:00Z'), endDate: new Date('2025-12-30T23:00:00Z'), isClosed: false },
    ]
    const result = plan(
      fec(
        row({ EcritureNum: '1', EcritureDate: '20251231', Debit: '1,00' }),
        row({ EcritureNum: '1', EcritureDate: '20251231', CompteNum: '706000', Credit: '1,00' }),
        row({ EcritureNum: '1', EcritureDate: '20260101', Debit: '1,00' }),
        row({ EcritureNum: '1', EcritureDate: '20260101', CompteNum: '706000', Credit: '1,00' }),
      ),
      ctx({ fiscalYears }),
    )
    expect(result.refused).toEqual([])
    expect(result.entries.map((e) => [e.day, e.fiscalYear])).toEqual([
      ['2025-12-31', 2025],
      ['2026-01-01', 2026],
    ])
  })

  it('cleans leading zeros of entry numbers on request', () => {
    expect(cleanEntryNumber('001')).toBe('1')
    expect(cleanEntryNumber('OD-007')).toBe('OD-7')
    const result = plan(fec(row({ EcritureNum: '0042', Debit: '1,00' }), row({ EcritureNum: '0042', CompteNum: '706000', Credit: '1,00' })), ctx({ cleanEntryNumbers: true }))
    expect(result.entries[0].entryNumber).toBe('42')
  })
})
