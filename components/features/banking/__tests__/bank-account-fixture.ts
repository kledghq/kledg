import type { BankAccountRow } from '../types'

/** A connected bank account as GET /api/banking/accounts returns it. */
export function bankAccount(over: Partial<BankAccountRow> = {}): BankAccountRow {
  return {
    id: 'ba-1',
    name: 'Compte courant',
    displayName: null,
    iban: 'FR76 3000 4000 0312 3456 7890 143',
    balance: 1200,
    currency: 'EUR',
    shouldSync: true,
    ledgerAccountCode: null,
    consentExpiresAt: null,
    lastSyncedAt: null,
    lastSyncError: null,
    supersededBy: null,
    institution: null,
    bankConnection: { id: 'conn-1', provider: 'PONTO', status: 'active' },
    createdAt: '2026-01-05T10:00:00.000Z',
    updatedAt: '2026-01-05T10:00:00.000Z',
    ...over,
  }
}
