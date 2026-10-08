/**
 * Zod building blocks for request bodies and query strings validated by the
 * route wrappers (lib/api/route.ts `body` and `query` options). Messages are
 * French: they reach the user as the 400 error.
 */

import { z } from 'zod'
import { calendarDayOf } from '@/lib/utils/date'
import { amountTooLargeMessage, MAX_AMOUNT_CENTS } from '@/lib/utils/money'
import { ValidationError } from '@/lib/accounting/errors'
import { ACCOUNT_CODE_MESSAGE, ACCOUNT_CODE_PATTERN } from '@/lib/accounting/account-code'

/** An account number in the one format of lib/accounting/account-code.ts. */
export const accountCode = (message: string = ACCOUNT_CODE_MESSAGE) => z.string().trim().regex(ACCOUNT_CODE_PATTERN, message)

/** An account number of a class or root (`'6'`, `'7'`), in the same format. */
export const accountCodeOfClass = (prefix: string, message: string) =>
  accountCode(message).refine((code) => code.startsWith(prefix), message)

/** Default zod messages in French (schemas may still set their own): passed to every parse of request input. */
export const FRENCH_ERRORS = z.locales.fr().localeError

/**
 * Validates request input the route wrappers cannot parse themselves (the
 * fields of a multipart form): a 400 listing the issues with their path,
 * exactly like the wrappers' `body` and `query` options.
 */
export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value, { error: FRENCH_ERRORS })
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; '),
    )
  }
  return parsed.data
}

/** A form field holding JSON (mappings sent along a file), validated by `schema`; absent or '' gives undefined. */
export const jsonFormField = <T>(schema: z.ZodType<T>, message: string) =>
  z
    .string({ error: message })
    .optional()
    .transform((value, ctx): T | undefined => {
      if (!value) return undefined
      let json: unknown
      try {
        json = JSON.parse(value)
      } catch {
        ctx.addIssue({ code: 'custom', message })
        return z.NEVER
      }
      const parsed = schema.safeParse(json, { error: FRENCH_ERRORS })
      if (!parsed.success) {
        ctx.addIssue({ code: 'custom', message })
        return z.NEVER
      }
      return parsed.data
    })

/**
 * An amount in integer cents. Bounded by the amount columns
 * (MAX_AMOUNT_CENTS, Decimal(15, 2)) or a tighter `max`, so an overflow is a
 * French 400 ("Montant trop élevé"), never a database error. `min` defaults
 * to -max; 0 refuses negative amounts with `negative`. The bounds are checked
 * before the integer check: 1e17 is too large, not "not an integer".
 */
export const centsField = (options: { min?: number; max?: number; invalid?: string; negative?: string; integer?: string } = {}) => {
  const max = Math.min(options.max ?? MAX_AMOUNT_CENTS, MAX_AMOUNT_CENTS)
  const min = options.min ?? -max
  return z
    .number({ error: options.invalid ?? 'Montant invalide' })
    .max(max, { error: amountTooLargeMessage(max), abort: true })
    .min(min, { error: min >= 0 ? (options.negative ?? 'Le montant ne peut pas être négatif') : amountTooLargeMessage(max), abort: true })
    .int(options.integer ?? 'Montant en centimes entiers')
}

/**
 * A calendar day sent as yyyy-mm-dd (or an ISO timestamp, read as its UTC
 * calendar day like everywhere else, lib/utils/date.ts calendarDayOf).
 * Output: the yyyy-mm-dd string.
 */
export const calendarDay = (message = 'Date invalide') =>
  z.string({ error: message }).transform((value, ctx) => {
    const day = calendarDayOf(value)
    if (!day) {
      ctx.addIssue({ code: 'custom', message })
      return z.NEVER
    }
    return day
  })

/** Like calendarDay, but '' and null clear the date (output null); undefined leaves it unchanged. */
export const optionalCalendarDay = (message = 'Date invalide') =>
  z
    .union([z.literal(''), z.null(), calendarDay(message)], { error: message })
    .transform((value) => (value === '' ? null : value))
    .optional()

/** Optional text where '' and null both mean "no value" (output null); undefined leaves it unchanged. */
export const optionalText = (max: number) =>
  z
    .string()
    .max(max, `${max} caractères au maximum`)
    .nullable()
    .transform((value) => (value?.trim() ? value.trim() : null))
    .optional()

/** A non-empty list of ids (bulk actions), bounded so one request stays reasonable. */
export const idList = (max: number, message = 'Sélectionnez au moins un élément.') =>
  z.array(z.string({ error: 'Identifiant invalide' }), { error: message }).min(1, message).max(max, `${max} éléments au maximum par envoi.`)

/**
 * A body that takes one of two shapes depending on whether `key` is present
 * (e.g. reconcile with new entry lines, or with an existing entry): the issues
 * of the chosen shape are reported with their path, unlike a plain union that
 * only says the input is invalid. A missing body is validated as `{}`.
 */
export function byPresenceOf<A, B>(key: string, present: z.ZodType<A>, absent: z.ZodType<B>) {
  return z.unknown().transform((input, ctx): A | B => {
    const value = input ?? {}
    const schema: z.ZodType<A | B> = typeof value === 'object' && key in value ? present : absent
    const parsed = schema.safeParse(value, { error: FRENCH_ERRORS })
    if (!parsed.success) {
      for (const issue of parsed.error.issues) ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path })
      return z.NEVER
    }
    return parsed.data
  })
}
