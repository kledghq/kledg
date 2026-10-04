/**
 * Updates a fixed asset: only the fields present in the input change, read
 * with the creation parsers (lib/fixed-assets/inputs.ts) so an amount, a
 * rate or a date is accepted or refused the same way on both paths.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ValidationError } from '@/lib/accounting/errors'
import { assertAllOwned } from '@/lib/api/resources'
import { centsToDecimal, type AmountInput } from '@/lib/utils/money'
import { amountCents, dateOf, decimalNumber } from './inputs'
import { assertFixedAssetOwned, FIXED_ASSET_ACCOUNTS_INCLUDE } from './read-fixed-assets.service'
import type { UpdateFixedAssetInput } from './schemas'

const METHODS = ['linear', 'declining', 'none']

/** Cents of a required amount: an empty value is refused like an invalid one. */
function requiredCents(value: AmountInput, field: string): number {
  const cents = amountCents(value, field)
  if (cents === null) throw new ValidationError(`${field} : montant invalide (deux décimales au plus)`)
  return cents
}

/** Optional amount as a decimal string for Prisma; an empty value (or 0) clears it. */
function optionalDecimal(value: AmountInput, field: string): string | null {
  if (!value) return null
  const cents = amountCents(value, field)
  return cents === null ? null : centsToDecimal(cents)
}

/** A required date: empty or invalid is refused. */
function requiredDate(value: string | null | undefined, field: string): Date {
  const date = dateOf(value, field)
  if (!date) throw new ValidationError(`${field} invalide`)
  return date
}

/** The Prisma update of the fields present in `input`. */
export function fixedAssetUpdateData(input: UpdateFixedAssetInput): Prisma.FixedAssetUncheckedUpdateInput {
  const data: Prisma.FixedAssetUncheckedUpdateInput = {}
  if (input.label !== undefined) {
    const label = input.label?.trim()
    if (!label) throw new ValidationError('Le libellé est requis')
    data.label = label
  }
  if (input.comment !== undefined) data.comment = input.comment || null
  if (input.acquisitionDate !== undefined) data.acquisitionDate = requiredDate(input.acquisitionDate, "Date d'acquisition")
  if (input.acquisitionValue !== undefined) {
    data.acquisitionValue = centsToDecimal(requiredCents(input.acquisitionValue, "Valeur d'acquisition"))
  }
  if (input.amortizableAmount !== undefined) data.amortizableAmount = optionalDecimal(input.amortizableAmount, 'Montant amortissable')
  if (input.disposalDate !== undefined) data.disposalDate = dateOf(input.disposalDate, 'Date de cession')
  if (input.depreciationRate !== undefined) {
    data.depreciationRate = input.depreciationRate ? decimalNumber(input.depreciationRate, "Taux d'amortissement") : null
  }
  if (input.depreciationDuration !== undefined) {
    const years = input.depreciationDuration ? decimalNumber(input.depreciationDuration, "Durée d'amortissement") : null
    data.depreciationDuration = years === null ? null : Math.trunc(years)
  }
  if (input.depreciationMethod !== undefined && input.depreciationMethod !== null) {
    if (!METHODS.includes(input.depreciationMethod)) {
      throw new ValidationError("Mode d'amortissement invalide : linear, declining ou none.")
    }
    data.depreciationMethod = input.depreciationMethod
  }
  if (input.decliningCoefficient !== undefined) {
    data.decliningCoefficient = input.decliningCoefficient
      ? decimalNumber(input.decliningCoefficient, 'Coefficient dégressif')
      : null
  }
  // A non-depreciable asset may come without a start date: it keeps its own.
  if (input.depreciationStartDate) data.depreciationStartDate = requiredDate(input.depreciationStartDate, "Date de début d'amortissement")
  if (input.assetAccountId) data.assetAccountId = input.assetAccountId
  if (input.depreciationAccountId) data.depreciationAccountId = input.depreciationAccountId
  if (input.expenseAccountId) data.expenseAccountId = input.expenseAccountId
  if (input.isFullyPaid !== undefined && input.isFullyPaid !== null) data.isFullyPaid = input.isFullyPaid
  if (input.isActive !== undefined && input.isActive !== null) data.isActive = input.isActive
  return data
}

/** Updates the fixed asset of the company (404 for another company's) and returns it with its accounts. */
export async function updateFixedAsset(companyId: string, fixedAssetId: string, input: UpdateFixedAssetInput) {
  await assertFixedAssetOwned(companyId, fixedAssetId)
  const data = fixedAssetUpdateData(input)

  // The accounts must belong to the company
  await assertAllOwned(
    [input.assetAccountId, input.depreciationAccountId, input.expenseAccountId],
    (ids) => prisma.account.count({ where: { id: { in: ids }, companyId } }),
    'Compte introuvable',
  )

  return prisma.fixedAsset.update({ where: { id: fixedAssetId }, data, include: FIXED_ASSET_ACCOUNTS_INCLUDE })
}
