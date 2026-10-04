/**
 * Instance policy: the server side extension point of an instance.
 *
 * A deployment that customises Kledg (a fork) replaces this file to restrict
 * actions, possibly per user, and to declare API routes that authenticate
 * requests themselves. Kledg itself allows everything and declares nothing,
 * so this file never changes the behaviour of a standard instance. Keep it
 * free of imports beyond pure modules: the request proxy (proxy.ts) reads
 * SELF_AUTHENTICATED_API_ROUTES. See docs/extension-points.md.
 */

import type { InstanceAction, InstanceActor } from './types'

/**
 * Whether `actor` may perform `action` on this instance. `actor` is null for
 * anonymous requests (password reset request, first-run setup, emails).
 */
export async function isActionAllowed(action: InstanceAction, actor: InstanceActor | null = null): Promise<boolean> {
  void action
  void actor
  return true
}

/** French message of the 403 answered when `action` is refused. */
export function actionRefusalMessage(action: InstanceAction): string {
  void action
  return "Cette action est désactivée sur cette instance. Contactez l'administrateur de l'instance."
}

/**
 * API paths (prefixes of the request path) served by routes that
 * authenticate requests themselves, with the reason. The proxy lets them
 * through without a session and the route architecture test
 * (lib/api/__tests__/routes.test.ts) accepts their handlers unwrapped.
 */
export const SELF_AUTHENTICATED_API_ROUTES: Readonly<Record<string, string>> = {}
