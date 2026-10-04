/**
 * Creates a fixed asset (immobilisation) with its depreciation plan settings.
 * Used by POST /api/fixed-assets and the MCP server.
 *
 * A depreciable asset is checked against the PCG rules first
 * (lib/pcg/services/fixed-assets.ts: PCG art. 213-1 acquisition cost,
 * art. 214-1 to 214-19 depreciation plan). A non-depreciable asset
 * (depreciationMethod "none": land, goodwill) has no plan: its depreciation
 * and expense accounts fall back to the asset account, never debited since no
 * allowance is generated for it.
 */

import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { ValidationError } from '@/lib/accounting/errors'
import { centsToDecimal, fromCents, type AmountInput } from '@/lib/utils/money'
import { amountCents, dateOf, decimalNumber } from './inputs'
import { assertAllOwned } from '@/lib/api/resources'
import { validateFixedAssetBeforeCreation, type PCGWarning } from '@/lib/pcg/services/fixed-assets'

export interface CreateFixedAssetInput {
  label?: string | null
  comment?: string | null
  acquisitionDate?: string | Date | null
  acquisitionValue?: AmountInput
  amortizableAmount?: AmountInput
  disposalDate?: string | Date | null
  /** Annual rate in percent. */
  depreciationRate?: number | string | null
  /** Years. */
  depreciationDuration?: number | string | null
  depreciationMethod?: 'linear' | 'declining' | 'none' | string | null
  decliningCoefficient?: number | string | null
  depreciationStartDate?: string | Date | null
  assetAccountId?: string | null
  depreciationAccountId?: string | null
  expenseAccountId?: string | null
  isFullyPaid?: boolean | null
}

const MISSING_FIELDS = "Champs obligatoires manquants : libellé, date et valeur d'acquisition, compte d'immobilisation."

export async function createFixedAsset(companyId: string, input: CreateFixedAssetInput) {
  const label = input.label?.trim()
  const acquisitionDate = dateOf(input.acquisitionDate, "Date d'acquisition")
  const acquisitionCents = amountCents(input.acquisitionValue, "Valeur d'acquisition")
  const assetAccountId = input.assetAccountId
  if (!label || !acquisitionDate || !acquisitionCents || !assetAccountId) throw new ValidationError(MISSING_FIELDS)

  const method = input.depreciationMethod || 'linear'
  if (method !== 'linear' && method !== 'declining' && method !== 'none') {
    throw new ValidationError("Mode d'amortissement invalide : linear, declining ou none.")
  }
  const depreciable = method !== 'none'
  const rate = depreciable ? decimalNumber(input.depreciationRate, "Taux d'amortissement") : null
  const durationNumber = depreciable ? decimalNumber(input.depreciationDuration, "Durée d'amortissement") : null
  const duration = durationNumber === null ? null : Math.trunc(durationNumber)
  const coefficient = depreciable ? decimalNumber(input.decliningCoefficient, 'Coefficient dégressif') : null
  const amortizableCents = amountCents(input.amortizableAmount, 'Montant amortissable')
  const disposalDate = dateOf(input.disposalDate, 'Date de cession')
  const startDate = dateOf(input.depreciationStartDate, "Date de début d'amortissement")

  if (depreciable && !startDate) throw new ValidationError("La date de début d'amortissement est obligatoire.")
  if (depreciable && !rate && !duration) {
    throw new ValidationError("Indiquez un taux ou une durée d'amortissement.")
  }

  const depreciationAccountId = depreciable ? input.depreciationAccountId : input.depreciationAccountId || assetAccountId
  const expenseAccountId = depreciable ? input.expenseAccountId : input.expenseAccountId || assetAccountId
  if (!depreciationAccountId || !expenseAccountId) {
    throw new ValidationError("Choisissez le compte d'amortissement (28) et le compte de dotation (6811).")
  }
  const depreciationStartDate = startDate ?? acquisitionDate

  await assertAllOwned(
    [assetAccountId, depreciationAccountId, expenseAccountId],
    (ids) => prisma.account.count({ where: { id: { in: ids }, companyId } }),
    'Compte introuvable',
  )

  let warnings: PCGWarning[] = []
  if (depreciable) {
    const validation = await validateFixedAssetBeforeCreation({
      companyId,
      label,
      comment: input.comment || undefined,
      acquisitionDate,
      acquisitionValue: fromCents(acquisitionCents),
      amortizableAmount: amortizableCents === null ? undefined : fromCents(amortizableCents),
      disposalDate: disposalDate ?? undefined,
      depreciationRate: rate ?? undefined,
      depreciationDuration: duration ?? undefined,
      depreciationMethod: method,
      decliningCoefficient: coefficient ?? undefined,
      depreciationStartDate,
      assetAccountId,
      depreciationAccountId,
      expenseAccountId,
      isFullyPaid: input.isFullyPaid || false,
    })
    if (!validation.valid) throw new ValidationError(`Validation PCG échouée : ${validation.errors.join(', ')}`)
    warnings = validation.warnings
    if (warnings.length > 0) {
      logger.warn(`PCG Warnings for fixed asset creation: ${warnings.map((w) => w.message).join('; ')}`, { companyId, label })
    }
  }

  const fixedAsset = await prisma.fixedAsset.create({
    data: {
      companyId,
      label,
      comment: input.comment || null,
      acquisitionDate,
      acquisitionValue: centsToDecimal(acquisitionCents),
      amortizableAmount: amortizableCents === null ? null : centsToDecimal(amortizableCents),
      disposalDate,
      depreciationRate: rate,
      depreciationDuration: duration,
      depreciationMethod: method,
      decliningCoefficient: coefficient,
      depreciationStartDate,
      assetAccountId,
      depreciationAccountId,
      expenseAccountId,
      isFullyPaid: input.isFullyPaid || false,
    },
    include: { assetAccount: true, depreciationAccount: true, expenseAccount: true },
  })
  return { fixedAsset, warnings }
}
