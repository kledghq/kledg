/**
 * Runs once per server instance, before it handles requests (Next.js
 * instrumentation). Only Node.js work here: the proxy runs elsewhere.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  // After a rotation of the auth secret, credentials sealed with the old one
  // are sealed again with the new one, and values in the legacy format are
  // sealed again bound to their row (lib/crypto/reencrypt.ts). A failure
  // never blocks the start.
  const { reencryptStoredSecrets } = await import('@/lib/crypto/reencrypt')
  const { logger } = await import('@/lib/logger')
  await reencryptStoredSecrets().catch((error: unknown) => logger.error('Secret rotation: re-encryption failed', error))
  // Update history (lib/updates/history.ts): records the running version when
  // it changed. Not awaited, so it never delays the first request; it logs
  // its own failures, and the history route awaits the same promise.
  const { ensureVersionRecorded } = await import('@/lib/updates/history')
  void ensureVersionRecorded()
}
