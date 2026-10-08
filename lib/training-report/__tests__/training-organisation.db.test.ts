/**
 * A training organisation against PostgreSQL (session mocked, roles from
 * member rows; skipped without the server; also run with KLEDG_RLS=enforce).
 * Clock: 5 April 2027. Fictitious data.
 *
 * - 2025: taxed sales 50 000 € (VAT collected) and exempt training 50 000 €
 *   (account 7062 set exempt): coefficient de taxation 50 %, the
 *   provisional coefficient of 2026 (BOI-TVA-DED-20-10-40, example 3).
 * - 2026: a purchase invoice of 1 000 € HT and 200 € VAT posts 100 € to
 *   44566 and 100 € to the charge; sales 60 000 € taxed to Atelier SAS and
 *   40 000 € of exempt training invoiced to an OPCO (line marked exempt,
 *   CGI art. 261, 4, 4° a, with its mention): definitive 60 %, VAT borne
 *   200 €, regularisation 20 € (200 x 10 %) as a draft on 31 March 2027
 *   (44566 / 758), declared on CA3 line 21 of March 2027.
 * - BPF of 2026: 60 000 € on line 1 (customer), 40 000 € on line e (CPF,
 *   assigned to the OPCO), frames saved, CSV export.
 * - Taxe sur les salaires 2026: 50 % of the 2025 receipts without a right
 *   to deduct, bases 30 000 € and 8 000 €: 3 088 €, 1 544 € after the
 *   rapport, décote 372 €, due 1 172 €; the 2502 in the calendar; draft
 *   6311 / 447.
 * - Routes for each role, another company's customer refused, invoice
 *   exemption rules and the database checks.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('training_organisation')
  return { user: null as null | { id: string; email: string; name: string; role: string | null } }
})

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.user }))
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn(async () => {}) }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { seedMembership } from '@/lib/__tests__/helpers/membership'
import type { VatDeductionView } from '@/lib/vat-deduction/load-vat-deduction.service'
import type { TrainingReportView } from '../load-training-report.service'
import type { PayrollTaxView } from '@/lib/payroll-tax/load-payroll-tax.service'

const available = await testDatabaseAvailable()

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
type Prisma = typeof import('@/lib/prisma').prisma
type Routes = Record<string, Record<string, Handler>>

let prisma: Prisma
let svc: typeof import('@/lib/accounting/services/entry-lifecycle.service')
let routes: Routes

const USERS = {
  owner: { id: 'u-of-owner', email: 'owner@of.test', name: 'Directrice', role: 'user' },
  accountant: { id: 'u-of-accountant', email: 'compta@of.test', name: 'Comptable', role: 'user' },
  viewer: { id: 'u-of-viewer', email: 'viewer@of.test', name: 'Associé', role: 'user' },
  outsider: { id: 'u-of-outsider', email: 'other@of.test', name: 'Autre', role: 'user' },
} as const
type Who = keyof typeof USERS | 'anonymous'

const NOW = new Date('2027-04-05T09:00:00Z')
const ACCOUNTS: Array<[string, string]> = [
  ['401000', 'Fournisseurs'],
  ['411000', 'Clients'],
  ['445660', 'TVA sur autres biens et services'],
  ['445710', 'TVA collectée'],
  ['512000', 'Banque'],
  ['6064', 'Fournitures administratives'],
  ['641000', 'Rémunérations du personnel'],
  ['706100', 'Formations intra'],
  ['706200', 'Formations financées'],
]

interface Seed {
  companyId: string
  fy: Record<number, string>
  accounts: Record<number, Record<string, string>>
  journals: Record<string, string>
  customers: Record<string, string>
  supplierId: string
}

let a: Seed
let b: Seed

async function seed(slug: string, siren: string): Promise<Seed> {
  const company = await prisma.company.create({ data: { name: slug, slug, siren, legalType: 'SAS', vatRegime: 'normal', partialVatDeduction: true } })
  const fy: Seed['fy'] = {}
  const accounts: Seed['accounts'] = {}
  for (const year of [2025, 2026, 2027]) {
    fy[year] = (await prisma.fiscalYear.create({ data: { companyId: company.id, year, startDate: new Date(`${year}-01-01T00:00:00Z`), endDate: new Date(`${year}-12-31T00:00:00Z`) } })).id
    accounts[year] = {}
    for (const [code, label] of ACCOUNTS) accounts[year][code] = (await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy[year], code, label } })).id
  }
  const journals: Seed['journals'] = {}
  for (const [code, label] of [['AC', 'Achats'], ['VE', 'Ventes'], ['BQ', 'Banque'], ['OD', 'Opérations diverses']]) {
    journals[code] = (await prisma.journal.create({ data: { companyId: company.id, code, label } })).id
  }
  const customers: Seed['customers'] = {}
  for (const [aux, name] of [['C00001', 'Atelier SAS'], ['C00002', 'OPCO Atlas']]) {
    customers[aux] = (await prisma.tiers.create({ data: { companyId: company.id, kind: 'CUSTOMER', name, auxiliaryAccountNumber: aux } })).id
  }
  const supplierId = (await prisma.tiers.create({ data: { companyId: company.id, kind: 'SUPPLIER', name: 'Papeterie', auxiliaryAccountNumber: 'F00001', defaultAccountCode: '6064' } })).id
  await prisma.establishment.create({ data: { companyId: company.id, siret: `${siren}00011`, isMain: true, isTrainingOrganization: true, trainingActivityDeclarationNumber: '11755555575' } })
  return { companyId: company.id, fy, accounts, journals, customers, supplierId }
}

function call(who: Who, handler: Handler, method: string, path: string, body?: unknown, companyId = a.companyId) {
  state.user = who === 'anonymous' ? null : { ...USERS[who] }
  return handler(
    new NextRequest(`http://localhost${path}`, {
      method,
      ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
    }),
    { params: Promise.resolve({ id: companyId }) },
  )
}

async function json<T>(response: Response, status = 200): Promise<T> {
  const body = await response.json()
  expect(response.status, JSON.stringify(body)).toBe(status)
  return body as T
}

/** A validated sale: 411 (with the customer) / 706 / 44571 when taxed. */
async function sale(s: Seed, year: number, date: string, account: string, ht: number, vat: number, aux: string | null) {
  const acc = s.accounts[year]
  await svc.createEntry({
    companyId: s.companyId,
    journalId: s.journals.VE,
    date,
    description: 'Vente',
    status: 'validated',
    lines: [
      { accountId: acc['411000'], debit: String(ht + vat), credit: '0', auxiliaryAccountNumber: aux },
      { accountId: acc[account], debit: '0', credit: String(ht) },
      ...(vat ? [{ accountId: acc['445710'], debit: '0', credit: String(vat) }] : []),
    ],
  })
}

async function postAndValidate(companyId: string, invoiceId: string) {
  const { postInvoice } = await import('@/lib/invoices/post-invoice.service')
  const posted = await postInvoice(companyId, invoiceId)
  const result = await svc.validateEntries(companyId, [posted.entryId])
  expect(result.errors).toEqual([])
  return posted.entryId
}

describe.skipIf(!available)('training organisation (PostgreSQL)', () => {
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    await prepareTestDatabase('training_organisation')
    ;({ prisma } = await import('@/lib/prisma'))
    svc = await import('@/lib/accounting/services/entry-lifecycle.service')
    routes = {
      vat: (await import('@/app/api/companies/[id]/vat-deduction/route')) as unknown as Routes[string],
      regul: (await import('@/app/api/companies/[id]/vat-deduction/regularisation/route')) as unknown as Routes[string],
      bpf: (await import('@/app/api/companies/[id]/training-report/route')) as unknown as Routes[string],
      origins: (await import('@/app/api/companies/[id]/training-report/origins/route')) as unknown as Routes[string],
      bpfExport: (await import('@/app/api/companies/[id]/training-report/export/route')) as unknown as Routes[string],
      payroll: (await import('@/app/api/companies/[id]/payroll-tax/route')) as unknown as Routes[string],
      payrollEntries: (await import('@/app/api/companies/[id]/payroll-tax/entries/route')) as unknown as Routes[string],
    }
    a = await seed('of-a', '980000201')
    b = await seed('of-b', '980000202')
    for (const [who, role] of [['owner', 'companyAdmin'], ['accountant', 'accountant'], ['viewer', 'viewer']] as const) {
      await seedMembership(prisma, USERS[who].id, a.companyId, role)
    }
    await seedMembership(prisma, USERS.outsider.id, b.companyId, 'companyAdmin')

    // 2025: 50 000 € taxed, 50 000 € of exempt training (account 7062 set exempt below)
    await sale(a, 2025, '2025-06-30', '706100', 50_000, 10_000, 'C00001')
    await sale(a, 2025, '2025-06-30', '706200', 50_000, 0, 'C00002')
    expect((await call('accountant', routes.vat.PUT, 'PUT', '/x', { accounts: [{ accountCode: '7062', vatTreatment: 'exempt' }] })).status).toBe(200)
  })

  afterAll(async () => {
    vi.useRealTimers()
    await prisma?.$disconnect()
  })

  describe('coefficient de déduction (CGI ann. II art. 205 to 207)', () => {
    it('applies the provisional coefficient of the year before to a purchase invoice', async () => {
      const { createInvoice } = await import('@/lib/invoices/manage-invoices.service')
      const { vatDeductionShareOn } = await import('@/lib/vat-deduction/coefficient')
      expect(await vatDeductionShareOn(a.companyId, '2026-03-01')).toBe(0.5)
      const invoice = await createInvoice(a.companyId, {
        direction: 'PURCHASE',
        tiersId: a.supplierId,
        number: 'P-1',
        issueDate: '2026-03-01',
        typeCode: '380',
        lines: [{ label: 'Fournitures', quantity: '1', unitPriceCents: 100_000, vatRateBp: 2000, nature: 'GOODS', fixedAsset: false, accountCode: '6064' }],
      })
      const entryId = await postAndValidate(a.companyId, invoice.id)
      const lines = await prisma.entryLine.findMany({ where: { accountingEntryId: entryId }, select: { debit: true, credit: true, account: { select: { code: true } } } })
      const byCode = Object.fromEntries(lines.map((l) => [l.account.code, Number(l.debit) - Number(l.credit)]))
      expect(byCode).toEqual({ '401000': -1200, '6064': 1100, '445660': 100 })
    })

    it('marks training sales exempt with their mention, never on a taxed line, and refuses it elsewhere', async () => {
      const { createInvoice, getInvoice } = await import('@/lib/invoices/manage-invoices.service')
      const invoice = await createInvoice(a.companyId, {
        direction: 'SALE',
        tiersId: a.customers.C00002,
        number: 'F-2026-1',
        numbering: 'recorded',
        issueDate: '2026-09-30',
        typeCode: '380',
        lines: [{ label: 'Formation management', quantity: '1', unitPriceCents: 4_000_000, vatRateBp: 0, vatExemption: 'training', nature: 'SERVICES', fixedAsset: false, accountCode: '706200' }],
      })
      expect((await getInvoice(a.companyId, invoice.id)).vatExemptionMentions).toEqual([{ code: 'training', text: 'Exonération de TVA, article 261, 4, 4° a du CGI', positions: [1] }])
      await prisma.company.update({ where: { id: a.companyId }, data: { vatExemptionMention: 'TVA non applicable, art. 261-4-4° a du CGI' } })
      expect((await getInvoice(a.companyId, invoice.id)).vatExemptionMentions[0].text).toBe('TVA non applicable, art. 261-4-4° a du CGI')
      await postAndValidate(a.companyId, invoice.id)

      const taxed = await createInvoice(a.companyId, {
        direction: 'SALE',
        tiersId: a.customers.C00001,
        number: 'F-2026-2',
        numbering: 'recorded',
        issueDate: '2026-10-31',
        typeCode: '380',
        lines: [{ label: 'Conseil', quantity: '1', unitPriceCents: 6_000_000, vatRateBp: 2000, nature: 'SERVICES', fixedAsset: false, accountCode: '706100' }],
      })
      expect((await getInvoice(a.companyId, taxed.id)).vatExemptionMentions).toEqual([])
      await prisma.company.update({ where: { id: a.companyId }, data: { servicesVatOnDebits: true } })
      await postAndValidate(a.companyId, taxed.id)

      const line = { label: 'X', quantity: '1', unitPriceCents: 100, nature: 'SERVICES' as const, fixedAsset: false, vatExemption: 'training' as const }
      await expect(createInvoice(a.companyId, { direction: 'SALE', tiersId: a.customers.C00001, number: 'F-X', numbering: 'recorded', issueDate: '2026-11-01', typeCode: '380', lines: [{ ...line, vatRateBp: 2000 }] })).rejects.toThrow(/exonérée est à 0/)
      await expect(createInvoice(a.companyId, { direction: 'PURCHASE', tiersId: a.supplierId, number: 'P-X', issueDate: '2026-11-01', typeCode: '380', lines: [{ ...line, vatRateBp: 0 }] })).rejects.toThrow(/seule une vente/)
      // The database refuses an exemption on a taxed line whatever the path
      const someLine = await prisma.invoiceLine.findFirstOrThrow({ where: { invoiceId: taxed.id } })
      await expect(prisma.invoiceLine.update({ where: { id: someLine.id }, data: { vatExemption: 'training' } })).rejects.toThrow()
    })

    it('computes the definitive coefficient, the regularisation and its line of the return', async () => {
      const view = await json<VatDeductionView>(await call('viewer', routes.vat.GET, 'GET', '/x?year=2026'))
      expect(view).toMatchObject({ year: 2026, mode: 'coefficient', yearClosed: true, taxationPercent: 60, definitiveDeductionPercent: 60, provisional: { taxationPercent: 50, source: 'previous-year', deductionPercent: 50 } })
      expect(view.revenue).toMatchObject({ taxableCents: 6_000_000, exemptCents: 4_000_000, toClassifyCents: 0 })
      expect(view.regularisation).toMatchObject({ deductedCents: 10_000, incurredCents: 20_000, incurredSource: 'books', amountCents: 2_000, form: 'CA3', line: { code: '21', box: '0059' }, deadline: '2027-04-24', entryDate: '2027-03-31' })
      expect(view.coefficientLine).toBe('22A')
    })

    it('prepares the regularisation as an idempotent draft read on CA3 line 21', async () => {
      expect((await call('viewer', routes.regul.POST, 'POST', '/x', { year: 2026 })).status).toBe(403)
      const created = await json<{ status: string; entryId: string }>(await call('accountant', routes.regul.POST, 'POST', '/x', { year: 2026 }), 201)
      expect(created.status).toBe('created')
      expect((await json<{ status: string }>(await call('accountant', routes.regul.POST, 'POST', '/x', { year: 2026 }))).status).toBe('unchanged')
      const lines = await prisma.entryLine.findMany({ where: { accountingEntryId: created.entryId }, select: { debit: true, credit: true, account: { select: { code: true } } } })
      expect(lines.map((l) => [l.account.code, Number(l.debit), Number(l.credit)]).sort()).toEqual([
        ['445660', 20, 0],
        ['758', 0, 20],
      ])
      expect((await svc.validateEntries(a.companyId, [created.entryId])).errors).toEqual([])
      const { loadVatReturn } = await import('@/lib/vat-returns/load-vat-return.service')
      const march = await loadVatReturn(a.companyId, { period: '2027-03' }, NOW)
      const l21 = march.computation?.lines.find((l) => l.code === '21')
      const l20 = march.computation?.lines.find((l) => l.code === '20')
      expect(l21?.amountCents).toBe(2_000)
      expect(l20?.amountCents ?? 0).toBe(0)
      expect(march.deductionCoefficient).toMatchObject({ year: 2027, line: '22A', taxationPercent: 60 })
    })

    // R3 QUAL-02: the regularisation is definitive x VAT borne minus the VAT actually deducted
    // (CGI ann. II art. 207, I; BOI-TVA-DED-20-10-40, example 3)
    it('first year without an estimate: asks for the VAT borne, then regularises against the VAT actually deducted', async () => {
      const purchase = (date: string, vat: number) =>
        svc.createEntry({
          companyId: b.companyId,
          journalId: b.journals.AC,
          date,
          description: 'Achat',
          status: 'validated',
          lines: [
            { accountId: b.accounts[Number(date.slice(0, 4))]['6064'], debit: String(vat * 5), credit: '0' },
            { accountId: b.accounts[Number(date.slice(0, 4))]['445660'], debit: String(vat), credit: '0' },
            { accountId: b.accounts[Number(date.slice(0, 4))]['401000'], debit: '0', credit: String(vat * 6) },
          ],
        })
      // January: only taxed sales so far, the coefficient to date is 100 %: 1 000 € of VAT deducted in full
      await sale(b, 2026, '2026-01-15', '706100', 30_000, 6_000, 'C00001')
      await purchase('2026-01-20', 1_000)
      // The rest of the year: exempt training; definitive coefficient 60 %
      await sale(b, 2026, '2026-06-30', '706100', 30_000, 6_000, 'C00001')
      await sale(b, 2026, '2026-09-30', '706200', 40_000, 0, 'C00002')
      let view = await json<VatDeductionView>(await call('outsider', routes.vat.GET, 'GET', '/x?year=2026', undefined, b.companyId))
      expect(view).toMatchObject({ mode: 'coefficient', definitiveDeductionPercent: 60, provisional: { source: 'books-to-date', deductionPercent: 60 } })
      // The coefficient moved with the books: the VAT borne cannot be read back, Kledg proposed 0 before
      expect(view.regularisation).toMatchObject({ deductedCents: 100_000, incurredCents: null, amountCents: null })
      expect(view.hints.some((h) => h.includes('suivi les comptes'))).toBe(true)
      await json(await call('outsider', routes.vat.PUT, 'PUT', '/x', { year: 2026, incurredVatCents: 100_000 }, b.companyId))
      view = await json<VatDeductionView>(await call('outsider', routes.vat.GET, 'GET', '/x?year=2026', undefined, b.companyId))
      // 1 000 x 60 % - 1 000 = -400 €: VAT to pay back (CA3 line 15)
      expect(view.regularisation).toMatchObject({ incurredCents: 100_000, incurredSource: 'entered', amountCents: -40_000, line: { code: '15' } })

      // 2027: the coefficient d'assujettissement changes after a deduction: the VAT borne must be entered
      await purchase('2027-02-01', 100)
      await json(await call('outsider', routes.vat.PUT, 'PUT', '/x', { year: 2027, assujettissementPercent: 90 }, b.companyId))
      const marker = await prisma.vatDeductionYear.findUniqueOrThrow({ where: { companyId_year: { companyId: b.companyId, year: 2027 } }, select: { coefficientChangedOn: true } })
      expect(marker.coefficientChangedOn?.toISOString().slice(0, 10)).toBe('2027-04-05')
      view = await json<VatDeductionView>(await call('outsider', routes.vat.GET, 'GET', '/x?year=2027', undefined, b.companyId))
      expect(view.regularisation.incurredSource).toBeNull()
      expect(view.hints.some((h) => h.includes('05/04/2027'))).toBe(true)
      // A change before any deduction of the year leaves no marker
      await json(await call('outsider', routes.vat.PUT, 'PUT', '/x', { year: 2028, assujettissementPercent: 80 }, b.companyId))
      expect((await prisma.vatDeductionYear.findUniqueOrThrow({ where: { companyId_year: { companyId: b.companyId, year: 2028 } } })).coefficientChangedOn).toBeNull()
    })

    it('keeps full deduction for a company subject to VAT on everything', async () => {
      await prisma.company.update({ where: { id: b.companyId }, data: { partialVatDeduction: false } })
      const { vatDeductionShareOn } = await import('@/lib/vat-deduction/coefficient')
      expect(await vatDeductionShareOn(b.companyId, '2026-03-01')).toBeNull()
      await prisma.company.update({ where: { id: b.companyId }, data: { partialVatDeduction: true, vatRegime: 'franchise' } })
      expect(await vatDeductionShareOn(b.companyId, '2026-03-01')).toBe(0)
    })

    it('validates the settings and refuses other roles and companies', async () => {
      expect((await call('accountant', routes.vat.PUT, 'PUT', '/x', { estimatedTaxationPercent: 50 })).status).toBe(400)
      expect((await call('accountant', routes.vat.PUT, 'PUT', '/x', { year: 2026, assujettissementPercent: 101 })).status).toBe(400)
      expect((await call('accountant', routes.vat.PUT, 'PUT', '/x', { accounts: [{ accountCode: '411', vatTreatment: 'exempt' }] })).status).toBe(400)
      expect((await call('viewer', routes.vat.PUT, 'PUT', '/x', { partialVatDeduction: false })).status).toBe(403)
      expect((await call('outsider', routes.vat.GET, 'GET', '/x')).status).toBe(404)
      expect((await call('anonymous', routes.vat.GET, 'GET', '/x')).status).toBe(401)
    })
  })

  describe('bilan pédagogique et financier', () => {
    it('reads frame C from the books and the origins assigned', async () => {
      let view = await json<TrainingReportView>(await call('viewer', routes.bpf.GET, 'GET', '/x'))
      expect(view.fiscalYear?.year).toBe(2026)
      expect(view.deadline).toEqual({ date: '2027-04-29', extendedDate: null })
      expect(view.frameC?.unassignedCents).toBe(10_000_000)

      expect((await call('viewer', routes.origins.PUT, 'PUT', '/x', { accounts: [{ accountCode: '706', trainingOrigin: 'c1' }] })).status).toBe(403)
      await json(await call('accountant', routes.origins.PUT, 'PUT', '/x', { accounts: [{ accountCode: '706', trainingOrigin: 'c1' }], customers: [{ tiersId: a.customers.C00002, trainingOrigin: 'c2e' }] }))
      // Another company's customer is not found
      expect((await call('accountant', routes.origins.PUT, 'PUT', '/x', { customers: [{ tiersId: b.customers.C00001, trainingOrigin: 'c1' }] })).status).toBe(404)

      view = await json<TrainingReportView>(await call('viewer', routes.bpf.GET, 'GET', '/x'))
      const line = (code: string) => view.frameC?.lines.find((l) => l.code === code)?.euros
      expect([line('c1'), line('c2e'), view.frameC?.opcoTotalEuros, view.frameC?.totalEuros, view.frameC?.sharePercent, view.frameC?.unassignedCents]).toEqual([60_000, 40_000, 40_000, 100_000, 100, 0])
      expect(view.frameD?.total).toEqual({ euros: 1_100, source: 'books' })
    })

    it('saves the frames entered, checks them and exports the CSV', async () => {
      const fiscalYearId = a.fy[2026]
      const data = {
        distanceLearning: false,
        trainees: { employees: { count: 12, hours: 84 } },
        objectives: { other: { count: 12, hours: 84 } },
        specialities: [{ code: '310', label: 'Management', count: 12, hours: 84 }],
      }
      expect((await call('viewer', routes.bpf.PUT, 'PUT', '/x', { fiscalYearId, data })).status).toBe(403)
      expect((await call('accountant', routes.bpf.PUT, 'PUT', '/x', { fiscalYearId: b.fy[2026], data })).status).toBe(404)
      expect((await call('accountant', routes.bpf.PUT, 'PUT', '/x', { fiscalYearId, data: { specialities: [{ code: '31', label: 'X', count: 1, hours: 1 }] } })).status).toBe(400)
      await json(await call('accountant', routes.bpf.PUT, 'PUT', '/x', { fiscalYearId, data }))
      const view = await json<TrainingReportView>(await call('viewer', routes.bpf.GET, 'GET', `/x?fiscalYearId=${fiscalYearId}`))
      expect(view.totals.trainees).toEqual({ count: 12, hours: 84 })
      expect(view.checks).toEqual([])

      const file = await call('accountant', routes.bpfExport.GET, 'GET', `/x?fiscalYearId=${fiscalYearId}&format=csv`)
      expect(file.status).toBe(200)
      const csv = await file.text()
      expect(csv).toContain('C. Bilan financier hors taxes')
      expect(csv).toContain('60000')
      expect(file.headers.get('content-disposition')).toContain('BPF_2026')
      expect((await call('outsider', routes.bpf.GET, 'GET', '/x')).status).toBe(404)
    })

    it('lists the BPF in the deadline calendar of a training organisation', async () => {
      const { loadDeadlineContext } = await import('@/lib/deadlines/load-deadlines.service')
      const { computeDeadlines } = await import('@/lib/deadlines/engine')
      const context = await loadDeadlineContext(a.companyId)
      expect(context.trainingOrganisation).toBe(true)
      expect(computeDeadlines({ ...context, from: '2027-01-01', to: '2027-12-31' }).find((d) => d.id === 'bpf:2026-12-31')?.date).toBe('2027-04-29')
    })
  })

  describe('taxe sur les salaires (CGI art. 231)', () => {
    it('computes the tax of 2026 from the bases entered and the 2025 rapport, and puts the 2502 in the calendar', async () => {
      const data = { employees: [{ id: 'e1', label: 'Formatrice', baseCents: 3_000_000 }, { id: 'e2', label: 'Assistant', baseCents: 800_000 }] }
      expect((await call('viewer', routes.payroll.PUT, 'PUT', '/x', { year: 2026, data })).status).toBe(403)
      const saved = await json<{ computed: { liable: boolean; frequency: string; dueCents: number } }>(await call('accountant', routes.payroll.PUT, 'PUT', '/x', { year: 2026, data }))
      expect(saved.computed).toEqual({ liable: true, frequency: 'annual', dueCents: 117_200 })
      const view = await json<PayrollTaxView>(await call('viewer', routes.payroll.GET, 'GET', '/x?year=2026'))
      expect(view).toMatchObject({ liability: 'liable', ratio: { source: 'books', truncatedPercent: 50, appliedPercent: 50 }, computation: { grossCents: 308_800, afterRatioCents: 154_400, decoteCents: 37_200, dueCents: 117_200 } })
      expect(view.schedule).toEqual([{ key: '2026', label: 'Déclaration annuelle 2502 des salaires 2026', date: '2027-01-15', extendedDate: '2027-01-31' }])

      const { loadDeadlineContext } = await import('@/lib/deadlines/load-deadlines.service')
      const { computeDeadlines } = await import('@/lib/deadlines/engine')
      const context = await loadDeadlineContext(a.companyId)
      expect(computeDeadlines({ ...context, from: '2027-01-01', to: '2027-01-31' }).find((d) => d.id === 'ts-2502:2026')?.date).toBe('2027-01-15')
    })

    it('prepares the 6311 / 447 draft, idempotent', async () => {
      expect((await call('viewer', routes.payrollEntries.POST, 'POST', '/x', { year: 2026 })).status).toBe(403)
      const created = await json<{ status: string; entryId: string }>(await call('accountant', routes.payrollEntries.POST, 'POST', '/x', { year: 2026 }), 201)
      const lines = await prisma.entryLine.findMany({ where: { accountingEntryId: created.entryId }, select: { debit: true, credit: true, account: { select: { code: true } } } })
      expect(lines.map((l) => [l.account.code, Number(l.debit), Number(l.credit)]).sort()).toEqual([
        ['447', 0, 1172],
        ['6311', 1172, 0],
      ])
      expect((await json<{ status: string }>(await call('accountant', routes.payrollEntries.POST, 'POST', '/x', { year: 2026 }))).status).toBe('unchanged')
      expect((await call('outsider', routes.payroll.GET, 'GET', '/x')).status).toBe(404)
    })

    // R3 QUAL-24: the share entered keeps its decimals; 10,4 % is above 10 % (CGI art. 231, 1)
    it('reads an entered share of 10,4 % as liable, the rapport taking its whole part', async () => {
      const data = { employees: [{ id: 'e1', label: 'Formatrice', baseCents: 3_000_000 }], ratioPercent: 10.4 }
      await json(await call('accountant', routes.payroll.PUT, 'PUT', '/x', { year: 2027, data }))
      const view = await json<PayrollTaxView>(await call('viewer', routes.payroll.GET, 'GET', '/x?year=2027'))
      expect(view).toMatchObject({ liability: 'liable', ratio: { source: 'entered', exactBasisPoints: 1_040, truncatedPercent: 10, appliedPercent: 0 } })
      expect((await call('accountant', routes.payroll.PUT, 'PUT', '/x', { year: 2027, data: { ...data, ratioPercent: 10.444 } })).status).toBe(400)
      await json(await call('accountant', routes.payroll.PUT, 'PUT', '/x', { year: 2027, data: { ...data, ratioPercent: 10 } }))
      expect((await json<PayrollTaxView>(await call('viewer', routes.payroll.GET, 'GET', '/x?year=2027'))).liability).toBe('not-liable')
    })
  })
})
