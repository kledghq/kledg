/**
 * What the user says about the coefficient de déduction
 * (docs/organisme-de-formation.md):
 * - partialVatDeduction: the company makes taxable and exempt operations
 *   and deducts by the coefficient (CGI ann. II art. 205);
 * - for a calendar year (vat_deduction_years): the estimated coefficient de
 *   taxation of a first year, the coefficient d'assujettissement
 *   (art. 206, II), the VAT borne when the books cannot give it, a note;
 * - the VAT treatment of revenue accounts (revenue_account_settings):
 *   taxable, exempt or excluded; null returns the account to the automatic
 *   reading (and removes the row when it holds nothing else).
 * Only the parts sent change. Kledg never files.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ValidationError } from '@/lib/accounting/errors'
import { centsField, optionalText } from '@/lib/api/zod-fields'
import { writeAuditLog } from '@/lib/audit'
import { centsToDecimal } from '@/lib/utils/money'
import { parisDayOf } from '@/lib/accounting/entry-date'
import { taxationOf } from './coefficient'
import { deductedVatOf } from './load-vat-deduction.service'
import { VAT_TREATMENTS } from './revenue'

const percent = (message: string) => z.number({ error: message }).int(message).min(0, message).max(100, message)

/** A class 7 account code or root (7, 70, 706, 7061...). */
export const revenueAccountCode = z
  .string({ error: 'Le compte est requis' })
  .trim()
  .regex(/^7[0-9A-Za-z]{0,19}$/, 'Indiquez un compte de produits (classe 7)')

export const SaveVatDeductionBodySchema = z.object({
  partialVatDeduction: z.boolean().optional(),
  year: z.number({ error: 'Année invalide' }).int('Année invalide').min(2000, 'Année invalide').max(2100, 'Année invalide').optional(),
  estimatedTaxationPercent: percent('Le coefficient estimé est un pourcentage entier de 0 à 100').nullable().optional(),
  assujettissementPercent: percent('Le coefficient d’assujettissement est un pourcentage entier de 0 à 100').optional(),
  incurredVatCents: centsField({ min: 0, negative: 'La TVA supportée ne peut pas être négative' }).nullable().optional(),
  note: optionalText(1000),
  accounts: z
    .array(z.object({ accountCode: revenueAccountCode, vatTreatment: z.enum(VAT_TREATMENTS, { error: 'Traitement inconnu : taxable, exempt ou excluded' }).nullable() }))
    .max(200, 'Au plus 200 comptes à la fois')
    .optional(),
})
export type SaveVatDeductionBody = z.infer<typeof SaveVatDeductionBodySchema>

const YEAR_FIELDS = ['estimatedTaxationPercent', 'assujettissementPercent', 'incurredVatCents', 'note'] as const

/**
 * The years whose applied coefficient this save changes after VAT was
 * already deducted in them (vat_deduction_years.coefficientChangedOn): the
 * estimate or the coefficient d'assujettissement of a year that has
 * started, or the deduction by coefficient switched on or off during the
 * current year. Their VAT borne then has to be entered: it no longer reads
 * back from the VAT deducted (load-vat-deduction.service.ts).
 */
async function yearsChangedAfterDeductions(companyId: string, body: SaveVatDeductionBody, today: string): Promise<number[]> {
  const currentYear = Number(today.slice(0, 4))
  const candidates = new Set<number>()
  if (body.year !== undefined && body.year <= currentYear && (body.estimatedTaxationPercent !== undefined || body.assujettissementPercent !== undefined)) {
    const row = await prisma.vatDeductionYear.findUnique({
      where: { companyId_year: { companyId, year: body.year } },
      select: { estimatedTaxationPercent: true, assujettissementPercent: true },
    })
    // The estimate applies only to a year without a definitive coefficient the year before (provisionalTaxation)
    const estimateChanged =
      body.estimatedTaxationPercent !== undefined &&
      body.estimatedTaxationPercent !== (row?.estimatedTaxationPercent ?? null) &&
      (await taxationOf(companyId, `${body.year - 1}-01-01`, `${body.year - 1}-12-31`)).percent === null
    const assujettissementChanged = body.assujettissementPercent !== undefined && body.assujettissementPercent !== (row?.assujettissementPercent ?? 100)
    if (estimateChanged || assujettissementChanged) candidates.add(body.year)
  }
  if (body.partialVatDeduction !== undefined) {
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { partialVatDeduction: true } })
    if (company && company.partialVatDeduction !== body.partialVatDeduction) candidates.add(currentYear)
  }
  const changed: number[] = []
  for (const year of candidates) {
    const until = year < currentYear ? `${year}-12-31` : today
    if ((await deductedVatOf(companyId, `${year}-01-01`, until)) !== 0) changed.push(year)
  }
  return changed
}

export async function saveVatDeduction(companyId: string, body: SaveVatDeductionBody, options: { userId?: string; now?: Date } = {}): Promise<{ saved: string[] }> {
  const yearFields = YEAR_FIELDS.filter((key) => body[key] !== undefined)
  if (yearFields.length > 0 && body.year === undefined) throw new ValidationError('Indiquez l’année des coefficients.')
  const today = parisDayOf(options.now ?? new Date())
  const changedYears = await yearsChangedAfterDeductions(companyId, body, today)
  if (body.accounts && new Set(body.accounts.map((a) => a.accountCode)).size !== body.accounts.length) {
    throw new ValidationError('Un compte figure deux fois.')
  }

  const saved: string[] = []
  await prisma.$transaction(async (tx) => {
    if (body.partialVatDeduction !== undefined) {
      await tx.company.update({ where: { id: companyId }, data: { partialVatDeduction: body.partialVatDeduction } })
      saved.push('partialVatDeduction')
    }
    if (body.year !== undefined && yearFields.length > 0) {
      const data = {
        ...(body.estimatedTaxationPercent !== undefined ? { estimatedTaxationPercent: body.estimatedTaxationPercent } : {}),
        ...(body.assujettissementPercent !== undefined ? { assujettissementPercent: body.assujettissementPercent } : {}),
        ...(body.incurredVatCents !== undefined ? { incurredVat: body.incurredVatCents === null ? null : centsToDecimal(body.incurredVatCents) } : {}),
        ...(body.note !== undefined ? { note: body.note } : {}),
      }
      await tx.vatDeductionYear.upsert({
        where: { companyId_year: { companyId, year: body.year } },
        create: { ...data, companyId, year: body.year, createdById: options.userId ?? null },
        update: data,
      })
      saved.push(...yearFields)
    }
    // Keep the first day the applied coefficient changed (an existing marker is not moved)
    for (const year of changedYears) {
      await tx.vatDeductionYear.upsert({
        where: { companyId_year: { companyId, year } },
        create: { companyId, year, coefficientChangedOn: new Date(`${today}T00:00:00.000Z`), createdById: options.userId ?? null },
        update: {},
      })
      await tx.vatDeductionYear.updateMany({ where: { companyId, year, coefficientChangedOn: null }, data: { coefficientChangedOn: new Date(`${today}T00:00:00.000Z`) } })
    }
    const accounts = body.accounts ?? []
    const existingRows = accounts.length
      ? await tx.revenueAccountSetting.findMany({ where: { companyId, accountCode: { in: accounts.map((a) => a.accountCode) } }, select: { accountCode: true, trainingOrigin: true } })
      : []
    const existingByCode = new Map(existingRows.map((r) => [r.accountCode, r]))
    for (const account of accounts) {
      const where = { companyId_accountCode: { companyId, accountCode: account.accountCode } }
      const existing = existingByCode.get(account.accountCode)
      if (account.vatTreatment === null && existing && existing.trainingOrigin === null) {
        await tx.revenueAccountSetting.delete({ where })
      } else if (account.vatTreatment !== null || existing) {
        await tx.revenueAccountSetting.upsert({ where, create: { companyId, accountCode: account.accountCode, vatTreatment: account.vatTreatment }, update: { vatTreatment: account.vatTreatment } })
      }
    }
    if (accounts.length > 0) saved.push('accounts')
  })

  await writeAuditLog('info', 'VAT deduction settings saved', {
    action: 'SAVE_VAT_DEDUCTION',
    companyId,
    metadata: { year: body.year ?? null, fields: saved, accounts: body.accounts?.length ?? 0, coefficientChangedYears: changedYears },
  })
  return { saved }
}
