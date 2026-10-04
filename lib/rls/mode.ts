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
