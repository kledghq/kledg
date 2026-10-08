/**
 * Deletes a fixed asset and its depreciation records, in one transaction.
 *
 * Draft depreciation entries linked to the asset are deleted with it.
 * Booked (validated) depreciation entries are definitive (PCG art. 1031-3:
 * "une procédure de validation, qui interdit toute modification ou
 * suppression de l'enregistrement"): the deletion is refused, naming the
 * entries to reverse first (contre-passation), unless they are already
 * reversed. An asset that leaves the company is recorded as a disposal
 * (cession, mise au rebut), not deleted. An asset financed by an
 * investment grant is not deleted either: the grant's transfer to the
 * result follows its depreciation (PCG art. 312-1), so the grant must be
 * changed first (also enforced by the foreign key, ON DELETE RESTRICT).
 *
 * An asset Kledg created with the entry of its acquisition (simple mode,
 * fixed_assets.acquisitionEntryId) goes with that entry: deleting the draft
 * (undoing the reconciliation, deleting the draft entry) first deletes the
 * asset under the same rules (deleteFixedAssetsAcquiredByEntryInTx), and is
 * refused when the asset cannot be deleted.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ConflictError, NotFoundError } from '@/lib/accounting/errors'
import { plural, pluralWord } from '@/lib/utils/plural'

interface DepreciationEntry {
  id: string
  entryNumber: string
}

/**
 * Entries of the depreciation records of an asset: the booked ones
 * (validated, not reversed: definitive, PCG art. 1031-3) and the ids of the
 * drafts.
 */
export async function depreciationEntriesOf(
  tx: Prisma.TransactionClient,
  companyId: string,
  fixedAssetId: string,
): Promise<{ booked: DepreciationEntry[]; drafts: string[] }> {
  const records = await tx.fixedAssetDepreciation.findMany({
    where: { fixedAssetId, companyId, accountingEntryId: { not: null } },
    select: {
      accountingEntry: {
        select: { id: true, entryNumber: true, status: true, reversedBy: { select: { id: true } } },
      },
    },
  })
  const entries = records.flatMap((r) => (r.accountingEntry ? [r.accountingEntry] : []))
  return {
    booked: entries.filter((e) => e.status === 'validated' && !e.reversedBy).map(({ id, entryNumber }) => ({ id, entryNumber })),
    drafts: entries.filter((e) => e.status === 'draft').map((e) => e.id),
  }
}

/** "1 dotation aux amortissements comptabilisée (écriture n° OD-12)", for the refusals. */
export function bookedDepreciationSummary(booked: DepreciationEntry[]): string {
  return `${plural(booked.length, 'dotation')} aux amortissements ${pluralWord(booked.length, 'comptabilisée', 'comptabilisées')} (${pluralWord(booked.length, 'écriture', 'écritures')} n° ${booked
    .map((e) => e.entryNumber)
    .join(', ')})`
}

/** Returns the number of draft entries deleted with the asset. */
export async function deleteFixedAsset(companyId: string, fixedAssetId: string): Promise<number> {
  return prisma.$transaction(async (tx) => deleteFixedAssetInTx(tx, companyId, fixedAssetId))
}

/** deleteFixedAsset inside the caller's transaction. */
export async function deleteFixedAssetInTx(tx: Prisma.TransactionClient, companyId: string, fixedAssetId: string): Promise<number> {
  const asset = await tx.fixedAsset.findFirst({ where: { id: fixedAssetId, companyId }, select: { id: true } })
  if (!asset) throw new NotFoundError('Immobilisation introuvable')
  const grants = await tx.investmentGrant.count({ where: { fixedAssetId, companyId } })
  if (grants > 0) {
    throw new ConflictError(
      `Cette immobilisation est financée par ${grants > 1 ? `${grants} subventions d'investissement` : "une subvention d'investissement"} dont la reprise suit son amortissement\u00a0: modifiez ${pluralWord(grants, 'la subvention', 'les subventions')} (Saisie, Subventions d'investissement) avant de supprimer l'immobilisation, ou enregistrez plutôt sa sortie.`
    )
  }
  const { booked, drafts } = await depreciationEntriesOf(tx, companyId, fixedAssetId)
  if (booked.length > 0) {
    throw new ConflictError(
      `Cette immobilisation a ${bookedDepreciationSummary(booked)}. Une écriture validée ne peut pas être supprimée\u00a0: contre-passez-la depuis la fiche de l'écriture avant de supprimer l'immobilisation, ou enregistrez plutôt sa sortie (cession ou mise au rebut).`
    )
  }
  if (drafts.length > 0) {
    await tx.accountingEntry.deleteMany({ where: { id: { in: drafts }, companyId, status: 'draft' } })
  }
  // Depreciation records go with the asset (onDelete: Cascade).
  await tx.fixedAsset.delete({ where: { id: fixedAssetId } })
  return drafts.length
}

/**
 * Before a draft entry is deleted: deletes the fixed assets created with it
 * (acquisitionEntryId), under the rules of deleteFixedAssetInTx. When one
 * cannot be deleted (booked depreciation, investment grant), the deletion of
 * the entry is refused (409) with the reason, after `refusal(label)` (what
 * cannot be done, naming the asset). Returns the ids of the deleted assets.
 */
export async function deleteFixedAssetsAcquiredByEntryInTx(
  tx: Prisma.TransactionClient,
  companyId: string,
  entryId: string,
  refusal: (label: string) => string = (label) => `Cette écriture a créé l'immobilisation « ${label} », qui ne peut pas être supprimée avec elle.`,
): Promise<string[]> {
  const assets = await tx.fixedAsset.findMany({ where: { companyId, acquisitionEntryId: entryId }, select: { id: true, label: true }, orderBy: { createdAt: 'asc' } })
  for (const asset of assets) {
    try {
      await deleteFixedAssetInTx(tx, companyId, asset.id)
    } catch (error) {
      if (error instanceof ConflictError) {
        throw new ConflictError(`${refusal(asset.label)} ${error.message}`)
      }
      throw error
    }
  }
  return assets.map((a) => a.id)
}
