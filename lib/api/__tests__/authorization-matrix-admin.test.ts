/**
 * Authorization matrix: a company administrator, the routes every member may use (own preferences, expense reports, receipts, leaving a company) and reconciled entry dates. Cases and setup are shared by the matrix
 * files (./helpers/authorization-matrix.ts); this file runs on its own test
 * database, so the files run in parallel. Skipped when the test database
 * server is unreachable.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('matrix_admin')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
  // Routes that reach Qonto (invoice import) must never leave the machine: a closed local port answers at once
  process.env.QONTO_API_URL = 'http://127.0.0.1:9/v2'
  // Same for the other bank providers (Ponto institutions, Revolut), and any other host is refused below
  process.env.PONTO_API_URL = 'http://127.0.0.1:9'
  process.env.REVOLUT_API_URL = 'http://127.0.0.1:9'
})

vi.mock('@/lib/session', async () => {
  const { session } = await import('@/lib/api/__tests__/helpers/authorization-matrix')
  return { getCurrentUser: async () => session.user }
})

import { available, useMatrix, prisma, Who, ids, SECRET, Call, call, A, p, WRITES, READS, READS_LET_THROUGH, OWN_PREFERENCES, LEAVE_COMPANY } from './helpers/authorization-matrix'

describe.skipIf(!available)('authorization matrix', () => {
  const reseed = useMatrix('matrix_admin')

  describe('company admin of company A', () => {
    beforeAll(reseed)
    it('reads bank credentials masked, never the secret', async () => {
      const response = await call('companyAdmin', WRITES.find((c) => c.label === 'read bank credentials')!)
      expect(response.status).toBe(200)
      const text = await response.text()
      expect(text).not.toContain(SECRET)
      expect(text).toContain('9876')
    })

    it('never receives bank secrets in list responses', async () => {
      for (const c of READS.filter((r) => ['list integrations', 'list transactions'].includes(r.label))) {
        const text = await (await call('companyAdmin', c)).text()
        expect(text, c.label).not.toContain(SECRET)
        expect(text, c.label).not.toContain('encrypted-secret')
        expect(text, c.label).not.toContain('secretKeyEncrypted')
      }
    })

    it('manages bank connections without reading a secret back', async () => {
      for (const label of ['create integration', 'integration features', 'integration synced resources']) {
        const response = await call('companyAdmin', WRITES.find((c) => c.label === label)!)
        expect(response.status, label).toBeLessThan(300)
        const text = await response.text()
        expect(text, label).not.toContain('ponto-secret')
        expect(text, label).not.toContain(SECRET)
        expect(text, label).not.toContain('"credentials"')
      }
    })

    it('cannot delete the company (instance administrators only, books kept 10 years)', async () => {
      expect((await call('companyAdmin', WRITES.find((c) => c.label === 'delete company')!)).status).toBe(403)
      expect(await prisma.company.count({ where: { id: ids.aCompany } })).toBe(1)
    })

    it('cannot add a member directly nor change a role (instance administrators only)', async () => {
      expect((await call('companyAdmin', WRITES.find((c) => c.label === 'add member')!)).status).toBe(403)
      expect((await call('companyAdmin', WRITES.find((c) => c.label === 'change member role')!)).status).toBe(403)
    })

    it('removes a member of the company, never one of company B, and never leaves it without an administrator', async () => {
      await reseed()
      expect((await call('companyAdmin', WRITES.find((c) => c.label === 'remove member')!)).status).toBe(200)
      expect(await prisma.member.count({ where: { id: 'm-u-viewer' } })).toBe(0)
      // Company B's member through company A's URL: not found
      const foreign: Call = { label: 'remove foreign member', route: 'member', method: 'DELETE', path: () => `/api/companies/${A()}/members/m-u-member-b`, params: p({ id: A, memberId: () => 'm-u-member-b' }) }
      expect((await call('companyAdmin', foreign)).status).toBe(404)
      expect(await prisma.member.count({ where: { id: 'm-u-member-b' } })).toBe(1)
      // The only company administrator cannot leave
      expect((await call('companyAdmin', LEAVE_COMPANY)).status).toBe(409)
    })

    it('invites members by email and manages the invitations (issue #13)', async () => {
      for (const label of ['list invitations', 'invite member', 'resend invitation', 'revoke invitation']) {
        await reseed()
        expect((await call('companyAdmin', WRITES.find((c) => c.label === label)!)).status, label).toBeLessThan(300)
      }
      // Never the instance administrator role
      const asAdmin = { ...WRITES.find((c) => c.label === 'invite member')!, body: () => ({ email: 'boss@test.local', role: 'admin' }) }
      expect((await call('companyAdmin', asAdmin)).status).toBe(400)
    })

    it('manages the company settings', async () => {
      for (const label of ['create establishment', 'update shareholder', 'add tax regime', 'update deadline settings']) {
        expect((await call('companyAdmin', WRITES.find((c) => c.label === label)!)).status, label).toBeLessThan(300)
      }
    })

    it('cannot search the users of the instance (instance administrators only)', async () => {
      const search: Call = { label: 'users', route: 'users', method: 'GET', path: () => '/api/users?search=test' }
      expect((await call('companyAdmin', search)).status).toBe(403)
      expect((await call('anonymous', search)).status).toBe(401)
      expect((await call('admin', search)).status).toBe(200)
    })
  })

  describe('own appearance preferences (any signed-in user, no company)', () => {
    beforeAll(reseed)
    const appearance = (method: 'GET' | 'PUT', body?: unknown): Call => ({
      label: `appearance ${method}`,
      route: 'appearance',
      method,
      path: () => '/api/account/appearance',
      ...(body === undefined ? {} : { body: () => body }),
    })
    const read = async (who: Who) =>
      (await (await call(who, appearance('GET'))).json()) as { appearance: { palette: string; custom: { light: Record<string, string> } }; isDefault: boolean }

    it('anonymous: 401 on read and write', async () => {
      expect((await call('anonymous', appearance('GET'))).status).toBe(401)
      expect((await call('anonymous', appearance('PUT', { palette: 'pastel' }))).status).toBe(401)
      expect(await prisma.userPreference.count()).toBe(0)
    })

    it('every role saves its own colours, a viewer included (a preference, not a change to the books)', async () => {
      for (const who of ['viewer', 'accountant', 'companyAdmin', 'memberB', 'admin'] as const) {
        expect((await call(who, appearance('GET'))).status, who).toBe(200)
      }
      expect((await call('viewer', appearance('PUT', { palette: 'custom', base: 'sobre', custom: { light: { revenue: '#0072B2' }, dark: {} } }))).status).toBe(200)
      expect((await call('memberB', appearance('PUT', { palette: 'contraste' }))).status).toBe(200)
    })

    it("reads only one's own preferences: another user's choice never shows", async () => {
      const viewer = await read('viewer')
      expect(viewer).toMatchObject({ isDefault: false, appearance: { palette: 'custom', custom: { light: { revenue: '#0072b2' } } } })
      expect((await read('memberB')).appearance.palette).toBe('contraste')
      expect(await read('accountant')).toMatchObject({ isDefault: true, appearance: { palette: 'sobre' } })
      const rows = await prisma.userPreference.findMany({ select: { userId: true }, orderBy: { userId: 'asc' } })
      expect(rows.map((r) => r.userId)).toEqual(['u-member-b', 'u-viewer'])
    })

    it('cannot write for another user and refuses invalid colours', async () => {
      expect((await call('accountant', appearance('PUT', { palette: 'pastel', userId: 'u-viewer' }))).status).toBe(400)
      expect((await call('accountant', appearance('PUT', { palette: 'custom', custom: { light: { revenue: 'red' } } }))).status).toBe(400)
      expect((await call('accountant', appearance('PUT', { palette: 'neon' }))).status).toBe(400)
      expect((await read('viewer')).appearance.palette).toBe('custom')
      expect(await prisma.userPreference.count({ where: { userId: 'u-accountant' } })).toBe(0)
    })
  })

  describe('own display mode (any signed-in user, no company)', () => {
    beforeAll(reseed)
    const displayMode = (method: 'GET' | 'PUT', body?: unknown): Call => ({
      label: `display mode ${method}`,
      route: 'displayMode',
      method,
      path: () => '/api/account/display-mode',
      ...(body === undefined ? {} : { body: () => body }),
    })
    const read = async (who: Who) => (await (await call(who, displayMode('GET'))).json()) as { mode: string; chosen: boolean }

    it('anonymous: 401 on read and write', async () => {
      expect((await call('anonymous', displayMode('GET'))).status).toBe(401)
      expect((await call('anonymous', displayMode('PUT', { mode: 'simple' }))).status).toBe(401)
    })

    it('every role chooses its own mode, a viewer included (a display preference, it grants nothing)', async () => {
      for (const who of ['viewer', 'accountant', 'companyAdmin', 'memberB', 'admin'] as const) {
        expect((await call(who, displayMode('PUT', { mode: 'simple' }))).status, who).toBe(200)
        expect(await read(who), who).toEqual({ mode: 'simple', chosen: true })
      }
      // The simple mode changes no permission: a viewer in simple mode is refused every write
      for (const c of WRITES) expect((await call('viewer', c)).status, c.label).toBe(403)
    })

    it('cannot write for another user', async () => {
      expect((await call('accountant', displayMode('PUT', { mode: 'expert', userId: 'u-viewer' }))).status).toBe(400)
      expect((await read('viewer')).mode).toBe('simple')
    })
  })

  describe('own sidebar menu (any role, per company)', () => {
    beforeAll(reseed)
    const menu = (method: 'GET' | 'PUT', body?: unknown): Call => ({
      label: `sidebar menu ${method}`,
      route: 'sidebarPreferences',
      method,
      path: () => `/api/companies/${A()}/sidebar-preferences`,
      params: p({ id: A }),
      ...(body === undefined ? {} : { body: () => body }),
    })
    const read = async (who: Who) => (await (await call(who, menu('GET'))).json()) as { hiddenItems: string[]; hiddenGroups: string[] }

    it('anonymous: 401, member of B: 404 on read and write', async () => {
      expect((await call('anonymous', menu('GET'))).status).toBe(401)
      expect((await call('anonymous', menu('PUT', { hiddenItems: [], hiddenGroups: [] }))).status).toBe(401)
      expect((await call('memberB', menu('GET'))).status).toBe(404)
      expect((await call('memberB', menu('PUT', { hiddenItems: ['/journals'], hiddenGroups: [] }))).status).toBe(404)
      expect(await prisma.sidebarPreference.count()).toBe(0)
    })

    it('every role of A saves its own menu, a viewer included (a preference, it grants nothing)', async () => {
      const choices = { viewer: '/journals', accountant: '/budget', companyAdmin: '/tiers', admin: '/fiscal-years' } as const
      for (const [who, url] of Object.entries(choices) as [keyof typeof choices, string][]) {
        expect((await call(who, menu('PUT', { hiddenItems: [url], hiddenGroups: ['saisie'] }))).status, who).toBe(200)
      }
      for (const [who, url] of Object.entries(choices) as [keyof typeof choices, string][]) {
        expect(await read(who), who).toEqual({ hiddenItems: [url], hiddenGroups: ['saisie'] })
      }
      // A viewer with a menu is still refused every write
      for (const c of WRITES) expect((await call('viewer', c)).status, c.label).toBe(403)
    })

    it('cannot write for another user', async () => {
      expect((await call('accountant', menu('PUT', { hiddenItems: [], hiddenGroups: [], userId: 'u-viewer' }))).status).toBe(400)
      expect((await read('viewer')).hiddenItems).toEqual(['/journals'])
    })
  })

  describe('own expense reports (expenses:submit, every role)', () => {
    beforeAll(reseed)
    const lines = [{ date: '2026-03-10', label: 'Fournitures', category: 'SUPPLIES', amountInclTaxCents: 2_400, vatRateBp: 2000, receiptKind: 'INVOICE' }]
    const OWN: Call[] = [
      { label: 'create own expense report', route: 'expenseReports', method: 'POST', path: () => '/api/expense-reports', body: () => ({ companyId: A(), periodStart: '2026-03-01', periodEnd: '2026-03-31', lines }) },
      { label: 'update own draft', route: 'expenseReport', method: 'PATCH', path: () => `/api/expense-reports/${ids.aDraftReport}`, params: p({ id: () => ids.aDraftReport }), body: () => ({ periodStart: '2026-03-01', periodEnd: '2026-03-31', lines }) },
      { label: 'submit own draft', route: 'expenseWorkflow', method: 'POST', path: () => `/api/expense-reports/${ids.aDraftReport}/workflow`, params: p({ id: () => ids.aDraftReport }), body: () => ({ action: 'submit' }) },
    ]

    it.each(OWN.map((c) => [c.label, c] as const))('%s: anonymous 401, member of B 404', async (_label, c) => {
      expect((await call('anonymous', c)).status).toBe(401)
      expect((await call('memberB', c)).status).toBe(404)
    })

    it('a viewer records, edits and submits their own report, never validates it', async () => {
      const [create, update, submit] = OWN
      expect((await call('viewer', create)).status).toBe(201)
      expect((await call('viewer', update)).status).toBe(200)
      expect((await call('viewer', submit)).status).toBe(200)
      const validate = await call('viewer', { ...submit, body: () => ({ action: 'validate' }) })
      expect(validate.status).toBe(403)
      expect((await prisma.expenseReport.findUniqueOrThrow({ where: { id: ids.aDraftReport } })).status).toBe('SUBMITTED')
    })

    it("a viewer never reaches another person's report; a validator does", async () => {
      const own = await prisma.expenseClaimant.findFirstOrThrow({ where: { userId: 'u-viewer' } })
      await prisma.expenseClaimant.update({ where: { id: own.id }, data: { userId: 'u-accountant' } })
      try {
        const read: Call = { label: 'read', route: 'expenseReport', method: 'GET', path: () => `/api/expense-reports/${ids.aValidatedReport}`, params: p({ id: () => ids.aValidatedReport }) }
        expect((await call('viewer', read)).status).toBe(404)
        expect((await call('accountant', read)).status).toBe(200)
        const list = await call('viewer', { label: 'list', route: 'expenseReports', method: 'GET', path: () => `/api/expense-reports?companyId=${A()}` })
        expect(((await list.json()) as { items: unknown[] }).items).toEqual([])
      } finally {
        await prisma.expenseClaimant.update({ where: { id: own.id }, data: { userId: 'u-viewer' } })
      }
    })
  })

  describe('receipts photographed or dropped (expenses:submit, every role; attach banking:reconcile)', () => {
    /** A staged receipt of company `prefix` uploaded by `userId`, with its stored file. */
    async function stagedReceipt(prefix: 'a' | 'b', userId: string, seed: string): Promise<string> {
      const companyId = ids[`${prefix}Company`]
      const sha256 = Buffer.from(seed.padEnd(32, '0')).toString('hex').slice(0, 64)
      const file = await prisma.receiptFile.create({ data: { companyId, sha256, contentType: 'image/jpeg', size: 4, content: Buffer.from([0xff, 0xd8, 0xff, 0xe0]) } })
      const row = await prisma.stagedReceipt.create({ data: { companyId, fileId: file.id, sha256, fileName: `${seed}.jpg`, contentType: 'image/jpeg', size: 4, source: 'app', uploadedById: userId, expiresAt: new Date(Date.now() + 86_400_000) } })
      return row.id
    }

    beforeAll(async () => {
      await reseed()
      // A bank without receipt API: an attached receipt stays in Kledg (no Qonto call)
      await prisma.bankConnection.updateMany({ where: { companyId: { in: [ids.aCompany, ids.bCompany] } }, data: { provider: 'MANUAL' } })
      ids.aViewerReceipt = await stagedReceipt('a', 'u-viewer', 'viewer-one')
      ids.aViewerReceipt2 = await stagedReceipt('a', 'u-viewer', 'viewer-two')
      ids.aAccountantReceipt = await stagedReceipt('a', 'u-accountant', 'accountant')
      ids.bReceipt = await stagedReceipt('b', 'u-member-b', 'member-b')
    })

    const at = (id: () => string, suffix = '') => ({ path: () => `/api/receipts/staged/${id()}${suffix}`, params: p({ id }) })
    const FIELDS = { fields: { amountCents: 4_350, date: '2026-03-10', merchant: 'Boulangerie du Marché', paymentHint: 'personal_card' } }
    const matchOf = (id: () => string): Call => ({ label: 'match a staged receipt', route: 'stagedReceiptMatch', method: 'POST', ...at(id, '/match'), body: () => FIELDS })
    const attachOf = (id: () => string): Call => ({ label: 'attach a staged receipt', route: 'stagedReceiptAttach', method: 'POST', ...at(id, '/attach'), body: () => ({ transactionId: ids.aTransaction }) })
    const RECEIPTS: Call[] = [
      { label: 'list own staged receipts', route: 'stagedReceipts', method: 'GET', path: () => `/api/receipts/staged?companyId=${A()}` },
      { label: 'stage a receipt', route: 'stagedReceipts', method: 'POST', path: () => '/api/receipts/staged', form: () => ({ companyId: A(), note: 'sans fichier' }) },
      matchOf(() => ids.aViewerReceipt),
      attachOf(() => ids.aViewerReceipt),
      { label: 'expense report from a staged receipt', route: 'stagedReceiptExpense', method: 'POST', ...at(() => ids.aViewerReceipt, '/expense'), body: () => ({}) },
      { label: 'discard a staged receipt', route: 'stagedReceipt', method: 'DELETE', ...at(() => ids.aViewerReceipt2) },
    ]
    const [list, stage, match, attach, expense, discard] = RECEIPTS

    it.each(RECEIPTS.map((c) => [c.label, c] as const))('%s: anonymous 401, member of B 404', async (_label, c) => {
      expect((await call('anonymous', c)).status).toBe(401)
      expect((await call('memberB', c)).status).toBe(404)
    })

    it('a viewer stages, matches, prepares the expense report and discards their own receipts, never attaches one', async () => {
      expect((await call('viewer', list)).status).toBe(200)
      // No file: the 400 of the service, after the right was checked
      expect((await call('viewer', stage)).status).toBe(400)
      const matched = await call('viewer', match)
      expect(matched.status).toBe(200)
      expect(((await matched.json()) as { outcome: string }).outcome).toBe('none')
      expect((await call('viewer', attach)).status).toBe(403)
      expect(await prisma.attachment.count({ where: { bankTransactionId: ids.aTransaction } })).toBe(0)
      const created = await call('viewer', expense)
      expect(created.status, await created.clone().text()).toBe(201)
      const report = await prisma.expenseReport.findUniqueOrThrow({ where: { id: ((await created.json()) as { reportId: string }).reportId }, include: { claimant: true } })
      expect([report.status, report.claimant.userId]).toEqual(['DRAFT', 'u-viewer'])
      expect((await call('viewer', discard)).status).toBe(200)
      expect((await prisma.stagedReceipt.findUniqueOrThrow({ where: { id: ids.aViewerReceipt2 } })).status).toBe('discarded')
    })

    it("a viewer never reaches another member's receipt nor another company's; an accountant files it", async () => {
      expect((await call('viewer', matchOf(() => ids.aAccountantReceipt))).status).toBe(404)
      expect((await call('viewer', matchOf(() => ids.bReceipt))).status).toBe(404)
      const attachOther = attachOf(() => ids.aAccountantReceipt)
      expect((await call('accountant', attachOther)).status).toBe(200)
      const attachment = await prisma.attachment.findFirstOrThrow({ where: { bankTransactionId: ids.aTransaction } })
      expect(attachment.receiptFileId).not.toBeNull()
      // Retried: nothing more
      expect((await call('accountant', attachOther)).status).toBe(200)
      expect(await prisma.attachment.count({ where: { bankTransactionId: ids.aTransaction } })).toBe(1)
    })
  })

  describe('reads let through and own preferences (KLEDG-R3-AUTHZ-06)', () => {
    beforeAll(reseed)
    it.each([...READS_LET_THROUGH, ...OWN_PREFERENCES].map((c) => [c.label, c] as const))('%s: anonymous 401, member of B 404', async (_label, c) => {
      expect((await call('anonymous', c)).status).toBe(401)
      expect((await call('memberB', c)).status).toBe(404)
    })

    it.each(READS_LET_THROUGH.map((c) => [c.label, c] as const))('%s: allowed to the viewer by role (not 401/403)', async (_label, c) => {
      expect([401, 403]).not.toContain((await call('viewer', c)).status)
    })

    it.each(OWN_PREFERENCES.map((c) => [c.label, c] as const))('%s: the viewer saves their own', async (_label, c) => {
      expect((await call('viewer', c)).status).toBe(200)
    })

    it('a viewer deletes their own draft expense report, never a submitted one nor another company\'s', async () => {
      const remove = (id: string): Call => ({ label: 'delete expense report', route: 'expenseReport', method: 'DELETE', path: () => `/api/expense-reports/${id}`, params: () => ({ id }) })
      expect((await call('anonymous', remove(ids.aDraftReport))).status).toBe(401)
      expect((await call('memberB', remove(ids.aDraftReport))).status).toBe(404)
      expect((await call('viewer', remove(ids.bDraftReport))).status).toBe(404)
      expect([400, 403, 409]).toContain((await call('viewer', remove(ids.aSubmittedReport))).status)
      expect((await call('viewer', remove(ids.aDraftReport))).status).toBe(204)
      expect(await prisma.expenseReport.count({ where: { id: ids.aDraftReport } })).toBe(0)
    })
  })

  describe('leaving a company (any member, never the last administrator)', () => {
    beforeAll(reseed)
    it('anonymous 401, member of B 404, the viewer leaves', async () => {
      expect((await call('anonymous', LEAVE_COMPANY)).status).toBe(401)
      expect((await call('memberB', LEAVE_COMPANY)).status).toBe(404)
      expect((await call('viewer', LEAVE_COMPANY)).status).toBe(200)
      expect(await prisma.member.count({ where: { id: 'm-u-viewer' } })).toBe(0)
      expect((await call('viewer', LEAVE_COMPANY)).status).toBe(404)
    })
  })

  describe('reconciled entry dates', () => {
    beforeAll(reseed)
    it('only re-dates draft entries of the company, in an open fiscal year', async () => {
      const { followMovedTransactions } = await import('@/lib/banking/store-synced-transactions.service')
      // A: draft entry reconciled; B: validated entry reconciled
      await prisma.bankTransaction.update({ where: { id: ids.aTransaction }, data: { reconciled: true, reconciledWith: ids.aEntry } })
      await prisma.bankTransaction.update({ where: { id: ids.bTransaction }, data: { reconciled: true, reconciledWith: ids.bValidated } })
      const move = (id: string, from: string, to: string) => [{ id, from: new Date(from), to: new Date(to) }]

      // Another company's id passed with B's scope moves nothing, B's validated entry neither
      await prisma.$transaction((tx) => followMovedTransactions(tx, ids.bCompany, move(ids.aTransaction, '2026-03-01T00:00:00Z', '2026-03-05T00:00:00Z')))
      await prisma.$transaction((tx) => followMovedTransactions(tx, ids.bCompany, move(ids.bTransaction, '2026-03-02T00:00:00Z', '2026-03-05T00:00:00Z')))
      expect((await prisma.accountingEntry.findUnique({ where: { id: ids.aEntry } }))?.date.toISOString()).toBe('2026-03-01T00:00:00.000Z')
      expect((await prisma.accountingEntry.findUnique({ where: { id: ids.bValidated } }))?.date.toISOString()).toBe('2026-03-02T00:00:00.000Z')

      const moved = await prisma.$transaction((tx) => followMovedTransactions(tx, ids.aCompany, move(ids.aTransaction, '2026-03-01T00:00:00Z', '2026-03-05T00:00:00Z')))
      expect(moved).toBe(1)
      expect((await prisma.accountingEntry.findUnique({ where: { id: ids.aEntry } }))?.date.toISOString()).toBe('2026-03-05T00:00:00.000Z')

      // Set the date first: once the year is closed the database refuses any change.
      await prisma.accountingEntry.update({ where: { id: ids.aEntry }, data: { date: new Date('2026-03-01T00:00:00Z') } })
      await prisma.fiscalYear.update({ where: { id: ids.aFy }, data: { isClosed: true } })
      expect(await prisma.$transaction((tx) => followMovedTransactions(tx, ids.aCompany, move(ids.aTransaction, '2026-03-01T00:00:00Z', '2026-03-05T00:00:00Z')))).toBe(0)
    })
  })
})
