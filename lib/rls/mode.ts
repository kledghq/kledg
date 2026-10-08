/**
 * KLEDG_RLS: whether the row level security context is sent to the database
 * (docs/rls.md). `off` (default) keeps single-role installs unchanged;
 * `enforce` requires a database role subject to the policies. Any other
 * value is refused: a typo must not silently turn the protection off.
 */

export type RlsMode = 'off' | 'enforce'

export class RlsConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RlsConfigurationError'
  }
}

export function rlsMode(env: Record<string, string | undefined> = process.env): RlsMode {
  const value = env.KLEDG_RLS?.trim().toLowerCase()
  if (!value || value === 'off') return 'off'
  if (value === 'enforce') return 'enforce'
  throw new RlsConfigurationError(`KLEDG_RLS must be "off" or "enforce", got "${env.KLEDG_RLS}"`)
}

/**
 * Refuses a configuration where the instance policy requires row level
 * security (requiresRowLevelSecurity, lib/instance/policy.ts: a service
 * whose customers share one database) and KLEDG_RLS is not `enforce`.
 * Called when the server starts (instrumentation.ts) and when the database
 * client opens (lib/prisma.ts), so no request is served without the policies.
 */
export function assertRequiredRlsMode(required: boolean, env: Record<string, string | undefined> = process.env): void {
  if (required && rlsMode(env) !== 'enforce') {
    throw new RlsConfigurationError(
      'This instance requires row level security: set KLEDG_RLS=enforce with the application role (docs/rls.md). Refusing to serve without it.',
    )
  }
}
