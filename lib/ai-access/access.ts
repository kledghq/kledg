/**
 * Which companies an AI assistant or an API key may reach: every company of
 * the user (including future ones) or an explicit list. Pure module shared by
 * the API routes, the MCP server and the settings and consent screens.
 */

import { z } from 'zod'

/** Upper bound of an explicit list (a user rarely has more than a few companies). */
const MAX_GRANTED_COMPANIES = 500

export const CompanyAccessSchema = z
  .object({
    allCompanies: z.boolean(),
    companyIds: z.array(z.string().min(1).max(100)).max(MAX_GRANTED_COMPANIES).default([]),
  })
  .refine((access) => access.allCompanies || access.companyIds.length > 0, {
    path: ['companyIds'],
    message: 'Choisissez au moins une société, ou toutes vos sociétés.',
  })

export type CompanyAccess = z.infer<typeof CompanyAccessSchema>

/** The access of a connection without a grant: every company, as before grants existed. */
export const ALL_COMPANIES: CompanyAccess = { allCompanies: true, companyIds: [] }

/**
 * Where the company choice of the consent page starts: every company, unless
 * a saved grant of this assistant still names companies the user can access
 * (`accessibleIds`, null while unknown). A saved list left without any
 * accessible company starts from every company instead of an empty choice.
 */
export function startingAccess(saved: CompanyAccess | undefined, accessibleIds: readonly string[] | null): CompanyAccess {
  if (!saved || saved.allCompanies) return ALL_COMPANIES
  if (accessibleIds === null) return saved
  const kept = saved.companyIds.filter((id) => accessibleIds.includes(id))
  return kept.length > 0 ? { allCompanies: false, companyIds: kept } : ALL_COMPANIES
}

/** Grant of one assistant (OAuth client) or one API key, as listed to its owner. */
/** What a connection's grant holds: its companies and its execution mode. */
export type ConnectionAccess = CompanyAccess & { executionMode: ExecutionMode }

export type AssistantGrant = ConnectionAccess & { clientId: string }
export type ApiKeyGrant = ConnectionAccess & { apiKeyId: string }

export interface AiAccessGrants {
  assistants: AssistantGrant[]
  apiKeys: ApiKeyGrant[]
}

/** OAuth scope to read the books (required by /api/mcp). */
export const READ_SCOPE = 'kledg:read'
/** OAuth scope to propose draft entries (create_draft_entry). */
export const WRITE_SCOPE = 'kledg:write'
/**
 * OAuth scope for full control: the assistant may act like the user
 * (validate entries, reconcile, import, close a fiscal year...), always within
 * the user's own roles and the granted companies. Implies the two others.
 */
export const ADMIN_SCOPE = 'kledg:admin'

/** Every Kledg scope of the MCP resource, from the narrowest. */
const KLEDG_SCOPES = [READ_SCOPE, WRITE_SCOPE, ADMIN_SCOPE] as const

/**
 * What an assistant or an API key may do: read only, read and propose draft
 * entries, or full control. Chosen on the consent page or at key creation,
 * never preselected to full control. An assistant can be lowered later from
 * the settings page; raising it takes a new authorization (see docs/mcp.md).
 */
export type AccessLevel = 'read' | 'write' | 'admin'

export const ACCESS_LEVELS: readonly AccessLevel[] = ['read', 'write', 'admin']

export const ACCESS_LEVEL_LABELS: Record<AccessLevel, string> = {
  read: 'Lecture seule',
  write: "Lecture et brouillons d'écritures",
  admin: 'Contrôle total',
}

export const ACCESS_LEVEL_DESCRIPTIONS: Record<AccessLevel, string> = {
  read: 'Consulter les sociétés, comptes, écritures, états et transactions.',
  write: "Consulter, et préparer des brouillons que vous vérifierez vous-même dans Kledg (écritures, notes de frais, budget, provisions, données de l'approbation des comptes)\u00a0: rien n'est validé ni comptabilisé.",
  admin:
    "L'assistant pourra agir comme vous\u00a0: valider des écritures, rapprocher, importer, clôturer un exercice..., dans la limite de vos droits sur les sociétés choisies. Réservez ce choix à un assistant en qui vous avez toute confiance.",
}

/** Kledg scopes granted by each level (each level implies the narrower ones). */
const LEVEL_SCOPES: Record<AccessLevel, readonly string[]> = {
  read: [READ_SCOPE],
  write: [READ_SCOPE, WRITE_SCOPE],
  admin: [READ_SCOPE, WRITE_SCOPE, ADMIN_SCOPE],
}

/** The Kledg scopes of a level. */
export function levelScopes(level: AccessLevel): readonly string[] {
  return LEVEL_SCOPES[level]
}

/** What a set of scopes allows (kledg:admin implies kledg:write). */
export interface AccessCapabilities {
  canRead: boolean
  canWrite: boolean
  canAdmin: boolean
}

export function capabilitiesOf(scopes: readonly string[] | undefined): AccessCapabilities {
  const set = new Set(scopes ?? [])
  const canAdmin = set.has(ADMIN_SCOPE)
  return { canRead: set.has(READ_SCOPE) || canAdmin, canWrite: set.has(WRITE_SCOPE) || canAdmin, canAdmin }
}

/** The level given by a set of granted scopes. */
export function accessLevelOf(scopes: readonly string[] | undefined): AccessLevel {
  const { canWrite, canAdmin } = capabilitiesOf(scopes)
  return canAdmin ? 'admin' : canWrite ? 'write' : 'read'
}

/**
 * The scopes to grant for `level`, out of the requested (or consented) ones:
 * Kledg scopes above the level are dropped, other scopes (openid,
 * offline_access) are kept. Never adds a scope.
 */
export function scopesForLevel(scopes: readonly string[], level: AccessLevel): string[] {
  const allowed = new Set(LEVEL_SCOPES[level])
  return scopes.filter((scope) => !(KLEDG_SCOPES as readonly string[]).includes(scope) || allowed.has(scope))
}

/** Levels the user may pick for a request: only up to what the assistant asked for. */
export function availableLevels(requested: readonly string[]): AccessLevel[] {
  return ACCESS_LEVELS.filter((level) => LEVEL_SCOPES[level].every((scope) => requested.includes(scope)))
}

/** Preselected level: what was asked, but never full control (it must be chosen). */
export function defaultLevel(requested: readonly string[]): AccessLevel {
  return availableLevels(requested).includes('write') ? 'write' : 'read'
}

/**
 * API keys store their level as Better Auth key permissions
 * (`{ kledg: ['read', 'write'] }`). A key without a kledg level is read-only
 * (fail closed): migration 20261011120000_explicit_ai_access gave the keys
 * created before levels existed their effective level (read and draft
 * entries) explicitly.
 */
const API_KEY_PERMISSION_RESOURCE = 'kledg'

export function apiKeyPermissionsFor(level: AccessLevel): Record<string, string[]> {
  return { [API_KEY_PERMISSION_RESOURCE]: LEVEL_SCOPES[level].map((scope) => scope.slice('kledg:'.length)) }
}

export function apiKeyLevelOf(permissions: Record<string, string[]> | null | undefined): AccessLevel {
  const actions = permissions?.[API_KEY_PERMISSION_RESOURCE]
  if (!Array.isArray(actions)) return 'read'
  return accessLevelOf(actions.map((action) => `kledg:${action}`))
}

export const AccessLevelSchema = z.enum(['read', 'write', 'admin'])

/**
 * Lifetime of an API key, in days, chosen at creation (KLEDG-R3-AUTH-01):
 * 30, 90 (default) or 365; no expiry only for a read-only key. A key that
 * writes (drafts or full control) always expires, so a key planted by
 * someone who once held the session does not live forever.
 */
export const API_KEY_EXPIRY_DAYS = [30, 90, 365] as const
export type ApiKeyExpiryDays = (typeof API_KEY_EXPIRY_DAYS)[number] | null
export const DEFAULT_API_KEY_EXPIRY_DAYS: ApiKeyExpiryDays = 90
export const ApiKeyExpirySchema = z.union([z.literal(30), z.literal(90), z.literal(365), z.null()], {
  error: 'Durée de validité inconnue : 30, 90 ou 365 jours, ou sans expiration pour une clé en lecture seule.',
})
export const API_KEY_EXPIRY_REQUIRED_MESSAGE = 'Une clé qui écrit doit expirer : choisissez 30, 90 ou 365 jours.'

/** Whether a key of `level` may be created with this lifetime. */
export function expiryAllowed(level: AccessLevel, days: ApiKeyExpiryDays): boolean {
  return days !== null || level === 'read'
}

/**
 * How a full control connection runs its high-impact tools (validate,
 * reverse, delete, import, close...), chosen per assistant (user and OAuth
 * client) and per API key, stored on its grant:
 * - 'automatic' (default, the owner's choice): the tool executes on the
 *   call; an assistant may still ask for a preview with `dryRun: true`;
 * - 'validation': the call records a pending action the user approves in
 *   Kledg before the assistant can execute it once
 *   (lib/mcp/full-control/pending-actions.ts).
 * Both keep the scope, company grant, role, rate limit, audit log and the
 * accounting invariants of the services and the database.
 */
export type ExecutionMode = 'automatic' | 'validation'

export const EXECUTION_MODES: readonly ExecutionMode[] = ['automatic', 'validation']

export const DEFAULT_EXECUTION_MODE: ExecutionMode = 'automatic'

export const ExecutionModeSchema = z.enum(['automatic', 'validation'])

export const EXECUTION_MODE_LABELS: Record<ExecutionMode, string> = {
  automatic: 'Automatique',
  validation: 'Validation dans Kledg',
}

export const EXECUTION_MODE_DESCRIPTIONS: Record<ExecutionMode, string> = {
  automatic: "Recommandé si vous faites confiance à l'assistant. Il exécute les actions importantes aussitôt, sans attendre votre accord dans Kledg.",
  validation: "Pour chaque action importante (validation, clôture, suppression, import...), l'assistant attend que vous l'approuviez dans Kledg.",
}

/** Warning shown whenever automatic execution is chosen (prompt injection is the residual risk). */
export const AUTOMATIC_MODE_WARNING =
  "En mode automatique, l'assistant valide, supprime, importe ou clôture sans vous demander votre accord dans Kledg. Un texte malveillant présent dans vos données, par exemple un libellé bancaire, pourrait pousser l'assistant à agir à votre place. Choisissez Validation dans Kledg si vous n'êtes pas sûr de l'assistant."

/** Short description of an access level and mode, for the rows of the settings page. */
export function describeLevel(level: AccessLevel, mode: ExecutionMode | undefined): string {
  if (level !== 'admin' || !mode) return ACCESS_LEVEL_LABELS[level]
  return `${ACCESS_LEVEL_LABELS.admin}, exécution ${mode === 'validation' ? 'avec validation dans Kledg' : 'automatique'}`
}
