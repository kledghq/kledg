'use client'

import { Amount } from '@/components/shared'
import { formatVatRate } from '@/lib/invoices/amounts'
import type { ReportTotals } from '@/lib/expense-reports/amounts'

/**
 * Totals of an expense report: what the company owes the claimant, the VAT
 * it recovers (per rate, the 44566 lines of the entry) and the charges.
 * Computed by lib/expense-reports/amounts.ts, the module the server uses.
 */
export function ExpenseTotals({ totals }: { totals: Pick<ReportTotals, 'totalInclTaxCents' | 'recoverableVatCents' | 'totalExpenseCents' | 'vatByRate'> }) {
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm [&_dd]:pl-4" data-testid="expense-totals">
      <dt className="text-muted-foreground">Charges</dt>
      <dd className="num text-right" data-testid="total-expense">
        <Amount value={totals.totalExpenseCents / 100} />
      </dd>
      {totals.vatByRate.map((row) => (
        <div key={row.vatRateBp} className="contents" data-rate={row.vatRateBp}>
          <dt className="text-muted-foreground">TVA récupérable {formatVatRate(row.vatRateBp)}</dt>
          <dd className="num text-right">
            <Amount value={row.recoverableVatCents / 100} />
          </dd>
        </div>
      ))}
      <dt className="text-muted-foreground">TVA récupérable</dt>
      <dd className="num text-right" data-testid="total-vat">
        <Amount value={totals.recoverableVatCents / 100} />
      </dd>
      <dt className="border-t pt-2 font-medium">À rembourser</dt>
      <dd className="num border-t pt-2 text-right font-semibold" data-testid="total-owed">
        <Amount value={totals.totalInclTaxCents / 100} />
      </dd>
    </dl>
  )
}
