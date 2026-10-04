import { companyRoute, fromQuery, NextResponse } from '@/lib/api/route'
import { listPontoInstitutions } from '@/lib/banking/ponto-connection.service'

/**
 * GET /api/banking/institutions?companyId=
 * French banks reachable through Ponto, for the bank picker (name, logo
 * served by Ponto, connector status, consent lifetime). Cached server side.
 */
export const GET = companyRoute({ company: fromQuery(), permission: { banking: ['read'] } }, async () => {
  const institutions = await listPontoInstitutions('FR')
  return NextResponse.json({ institutions }, { headers: { 'Cache-Control': 'private, max-age=3600' } })
})
