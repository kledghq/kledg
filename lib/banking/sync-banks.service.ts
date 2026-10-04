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

export interface BankSyncRunResult {
  companyId: string
  integrationId: string
  provider: string
  success: boolean
  itemsSynced: number
  errors: string[]
}

/** Features read by the cron: Qonto keeps its former transactions-only run; the others also refresh balances and consent dates. */
function cronFeatures(provider: string): IntegrationFeature[] {
  return provider === 'QONTO'
    ? [IntegrationFeature.BANKING_TRANSACTIONS]
    : [IntegrationFeature.BANKING_ACCOUNTS, IntegrationFeature.BANKING_TRANSACTIONS]
}

export async function syncAllBankIntegrations(encryptionKey: string): Promise<BankSyncRunResult[]> {
  const integrations = await prisma.integration.findMany({
    where: { provider: { in: [...BANK_PROVIDERS] }, status: 'active', type: 'BANKING' },
    select: { id: true, companyId: true, provider: true },
  })
  const results: BankSyncRunResult[] = []
  for (const integration of integrations) {
    try {
      const result = await syncIntegration(integration.id, encryptionKey, cronFeatures(integration.provider), {
        maxDays: 30,
      })
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

function isCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const expected = Buffer.from(`Bearer ${secret}`)
  const received = Buffer.from(request.headers.get('authorization') ?? '')
  return received.length === expected.length && timingSafeEqual(received, expected)
}

/** GET handler of the cron routes: requires the CRON_SECRET bearer token (sent by Vercel Cron). */
export async function handleBankSyncCron(request: Request): Promise<Response> {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const encryptionKey = getEncryptionKey()
    if (!encryptionKey) {
      return NextResponse.json({ error: 'Encryption key not configured' }, { status: 500 })
    }
    const results = await syncAllBankIntegrations(encryptionKey)
    return NextResponse.json({ success: true, synced: results.length, results })
  } catch (error) {
    return toErrorResponse(error)
  }
}
