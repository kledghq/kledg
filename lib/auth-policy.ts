/**
 * Security policy for Better Auth (lib/auth.ts): rate limits and the
 * organization endpoints closed to non administrators. Kept free of Better
 * Auth imports so it can be unit tested.
 */

/**
 * Better Auth organization endpoints a regular member may call: reads only.
 * Everything else under /organization/ (create, update, delete, invite,
 * add/remove member, update role, accept invitation, leave, teams...) is
 * reserved to instance administrators.
 */
const ORGANIZATION_READ_PATHS = new Set([
  '/organization/list',
  '/organization/get-full-organization',
  '/organization/list-members',
  '/organization/get-active-member',
  '/organization/get-active-member-role',
  '/organization/list-invitations',
  '/organization/list-user-invitations',
  '/organization/get-invitation',
  '/organization/has-permission',
  '/organization/check-slug',
  '/organization/set-active',
])

export function isOrganizationMutationPath(path: string): boolean {
  return path.startsWith('/organization/') && !ORGANIZATION_READ_PATHS.has(path)
}

/**
 * Better Auth account endpoints that Kledg only calls from its own account
 * routes (app/api/account), which add checks Better Auth does not make: the
 * current password before an email change, the email configuration, the
 * typed confirmation and the last administrator guards before a deletion.
 * Over HTTP they are closed.
 */
const ACCOUNT_ROUTE_ONLY_PATHS = new Set(['/change-email', '/delete-user', '/delete-user/callback'])

export function isAccountRouteOnlyPath(path: string): boolean {
  return ACCOUNT_ROUTE_ONLY_PATHS.has(path)
}

/**
 * Better Auth admin endpoints (/admin/*) are all closed over HTTP. Kledg
 * calls the ones it uses in process from its own routes (app/api/users,
 * lib/users), which read the administrator's role from the database on every
 * request and add what Better Auth does not check: the instance always keeps
 * an administrator, the deletion guards of lib/account/deletion-guards.ts,
 * the administrator's password before an email change, an audit entry, all
 * under one lock. Over HTTP, Better Auth would read the role from the signed
 * session cache (up to 60 seconds old) and offer endpoints Kledg never uses:
 * impersonation, setting another user's password, listing and revoking
 * another user's sessions.
 */
export function isUserRouteOnlyPath(path: string): boolean {
  return path.startsWith('/admin/')
}

/**
 * Database-backed limits (table "rateLimit"): sign-in, password reset,
 * account creation and dynamic OAuth client registration. Windows in seconds.
 * Kledg's own limits use the same table (RATE_LIMITS, lib/rate-limit.ts).
 */
export const authRateLimit = {
  enabled: process.env.RATE_LIMIT_DISABLED !== 'true',
  storage: 'database' as const,
  modelName: 'rateLimit',
  window: 60,
  max: 120,
  customRules: {
    '/sign-in/*': { window: 300, max: 10 },
    '/request-password-reset': { window: 900, max: 5 },
    '/forget-password': { window: 900, max: 5 },
    '/reset-password': { window: 900, max: 10 },
    '/oauth2/register': { window: 3600, max: 20 },
    '/oauth2/token': { window: 60, max: 60 },
    // Read on every page load by the client session hook: not worth a database write.
    '/get-session': false as const,
  },
}
