/**
 * FEC validator: each rule of LPF art. A47 A-1 / BOI-CF-IOR-60-40-20 it
 * enforces, checked on a file broken on purpose.
 */

import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { FEC_FIELDS } from '../format'
import { validateFec } from '../validator'

const GOLDEN = readFileSync(path.join(__dirname, 'fixtures', '123456789FEC20251231.txt'), 'utf8')
const HEADER = FEC_FIELDS.join('\t')

type Row = Partial<Record<(typeof FEC_FIELDS)[number], string>>

function row(values: Row): string {
  const base: Row = {
    JournalCode: 'OD',
    JournalLib: 'Opérations diverses',
    EcritureNum: '1',
    EcritureDate: '20250115',
    CompteNum: '512000',
    CompteLib: 'Banque',
    PieceRef: 'P1',
    PieceDate: '20250115',
    EcritureLib: 'Test',
    Debit: '0,00',
    Credit: '0,00',
    ValidDate: '20250115',
  }
  const merged = { ...base, ...values }
  return FEC_FIELDS.map((f) => merged[f] ?? '').join('\t')
}

const file = (...rows: string[]) => [HEADER, ...rows].join('\r\n') + '\r\n'
const balanced = (n: string, extra: Row = {}) => [
  row({ EcritureNum: n, Debit: '100,00', ...extra }),
  row({ EcritureNum: n, CompteNum: '706000', CompteLib: 'Ventes', Credit: '100,00', ...extra }),
]
const messages = (content: string, options = {}) => validateFec(content, options).errors.map((e) => e.message).join('\n')

describe('validateFec', () => {
  it('accepts a compliant file', () => {
    const report = validateFec(file(...balanced('1'), ...balanced('2')))
    expect(report.errors).toEqual([])
    expect(report.valid).toBe(true)
  })

  it('accepts the pipe separator', () => {
    expect(validateFec(file(...balanced('1')).replace(/\t/g, '|')).errors).toEqual([])
  })

  it('refuses a header that is not the 18 fields in order', () => {
    const swapped = file(...balanced('1')).replace('JournalCode\tJournalLib', 'JournalLib\tJournalCode')
    expect(messages(swapped)).toContain('En-tête non conforme')
    expect(messages(file(...balanced('1')).replace(/\t/g, ';'))).toContain('Séparateur de zones absent')
  })

  it('refuses records without 18 fields', () => {
    expect(messages(file(...balanced('1'), 'OD\tx'))).toContain('2 zones au lieu de 18')
  })

  it('refuses blank mandatory fields', () => {
    const content = file(...balanced('1', { PieceRef: '' }))
    expect(messages(content)).toContain('Zone PieceRef obligatoire non renseignée')
    expect(messages(file(...balanced('1', { ValidDate: '' })))).toContain('Zone ValidDate obligatoire')
  })

  it('refuses dates that are not AAAAMMJJ calendar days', () => {
    expect(messages(file(...balanced('1', { EcritureDate: '2025-01-15' })))).toContain('EcritureDate « 2025-01-15 »')
    expect(messages(file(...balanced('1', { PieceDate: '20250230' })))).toContain('PieceDate « 20250230 »')
  })

  it('refuses amounts with a dot, a thousands separator or three decimals', () => {
    expect(messages(file(row({ Debit: '100.00' }), row({ CompteNum: '706000', Credit: '100,00' })))).toContain('Debit « 100.00 »')
    expect(messages(file(row({ Debit: '1 000,00' }), row({ CompteNum: '706000', Credit: '1000,00' })))).toContain('sans séparateur de milliers')
    expect(messages(file(row({ Debit: '1,005' }), row({ CompteNum: '706000', Credit: '1,005' })))).toContain('Debit « 1,005 »')
  })

  it('refuses a line with both debit and credit', () => {
    const content = file(row({ Debit: '100,00', Credit: '100,00' }), row({ CompteNum: '706000', Credit: '0,00', Debit: '0,00' }))
    expect(messages(content)).toContain('Débit et crédit renseignés sur la même ligne')
  })

  it('refuses an unbalanced entry and an unbalanced file', () => {
    const content = file(row({ Debit: '100,00' }), row({ CompteNum: '706000', Credit: '99,99' }))
    const text = messages(content)
    expect(text).toContain('Écriture OD n° 1 non équilibrée : débit 100,00, crédit 99,99')
    expect(text).toContain('Fichier non équilibré')
  })

  it('balances 0,10 + 0,20 against 0,30 exactly', () => {
    const content = file(row({ Debit: '0,10' }), row({ Debit: '0,20' }), row({ CompteNum: '706000', Credit: '0,30' }))
    expect(validateFec(content).errors).toEqual([])
  })

  it('refuses a single-line entry and an entry with several dates', () => {
    expect(messages(file(row({ Debit: '0,00' })))).toContain('une seule ligne')
    const twoDates = file(row({ Debit: '1,00' }), row({ CompteNum: '706000', Credit: '1,00', EcritureDate: '20250116' }))
    expect(messages(twoDates)).toContain("plusieurs dates d'écriture")
  })

  it('refuses gaps in a global numbering', () => {
    expect(messages(file(...balanced('1'), ...balanced('3')))).toContain('Numérotation non continue : rupture entre 1 et 3')
  })

  it('checks a per-journal numbering journal by journal', () => {
    const content = file(
      ...balanced('1'),
      ...balanced('1', { JournalCode: 'VE', JournalLib: 'Ventes' }),
      ...balanced('2', { JournalCode: 'VE', JournalLib: 'Ventes' }),
    )
    const report = validateFec(content)
    expect(report.errors).toEqual([])
    expect(report.stats.numbering).toBe('journal')
    const gap = file(...balanced('1'), ...balanced('1', { JournalCode: 'VE' }), ...balanced('3', { JournalCode: 'VE' }))
    expect(messages(gap)).toContain('Numérotation du journal VE non continue')
  })

  it('warns when the numbering decreases or opening entries come late', () => {
    const report = validateFec(file(...balanced('2'), ...balanced('1'), ...balanced('3', { JournalCode: 'AN' })))
    const warnings = report.warnings.map((w) => w.message).join('\n')
    expect(warnings).toContain('non croissante')
    expect(warnings).toContain("d'à-nouveaux")
  })

  it('checks the file name SirenFECAAAAMMJJ', () => {
    expect(messages(GOLDEN, { fileName: 'FEC_societe_2025.txt' })).toContain('Nom de fichier')
    expect(messages(GOLDEN, { fileName: '123456789FEC20251231.txt', closingDate: '20241231' })).toContain('date de clôture')
    expect(validateFec(GOLDEN, { fileName: '123456789FEC20251231.txt', closingDate: '20251231' }).valid).toBe(true)
  })

  it('warns about lettrage and auxiliary account fields used alone', () => {
    const report = validateFec(file(...balanced('1', { EcritureLet: 'AA', CompAuxNum: 'C1' })))
    const warnings = report.warnings.map((w) => w.message).join('\n')
    expect(warnings).toContain('EcritureLet renseignée sans DateLet')
    expect(warnings).toContain('CompAuxNum et CompAuxLib')
  })
})
