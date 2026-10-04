import { z } from 'zod'
import { adminRoute, NextResponse } from '@/lib/api/route'
import { ValidationError } from '@/lib/accounting/errors'
import { writeAuditLog } from '@/lib/audit'
import {
  deleteConnection,
  getConnectionSummary,
  saveConnection,
  validateToken,
} from '@/lib/updates/connection'
import { isValidOwner, isValidRepo } from '@/lib/updates/github'
import { guardWrite, requireGitHubDeploy } from '@/lib/updates/guard'
import { getDeployedVersion } from '@/lib/updates/version'

export const dynamic = 'force-dynamic'

const connectSchema = z.object({
  token: z.string().trim().min(1, 'Jeton requis').max(300),
  owner: z.string().trim().max(39).optional(),
  repo: z.string().trim().max(100).optional(),
})

/** Validates the token against the instance repository, then stores it encrypted. */
export const POST = adminRoute({ body: connectSchema }, async ({ request, user, body }) => {
  await guardWrite(request, user)
  requireGitHubDeploy()

  // The repository the host deploys from (Vercel, Railway, Render) wins: the token cannot be pointed elsewhere.
  const detected = getDeployedVersion().repository
  const target = detected ?? { owner: body.owner ?? '', repo: body.repo ?? '' }
  if (!isValidOwner(target.owner) || !isValidRepo(target.repo)) {
    throw new ValidationError('Indiquez le dépôt GitHub de votre instance (propriétaire et nom du dépôt).')
  }

  const validation = await validateToken(body.token, target)
  await saveConnection(body.token, validation, user.id)
  await writeAuditLog('info', `GitHub connected for updates: ${target.owner}/${target.repo}`, {
    action: 'UPDATES_CONNECT',
    metadata: { repository: `${target.owner}/${target.repo}`, kind: validation.kind },
  })

  return NextResponse.json({ connection: await getConnectionSummary(), checks: validation.checks })
})

export const DELETE = adminRoute({}, async ({ request, user }) => {
  await guardWrite(request, user)
  const removed = await deleteConnection()
  if (removed) {
    await writeAuditLog('info', 'GitHub disconnected for updates', { action: 'UPDATES_DISCONNECT' })
  }
  return NextResponse.json({ ok: true })
})
