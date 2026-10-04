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
 */

import { prisma } from '@/lib/prisma'
import { ConflictError, NotFoundError } from '@/lib/accounting/errors'
import { plural, pluralWord } from '@/lib/utils/plural'

/** Returns the number of draft entries deleted with the asset. */
export async function deleteFixedAsset(companyId: string, fixedAssetId: string): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const asset = await tx.fixedAsset.findFirst({ where: { id: fixedAssetId, companyId }, select: { id: true } })
    if (!asset) throw new NotFoundError('Immobilisation introuvable')
    const grants = await tx.investmentGrant.count({ where: { fixedAssetId, companyId } })
    if (grants > 0) {
      throw new ConflictError(
        `Cette immobilisation est financée par ${grants > 1 ? `${grants} subventions d'investissement` : "une subvention d'investissement"} dont la reprise suit son amortissement\u00a0: modifiez ${pluralWord(grants, 'la subvention', 'les subventions')} (Saisie, Subventions d'investissement) avant de supprimer l'immobilisation, ou enregistrez plutôt sa sortie.`
      )
    }
    const records = await tx.fixedAssetDepreciation.findMany({
      where: { fixedAssetId, companyId, accountingEntryId: { not: null } },
      select: {
        accountingEntry: {
          select: { id: true, entryNumber: true, status: true, reversedBy: { select: { id: true } } },
        },
      },
    })
    const entries = records.flatMap((r) => (r.accountingEntry ? [r.accountingEntry] : []))
    const booked = entries.filter((e) => e.status === 'validated' && !e.reversedBy)
    if (booked.length > 0) {
      throw new ConflictError(
        `Cette immobilisation a ${plural(booked.length, 'dotation')} aux amortissements ${pluralWord(booked.length, 'comptabilisée', 'comptabilisées')} (${pluralWord(booked.length, 'écriture', 'écritures')} n° ${booked
          .map((e) => e.entryNumber)
          .join(', ')}). Une écriture validée ne peut pas être supprimée : contre-passez-la depuis la fiche de l'écriture avant de supprimer l'immobilisation, ou enregistrez plutôt sa sortie (cession ou mise au rebut).`
      )
    }
    const drafts = entries.filter((e) => e.status === 'draft').map((e) => e.id)
    if (drafts.length > 0) {
      await tx.accountingEntry.deleteMany({ where: { id: { in: drafts }, companyId, status: 'draft' } })
    }
    // Depreciation records go with the asset (onDelete: Cascade).
    await tx.fixedAsset.delete({ where: { id: fixedAssetId } })
    return drafts.length
  })
}
