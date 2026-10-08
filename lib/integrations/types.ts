/**
 * Integration features and sync result shared by the bank sync and its routes.
 * Providers themselves are described in lib/banking/providers.
 */

export enum IntegrationFeature {
  BANKING_TRANSACTIONS = 'BANKING_TRANSACTIONS',
  BANKING_ACCOUNTS = 'BANKING_ACCOUNTS',
}

/** Outcome of a synchronization. */
export interface SyncResult {
  success: boolean
  itemsSynced: number
  /** Bank lines recognised as already held from another source (statement file, replaced Ponto account), not inserted. */
  matched?: number
  /** French reasons, safe to show (lib/banking/errors.ts). */
  errors: string[]
  /**
   * The company is read-only (archived, or refused writes by the instance
   * policy): the bank was not called and nothing was recorded, the next sync
   * once it is writable again catches up (lib/banking/sync-pause.ts).
   */
  paused?: boolean
}
