import { z } from 'zod'
import { adminRoute, NextResponse } from '@/lib/api/route'
import { writeAuditLog } from '@/lib/audit'
import { loadConnection } from '@/lib/updates/connection'
import { guardWrite, requireGitHubDeploy } from '@/lib/updates/guard'
import { mergeUpdatePull, mergeUpstream } from '@/lib/updates/service'
import { getDeployedVersion } from '@/lib/updates/version'

export const dynamic = 'force-dynamic'

const installSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('pull'),
    pullNumber: z.number().int().positive(),
    headSha: z.string().regex(/^[0-9a-f]{40}$/i, 'Commit invalide'),
    confirm: z.literal(true),
  }),
  z.object({ mode: z.literal('merge-upstream'), confirm: z.literal(true) }),
])

/**
 * Installs the update after the admin confirmed it: merges the update pull
 * request (only if its head is still the confirmed commit), or syncs a fork
 * without the workflow. The host then deploys and applies the migrations.
 */
export const POST = adminRoute({ body: installSchema }, async ({ request, user, body }) => {
  await guardWrite(request, user)
  requireGitHubDeploy()
  const conn = await loadConnection()
  const previous = getDeployedVersion().commit
  const result =
    body.mode === 'pull' ? await mergeUpdatePull(conn, body.pullNumber, body.headSha) : await mergeUpstream(conn)
  await writeAuditLog('info', 'Kledg update installed', {
    action: 'UPDATES_MERGE',
    metadata: {
      repository: `${conn.repository.owner}/${conn.repository.repo}`,
      mode: body.mode,
      pullNumber: body.mode === 'pull' ? body.pullNumber : null,
      previousCommit: previous,
      newCommit: result.sha,
    },
  })
  return NextResponse.json({ sha: result.sha, previousCommit: previous })
})
