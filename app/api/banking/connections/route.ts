import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { listBankConnections } from '@/lib/banking/list-bank-connections.service'
import { bankSyncPause } from '@/lib/banking/sync-pause'

/**
 * Récupère toutes les connexions bancaires d'une société (une par
 * fournisseur), avec leur état : dernière synchronisation, erreur,
 * expiration de l'accès bancaire. Never returns credentials.
 * `syncPause`: why the bank sync of a read-only company is paused, or null.
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { banking: ['read'] } },
  async ({ companyId }) => {
    const [connections, syncPause] = await Promise.all([listBankConnections(companyId), bankSyncPause(companyId)])
    return NextResponse.json({ connections, syncPause })
  },
)
