/**
 * What the reconciliation dialog needs to open a transaction: the transaction
 * itself (amounts in cents, date as an ISO day), the locked bank line and its
 * account, the fiscal years (to check the date), and the suggestion.
 */

import { prisma } from '@/lib/prisma'
import { findOwned, transactionOfCompany } from '@/lib/api/resources'
import { bankVatOf } from '@/lib/banking/bank-vat'
import { vatDeductionOn } from '@/lib/vat-deduction/coefficient'
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

  // The VAT the bank read, when it can be trusted (lib/banking/bank-vat.ts)
  const bankVat = bankVatOf(transaction, amountCents)
  const deduction = await vatDeductionOn(companyId, date)

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
      vatRatePercent: bankVat?.ratePercent ?? null,
      vatAmountCents: bankVat?.amountCents ?? null,
      vatDeductionShare: deduction.share,
    },
    bankLine: bankLineOf({ amountCents, side }),
    bankAccount: bank ? { code: bank.code, label: bank.label } : null,
    fiscalYears,
    fiscalYearId: fiscalYear?.id ?? null,
    suggestion: transaction.reconciled ? null : await suggestEntry(companyId, transaction),
  }
}
