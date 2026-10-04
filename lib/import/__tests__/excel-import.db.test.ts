/**
 * Excel journal import against PostgreSQL (lib/import/excel.ts through
 * importAccountingFile, skipped without the test database server): a real
 * .xlsx is built with ExcelJS, imported, and the entries, lines and amounts
 * written are read back. Amounts are exact cents (French "1 234,56"
 * accepted), every imported entry balances in cents (partie double,
 * lib/accounting/validator.ts) and is validated, so it gets its definitive number in the fiscal year
 * sequence (PCG art. 1031-3; LPF art. A47 A-1 for the FEC numbering).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import ExcelJS from 'exceljs'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('cov_excel_import')
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
let importAccountingFile: typeof import('@/lib/import/import-file.service').importAccountingFile
let importExcel: typeof import('@/lib/import/excel').importExcel
let importCSV: typeof import('@/lib/import/csv').importCSV
let createAccountingEntryWithWarnings: typeof import('@/lib/accounting/services/create-accounting-entry-with-warnings.service').createAccountingEntryWithWarnings

const ids = {} as Record<string, string>

const HEADERS = ['date', 'journal', 'entryNumber', 'account', 'debit', 'credit', 'description', 'reference']
type Row = Array<string | number | Date | null>

async function workbook(rows: Row[], headers: string[] = HEADERS): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const sheet = wb.addWorksheet('Journal')
  sheet.addRow(headers)
  for (const row of rows) sheet.addRow(row)
  return Buffer.from(await wb.xlsx.writeBuffer())
}

function form(file: Buffer, name = 'journal.xlsx'): FormData {
  const data = new FormData()
  data.set('file', new File([new Uint8Array(file)], name))
  data.set('type', 'excel')
  return data
}

async function seed() {
  await prepareTestDatabase('cov_excel_import')
  const company = await prisma.company.create({ data: { name: 'Atelier', slug: 'atelier', siren: '123456789' } })
  const fy2025 = await prisma.fiscalYear.create({
    data: { companyId: company.id, year: 2025, startDate: new Date('2025-01-01T00:00:00Z'), endDate: new Date('2025-12-31T00:00:00Z') },
  })
  Object.assign(ids, { company: company.id, fy2025: fy2025.id })
}

async function entriesWithLines() {
  return prisma.accountingEntry.findMany({
    where: { companyId: ids.company },
    orderBy: { entryNumber: 'asc' },
    include: { journal: true, lines: { orderBy: { createdAt: 'asc' }, include: { account: true } } },
  })
}

describe.skipIf(!available)('Excel journal import (PostgreSQL)', () => {
  beforeAll(async () => {
    await prepareTestDatabase('cov_excel_import')
    ;({ prisma } = await import('@/lib/prisma'))
    ;({ importAccountingFile } = await import('@/lib/import/import-file.service'))
    ;({ importExcel } = await import('@/lib/import/excel'))
    ;({ importCSV } = await import('@/lib/import/csv'))
    ;({ createAccountingEntryWithWarnings } = await import('@/lib/accounting/services/create-accounting-entry-with-warnings.service'))
  })
  beforeEach(seed)
  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('creates validated, balanced entries with exact cent amounts, journals and accounts', async () => {
    const file = await workbook([
      ['2025-03-10', 'VE', 'E1', '411000', '1 234,56', null, 'Facture 12', 'F-12'],
      ['2025-03-10', 'VE', 'E1', '706000', null, '1 029,00', 'Facture 12', 'F-12'],
      ['2025-03-10', 'VE', 'E1', '445710', null, 205.56, 'Facture 12', 'F-12'],
      ['2025-03-15', 'BQ', 'E2', '512000', 0.1 + 0.2, null, 'Encaissement', 'R-1'],
      ['2025-03-15', 'BQ', 'E2', '411000', null, '0.30', 'Encaissement', 'R-1'],
    ])

    const result = await importAccountingFile(ids.company, form(file))

    expect(result).toMatchObject({ success: true, entriesCreated: 2, accountsCreated: 4, journalsCreated: 2, errors: [], pcgWarnings: [] })
    const entries = await entriesWithLines()
    expect(entries.map((e) => [e.entryNumber, e.status, e.journal.code, e.date.toISOString().slice(0, 10), e.description, e.reference, e.fiscalYearId])).toEqual([
      ['1', 'validated', 'VE', '2025-03-10', 'Facture 12', 'F-12', ids.fy2025],
      ['2', 'validated', 'BQ', '2025-03-15', 'Encaissement', 'R-1', ids.fy2025],
    ])
    expect(entries[0].lines.map((l) => [l.account.code, l.debit.toFixed(2), l.credit.toFixed(2)])).toEqual([
      ['411000', '1234.56', '0.00'],
      ['706000', '0.00', '1029.00'],
      ['445710', '0.00', '205.56'],
    ])
    // 0.1 + 0.2 in a numeric cell is read as 0.30, not 0.30000000000000004
    expect(entries[1].lines.map((l) => [l.account.code, l.debit.toFixed(2), l.credit.toFixed(2)])).toEqual([
      ['512000', '0.30', '0.00'],
      ['411000', '0.00', '0.30'],
    ])
    expect(entries.every((e) => e.validatedAt instanceof Date)).toBe(true)
    // Accounts are created in the active fiscal year, labelled with their code
    const accounts = await prisma.account.findMany({ where: { companyId: ids.company }, orderBy: { code: 'asc' } })
    expect(accounts.map((a) => [a.code, a.label, a.fiscalYearId])).toEqual([
      ['411000', '411000', ids.fy2025],
      ['445710', '445710', ids.fy2025],
      ['512000', '512000', ids.fy2025],
      ['706000', '706000', ids.fy2025],
    ])
  })

  it('reads real Excel date cells as calendar days and reuses existing journals and accounts', async () => {
    const journal = await prisma.journal.create({ data: { companyId: ids.company, code: 'AC', label: 'Achats' } })
    const supplier = await prisma.account.create({ data: { companyId: ids.company, fiscalYearId: ids.fy2025, code: '401000', label: 'Fournisseurs' } })
    const file = await workbook([
      [new Date(Date.UTC(2025, 11, 31)), 'AC', 'A1', '606100', 80, null, 'Fournitures', 'FA-9'],
      [new Date(Date.UTC(2025, 11, 31)), 'AC', 'A1', '401000', null, 80, 'Fournitures', 'FA-9'],
    ])

    const result = await importExcel({ companyId: ids.company, file })

    expect(result).toMatchObject({ success: true, entriesCreated: 1, accountsCreated: 1, errors: [] })
    const [entry] = await entriesWithLines()
    expect(entry.date.toISOString()).toBe('2025-12-31T00:00:00.000Z')
    expect(entry.journalId).toBe(journal.id)
    expect(entry.lines.map((l) => l.accountId)).toContain(supplier.id)
    expect(await prisma.journal.count({ where: { companyId: ids.company } })).toBe(1)
  })

  it('refuses an unbalanced entry with the French reason and still imports the balanced ones', async () => {
    const file = await workbook([
      ['2025-04-01', 'OD', 'U1', '512000', '100,00', null, 'Déséquilibrée', null],
      ['2025-04-01', 'OD', 'U1', '706000', null, '99,99', 'Déséquilibrée', null],
      ['2025-04-02', 'OD', 'B1', '512000', '50', null, 'Équilibrée', null],
      ['2025-04-02', 'OD', 'B1', '706000', null, '50', 'Équilibrée', null],
    ])

    const result = await importExcel({ companyId: ids.company, file })

    expect(result.success).toBe(false)
    expect(result.entriesCreated).toBe(1)
    expect(result.errors).toEqual(["Écriture U1: L'écriture n'est pas équilibrée : débit 100,00 €, crédit 99,99 €, écart 0,01 €"])
    const entries = await entriesWithLines()
    expect(entries.map((e) => e.description)).toEqual(['Équilibrée'])
  })

  it('refuses an amount with three decimals or text, naming the entry', async () => {
    const file = await workbook([
      ['2025-04-01', 'OD', 'X1', '512000', '10,005', null, 'Trois décimales', null],
      ['2025-04-01', 'OD', 'X1', '706000', null, '10,005', 'Trois décimales', null],
      ['2025-04-01', 'OD', 'X2', '512000', 'dix', null, 'Texte', null],
      ['2025-04-01', 'OD', 'X2', '706000', null, 10, 'Texte', null],
    ])

    const result = await importExcel({ companyId: ids.company, file })

    expect(result.errors).toEqual([
      'Écriture X1: montant invalide (exemple : 1 234,56)',
      'Écriture X2: montant invalide (exemple : 1 234,56)',
    ])
    expect(result.entriesCreated).toBe(0)
    expect(await prisma.accountingEntry.count()).toBe(0)
  })

  it('puts lines without a journal in OD and refuses a line without an account', async () => {
    const file = await workbook([
      ['2025-05-01', null, 'N1', '512000', 20, null, 'Sans journal', null],
      ['2025-05-01', null, 'N1', '706000', null, 20, 'Sans journal', null],
      ['2025-05-02', 'OD', 'N2', '512000', 30, null, 'Sans compte', null],
      ['2025-05-02', 'OD', 'N2', null, null, 30, 'Sans compte', null],
    ])

    const result = await importExcel({ companyId: ids.company, file })

    expect(result.entriesCreated).toBe(1)
    expect(result.errors).toEqual(['Écriture N2: Ligne 2 : compte obligatoire'])
    const [entry] = await entriesWithLines()
    expect(entry.journal.code).toBe('OD')
  })

  it('reports an entry dated outside every fiscal year without creating it', async () => {
    const file = await workbook([
      ['2024-06-01', 'OD', 'O1', '512000', 10, null, 'Hors exercice', null],
      ['2024-06-01', 'OD', 'O1', '706000', null, 10, 'Hors exercice', null],
    ])

    const result = await importExcel({ companyId: ids.company, file })

    expect(result.success).toBe(false)
    expect(result.entriesCreated).toBe(0)
    // lib/accounting/entry-guards.ts: an entry belongs to the fiscal year holding its date
    expect(result.errors).toEqual(["Écriture O1: La date du 01/06/2024 est hors de l'exercice 2025 (du 01/01/2025 au 31/12/2025)."])
    expect(await prisma.accountingEntry.count()).toBe(0)
  })

  describe('importing the same file again', () => {
    // Regression: the file's entry number was compared with Kledg's numbers,
    // which are assigned at validation (PCG art. 1031-3). The file entry "1"
    // was silently dropped once another imported entry had received number 1,
    // and a second import duplicated every entry whose file number was not a
    // Kledg number.
    const rows: Row[] = [
      ['2025-06-01', 'OD', 'R1', '512000', 10, null, 'Loyer', 'L-6'],
      ['2025-06-01', 'OD', 'R1', '706000', null, 10, 'Loyer', 'L-6'],
      ['2025-06-02', 'OD', '1', '512000', 11, null, 'Frais', null],
      ['2025-06-02', 'OD', '1', '706000', null, 11, 'Frais', null],
    ]

    it('imports an entry whose file number equals a number Kledg already gave', async () => {
      const result = await importExcel({ companyId: ids.company, file: await workbook(rows) })

      expect(result).toMatchObject({ success: true, entriesCreated: 2, errors: [] })
      const entries = await entriesWithLines()
      expect(entries.map((e) => [e.entryNumber, e.description])).toEqual([['1', 'Loyer'], ['2', 'Frais']])
    })

    it('creates nothing the second time', async () => {
      const file = await workbook(rows)
      await importExcel({ companyId: ids.company, file })

      const second = await importExcel({ companyId: ids.company, file })

      expect(second).toMatchObject({ success: true, entriesCreated: 0, accountsCreated: 0, errors: [] })
      expect(await prisma.accountingEntry.count()).toBe(2)
    })

    it('keeps two identical entries of one file, once each', async () => {
      const fee: Row[] = [
        ['2025-06-03', 'BQ', 'F1', '627000', '1,50', null, 'Frais bancaires', null],
        ['2025-06-03', 'BQ', 'F1', '512000', null, '1,50', 'Frais bancaires', null],
        ['2025-06-03', 'BQ', 'F2', '627000', '1,50', null, 'Frais bancaires', null],
        ['2025-06-03', 'BQ', 'F2', '512000', null, '1,50', 'Frais bancaires', null],
      ]
      const file = await workbook(fee)
      expect((await importExcel({ companyId: ids.company, file })).entriesCreated).toBe(2)
      expect((await importExcel({ companyId: ids.company, file })).entriesCreated).toBe(0)
      // A third identical fee added to the file later is imported alone
      const more = await workbook([...fee, ['2025-06-03', 'BQ', 'F3', '627000', '1,50', null, 'Frais bancaires', null], ['2025-06-03', 'BQ', 'F3', '512000', null, '1,50', 'Frais bancaires', null]])
      expect((await importExcel({ companyId: ids.company, file: more })).entriesCreated).toBe(1)
      expect(await prisma.accountingEntry.count()).toBe(3)
    })

    it('imports an entry that differs only by an amount', async () => {
      await importExcel({ companyId: ids.company, file: await workbook(rows) })
      const changed = rows.map((r) => (r[2] === 'R1' ? r.map((v) => (v === 10 ? 10.01 : v)) : r))

      const result = await importExcel({ companyId: ids.company, file: await workbook(changed) })

      expect(result.entriesCreated).toBe(1)
      const loyers = (await entriesWithLines()).filter((e) => e.description === 'Loyer')
      expect(loyers.map((e) => e.lines[0].debit.toFixed(2))).toEqual(['10.00', '10.01'])
    })

    it('applies the same rule to the CSV import', async () => {
      const csv = [
        'date,journal,entryNumber,account,debit,credit,description,reference',
        '2025-06-01,OD,R1,512000,10,,Loyer,L-6',
        '2025-06-01,OD,R1,706000,,10,Loyer,L-6',
        '2025-06-02,OD,1,512000,11,,Frais,',
        '2025-06-02,OD,1,706000,,11,Frais,',
      ].join('\n')

      expect(await importCSV({ companyId: ids.company, content: csv })).toMatchObject({ success: true, entriesCreated: 2, errors: [] })
      expect(await importCSV({ companyId: ids.company, content: csv })).toMatchObject({ success: true, entriesCreated: 0, errors: [] })
      const entries = await entriesWithLines()
      expect(entries.map((e) => [e.entryNumber, e.description])).toEqual([['1', 'Loyer'], ['2', 'Frais']])
    })
  })

  it('returns the PCG art. 511-1 warning for an entry without description', async () => {
    const file = await workbook([
      ['2025-06-01', 'OD', 'W1', '512000', 10, null, null, null],
      ['2025-06-01', 'OD', 'W1', '706000', null, 10, null, null],
    ])

    const result = await importExcel({ companyId: ids.company, file })

    expect(result.entriesCreated).toBe(1)
    expect(result.pcgWarnings).toEqual([
      {
        entryNumber: 'W1',
        warnings: [
          {
            code: 'PCG-511-1',
            message: 'Description vide, considérer ajouter une description significative pour la clarté (PCG Art. 511-1)',
            severity: 'info',
            article: '511-1',
          },
        ],
      },
    ])
  })

  it('reads columns named by a custom mapping and a chosen sheet', async () => {
    const wb = new ExcelJS.Workbook()
    wb.addWorksheet('Notes').addRow(['ignorée'])
    const sheet = wb.addWorksheet('Ecritures')
    sheet.addRow(['Jour', 'Jnl', 'Num', 'Compte', 'D', 'C', 'Libellé', 'Pièce'])
    sheet.addRow(['2025-07-01', 'VE', 'M1', '411000', 12.5, null, 'Vente', 'P1'])
    sheet.addRow(['2025-07-01', 'VE', 'M1', '706000', null, 12.5, 'Vente', 'P1'])
    const file = Buffer.from(await wb.xlsx.writeBuffer())

    const result = await importExcel({
      companyId: ids.company,
      file,
      sheetName: 'Ecritures',
      mapping: {
        dateColumn: 'Jour',
        journalColumn: 'Jnl',
        entryNumberColumn: 'Num',
        accountColumn: 'Compte',
        debitColumn: 'D',
        creditColumn: 'C',
        descriptionColumn: 'Libellé',
        referenceColumn: 'Pièce',
      },
    })

    expect(result).toMatchObject({ success: true, entriesCreated: 1, errors: [] })
    const [entry] = await entriesWithLines()
    expect([entry.description, entry.reference, entry.lines.map((l) => l.debit.toFixed(2))]).toEqual(['Vente', 'P1', ['12.50', '0.00']])
  })

  it('stops with a French reason on an empty sheet, a missing sheet or an unreadable workbook', async () => {
    expect(await importExcel({ companyId: ids.company, file: await workbook([]) })).toMatchObject({
      success: false,
      entriesCreated: 0,
      errors: ['Import interrompu : Le fichier Excel est vide'],
    })
    expect(await importExcel({ companyId: ids.company, file: await workbook([]), sheetName: 'Absente' })).toMatchObject({
      success: false,
      errors: ['Import interrompu : Feuille Excel introuvable'],
    })
    // Not a zip at all: refused by the service before ExcelJS sees it
    await expect(importAccountingFile(ids.company, form(Buffer.from('date;journal\n2025-01-01;OD\n')))).rejects.toThrow(
      'Fichier Excel invalide : seuls les fichiers .xlsx sont acceptés.',
    )
    expect(await prisma.accountingEntry.count()).toBe(0)
  })

  it('refuses an unknown file type with the French message', async () => {
    const data = form(await workbook([]))
    data.set('type', 'ods')
    await expect(importAccountingFile(ids.company, data)).rejects.toThrow('Type de fichier inconnu : fec, csv ou excel')
  })

  describe('createAccountingEntryWithWarnings', () => {
    it('creates the entry through the life cycle and ignores the caller number', async () => {
      const journal = await prisma.journal.create({ data: { companyId: ids.company, code: 'OD', label: 'OD' } })
      const bank = await prisma.account.create({ data: { companyId: ids.company, fiscalYearId: ids.fy2025, code: '512000', label: 'Banque' } })
      const sales = await prisma.account.create({ data: { companyId: ids.company, fiscalYearId: ids.fy2025, code: '706000', label: 'Ventes' } })

      const { entry, warnings } = await createAccountingEntryWithWarnings({
        companyId: ids.company,
        journalId: journal.id,
        entryNumber: 'IMPOSE-42',
        date: '2025-08-01',
        description: '',
        status: 'validated',
        lines: [
          { accountId: bank.id, debit: '19.99', credit: 0 },
          { accountId: sales.id, debit: 0, credit: '19.99' },
        ],
      })

      // Numbers are assigned at validation in the fiscal year sequence (PCG art. 1031-3)
      expect(entry).toMatchObject({ entryNumber: '1', status: 'validated', fiscalYearId: ids.fy2025 })
      expect(warnings.map((w) => w.code)).toEqual(['PCG-511-1'])

      const draft = await createAccountingEntryWithWarnings({
        companyId: ids.company,
        journalId: journal.id,
        date: '2025-08-02',
        description: 'Brouillon',
        lines: [
          { accountId: bank.id, debit: 5, credit: 0 },
          { accountId: sales.id, debit: 0, credit: 5 },
        ],
      })
      expect(draft.warnings).toEqual([])
      expect(draft.entry.status).toBe('draft')
      expect(draft.entry.entryNumber).toMatch(/^BR-/)
    })
  })
})
