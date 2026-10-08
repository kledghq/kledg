/**
 * Scheduled bank sync of every active bank integration (Qonto, Revolut
 * Business, Ponto). Called by /api/cron/sync-banks (and its former path
 * /api/cron/sync-qonto, kept for existing Vercel crons).
 *
 * It only reads what the providers hold: it never asks Ponto for a new bank
 * synchronization, which Ponto reserves to a user who is present
 * (https://documentation.myponto.com/custom-integrations). Ponto refreshes
 * from the banks four times a day by itself.
 */

import { timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { syncIntegration } from '@/lib/integrations/sync'
import { IntegrationFeature } from '@/lib/integrations/types'
import { getEncryptionKey } from '@/lib/crypto/encryption-key'
import { toErrorResponse } from '@/lib/api/errors'
import { errorReason } from '@/lib/banking/errors'
import { BANK_PROVIDERS } from '@/lib/banking/providers'
import { withSystemContext } from '@/lib/rls/context'
import { offloadExpenseReceiptsToQonto } from '@/lib/receipts/offload-to-qonto.service'
import { writeAuditLog } from '@/lib/audit'
import { withinRateLimit } from '@/lib/rate-limit'
import { bankSyncPause } from '@/lib/banking/sync-pause'

export interface BankSyncRunResult {
  companyId: string
  integrationId: string
  provider: string
  success: boolean
  itemsSynced: number
  errors: string[]
  /** Skipped: the company is read-only (lib/banking/sync-pause.ts); it catches up once writable. */
  paused?: boolean
}

/** Features read by the cron: Qonto keeps its former transactions-only run; the others also refresh balances and consent dates. */
function cronFeatures(provider: string): IntegrationFeature[] {
  return provider === 'QONTO'
    ? [IntegrationFeature.BANKING_TRANSACTIONS]
    : [IntegrationFeature.BANKING_ACCOUNTS, IntegrationFeature.BANKING_TRANSACTIONS]
}

/**
 * Runs without a user (row level security, docs/rls.md): the system context
 * lists the integrations of every company, then each sync runs narrowed to
 * its own company, so a sync can only read and write that company's rows,
 * and is recorded in that company's audit log.
 *
 * A read-only company (archived, or refused writes by the instance policy)
 * is skipped without calling its bank nor recording anything: its last sync
 * date stays, and the first run once it is writable again reads from that
 * date (issue #15, lib/banking/sync-pause.ts).
 */
export async function syncAllBankIntegrations(
  encryptionKey: string,
  options: { notSyncedSince?: Date } = {},
): Promise<BankSyncRunResult[]> {
  const stale = options.notSyncedSince
    ? { OR: [{ lastSyncAt: null }, { lastSyncAt: { lt: options.notSyncedSince } }] }
    : {}
  const integrations = await withSystemContext('cron:bank-sync', () =>
    prisma.integration.findMany({
      where: { provider: { in: [...BANK_PROVIDERS] }, status: 'active', type: 'BANKING', ...stale },
      select: { id: true, companyId: true, provider: true },
    }),
  )
  const results: BankSyncRunResult[] = []
  const paused = new Map<string, boolean>()
  for (const integration of integrations) {
    try {
      if (!paused.has(integration.companyId)) {
        const pause = await withSystemContext('cron:bank-sync', () => bankSyncPause(integration.companyId), {
          companyIds: [integration.companyId],
        })
        paused.set(integration.companyId, pause !== null)
      }
      if (paused.get(integration.companyId)) {
        results.push({ ...base(integration), success: true, itemsSynced: 0, errors: [], paused: true })
        continue
      }
      const result = await withSystemContext(
        'cron:bank-sync',
        async () => {
          const synced = await syncIntegration(integration.id, encryptionKey, cronFeatures(integration.provider), { maxDays: 30 })
          // Expense receipts handed to Qonto, when the instance opts in (lib/receipts/offload-to-qonto.service.ts); never fails the sync.
          if (integration.provider === 'QONTO' && synced.success) await offloadExpenseReceiptsToQonto(integration.companyId).catch(() => undefined)
          await writeAuditLog(synced.success ? 'info' : 'warn', 'Synchronisation bancaire planifiée', {
            action: 'cron.bank-sync',
            companyId: integration.companyId,
            metadata: { integrationId: integration.id, provider: integration.provider, itemsSynced: synced.itemsSynced },
            context: { userId: null },
          })
          return synced
        },
        { companyIds: [integration.companyId] },
      )
      results.push({ ...base(integration), success: result.success, itemsSynced: result.itemsSynced, errors: result.errors })
    } catch (error) {
      results.push({ ...base(integration), success: false, itemsSynced: 0, errors: [errorReason(error)] })
    }
  }
  return results
}

function base(integration: { id: string; companyId: string; provider: string }) {
  return { companyId: integration.companyId, integrationId: integration.id, provider: integration.provider }
}

/** Whether the request carries the CRON_SECRET bearer token (Vercel Cron). */
export function isCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const expected = Buffer.from(`Bearer ${secret}`)
  const received = Buffer.from(request.headers.get('authorization') ?? '')
  return received.length === expected.length && timingSafeEqual(received, expected)
}

/** Without CRON_SECRET, an integration synced less than this long ago is skipped. */
const KEYLESS_MIN_INTERVAL_MS = 20 * 3_600_000

/**
 * GET handler of the cron routes.
 *
 * With CRON_SECRET (Vercel Cron sends it as a bearer token), the caller is
 * trusted: every active bank integration is synced and the summary lists
 * each run.
 *
 * Without CRON_SECRET, the route still works so a fresh deployment needs no
 * secret to paste, but anyone may call it, so it can only do what the
 * schedule would do anyway: sync the integrations not synced for 20 hours,
 * at most four times a day for the whole instance, and answer with a count
 * only (no company, integration or error detail). Calling it early at worst
 * moves the daily sync forward.
 */
export async function handleBankSyncCron(request: Request): Promise<Response> {
  const keyless = !process.env.CRON_SECRET
  if (!keyless && !isCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const encryptionKey = getEncryptionKey()
    if (!encryptionKey) {
      return NextResponse.json({ error: 'Encryption key not configured' }, { status: 500 })
    }
    if (keyless) {
      if (!(await withinRateLimit('cron-keyless', 'instance'))) {
        return NextResponse.json({ success: true, synced: 0, skipped: 'rate-limited' })
      }
      const results = await syncAllBankIntegrations(encryptionKey, {
        notSyncedSince: new Date(Date.now() - KEYLESS_MIN_INTERVAL_MS),
      })
      return NextResponse.json({ success: true, synced: results.filter((r) => !r.paused).length })
    }
    const results = await syncAllBankIntegrations(encryptionKey)
    return NextResponse.json({ success: true, synced: results.filter((r) => !r.paused).length, results })
  } catch (error) {
    return toErrorResponse(error)
  }
}
