/**
 * Liasse fiscale against PostgreSQL (session mocked, roles from member rows):
 * - GET /api/reports/liasse: for a SARL at the régime simplifié, every table
 *   of the 2033 series with where it is prepared; 2033-D read from the
 *   validated entries (provisions, VAT without the settlement entry) and the
 *   provisions register (a non deductible provision in cadre I C), reconciled
 *   with the balance sheet (box 154); 2033-E from the income statement
 *   accounts and the headcount of the approval; 2033-F from the shareholders
 *   (never their birth data); 2065-SD from the impôt sur les sociétés
 *   worksheet;
 * - GET /api/reports/liasse/export: CSV and PDF with reports:export only;
 * - a company not subject to the impôt sur les sociétés gets no tables;
 * - a member of another company gets 404, a fiscal year of another company
 *   404, an anonymous request 401.
 *
 * Runs under KLEDG_RLS=enforce too (the whole suite does in CI).
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('liasse')
  return { user: null as null | { id: string; email: string; name: string; role: string | null } }
})

vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => state.user,
}))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import type { LiasseView } from '../build-liasse'
import { cellByBox, cellsOf, type LiasseForm } from '../cells'

const available = await testDatabaseAvailable()

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
type Prisma = typeof import('@/lib/prisma').prisma

let prisma: Prisma
const route = {} as Record<string, Record<string, Handler>>

const USERS = {
  owner: { id: 'u-owner', email: 'owner@test.local', name: 'Gérante', role: 'user' },
  accountant: { id: 'u-accountant', email: 'compta@test.local', name: 'Comptable', role: 'user' },
  viewer: { id: 'u-viewer', email: 'viewer@test.local', name: 'Associé', role: 'user' },
  outsider: { id: 'u-outsider', email: 'b@test.local', name: 'Autre société', role: 'user' },
} as const
type Who = keyof typeof USERS | 'anonymous'

const ids = {} as Record<string, string>
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

function call(who: Who, handler: Handler, path: string) {
  state.user = who === 'anonymous' ? null : { ...USERS[who] }
  return handler(new NextRequest(`http://localhost${path}`, { method: 'GET' }), { params: Promise.resolve({}) })
}

async function seed() {
  for (const user of Object.values(USERS)) {
    await prisma.user.create({ data: { id: user.id, email: user.email, name: user.name, role: user.role } })
  }
  const company = await prisma.company.create({
    data: { name: 'Atelier Lumen', slug: 'atelier-lumen', siren: '111111111', legalType: 'SARL', corporateTaxRegime: 'simplified', vatRegime: 'normal', foundationDate: day('2026-01-01'), shareCapital: 10000, totalShares: 1000, shareNominalValue: 10 },
  })
  const other = await prisma.company.create({ data: { name: 'Bureau Beta', slug: 'bureau-beta', siren: '222222222', legalType: 'SCI', corporateTaxRegime: 'income_tax' } })
  await prisma.organization.create({ data: { id: 'org-a', name: 'A', slug: 'org-a', createdAt: new Date(), companyId: company.id } })
  await prisma.organization.create({ data: { id: 'org-b', name: 'B', slug: 'org-b', createdAt: new Date(), companyId: other.id } })
  const members: Array<[string, string, string]> = [
    ['u-owner', 'org-a', 'companyAdmin'],
    ['u-accountant', 'org-a', 'accountant'],
    ['u-viewer', 'org-a', 'viewer'],
    ['u-outsider', 'org-b', 'companyAdmin'],
  ]
  for (const [userId, organizationId, role] of members) {
    await prisma.member.create({ data: { id: `m-${userId}`, userId, organizationId, role, createdAt: new Date() } })
  }
  const address = await prisma.address.create({ data: { companyId: company.id, street: '3 rue des Lilas', postalCode: '69001', city: 'Lyon' } })
  await prisma.company.update({ where: { id: company.id }, data: { headquartersAddressId: address.id } })
  await prisma.establishment.create({ data: { companyId: company.id, siret: '11111111100011', siren: '111111111', isMain: true } })

  // Shareholders: Camille 90 % (birth recorded), Léa 10 % (no birth data)
  const camille = await prisma.person.create({ data: { companyId: company.id, firstName: 'Camille', name: 'Martin', birthDate: day('1980-05-04'), birthCity: 'Lyon', birthDepartment: '69', addressId: address.id } })
  const lea = await prisma.person.create({ data: { companyId: company.id, firstName: 'Léa', name: 'Petit' } })
  await prisma.shareholder.create({ data: { companyId: company.id, type: 'PHYSICAL', personId: camille.id, sharePercentage: 90, numberOfShares: 900 } })
  await prisma.shareholder.create({ data: { companyId: company.id, type: 'PHYSICAL', personId: lea.id, sharePercentage: 10, numberOfShares: 100 } })

  const fy = await prisma.fiscalYear.create({ data: { companyId: company.id, year: 2026, startDate: day('2026-01-01'), endDate: day('2026-12-31') } })
  const otherFy = await prisma.fiscalYear.create({ data: { companyId: other.id, year: 2026, startDate: day('2026-01-01'), endDate: day('2026-12-31') } })
  await prisma.accountsApproval.create({ data: { companyId: company.id, fiscalYearId: fy.id, details: { size: { category: 'micro', employees: 2 } } } })

  const an = await prisma.journal.create({ data: { companyId: company.id, code: 'AN', label: 'À-nouveaux' } })
  const od = await prisma.journal.create({ data: { companyId: company.id, code: 'OD', label: 'Opérations diverses' } })
  const accounts: Record<string, string> = {}
  for (const [code, label] of [
    ['101000', 'Capital'],
    ['151100', 'Provisions pour litiges'],
    ['151400', 'Provisions pour amendes et pénalités'],
    ['411000', 'Clients'],
    ['445510', 'TVA à décaisser'],
    ['445660', 'TVA déductible sur autres biens et services'],
    ['445710', 'TVA collectée'],
    ['401000', 'Fournisseurs'],
    ['512000', 'Banque'],
    ['606000', 'Achats non stockés'],
    ['641000', 'Rémunérations du personnel'],
    ['681500', 'Dotations aux provisions'],
    ['706000', 'Prestations de services'],
  ]) {
    accounts[code] = (await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code, label } })).id
  }
  let n = 0
  const entry = async (journalId: string, date: string, lines: Array<[string, number, number]>) => {
    n++
    const e = await prisma.accountingEntry.create({
      data: { companyId: company.id, fiscalYearId: fy.id, journalId, entryNumber: String(n), date: day(date), description: `Écriture ${n}`, status: 'draft' },
    })
    await prisma.entryLine.createMany({
      data: lines.map(([code, debit, credit]) => ({ accountingEntryId: e.id, accountId: accounts[code], accountFiscalYearId: fy.id, accountingEntryNumber: String(n), debit, credit })),
    })
    await prisma.accountingEntry.update({ where: { id: e.id }, data: { status: 'validated' } })
    return e.id
  }
  // Opening: capital 10 000 €, a litigation provision of 1 000 €, bank 11 000 €
  await entry(an.id, '2026-01-01', [['512000', 11000, 0], ['101000', 0, 10000], ['151100', 0, 1000]])
  // Sales 200 000 € HT, VAT 40 000 €; purchases 30 000 € HT, VAT 6 000 €; salaries 50 000 €
  await entry(od.id, '2026-06-30', [['411000', 240000, 0], ['706000', 0, 200000], ['445710', 0, 40000]])
  await entry(od.id, '2026-07-31', [['606000', 30000, 0], ['445660', 6000, 0], ['401000', 0, 36000]])
  await entry(od.id, '2026-09-30', [['641000', 50000, 0], ['512000', 0, 50000]])
  // VAT return settled: clears 4457 and 44566, 34 000 € to pay (left out of 374 and 378)
  await entry(od.id, '2026-10-15', [['445710', 40000, 0], ['445660', 0, 6000], ['445510', 0, 34000]])
  // Year end: a fine provisioned for 750 € (not deductible, CGI art. 39, 2)
  const fineEntry = await entry(od.id, '2026-12-31', [['681500', 750, 0], ['151400', 0, 750]])

  const fine = await prisma.provision.create({
    data: { companyId: company.id, category: 'RISK_CHARGE', label: 'Amende contestée', justification: 'Procès-verbal du 12 novembre', accountCode: '151400', taxDeductible: false, openedOn: day('2026-11-12') },
  })
  await prisma.provisionAssessment.create({ data: { companyId: company.id, provisionId: fine.id, fiscalYearId: fy.id, amount: 750, entryId: fineEntry } })

  Object.assign(ids, { company: company.id, other: other.id, fy: fy.id, otherFy: otherFy.id })
}

describe.skipIf(!available)('liasse fiscale routes', () => {
  beforeAll(async () => {
    await prepareTestDatabase('liasse')
    ;({ prisma } = await import('@/lib/prisma'))
    route.liasse = (await import('@/app/api/reports/liasse/route')) as never
    route.liasseExport = (await import('@/app/api/reports/liasse/export/route')) as never
    await seed()
  }, 60_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  const q = (extra: Record<string, string> = {}) => new URLSearchParams({ companyId: ids.company, fiscalYearId: ids.fy, ...extra }).toString()
  let view: LiasseView
  const form = (id: string) => view.forms.find((f) => f.id === id) as LiasseForm
  const cents = (formId: string, box: string) => {
    const value = cellByBox(form(formId), box)?.value
    return value?.kind === 'amount' ? value.cents : null
  }

  it('lists the tables of the régime simplifié and prepares 2065, 2033-D to 2033-G', async () => {
    const response = await call('viewer', route.liasse.GET, `/api/reports/liasse?${q()}`)
    expect(response.status).toBe(200)
    view = (await response.json()) as LiasseView
    expect(view).toMatchObject({ status: 'ready', regime: 'simplified' })
    expect(view.tables.map((t) => `${t.number}:${t.status}`)).toEqual([
      '2065-SD:here',
      '2033-A-SD:page',
      '2033-B-SD:page',
      '2033-B-SD:page',
      '2033-C-SD:page',
      '2033-D-SD:here',
      '2033-E-SD:here',
      '2033-F-SD:here',
      '2033-G-SD:here',
    ])
    expect(view.forms.map((f) => f.id)).toEqual(['2065', '2033-D', '2033-E', '2033-F', '2033-G'])
  })

  it('reads 2033-D from the entries and the provisions register, reconciled with the balance sheet', () => {
    expect([cents('2033-D', '620'), cents('2033-D', '622'), cents('2033-D', '624'), cents('2033-D', '626')]).toEqual([100_000, 75_000, 0, 175_000])
    expect(cellByBox(form('2033-D'), '780')).toMatchObject({ value: { kind: 'amount', cents: 75_000 }, source: 'record' })
    expect(form('2033-D').checks.find((c) => c.id === 'balance-sheet-risk-charges')).toMatchObject({ ok: true })
    expect(form('2033-D').checks.find((c) => c.id === 'register-riskCharges')?.ok).toBe(false)
    // VAT of the year, the settlement entry left out
    expect([cents('2033-D', '374'), cents('2033-D', '378')]).toEqual([4_000_000, 600_000])
    // No deficit before a first exercice, none created by a profit
    expect([cents('2033-D', '982'), cents('2033-D', '860'), cents('2033-D', '870')]).toEqual([0, 0, 0])
  })

  it('computes 2033-E from the income statement and takes the headcount of the approval', () => {
    expect(cents('2033-E', '108')).toBe(20_000_000)
    expect(cents('2033-E', '121')).toBe(3_000_000)
    expect(cellByBox(form('2033-E'), '376')).toMatchObject({ source: 'answer', value: { kind: 'count', value: 2 } })
    expect(form('2033-E').required.value).toBe(true)
  })

  it('fills 2033-F from the shareholders without returning their personal data', () => {
    const f = form('2033-F')
    expect(cellByBox(f, '903')?.value).toEqual({ kind: 'count', value: 2 })
    expect(cellByBox(f, '904')?.value).toEqual({ kind: 'count', value: 1000 })
    expect(f.checks.find((c) => c.id.startsWith('identity-'))?.message).toContain('Léa Petit')
    const text = JSON.stringify(view)
    expect(text).not.toContain('1980-05-04')
    expect(cellsOf(form('2033-G')).find((x) => x.cell.box === '905')?.cell.value).toEqual({ kind: 'count', value: 0 })
  })

  it('takes the tax result of the impôt sur les sociétés worksheet on the 2065-SD', () => {
    const cover = form('2065')
    const result = cellsOf(cover).filter((x) => x.section.id === 'result').map((x) => [x.cell.label, x.cell.value])
    // 200 000 - 30 000 - 50 000 - 750 = 119 250 €, all at the normal rate until the reduced rate is confirmed
    const total = result.filter(([, v]) => v && (v as { kind: string }).kind === 'amount').reduce((s, [, v]) => s + (v as { cents: number }).cents, 0)
    expect(total).toBe(11_925_000)
    expect(cellsOf(cover).find((x) => x.cell.label === 'SIRET')?.cell.value).toEqual({ kind: 'text', value: '11111111100011' })
  })

  it('exports CSV and PDF to members with reports:export only', async () => {
    const csv = await call('accountant', route.liasseExport.GET, `/api/reports/liasse/export?${q({ format: 'csv' })}`)
    expect(csv.status).toBe(200)
    expect(csv.headers.get('content-type')).toContain('text/csv')
    const text = await csv.text()
    expect(text).toContain('2033-D-SD;I A. Relevé des provisions, amortissements dérogatoires;Provisions pour risques et charges;Montant à la fin de l')
    expect(text).toContain(';626;1750,00;Écritures;')
    const pdf = await call('owner', route.liasseExport.GET, `/api/reports/liasse/export?${q()}`)
    expect(pdf.status).toBe(200)
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-')
    expect((await call('viewer', route.liasseExport.GET, `/api/reports/liasse/export?${q()}`)).status).toBe(403)
  })

  it('has no tables for a company not subject to the impôt sur les sociétés, and refuses its export', async () => {
    const response = await call('outsider', route.liasse.GET, `/api/reports/liasse?${new URLSearchParams({ companyId: ids.other, fiscalYearId: ids.otherFy })}`)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: 'not-subject', tables: [], forms: [] })
    const exported = await call('outsider', route.liasseExport.GET, `/api/reports/liasse/export?${new URLSearchParams({ companyId: ids.other, fiscalYearId: ids.otherFy })}`)
    expect(exported.status).toBe(409)
  })

  it('prepares the tables of the régime réel normal from the same books', async () => {
    await prisma.company.update({ where: { id: ids.company }, data: { corporateTaxRegime: 'normal' } })
    try {
      const response = await call('viewer', route.liasse.GET, `/api/reports/liasse?${q()}`)
      expect(response.status).toBe(200)
      view = (await response.json()) as LiasseView
      expect(view.regime).toBe('normal')
      expect(view.forms.map((f) => f.id)).toEqual(['2065', '2056', '2057', '2058-B', '2058-C', '2059-E', '2059-F', '2059-G'])
      expect(view.tables.find((t) => t.id === '2059-A')).toMatchObject({ status: 'manual' })
      // 2056: litiges 1 000 € at the start, the fine 750 € (amendes et pénalités), dotations tied to 6815
      expect([cents('2056', '4A'), cents('2056', '4P'), cents('2056', 'UB'), cents('2056', 'UE')]).toEqual([100_000, 75_000, 75_000, 75_000])
      expect(form('2056').checks.find((c) => c.id === 'income-statement-dotations')).toMatchObject({ ok: true })
      // 2057: customers 2 400 €, suppliers 360 €, VAT to pay 340 €
      expect([cents('2057', 'UX'), cents('2057', '8B'), cents('2057', 'VW')]).toEqual([24_000_000, 3_600_000, 3_400_000])
      expect(cellByBox(form('2057'), 'VU')).toMatchObject({ source: 'manual' })
      // 2058-B: the non deductible fine in slot 8X; 2058-C: VAT of the year, no previous result to allocate
      expect(cents('2058-B', '8X')).toBe(75_000)
      expect([cents('2058-C', 'YY'), cents('2058-C', '0D')]).toEqual([4_000_000, 0])
      expect(cellByBox(form('2059-E'), 'YP')).toMatchObject({ source: 'answer' })
      expect(cellByBox(form('2059-F'), 'P2')?.value).toEqual({ kind: 'count', value: 2 })
    } finally {
      await prisma.company.update({ where: { id: ids.company }, data: { corporateTaxRegime: 'simplified' } })
    }
  })

  it('never reads another company: 404 for its member, 404 for a fiscal year of another company, 401 anonymous', async () => {
    expect((await call('outsider', route.liasse.GET, `/api/reports/liasse?${q()}`)).status).toBe(404)
    const foreignYear = new URLSearchParams({ companyId: ids.company, fiscalYearId: ids.otherFy }).toString()
    expect((await call('owner', route.liasse.GET, `/api/reports/liasse?${foreignYear}`)).status).toBe(404)
    expect((await call('anonymous', route.liasse.GET, `/api/reports/liasse?${q()}`)).status).toBe(401)
  })
})
