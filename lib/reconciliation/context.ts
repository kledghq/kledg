/**
 * What the reconciliation dialog needs to open a transaction: the transaction
 * itself (amounts in cents, date as an ISO day), the locked bank line and its
 * account, the fiscal years (to check the date), and the suggestion.
 */

import { prisma } from '@/lib/prisma'
import { findOwned, transactionOfCompany } from '@/lib/api/resources'
import { toCents } from '@/lib/utils/money'
import { toIsoDateUtc } from '@/lib/utils/date'
import { counterpartyOf, suggestEntry } from './prefill'
import { MESSAGES, fiscalYearPeriods, normalizeSide, resolveBankLedgerAccount } from './service'
import type { ReconciliationContext } from './types'
import { bankLineOf, fiscalYearForDate } from './validation'

export type { ReconciliationContext } from './types'

export async function getReconciliationContext(companyId: string, transactionId: string): Promise<ReconciliationContext> {
  const transaction = await findOwned(
    prisma.bankTransaction.findFirst({
      where: { id: transactionId, ...transactionOfCompany(companyId) },
      include: { bankAccount: { select: { name: true, iban: true } } },
    }),
    MESSAGES.transactionNotFound,
  )

  const date = toIsoDateUtc(transaction.date)
  const side = normalizeSide(transaction.side)
  const amountCents = Math.abs(toCents(transaction.amount) ?? 0)
  const fiscalYears = await fiscalYearPeriods(companyId)
  const fiscalYear = fiscalYearForDate(fiscalYears, date)
  // When the transaction's year is closed or missing, show the bank account of the latest open year
  const accountYear = fiscalYear && !fiscalYear.isClosed ? fiscalYear : [...fiscalYears].reverse().find((fy) => !fy.isClosed)
  const bank = accountYear ? await resolveBankLedgerAccount(companyId, accountYear.id) : null

  const provider = transaction.providerData as { vat_rate?: number; vat_amount?: number; vat_amount_cents?: number } | null
  const vatRate = transaction.vatRate != null ? Number(transaction.vatRate) : (provider?.vat_rate ?? null)
  const vatAmountCents =
    transaction.vatAmount != null
      ? toCents(transaction.vatAmount)
      : provider?.vat_amount != null
        ? toCents(provider.vat_amount)
        : (provider?.vat_amount_cents ?? null)

  return {
    transaction: {
      id: transaction.id,
      date,
      amountCents,
      side,
      label: transaction.label,
      reference: transaction.reference,
      counterpartyName: counterpartyOf(transaction),
      reconciled: transaction.reconciled,
      reconciledWith: transaction.reconciledWith,
      vatRatePercent: vatRate != null && vatRate >= 0 ? vatRate : null,
      vatAmountCents: vatAmountCents != null && vatAmountCents > 0 ? vatAmountCents : null,
    },
    bankLine: bankLineOf({ amountCents, side }),
    bankAccount: bank ? { code: bank.code, label: bank.label } : null,
    fiscalYears,
    fiscalYearId: fiscalYear?.id ?? null,
    suggestion: transaction.reconciled ? null : await suggestEntry(companyId, transaction),
  }
}
