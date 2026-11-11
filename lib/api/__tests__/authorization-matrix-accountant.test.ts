/**
 * Authorization matrix: an accountant of the company. Cases and setup are shared by the matrix
 * files (./helpers/authorization-matrix.ts); this file runs on its own test
 * database, so the files run in parallel. Skipped when the test database
 * server is unreachable.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('matrix_accountant')
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

import { available, useMatrix, prisma, ids, call, A, p, WRITES, ACCOUNTANT_FORBIDDEN } from './helpers/authorization-matrix'

describe.skipIf(!available)('authorization matrix', () => {
  const reseed = useMatrix('matrix_accountant')

  describe('accountant of company A', () => {
    beforeAll(reseed)
    it.each(WRITES.filter((c) => ACCOUNTANT_FORBIDDEN.has(c.label)).map((c) => [c.label, c] as const))(
      '%s: 403',
      async (_label, c) => {
        expect((await call('accountant', c)).status).toBe(403)
      },
    )

    it.each(WRITES.filter((c) => !ACCOUNTANT_FORBIDDEN.has(c.label)).map((c) => [c.label, c] as const))(
      '%s: allowed by role (not 401/403/404)',
      async (_label, c) => {
        await reseed() // earlier writes may have deleted the rows this one uses
        expect([401, 403, 404]).not.toContain((await call('accountant', c)).status)
      },
    )

    it('cannot reconcile a transaction with an entry of company B', async () => {
      await reseed()
      const response = await call('accountant', {
        label: 'cross reconcile',
        route: 'reconcile',
        method: 'POST',
        path: () => `/api/transactions/${ids.aTransaction}/reconcile`,
        params: p({ id: () => ids.aTransaction }),
        body: () => ({ entryId: ids.bEntry }),
      })
      expect(response.status).toBe(404)
      expect((await prisma.bankTransaction.findUnique({ where: { id: ids.aTransaction } }))?.reconciledWith).toBeNull()
    })

    it("cannot record depreciation on company B's fiscal year nor link company B's entry", async () => {
      await reseed()
      const onForeignYear = await call('accountant', {
        label: 'cross depreciation',
        route: 'depreciationRecords',
        method: 'POST',
        path: () => `/api/fixed-assets/${ids.aFixedAsset}/depreciation`,
        params: p({ id: () => ids.aFixedAsset }),
        body: () => ({ fiscalYearId: ids.bFy, periodType: 'year', amount: 10 }),
      })
      expect(onForeignYear.status).toBe(404)
      const foreignEntry = await call('accountant', {
        label: 'cross link',
        route: 'depreciationRecord',
        method: 'PATCH',
        path: () => `/api/fixed-assets/${ids.aFixedAsset}/depreciation/${ids.aDepreciation}`,
        params: p({ id: () => ids.aFixedAsset, entryId: () => ids.aDepreciation }),
        body: () => ({ accountingEntryId: ids.bValidated }),
      })
      expect(foreignEntry.status).toBe(404)
      expect((await prisma.fixedAssetDepreciation.findUnique({ where: { id: ids.aDepreciation } }))?.accountingEntryId).toBeNull()
    })

    it("cannot read a report of company B's fiscal year", async () => {
      const response = await call('accountant', {
        label: 'cross balance sheet',
        route: 'balanceSheet',
        method: 'GET',
        path: () => `/api/companies/${A()}/balance-sheet?fiscalYearId=${ids.bFy}`,
        params: p({ id: A }),
      })
      expect(response.status).toBe(404)
    })

    it("cannot record an invoice for company B's tiers, nor a payment line of company B", async () => {
      await reseed()
      const crossTiers = await call('accountant', {
        label: 'cross tiers invoice',
        route: 'invoices',
        method: 'POST',
        path: () => '/api/invoices',
        body: () => ({ companyId: A(), direction: 'SALE', tiersId: ids.bTiers, number: 'X-1', issueDate: '2026-03-10', lines: [{ label: 'A', quantity: '1', unitPriceCents: 1000, vatRateBp: 0 }] }),
      })
      expect(crossTiers.status).toBe(404)
      expect(await prisma.invoice.count({ where: { number: 'X-1' } })).toBe(0)
      await prisma.entryLine.updateMany({ where: { id: ids.aInvoiceLine }, data: { letteringCode: null, letteringDate: null } })
      const crossPayment = await call('accountant', {
        label: 'cross payment',
        route: 'invoicePayments',
        method: 'POST',
        path: () => `/api/invoices/${ids.aPostedInvoice}/payments`,
        params: p({ id: () => ids.aPostedInvoice }),
        body: () => ({ entryLineId: ids.bPaymentLine }),
      })
      expect(crossPayment.status).toBe(404)
      expect(await prisma.invoicePayment.count()).toBe(0)
    })

    it("cannot settle company B's invoice from the simple mode income of company A", async () => {
      await reseed()
      const response = await call('accountant', {
        label: 'cross simple income',
        route: 'simpleConfirm',
        method: 'POST',
        path: () => `/api/simple/expenses/${ids.aTransaction}/confirm`,
        params: p({ id: () => ids.aTransaction }),
        body: () => ({ invoiceId: ids.bPostedInvoice }),
      })
      expect(response.status).toBe(404)
      expect((await prisma.bankTransaction.findUnique({ where: { id: ids.aTransaction } }))?.reconciled).toBe(false)
      expect(await prisma.simpleModeEntry.count()).toBe(0)
    })

    it('reads the document route of an invoice without a Qonto document as 404, never another company', async () => {
      const own = await call('viewer', { label: 'attachment', route: 'invoiceAttachment', method: 'GET', path: () => `/api/invoices/${ids.aPostedInvoice}/attachment`, params: p({ id: () => ids.aPostedInvoice }) })
      expect(own.status).toBe(404)
      expect(((await own.json()) as { error: string }).error).toMatch(/Aucun document/)
      const foreign = await call('memberB', { label: 'attachment', route: 'invoiceAttachment', method: 'GET', path: () => `/api/invoices/${ids.aPostedInvoice}/attachment`, params: p({ id: () => ids.aPostedInvoice }) })
      expect(foreign.status).toBe(404)
      expect(((await foreign.json()) as { error: string }).error).not.toMatch(/Aucun document/)
    })

    it("cannot create an entry with company B's journal or accounts", async () => {
      const response = await call('accountant', {
        label: 'cross entry',
        route: 'entries',
        method: 'POST',
        path: () => '/api/entries',
        body: () => ({
          companyId: A(),
          journalId: ids.bJournal,
          date: '2026-03-10',
          description: 'x',
          lines: [
            { accountId: ids.bAccount, debit: 10, credit: 0 },
            { accountId: ids.aAccount, debit: 0, credit: 10 },
          ],
        }),
      })
      expect(response.status).toBe(400)
      expect(await prisma.accountingEntry.count({ where: { companyId: A(), description: 'x' } })).toBe(0)
    })
  })
})
