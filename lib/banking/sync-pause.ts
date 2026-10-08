/**
 * Bank sync of read-only companies (GitHub issue #15).
 *
 * A company that is read-only, archived (lib/companies/archive-company.service.ts)
 * or refused writes by the instance policy (companyWriteRefusal,
 * lib/instance/policy.ts: an unpaid subscription, an ended contract), receives
 * no new bank operation: the daily sync (lib/banking/sync-banks.service.ts)
 * skips it, and syncIntegration (lib/integrations/sync.ts), the single path of
 * every manual refresh, connection and MCP tool, returns without calling the
 * bank. Nothing is recorded on the connection while the sync is paused, so its
 * last sync date stays where it was: once the company is writable again, the
 * next sync reads from that date (syncSince) and catches up the paused period.
 */

import { prisma } from '@/lib/prisma'
import { ARCHIVED_COMPANY_MESSAGE } from '@/lib/companies/archive-company.service'
import { companyWriteRefusal, type ActionRefusal } from '@/lib/instance'

export interface BankSyncPause {
  /** Why the company is read-only (French, safe to show). */
  reason: string
  /** The page that lifts it (an upgrade page), when the instance policy gives one. */
  link?: ActionRefusal['link']
}

/** Unknown or unreachable company: paused, never synced (fails closed). */
const UNKNOWN_COMPANY_REASON = 'Société introuvable.'

/** French sentence shown when a sync is skipped, followed by the reason. */
export function bankSyncPausedMessage(pause: BankSyncPause): string {
  return `Synchronisation bancaire suspendue : ${pause.reason} Elle reprendra d'elle-même dès que la société sera de nouveau modifiable, en rattrapant les opérations depuis la dernière synchronisation.`
}

/** Why the bank sync of `companyId` is paused, or null when it runs. */
export async function bankSyncPause(companyId: string): Promise<BankSyncPause | null> {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { archivedAt: true } })
  if (!company) return { reason: UNKNOWN_COMPANY_REASON }
  if (company.archivedAt) return { reason: ARCHIVED_COMPANY_MESSAGE }
  const refusal = await companyWriteRefusal(companyId)
  return refusal ? { reason: refusal.message, ...(refusal.link ? { link: refusal.link } : {}) } : null
}
