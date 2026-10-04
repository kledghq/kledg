/**
 * General ledger (grand livre) of a period within one fiscal year, in the
 * shape of the Grand livre page: per account, the opening balance (report à
 * nouveau), the entry lines of the period with a running balance, and the
 * closing balance. Same computation as the trial balance
 * (lib/reports/ledger/ledger.service.ts), so the totals agree.
 */

import { getLedger, type LedgerQuery } from './ledger.service'

export async function getGrandLivre(query: Omit<LedgerQuery, 'withLines'>) {
  const ledger = await getLedger({ ...query, withLines: true })
  return {
    fiscalYear: ledger.fiscalYear,
    period: ledger.period,
    accounts: ledger.accounts.map((a) => ({
      account: a.account,
      opening: a.opening,
      movements: a.movements,
      closing: a.closing,
      // The entry number is the reference shown on the page.
      entryLines: a.lines.map((line) => ({ ...line, reference: line.entryNumber || line.reference })),
      // Movements of the period, and the closing balance.
      totals: { debit: a.movements.debit, credit: a.movements.credit, balance: a.closing.balance },
    })),
    grandTotals: ledger.totals.movements,
    totals: ledger.totals,
  }
}
