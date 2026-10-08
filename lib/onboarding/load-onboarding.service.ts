/**
 * Loads the "Démarrer" checklist of a company (lib/onboarding/checklist.ts)
 * and stores whether it is hidden. Every fact is a count or a date read with
 * a bounded query; nothing is written to detect a step.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { assertActionAllowed, isActionAllowed, type InstanceActor } from '@/lib/instance'
import { isGlobalAdmin } from '@/lib/rbac/authorize'
import { calendarDayOf } from '@/lib/utils/date'
import { OPENING_JOURNAL } from '@/lib/accounting/fiscal-year-closure/constants'
import { memberRoles } from '@/lib/account/deletion-guards'
import { BANK_PROVIDER_NAMES } from './provider-names'
import { buildChecklist, suggestRules, type OnboardingChecklist, type OnboardingFacts } from './checklist'

/** Recent operations scanned for frequent labels. */
const SUGGESTION_SAMPLE = 500

/** Body of POST /api/companies/[id]/onboarding. */
export const OnboardingActionSchema = z.object({
  action: z.enum(['dismiss', 'reopen'], { error: 'Action inconnue : dismiss ou reopen' }),
})
export type OnboardingAction = z.infer<typeof OnboardingActionSchema>['action']

export interface CompanyOnboarding extends OnboardingChecklist {
  /** False when the instance policy hides the guided start ("onboarding"). */
  enabled: boolean
  dismissed: boolean
  /** Counts used by the empty states of the company pages. */
  counts: { entries: number; bankTransactions: number }
}

/** Users who can reach the company: its members and the instance administrators. */
async function usersWithAccess(companyId: string): Promise<string[]> {
  const [members, admins] = await Promise.all([
    prisma.member.findMany({ where: { organization: { companyId } }, select: { userId: true } }),
    prisma.user.findMany({ where: { role: 'admin' }, select: { id: true }, take: 100 }),
  ])
  return [...new Set([...members.map((m) => m.userId), ...admins.map((a) => a.id)])]
}

/**
 * Members holding the Comptable role. A member row may hold several roles
 * ("companyAdmin,accountant"): the list is split, never compared whole.
 */
async function countAccountants(companyId: string): Promise<number> {
  const rows = await prisma.member.findMany({
    where: { organization: { companyId }, role: { contains: 'accountant' } },
    select: { role: true },
    take: 500,
  })
  return rows.filter((m) => memberRoles(m.role).includes('accountant')).length
}

/**
 * AI connections (OAuth assistants and API keys) of those users that may
 * reach this company: no grant (every company, as before grants existed),
 * a grant on every company, or a grant naming this one (lib/ai-access).
 */
async function countAiConnections(companyId: string, userIds: string[], now: Date): Promise<number> {
  if (userIds.length === 0) return 0
  const [consents, keys, grants] = await Promise.all([
    prisma.oauthConsent.findMany({ where: { userId: { in: userIds } }, select: { userId: true, clientId: true }, take: 500 }),
    prisma.apikey.findMany({
      where: { referenceId: { in: userIds }, enabled: { not: false }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      select: { id: true },
      take: 500,
    }),
    prisma.aiAccessGrant.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, clientId: true, apiKeyId: true, allCompanies: true, companies: { where: { companyId }, select: { companyId: true } } },
      take: 1000,
    }),
  ])
  const reaches = (grant: (typeof grants)[number] | undefined) => !grant || grant.allCompanies || grant.companies.length > 0
  const byClient = new Map(grants.filter((g) => g.clientId).map((g) => [`${g.userId}:${g.clientId}`, g]))
  const byKey = new Map(grants.filter((g) => g.apiKeyId).map((g) => [g.apiKeyId as string, g]))
  const assistants = new Set(
    consents.filter((c) => c.userId && reaches(byClient.get(`${c.userId}:${c.clientId}`))).map((c) => `${c.userId}:${c.clientId}`),
  )
  return assistants.size + keys.filter((k) => reaches(byKey.get(k.id))).length
}

async function loadOnboardingFacts(companyId: string, now: Date = new Date()): Promise<OnboardingFacts & { entries: number }> {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { foundationDate: true } })
  const fiscalYears = await prisma.fiscalYear.findMany({
    where: { companyId },
    select: { id: true, startDate: true },
    orderBy: { startDate: 'asc' },
  })
  const latest = fiscalYears.at(-1)
  const userIds = await usersWithAccess(companyId)

  const [accounts, journals, connections, bankTransactions, openingEntries, earlierYearEntries, rules, accountants, entries, recent, aiConnections] =
    await Promise.all([
      latest ? prisma.account.count({ where: { companyId, fiscalYearId: latest.id } }) : Promise.resolve(0),
      prisma.journal.count({ where: { companyId } }),
      prisma.bankConnection.findMany({
        where: { companyId, provider: { not: 'MANUAL' }, status: { not: 'inactive' }, integration: { status: 'active' } },
        select: { provider: true },
        take: 10,
      }),
      prisma.bankTransaction.count({ where: { bankAccount: { bankConnection: { companyId } } } }),
      prisma.accountingEntry.count({ where: { companyId, journal: { code: OPENING_JOURNAL.code } } }),
      latest ? prisma.accountingEntry.count({ where: { companyId, fiscalYear: { startDate: { lt: latest.startDate } } } }) : Promise.resolve(0),
      prisma.transactionRule.count({ where: { companyId } }),
      countAccountants(companyId),
      prisma.accountingEntry.count({ where: { companyId } }),
      prisma.bankTransaction.findMany({
        where: { bankAccount: { bankConnection: { companyId } } },
        select: { id: true, label: true, counterpartyName: true },
        orderBy: { date: 'desc' },
        take: SUGGESTION_SAMPLE,
      }),
      countAiConnections(companyId, userIds, now),
    ])

  return {
    accounts,
    journals,
    activeBankConnections: connections.length,
    bankProviders: [...new Set(connections.map((c) => BANK_PROVIDER_NAMES[c.provider] ?? c.provider))],
    bankTransactions,
    foundationDate: calendarDayOf(company.foundationDate),
    firstFiscalYearStart: calendarDayOf(fiscalYears[0]?.startDate ?? null),
    openingEntries,
    earlierYearEntries,
    rules,
    ruleSuggestions: rules === 0 ? suggestRules(recent) : [],
    accountants,
    aiConnections,
    entries,
  }
}

/**
 * The checklist of a company for one user. `canManage` (the route's
 * `can({ ledger: ['manage'] })`) tells whether the user may act on it and
 * hide it; only instance administrators see the member steps.
 */
export async function getCompanyOnboarding(
  companyId: string,
  context: { actor: InstanceActor; canManage: boolean; now?: Date },
): Promise<CompanyOnboarding & { canManage: boolean }> {
  const [company, enabled, state, facts] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { slug: true } }),
    isActionAllowed('onboarding', context.actor),
    prisma.companyOnboarding.findUnique({ where: { companyId }, select: { dismissedAt: true } }),
    loadOnboardingFacts(companyId, context.now),
  ])
  const checklist = buildChecklist(facts, { companySlug: company.slug, canManageMembers: isGlobalAdmin(context.actor) })
  return {
    ...checklist,
    enabled,
    dismissed: Boolean(state?.dismissedAt),
    counts: { entries: facts.entries, bankTransactions: facts.bankTransactions },
    canManage: context.canManage,
  }
}

/**
 * Hides the checklist ("dismiss") or shows it again ("reopen") for every
 * member of the company (one row per company, upserted). Refused when the
 * instance policy turns the guided start off.
 */
export async function setOnboardingDismissed(
  companyId: string,
  action: OnboardingAction,
  actor: InstanceActor,
): Promise<{ dismissed: boolean }> {
  await assertActionAllowed('onboarding', actor)
  const dismissed = action === 'dismiss'
  const data = dismissed ? { dismissedAt: new Date(), dismissedById: actor.id } : { dismissedAt: null, dismissedById: null }
  await prisma.companyOnboarding.upsert({
    where: { companyId },
    create: { companyId, ...data },
    update: data,
  })
  return { dismissed }
}
