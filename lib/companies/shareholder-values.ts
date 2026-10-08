/**
 * Values of a shareholder (capital table): the share percentage,
 * Decimal(5, 2), and the capital held, Decimal(15, 2). Both have two
 * decimals, so they are handled as integers of hundredths (cents of euro,
 * hundredths of a percent) and never as floating point numbers: three
 * shareholders at 33.33 % and one at 0.01 % make exactly 100 %.
 *
 * A third decimal is rounded half away from zero, like PostgreSQL does
 * when it stores a numeric(5, 2) (33.333 is stored 33.33).
 */

import { ValidationError } from '@/lib/accounting/errors'
import { centsToDecimal, toCents } from '@/lib/utils/money'

/** 100 % in hundredths of a percent. */
const FULL = 10_000

/** Hundredths of a decimal from JSON (number or string, "12,5" accepted), or null. */
function hundredthsOf(value: unknown): number | null {
  if (typeof value === 'number') return toCents(value)
  if (typeof value === 'string') return toCents(value.trim().replace(',', '.'))
  if (value !== null && typeof value === 'object') return toCents(value.toString())
  return null
}

/** A share percentage in hundredths (0 to 10000), or a French ValidationError. */
export function parseSharePercentage(value: unknown): number {
  const hundredths = hundredthsOf(value)
  if (hundredths === null || hundredths < 0 || hundredths > FULL) {
    throw new ValidationError('Le pourcentage de participation doit être entre 0 et 100')
  }
  return hundredths
}

/**
 * Checks that the shareholders' percentages, with the new one, do not exceed
 * 100 %. `others` are the stored percentages (Prisma Decimal) of the other
 * shareholders of the company.
 */
export function assertTotalPercentage(others: Array<{ toString(): string }>, hundredths: number): void {
  const total = others.reduce<number>((sum, value) => sum + (toCents(value) ?? 0), 0) + hundredths
  if (total > FULL) {
    throw new ValidationError(
      `Le total des pourcentages ne peut pas dépasser 100 %. Total actuel : ${centsToDecimal(total).replace('.', ',')} %`,
    )
  }
}

/** Hundredths as the decimal string Prisma stores ("33.33"). */
export function hundredthsToDecimal(hundredths: number): string {
  return centsToDecimal(hundredths)
}

/** Capital held, as a decimal string for Prisma; null when empty; a French ValidationError when invalid. */
export function parseCapitalAmount(value: unknown): string | null {
  if (!value) return null
  const cents = hundredthsOf(value)
  if (cents === null) throw new ValidationError('Le montant du capital détenu est invalide')
  return centsToDecimal(cents)
}
