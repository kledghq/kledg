/**
 * Fields of a fixed asset as an API or the MCP server sends them, read the
 * same way on creation and on update: amounts as exact cents
 * (Decimal(15, 2), at most two decimals), rates, durations and coefficients
 * as decimal numbers ("33,33" accepted), dates as Date values. Invalid
 * values give a French ValidationError naming the field.
 */

import { ValidationError } from '@/lib/accounting/errors'
import { parseCents, type AmountInput } from '@/lib/utils/money'

/** A rate, duration or coefficient typed as a number or a decimal string ("33,33"); null when empty. */
export function decimalNumber(value: number | string | null | undefined, field: string): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) throw new ValidationError(`${field} invalide`)
    return value
  }
  const text = String(value).trim().replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(text)) throw new ValidationError(`${field} invalide`)
  return Number(text)
}

/** Cents of a positive amount with at most two decimals; null when empty. */
export function amountCents(value: AmountInput, field: string): number | null {
  if (value === null || value === undefined || value === '') return null
  const cents = parseCents(value)
  if (cents === null || cents < 0) throw new ValidationError(`${field} : montant invalide (deux décimales au plus)`)
  return cents
}

/** A date field; null when empty. */
export function dateOf(value: string | Date | null | undefined, field: string): Date | null {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new ValidationError(`${field} invalide`)
  return date
}
