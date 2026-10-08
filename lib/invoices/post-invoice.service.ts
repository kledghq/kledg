/**
 * Posting of an invoice: one draft entry in the purchases (AC) or sales (VE)
 * journal, built by posting-plan.ts, created through createEntryInTx (the one
 * entry creation path: balance, accounts and journal of the company, fiscal
 * year open and containing the date).
 *
 * Invariants owned here:
 * - the entry is dated on the invoice date and goes to the fiscal year that
 *   contains it; no open fiscal year contains it: refused, never posted to
 *   another year (a closed year: 409, no year: 400);
 * - every account is resolved in that fiscal year's chart of the company
 *   (ledger-accounts.ts), never taken as an id from the request;
 * - an invoice posts once: its row is locked and its entryId checked under
 *   the lock, so two concurrent posts create one entry and one 409;
 * - a sales invoice of Kledg's series (origin AUTO) gets its number here,
 *   in the posting transaction (numbering/series.ts): a posting that fails
 *   or rolls back gives no number, and a number once given stays with the
 *   invoice (unposting keeps it);
 * - unposting deletes the entry only while it is a draft and no payment is
 *   recorded on the invoice; a validated entry is corrected by a
 *   contre-passation (PCG art. 1031-3), not here.
 */

import { prisma } from '@/lib/prisma'
import { ensureJournal } from '@/lib/accounting/fiscal-year-closure/ledger'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { assertEntryWritableInFiscalYear, fiscalYearContaining, GUARDED_FISCAL_YEAR_SELECT } from '@/lib/accounting/entry-guards'
import { createEntryInTx, deleteDraftEntryInTx } from '@/lib/accounting/services/entry-lifecycle.service'
import { writeAuditLog } from '@/lib/audit'
import { DEFAULT_COLLECTIVE } from '@/lib/tiers/rules'
import { calendarDayOf, formatIsoDateFr } from '@/lib/utils/date'
import { centsToDecimal, parseCents } from '@/lib/utils/money'
import { formatVatRate, isFrenchVatRate } from './amounts'
import { accountByRoot, accountsByCode } from './ledger-accounts'
import { invoiceName, lockInvoice, INVOICE_NOT_FOUND } from './manage-invoices.service'
import { assignSeriesNumber } from './numbering/series'
import { planInvoiceEntry, vatAccountsNeeded, type PlanLine, type VatAccountKey } from './posting-plan'
import { vatDeductionOn } from '@/lib/vat-deduction/coefficient'

/** PCG roots of the VAT accounts (PCG art. 932-1; 44574 is a subdivision of 4457). */
export const VAT_ACCOUNT_ROOTS: Record<VatAccountKey, { root: string; label: string }> = {
  deductible: { root: '44566', label: 'TVA sur autres biens et services' },
  deductibleFixedAssets: { root: '44562', label: 'TVA sur immobilisations' },
  collected: { root: '44571', label: 'TVA collectée' },
  collectedPending: { root: '44574', label: 'TVA collectée en attente d’encaissement' },
}

/** Revenue account of a sale line without one: 706 for services, 707 for goods (PCG art. 932-1). */
const DEFAULT_SALE_ACCOUNT = { SERVICES: '706', GOODS: '707' } as const

const JOURNALS = { PURCHASE: { code: 'AC', label: 'Achats' }, SALE: { code: 'VE', label: 'Ventes' } } as const

const cents = (value: { toString(): string }) => parseCents(value) ?? 0

const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const

export interface PostResult {
  invoiceId: string
  entryId: string
  entryNumber: string
  fiscalYear: number
  /** The invoice's number (given by the series when it had none). */
  number: string
}

export async function postInvoice(companyId: string, invoiceId: string, options: { source?: string } = {}): Promise<PostResult> {
  // Share of the VAT of a purchase the company deducts on the invoice day (its
  // provisional coefficient de déduction), read before the transaction; the
  // date is checked again under the lock.
  const header = await prisma.invoice.findFirst({ where: { id: invoiceId, companyId }, select: { direction: true, issueDate: true } })
  // The coefficient is a whole percent: passed as is, never through share x 100.
  const deductionPercent = header?.direction === 'PURCHASE' ? ((await vatDeductionOn(companyId, header.issueDate)).percent ?? undefined) : undefined
  const result = await prisma.$transaction(async (tx) => {
    const locked = await lockInvoice(tx, companyId, invoiceId)
    if (locked.entryId) throw new ConflictError(`${invoiceName(locked)} est déjà comptabilisée.`)
    if (locked.number === null && locked.origin === 'QONTO' && locked.qontoDraft && locked.externalId) {
      throw new ConflictError(
        'La facture est un brouillon dans Qonto : finalisez-la dans Qonto, puis importez les factures Qonto pour recevoir son numéro avant de la comptabiliser.',
      )
    }
    if (locked.number === null && locked.origin !== 'AUTO') {
      throw new ConflictError('Kledg attend la réponse de Qonto pour cette facture : reprenez sa création dans Qonto avant de la comptabiliser.')
    }
    const invoice = await tx.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      select: {
        id: true,
        direction: true,
        number: true,
        typeCode: true,
        issueDate: true,
        totalInclTax: true,
        tiers: { select: { name: true, auxiliaryAccountNumber: true, collectiveAccountCode: true, defaultAccountCode: true } },
        lines: { orderBy: { position: 'asc' }, select: { label: true, totalExclTax: true, vatRateBp: true, accountCode: true, nature: true, fixedAsset: true } },
        vatBreakdown: { select: { vatRateBp: true, baseAmount: true, vatAmount: true } },
      },
    })
    const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { servicesVatOnDebits: true, isVatExempt: true } })

    // Fiscal year containing the invoice date: never another one.
    const day = calendarDayOf(invoice.issueDate) as string
    if (header && (header.issueDate.getTime() !== invoice.issueDate.getTime() || header.direction !== invoice.direction)) {
      throw new ConflictError('La facture a été modifiée pendant sa comptabilisation : réessayez.')
    }
    const years = await tx.fiscalYear.findMany({ where: { companyId }, select: GUARDED_FISCAL_YEAR_SELECT, orderBy: { startDate: 'asc' } })
    const fiscalYear = fiscalYearContaining(years, day)
    if (!fiscalYear) {
      throw new ValidationError(
        `Aucun exercice ne contient le ${formatIsoDateFr(day)}, date de la facture : créez l’exercice avant de la comptabiliser.`,
      )
    }
    assertEntryWritableInFiscalYear(fiscalYear, day, 'create')

    const unknownRate = invoice.vatBreakdown.find((row) => !isFrenchVatRate(row.vatRateBp))
    if (unknownRate) {
      throw new ValidationError(
        `Le taux de ${formatVatRate(unknownRate.vatRateBp)} n’est pas un taux de TVA français : Kledg ne comptabilise pas cette facture (TVA étrangère ou autoliquidation à saisir à la main).`,
      )
    }

    // A standard journal Kledg posts to: created when missing (lib/accounting/journal-by-code.ts)
    const journal = await ensureJournal(tx, companyId, JOURNALS[invoice.direction])

    const kind = invoice.direction === 'SALE' ? 'CUSTOMER' : 'SUPPLIER'
    const tiersAccount = invoice.tiers.collectiveAccountCode
      ? (await accountsByCode(tx, companyId, fiscalYear, [invoice.tiers.collectiveAccountCode])).get(invoice.tiers.collectiveAccountCode)!
      : await accountByRoot(tx, companyId, fiscalYear, DEFAULT_COLLECTIVE[kind], kind === 'CUSTOMER' ? 'Clients' : 'Fournisseurs')

    // A code typed on the line or the tiers is taken as is; the default revenue account is found by its PCG root (706, 706000...).
    const lineCodes = invoice.lines.map((line, i) => {
      const typed = line.accountCode ?? invoice.tiers.defaultAccountCode
      const code = typed ?? (invoice.direction === 'SALE' ? DEFAULT_SALE_ACCOUNT[line.nature] : null)
      if (!code) throw new ValidationError(`Ligne ${i + 1}\u00a0: choisissez le compte de charge de la ligne (ex. 6064), ou un compte par défaut sur le fournisseur.`)
      if (invoice.direction === 'PURCHASE' && !(code.startsWith('6') || code.startsWith('2'))) {
        throw new ValidationError(`Ligne ${i + 1}\u00a0: le compte ${code} n’est pas un compte de charges ou d’immobilisations.`)
      }
      if (invoice.direction === 'SALE' && !code.startsWith('7')) throw new ValidationError(`Ligne ${i + 1}\u00a0: le compte ${code} n’est pas un compte de produits.`)
      if (line.fixedAsset && !code.startsWith('2')) throw new ValidationError(`Ligne ${i + 1}\u00a0: une immobilisation se comptabilise en classe 2.`)
      return { code, typed: typed !== null }
    })
    const byCode = await accountsByCode(tx, companyId, fiscalYear, lineCodes.filter((c) => c.typed).map((c) => c.code))
    for (const root of new Set(lineCodes.filter((c) => !c.typed).map((c) => c.code))) {
      byCode.set(root, await accountByRoot(tx, companyId, fiscalYear, root, root === '706' ? 'Prestations de services' : 'Ventes de marchandises'))
    }
    const planLines: PlanLine[] = invoice.lines.map((line, i) => ({
      label: line.label,
      totalExclTaxCents: cents(line.totalExclTax),
      vatRateBp: line.vatRateBp,
      accountId: byCode.get(lineCodes[i].code)!.id,
      nature: line.nature,
      fixedAsset: line.fixedAsset,
    }))
    const breakdown = invoice.vatBreakdown.map((row) => ({ vatRateBp: row.vatRateBp, baseCents: cents(row.baseAmount), vatCents: cents(row.vatAmount) }))
    const needed = vatAccountsNeeded({
      direction: invoice.direction,
      lines: planLines,
      breakdown,
      servicesVatOnDebits: company.servicesVatOnDebits,
      vatExempt: company.isVatExempt && deductionPercent === undefined,
      deductionPercent,
    })
    const vatAccounts: Partial<Record<VatAccountKey, string>> = {}
    for (const key of needed) {
      const { root, label } = VAT_ACCOUNT_ROOTS[key]
      vatAccounts[key] = (await accountByRoot(tx, companyId, fiscalYear, root, label)).id
    }

    // Last check passed: the series gives the number now, in this transaction.
    let number = invoice.number
    if (number === null) {
      number = await assignSeriesNumber(tx, companyId, { id: invoiceId, typeCode: invoice.typeCode, issueDay: day })
      await tx.invoice.update({ where: { id: invoiceId }, data: { number, numberAssignedAt: new Date() } })
    }

    const kindLabel = invoice.typeCode === '381' ? 'Avoir' : 'Facture'
    const description = `${kindLabel} ${number} ${invoice.tiers.name}`.slice(0, 250)
    const plan = planInvoiceEntry({
      direction: invoice.direction,
      typeCode: invoice.typeCode,
      description,
      lines: planLines,
      breakdown,
      totalInclTaxCents: cents(invoice.totalInclTax),
      tiers: { accountId: tiersAccount.id, auxiliaryAccountNumber: invoice.tiers.auxiliaryAccountNumber, name: invoice.tiers.name },
      vatAccounts,
      servicesVatOnDebits: company.servicesVatOnDebits,
      vatExempt: company.isVatExempt && deductionPercent === undefined,
      deductionPercent,
    })

    const entry = await createEntryInTx(tx, {
      companyId,
      journalId: journal.id,
      fiscalYearId: fiscalYear.id,
      date: day,
      pieceDate: day,
      description,
      reference: number.slice(0, 200),
      status: 'draft',
      lines: plan.lines.map((line) => ({
        accountId: line.accountId,
        debit: centsToDecimal(line.debitCents),
        credit: centsToDecimal(line.creditCents),
        description: line.description,
        auxiliaryAccountNumber: line.auxiliaryAccountNumber ?? null,
        auxiliaryAccountLabel: line.auxiliaryAccountLabel ?? null,
      })),
    })
    await tx.invoice.update({ where: { id: invoiceId }, data: { entryId: entry.id } })
    const created = await tx.accountingEntry.findUniqueOrThrow({ where: { id: entry.id }, select: { entryNumber: true } })
    return { invoiceId, entryId: entry.id, entryNumber: created.entryNumber, fiscalYear: fiscalYear.year, number }
  }, TX_OPTIONS)

  await writeAuditLog('info', `Invoice posted: ${result.number}`, {
    action: 'POST_INVOICE',
    companyId,
    metadata: { invoiceId, entryId: result.entryId, source: options.source ?? 'web' },
  })
  return { invoiceId, entryId: result.entryId, entryNumber: result.entryNumber, fiscalYear: result.fiscalYear, number: result.number }
}

/** Deletes the draft entry of an invoice: the invoice is a draft again. */
export async function unpostInvoice(companyId: string, invoiceId: string): Promise<{ invoiceId: string }> {
  const number = await prisma.$transaction(async (tx) => {
    const locked = await lockInvoice(tx, companyId, invoiceId)
    if (!locked.entryId) throw new ConflictError(`${invoiceName(locked)} n’est pas comptabilisée.`)
    // A customer payment confirmed in simple mode names the invoice, recorded on it or waiting for validation
    const simplePayments = await tx.simpleModeEntry.count({ where: { companyId, invoiceId } })
    if (simplePayments > 0) {
      throw new ConflictError('Un règlement de cette facture a été confirmé dans les recettes à vérifier\u00a0: annulez son rapprochement avant de supprimer l’écriture de la facture.')
    }
    const payments = await tx.invoicePayment.count({ where: { invoiceId } })
    if (payments > 0) throw new ConflictError('Des règlements sont enregistrés sur cette facture : retirez-les avant de supprimer son écriture.')
    const entry = await tx.accountingEntry.findFirst({ where: { id: locked.entryId, companyId }, select: { status: true, entryNumber: true } })
    if (!entry) throw new NotFoundError(INVOICE_NOT_FOUND)
    if (entry.status === 'validated') {
      throw new ConflictError(
        `L’écriture n° ${entry.entryNumber} de cette facture est validée (PCG art. 1031-3) : contre-passez-la depuis Écritures pour l’annuler.`,
      )
    }
    await tx.invoice.update({ where: { id: invoiceId }, data: { entryId: null } })
    await deleteDraftEntryInTx(tx, companyId, locked.entryId)
    return locked.number
  }, TX_OPTIONS)
  await writeAuditLog('info', `Invoice unposted: ${number}`, { action: 'UNPOST_INVOICE', companyId, metadata: { invoiceId } })
  return { invoiceId }
}
