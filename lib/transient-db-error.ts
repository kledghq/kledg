/**
 * Errors of a database connection attempt that never reached the database
 * (scale-to-zero compute waking up, network blip): safe to retry, since no
 * statement ran. Pure, no imports: usable where the database client is mocked.
 */
export function isTransientConnectError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : ''
  return /connection timeout|Connection terminated unexpectedly|ECONNRESET|ECONNREFUSED/i.test(message)
}
