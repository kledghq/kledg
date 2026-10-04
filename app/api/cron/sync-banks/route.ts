import { handleBankSyncCron } from '@/lib/banking/sync-banks.service'

/** Daily sync of every bank integration (Vercel Cron, CRON_SECRET bearer token). */
export async function GET(request: Request) {
  return handleBankSyncCron(request)
}
