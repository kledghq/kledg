/**
 * Records the exit of a fixed asset (sale, scrap, destruction) and prepares
 * its exit entry as a draft, from the asset's page or the MCP tool
 * record_fixed_asset_disposal (rules and accounts in disposal.ts).
 *
 * - The day of exit falls in a fiscal year of the company that is not
 *   closed: the entry is dated that day (PCG art. 1031-3, an entry of a
 *   closed year is refused).
 * - Depreciation runs to that day (the plan stops at fixed_assets.
 *   disposalDate): the entry takes back what the register says is
 *   accumulated then, from the records of each year, else the plan. When
 *   the allowance of the year of exit is not booked yet, or was booked for
 *   the whole year, the preview says so: the entry assumes the books hold
 *   the depreciation it takes back.
 * - The entry is a draft the user checks and validates. Recording the exit
 *   again replaces the draft; once it is validated, the exit changes only
 *   after its reversal (contre-passation), like any validated entry.
 * - What Kledg cannot know is said, never guessed: VAT on the sale,
 *   impairment (29) or investment grant still attached to the asset,
 *   exemptions of the gain.
 */

import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ClosedFiscalYearError, ConflictError, NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { ensureAccounts, ensureJournal } from '@/lib/accounting/fiscal-year-closure/ledger'
import { lockFiscalYearRow } from '@/lib/accounting/fiscal-year-closure/lock'
import { createEntryInTx } from '@/lib/accounting/services/entry-lifecycle.service'
import { loadProfitTaxationResolver } from '@/lib/companies/profit-taxation.service'
import { calendarDayOf } from '@/lib/utils/date'
import { centsToDecimal, formatCentsFr, parseCents, toCents } from '@/lib/utils/money'
import { cumulativeDepreciationCents } from './cumulative-depreciation'
import { buildDepreciationPlan, closingMonthOf, sumPlanCentsForPeriod } from './depreciation-plan'
import {
  computeDisposal,
  DISPOSAL_KIND_LABELS,
  DISPOSAL_KINDS,
  disposalEntryLines,
  isDisposableAssetAccount,
  isDisposalKind,
  type DisposalPreview,
} from './disposal'
import { amountCents, dateOf } from './inputs'
import { FIXED_ASSET_NOT_FOUND } from './read-fixed-assets.service'

export type { DisposalPreview }

type Db = Prisma.TransactionClient | typeof prisma

const OD_JOURNAL = { code: 'OD', label: 'Opérations diverses' }

/** POST /api/fixed-assets/[id]/disposal and the MCP tool. */
export const RecordDisposalSchema = z.object({
  disposalDate: z.string({ error: 'Indiquez la date de sortie' }).min(1, 'Indiquez la date de sortie').max(32),
  kind: z.enum(DISPOSAL_KINDS, { error: 'Nature de la sortie invalide : sale (cession), scrap (mise au rebut) ou destruction' }),
  /** Sale price, or compensation received, excluding VAT; empty for none. */
  price: z.union([z.number(), z.string()], { error: 'Prix de cession invalide' }).nullish(),
  /** The price is already booked (sale invoice crediting 757): the entry leaves it out. */
  priceRecorded: z.boolean({ error: 'Indicateur de prix comptabilisé invalide' }).nullish(),
  /** Only compute: nothing is written. */
  dryRun: z.boolean({ error: 'Indicateur de simulation invalide' }).nullish(),
})
export type RecordDisposalInput = z.infer<typeof RecordDisposalSchema>

const DISPOSAL_ASSET_SELECT = {
  id: true,
  label: true,
  acquisitionDate: true,
  acquisitionValue: true,
  amortizableAmount: true,
  depreciationMethod: true,
  depreciationRate: true,
  depreciationDuration: true,
  decliningCoefficient: true,
  depreciationStartDate: true,
  openingDepreciation: true,
  openingDepreciationDate: true,
  disposalKind: true,
  assetAccount: { select: { code: true, label: true } },
  depreciationAccount: { select: { code: true, label: true } },
  depreciations: { select: { fiscalYearId: true, amount: true, accountingEntryId: true } },
  disposalEntry: { select: { id: true, entryNumber: true, status: true, reversedBy: { select: { id: true } } } },
  _count: { select: { provisions: true, investmentGrants: true } },
} satisfies Prisma.FixedAssetSelect

type DisposalAsset = Prisma.FixedAssetGetPayload<{ select: typeof DISPOSAL_ASSET_SELECT }>

const day = (value: Date) => calendarDayOf(value) as string
const cents = (value: { toString(): string } | null | undefined) => (value == null ? 0 : (parseCents(value) ?? 0))

/** A validated exit entry not reversed: definitive (PCG art. 1031-3). */
function bookedExit(asset: Pick<DisposalAsset, 'disposalEntry'>) {
  const entry = asset.disposalEntry
  return entry && entry.status === 'validated' && !entry.reversedBy ? entry : null
}

async function loadAsset(db: Db, companyId: string, fixedAssetId: string): Promise<DisposalAsset> {
  const asset = await db.fixedAsset.findFirst({ where: { id: fixedAssetId, companyId }, select: DISPOSAL_ASSET_SELECT })
  if (!asset) throw new NotFoundError(FIXED_ASSET_NOT_FOUND)
  return asset
}

async function buildPreview(db: Db, companyId: string, asset: DisposalAsset, input: RecordDisposalInput): Promise<DisposalPreview> {
  if (!isDisposableAssetAccount(asset.assetAccount.code)) {
    throw new ValidationError(
      `L'immobilisation est au compte ${asset.assetAccount.code} : Kledg prépare la sortie des immobilisations incorporelles et corporelles (comptes 20 à 23). Une cession de titres (26, 27) se saisit en écriture.`,
    )
  }
  const booked = bookedExit(asset)
  if (booked) {
    throw new ConflictError(
      `La sortie de cette immobilisation est déjà comptabilisée (écriture n° ${booked.entryNumber}, validée) : contre-passez cette écriture avant de modifier la sortie.`,
    )
  }
  if (!isDisposalKind(input.kind)) throw new ValidationError('Nature de la sortie invalide')
  const date = dateOf(input.disposalDate, 'Date de sortie')
  if (!date) throw new ValidationError('Indiquez la date de sortie')
  const disposalDate = day(date)
  const acquisitionDate = day(asset.acquisitionDate)
  if (disposalDate < acquisitionDate) throw new ValidationError(`La date de sortie précède la date d'acquisition (${acquisitionDate}).`)
  const priceCents = input.price === undefined || input.price === null || input.price === '' ? 0 : amountCents(input.price, 'Prix de cession')
  if (priceCents === null || priceCents < 0) throw new ValidationError('Prix de cession invalide : un montant positif, deux décimales au plus')

  const years = await db.fiscalYear.findMany({ where: { companyId }, select: { id: true, year: true, startDate: true, endDate: true, isClosed: true } })
  const fiscalYear = years.find((fy) => fy.startDate <= date && date <= fy.endDate)
  if (!fiscalYear) throw new ValidationError(`Aucun exercice de la société ne couvre le ${disposalDate} : créez-le avant d'enregistrer la sortie.`)
  if (fiscalYear.isClosed) throw new ClosedFiscalYearError(fiscalYear.year)

  const plan = buildDepreciationPlan({ ...asset, fiscalYearClosingMonth: closingMonthOf(fiscalYear.endDate), fiscalYears: years })
  const recorded = new Map<string, number>()
  for (const r of asset.depreciations) recorded.set(r.fiscalYearId, (recorded.get(r.fiscalYearId) ?? 0) + cents(r.amount))
  const depreciable = asset.depreciationMethod !== 'none'
  const depreciationCents = depreciable
    ? cumulativeDepreciationCents({ plan, fiscalYears: years, recordedByFiscalYear: recorded, until: fiscalYear.endDate, disposalDate: date })
    : 0
  const grossCents = toCents(asset.acquisitionValue) ?? 0

  const resolveTaxation = await loadProfitTaxationResolver(companyId, db)
  const taxation = resolveTaxation(disposalDate)
  const result = computeDisposal({ grossCents, depreciationCents, priceCents, acquisitionDate, disposalDate, depreciable, taxation: taxation.taxation })
  const priceRecorded = input.priceRecorded === true
  const lines = disposalEntryLines({
    asset: asset.assetAccount,
    depreciation: depreciable ? asset.depreciationAccount : null,
    grossCents,
    depreciationCents,
    priceCents,
    withPrice: !priceRecorded,
  })

  const warnings: string[] = []
  if (depreciable) {
    const dueCents = sumPlanCentsForPeriod(plan, fiscalYear.startDate, date)
    const yearRecords = asset.depreciations.filter((r) => r.fiscalYearId === fiscalYear.id)
    const postedCents = yearRecords.filter((r) => r.accountingEntryId).reduce((sum, r) => sum + cents(r.amount), 0)
    const recordedCents = recorded.get(fiscalYear.id)
    if (recordedCents !== undefined && recordedCents !== dueCents) {
      warnings.push(
        `L'amortissement enregistré pour l'exercice ${fiscalYear.year} (${formatCentsFr(recordedCents)}) diffère de celui dû jusqu'au ${disposalDate} (${formatCentsFr(dueCents)}) : l'écriture de sortie reprend le montant enregistré. Corrigez l'amortissement de l'exercice si la sortie le change.`,
      )
    } else if (dueCents > 0 && postedCents === 0) {
      warnings.push(
        `La dotation de l'exercice ${fiscalYear.year} jusqu'au ${disposalDate} (${formatCentsFr(dueCents)}) n'est pas encore comptabilisée : générez-la (Amortissements) avant de valider l'écriture de sortie, qui la reprend.`,
      )
    }
  }
  if (priceCents > 0 && !priceRecorded) {
    warnings.push(
      "Le prix est porté HT en créance (462) et en produit (757). Si la vente est soumise à la TVA, ajoutez la TVA collectée à l'écriture et portez la créance TTC, ou enregistrez plutôt la facture de vente et indiquez que le prix est déjà comptabilisé.",
    )
  }
  if (priceRecorded && priceCents > 0) {
    warnings.push("Le prix n'est pas dans l'écriture : la facture de vente doit le créditer au compte 757.")
  }
  if (asset._count.provisions > 0) {
    warnings.push("Une dépréciation (29) est enregistrée sur cette immobilisation : reprenez-la à la sortie (registre des provisions).")
  }
  if (asset._count.investmentGrants > 0) {
    warnings.push("Une subvention d'investissement finance cette immobilisation : virez au résultat la part qui reste au bilan à la sortie (Subventions d'investissement).")
  }
  if (taxation.taxation === 'IR' && result.gainCents !== 0) {
    warnings.push(
      "Exonérations possibles (CGI art. 151 septies selon les recettes, 238 quindecies, 151 septies B pour le long terme) : Kledg ne les applique pas, vérifiez-les avec votre conseil.",
    )
  }
  if (taxation.taxation === 'unknown') warnings.push(taxation.explanation)

  return {
    fixedAsset: { id: asset.id, label: asset.label, assetAccount: asset.assetAccount.code, depreciationAccount: asset.depreciationAccount.code },
    fiscalYear: { id: fiscalYear.id, year: fiscalYear.year },
    disposalDate,
    kind: input.kind,
    kindLabel: DISPOSAL_KIND_LABELS[input.kind],
    grossCents,
    depreciationCents,
    priceCents,
    priceRecorded,
    result,
    taxation: taxation.explanation,
    lines,
    warnings,
    entry: null,
  }
}

/** What recording the exit would do: nothing is written. */
export async function previewDisposal(companyId: string, fixedAssetId: string, input: RecordDisposalInput): Promise<DisposalPreview> {
  return buildPreview(prisma, companyId, await loadAsset(prisma, companyId, fixedAssetId), input)
}

/**
 * Records the exit on the asset and creates its exit entry as a draft in
 * the OD journal, replacing an earlier draft. With `dryRun`, previews only.
 */
export async function recordDisposal(companyId: string, fixedAssetId: string, input: RecordDisposalInput): Promise<DisposalPreview> {
  if (input.dryRun) return previewDisposal(companyId, fixedAssetId, input)
  return prisma.$transaction(
    async (tx) => {
      const first = await loadAsset(tx, companyId, fixedAssetId)
      const draft = await buildPreview(tx, companyId, first, input)
      // The fiscal year of the exit is locked: no closing runs meanwhile
      const locked = await lockFiscalYearRow(tx, draft.fiscalYear.id, companyId)
      if (!locked) throw new NotFoundError('Exercice comptable introuvable')
      if (locked.closed) throw new ClosedFiscalYearError(locked.year)
      await tx.$queryRaw`SELECT "id" FROM "fixed_assets" WHERE "id" = ${fixedAssetId} AND "companyId" = ${companyId} FOR UPDATE`
      const asset = await loadAsset(tx, companyId, fixedAssetId)
      const preview = await buildPreview(tx, companyId, asset, input)

      if (asset.disposalEntry?.status === 'draft') {
        await tx.fixedAsset.update({ where: { id: asset.id }, data: { disposalEntryId: null } })
        await tx.accountingEntry.deleteMany({ where: { id: asset.disposalEntry.id, companyId, status: 'draft' } })
      }
      const journal = await ensureJournal(tx, companyId, OD_JOURNAL)
      const accountIds = await ensureAccounts(tx, companyId, preview.fiscalYear.id, preview.lines.map(({ code, label }) => ({ code, label })))
      const created = await createEntryInTx(tx, {
        companyId,
        fiscalYearId: preview.fiscalYear.id,
        journalId: journal.id,
        date: dateOf(preview.disposalDate, 'Date de sortie') as Date,
        description: `${preview.kindLabel} - ${asset.label}`,
        reference: `SORTIE-${asset.id.slice(-8)}`,
        status: 'draft',
        lines: preview.lines.map((line) => {
          const accountId = accountIds.get(line.code)
          if (!accountId) throw new Error(`Account ${line.code} missing in fiscal year ${preview.fiscalYear.id}`)
          return { accountId, debit: centsToDecimal(line.debitCents), credit: centsToDecimal(line.creditCents), description: `${preview.kindLabel} - ${asset.label}` }
        }),
      })
      await tx.fixedAsset.update({
        where: { id: asset.id },
        data: {
          disposalDate: dateOf(preview.disposalDate, 'Date de sortie'),
          disposalKind: preview.kind,
          disposalPrice: centsToDecimal(preview.priceCents),
          disposalEntryId: created.id,
        },
      })
      const entry = await tx.accountingEntry.findUniqueOrThrow({ where: { id: created.id }, select: { id: true, entryNumber: true } })
      return { ...preview, entry }
    },
    { maxWait: 10_000, timeout: 60_000 },
  )
}

/**
 * Cancels the exit: deletes its draft entry and puts the asset back in the
 * assets (no date, kind or price). Refused once the entry is validated and
 * not reversed. Returns whether a draft entry was deleted.
 */
export async function cancelDisposal(companyId: string, fixedAssetId: string): Promise<{ deletedEntry: boolean }> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "fixed_assets" WHERE "id" = ${fixedAssetId} AND "companyId" = ${companyId} FOR UPDATE`
    const asset = await loadAsset(tx, companyId, fixedAssetId)
    if (!asset.disposalKind) throw new ValidationError("Aucune sortie n'est enregistrée pour cette immobilisation.")
    const booked = bookedExit(asset)
    if (booked) {
      throw new ConflictError(`L'écriture de sortie n° ${booked.entryNumber} est validée : contre-passez-la avant d'annuler la sortie.`)
    }
    await tx.fixedAsset.update({
      where: { id: asset.id },
      data: { disposalDate: null, disposalKind: null, disposalPrice: null, disposalEntryId: null },
    })
    const draft = asset.disposalEntry?.status === 'draft' ? asset.disposalEntry.id : null
    if (draft) await tx.accountingEntry.deleteMany({ where: { id: draft, companyId, status: 'draft' } })
    return { deletedEntry: draft !== null }
  })
}
