/**
 * Fiscal year closing (see fiscal-year-closure/close-fiscal-year.service.ts):
 * closing entry (result to 120 / 129), next fiscal year, opening entry
 * (à-nouveaux) and lock of the closed year, in one transaction.
 */

export { validateFiscalYearClosure } from './fiscal-year-closure/validate-fiscal-year-closure.service'
export { simulateFiscalYearClosure } from './fiscal-year-closure/simulate-fiscal-year-closure.service'
export { closeFiscalYear } from './fiscal-year-closure/close-fiscal-year.service'
export {
  assertDateInOpenFiscalYear,
  assertFiscalYearOpen,
  isFiscalYearClosed,
  ClosedFiscalYearError,
} from './fiscal-year-closure/lock'

export type { ClosureValidationResult } from './fiscal-year-closure/validate-fiscal-year-closure.service'
export type { CloseFiscalYearResult } from './fiscal-year-closure/close-fiscal-year.service'
