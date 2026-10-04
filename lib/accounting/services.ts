/**
 * Business services for accounting operations
 * Separates business logic from API routes
 * Compliant with French accounting principles (PCG 2026)
 *
 * This is a barrel export file that re-exports all service functions
 * for backward compatibility.
 */

// Export all service functions
export {
  generateNextEntryNumber,
  nextDefinitiveEntryNumber,
  isProvisionalEntryNumber,
} from './services/generate-next-entry-number.service'
export { createAccountingEntry } from './services/create-accounting-entry.service'
export { createAccountingEntryWithWarnings } from './services/create-accounting-entry-with-warnings.service'
export { updateAccountingEntry } from './services/update-accounting-entry.service'
export { calculateAccountBalance } from './services/calculate-account-balance.service'
export {
  createEntry,
  validateEntries,
  deleteDraftEntry,
  reverseEntry,
  immutableEntryMessage,
  ENTRY_INCLUDE,
} from './services/entry-lifecycle.service'
export type { EntryLineInput, EntryWithRelations } from './services/entry-lifecycle.service'
export {
  getCompanyEntry,
  getEntryStatus,
  duplicateEntry,
  deleteDraftEntries,
  setEntriesStatus,
} from './services/entry-operations.service'

// Export shared types
export type {
  PCGWarning,
  AccountingEntryResult,
  AccountingEntryWithWarnings,
} from './services/types'
