/**
 * What the training organisation enters for its bilan pédagogique et
 * financier (docs/organisme-de-formation.md):
 * - the frames of a fiscal year the books cannot give (training_reports),
 *   replaced as a whole and validated by TrainingReportDataSchema;
 * - the origin (frame C line) of a revenue account or root
 *   (revenue_account_settings.trainingOrigin) and of a customer
 *   (Tiers.trainingOrigin); null returns it to "to assign".
 * Every row is scoped by the company: a fiscal year or customer of another
 * company is a 404.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { writeAuditLog } from '@/lib/audit'
import { revenueAccountCode } from '@/lib/vat-deduction/save-vat-deduction.service'
import { TRAINING_ORIGIN_CODES } from './origins'
import { TrainingReportDataSchema } from './schemas'

export const SaveTrainingReportBodySchema = z.object({
  fiscalYearId: z.string({ error: 'L’exercice est requis' }).min(1, 'L’exercice est requis').max(64),
  data: TrainingReportDataSchema,
})
export type SaveTrainingReportBody = z.input<typeof SaveTrainingReportBodySchema>

const origin = z.enum(TRAINING_ORIGIN_CODES, { error: 'Ligne du cadre C inconnue' }).nullable()

export const SaveTrainingOriginsBodySchema = z
  .object({
    accounts: z.array(z.object({ accountCode: revenueAccountCode, trainingOrigin: origin })).max(200, 'Au plus 200 comptes à la fois').default([]),
    customers: z.array(z.object({ tiersId: z.string().min(1).max(64), trainingOrigin: origin })).max(500, 'Au plus 500 clients à la fois').default([]),
  })
  .refine((body) => body.accounts.length + body.customers.length > 0, 'Indiquez au moins un compte ou un client.')
export type SaveTrainingOriginsBody = z.input<typeof SaveTrainingOriginsBodySchema>

export async function saveTrainingReport(companyId: string, input: SaveTrainingReportBody, options: { userId?: string } = {}): Promise<{ fiscalYearId: string }> {
  const body = SaveTrainingReportBodySchema.parse(input)
  const fiscalYear = await prisma.fiscalYear.findFirst({ where: { id: body.fiscalYearId, companyId }, select: { id: true } })
  if (!fiscalYear) throw new NotFoundError('Exercice introuvable')
  if (new Set(body.data.specialities.map((s) => s.code)).size !== body.data.specialities.length) throw new ValidationError('Une spécialité figure deux fois.')
  await prisma.trainingReport.upsert({
    where: { companyId_fiscalYearId: { companyId, fiscalYearId: fiscalYear.id } },
    create: { companyId, fiscalYearId: fiscalYear.id, data: body.data, createdById: options.userId ?? null },
    update: { data: body.data },
  })
  await writeAuditLog('info', 'Training report saved', { action: 'SAVE_TRAINING_REPORT', companyId, metadata: { fiscalYearId: fiscalYear.id } })
  return { fiscalYearId: fiscalYear.id }
}

export async function saveTrainingOrigins(companyId: string, input: SaveTrainingOriginsBody): Promise<{ accounts: number; customers: number }> {
  const body = SaveTrainingOriginsBodySchema.parse(input)
  if (new Set(body.accounts.map((a) => a.accountCode)).size !== body.accounts.length) throw new ValidationError('Un compte figure deux fois.')
  const tiersIds = [...new Set(body.customers.map((c) => c.tiersId))]
  if (tiersIds.length !== body.customers.length) throw new ValidationError('Un client figure deux fois.')
  const owned = tiersIds.length ? await prisma.tiers.findMany({ where: { companyId, id: { in: tiersIds }, kind: 'CUSTOMER' }, select: { id: true } }) : []
  if (owned.length !== tiersIds.length) throw new NotFoundError('Client introuvable')

  await prisma.$transaction(async (tx) => {
    const existing = body.accounts.length
      ? await tx.revenueAccountSetting.findMany({ where: { companyId, accountCode: { in: body.accounts.map((a) => a.accountCode) } }, select: { accountCode: true, vatTreatment: true } })
      : []
    const byCode = new Map(existing.map((r) => [r.accountCode, r]))
    for (const account of body.accounts) {
      const where = { companyId_accountCode: { companyId, accountCode: account.accountCode } }
      const row = byCode.get(account.accountCode)
      if (account.trainingOrigin === null && row && row.vatTreatment === null) await tx.revenueAccountSetting.delete({ where })
      else if (account.trainingOrigin !== null || row) {
        await tx.revenueAccountSetting.upsert({ where, create: { companyId, accountCode: account.accountCode, trainingOrigin: account.trainingOrigin }, update: { trainingOrigin: account.trainingOrigin } })
      }
    }
    for (const origin of [...new Set(body.customers.map((c) => c.trainingOrigin))]) {
      const ids = body.customers.filter((c) => c.trainingOrigin === origin).map((c) => c.tiersId)
      await tx.tiers.updateMany({ where: { companyId, id: { in: ids } }, data: { trainingOrigin: origin } })
    }
  })
  await writeAuditLog('info', 'Training revenue origins saved', { action: 'SAVE_TRAINING_ORIGINS', companyId, metadata: { accounts: body.accounts.length, customers: body.customers.length } })
  return { accounts: body.accounts.length, customers: body.customers.length }
}
