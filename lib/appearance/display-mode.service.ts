/**
 * Display mode of the signed-in user (GET and PUT /api/account/display-mode,
 * the company layouts, the company creation wizard).
 *
 * Invariant: the mode belongs to one user. Every query is keyed by the
 * session user's id, like the chart colours stored in the same row
 * (user_preferences, lib/appearance/appearance.service.ts). A user who never
 * chose reads as 'expert', so existing users see no change. The mode grants
 * nothing: permissions stay tied to the company roles.
 */

import { prisma } from '@/lib/prisma'
import { enforceRateLimit } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { DEFAULT_DISPLAY_MODE, parseDisplayMode, type DisplayMode } from './display-mode'

export interface DisplayModeView {
  mode: DisplayMode
  /** False until the user chose a mode (onboarding step, sidebar switch or settings). */
  chosen: boolean
}

export async function getDisplayMode(userId: string): Promise<DisplayModeView> {
  const row = await prisma.userPreference.findUnique({ where: { userId }, select: { displayMode: true } })
  const stored = parseDisplayMode(row?.displayMode)
  return { mode: stored ?? DEFAULT_DISPLAY_MODE, chosen: stored !== null }
}

/** Saves the user's mode. Leaves the chart colours of the row as they are. */
export async function saveDisplayMode(actor: { id: string }, mode: DisplayMode): Promise<DisplayModeView> {
  // Same budget as the other Apparence settings: a preference, saved by a click.
  await enforceRateLimit('account-appearance', actor.id)
  await prisma.userPreference.upsert({
    where: { userId: actor.id },
    create: { userId: actor.id, displayMode: mode },
    update: { displayMode: mode },
  })
  return { mode, chosen: true }
}

/**
 * The mode of the user of the request, for the layouts. A database error
 * here must not break every page: the interface then shows the expert mode,
 * which reaches every page.
 */
export async function displayModeForUser(userId: string | null | undefined): Promise<DisplayModeView> {
  if (!userId) return { mode: DEFAULT_DISPLAY_MODE, chosen: false }
  try {
    return await getDisplayMode(userId)
  } catch (error) {
    logger.warn('Display mode not loaded, expert mode used:', (error as Error).message)
    return { mode: DEFAULT_DISPLAY_MODE, chosen: false }
  }
}

/**
 * Whether the company wizard asks "Comment voulez-vous utiliser Kledg ?":
 * on the first run of a user (no company membership yet) who never chose a
 * mode. Existing users are not asked; they keep the expert mode and find
 * the switch in the sidebar.
 */
export async function shouldAskDisplayMode(userId: string): Promise<boolean> {
  const [{ chosen }, memberships] = await Promise.all([getDisplayMode(userId), prisma.member.count({ where: { userId } })])
  return !chosen && memberships === 0
}
