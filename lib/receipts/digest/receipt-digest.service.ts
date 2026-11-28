/**
 * The weekly email of the receipts still missing
 * (docs/justificatifs-email.md#récapitulatif-hebdomadaire): every Monday,
 * with the daily bank sync, each member who can attach receipts in a company
 * (expenses:submit and banking:reconcile) gets one email listing, per
 * company, the debits of the last DIGEST_DAYS days without a receipt, the
 * most recent first, with a link to its Justificatifs page.
 *
 * - Nothing is sent when nothing is missing, nor when the instance sends no
 *   email (lib/email).
 * - On by default; the user turns it off in Paramètres, Profil
 *   (UserPreference.receiptDigest). One a week at most
 *   (receiptDigestSentAt): a cron run twice, or the keyless cron called
 *   again, sends nothing more.
 * - Read in the system context (cron:receipt-digest): the members of every
 *   company, then each company's missing receipts in a context limited to
 *   that company.
 */

import { isEmailEnabled, sendEmail } from '@/lib/email'
import { receiptDigestEmail, type ReceiptDigestCompany } from '@/lib/email/templates'
import { getAppUrl } from '@/lib/config'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { rolesGrant } from '@/lib/rbac/authorize'
import { withSystemContext } from '@/lib/rls/context'
import { listMissingReceipts, MissingReceiptsQuerySchema } from '@/lib/banking/missing-receipts.service'
import { parisIsoDay } from '@/lib/utils/date'

export const DIGEST_DAYS = 30
const ROWS_PER_COMPANY = 5
/** Not twice within this: a little less than a week, so a Monday run a bit earlier than the last one still sends. */
const MIN_INTERVAL_MS = 6 * 86_400_000

const WEEKDAY = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', weekday: 'short' })

/** Monday in France: the day the digest goes. */
export function isDigestDay(now: Date): boolean {
  return WEEKDAY.format(now) === 'Mon'
}

const ATTACH = { expenses: ['submit'], banking: ['reconcile'] } as const

export interface DigestRun {
  sent: number
  /** Members with nothing missing, or who turned the email off, or got it this week. */
  skipped: number
  failed: number
}

/** Sends the week's digest. Never throws: a failure is logged and counted. */
export async function sendReceiptDigests(now: Date = new Date()): Promise<DigestRun> {
  const run: DigestRun = { sent: 0, skipped: 0, failed: 0 }
  if (!(await isEmailEnabled())) return run

  const members = await withSystemContext('cron:receipt-digest', () =>
    prisma.member.findMany({
      where: { organization: { company: { archivedAt: null } }, user: { banned: { not: true } } },
      select: {
        role: true,
        user: { select: { id: true, email: true, preference: { select: { receiptDigest: true, receiptDigestSentAt: true } } } },
        organization: { select: { company: { select: { id: true, slug: true, name: true } } } },
      },
    }),
  )

  // Each user, with the companies where they can attach receipts
  const users = new Map<string, { email: string; companies: Map<string, { id: string; slug: string; name: string }> }>()
  for (const m of members) {
    const company = m.organization.company
    const pref = m.user.preference
    if (!company || pref?.receiptDigest === false) continue
    if (pref?.receiptDigestSentAt && now.getTime() - pref.receiptDigestSentAt.getTime() < MIN_INTERVAL_MS) continue
    const roles = m.role.split(',').map((r) => r.trim()).filter(Boolean)
    if (!rolesGrant(roles, ATTACH)) continue
    const entry = users.get(m.user.id) ?? { email: m.user.email, companies: new Map() }
    entry.companies.set(company.id, company)
    users.set(m.user.id, entry)
  }

  const endDate = parisIsoDay(now)
  const startDate = parisIsoDay(new Date(now.getTime() - (DIGEST_DAYS - 1) * 86_400_000))
  const query = MissingReceiptsQuerySchema.parse({ startDate, endDate, side: 'debit', limit: ROWS_PER_COMPANY })
  const perCompany = new Map<string, ReceiptDigestCompany | null>()
  const missingOf = async (company: { id: string; slug: string; name: string }) => {
    if (!perCompany.has(company.id)) {
      try {
        const missing = await withSystemContext('cron:receipt-digest', () => listMissingReceipts(company.id, query), { companyIds: [company.id] })
        perCompany.set(
          company.id,
          missing.count === 0
            ? null
            : {
                name: company.name,
                count: missing.count,
                totalCents: missing.totalCents,
                url: `${getAppUrl()}/${encodeURIComponent(company.slug)}/banking/missing-receipts`,
                rows: missing.transactions.map((t) => ({ date: t.date, label: t.counterpartyName || t.label || 'Opération sans libellé', amountCents: t.amountCents })),
              },
        )
      } catch (error) {
        logger.warn('[Receipts] Digest: missing receipts not read', { companyId: company.id, reason: (error as Error).message })
        perCompany.set(company.id, null)
      }
    }
    return perCompany.get(company.id) ?? null
  }

  for (const [userId, user] of users) {
    const companies: ReceiptDigestCompany[] = []
    for (const company of [...user.companies.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'))) {
      const block = await missingOf(company)
      if (block) companies.push(block)
    }
    if (companies.length === 0) {
      run.skipped++
      continue
    }
    try {
      await sendEmail(receiptDigestEmail(user.email, { companies, days: DIGEST_DAYS, settingsUrl: `${getAppUrl()}/settings/profile` }))
      await withSystemContext('cron:receipt-digest', () =>
        prisma.userPreference.upsert({ where: { userId }, create: { userId, receiptDigestSentAt: now }, update: { receiptDigestSentAt: now } }),
      )
      run.sent++
    } catch (error) {
      logger.warn('[Receipts] Digest not sent', { userId, reason: (error as Error).message })
      run.failed++
    }
  }
  return run
}

/** The user's own setting (Paramètres, Profil). */
export async function receiptDigestOf(userId: string): Promise<{ receiptDigest: boolean }> {
  const row = await prisma.userPreference.findUnique({ where: { userId }, select: { receiptDigest: true } })
  return { receiptDigest: row?.receiptDigest ?? true }
}

export async function saveReceiptDigest(userId: string, receiptDigest: boolean): Promise<{ receiptDigest: boolean }> {
  await prisma.userPreference.upsert({ where: { userId }, create: { userId, receiptDigest }, update: { receiptDigest } })
  return { receiptDigest }
}
