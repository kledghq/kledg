import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { listBankConnections } from '@/lib/banking/list-bank-connections.service'

/**
 * Récupère toutes les connexions bancaires d'une société (une par
 * fournisseur), avec leur état : dernière synchronisation, erreur,
 * expiration de l'accès bancaire. Never returns credentials.
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { banking: ['read'] } },
  async ({ companyId }) => NextResponse.json({ connections: await listBankConnections(companyId) }),
)
