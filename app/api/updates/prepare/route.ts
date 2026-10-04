import { adminRoute, NextResponse } from '@/lib/api/route'
import { writeAuditLog } from '@/lib/audit'
import { loadConnection } from '@/lib/updates/connection'
import { guardWrite, requireGitHubDeploy } from '@/lib/updates/guard'
import { getChannel, prepareUpdate } from '@/lib/updates/service'

export const dynamic = 'force-dynamic'

/** Starts the "Update from Kledg" workflow (installing it first in copies that lack it). */
export const POST = adminRoute({}, async ({ request, user }) => {
  await guardWrite(request, user)
  requireGitHubDeploy()
  const conn = await loadConnection()
  const result = await prepareUpdate(conn, await getChannel(conn))
  await writeAuditLog('info', 'Kledg update prepared', {
    action: 'UPDATES_PREPARE',
    metadata: { repository: `${conn.repository.owner}/${conn.repository.repo}`, ...result },
  })
  return NextResponse.json(result)
})
