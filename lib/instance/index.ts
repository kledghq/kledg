/**
 * Instance restrictions as Kledg uses them: every action an instance may
 * restrict is checked here, against the instance policy (./policy.ts, the
 * file a customised deployment replaces). With the default policy every
 * check passes. See docs/extension-points.md.
 */

import { ForbiddenError } from '@/lib/accounting/errors'
import { actionRefusalMessage, companyCreationRefusal, isActionAllowed } from './policy'
import type { InstanceAction, InstanceActor } from './types'

export { actionRefusalMessage, afterCompanyCreated, companyCreationRefusal, companyWriteRefusal, isActionAllowed } from './policy'
export { INSTANCE_ACTIONS, type ActionRefusal, type InstanceAction, type InstanceActor } from './types'
export { isInstancePublicPage, isSelfAuthenticatedApiPath } from './api-paths'

/** Throws a 403 ForbiddenError with the policy's message when `action` is refused to `actor`. */
export async function assertActionAllowed(action: InstanceAction, actor: InstanceActor | null = null): Promise<void> {
  if (!(await isActionAllowed(action, actor))) {
    throw new ForbiddenError(actionRefusalMessage(action))
  }
}

/**
 * Throws a 403 ForbiddenError when the policy refuses `actor` the creation
 * of a company; its `link` (an upgrade page) is in the response details.
 */
export async function assertCompanyCreationAllowed(actor: InstanceActor): Promise<void> {
  const refusal = await companyCreationRefusal(actor)
  if (refusal) throw new ForbiddenError(refusal.message).withDetails(refusal.link ? { link: refusal.link } : {})
}

const AUTH_PATH_ACTIONS: Readonly<Record<string, InstanceAction>> = {
  '/change-password': 'change-password',
  '/set-password': 'change-password',
  '/reset-password': 'change-password',
  '/request-password-reset': 'change-password',
  '/forget-password': 'change-password',
  '/change-email': 'change-email',
  '/delete-user': 'delete-account',
  '/organization/invite-member': 'invite-member',
  '/organization/delete': 'delete-company',
}

/**
 * The restrictable action a Better Auth endpoint performs (path relative to
 * /api/auth), or null. Checked by the auth hook of lib/auth.ts.
 */
export function authActionOf(path: string): InstanceAction | null {
  if (AUTH_PATH_ACTIONS[path]) return AUTH_PATH_ACTIONS[path]
  if (path.startsWith('/admin/')) return 'manage-users'
  return null
}
