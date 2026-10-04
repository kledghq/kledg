import { handleBankSyncCron } from '@/lib/banking/sync-banks.service'

/**
 * Former path of the bank sync cron, kept so that existing Vercel crons and
 * self-hosted schedulers keep working. Same handler as /api/cron/sync-banks.
 */
export async function GET(request: Request) {
  return handleBankSyncCron(request)
}
