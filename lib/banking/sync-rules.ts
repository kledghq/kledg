/**
 * Rules of the bank sync on plain values (no database).
 *
 * - Dedupe: a provider transaction id is stored once per bank account
 *   (unique bankAccountId + externalTransactionId), so a sync run twice
 *   creates nothing twice.
 * - Direct connections win: when Qonto or Revolut Business (direct API)
 *   and Ponto (aggregator) reach the same IBAN, the Ponto account stops
 *   syncing and points to the direct one (supersededById).
 * - Manual refresh of a Ponto account: once every 5 minutes (Ponto refuses
 *   more, https://documentation.myponto.com/custom-integrations).
 */

export const PONTO_REFRESH_INTERVAL_MS = 5 * 60 * 1000

export type ProviderKind = 'direct' | 'aggregator' | 'manual'

/** IBAN without spaces, upper case; null when empty. */
export function normalizeIban(iban: string | null | undefined): string | null {
  const value = iban?.replace(/\s+/g, '').toUpperCase()
  return value ? value : null
}

/** Transactions whose provider id is not stored yet (first occurrence wins inside the batch). */
export function newTransactions<T extends { externalId: string }>(incoming: T[], existingIds: Iterable<string>): T[] {
  const seen = new Set(existingIds)
  const fresh: T[] = []
  for (const tx of incoming) {
    if (seen.has(tx.externalId)) continue
    seen.add(tx.externalId)
    fresh.push(tx)
  }
  return fresh
}

export interface AccountForPreference {
  id: string
  iban: string | null
  kind: ProviderKind
}

/**
 * Aggregator accounts covered by a direct account with the same IBAN:
 * aggregator account id to the direct account id that replaces it.
 * Manual accounts never supersede nor get superseded.
 */
export function supersededAccounts(accounts: AccountForPreference[]): Map<string, string> {
  const direct = new Map<string, string>()
  for (const a of accounts) {
    const iban = normalizeIban(a.iban)
    if (a.kind === 'direct' && iban && !direct.has(iban)) direct.set(iban, a.id)
  }
  const result = new Map<string, string>()
  for (const a of accounts) {
    const iban = normalizeIban(a.iban)
    if (a.kind === 'aggregator' && iban && direct.has(iban)) result.set(a.id, direct.get(iban)!)
  }
  return result
}

/** Seconds before a new manual refresh is allowed (0 when allowed now). */
export function refreshRetryAfter(
  lastManualSyncAt: Date | null | undefined,
  now: Date = new Date(),
  intervalMs = PONTO_REFRESH_INTERVAL_MS,
): number {
  if (!lastManualSyncAt) return 0
  const wait = lastManualSyncAt.getTime() + intervalMs - now.getTime()
  return wait > 0 ? Math.ceil(wait / 1000) : 0
}
