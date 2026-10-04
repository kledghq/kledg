import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { listBankAccounts } from '@/lib/banking/list-bank-connections.service'

/**
 * Récupère tous les comptes bancaires d'une société depuis la base de données,
 * toutes connexions confondues (Qonto, Revolut, Ponto, comptes manuels).
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { banking: ['read'] } },
  async ({ companyId }) => NextResponse.json({ accounts: await listBankAccounts(companyId) }),
)
