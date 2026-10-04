/**
 * Shared two-tenant seed and call helper for the security DB tests
 * (mass-assignment, business-logic, nested IDOR). Modeled on the seed of
 * lib/api/__tests__/authorization-matrix.test.ts, trimmed to what these tests
 * need: two companies A and B, a user per role, an open fiscal year, a chart,
 * a journal, a draft entry and a validated entry, a bank account with one
 * transaction, a rule and an integration.
 *
 * The session is mocked per test file; makeCall binds the request builder to
 * that file's session state and its route module map.
 */

import { NextRequest } from 'next/server'

export const USERS = {
  admin: { id: 'u-admin', email: 'admin@sec.local', name: 'Admin', role: 'admin' },
  companyAdmin: { id: 'u-cadmin', email: 'cadmin@sec.local', name: 'Company admin', role: 'user' },
  accountant: { id: 'u-accountant', email: 'accountant@sec.local', name: 'Accountant', role: 'user' },
  viewer: { id: 'u-viewer', email: 'viewer@sec.local', name: 'Viewer', role: 'user' },
  memberB: { id: 'u-member-b', email: 'b@sec.local', name: 'Member of B', role: 'user' },
} as const
export type Who = keyof typeof USERS | 'anonymous'

export type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
type Prisma = typeof import('@/lib/prisma').prisma

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const SECRET = 'qonto-secret-never-returned-0000'

export async function seedTenants(prisma: Prisma, ids: Record<string, string>): Promise<void> {
  for (const user of Object.values(USERS)) {
    await prisma.user.create({ data: { id: user.id, email: user.email, name: user.name ?? '', role: user.role } })
  }
  await seedCompany(prisma, ids, 'a', 'Atelier Alpha', 'atelier-alpha', '111111111')
  await seedCompany(prisma, ids, 'b', 'Bureau Beta', 'bureau-beta', '222222222')
  const members: Array<[string, string, string]> = [
    ['u-cadmin', 'org-a', 'companyAdmin'],
    ['u-accountant', 'org-a', 'accountant'],
    ['u-viewer', 'org-a', 'viewer'],
    ['u-member-b', 'org-b', 'companyAdmin'],
  ]
  for (const [userId, organizationId, role] of members) {
    await prisma.member.create({ data: { id: `m-${userId}`, userId, organizationId, role, createdAt: new Date() } })
  }
}

async function seedCompany(
  prisma: Prisma,
  ids: Record<string, string>,
  prefix: 'a' | 'b',
  name: string,
  slug: string,
  siren: string,
): Promise<void> {
  const company = await prisma.company.create({ data: { name, slug, siren, closingDay: 31, closingMonth: 12 } })
  await prisma.organization.create({
    data: { id: `org-${prefix}`, name, slug: `org-${slug}`, createdAt: new Date(), companyId: company.id },
  })
  const fy = await prisma.fiscalYear.create({
    data: { companyId: company.id, year: 2026, startDate: day('2026-01-01'), endDate: day('2026-12-31'), closingDay: 31, closingMonth: 12 },
  })
  const bank = await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code: '512000', label: 'Banque', isPCG: true } })
  const sales = await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code: '706000', label: 'Ventes', isPCG: true } })
  const spare = await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code: '471000', label: 'Attente', isPCG: true } })
  const journal = await prisma.journal.create({ data: { companyId: company.id, code: 'OD', label: 'Operations diverses' } })
  const entry = await prisma.accountingEntry.create({
    data: { companyId: company.id, fiscalYearId: fy.id, journalId: journal.id, entryNumber: '1', date: day('2026-03-01'), description: 'Vente', status: 'draft' },
  })
  await prisma.entryLine.createMany({
    data: [
      { accountingEntryId: entry.id, accountId: bank.id, accountFiscalYearId: fy.id, accountingEntryNumber: '1', debit: 100, credit: 0 },
      { accountingEntryId: entry.id, accountId: sales.id, accountFiscalYearId: fy.id, accountingEntryNumber: '1', debit: 0, credit: 100 },
    ],
  })
  // Lines are created while the entry is still a draft, then it is validated:
  // the immutability trigger refuses lines added to an already-validated entry.
  const validated = await prisma.accountingEntry.create({
    data: { companyId: company.id, fiscalYearId: fy.id, journalId: journal.id, entryNumber: '2', date: day('2026-03-02'), description: 'Validee', status: 'draft' },
  })
  await prisma.entryLine.createMany({
    data: [
      { accountingEntryId: validated.id, accountId: bank.id, accountFiscalYearId: fy.id, accountingEntryNumber: '2', debit: 50, credit: 0 },
      { accountingEntryId: validated.id, accountId: sales.id, accountFiscalYearId: fy.id, accountingEntryNumber: '2', debit: 0, credit: 50 },
    ],
  })
  await prisma.accountingEntry.update({ where: { id: validated.id }, data: { status: 'validated' } })
  const connection = await prisma.bankConnection.create({ data: { companyId: company.id, login: `login-${prefix}`, secretKeyEncrypted: 'encrypted-secret' } })
  const bankAccount = await prisma.bankAccount.create({ data: { bankConnectionId: connection.id, externalAccountId: `ext-${prefix}`, name: 'Compte courant' } })
  const transaction = await prisma.bankTransaction.create({
    data: { bankAccountId: bankAccount.id, externalTransactionId: `tx-${prefix}`, amount: 100, date: day('2026-03-05'), side: 'credit', label: 'Virement client' },
  })
  const rule = await prisma.transactionRule.create({
    data: { companyId: company.id, name: 'Regle', entryLines: { create: [{ accountCode: '706000', lineType: 'auto', amountType: 'full', order: 0 }] } },
  })
  const integration = await prisma.integration.create({
    data: { companyId: company.id, provider: 'QONTO', type: 'BANKING', name: 'Qonto', credentials: { login: `login-${prefix}`, secretKey: SECRET }, credentialsEncrypted: false },
  })
  Object.assign(ids, {
    [`${prefix}Company`]: company.id,
    [`${prefix}Slug`]: slug,
    [`${prefix}Fy`]: fy.id,
    [`${prefix}Account`]: bank.id,
    [`${prefix}Sales`]: sales.id,
    [`${prefix}Spare`]: spare.id,
    [`${prefix}Journal`]: journal.id,
    [`${prefix}Entry`]: entry.id,
    [`${prefix}Validated`]: validated.id,
    [`${prefix}Transaction`]: transaction.id,
    [`${prefix}BankAccount`]: bankAccount.id,
    [`${prefix}Rule`]: rule.id,
    [`${prefix}Integration`]: integration.id,
  })
}

export interface Call {
  route: Record<string, Handler>
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  params?: Record<string, string>
  body?: unknown
  form?: Record<string, string>
}

/** Binds a call() to the file's mutable session state (set to the acting user). */
export function makeCall(state: { user: unknown }): (who: Who, c: Call) => Promise<Response> {
  return async (who, c) => {
    state.user = who === 'anonymous' ? null : { ...USERS[who] }
    const handler = c.route[c.method]
    if (!handler) throw new Error(`${c.method} not exported by route`)
    const fields = c.form
    const form = new FormData()
    for (const [name, value] of Object.entries(fields ?? {})) form.set(name, value)
    const request = new NextRequest(`http://localhost${c.path}`, {
      method: c.method,
      ...(fields
        ? { body: form }
        : c.body !== undefined
          ? { body: JSON.stringify(c.body), headers: { 'content-type': 'application/json' } }
          : {}),
    })
    return handler(request, { params: Promise.resolve(c.params ?? {}) })
  }
}

export { SECRET }
