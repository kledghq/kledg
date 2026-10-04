/**
 * Server and client log output (docs/conventions.md#errors-and-logging).
 * The one place allowed to call `console`.
 *
 * Production keeps errors only; development shows every level. Business
 * operations are not logged here but audited with writeAuditLog
 * (lib/audit), which writes to the database with the user and company.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** Read on every call, so a test (or a script) can switch NODE_ENV. */
function shouldLog(level: LogLevel): boolean {
  return process.env.NODE_ENV !== 'production' || level === 'error'
}

export const logger = {
  /** Development traces (silent in production). */
  debug: (...args: unknown[]) => {
    if (shouldLog('debug')) console.debug('[DEBUG]', ...args)
  },

  info: (...args: unknown[]) => {
    if (shouldLog('info')) console.info('[INFO]', ...args)
  },

  /** Degraded paths (silent in production). */
  warn: (...args: unknown[]) => {
    if (shouldLog('warn')) console.warn('[WARN]', ...args)
  },

  /** Unexpected failures, with the error object: always shown. */
  error: (...args: unknown[]) => {
    if (shouldLog('error')) console.error('[ERROR]', ...args)
  },
}
