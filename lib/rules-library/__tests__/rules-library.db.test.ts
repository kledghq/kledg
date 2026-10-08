/**
 * The rules library against PostgreSQL (services, routes with the session
 * mocked, and the MCP tools through the real /api/mcp handler):
 * - suggestions: templates ranked by the company's uncovered transactions
 *   of the last 12 months, covered and older transactions left out;
 * - accounts mapped to the chart (a company's own subdivision preferred,
 *   PCG accounts of their own never taken), created only on request;
 * - duplicates: a template already added is refused, a close rule warned;
 * - copy from another company: only companies where the user may read
 *   rules, with the target's accounts, never a company the user (or the
 *   assistant's grant) cannot reach.
 *
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('rules_library')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL = 'http://localhost:3000'
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
  return { user: null as null | { id: string; email: string; name: string | null; role: string | null } }
})

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.user }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { withSystemContext } from '@/lib/rls/context'
import type { AccessLevel, CompanyAccess } from '@/lib/ai-access/access'

const available = await testDatabaseAvailable()

type Prisma = typeof import('@/lib/prisma').prisma
type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>

let prisma: Prisma
let library: typeof import('../manage-rule-templates.service')
let copy: typeof import('../copy-rules.service')
let userGroupAccess: typeof import('@/lib/management-fees/access').userGroupAccess
let mcp: Record<'POST', Handler>
let createApiKeyWithGrant: typeof import('@/lib/ai-access/create-api-key.service').createApiKeyWithGrant

const OWNER = { id: 'u-owner', email: 'owner@test.local', name: 'Owner', role: 'user' }
const STRANGER = { id: 'u-stranger', email: 'stranger@test.local', name: 'Stranger', role: 'user' }

const NOW = new Date('2026-06-30T12:00:00Z')
const ids = {} as Record<string, string>
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

/** Chart of company A: a subdivision 6262 of 626, PCG accounts 6271 and 6278 under 627, no 6511 nor 44551. */
const CHART_A: Array<[string, string, boolean]> = [
  ['44', 'État', true],
  ['445', 'État, taxes sur le chiffre d’affaires', true],
  ['4452', 'TVA due intracommunautaire', true],
  ['44566', 'TVA sur autres biens et services', true],
  ['512000', 'Banque', true],
  ['61', 'Services extérieurs', true],
  ['613', 'Locations', true],
  ['6135', 'Locations mobilières', true],
  ['62', 'Autres services extérieurs', true],
  ['626', 'Frais postaux et de télécommunications', true],
  ['6262', 'Télécommunications', false],
  ['627', 'Services bancaires', true],
  ['6271', 'Frais sur titres', true],
  ['6278', 'Autres frais et commissions', true],
  ['63', 'Impôts et taxes', true],
  ['635', 'Autres impôts', true],
  ['6351', 'Impôts directs', true],
  ['65', 'Autres charges de gestion courante', true],
  ['43', 'Sécurité sociale', true],
  ['431', 'Sécurité sociale', true],
]
/** Chart of company B: its own subdivision 651100 for software. */
const CHART_B: Array<[string, string, boolean]> = [
  ['44566', 'TVA sur autres biens et services', true],
  ['512000', 'Banque', true],
  ['6132', 'Locations immobilières', true],
  ['627', 'Services bancaires', true],
  ['65', 'Autres charges de gestion courante', true],
  ['651', 'Redevances', true],
  ['651100', 'Logiciels SaaS', false],
]

const SIRENS: Record<string, string> = { a: '123456782', b: '222222222', c: '333333333' }

async function seedCompany(prefix: string, members: Array<[string, string]>, chart: Array<[string, string, boolean]>) {
  const company = await prisma.company.create({ data: { name: `Société ${prefix.toUpperCase()}`, slug: `societe-${prefix}`, siren: SIRENS[prefix] } })
  await prisma.organization.create({ data: { id: `org-${prefix}`, name: company.name, slug: `org-${prefix}`, createdAt: new Date(), companyId: company.id } })
  for (const [userId, role] of members) {
    await prisma.member.create({ data: { id: `m-${prefix}-${userId}`, userId, organizationId: `org-${prefix}`, role, createdAt: new Date() } })
  }
  const fy = await prisma.fiscalYear.create({ data: { companyId: company.id, year: 2026, startDate: day('2026-01-01'), endDate: day('2026-12-31') } })
  for (const [code, label, isPCG] of chart) {
    const account = await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code, label, isPCG } })
    ids[`${prefix}:${code}`] = account.id
  }
  await prisma.journal.create({ data: { companyId: company.id, code: 'BQ', label: 'Banque' } })
  const connection = await prisma.bankConnection.create({ data: { companyId: company.id, login: `login-${prefix}`, secretKeyEncrypted: 'secret' } })
  const bankAccount = await prisma.bankAccount.create({ data: { bankConnectionId: connection.id, externalAccountId: `ext-${prefix}`, name: 'Compte courant' } })
  ids[`${prefix}Company`] = company.id
  ids[`${prefix}Fy`] = fy.id
  ids[`${prefix}Bank`] = bankAccount.id
}

async function transaction(prefix: string, n: number, date: string, label: string, side = 'debit', amount = 30) {
  await prisma.bankTransaction.create({
    data: { bankAccountId: ids[`${prefix}Bank`], externalTransactionId: `${prefix}-${n}`, amount, date: day(date), side, label },
  })
}

async function rule(prefix: string, name: string, value: string, accountCode: string) {
  const created = await prisma.transactionRule.create({
    data: {
      companyId: ids[`${prefix}Company`],
      name,
      conditions: { create: [{ conditionType: 'label', operator: 'contains', value }] },
      entryLines: { create: [{ accountCode, lineType: 'debit', amountType: 'full', order: 0, vatType: 'deductible', vatRate: 20, vatAccountCode: '44566' }] },
    },
  })
  ids[`${prefix}:rule:${name}`] = created.id
  return created
}

async function seed() {
  await prepareTestDatabase('rules_library')
  await withSystemContext('test', async () => {
    for (const user of [OWNER, STRANGER]) await prisma.user.create({ data: { id: user.id, email: user.email, name: user.name, role: user.role } })
    await seedCompany('a', [[OWNER.id, 'companyAdmin']], CHART_A)
    // In B the owner is only a viewer: may read its rules, not write there
    await seedCompany('b', [[OWNER.id, 'viewer']], CHART_B)
    await seedCompany('c', [[STRANGER.id, 'companyAdmin']], CHART_B)
    // A: three Orange debits, two OVH, one Qonto covered by a rule, one URSSAF, an SFR older than 12 months, an Orange credit
    let n = 0
    for (const date of ['2026-01-05', '2026-02-05', '2026-03-05']) await transaction('a', n++, date, 'PRLV SEPA ORANGE SA')
    for (const date of ['2026-04-02', '2026-05-02']) await transaction('a', n++, date, 'OVH SAS')
    await transaction('a', n++, '2026-05-10', 'QONTO')
    await transaction('a', n++, '2026-05-15', 'PRLV SEPA URSSAF ILE DE FRANCE')
    await transaction('a', n++, '2025-03-01', 'PRLV SEPA SFR')
    await transaction('a', n++, '2026-05-20', 'VIR ORANGE SA REMBOURSEMENT', 'credit')
    await rule('a', 'Frais Qonto', 'qonto', '627')
    await rule('b', 'Frais Qonto', 'qonto', '627')
    await rule('b', 'Abonnement Figma', 'figma', '651100')
    await rule('b', 'Loyer', 'loyer', '6132')
    await rule('c', 'Règle secrète', 'secret', '651100')
  })
}

const asOwner = <T>(fn: () => Promise<T>) => import('@/lib/rls/context').then(({ withUserContext }) => withUserContext(OWNER.id, fn))

const ROUTES = {
  templates: () => import('@/app/api/rule-templates/route'),
  template: () => import('@/app/api/rule-templates/[id]/route'),
  templateAccounts: () => import('@/app/api/rule-templates/[id]/accounts/route'),
  copy: () => import('@/app/api/transaction-rules/copy/route'),
}

async function route(module: keyof typeof ROUTES, method: 'GET' | 'POST', path: string, user: typeof OWNER | null, body?: unknown, params: Record<string, string> = {}) {
  state.user = user ? { ...user } : null
  const handlers = (await ROUTES[module]()) as unknown as Record<string, Handler>
  const request = new NextRequest(`http://localhost${path}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
  })
  const response = await handlers[method](request, { params: Promise.resolve(params) })
  return { status: response.status, body: (await response.json()) as Record<string, any> } // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function apiKey(level: AccessLevel, access: CompanyAccess = { allCompanies: true, companyIds: [] }): Promise<string> {
  return (await createApiKeyWithGrant({ ...OWNER }, `Clé ${level}`, access, level, 'automatic')).key
}

async function callTool(key: string, name: string, args: Record<string, unknown>) {
  const response = await mcp.POST(
    new Request('http://localhost:3000/api/mcp', {
      method: 'POST',
      headers: { 'x-api-key': key, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    }),
  )
  const text = await response.text()
  const raw = text.trim().startsWith('{') ? text : (text.split('\n').find((l) => l.startsWith('data: '))?.slice(6) ?? 'null')
  const body = JSON.parse(raw) as { result?: { content?: Array<{ text: string }>; isError?: boolean }; error?: { message: string } }
  const out = body.result?.content?.[0]?.text ?? body.error?.message ?? ''
  const ok = !body.result?.isError && !body.error
  return { ok, text: out, data: (ok ? JSON.parse(out) : {}) as Record<string, any> } // eslint-disable-line @typescript-eslint/no-explicit-any
}

describe.skipIf(!available)('rules library', () => {
  beforeAll(async () => {
    await prepareTestDatabase('rules_library')
    ;({ prisma } = await import('@/lib/prisma'))
    library = await import('../manage-rule-templates.service')
    copy = await import('../copy-rules.service')
    ;({ userGroupAccess } = await import('@/lib/management-fees/access'))
    mcp = (await import('@/app/api/mcp/route')) as unknown as Record<'POST', Handler>
    ;({ createApiKeyWithGrant } = await import('@/lib/ai-access/create-api-key.service'))
  }, 60_000)

  beforeEach(seed)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  describe('suggestions and statuses', () => {
    it('ranks templates by uncovered debits of the last 12 months', async () => {
      const result = await asOwner(() => library.listRuleTemplates(ids.aCompany, { now: NOW }))
      expect(result.suggestions.map((s) => [s.templateId, s.matchCount])).toEqual([
        ['orange', 3],
        ['ovhcloud', 2],
        ['urssaf', 1],
      ])
      expect(result.suggestions[0]).toMatchObject({ name: 'Orange (télécom)', example: 'PRLV SEPA ORANGE SA' })
      // 9 transactions, the SFR one is older than 12 months; the Qonto one is covered by a rule
      expect(result.analysis).toMatchObject({ since: '2025-06-30', analyzed: 8, covered: 1, truncated: false })
    })

    it('maps accounts to the chart: own subdivision preferred, PCG accounts of their own never taken', async () => {
      const result = await asOwner(() => library.listRuleTemplates(ids.aCompany, { now: NOW, suggestions: false }))
      const orange = result.templates.find((t) => t.id === 'orange')!
      expect(orange.accounts.find((a) => a.code === '626')).toMatchObject({ status: 'subdivision', mappedCode: '6262', ambiguous: false })
      const qonto = result.templates.find((t) => t.id === 'qonto-frais')!
      expect(qonto.accounts.find((a) => a.code === '627')).toMatchObject({ status: 'exact', mappedCode: '627' })
      const cfe = result.templates.find((t) => t.id === 'cfe')!
      expect(cfe.accounts[0]).toMatchObject({ code: '63511', status: 'missing', mappedCode: '6351' })
      expect(cfe.missingAccounts).toEqual([{ code: '63511', label: 'Contribution économique territoriale', parentCode: '6351' }])
    })

    it('warns about a close rule without calling the template added', async () => {
      const result = await asOwner(() => library.listRuleTemplates(ids.aCompany, { now: NOW, suggestions: false }))
      const qonto = result.templates.find((t) => t.id === 'qonto-frais')!
      expect(qonto.status.installed).toBeNull()
      expect(qonto.status.nearDuplicates).toEqual([{ ruleId: ids['a:rule:Frais Qonto'], ruleName: 'Frais Qonto', reason: 'labels' }])
    })
  })

  describe('adding a template', () => {
    it('prefills the editor with the ids of the chart, empty where nothing fits', async () => {
      const { prefill, template } = await asOwner(() => library.getRuleTemplatePrefill(ids.aCompany, 'microsoft'))
      expect(prefill.entryLines).toEqual([
        expect.objectContaining({ accountId: '', vatType: 'intracom', vatRateSource: 'fixed', vatRate: 20, vatAccountId: ids['a:44566'], vatAccount2Id: ids['a:4452'] }),
      ])
      expect(prefill.conditions).toEqual([
        { conditionType: 'side', operator: 'equals', value: 'debit', value2: '' },
        expect.objectContaining({ conditionType: 'label', operator: 'regex' }),
      ])
      expect(template.missingAccounts).toEqual([{ code: '6511', label: expect.stringContaining('Redevances'), parentCode: '65' }])
    })

    it('creates the missing accounts only when asked, under their parent', async () => {
      const created = await asOwner(() => library.createTemplateAccounts(ids.aCompany, 'microsoft'))
      expect(created).toEqual({ created: ['6511'] })
      const account = await prisma.account.findFirstOrThrow({ where: { companyId: ids.aCompany, code: '6511' } })
      expect(account.parentId).toBe(ids['a:65'])
      const { prefill } = await asOwner(() => library.getRuleTemplatePrefill(ids.aCompany, 'microsoft'))
      expect(prefill.entryLines[0].accountId).toBe(account.id)
    })

    it('adds the rule with the mapped accounts, then refuses the same rule again', async () => {
      const added = await asOwner(() => library.addRuleFromTemplate(ids.aCompany, 'orange'))
      expect(added.rule.entryLines.map((l) => [l.accountCode, l.vatType, l.vatRateSource, Number(l.vatRate), l.vatAccountCode])).toEqual([['6262', 'deductible', 'transaction', 20, '44566']])
      expect(added.rule.conditions.map((c) => c.conditionType)).toEqual(['side', 'label'])
      await expect(asOwner(() => library.addRuleFromTemplate(ids.aCompany, 'orange'))).rejects.toThrow('existe déjà (même nom)')
      const again = await asOwner(() => library.addRuleFromTemplate(ids.aCompany, 'orange', { allowDuplicate: true, name: 'Orange bis' }))
      expect(again.rule.name).toBe('Orange bis')
    })

    it('falls back to the parent account, or refuses an account that has neither parent nor creation', async () => {
      const cfe = await asOwner(() => library.addRuleFromTemplate(ids.aCompany, 'cfe'))
      expect(cfe.rule.entryLines[0].accountCode).toBe('6351')
      expect(cfe.fallbacks).toEqual([{ code: '63511', used: '6351' }])
      // 44551: 4455 is missing, 445 is a parent of 3 digits or more
      const tva = await asOwner(() => library.addRuleFromTemplate(ids.aCompany, 'dgfip-tva'))
      expect(tva.rule.entryLines[0].accountCode).toBe('445')
      // 444 has no parent of 3 digits and 44 cannot hold it silently: refused without createMissingAccounts
      await expect(asOwner(() => library.addRuleFromTemplate(ids.aCompany, 'dgfip-impot-societes'))).rejects.toThrow('aucun compte pour 444')
      const is = await asOwner(() => library.addRuleFromTemplate(ids.aCompany, 'dgfip-impot-societes', { createMissingAccounts: true }))
      expect(is.createdAccounts).toEqual(['444'])
      expect(is.rule.entryLines[0].accountCode).toBe('444')
    })

    it('answers 404 for a template that does not exist', async () => {
      await expect(asOwner(() => library.getRuleTemplatePrefill(ids.aCompany, 'nope'))).rejects.toThrow('Modèle de règle introuvable')
    })
  })

  describe('copy from another company', () => {
    it('lists only the companies where the user may read rules, with duplicate statuses', async () => {
      const sources = await asOwner(() => copy.listCopySources(userGroupAccess({ ...OWNER }), ids.aCompany))
      expect(sources.companies.map((c) => c.name)).toEqual(['Société B'])
      const rules = sources.companies[0].rules
      expect(rules.map((r) => r.name).sort()).toEqual(['Abonnement Figma', 'Frais Qonto', 'Loyer'])
      expect(rules.find((r) => r.name === 'Frais Qonto')!.status.installed).toMatchObject({ ruleName: 'Frais Qonto', reason: 'name' })
      expect(JSON.stringify(sources)).not.toContain('secrète')
    })

    it('copies rules inactive, with the accounts of the target, and skips the ones already there', async () => {
      const result = await asOwner(() =>
        copy.copyRulesFromCompany(userGroupAccess({ ...OWNER }), ids.aCompany, {
          sourceCompanyId: ids.bCompany,
          ruleIds: [ids['b:rule:Abonnement Figma'], ids['b:rule:Loyer'], ids['b:rule:Frais Qonto']],
          createMissingAccounts: true,
        }),
      )
      expect(result.copied.map((c) => c.name).sort()).toEqual(['Abonnement Figma', 'Loyer'])
      expect(result.skipped).toEqual([expect.objectContaining({ name: 'Frais Qonto', reason: expect.stringContaining('Déjà présente') })])
      // 651100 created with the source's label, 6132 created as the PCG account
      expect(result.createdAccounts.sort()).toEqual(['6132', '651100'])
      const created = await prisma.account.findFirstOrThrow({ where: { companyId: ids.aCompany, code: '651100' } })
      expect(created.label).toBe('Logiciels SaaS')
      const figma = await prisma.transactionRule.findFirstOrThrow({ where: { companyId: ids.aCompany, name: 'Abonnement Figma' }, include: { entryLines: true } })
      expect(figma.enabled).toBe(false)
      expect(figma.entryLines[0].accountCode).toBe('651100')
      // The source is untouched
      expect(await prisma.transactionRule.count({ where: { companyId: ids.bCompany } })).toBe(3)
    })

    it('never reads a company the user is not a member of, nor writes where the role does not allow it', async () => {
      const access = userGroupAccess({ ...OWNER })
      await expect(asOwner(() => copy.copyRulesFromCompany(access, ids.aCompany, { sourceCompanyId: ids.cCompany, ruleIds: [ids['c:rule:Règle secrète']] }))).rejects.toThrow('Société introuvable')
      // A rule id of another company passed with a readable source
      await expect(asOwner(() => copy.copyRulesFromCompany(access, ids.aCompany, { sourceCompanyId: ids.bCompany, ruleIds: [ids['c:rule:Règle secrète']] }))).rejects.toThrow('Règle introuvable')
      // Into B, where the owner is a viewer
      await expect(asOwner(() => copy.copyRulesFromCompany(access, ids.bCompany, { sourceCompanyId: ids.aCompany, ruleIds: [ids['a:rule:Frais Qonto']] }))).rejects.toThrow('Action non autorisée')
      expect(await prisma.transactionRule.count({ where: { companyId: ids.aCompany } })).toBe(1)
    })
  })

  describe('routes', () => {
    it('serves the library and the copy with the rights of the rules routes', async () => {
      const list = await route('templates', 'GET', `/api/rule-templates?companyId=${ids.aCompany}`, OWNER)
      expect(list.status).toBe(200)
      expect(list.body.templates.length).toBeGreaterThanOrEqual(40)
      expect((await route('templates', 'GET', `/api/rule-templates?companyId=${ids.aCompany}`, STRANGER)).status).toBe(404)

      const one = await route('template', 'GET', `/api/rule-templates/orange?companyId=${ids.aCompany}`, OWNER, undefined, { id: 'orange' })
      expect(one.body.prefill.entryLines[0].accountId).toBe(ids['a:6262'])

      const accounts = await route('templateAccounts', 'POST', '/api/rule-templates/cfe/accounts', OWNER, { companyId: ids.aCompany }, { id: 'cfe' })
      expect(accounts).toEqual({ status: 201, body: { created: ['63511'] } })
      // In B the owner is a viewer
      expect((await route('templateAccounts', 'POST', '/api/rule-templates/cfe/accounts', OWNER, { companyId: ids.bCompany }, { id: 'cfe' })).status).toBe(403)

      const sources = await route('copy', 'GET', `/api/transaction-rules/copy?companyId=${ids.aCompany}`, OWNER)
      expect(sources.body.companies.map((c: { name: string }) => c.name)).toEqual(['Société B'])
      const copied = await route('copy', 'POST', '/api/transaction-rules/copy', OWNER, {
        companyId: ids.aCompany,
        sourceCompanyId: ids.bCompany,
        ruleIds: [ids['b:rule:Loyer']],
        createMissingAccounts: true,
        enabled: true,
      })
      expect(copied.status).toBe(201)
      expect(copied.body.copied).toEqual([expect.objectContaining({ name: 'Loyer' })])
      const audit = await prisma.auditLog.findFirst({ where: { action: 'COPY_TRANSACTION_RULES', companyId: ids.aCompany } })
      expect(audit?.metadata).toMatchObject({ sourceCompanyId: ids.bCompany })
    })
  })

  describe('MCP tools', () => {
    it('lists templates with suggestions at the read level', async () => {
      const key = await apiKey('read')
      const result = await callTool(key, 'list_rule_templates', { companyId: ids.aCompany, category: 'telecom' })
      expect(result.ok, result.text).toBe(true)
      expect(result.data.templates.map((t: { id: string }) => t.id)).toEqual(['orange', 'sfr', 'free', 'bouygues-telecom'])
      expect(result.data.templates[0].accounts[0]).toMatchObject({ code: '626', mappedCode: '6262' })
      expect(result.data.templates[0].samples).toBeUndefined()
      const one = await callTool(key, 'list_rule_templates', { companyId: ids.aCompany, templateId: 'github' })
      expect(one.data.template.vat.treatment).toBe('self-assessed')
      // Adding needs full control
      expect((await callTool(key, 'add_rule_from_template', { companyId: ids.aCompany, templateId: 'orange' })).ok).toBe(false)
    })

    it('adds a template and copies rules at the level of create_rule, within the grant', async () => {
      const key = await apiKey('admin')
      const added = await callTool(key, 'add_rule_from_template', { companyId: ids.aCompany, templateId: 'orange' })
      expect(added.ok, added.text).toBe(true)
      expect(added.data.result).toMatchObject({ name: 'Orange (télécom)', entryLines: [expect.objectContaining({ accountCode: '6262' })] })
      const twice = await callTool(key, 'add_rule_from_template', { companyId: ids.aCompany, templateId: 'orange' })
      expect(twice.ok).toBe(false)
      expect(twice.text).toContain('existe déjà')

      const copied = await callTool(key, 'copy_rules_from_company', { companyId: ids.aCompany, sourceCompanyId: ids.bCompany, ruleIds: [ids['b:rule:Abonnement Figma']], createMissingAccounts: true })
      expect(copied.ok, copied.text).toBe(true)
      expect(copied.data.result.copied).toHaveLength(1)

      // A connection granted company A only never reads B
      const onlyA = await apiKey('admin', { allCompanies: false, companyIds: [ids.aCompany] })
      const refused = await callTool(onlyA, 'copy_rules_from_company', { companyId: ids.aCompany, sourceCompanyId: ids.bCompany, ruleIds: [ids['b:rule:Loyer']] })
      expect(refused.ok).toBe(false)
      expect(refused.text).toBe('Société introuvable')
      const stranger = await callTool(key, 'copy_rules_from_company', { companyId: ids.aCompany, sourceCompanyId: ids.cCompany, ruleIds: [ids['c:rule:Règle secrète']] })
      expect(stranger.text).toBe('Société introuvable')
    })
  })
})
