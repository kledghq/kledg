/**
 * Runs once per server instance, before it handles requests (Next.js
 * instrumentation). Only Node.js work here: the proxy runs elsewhere.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  // An instance whose policy requires row level security never starts
  // without it (lib/instance/policy.ts, requiresRowLevelSecurity): the error
  // says which variable to set. The database client refuses too (lib/prisma.ts).
  const { assertRequiredRlsMode } = await import('@/lib/rls/mode')
  const { requiresRowLevelSecurity } = await import('@/lib/instance/policy')
  assertRequiredRlsMode(requiresRowLevelSecurity())
  // After a rotation of the auth secret, credentials sealed with the old one
  // are sealed again with the new one, and values in the legacy format are
  // sealed again bound to their row (lib/crypto/reencrypt.ts). A failure
  // never blocks the start.
  const { reencryptStoredSecrets } = await import('@/lib/crypto/reencrypt')
  const { logger } = await import('@/lib/logger')
  await reencryptStoredSecrets().catch((error: unknown) => logger.error('Secret rotation: re-encryption failed', error))
  // Values still in the legacy format (unreadable by Kledg 0.4) are reported
  // in the log; the Configuration page shows them to the administrator.
  const { warnAboutLegacySecrets } = await import('@/lib/crypto/reencrypt')
  await warnAboutLegacySecrets().catch((error: unknown) => logger.error('Secret rotation: legacy format check failed', error))
  // Update history (lib/updates/history.ts): records the running version when
  // it changed. Not awaited, so it never delays the first request; it logs
  // its own failures, and the history route awaits the same promise.
  const { ensureVersionRecorded } = await import('@/lib/updates/history')
  void ensureVersionRecorded()
}
