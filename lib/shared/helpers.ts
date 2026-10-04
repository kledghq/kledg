/**
 * Codes typed by users: journal codes and the PCG class of an account code.
 * Pure, usable in client components.
 */

/** Removes spaces and upper-cases an account code. */
function normalizeAccountCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, '')
}

/** Normalizes a journal code: trimmed, upper case. */
export function normalizeJournalCode(code: string): string {
  return code.trim().toUpperCase()
}

/** Whether a journal code is valid: 2 or 3 letters or digits (BQ, AC, BQ2). */
export function isValidJournalCode(code: string): boolean {
  const normalized = normalizeJournalCode(code)
  return /^[A-Z0-9]{2,3}$/.test(normalized)
}

/** The PCG class (1 to 7) of an account code, or null. */
export function extractPCGClass(accountCode: string): string | null {
  const normalized = normalizeAccountCode(accountCode)
  const match = normalized.match(/^([1-7])/)
  return match ? match[1] : null
}
