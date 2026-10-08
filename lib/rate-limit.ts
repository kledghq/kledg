import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import { RateLimitError } from '@/lib/accounting/errors'
import { INSTANCE_RATE_LIMITS } from '@/lib/instance/policy'
import type { RateLimitRule } from '@/lib/instance/types'

/**
 * Rate limit policy of Kledg's own routes, actions and MCP tools: one place
 * that lists what is limited, per what, and how much. Better Auth's
 * endpoints (sign-in, password reset, account creation, OAuth) have their
 * own rules in lib/auth-policy.ts, and API keys theirs in lib/auth.ts
 * (apiKey plugin). docs/conventions.md#security says which routes need one.
 *
 * Every counter lives in the "rateLimit" table shared with Better Auth, so
 * the limits hold across serverless instances. RATE_LIMIT_DISABLED=true
 * turns them all off (local tests only).
 *
 * Windows are in seconds. Keys are `<name>|<subject>`. A customised
 * instance adds the rules of its own routes in INSTANCE_RATE_LIMITS
 * (lib/instance/policy.ts); Kledg's rules keep their name.
 */
export const RATE_LIMITS = {
  /** First-run setup, per client IP. */
  setup: { window: 900, max: 10, message: 'Trop de tentatives. Réessayez dans quelques minutes.' },
  /** Bank sync cron called without CRON_SECRET (lib/banking/sync-banks.service.ts), instance-wide. */
  'cron-keyless': { window: 86_400, max: 4, message: 'Synchronisation déjà lancée récemment.' },
  /** Period-lock cron called without CRON_SECRET (lib/accounting/period-lock/auto-lock.service.ts), instance-wide. */
  'cron-keyless-period-lock': { window: 86_400, max: 2, message: 'Clôture automatique des périodes déjà lancée récemment.' },
  /** Welcome email of a member added to a company (lib/rbac/add-member-to-company.service.ts), per person. */
  'welcome-email': { window: 86_400, max: 3, message: "Trop d'emails de bienvenue envoyés à cette personne aujourd'hui." },
  /** Invitations sent or sent again by a company administrator (lib/rbac/company-invitations.service.ts), per user. */
  'member-invitation': { window: 3600, max: 20, message: "Trop d'invitations envoyées en une heure. Réessayez plus tard." },
  /** Invitation emails received by one address, every company together, per address. */
  'invitation-email': { window: 86_400, max: 5, message: "Trop d'invitations envoyées à cette adresse aujourd'hui. Réessayez demain." },
  /** Acceptance attempts on the invitation page (app/(auth)/invitation), per client IP. */
  'invitation-accept': { window: 900, max: 20, message: 'Trop de tentatives. Réessayez dans quelques minutes.' },
  /** Test email of the Configuration page, per administrator. */
  'test-email': { window: 3600, max: 5, message: "Trop d'emails de test en une heure. Réessayez plus tard." },
  /** Email change of one's account, per user. */
  'account-change-email': { window: 3600, max: 5, message: "Trop de demandes de changement d'adresse. Réessayez dans une heure." },
  /** Password change, per user. */
  'account-change-password': { window: 900, max: 10, message: 'Trop de tentatives. Réessayez dans quelques minutes.' },
  /** Deletion of one's account, per user. */
  'account-delete': { window: 900, max: 5, message: 'Trop de tentatives. Réessayez dans quelques minutes.' },
  /** Saving one's Apparence settings (chart colours, display mode), per user. */
  'account-appearance': { window: 60, max: 30, message: "Trop d'enregistrements de l'apparence en une minute. Patientez une minute." },
  /** Instance user management (role, ban, email, deletion), per administrator. */
  'instance-users': { window: 60, max: 30, message: "Trop de modifications d'utilisateurs en une minute. Patientez une minute." },
  /** Public company directory (SIREN prefill), per administrator: it accepts 7 requests per second per IP. */
  'siren-lookup': {
    window: 60,
    max: 20,
    message: 'Trop de recherches en peu de temps. Réessayez dans une minute, ou saisissez les informations.',
  },
  /** Bank API calls triggered by a user (connect, refresh, sync), per company. */
  'bank-api': { window: 60, max: 20, message: 'Trop de requêtes vers la banque. Patientez une minute.' },
  /** GitHub reads with the instance token, per administrator. */
  'updates-read': { window: 60, max: 60, message: 'Trop de requêtes vers GitHub. Patientez une minute.' },
  /** GitHub actions (connect, prepare, install), per administrator. */
  'updates-write': { window: 60, max: 10, message: 'Trop de requêtes vers GitHub. Patientez une minute.' },
  /** File imports parsed on the server (FEC, CSV, Excel, bank statements), per user. */
  import: { window: 600, max: 30, message: "Trop d'imports en peu de temps. Patientez quelques minutes avant de réessayer." },
  /** Generated documents (FEC, PDF and Excel exports), per user. */
  export: { window: 60, max: 30, message: "Trop d'exports en une minute. Patientez une minute avant de réessayer." },
  /** MCP calls authenticated with an API key, per key (lib/mcp/api-key.ts): assistants make many calls per conversation. */
  'mcp-api-key': { window: 60, max: 300, message: "Trop d'appels avec cette clé API en une minute. Patientez une minute." },
  /** Creation of a full control API key (password typed again), per user. */
  'api-key-full-control': { window: 900, max: 10, message: 'Trop de tentatives. Réessayez dans quelques minutes.' },
  /** MCP calls authenticated with an OAuth token, per user and assistant (lib/mcp/auth.ts): the same ceiling as an API key. */
  'mcp-oauth': { window: 60, max: 300, message: "Trop d'appels de cet assistant en une minute. Patientez une minute." },
  /** MCP draft writes (create_draft_entry and the draft tools of lib/mcp/drafts), per user. */
  'mcp-write': { window: 60, max: 60, message: "Trop d'enregistrements par l'assistant en une minute. Patientez une minute avant de continuer." },
  /** Approval or refusal of an action prepared by an assistant (password typed again), per user. */
  'ai-action-approval': { window: 900, max: 20, message: 'Trop de tentatives. Réessayez dans quelques minutes.' },
  /** Saving or resetting one's dashboard layout, per user. */
  'dashboard-layout': {
    window: 60,
    max: 30,
    message: 'Trop de modifications du tableau de bord en une minute. Patientez une minute.',
  },
  /** Hiding or showing entries of one's sidebar menu (one save per click), per user. */
  'sidebar-preferences': {
    window: 60,
    max: 60,
    message: 'Trop de modifications du menu en une minute. Patientez une minute.',
  },
  /** MCP full control calls (dry runs and reads included), per user. */
  'mcp-full-control': {
    window: 60,
    max: 60,
    message: "Trop d'actions en contrôle total en une minute. Patientez une minute avant de continuer.",
  },
} as const satisfies Record<string, { window: number; max: number; message: string }>

export type RateLimitName = keyof typeof RATE_LIMITS | keyof typeof INSTANCE_RATE_LIMITS

/** Every rule: Kledg's, and the instance's own (a name Kledg uses keeps Kledg's rule). */
export const RATE_LIMIT_RULES: Readonly<Record<RateLimitName, RateLimitRule>> = { ...INSTANCE_RATE_LIMITS, ...RATE_LIMITS }

function rateLimitsDisabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.RATE_LIMIT_DISABLED === 'true'
}

/**
 * Fixed-window counter in the "rateLimit" table shared with Better Auth, for
 * actions that don't go through Better Auth's HTTP handler (server actions).
 * One atomic upsert per call; returns false once `max` is exceeded in `window` seconds.
 */
export async function consumeRateLimit(key: string, rule: { window: number; max: number }): Promise<boolean> {
  const now = BigInt(Date.now())
  const windowMs = BigInt(rule.window * 1000)
  const rows = await prisma.$queryRaw<Array<{ count: number }>>`
    INSERT INTO "rateLimit" ("id", "key", "count", "lastRequest")
    VALUES (${randomUUID()}, ${key}, 1, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN ${now} - "rateLimit"."lastRequest" >= ${windowMs} THEN 1 ELSE "rateLimit"."count" + 1 END,
      "lastRequest" = CASE WHEN ${now} - "rateLimit"."lastRequest" >= ${windowMs} THEN ${now} ELSE "rateLimit"."lastRequest" END
    RETURNING "count"
  `
  return Number(rows[0]?.count ?? 0) <= rule.max
}

/** Whether `subject` may make one more `name` call (counts it). Always true when limits are disabled. */
export async function withinRateLimit(name: RateLimitName, subject: string): Promise<boolean> {
  if (rateLimitsDisabled()) return true
  return consumeRateLimit(`${name}|${subject}`, RATE_LIMIT_RULES[name])
}

/** Counts one `name` call of `subject`; throws RateLimitError (429, French message) past the limit. */
export async function enforceRateLimit(name: RateLimitName, subject: string): Promise<void> {
  if (!(await withinRateLimit(name, subject))) throw new RateLimitError(RATE_LIMIT_RULES[name].message)
}

