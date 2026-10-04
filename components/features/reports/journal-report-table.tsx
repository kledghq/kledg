import React from 'react'

import { formatAmount, formatDisplayDate } from '@/components/shared'
import { LEDGER } from '@/components/features/accounting/ledger-layout'
import { cn } from '@/lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export interface JournalReportLine {
  accountCode: string
  accountLabel: string
  description: string | null
  debit: number
  credit: number
}

export interface JournalReportEntry {
  id: string
  entryNumber: string
  date: string
  description: string | null
  reference: string | null
  lines: JournalReportLine[]
  totalDebit: number
  totalCredit: number
}

export interface JournalReportJournal {
  journal: { id: string; code: string; label: string }
  entries: JournalReportEntry[]
  totals: { debit: number; credit: number }
}

export interface JournalReportData {
  journals: JournalReportJournal[]
  grandTotals: { debit: number; credit: number }
}

/**
 * Livre-journal: entries grouped by journal, each entry followed by its lines
 * and its total. Under 56rem of container width (see `LEDGER`) each entry
 * reads as one card on the same markup: date, journal, piece number and label,
 * then each line (account, label, Débit or Crédit named by its `data-label`,
 * the empty side hidden), then the entry total.
 */
export function JournalReportTable({
  data,
  showJournalHeaders,
}: {
  data: JournalReportData
  /** Journal title and total rows, when every journal is shown. */
  showJournalHeaders: boolean
}) {
  // Accounting dates are calendar days stored at midnight UTC: never render them in local time.
  const formatDate = (dateString: string) => formatDisplayDate(dateString)
  const formatCurrency = (value: number) => formatAmount(value)

  return (
    <div className="rounded-md border">
      <Table className={LEDGER.table}>
        <TableHeader className={LEDGER.header}>
          <TableRow>
            <TableHead className="w-24">Date</TableHead>
            <TableHead className="w-24">N° Pièce</TableHead>
            <TableHead className="w-20">Journal</TableHead>
            <TableHead className="max-w-[300px]">Libellé</TableHead>
            <TableHead className="max-w-[200px]">Compte</TableHead>
            <TableHead numeric className="w-32">Débit</TableHead>
            <TableHead numeric className="w-32">Crédit</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.journals.length === 0 ? (
            <TableRow className={LEDGER.row}>
              <TableCell colSpan={7} className={cn('text-center text-muted-foreground', LEDGER.title)}>
                Aucune écriture trouvée pour cette période
              </TableCell>
            </TableRow>
          ) : (
            <>
              {data.journals.map((journalData) => (
                <React.Fragment key={journalData.journal.id}>
                  {/* En-tête du journal (si "Tous les journaux") */}
                  {showJournalHeaders && (
                    <TableRow className={cn('bg-muted/50', LEDGER.row)}>
                      <TableCell colSpan={7} className={cn('font-bold py-3', LEDGER.title)}>
                        Journal {journalData.journal.code} - {journalData.journal.label}
                      </TableCell>
                    </TableRow>
                  )}
                  {/* Écritures du journal */}
                  {journalData.entries.map((entry) => (
                    <React.Fragment key={entry.id}>
                      {/* Ligne principale de l'écriture */}
                      <TableRow className={cn(LEDGER.row, LEDGER.joined)}>
                        <TableCell className={cn('font-mono text-sm', LEDGER.date)}>
                          {formatDate(entry.date)}
                        </TableCell>
                        <TableCell className={cn('font-mono text-sm', LEDGER.piece)}>
                          {entry.entryNumber}
                        </TableCell>
                        <TableCell className={cn('font-mono text-sm', LEDGER.journal)}>
                          {journalData.journal.code}
                        </TableCell>
                        <TableCell
                          className={cn('font-medium max-w-[300px] truncate', LEDGER.label, LEDGER.wrap)}
                          title={entry.description || entry.reference || undefined}
                        >
                          {entry.description || entry.reference || '-'}
                        </TableCell>
                        <TableCell colSpan={3} className={LEDGER.hidden}></TableCell>
                      </TableRow>
                      {/* Lignes de comptes de l'écriture */}
                      {entry.lines.map((line, lineIndex) => (
                        <TableRow
                          key={`${entry.id}-${lineIndex}`}
                          className={cn('bg-muted/20', LEDGER.row, LEDGER.joined, LEDGER.nested)}
                        >
                          <TableCell colSpan={3} className={LEDGER.hidden}></TableCell>
                          <TableCell
                            className={cn('text-sm text-muted-foreground pl-8 max-w-[300px] truncate', LEDGER.lineLabel)}
                            title={line.description || undefined}
                          >
                            {line.description || <span className={LEDGER.hidden}>-</span>}
                          </TableCell>
                          <TableCell
                            className={cn('font-mono text-sm max-w-[200px] truncate', LEDGER.account)}
                            title={`${line.accountCode} - ${line.accountLabel}`}
                          >
                            {line.accountCode} - {line.accountLabel}
                          </TableCell>
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
                        </TableRow>
                      ))}
                      {/* Total de l'écriture */}
                      <TableRow className={cn('bg-muted/30 border-t', LEDGER.row, LEDGER.totalRow)}>
                        <TableCell
                          colSpan={5}
                          className={cn('font-semibold text-right', LEDGER.totalLabel, LEDGER.totalText)}
                        >
                          Total écriture {entry.entryNumber}
                        </TableCell>
                        <TableCell numeric data-label="Débit" className={cn('font-semibold', LEDGER.amount)}>
                          {formatCurrency(entry.totalDebit)}
                        </TableCell>
                        <TableCell numeric data-label="Crédit" className={cn('font-semibold', LEDGER.amount)}>
                          {formatCurrency(entry.totalCredit)}
                        </TableCell>
                      </TableRow>
                      {/* Espacement entre écritures */}
                      <TableRow className={LEDGER.spacer}>
                        <TableCell colSpan={7} className="h-2 bg-background"></TableCell>
                      </TableRow>
                    </React.Fragment>
                  ))}
                  {/* Totaux du journal */}
                  {showJournalHeaders && (
                    <TableRow className={cn('bg-muted/40 border-t-2', LEDGER.row, LEDGER.totalRow)}>
                      <TableCell colSpan={5} className={cn('font-bold', LEDGER.totalLabel, LEDGER.totalText)}>
                        Total Journal {journalData.journal.code}
                      </TableCell>
                      <TableCell numeric data-label="Débit" className={cn('font-bold', LEDGER.amount)}>
                        {formatCurrency(journalData.totals.debit)}
                      </TableCell>
                      <TableCell numeric data-label="Crédit" className={cn('font-bold', LEDGER.amount)}>
                        {formatCurrency(journalData.totals.credit)}
                      </TableCell>
                    </TableRow>
                  )}
                  {/* Espacement entre journaux */}
                  {showJournalHeaders && (
                    <TableRow className={LEDGER.spacer}>
                      <TableCell colSpan={7} className="h-4 bg-background"></TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              ))}
              {/* Total général */}
              <TableRow
                className={cn('border-t-2 border-t-foreground bg-muted/50 font-bold', LEDGER.row, LEDGER.totalRow)}
              >
                <TableCell colSpan={5} className={cn('font-bold py-3', LEDGER.totalLabel, LEDGER.totalText)}>
                  TOTAL GÉNÉRAL
                </TableCell>
                <TableCell numeric data-label="Débit" className={cn('font-bold py-3', LEDGER.amount)}>
                  {formatCurrency(data.grandTotals.debit)}
                </TableCell>
                <TableCell numeric data-label="Crédit" className={cn('font-bold py-3', LEDGER.amount)}>
                  {formatCurrency(data.grandTotals.credit)}
                </TableCell>
              </TableRow>
            </>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
