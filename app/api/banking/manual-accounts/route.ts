import { z } from 'zod'
import { companyRoute, fromBody, NextResponse } from '@/lib/api/route'
import { writeAuditLog } from '@/lib/audit'
import { createManualAccount } from '@/lib/banking/connections.service'

const manualAccountSchema = z.object({
  companyId: z.string().min(1),
  name: z.string().trim().min(1, 'Donnez un nom au compte (ex. Compte courant BoursoBank).').max(100),
  iban: z.string().trim().max(42).optional().nullable(),
  currency: z.literal('EUR').default('EUR'),
  ledgerAccountCode: z.string().trim().min(3, 'Choisissez le compte comptable 512 de ce compte bancaire.').max(8),
})

/**
 * POST /api/banking/manual-accounts { companyId, name, iban?, currency, ledgerAccountCode }
 * Adds a bank account without API connection: its transactions come from
 * imported statement files.
 */
export const POST = companyRoute(
  { company: fromBody(), permission: { banking: ['manage'] }, body: manualAccountSchema },
  async ({ companyId, body }) => {
    const account = await createManualAccount(companyId, {
      name: body.name,
      iban: body.iban || null,
      currency: body.currency,
      ledgerAccountCode: body.ledgerAccountCode,
    })
    await writeAuditLog('info', 'Manual bank account created', {
      action: 'BANK_MANUAL_ACCOUNT_CREATE',
      companyId,
      metadata: { bankAccountId: account.id },
    })
    return NextResponse.json({ account }, { status: 201 })
  },
)
