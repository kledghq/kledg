import { NextResponse } from 'next/server'
import { z } from 'zod'
import { companyRoute, type CompanyResolver } from '@/lib/api/route'
import { NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { companyOfBankConnection, setConnectionSyncedAccounts } from '@/lib/banking/connections.service'

const SyncedAccountsSchema = z.object({
  bankConnectionId: z.string().min(1),
  accountIds: z.array(z.string().min(1)).max(500),
})

/** Company of the bank connection named in the JSON body (bankConnectionId). */
const fromBankConnectionInBody: CompanyResolver = async ({ json }) => {
  const bankConnectionId = ((await json()) as { bankConnectionId?: unknown } | null)?.bankConnectionId
  if (typeof bankConnectionId !== 'string' || !bankConnectionId) {
    throw new ValidationError('Précisez la connexion bancaire (bankConnectionId) et les comptes à synchroniser (accountIds).')
  }
  const connection = await companyOfBankConnection(bankConnectionId)
  if (!connection) throw new NotFoundError('Connexion bancaire introuvable')
  return connection.companyId
}

/**
 * POST /api/banking/accounts/sync { bankConnectionId, accountIds }
 * Accounts of a connection to synchronize: the listed ones on, the others
 * off (lib/banking/connections.service.ts setConnectionSyncedAccounts).
 */
export const POST = companyRoute(
  { company: fromBankConnectionInBody, permission: { banking: ['manage'] }, body: SyncedAccountsSchema },
  async ({ body, companyId }) => {
    const accounts = await setConnectionSyncedAccounts(companyId, body.bankConnectionId, body.accountIds)
    return NextResponse.json({ success: true, accounts })
  },
)
