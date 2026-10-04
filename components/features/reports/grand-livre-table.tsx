import React from 'react'

import { formatAmount } from '@/components/shared'
import { LEDGER } from '@/components/features/accounting/ledger-layout'
import { formatTransactionDate } from '@/lib/utils/date'
import { cn } from '@/lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export interface GrandLivreLine {
  id: string
  date: string
  reference: string
  journal: { code: string; label: string }
  description: string
  debit: number
  credit: number
  runningBalance: number
}

interface Side {
  debit: number
  credit: number
  balance: number
}

export interface GrandLivreAccount {
  account: { id: string; code: string; label: string }
  opening: Side
  closing: Side
  entryLines: GrandLivreLine[]
  totals: { debit: number; credit: number; balance: number }
}

export interface GrandLivreData {
  fiscalYear: { id: string; year: number; startDate: string; endDate: string }
  period: { startDate: string; endDate: string }
  accounts: GrandLivreAccount[]
  grandTotals: { debit: number; credit: number }
  totals: {
    opening: { debit: number; credit: number }
    movements: { debit: number; credit: number }
    closing: { debit: number; credit: number }
  }
}

/**
 * Grand livre: lines grouped by account with a running balance, then the
 * account totals and the report totals. Under 56rem of container width (see
 * `LEDGER`) the account title heads a section and each line becomes a card on
 * the same markup: date, journal and piece, the label, then Débit or Crédit
 * (the empty side hidden) and Solde, each named by its `data-label`.
 */
export function GrandLivreTable({ data }: { data: GrandLivreData }) {
  const formatCurrency = (value: number) => formatAmount(value)
  // Accounting dates are calendar days stored at midnight UTC.
  const formatDate = (dateString: string) => formatTransactionDate(dateString)

  return (
    <div className="rounded-md border">
      <Table className={LEDGER.table}>
        <TableHeader className={LEDGER.header}>
          <TableRow>
            <TableHead className="w-24">Date</TableHead>
            <TableHead className="w-24">Journal</TableHead>
            <TableHead className="w-32">Numéro d&apos;écriture</TableHead>
            <TableHead>Libellé</TableHead>
            <TableHead numeric className="w-32">Débit</TableHead>
            <TableHead numeric className="w-32">Crédit</TableHead>
            <TableHead numeric className="w-32">Solde</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.accounts.length === 0 ? (
            <TableRow className={LEDGER.row}>
              <TableCell colSpan={7} className={cn('text-center text-muted-foreground', LEDGER.title)}>
                Aucune écriture trouvée pour cette période
              </TableCell>
            </TableRow>
          ) : (
            <>
              {data.accounts.map((accountData) => (
                <React.Fragment key={accountData.account.id}>
                  {/* En-tête du compte */}
                  <TableRow className={cn('bg-muted/50', LEDGER.row)}>
                    <TableCell colSpan={7} className={cn('font-bold py-3', LEDGER.title)}>
                      Compte {accountData.account.code} - {accountData.account.label}
                    </TableCell>
                  </TableRow>
                  {/* Report à nouveau */}
                  {accountData.opening.balance !== 0 && (
                    <TableRow className={cn('italic', LEDGER.row)}>
                      <TableCell className={cn('font-mono text-sm', LEDGER.date)}>
                        {formatDate(data.period.startDate)}
                      </TableCell>
                      <TableCell colSpan={3} className={cn(LEDGER.journal, LEDGER.wrap)}>
                        Report à nouveau
                      </TableCell>
                      <TableCell
                        numeric
                        data-label="Débit"
                        data-empty={accountData.opening.debit > 0 ? undefined : ''}
                        className={LEDGER.amount}
                      >
                        {accountData.opening.debit > 0 ? formatCurrency(accountData.opening.debit) : '-'}
                      </TableCell>
                      <TableCell
                        numeric
                        data-label="Crédit"
                        data-empty={accountData.opening.credit > 0 ? undefined : ''}
                        className={LEDGER.amount}
                      >
                        {accountData.opening.credit > 0 ? formatCurrency(accountData.opening.credit) : '-'}
                      </TableCell>
                      <TableCell numeric data-label="Solde" className={LEDGER.balance}>
                        {formatCurrency(accountData.opening.balance)}
                      </TableCell>
                    </TableRow>
                  )}
                  {/* Écritures du compte */}
                  {accountData.entryLines.map((line) => (
                    <TableRow key={line.id} className={LEDGER.row}>
                      <TableCell className={cn('font-mono text-sm', LEDGER.date)}>{formatDate(line.date)}</TableCell>
                      <TableCell className={cn('font-mono text-sm', LEDGER.journal)}>{line.journal.code}</TableCell>
                      <TableCell className={cn('font-mono text-sm', LEDGER.piece)}>{line.reference || '-'}</TableCell>
                      <TableCell className={cn(LEDGER.label, LEDGER.wrap)}>{line.description}</TableCell>
                      <TableCell
                        numeric
                        data-label="Débit"
                        data-empty={line.debit > 0 ? undefined : ''}
                        className={LEDGER.amount}
                      >
                        {line.debit > 0 ? formatCurrency(line.debit) : '-'}
                      </TableCell>
                      <TableCell
                        numeric
                        data-label="Crédit"
                        data-empty={line.credit > 0 ? undefined : ''}
                        className={LEDGER.amount}
                      >
                        {line.credit > 0 ? formatCurrency(line.credit) : '-'}
                      </TableCell>
                      <TableCell numeric data-label="Solde" className={LEDGER.balance}>
                        {formatCurrency(line.runningBalance)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {/* Totaux du compte */}
                  <TableRow className={cn('bg-muted/30 border-t', LEDGER.row, LEDGER.totalRow, LEDGER.joined)}>
                    <TableCell colSpan={4} className={cn('font-semibold', LEDGER.totalLabel, LEDGER.totalText)}>
                      Mouvements du compte {accountData.account.code}
                    </TableCell>
                    <TableCell numeric data-label="Total débit" className={cn('font-semibold', LEDGER.amount)}>
                      {formatCurrency(accountData.totals.debit)}
                    </TableCell>
                    <TableCell numeric data-label="Total crédit" className={cn('font-semibold', LEDGER.amount)}>
                      {formatCurrency(accountData.totals.credit)}
                    </TableCell>
                    <TableCell className={LEDGER.hidden}></TableCell>
                  </TableRow>
                  {/* Solde du compte: the signed balance is enough once stacked. */}
                  <TableRow className={cn('bg-muted/20', LEDGER.row, LEDGER.totalRow)}>
                    <TableCell colSpan={4} className={cn('font-medium', LEDGER.totalLabel, LEDGER.totalText)}>
                      Solde Compte {accountData.account.code}
                    </TableCell>
                    <TableCell numeric className={cn('font-medium', LEDGER.hidden)}>
                      {accountData.totals.balance > 0 ? formatCurrency(accountData.totals.balance) : '-'}
                    </TableCell>
                    <TableCell numeric className={cn('font-medium', LEDGER.hidden)}>
                      {accountData.totals.balance < 0 ? formatCurrency(Math.abs(accountData.totals.balance)) : '-'}
                    </TableCell>
                    <TableCell numeric data-label="Solde" className={cn('font-medium', LEDGER.balance)}>
                      {formatCurrency(accountData.totals.balance)}
                    </TableCell>
                  </TableRow>
                  {/* Espacement entre comptes */}
                  <TableRow className={LEDGER.spacer}>
                    <TableCell colSpan={7} className="h-4 bg-background"></TableCell>
                  </TableRow>
                </React.Fragment>
              ))}
              {/* Total général du grand livre */}
              <TableRow
                className={cn('border-t-2 border-t-foreground bg-muted/30', LEDGER.row, LEDGER.totalRow, LEDGER.joined)}
              >
                <TableCell colSpan={4} className={cn('font-semibold', LEDGER.totalLabel, LEDGER.totalText)}>
                  Total des reports à nouveau
                </TableCell>
                <TableCell numeric data-label="Débit" className={cn('font-semibold', LEDGER.amount)}>
                  {formatCurrency(data.totals.opening.debit)}
                </TableCell>
                <TableCell numeric data-label="Crédit" className={cn('font-semibold', LEDGER.amount)}>
                  {formatCurrency(data.totals.opening.credit)}
                </TableCell>
                <TableCell className={LEDGER.hidden}></TableCell>
              </TableRow>
              <TableRow className={cn('bg-muted/50 font-bold', LEDGER.row, LEDGER.totalRow, LEDGER.joined)}>
                <TableCell colSpan={4} className={cn('font-bold py-3', LEDGER.totalLabel, LEDGER.totalText)}>
                  TOTAL DES MOUVEMENTS
                </TableCell>
                <TableCell numeric data-label="Débit" className={cn('font-bold py-3', LEDGER.amount)}>
                  {formatCurrency(data.grandTotals.debit)}
                </TableCell>
                <TableCell numeric data-label="Crédit" className={cn('font-bold py-3', LEDGER.amount)}>
                  {formatCurrency(data.grandTotals.credit)}
                </TableCell>
                <TableCell className={LEDGER.hidden}></TableCell>
              </TableRow>
              <TableRow className={cn('bg-muted/30', LEDGER.row, LEDGER.totalRow)}>
                <TableCell colSpan={4} className={cn('font-semibold', LEDGER.totalLabel, LEDGER.totalText)}>
                  Total des soldes de fin de période
                </TableCell>
                <TableCell numeric data-label="Débit" className={cn('font-semibold', LEDGER.amount)}>
                  {formatCurrency(data.totals.closing.debit)}
                </TableCell>
                <TableCell numeric data-label="Crédit" className={cn('font-semibold', LEDGER.amount)}>
                  {formatCurrency(data.totals.closing.credit)}
                </TableCell>
                <TableCell className={LEDGER.hidden}></TableCell>
              </TableRow>
            </>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
