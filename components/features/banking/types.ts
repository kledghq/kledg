/** Shapes returned by the banking API routes, as used by the bank screens. */

export interface BankAccountRow {
  id: string
  name: string
  displayName: string | null
  iban: string | null
  balance: number
  currency: string
  shouldSync: boolean
  ledgerAccountCode: string | null
  consentExpiresAt: string | null
  lastSyncedAt: string | null
  lastSyncError: string | null
  supersededBy: { id: string; name: string; provider: string } | null
  institution: { name: string | null; logoUrl: string | null } | null
  bankConnection: { id: string; provider: string; status: string }
  integrationResource?: { id: string; integration: { id: string; name: string; provider: string } } | null
  createdAt: string
  updatedAt: string
}

export interface BankConnectionRow {
  id: string
  provider: string
  status: string
  lastSyncAt: string | null
  lastSyncAttemptAt: string | null
  lastSyncError: string | null
  lastManualSyncAt: string | null
  consentExpiresAt: string | null
  integration: { id: string; provider: string; status: string; name: string } | null
  bankAccounts: Array<{ id: string; name: string; displayName: string | null; iban: string | null; supersededById: string | null }>
}

export interface LedgerAccountOption {
  id: string
  code: string
  label: string
}

/** Reads `{ error }` from a failed response, with a fallback message. */
export async function responseError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string }
    return body.error || fallback
  } catch {
    return fallback
  }
}
