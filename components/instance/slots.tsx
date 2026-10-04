/**
 * Instance UI slots: the interface side extension point of an instance.
 *
 * Kledg renders these components in its layouts and pages; here they render
 * nothing and filter nothing. A deployment that customises Kledg (a fork)
 * replaces this file to add its own interface (a banner, a card on the
 * login page, a floating panel on company pages) and to hide user menu
 * entries, without touching Kledg's layouts. All slots are server
 * components; they may render client components and pass them server
 * actions. See docs/extension-points.md, and lib/instance/policy.ts for the
 * server side.
 */

import type { InstanceActor } from '@/lib/instance/types'
import type { UserMenuItem } from '@/components/layout/user-menu'
import type { InstanceSettingsLinks } from '@/components/layout/settings-nav-config'

/** Above the header of every page of the application frame (company and settings pages). */
export function InstanceBanner(props: { user: InstanceActor }) {
  void props
  return null
}

/**
 * Above the sign-in card on /login. `redirectTo` is the checked same-origin
 * path to open after signing in.
 */
export function LoginExtra(props: { redirectTo: string }) {
  void props
  return null
}

/**
 * After the content of company pages (a client component reads the company
 * from the URL with useParams). Floating UI goes bottom right: the account
 * menu opens bottom left. Give its root the `data-instance-overlay`
 * attribute so it stays usable above the statement import dialog.
 */
export function CompanyOverlay(props: { user: InstanceActor }) {
  void props
  return null
}

/** The user menu entries (and the matching settings links) shown to `user`. */
export async function filterUserMenu(items: UserMenuItem[], user: InstanceActor): Promise<UserMenuItem[]> {
  void user
  return items
}

/**
 * The instance's own versions of the administrators' pages for `user`, who
 * is not an instance administrator, by user menu entry ("instance", "users",
 * "updates"...): the settings sidebar then shows the "Instance" group with
 * these links (and the version line links to "updates"). Kledg: none.
 */
export async function instanceSettingsLinks(user: InstanceActor): Promise<InstanceSettingsLinks | null> {
  void user
  return null
}
