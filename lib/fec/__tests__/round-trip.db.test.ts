/**
 * FEC export then import against PostgreSQL (skipped without the server):
 * - a Kledg fiscal year exported and imported into an empty company gives the
 *   same entries, numbers and balances, and the same FEC again;
 * - a FEC written by another software (pipe separator, ISO 8859-15,
 *   numbering per journal, auxiliary accounts, lettrage, foreign currency)
 *   is imported without loss;
 * - the import is atomic: one unbalanced entry and nothing is written;
 *   importing the same file twice is refused.
 */

import { readFileSync } from 'fs'
import path from 'path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('fec_round_trip')
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()
const fixture = (name: string) => new Uint8Array(readFileSync(path.join(__dirname, '../../import/fec/__tests__/fixtures', name)))

let prisma: typeof import('@/lib/prisma').prisma
let svc: typeof import('@/lib/accounting/services/entry-lifecycle.service')
let fecExport: typeof import('@/lib/fec/export')
let fecImport: typeof import('@/lib/import/fec')
let validator: typeof import('@/lib/fec/validator')

async function company(siren: string, slug: string) {
  return prisma.company.create({ data: { name: slug, slug, siren }, select: { id: true } })
}

/** Balance (debit, credit in cents) per account number, validated entries only. */
async function balances(companyId: string) {
  const rows = await prisma.$queryRaw<Array<{ code: string; debit: string; credit: string }>>`
    SELECT a."code", SUM(l."debit")::text AS debit, SUM(l."credit")::text AS credit
    FROM "entry_lines" l
    JOIN "accounting_entries" e ON e."id" = l."accountingEntryId"
    JOIN "accounts" a ON a."id" = l."accountId"
    WHERE e."companyId" = ${companyId} AND e."status" = 'validated'
    GROUP BY a."code" ORDER BY a."code"`
  return rows
}

async function counts(companyId: string) {
  const [entries, lines, accounts, journals, fiscalYears] = await Promise.all([
    prisma.accountingEntry.count({ where: { companyId } }),
    prisma.entryLine.count({ where: { accountingEntry: { companyId } } }),
    prisma.account.count({ where: { companyId } }),
    prisma.journal.count({ where: { companyId } }),
    prisma.fiscalYear.count({ where: { companyId } }),
  ])
  return { entries, lines, accounts, journals, fiscalYears }
}

/** A 2025 ledger booked through the services, with what a FEC must carry. */
async function bookLedger(companyId: string) {
  const fy = await prisma.fiscalYear.create({
    data: { companyId, year: 2025, startDate: new Date('2025-01-01T00:00:00Z'), endDate: new Date('2025-12-31T00:00:00Z') },
  })
  const journals = Object.fromEntries(
    await Promise.all(
      [['AN', 'À-nouveaux'], ['VE', 'Ventes'], ['AC', 'Achats'], ['BQ', 'Banque']].map(async ([code, label]) => [
        code,
        (await prisma.journal.create({ data: { companyId, code, label } })).id,
      ]),
    ),
  ) as Record<string, string>
  const accounts: Record<string, string> = {}
  for (const [code, label] of [['101300', 'Capital'], ['411000', 'Clients'], ['401000', 'Fournisseurs'], ['445660', 'TVA déductible'], ['445710', 'TVA collectée'], ['512000', 'Banque'], ['606100', 'Fournitures'], ['706000', 'Prestations']]) {
    accounts[code] = (await prisma.account.create({ data: { companyId, fiscalYearId: fy.id, code, label } })).id
  }
  const entry = (journal: string, date: string, description: string, reference: string | null, lines: Array<[string, string, string, Record<string, string>?]>, status: 'draft' | 'validated' = 'validated') =>
    svc.createEntry({
      companyId,
      journalId: journals[journal],
      date,
      description,
      reference,
      status,
      lines: lines.map(([code, debit, credit, extra]) => ({ accountId: accounts[code], debit, credit, ...extra })),
    })

  const sale = await entry('VE', '2025-02-10', 'Facture Martin', 'FA-001', [
    ['411000', '1440.00', '0', { auxiliaryAccountNumber: 'C001', auxiliaryAccountLabel: 'Martin SA' }],
    ['706000', '0', '1200.00'],
    ['445710', '0', '240.00'],
  ])
  await entry('AC', '2025-03-01', 'Fournitures', 'F-778', [
    ['606100', '0.10', '0'],
    ['606100', '0.20', '0'],
    ['445660', '0.06', '0'],
    ['401000', '0', '0.36', { auxiliaryAccountNumber: 'F007', auxiliaryAccountLabel: 'Papeterie & Co', currencyAmount: '-0.40', currencyCode: 'USD' }],
  ])
  const payment = await entry('BQ', '2025-03-15', 'Règlement Martin', 'VIR-15', [
    ['512000', '1440.00', '0'],
    ['411000', '0', '1440.00', { auxiliaryAccountNumber: 'C001', auxiliaryAccountLabel: 'Martin SA' }],
  ])
  // Lettrage after validation (allowed: it is not part of the entry)
  await prisma.entryLine.updateMany({
    where: { accountingEntryId: { in: [sale.id, payment.id] }, account: { code: '411000' } },
    data: { letteringCode: 'AA', letteringDate: new Date('2025-03-15T00:00:00Z') },
  })
  // Opening entry, validated after the others (as when 2024 is closed late)
  await entry('AN', '2025-01-01', "Écriture d'ouverture", 'OU-2025', [
    ['512000', '50000.00', '0'],
    ['101300', '0', '50000.00'],
  ])
  const big = await entry('VE', '2025-12-31', 'Grosse vente', 'FA-999', [
    ['411000', '9999999999.99', '0', { auxiliaryAccountNumber: 'C002', auxiliaryAccountLabel: 'Client Éole' }],
    ['706000', '0', '9999999999.99'],
  ])
  await svc.reverseEntry(companyId, big.id)
  await entry('OD' in journals ? 'OD' : 'AC', '2025-06-01', 'Brouillon jamais validé', null, [['606100', '5.00', '0'], ['401000', '0', '5.00']], 'draft')
  return fy.id
}

describe.skipIf(!available)('FEC round trip (PostgreSQL)', () => {
  beforeAll(async () => {
    await prepareTestDatabase('fec_round_trip')
    ;({ prisma } = await import('@/lib/prisma'))
    svc = await import('@/lib/accounting/services/entry-lifecycle.service')
    fecExport = await import('@/lib/fec/export')
    fecImport = await import('@/lib/import/fec')
    validator = await import('@/lib/fec/validator')
  })
  beforeEach(async () => {
    await prepareTestDatabase('fec_round_trip')
  })
  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('exports a compliant FEC and re-imports it identically into an empty company', async () => {
    const source = await company('123456789', 'source')
    const fiscalYearId = await bookLedger(source.id)
    const exported = await fecExport.exportFec(source.id, fiscalYearId)
    expect(exported.fileName).toBe('123456789FEC20251231.txt')
    expect(exported.entries).toBe(6) // the draft is not part of the FEC
    // ...but the export says so: the books of the year are not final while drafts remain
    expect(exported.drafts).toBe(1)
    const { fecComplianceReport } = await import('@/lib/fec/export-fec.service')
    expect(fecComplianceReport(exported).warnings).toEqual([
      { line: null, message: expect.stringContaining('1 écriture en brouillon') },
    ])
    const report = validator.validateFec(exported.content, { fileName: exported.fileName, closingDate: '20251231' })
    expect(report.errors).toEqual([])
    expect(report.warnings).toEqual([])
    // Opening entry first although validated fourth
    expect(exported.content.split('\r\n')[1].startsWith('AN\tÀ-nouveaux\t4\t20250101')).toBe(true)

    const target = await company('987654321', 'target')
    const result = await fecImport.importFEC({ companyId: target.id, bytes: new TextEncoder().encode(exported.content) })
    expect(result.errors).toEqual([])
    expect(result).toMatchObject({ success: true, entriesCreated: 6, linesCreated: exported.lines, journalsCreated: 4, refused: [] })

    expect(await balances(target.id)).toEqual(await balances(source.id))
    const sourceCounts = await counts(source.id)
    const targetCounts = await counts(target.id)
    expect(targetCounts.entries).toBe(sourceCounts.entries - 1) // minus the draft
    expect(targetCounts.lines).toBe(exported.lines)

    const targetYear = await prisma.fiscalYear.findFirstOrThrow({ where: { companyId: target.id } })
    expect(targetYear).toMatchObject({ year: 2025, startDate: new Date('2025-01-01T00:00:00Z'), endDate: new Date('2025-12-31T00:00:00Z'), isClosed: false })
    const again = await fecExport.exportFec(target.id, targetYear.id)
    expect(again.content).toBe(exported.content)

    // Imported entries are validated and definitive; the next validation continues the sequence
    const reimported = await prisma.accountingEntry.findMany({ where: { companyId: target.id }, select: { status: true, entryNumber: true } })
    expect(reimported.every((e) => e.status === 'validated')).toBe(true)
    expect(reimported.map((e) => e.entryNumber).sort()).toEqual(['1', '2', '3', '4', '5', '6'])
  })

  it('imports a FEC written by another software without loss', async () => {
    const target = await company('111222333', 'autre-logiciel')
    const result = await fecImport.importFEC({ companyId: target.id, bytes: fixture('other-software-2024.txt') })
    expect(result.errors).toEqual([])
    expect(result).toMatchObject({ success: true, entriesCreated: 6, linesCreated: 14, encoding: 'ISO-8859-15', separator: 'pipe' })

    const lines = await prisma.entryLine.findMany({
      where: { accountingEntry: { companyId: target.id } },
      include: { account: true, accountingEntry: true },
    })
    const client = lines.find((l) => l.account.code === '411000' && l.accountingEntry.entryNumber === 'VT-1')!
    expect(client).toMatchObject({ auxiliaryAccountNumber: 'CLI001', auxiliaryAccountLabel: 'Café des Arts', letteringCode: 'A' })
    expect(client.letteringDate?.toISOString()).toBe('2024-04-15T00:00:00.000Z')
    expect(client.accountingEntry).toMatchObject({ reference: 'F240001', status: 'validated' })
    expect(client.accountingEntry.pieceDate?.toISOString()).toBe('2024-03-12T00:00:00.000Z')
    const usd = lines.filter((l) => l.currencyCode === 'USD').map((l) => l.currencyAmount?.toString()).sort()
    expect(usd).toEqual(['-0.33', '0.11', '0.22'])
    // An account that was in no chart is created
    expect(lines.some((l) => l.account.code === '4011DUBOIS' && l.account.label === 'Fournisseur Dubois')).toBe(true)
    // Balances per account: debit = credit overall, big amount exact
    const byCode = Object.fromEntries((await balances(target.id)).map((b) => [b.code, b]))
    expect(byCode['411000']).toEqual({ code: '411000', debit: '1236367.89', credit: '1800.00' })
    expect(byCode['4011DUBOIS']).toEqual({ code: '4011DUBOIS', debit: '0.30', credit: '0.30' })

    // Its own export is compliant and keeps auxiliary accounts and lettrage
    const fy = await prisma.fiscalYear.findFirstOrThrow({ where: { companyId: target.id } })
    const exported = await fecExport.exportFec(target.id, fy.id)
    const report = validator.validateFec(exported.content)
    expect(report.errors).toEqual([])
    expect(report.stats.numbering).toBe('journal')
    expect(exported.content).toContain('\tCLI001\tCafé des Arts\tF240001\t20240312\tFacture F240001 Café des Arts\t1800,00\t0,00\tA\t20240415\t20240313\t\t\r\n')
    expect(exported.content.split('\r\n')[1].startsWith('AN\tA nouveaux\tAN-1\t20240101')).toBe(true)

    // The same file again: every entry already exists, nothing written
    const before = await counts(target.id)
    const second = await fecImport.importFEC({ companyId: target.id, bytes: fixture('other-software-2024.txt') })
    expect(second.success).toBe(false)
    expect(second.refused).toHaveLength(6)
    expect(second.refused?.[0].reason).toContain('existe déjà')
    expect(await counts(target.id)).toEqual(before)
  })

  it('imports nothing when one entry is unbalanced, and says which and why', async () => {
    const target = await company('444555666', 'desequilibre')
    const result = await fecImport.importFEC({ companyId: target.id, bytes: fixture('unbalanced-2024.txt') })
    expect(result.success).toBe(false)
    expect(result.entriesCreated).toBe(0)
    expect(result.refused).toEqual([{ entry: 'VT n° 2', line: 14, reason: 'écriture non équilibrée : débit 1234567,89, crédit 1234567,88' }])
    expect(result.errors[0]).toBe("1 écriture refusée : aucune écriture n'a été importée. Corrigez le fichier puis relancez l'import.")
    expect(await counts(target.id)).toEqual({ entries: 0, lines: 0, accounts: 0, journals: 0, fiscalYears: 0 })
  })

  it('refuses to import into a closed fiscal year', async () => {
    const target = await company('777888999', 'cloture')
    await prisma.fiscalYear.create({
      data: { companyId: target.id, year: 2024, startDate: new Date('2024-01-01T00:00:00Z'), endDate: new Date('2024-12-31T00:00:00Z'), isClosed: true },
    })
    const result = await fecImport.importFEC({ companyId: target.id, bytes: fixture('other-software-2024.txt') })
    expect(result.success).toBe(false)
    expect(result.refused?.every((r) => r.reason.includes("l'exercice 2024 est clôturé"))).toBe(true)
    expect((await counts(target.id)).entries).toBe(0)
  })
})
