/**
 * Report, FEC and statement layout routes against PostgreSQL (session and
 * roles mocked): query strings and bodies are validated with French
 * messages, fiscal years, layout lines and templates of another company are
 * 404, exports are served as downloads. Skipped without the test database
 * server.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const ids = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('report_routes')
  return {} as Record<string, string>
})

vi.mock('@/lib/session', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'user-1', email: 'compta@example.com', name: null, role: null }),
}))
vi.mock('@/lib/rbac/authorize', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rbac/authorize')>('@/lib/rbac/authorize')
  // Member of the seeded company only.
  return {
    ...actual,
    getUserRolesForCompany: vi.fn(async (_userId: string, companyId: string) => (companyId === ids.company ? ['companyAdmin'] : [])),
    isGlobalAdmin: vi.fn().mockReturnValue(false),
  }
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { seedMembership } from '@/lib/__tests__/helpers/membership'

const available = await testDatabaseAvailable()

type Handler = (request: NextRequest, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
type Routes = Record<string, Handler>
let prisma: typeof import('@/lib/prisma').prisma
const routes = {} as Record<string, Routes>

function call(handler: Handler, method: string, path: string, body?: unknown, params: Record<string, string> = {}) {
  const request = new NextRequest(`http://localhost${path}`, {
    method,
    ...(body !== undefined && { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  })
  return handler(request, { params: Promise.resolve({ id: ids.company, ...params }) })
}

const errorOf = async (response: Response) => ((await response.json()) as { error: string }).error
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

async function seed() {
  const { createEntry } = await import('@/lib/accounting/services/entry-lifecycle.service')
  const company = await prisma.company.create({ data: { name: 'Atelier Été', slug: 'atelier', siren: '123456789' } })
  // The mocked session user is a member in the database too (row level security).
  await seedMembership(prisma, 'user-1', company.id)
  const other = await prisma.company.create({ data: { name: 'Autre', slug: 'autre', siren: '987654321' } })
  const fy = await prisma.fiscalYear.create({ data: { companyId: company.id, year: 2025, startDate: day('2025-01-01'), endDate: day('2025-12-31') } })
  const otherFy = await prisma.fiscalYear.create({ data: { companyId: other.id, year: 2025, startDate: day('2025-01-01'), endDate: day('2025-12-31') } })
  const journal = await prisma.journal.create({ data: { companyId: company.id, code: 'VE', label: 'Ventes' } })
  const account = async (code: string, label: string) =>
    (await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code, label } })).id
  const bank = await account('512000', 'Banque')
  const sales = await account('706000', 'Prestations de services')
  await createEntry({
    companyId: company.id,
    journalId: journal.id,
    date: '2025-03-10',
    description: 'Facture 1',
    reference: 'FA-1',
    status: 'validated',
    lines: [
      { accountId: bank, debit: '1200.10', credit: '0' },
      { accountId: sales, debit: '0', credit: '1200.10' },
    ],
  })
  const otherTemplate = await prisma.balanceSheetConfigTemplate.create({
    data: { companyId: other.id, name: 'Privé', reportVariant: 'complete', isPublic: false, configData: {} },
  })
  Object.assign(ids, { company: company.id, other: other.id, fy: fy.id, otherFy: otherFy.id, journal: journal.id, otherTemplate: otherTemplate.id })
}

describe.skipIf(!available)('report routes', () => {
  beforeAll(async () => {
    await prepareTestDatabase('report_routes')
    ;({ prisma } = await import('@/lib/prisma'))
    const modules: Record<string, Promise<unknown>> = {
      trialBalance: import('@/app/api/reports/trial-balance/route'),
      grandLivre: import('@/app/api/reports/grand-livre/route'),
      journal: import('@/app/api/reports/journal/route'),
      journalExcel: import('@/app/api/reports/journal/export-excel/route'),
      depreciation: import('@/app/api/reports/depreciation/route'),
      fec: import('@/app/api/fec/route'),
      balanceSheet: import('@/app/api/companies/[id]/balance-sheet/route'),
      compare: import('@/app/api/companies/[id]/balance-sheet/compare/route'),
      check: import('@/app/api/companies/[id]/balance-sheet/validate-income-statement/route'),
      balanceSheetExcel: import('@/app/api/companies/[id]/balance-sheet/export-excel/route'),
      balanceSheetPdf: import('@/app/api/companies/[id]/balance-sheet/export-pdf/route'),
      incomeStatementPdf: import('@/app/api/companies/[id]/income-statement/export-pdf/route'),
      incomeStatement: import('@/app/api/companies/[id]/income-statement/route'),
      incomeStatementExcel: import('@/app/api/companies/[id]/income-statement/export-excel/route'),
      bsConfig: import('@/app/api/companies/[id]/balance-sheet/config/route'),
      bsDefault: import('@/app/api/companies/[id]/balance-sheet/config/default/route'),
      bsLine: import('@/app/api/companies/[id]/balance-sheet/config/line/route'),
      bsLineId: import('@/app/api/companies/[id]/balance-sheet/config/line/[lineId]/route'),
      bsHistory: import('@/app/api/companies/[id]/balance-sheet/config/history/route'),
      bsTemplates: import('@/app/api/companies/[id]/balance-sheet/config/templates/route'),
      isConfig: import('@/app/api/companies/[id]/income-statement/config/route'),
      isDefault: import('@/app/api/companies/[id]/income-statement/config/default/route'),
      isLine: import('@/app/api/companies/[id]/income-statement/config/line/route'),
      isLineId: import('@/app/api/companies/[id]/income-statement/config/line/[lineId]/route'),
    }
    for (const [name, load] of Object.entries(modules)) routes[name] = (await load) as Routes
    await seed()
  }, 60_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  describe('trial balance, general ledger and journal', () => {
    it('reads a period given by fiscal year or by calendar days', async () => {
      const byYear = await call(routes.trialBalance.GET, 'GET', `/api/reports/trial-balance?companyId=${ids.company}&fiscalYearId=${ids.fy}`)
      expect(byYear.status).toBe(200)
      const byDays = await call(routes.grandLivre.GET, 'GET', `/api/reports/grand-livre?companyId=${ids.company}&startDate=2025-03-01&endDate=2025-03-31`)
      expect(byDays.status).toBe(200)
      const ledger = (await byDays.json()) as { period: { startDate: string }; accounts: Array<{ account: { code: string }; entryLines: Array<{ reference: string }> }> }
      expect(ledger.period.startDate).toBe('2025-03-01T00:00:00.000Z')
      const bankLines = ledger.accounts.find((a) => a.account.code === '512000')?.entryLines ?? []
      expect(bankLines).toHaveLength(1)
    })

    it('refuses an invalid date or a period outside every fiscal year with a French 400', async () => {
      const invalid = await call(routes.trialBalance.GET, 'GET', `/api/reports/trial-balance?companyId=${ids.company}&startDate=demain`)
      expect(invalid.status).toBe(400)
      expect(await errorOf(invalid)).toBe('Date de début invalide : demain')

      const outside = await call(routes.grandLivre.GET, 'GET', `/api/reports/grand-livre?companyId=${ids.company}&startDate=2030-01-01`)
      expect(outside.status).toBe(400)
      expect(await errorOf(outside)).toBe('Aucun exercice comptable ne couvre cette période')

      const journal = await call(routes.journal.GET, 'GET', `/api/reports/journal?companyId=${ids.company}&startDate=x&endDate=2025-12-31`)
      expect(journal.status).toBe(400)
    })

    it('reads the journal report and exports it as a workbook', async () => {
      const report = await call(routes.journal.GET, 'GET', `/api/reports/journal?companyId=${ids.company}&journalId=all&startDate=2025-01-01&endDate=2025-12-31`)
      const data = (await report.json()) as { grandTotals: { debit: number } }
      expect(data.grandTotals.debit).toBe(1200.1)

      const file = await call(routes.journalExcel.GET, 'GET', `/api/reports/journal/export-excel?companyId=${ids.company}`)
      expect(file.status).toBe(200)
      expect(file.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      expect(file.headers.get('content-disposition')).toMatch(/^attachment; filename="Journal_Atelier__t__\d{4}-\d{2}-\d{2}\.xlsx"/)
      expect(file.headers.get('x-content-type-options')).toBe('nosniff')
    })

    it('reads the depreciation table, 404 on a fiscal year of another company', async () => {
      expect((await call(routes.depreciation.GET, 'GET', `/api/reports/depreciation?companyId=${ids.company}`)).status).toBe(200)
      const foreign = await call(routes.depreciation.GET, 'GET', `/api/reports/depreciation?companyId=${ids.company}&fiscalYearId=${ids.otherFy}`)
      expect(foreign.status).toBe(404)
      expect(await errorOf(foreign)).toBe('Exercice fiscal introuvable')
    })
  })

  describe('FEC', () => {
    it('serves the file of the fiscal year, or its compliance report', async () => {
      const file = await call(routes.fec.GET, 'GET', `/api/fec?companyId=${ids.company}&fiscalYearId=${ids.fy}`)
      expect(file.status).toBe(200)
      expect(file.headers.get('content-type')).toBe('text/plain; charset=utf-8')
      expect(file.headers.get('cache-control')).toBe('private, no-store')
      expect(file.headers.get('content-disposition')).toContain('123456789FEC20251231.txt')

      const report = await call(routes.fec.GET, 'GET', `/api/fec?companyId=${ids.company}&fiscalYearId=${ids.fy}&report=1`)
      expect(await report.json()).toMatchObject({ fileName: '123456789FEC20251231.txt', entries: 1, lines: 2, valid: true })
    })

    it('answers 404 for a fiscal year of another company', async () => {
      expect((await call(routes.fec.GET, 'GET', `/api/fec?companyId=${ids.company}&fiscalYearId=${ids.otherFy}`)).status).toBe(404)
    })
  })

  describe('balance sheet and income statement', () => {
    it('generates both statements of the fiscal year', async () => {
      const query = `?fiscalYearId=${ids.fy}&variant=simplified`
      for (const route of ['balanceSheet', 'incomeStatement', 'check']) {
        const response = await call(routes[route].GET, 'GET', `/api/companies/${ids.company}/x${query}`)
        expect(response.status, route).toBe(200)
      }
      const compare = await call(routes.compare.GET, 'GET', `/x?currentFiscalYearId=${ids.fy}&previousFiscalYearId=${ids.fy}`)
      expect(compare.status).toBe(200)
    })

    it('validates the query with French messages and hides fiscal years of other companies', async () => {
      const missing = await call(routes.balanceSheet.GET, 'GET', '/x')
      expect(missing.status).toBe(400)
      expect(await errorOf(missing)).toBe("fiscalYearId: fiscalYearId est requis : choisissez l'exercice")

      const variant = await call(routes.incomeStatement.GET, 'GET', `/x?fiscalYearId=${ids.fy}&variant=abrege`)
      expect(variant.status).toBe(400)
      expect(await errorOf(variant)).toBe('variant: Variante inconnue : complete ou simplified')

      const foreign = await call(routes.compare.GET, 'GET', `/x?currentFiscalYearId=${ids.fy}&previousFiscalYearId=${ids.otherFy}`)
      expect(foreign.status).toBe(404)
    })

    it('exports both statements as workbooks', async () => {
      const bs = await call(routes.balanceSheetExcel.GET, 'GET', `/x?fiscalYearId=${ids.fy}&previousFiscalYearId=${ids.fy}`)
      expect(bs.status).toBe(200)
      expect(bs.headers.get('content-disposition')).toMatch(/filename="Bilan_Atelier__t__/)
      expect((await bs.arrayBuffer()).byteLength).toBeGreaterThan(0)

      const is = await call(routes.incomeStatementExcel.GET, 'GET', `/x?fiscalYearId=${ids.fy}`)
      expect(is.headers.get('content-disposition')).toMatch(/filename="Compte_de_resultat_Atelier__t__/)

      expect((await call(routes.incomeStatementExcel.GET, 'GET', `/x?fiscalYearId=${ids.otherFy}`)).status).toBe(404)
    })

    it('exports both statements as PDF', { timeout: 30_000 }, async () => {
      for (const [route, prefix] of [['balanceSheetPdf', 'Bilan'], ['incomeStatementPdf', 'Compte_de_resultat']]) {
        const response = await call(routes[route].GET, 'GET', `/x?fiscalYearId=${ids.fy}`)
        expect(response.status, route).toBe(200)
        expect(response.headers.get('content-type')).toBe('application/pdf')
        expect(response.headers.get('content-disposition')).toMatch(new RegExp(`filename="${prefix}_Atelier__t__2025_`))
        expect(new TextDecoder().decode((await response.arrayBuffer()).slice(0, 5))).toBe('%PDF-')
      }
      expect((await call(routes.balanceSheetPdf.GET, 'GET', `/x?fiscalYearId=${ids.otherFy}`)).status).toBe(404)
    })
  })

  describe('balance sheet layout', () => {
    it('resets the layout, then creates, reads, updates and deletes a line', async () => {
      const reset = await call(routes.bsDefault.POST, 'POST', '/x', { variant: 'simplified' })
      expect(reset.status).toBe(201)
      const layout = (await (await call(routes.bsConfig.GET, 'GET', '/x?variant=simplified')).json()) as { lines: Array<{ id: string; children: unknown[] }> }
      expect(layout.lines.length).toBeGreaterThan(0)
      expect(layout.lines.some((l) => l.children.length > 0)).toBe(true)
      const parentId = layout.lines[0].id

      const created = await call(routes.bsLine.POST, 'POST', '/x', { reportVariant: 'simplified', parentId, lineLabel: 'Ligne test', accountCodes: ['512'], filterType: 'starts_with', order: 99 })
      expect(created.status).toBe(201)
      const line = (await created.json()) as { id: string; lineType: string; balanceType: string; section: string | null }
      expect(line).toMatchObject({ lineType: 'line', balanceType: 'debit' })
      ids.bsLine = line.id

      expect((await call(routes.bsLineId.GET, 'GET', '/x', undefined, { lineId: line.id })).status).toBe(200)
      const renamed = await call(routes.bsLineId.PATCH, 'PATCH', '/x', { lineLabel: 'Ligne renommée', order: 98 }, { lineId: line.id })
      expect(await renamed.json()).toMatchObject({ id: line.id, lineLabel: 'Ligne renommée', order: 98 })
    })

    it('refuses invalid lines with French messages', async () => {
      const noLabel = await call(routes.bsLine.POST, 'POST', '/x', { accountCodes: [] })
      expect(noLabel.status).toBe(400)
      expect(await errorOf(noLabel)).toBe('lineLabel: Le libellé de la ligne est requis')

      const unknownCode = await call(routes.bsLine.POST, 'POST', '/x', { lineLabel: 'x', accountCodes: ['999999'], filterType: 'exact' })
      expect(unknownCode.status).toBe(400)
      expect(await errorOf(unknownCode)).toMatch(/^Comptes inconnus : 999999/)

      const badType = await call(routes.bsLineId.PATCH, 'PATCH', '/x', { balanceType: 'both' }, { lineId: ids.bsLine })
      expect(badType.status).toBe(400)

      const unknownAction = await call(routes.bsConfig.POST, 'POST', '/x', { action: 'drop' })
      expect(unknownAction.status).toBe(400)
      expect(await errorOf(unknownAction)).toMatch(/Action inconnue/)
    })

    it('keeps the history of a line and restores a version', async () => {
      const snapshot = await call(routes.bsHistory.POST, 'POST', '/x', { action: 'create_snapshot', configId: ids.bsLine, changeReason: 'Avant essai' })
      expect(snapshot.status).toBe(201)
      expect(await snapshot.json()).toMatchObject({ configId: ids.bsLine, version: 1, changedBy: 'user-1', data: { lineLabel: 'Ligne renommée' } })

      const history = (await (await call(routes.bsHistory.GET, 'GET', `/x?configId=${ids.bsLine}`)).json()) as unknown[]
      expect(history).toHaveLength(1)
      expect((await call(routes.bsHistory.GET, 'GET', `/x?configId=${ids.bsLine}&version=1`)).status).toBe(200)
      const missing = await call(routes.bsHistory.GET, 'GET', `/x?configId=${ids.bsLine}&version=7`)
      expect(missing.status).toBe(404)
      expect(await errorOf(missing)).toBe('Version introuvable')

      const restored = await call(routes.bsHistory.POST, 'POST', '/x', { action: 'restore', configId: ids.bsLine, version: 1 })
      expect(restored.status).toBe(200)
      const restoredLine = (await restored.json()) as { id: string; version: number; lineLabel: string }
      expect(restoredLine).toMatchObject({ version: 2, lineLabel: 'Ligne renommée' })
      ids.bsLine = restoredLine.id
    })

    it('saves the layout as a template and applies it; a private template of another company is a 404', async () => {
      const created = await call(routes.bsTemplates.POST, 'POST', '/x', { action: 'create', name: 'Mon modèle', variant: 'simplified' })
      expect(created.status).toBe(201)
      const template = (await created.json()) as { id: string }
      const listed = (await (await call(routes.bsTemplates.GET, 'GET', '/x?variant=simplified')).json()) as Array<{ id: string }>
      expect(listed.map((t) => t.id)).toEqual([template.id])

      expect((await call(routes.bsTemplates.POST, 'POST', '/x', { action: 'apply', templateId: template.id })).status).toBe(200)
      const foreign = await call(routes.bsTemplates.POST, 'POST', '/x', { action: 'apply', templateId: ids.otherTemplate })
      expect(foreign.status).toBe(404)
      expect(await errorOf(foreign)).toBe('Modèle introuvable')
    })

    it('[KLEDG-R3-AUTHZ-01] refuses to publish a template to the other companies of the instance', async () => {
      const published = await call(routes.bsTemplates.POST, 'POST', '/x', { action: 'create', name: 'Officiel', variant: 'simplified', isPublic: true })
      expect(published.status).toBe(400)
      expect(await errorOf(published)).toBe(
        'Un modèle enregistré reste propre à la société\u00a0: seuls les modèles fournis par Kledg sont partagés entre les sociétés.',
      )
      expect(await prisma.balanceSheetConfigTemplate.count({ where: { name: 'Officiel' } })).toBe(0)
      const tooLong = await call(routes.bsTemplates.POST, 'POST', '/x', { action: 'create', name: 'x'.repeat(201), variant: 'simplified' })
      expect(tooLong.status).toBe(400)
    })

    it('answers 404 on a line of another company and deletes its own line', async () => {
      const foreignLine = await prisma.balanceSheetLineConfig.create({
        data: { companyId: ids.other, reportVariant: 'complete', lineLabel: 'Autre', accountCodes: [], balanceType: 'debit', order: 1 },
      })
      for (const method of ['GET', 'DELETE'] as const) {
        const response = await call(routes.bsLineId[method], method, '/x', undefined, { lineId: foreignLine.id })
        expect(response.status, method).toBe(404)
      }
      const reparent = await call(routes.bsLineId.PATCH, 'PATCH', '/x', { parentId: foreignLine.id }, { lineId: ids.bsLine })
      expect(reparent.status).toBe(404)

      const line = await prisma.balanceSheetLineConfig.findFirstOrThrow({ where: { companyId: ids.company, isActive: true } })
      expect(await (await call(routes.bsLineId.DELETE, 'DELETE', '/x', undefined, { lineId: line.id })).json()).toEqual({ success: true })
    })
  })

  describe('income statement layout', () => {
    it('creates the default layout on first read, then manages a line', async () => {
      const layout = (await (await call(routes.isConfig.GET, 'GET', '/x')).json()) as { lines: Array<{ id: string; section: string }> }
      expect(layout.lines.length).toBeGreaterThan(0)
      const parent = layout.lines[0]

      const created = await call(routes.isLine.POST, 'POST', '/x', { parentId: parent.id, lineLabel: 'Produits divers', accountCodes: ['758'] })
      expect(created.status).toBe(201)
      const line = (await created.json()) as { id: string; balanceType: string; filterType: string }
      expect(line).toMatchObject({ balanceType: 'credit', filterType: 'starts_with' })

      const full = await call(routes.isConfig.POST, 'POST', '/x', { lineLabel: 'Ligne complète', accountCodes: ['7'], balanceType: 'credit', order: 50 })
      expect(full.status).toBe(201)
      const incomplete = await call(routes.isConfig.POST, 'POST', '/x', { lineLabel: 'Sans comptes' })
      expect(incomplete.status).toBe(400)

      const patched = await call(routes.isLineId.PATCH, 'PATCH', '/x', { lineLabel: 'Autres produits' }, { lineId: line.id })
      expect(await patched.json()).toMatchObject({ lineLabel: 'Autres produits' })
      expect((await call(routes.isLineId.DELETE, 'DELETE', '/x', undefined, { lineId: line.id })).status).toBe(200)
      expect((await prisma.incomeStatementLineConfig.findUniqueOrThrow({ where: { id: line.id } })).isActive).toBe(false)

      expect((await call(routes.isDefault.POST, 'POST', '/x', { variant: 'complete' })).status).toBe(200)
      expect(await prisma.incomeStatementLineConfig.count({ where: { id: line.id } })).toBe(0)
    })

    it('answers 404 on a line or a parent of another company', async () => {
      const foreignLine = await prisma.incomeStatementLineConfig.create({
        data: { companyId: ids.other, reportVariant: 'complete', lineLabel: 'Autre', accountCodes: [], balanceType: 'credit', order: 1 },
      })
      expect((await call(routes.isLineId.GET, 'GET', '/x', undefined, { lineId: foreignLine.id })).status).toBe(404)
      const created = await call(routes.isLine.POST, 'POST', '/x', { parentId: foreignLine.id, lineLabel: 'x' })
      expect(created.status).toBe(404)
      expect(await errorOf(created)).toBe('Ligne parente introuvable')
    })
  })
})
