/**
 * Keeps a fixed asset in line with the draft entry that booked its
 * acquisition (fixed_assets.acquisitionEntryId: simple mode creates the asset
 * of a durable purchase with the entry, docs/categories-simples.md). When an
 * accountant edits the lines of that draft:
 *
 * - the entry no longer debits the asset's account (the purchase is booked
 *   as an expense, 2183 changed to 6063): the asset is deleted under the
 *   fixed asset deletion rules (deleteFixedAssetInTx: its draft depreciations
 *   go with it), which frees the simple mode row; the edit is refused (409)
 *   while a depreciation is booked or a grant finances the asset;
 * - the amount debited to the asset's account changes: it is the acquisition
 *   value (PCG art. 213-1: acquisition cost, recoverable taxes excluded), so
 *   the asset takes it and its depreciation plan follows (the plan is
 *   computed from it, lib/fixed-assets/depreciation-plan.ts). Depreciation
 *   records not booked yet were computed on the old value: they are deleted,
 *   with their draft entries, to be computed again. The edit is refused while
 *   a depreciation is booked: it was computed on the old value and is
 *   definitive (PCG art. 1031-3), it must be reversed first.
 *
 * The asset's account is matched by its number, so a draft moved to another
 * fiscal year (whose accounts are other rows) still finds it.
 */

import type { Prisma } from '@prisma/client'
import { ConflictError } from '@/lib/accounting/errors'
import { centsToDecimal, formatCentsFr, toCents } from '@/lib/utils/money'
import { pluralWord } from '@/lib/utils/plural'
import { bookedDepreciationSummary, deleteFixedAssetInTx, depreciationEntriesOf } from './delete-fixed-asset.service'

export interface AcquisitionLine {
  accountId: string
  debitCents: number
  creditCents: number
}

/**
 * Applies the new lines of a draft entry to the fixed assets it acquired.
 * Runs in the transaction that replaces the lines, before they are written.
 */
export async function syncFixedAssetsAcquiredByEntryInTx(
  tx: Prisma.TransactionClient,
  companyId: string,
  entry: { id: string; entryNumber: string },
  lines: AcquisitionLine[],
): Promise<void> {
  const assets = await tx.fixedAsset.findMany({
    where: { companyId, acquisitionEntryId: entry.id },
    select: { id: true, label: true, acquisitionValue: true, assetAccount: { select: { code: true } } },
    orderBy: { createdAt: 'asc' },
  })
  if (assets.length === 0) return

  const accountIds = [...new Set(lines.map((l) => l.accountId))]
  const accounts = await tx.account.findMany({ where: { companyId, id: { in: accountIds } }, select: { id: true, code: true } })
  const codeOf = new Map(accounts.map((a) => [a.id, a.code]))
  const refused = `L'écriture n° ${entry.entryNumber} ne peut pas être modifiée ainsi :`

  for (const asset of assets) {
    const code = asset.assetAccount.code
    const debitedCents = lines
      .filter((l) => codeOf.get(l.accountId) === code)
      .reduce((sum, l) => sum + l.debitCents - l.creditCents, 0)

    if (debitedCents <= 0) {
      try {
        // The simple mode row no longer names it (also done by ON DELETE SET NULL)
        await tx.simpleModeEntry.updateMany({ where: { fixedAssetId: asset.id }, data: { fixedAssetId: null } })
        await deleteFixedAssetInTx(tx, companyId, asset.id)
      } catch (error) {
        if (error instanceof ConflictError) {
          throw new ConflictError(
            `${refused} elle a créé l'immobilisation « ${asset.label} » au compte ${code}, qui ne peut pas être supprimée. ${error.message}`,
          )
        }
        throw error
      }
      continue
    }

    const currentCents = toCents(asset.acquisitionValue) ?? 0
    if (debitedCents === currentCents) continue
    const { booked, drafts } = await depreciationEntriesOf(tx, companyId, asset.id)
    if (booked.length > 0) {
      throw new ConflictError(
        `${refused} elle a créé l'immobilisation « ${asset.label} », amortie sur ${formatCentsFr(currentCents)}, et ne peut pas la porter à ${formatCentsFr(debitedCents)}. ` +
          `Cette immobilisation a ${bookedDepreciationSummary(booked)} ${pluralWord(booked.length, 'calculée', 'calculées')} sur l'ancienne valeur : contre-passez-la depuis la fiche de l'écriture avant de changer le montant.`,
      )
    }
    if (drafts.length > 0) {
      await tx.accountingEntry.deleteMany({ where: { id: { in: drafts }, companyId, status: 'draft' } })
    }
    await tx.fixedAssetDepreciation.deleteMany({ where: { fixedAssetId: asset.id, companyId } })
    await tx.fixedAsset.update({ where: { id: asset.id }, data: { acquisitionValue: centsToDecimal(debitedCents) } })
  }
}
