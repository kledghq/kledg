'use client'

import { Amount } from '@/components/shared'
import { computeInvoiceTotals, formatVatRate, type AmountLine } from '@/lib/invoices/amounts'

interface InvoiceTotalsProps {
  /** Lines as typed (invalid ones count as 0); computed with the server's rounding rule. */
  lines: AmountLine[]
}

/**
 * Totals of an invoice form: the VAT breakdown per rate and the totals
 * excluding tax, VAT and including tax, computed by lib/invoices/amounts.ts,
 * the module the server uses, so the totals shown are the ones recorded.
 */
export function InvoiceTotals({ lines }: InvoiceTotalsProps) {
  const totals = computeInvoiceTotals(lines)
  return (
    <div className="space-y-3" data-testid="invoice-totals">
      <table className="w-full text-sm">
        <caption className="text-muted-foreground mb-2 text-left text-xs">Détail de la TVA par taux</caption>
        <thead>
          <tr className="text-muted-foreground text-xs">
            <th className="py-1 text-left font-normal">Taux</th>
            <th className="py-1 text-right font-normal">Base HT</th>
            <th className="py-1 text-right font-normal">TVA</th>
          </tr>
        </thead>
        <tbody>
          {totals.breakdown.length === 0 ? (
            <tr>
              <td colSpan={3} className="text-muted-foreground py-1 text-xs">
                Ajoutez une ligne pour voir la TVA.
              </td>
            </tr>
          ) : (
            totals.breakdown.map((row) => (
              <tr key={row.vatRateBp} data-rate={row.vatRateBp}>
                <td className="py-1">{formatVatRate(row.vatRateBp)}</td>
                <td className="num py-1 text-right">
                  <Amount value={row.baseCents / 100} />
                </td>
                <td className="num py-1 text-right">
                  <Amount value={row.vatCents / 100} />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t pt-3 text-sm">
        <dt className="text-muted-foreground">Total HT</dt>
        <dd className="num text-right" data-testid="total-excl">
          <Amount value={totals.totalExclTaxCents / 100} />
        </dd>
        <dt className="text-muted-foreground">TVA</dt>
        <dd className="num text-right" data-testid="total-vat">
          <Amount value={totals.totalVatCents / 100} />
        </dd>
        <dt className="font-medium">Total TTC</dt>
        <dd className="num text-right font-semibold" data-testid="total-incl">
          <Amount value={totals.totalInclTaxCents / 100} />
        </dd>
      </dl>
    </div>
  )
}
