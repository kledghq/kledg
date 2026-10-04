/**
 * Read tool of the bank feeds: get_bank_sync_status, for the monthly
 * closing. Same rule as GET /api/banking/connections: the company guard
 * with banking:read, then lib/banking/list-bank-connections.service.ts,
 * which never loads credentials. Only the state is returned (provider,
 * status, last synchronization, consent expiry, error), never an IBAN or
 * provider data; the unreconciled transactions are counted per account.
 */

import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import type { CompanyGuard } from '@/lib/mcp/company-access'
import { day, json, run } from '@/lib/mcp/tool-result'
import { READ_ONLY, describeTool } from '@/lib/mcp/tool-meta'
import { listBankConnections } from '@/lib/banking/list-bank-connections.service'
import { fromCents, toCents } from '@/lib/utils/money'

const iso = (d: Date | null) => d?.toISOString() ?? null

export function registerBankingReadTools(server: McpServer, guard: CompanyGuard) {
  server.registerTool(
    'get_bank_sync_status',
    {
      title: 'État des synchronisations bancaires',
      description: describeTool({
        summary:
          'State of the bank feeds of a company: each connection (Qonto, Revolut, Ponto, or MANUAL for statement files) with its status, last successful synchronization, last attempt and its error, expiry of the bank consent; each account with its name, whether it is synced, last synchronization and error, balance reported by the bank, and the number of transactions not yet reconciled with the date of the oldest. Use it to check that the books are fed up to date before a closing.',
        access: 'read',
        permission: { banking: ['read'] },
        amounts: 'euros',
        units: 'Timestamps as ISO 8601 (UTC), days as yyyy-mm-dd.',
        never: 'synchronizes a bank, returns credentials, IBANs or provider data, or changes a connection.',
      }),
      inputSchema: z.object({ companyId: z.string().describe('Company id, from list_companies.') }),
      annotations: READ_ONLY,
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { banking: ['read'] })
        const [connections, open] = await Promise.all([
          listBankConnections(args.companyId),
          prisma.bankTransaction.groupBy({
            by: ['bankAccountId'],
            where: { bankAccount: { bankConnection: { companyId: args.companyId } }, reconciled: false },
            _count: { _all: true },
            _min: { date: true },
          }),
        ])
        const unreconciled = new Map(open.map((row) => [row.bankAccountId, row]))
        return json({
          connections: connections.map((c) => ({
            id: c.id,
            provider: c.provider,
            status: c.status,
            lastSyncAt: iso(c.lastSyncAt),
            lastSyncAttemptAt: iso(c.lastSyncAttemptAt),
            lastSyncError: c.lastSyncError,
            consentExpiresAt: iso(c.consentExpiresAt),
            accounts: c.bankAccounts
              .filter((a) => !a.supersededById)
              .map((a) => {
                const pending = unreconciled.get(a.id)
                return {
                  id: a.id,
                  name: a.displayName || a.name,
                  currency: a.currency,
                  synced: a.shouldSync,
                  ledgerAccount: a.ledgerAccountCode,
                  lastSyncedAt: iso(a.lastSyncedAt),
                  lastSyncError: a.lastSyncError,
                  consentExpiresAt: iso(a.consentExpiresAt),
                  balance: fromCents(toCents(a.balance) ?? 0),
                  unreconciledTransactions: pending?._count._all ?? 0,
                  oldestUnreconciled: pending?._min.date ? day(pending._min.date) : null,
                }
              }),
          })),
        })
      }),
  )
}
