/**
 * What the employer enters for the taxe sur les salaires of a year
 * (payroll_tax_years.data): the books hold the total of the salaries, not
 * each employee's annual base, and the brackets apply per employee
 * (CGI art. 231, 2 bis). Pure (zod only); a stored value that does not
 * parse falls back to an empty year.
 */

import { z } from 'zod'

const cents = z.number({ error: 'Montant invalide' }).int('Montant en centimes').min(0, 'Pas de montant négatif').max(100_000_000_000, 'Montant trop élevé')

export const PayrollTaxDataSchema = z.object({
  /** Annual base of each employee: the remunerations retained for the CSG on activity income (art. 231, 1), without the 1,75 % abatement. */
  employees: z
    .array(z.object({ id: z.string().min(1).max(40), label: z.string().trim().min(1, 'Le libellé est requis').max(120), baseCents: cents }))
    .max(500, '500 salariés au plus')
    .default([]),
  /** Association, foundation, union or mutual entitled to the abattement of art. 1679 A. */
  association: z.boolean().default(false),
  /**
   * Share of the receipts without a right to deduct entered, in percent with two decimals at most (10,4):
   * first year, receipts outside the scope of VAT the books do not read; null: from the books of the year
   * before. The liability compares it exactly with 10 % (CGI art. 231, 1), the rapport takes its whole part.
   */
  ratioPercent: z
    .number()
    .min(0)
    .max(100)
    .refine((v) => Number.isInteger(Math.round(v * 100)) && Math.abs(v * 100 - Math.round(v * 100)) < 1e-9, 'Le rapport a deux décimales au plus.')
    .nullable()
    .default(null),
  /** Tax of the year before when Kledg does not hold it: decides the frequency of the relevés. */
  previousYearTaxCents: cents.nullable().default(null),
  note: z.string().max(2000).nullable().default(null),
})
export type PayrollTaxInput = z.input<typeof PayrollTaxDataSchema>

/**
 * What the save wrote from the computation, for the deadline calendar
 * (lib/deadlines), which reads no books: liability, frequency of the
 * relevés and amount of the year. Refreshed at every save and on the page.
 */
export const PayrollTaxComputedSchema = z.object({
  liable: z.boolean(),
  frequency: z.enum(['monthly', 'quarterly', 'annual']),
  dueCents: z.number().int().min(0),
})
export type PayrollTaxComputed = z.infer<typeof PayrollTaxComputedSchema>

export const StoredPayrollTaxSchema = PayrollTaxDataSchema.extend({ computed: PayrollTaxComputedSchema.nullable().default(null) })
export type PayrollTaxData = z.infer<typeof PayrollTaxDataSchema>

export function parsePayrollTaxData(json: unknown): PayrollTaxData & { computed: PayrollTaxComputed | null } {
  const parsed = StoredPayrollTaxSchema.safeParse(json ?? {})
  return parsed.success ? parsed.data : StoredPayrollTaxSchema.parse({})
}
