import { z } from 'zod'
import { companyRoute, fromResource, NextResponse } from '@/lib/api/route'
import { companyOfBankAccount } from '@/lib/api/resources'
import { writeAuditLog } from '@/lib/audit'
import { setBankAccountSync, updateBankAccount } from '@/lib/banking/connections.service'

const updateSchema = z.object({
  displayName: z.string().trim().max(100).nullable().optional(),
  /** 512 ledger account of this bank account (null clears it). */
  ledgerAccountCode: z.string().trim().max(8).nullable().optional(),
  /** Synchronization of this account with its bank (connected accounts only). */
  shouldSync: z.boolean().optional(),
})

/**
 * PUT /api/banking/accounts/[id] - Met à jour un compte bancaire
 * (nom d'affichage, compte comptable 512, synchronisation). Only the given
 * fields change.
 */
export const PUT = companyRoute(
  { company: fromResource(companyOfBankAccount), permission: { banking: ['manage'] }, body: updateSchema },
  async ({ params, companyId, body }) => {
    const id = params.id as string
    if (body.shouldSync !== undefined) {
      await setBankAccountSync(companyId, id, body.shouldSync)
      await writeAuditLog('info', body.shouldSync ? 'Bank account sync enabled' : 'Bank account sync disabled', {
        action: body.shouldSync ? 'BANK_ACCOUNT_SYNC_ON' : 'BANK_ACCOUNT_SYNC_OFF',
        companyId,
        metadata: { bankAccountId: id },
      })
    }
    const updatedAccount = await updateBankAccount(id, companyId, body)
    return NextResponse.json({
      account: {
        id: updatedAccount.id,
        name: updatedAccount.name,
        displayName: updatedAccount.displayName,
        iban: updatedAccount.iban,
        balance: Number(updatedAccount.balance),
        currency: updatedAccount.currency,
        shouldSync: updatedAccount.shouldSync,
        ledgerAccountCode: updatedAccount.ledgerAccountCode,
      },
    })
  },
)
