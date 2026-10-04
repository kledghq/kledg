/**
 * Trial balance (balance générale) of a period: for each account, its
 * opening balance (à-nouveaux and entries before the period), its debit
 * and credit movements over the period, and its closing balance. Built on
 * the general ledger computation (lib/reports/ledger), so the two agree.
 */

import type { AccountBalance } from '@/lib/reports/types'
import { addEuros, subtractEuros } from '../amounts'
import { getLedger, type LedgerQuery, type LedgerTotals } from '../ledger/ledger.service'

export interface TrialBalanceRow extends AccountBalance {
  openingDebit: number
  openingCredit: number
  movementDebit: number
  movementCredit: number
  closingDebit: number
  closingCredit: number
}

export interface TrialBalanceData {
  fiscalYear: { id: string; year: number; startDate: string; endDate: string; isClosed: boolean }
  /** debit / credit: opening balance side plus movements; balance: closing balance (debit - credit). */
  balances: TrialBalanceRow[]
  totals: {
    debit: number
    credit: number
    balance: number
  } & LedgerTotals
  period: {
    startDate: string
    endDate: string
  }
}

export async function getTrialBalanceFor(query: LedgerQuery): Promise<TrialBalanceData> {
  const ledger = await getLedger({ ...query, withLines: false })
  const balances: TrialBalanceRow[] = ledger.accounts.map((a) => ({
    accountId: a.account.id,
    code: a.account.code,
    label: a.account.label,
    openingDebit: a.opening.debit,
    openingCredit: a.opening.credit,
    movementDebit: a.movements.debit,
    movementCredit: a.movements.credit,
    closingDebit: a.closing.debit,
    closingCredit: a.closing.credit,
    debit: addEuros(a.opening.debit, a.movements.debit),
    credit: addEuros(a.opening.credit, a.movements.credit),
    balance: a.closing.balance,
  }))
  const t = ledger.totals
  return {
    fiscalYear: ledger.fiscalYear,
    balances,
    totals: {
      ...t,
      debit: addEuros(t.opening.debit, t.movements.debit),
      credit: addEuros(t.opening.credit, t.movements.credit),
      balance: subtractEuros(t.closing.debit, t.closing.credit),
    },
    period: ledger.period,
  }
}

/** Trial balance of the fiscal year containing `startDate`, from `startDate` to `endDate`. */
export async function getTrialBalance(companyId: string, startDate: Date, endDate: Date): Promise<TrialBalanceData> {
  return getTrialBalanceFor({ companyId, startDate, endDate })
}
