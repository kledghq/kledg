/**
 * Chart colour preferences of the signed-in user (GET and PUT
 * /api/account/appearance, the root layout).
 *
 * Invariant: preferences belong to one user. Every query is keyed by the
 * session user's id; there is no id to pass, so no request reads or writes
 * another user's colours. What is stored has been validated by
 * lib/appearance/schema.ts, and what is read is validated again.
 */

import type { CSSProperties } from 'react'
import { prisma } from '@/lib/prisma'
import { enforceRateLimit } from '@/lib/rate-limit'
import { actionRefusalMessage, assertActionAllowed, isActionAllowed, type InstanceActor } from '@/lib/instance'
import { logger } from '@/lib/logger'
import { chartStyleVariables, DEFAULT_APPEARANCE, type AppearancePreferences } from './palette'
import { parseStoredAppearance, toPreferences, toStoredAppearance, type AppearanceValues } from './schema'

export interface AppearanceView {
  appearance: AppearancePreferences
  /** True when the user never saved colours: the defaults (Sobre). */
  isDefault: boolean
  /** Whether this instance lets the user change them (instance policy, `change-appearance`). */
  canChange: boolean
  /** The policy's French message when it refuses. */
  refusal: string | null
}

async function readAppearance(userId: string): Promise<{ appearance: AppearancePreferences; isDefault: boolean }> {
  const row = await prisma.userPreference.findUnique({ where: { userId }, select: { appearance: true } })
  // No row, or a row holding only the display mode (lib/appearance/display-mode.service.ts): the defaults.
  return row?.appearance != null
    ? { appearance: parseStoredAppearance(row.appearance), isDefault: false }
    : { appearance: DEFAULT_APPEARANCE, isDefault: true }
}

export async function getAppearance(actor: InstanceActor): Promise<AppearanceView> {
  const [stored, canChange] = await Promise.all([readAppearance(actor.id), isActionAllowed('change-appearance', actor)])
  return { ...stored, canChange, refusal: canChange ? null : actionRefusalMessage('change-appearance') }
}

/** Saves the user's colours (a preset, or a custom palette). Refused by an instance that restricts `change-appearance`. */
export async function saveAppearance(actor: InstanceActor, input: AppearanceValues): Promise<AppearanceView> {
  await assertActionAllowed('change-appearance', actor)
  await enforceRateLimit('account-appearance', actor.id)
  const appearance = toPreferences(input)
  const stored = toStoredAppearance(appearance)
  await prisma.userPreference.upsert({
    where: { userId: actor.id },
    create: { userId: actor.id, appearance: stored },
    update: { appearance: stored },
  })
  return { appearance, isDefault: false, canChange: true, refusal: null }
}

/**
 * Inline style of <html> for the user of the request (root layout): the
 * chart colour variables, or nothing (no user, defaults). A database error
 * here must not break every page: the charts then keep the default colours.
 */
export async function chartStyleForUser(userId: string | null | undefined): Promise<CSSProperties | undefined> {
  if (!userId) return undefined
  try {
    const { appearance } = await readAppearance(userId)
    const vars = chartStyleVariables(appearance)
    return Object.keys(vars).length ? (vars as CSSProperties) : undefined
  } catch (error) {
    logger.warn('Chart colours not loaded, defaults used:', (error as Error).message)
    return undefined
  }
}
