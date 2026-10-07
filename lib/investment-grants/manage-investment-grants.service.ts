/**
 * Investment grants of a company (lib/investment-grants/schedule.ts for the
 * transfer rules): create, change, delete. The share of each fiscal year is
 * booked by the year-end entries (lib/year-end).
 *
 * Invariants owned here:
 * - a grant spread with the depreciation of an asset (PCG art. 312-1) names
 *   a depreciable fixed asset of the company; one financing a
 *   non-depreciable asset is spread over its inalienability period or by
 *   tenths;
 * - the accounts are a 13 account other than 139 for the grant, a 139
 *   account for the transfers and a class 7 account for the income (also
 *   CHECK constraints);
 * - once a transfer is validated, the amount, the spreading and the
 *   accounts are fixed (the books depend on them); a grant with validated
 *   transfers is never deleted.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { deleteDraftEntryInTx } from '@/lib/accounting/services/entry-lifecycle.service'
import { calendarDay, optionalText } from '@/lib/api/zod-fields'
import { writeAuditLog } from '@/lib/audit'
import { centsToDecimal, parseCents } from '@/lib/utils/money'
import { calendarDayOf, isoDateToUtc } from '@/lib/utils/date'
import { GRANT_SPREADINGS } from './schedule'
import { accountCodeOfClass } from '@/lib/api/zod-fields'

export const GRANT_NOT_FOUND = "Subvention d'investissement introuvable"

const cents = (message: string) => z.number({ error: message }).int(message).min(0, message).max(1e13, message)

/** Body of POST /api/investment-grants (with companyId) and PATCH /api/investment-grants/[id] (the whole grant). */
export const GrantBodySchema = z.object({
  label: z.string({ error: 'Le libellé est requis' }).trim().min(1, 'Le libellé est requis').max(200),
  grantor: optionalText(200),
  amountCents: cents('Montant de la subvention invalide').refine((v) => v > 0, 'Le montant de la subvention doit être positif'),
  grantedOn: calendarDay("Date d'octroi invalide"),
  spreading: z.enum(GRANT_SPREADINGS, { error: 'Choisissez le rythme de reprise de la subvention' }),
  fixedAssetId: z.string().max(64).nullable().optional(),
  durationYears: z.number().int('Durée en années entières').min(1, 'Durée invalide').max(100, 'Durée invalide').nullable().optional(),
  accountCode: z.string().trim().regex(/^13\d{0,8}$/, 'Compte de subvention invalide (13)').optional(),
  transferAccountCode: z.string().trim().regex(/^139\d{0,7}$/, 'Compte de reprise invalide (139)').optional(),
  incomeAccountCode: accountCodeOfClass('7', 'Compte de produit invalide (classe 7)').optional(),
  carriedCents: cents('Montant déjà repris invalide').optional(),
  notes: optionalText(2000),
})
export type GrantBody = z.infer<typeof GrantBodySchema>

export const CreateGrantBodySchema = GrantBodySchema.extend({ companyId: z.string() })

async function normalize(companyId: string, body: GrantBody) {
  const accountCode = body.accountCode ?? '131'
  if (accountCode.startsWith('139')) throw new ValidationError('Le compte 139 reçoit les reprises, pas la subvention\u00a0: utilisez un compte 131 ou 138.')
  const carried = body.carriedCents ?? 0
  if (carried > body.amountCents) throw new ValidationError('Le montant déjà repris dépasse celui de la subvention.')
  let fixedAssetId: string | null = null
  if (body.fixedAssetId) {
    const asset = await prisma.fixedAsset.findFirst({ where: { id: body.fixedAssetId, companyId }, select: { id: true, depreciationMethod: true } })
    if (!asset) throw new NotFoundError('Immobilisation introuvable')
    if (body.spreading === 'ASSET' && asset.depreciationMethod === 'none') {
      throw new ValidationError(
        "Cette immobilisation n'est pas amortissable\u00a0: la subvention se reprend sur la durée d'inaliénabilité, ou par dixièmes sans clause d'inaliénabilité (PCG art. 312-1).",
      )
    }
    fixedAssetId = asset.id
  }
  if (body.spreading === 'ASSET' && !fixedAssetId) throw new ValidationError("Choisissez l'immobilisation financée\u00a0: la reprise suit son amortissement.")
  const needsDuration = body.spreading === 'LINEAR' || body.spreading === 'INALIENABILITY'
  if (needsDuration && !body.durationYears) {
    throw new ValidationError(body.spreading === 'LINEAR' ? "Indiquez la durée d'amortissement du bien financé, en années." : "Indiquez la durée d'inaliénabilité, en années.")
  }
  return {
    label: body.label,
    grantor: body.grantor ?? null,
    amount: centsToDecimal(body.amountCents),
    grantedOn: isoDateToUtc(body.grantedOn),
    spreading: body.spreading,
    fixedAssetId,
    durationYears: needsDuration ? (body.durationYears ?? null) : null,
    accountCode,
    transferAccountCode: body.transferAccountCode ?? '139',
    incomeAccountCode: body.incomeAccountCode ?? '747',
    carriedAmount: centsToDecimal(carried),
    notes: body.notes ?? null,
  }
}

export async function createInvestmentGrant(companyId: string, body: GrantBody) {
  const data = await normalize(companyId, body)
  const created = await prisma.investmentGrant.create({ data: { companyId, ...data }, select: { id: true } })
  await writeAuditLog('info', 'Investment grant created', { action: 'CREATE_INVESTMENT_GRANT', companyId, metadata: { grantId: created.id } })
  return getInvestmentGrant(companyId, created.id)
}

export async function getInvestmentGrant(companyId: string, grantId: string) {
  const grant = await prisma.investmentGrant.findFirst({
    where: { id: grantId, companyId },
    include: { fixedAsset: { select: { id: true, label: true } }, transfers: { select: { fiscalYearId: true, entryId: true } } },
  })
  if (!grant) throw new NotFoundError(GRANT_NOT_FOUND)
  return grant
}

async function validatedTransfers(companyId: string, grantId: string) {
  return prisma.investmentGrantTransfer.findMany({
    where: { companyId, grantId, entry: { status: 'validated', reversedBy: null } },
    select: { entry: { select: { entryNumber: true } } },
  })
}

export async function updateInvestmentGrant(companyId: string, grantId: string, body: GrantBody) {
  const existing = await prisma.investmentGrant.findFirst({ where: { id: grantId, companyId } })
  if (!existing) throw new NotFoundError(GRANT_NOT_FOUND)
  const data = await normalize(companyId, body)
  const booked = await validatedTransfers(companyId, grantId)
  const termsChanged =
    data.amount !== centsToDecimal(parseCents(existing.amount) ?? 0) ||
    data.carriedAmount !== centsToDecimal(parseCents(existing.carriedAmount) ?? 0) ||
    data.spreading !== existing.spreading ||
    data.fixedAssetId !== existing.fixedAssetId ||
    data.durationYears !== existing.durationYears ||
    data.grantedOn.getTime() !== isoDateToUtc(calendarDayOf(existing.grantedOn) as string).getTime() ||
    data.accountCode !== existing.accountCode ||
    data.transferAccountCode !== existing.transferAccountCode ||
    data.incomeAccountCode !== existing.incomeAccountCode
  if (booked.length > 0 && termsChanged) {
    throw new ConflictError(
      `Des reprises de cette subvention sont comptabilisées (écritures n° ${booked.map((b) => b.entry?.entryNumber).join(', ')})\u00a0: son montant, son rythme et ses comptes ne peuvent plus changer. Contre-passez ces écritures d'abord.`,
    )
  }
  await prisma.investmentGrant.update({ where: { id: existing.id }, data })
  await writeAuditLog('info', 'Investment grant updated', { action: 'UPDATE_INVESTMENT_GRANT', companyId, metadata: { grantId } })
  return getInvestmentGrant(companyId, grantId)
}

export async function deleteInvestmentGrant(companyId: string, grantId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const grant = await tx.investmentGrant.findFirst({
      where: { id: grantId, companyId },
      select: { id: true, transfers: { select: { entry: { select: { id: true, entryNumber: true, status: true, reversedBy: { select: { id: true } } } } } } },
    })
    if (!grant) throw new NotFoundError(GRANT_NOT_FOUND)
    const entries = grant.transfers.flatMap((t) => (t.entry ? [t.entry] : []))
    const booked = entries.filter((e) => e.status === 'validated' && !e.reversedBy)
    if (booked.length > 0) {
      throw new ConflictError(`Cette subvention a des reprises comptabilisées (écritures n° ${booked.map((e) => e.entryNumber).join(', ')})\u00a0: contre-passez-les avant de la supprimer.`)
    }
    for (const draft of entries.filter((e) => e.status === 'draft')) await deleteDraftEntryInTx(tx, companyId, draft.id)
    await tx.investmentGrant.delete({ where: { id: grant.id } })
  })
  await writeAuditLog('info', 'Investment grant deleted', { action: 'DELETE_INVESTMENT_GRANT', companyId, metadata: { grantId } })
}
