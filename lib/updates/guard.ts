import type { NextRequest } from 'next/server'
import { ValidationError } from '@/lib/accounting/errors'
import { assertActionAllowed, type InstanceActor } from '@/lib/instance'
import { assertSameOrigin } from '@/lib/api/same-origin'
import { enforceRateLimit } from '@/lib/rate-limit'
import { getDeployedVersion } from './version'

/** Token-backed reads (status of the workflow and pull request). */
export async function guardRead(userId: string): Promise<void> {
  await enforceRateLimit('updates-read', userId)
}

/** Actions on GitHub: allowed by the instance policy, same origin, rate limited. */
export async function guardWrite(request: NextRequest, user: InstanceActor): Promise<void> {
  await assertActionAllowed('manage-updates', user)
  assertSameOrigin(request)
  await enforceRateLimit('updates-write', user.id)
}

/**
 * One-click updates merge a pull request and count on the host to redeploy
 * the merge (Vercel, Railway and Render deploying from GitHub, or any host
 * declared with KLEDG_DEPLOYS_FROM_GITHUB=true, lib/updates/hosting.ts).
 * Other installs update by hand.
 */
export function requireGitHubDeploy(): void {
  if (!getDeployedVersion().deploysFromGitHub) {
    throw new ValidationError(
      "Cette instance n'est pas redéployée depuis GitHub : mettez-la à jour avec les commandes indiquées sur la page.",
    )
  }
}
