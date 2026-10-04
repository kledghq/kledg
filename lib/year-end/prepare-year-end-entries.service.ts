/**
 * Prepares the year-end entries of a fiscal year as drafts: the dotations
 * and reprises of the provisions and impairments, and the shares of the
 * investment grants transferred to the result, each one entry in the OD
 * journal on the last day of the year, linked to its assessment or
 * transfer. Nothing is validated: the user checks and validates the drafts
 * like any entry (PCG art. 1031-3), and the closing refuses a year that
 * still holds drafts.
 *
 * Idempotent: run twice, it creates nothing twice. A linked draft that no
 * longer matches (the assessment changed) is deleted and prepared again; a
 * validated entry that no longer matches is left alone and reported, since
 * only a contre-passation can cancel it. Runs under the lock of the fiscal
 * year row (lib/accounting/fiscal-year-closure/lock.ts), like the closing
 * and the depreciation entries, so two preparations never race; a closed
 * year is refused.
 */

import { prisma } from '@/lib/prisma'
import { ClosedFiscalYearError, NotFoundError } from '@/lib/accounting/errors'
import { createEntryInTx, deleteDraftEntryInTx } from '@/lib/accounting/services/entry-lifecycle.service'
import { ensureAccounts, ensureJournal } from '@/lib/accounting/fiscal-year-closure/ledger'
import { lockFiscalYearRow } from '@/lib/accounting/fiscal-year-closure/lock'
import { writeAuditLog } from '@/lib/audit'
import { centsToDecimal } from '@/lib/utils/money'
import { allowanceAccountLabel, movementLines, movementTo } from '@/lib/provisions/rules'
import { GRANT_ACCOUNTS, transferLines } from '@/lib/investment-grants/schedule'
import { FISCAL_YEAR_NOT_FOUND, getYearEndInventory } from './get-year-end-inventory.service'

const OD_JOURNAL = { code: 'OD', label: 'Opérations diverses' }
const TX_OPTIONS = { maxWait: 10_000, timeout: 60_000 }

export interface PreparedEntry {
  kind: 'provision' | 'grant'
  itemId: string
  label: string
  entryId: string
  /** Provision: positive dotation, negative reprise; grant: share transferred. */
  cents: number
}

export interface PrepareResult {
  created: PreparedEntry[]
  /** Items left as they are, with the reason, in French. */
  skipped: Array<{ kind: 'provision' | 'grant'; itemId: string; label: string; reason: string }>
}

type Line = { code: string; label: string; debitCents: number; creditCents: number }

export async function prepareYearEndEntries(companyId: string, fiscalYearId: string): Promise<PrepareResult> {
  const result = await prisma.$transaction(async (tx) => {
    const locked = await lockFiscalYearRow(tx, fiscalYearId, companyId)
    if (!locked) throw new NotFoundError(FISCAL_YEAR_NOT_FOUND)
    if (locked.closed) throw new ClosedFiscalYearError(locked.year)

    const inventory = await getYearEndInventory(companyId, fiscalYearId, tx)
    const year = inventory.fiscalYear
    const created: PreparedEntry[] = []
    const skipped: PrepareResult['skipped'] = []

    // Drafts that no longer match are replaced; validated ones need a contre-passation
    for (const item of [...inventory.provisions, ...inventory.grants]) {
      if (item.status !== 'to_correct' || !item.entry) continue
      const kind = 'category' in item ? 'provision' : 'grant'
      if (item.entry.status === 'validated') {
        skipped.push({
          kind,
          itemId: item.id,
          label: item.label,
          reason: `L'écriture n° ${item.entry.entryNumber} est validée et ne correspond plus au montant attendu\u00a0: contre-passez-la depuis la fiche de l'écriture, puis préparez à nouveau les écritures.`,
        })
        continue
      }
      await deleteDraftEntryInTx(tx, companyId, item.entry.id)
    }

    const plans: Array<{ kind: 'provision' | 'grant'; itemId: string; label: string; cents: number; description: string; reference: string; lines: Line[] }> = []
    for (const p of inventory.provisions) {
      const replaced = p.status === 'to_correct' && p.entry?.status === 'draft'
      if (p.status !== 'to_post' && !replaced) continue
      if (p.requiredCents === null) continue
      // After a draft is replaced, the whole movement of the year is booked again
      const cents = replaced ? movementTo(p.requiredCents, p.openingCents, p.reversible).cents : p.proposedCents
      if (cents === 0) continue
      const allowance = { code: p.accountCode, label: allowanceAccountLabel(p.category, p.accountCode) }
      const what = p.category === 'RISK_CHARGE' ? 'provision' : 'dépréciation'
      plans.push({
        kind: 'provision',
        itemId: p.id,
        label: p.label,
        cents,
        description: `${cents > 0 ? `Dotation ${what}` : `Reprise ${what}`} ${year.year} - ${p.label}`,
        reference: `PROV-${year.year}-${p.id.slice(-8)}`,
        lines: movementLines(cents, allowance, p.accounts),
      })
    }
    for (const g of inventory.grants) {
      const replaced = g.status === 'to_correct' && g.entry?.status === 'draft'
      if (g.status !== 'to_post' && !replaced) continue
      const cents = replaced ? Math.max(0, g.expectedCumulativeCents - g.transferredBeforeCents) : g.proposedCents
      if (cents <= 0) continue
      plans.push({
        kind: 'grant',
        itemId: g.id,
        label: g.label,
        cents,
        description: `Quote-part de subvention virée au résultat ${year.year} - ${g.label}`,
        reference: `SUBV-${year.year}-${g.id.slice(-8)}`,
        lines: transferLines(cents, {
          transfer: { code: g.transferAccountCode, label: GRANT_ACCOUNTS.transfer.label },
          income: { code: g.incomeAccountCode, label: g.incomeAccountCode === GRANT_ACCOUNTS.income.code ? GRANT_ACCOUNTS.income.label : `Compte ${g.incomeAccountCode}` },
        }),
      })
    }
    if (plans.length === 0) return { created, skipped }

    const journal = await ensureJournal(tx, companyId, OD_JOURNAL)
    const accountIds = await ensureAccounts(tx, companyId, fiscalYearId, plans.flatMap((plan) => plan.lines.map(({ code, label }) => ({ code, label }))))
    const endDate = new Date(`${year.endDate}T00:00:00Z`)
    for (const plan of plans) {
      const entry = await createEntryInTx(tx, {
        companyId,
        fiscalYearId,
        journalId: journal.id,
        date: endDate,
        description: plan.description,
        reference: plan.reference,
        status: 'draft',
        lines: plan.lines.map((line) => ({
          accountId: accountIds.get(line.code) as string,
          debit: centsToDecimal(line.debitCents),
          credit: centsToDecimal(line.creditCents),
          description: plan.description,
        })),
      })
      if (plan.kind === 'provision') {
        const provision = inventory.provisions.find((p) => p.id === plan.itemId)!
        await tx.provisionAssessment.upsert({
          where: { provisionId_fiscalYearId: { provisionId: plan.itemId, fiscalYearId } },
          // No assessment: the risk ended (closedOn), the required balance is 0
          create: { companyId, provisionId: plan.itemId, fiscalYearId, amount: centsToDecimal(provision.requiredCents ?? 0), basis: 'Fin du risque ou sortie de l\'actif', entryId: entry.id },
          update: { entryId: entry.id },
        })
      } else {
        await tx.investmentGrantTransfer.upsert({
          where: { grantId_fiscalYearId: { grantId: plan.itemId, fiscalYearId } },
          create: { companyId, grantId: plan.itemId, fiscalYearId, entryId: entry.id },
          update: { entryId: entry.id },
        })
      }
      created.push({ kind: plan.kind, itemId: plan.itemId, label: plan.label, entryId: entry.id, cents: plan.cents })
    }
    return { created, skipped }
  }, TX_OPTIONS)

  if (result.created.length > 0) {
    await writeAuditLog('info', 'Year-end entries prepared', {
      action: 'PREPARE_YEAR_END_ENTRIES',
      companyId,
      metadata: { fiscalYearId, entryIds: result.created.map((c) => c.entryId) },
    })
  }
  return result
}
