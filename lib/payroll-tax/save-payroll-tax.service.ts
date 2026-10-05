/**
 * What the employer enters for the taxe sur les salaires of a year
 * (payroll_tax_years): the annual base of each employee, the association
 * abattement, a rapport entered, the tax of the year before. Replaced as a
 * whole; the computation is then written with it (liability, frequency,
 * amount) for the deadline calendar, which reads no books. Kledg never
 * files nor pays.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ValidationError } from '@/lib/accounting/errors'
import { writeAuditLog } from '@/lib/audit'
import { buildPayrollTax, computedOf } from './load-payroll-tax.service'
import { PayrollTaxDataSchema, type PayrollTaxComputed } from './schemas'

export const SavePayrollTaxBodySchema = z.object({
  year: z.number({ error: 'L’année est requise' }).int('Année invalide').min(2000, 'Année invalide').max(2100, 'Année invalide'),
  data: PayrollTaxDataSchema,
})
export type SavePayrollTaxBody = z.input<typeof SavePayrollTaxBodySchema>

export async function savePayrollTax(companyId: string, input: SavePayrollTaxBody, options: { userId?: string; now?: Date } = {}): Promise<{ year: number; computed: PayrollTaxComputed }> {
  const body = SavePayrollTaxBodySchema.parse(input)
  if (new Set(body.data.employees.map((e) => e.id)).size !== body.data.employees.length) throw new ValidationError('Deux salariés ont le même identifiant.')
  const where = { companyId_year: { companyId, year: body.year } }
  await prisma.payrollTaxYear.upsert({ where, create: { companyId, year: body.year, data: body.data, createdById: options.userId ?? null }, update: { data: body.data } })
  // The calendar reads the computation of the saved data (liability, frequency from the year before).
  const { view, core } = await buildPayrollTax(companyId, { year: body.year }, { now: options.now })
  const computed = computedOf(core, view.frequency)
  await prisma.payrollTaxYear.update({ where, data: { data: { ...body.data, computed } } })
  await writeAuditLog('info', `Payroll tax of ${body.year} saved`, {
    action: 'SAVE_PAYROLL_TAX',
    companyId,
    metadata: { year: body.year, employees: body.data.employees.length, dueCents: computed.dueCents },
  })
  return { year: body.year, computed }
}
