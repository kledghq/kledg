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

export async function saveVatDeduction(companyId: string, body: SaveVatDeductionBody, options: { userId?: string } = {}): Promise<{ saved: string[] }> {
  const yearFields = YEAR_FIELDS.filter((key) => body[key] !== undefined)
  if (yearFields.length > 0 && body.year === undefined) throw new ValidationError('Indiquez l’année des coefficients.')
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
    metadata: { year: body.year ?? null, fields: saved, accounts: body.accounts?.length ?? 0 },
  })
  return { saved }
}
