/**
 * Months of the bank statement filters, in the "mm-yyyy" form the Qonto
 * statements API expects (`period_from`, `period_to`). Pure, usable by
 * client components.
 */

const MONTH = /^(0[1-9]|1[0-2])-(\d{4})$/

/** True for a complete "mm-yyyy" month ("03-2026"); partial input while typing is false. */
export function isStatementMonth(value: string): boolean {
  return MONTH.test(value.trim())
}

/**
 * Default statement period: from January to the current month of the
 * current year, so the list is not empty on a first visit.
 */
export function currentStatementPeriod(now: Date = new Date()): { from: string; to: string } {
  const year = now.getUTCFullYear()
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  return { from: `01-${year}`, to: `${month}-${year}` }
}
