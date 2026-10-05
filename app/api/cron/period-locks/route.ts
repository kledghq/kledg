import { handlePeriodLockCron } from '@/lib/accounting/period-lock/auto-lock.service'

/** Daily automatic period closing of the companies in monthly mode (Vercel Cron, CRON_SECRET bearer token). */
export async function GET(request: Request) {
  return handlePeriodLockCron(request)
}
