/**
 * Types of the instance extension points (docs/extension-points.md). Pure:
 * usable from server code, client components and the request proxy.
 */

/**
 * Actions an instance may restrict. Each one is checked where Kledg performs
 * it, through `assertActionAllowed` or `isActionAllowed` (lib/instance).
 */
export const INSTANCE_ACTIONS = [
  /** Change, set or reset a password (account settings, reset links). */
  'change-password',
  /** Change the email address of an account. */
  'change-email',
  /** Delete one's own account. */
  'delete-account',
  /** Change one's chart colours (Apparence settings page, PUT /api/account/appearance). */
  'change-appearance',
  /** Delete a company and all its data. */
  'delete-company',
  /**
   * Add a member to a company: by an instance administrator (account
   * creation and welcome email), or by email invitation from a company
   * administrator (lib/rbac/company-invitations.service.ts).
   */
  'invite-member',
  /**
   * Create one's account by accepting a company invitation (the invitee
   * chooses a password on the invitation page). Refused: only people who
   * already have an account can accept; the instance administrator creates
   * the others' accounts. Checked with a null actor.
   */
  'invitation-sign-up',
  /**
   * Remove a member from a company, or leave one: by a member who manages
   * the members of the company (lib/rbac/remove-member.service.ts), or by an
   * instance administrator. Decided per actor (an instance administrator
   * included): a refused actor neither removes a member nor leaves.
   */
  'remove-member',
  /** Administer users (create, ban, change roles) through Better Auth's admin endpoints. */
  'manage-users',
  /** Connect GitHub and install updates from the "Mises à jour" page. */
  'manage-updates',
  /** Connect a bank through its API (Revolut, Ponto). */
  'connect-bank',
  /** Send transactional emails (otherwise they are printed to the server log). */
  'send-email',
  /** First-run setup (/setup): create the first administrator. */
  'setup',
  /**
   * Guided start: the instance welcome page (/welcome), the "Démarrer"
   * checklist of company dashboards and the onboarding hints of empty pages.
   */
  'onboarding',
] as const

export type InstanceAction = (typeof INSTANCE_ACTIONS)[number]

/**
 * The user performing an action, when there is one (null for anonymous
 * requests such as a password reset request or the first-run setup).
 */
export interface InstanceActor {
  id: string
  email: string
  /** Better Auth role: "admin" for instance administrators. */
  role: string | null
}

/**
 * Why an action is refused, for the actions whose refusal depends on more
 * than the action (company creation): a French message, and optionally a
 * link to the page that lifts the refusal (an upgrade page, for instance).
 */
export interface ActionRefusal {
  message: string
  link?: { label: string; href: string }
}

/**
 * A rate limit rule (lib/rate-limit.ts): at most `max` calls per subject in
 * `window` seconds, refused past it with the French `message`.
 */
export interface RateLimitRule {
  window: number
  max: number
  message: string
}
