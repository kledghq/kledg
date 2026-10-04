import { adminRoute, NextResponse } from '@/lib/api/route'
import { getDeployedVersion } from '@/lib/updates/version'

export const dynamic = 'force-dynamic'

/**
 * Version and commit of the deployment answering the request, polled by the
 * "Mises à jour" page to detect the end of a deployment. Admin only: the
 * exact version helps an attacker pick known vulnerabilities, and health
 * checks use /api/health, which says nothing about the version.
 */
export const GET = adminRoute({}, async () => {
  const { version, commit } = getDeployedVersion()
  return NextResponse.json({ version, commit }, { headers: { 'Cache-Control': 'no-store' } })
})
