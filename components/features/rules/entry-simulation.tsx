'use client'

import { CheckCircle2, XCircle } from 'lucide-react'

import { Amount } from '@/components/shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { fromCents, toCents } from '@/lib/utils/money'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'

/** Entry computed by the simulate endpoints of the assignment rules. */
export interface SimulatedEntry {
  entryLines: Array<{
    account: { code: string; label: string }
    debit: number
    credit: number
    description: string
    vatInfo?: {
      type: string
      rate: number
      amount: number
    }
  }>
  totalDebit: number
  totalCredit: number
  balanced: boolean
}

interface EntrySimulationProps extends SimulatedEntry {
  compact?: boolean
}

const VAT_TYPES: Record<string, string> = {
  collectible: 'TVA collectée',
  deductible: 'TVA déductible',
  intracom: 'TVA intracommunautaire',
  import: "TVA à l'import",
  exempt: 'Exonéré',
  reverse_charge: 'Autoliquidation',
}

/** Difference between debits and credits, computed in cents so 0,1 + 0,2 stays exact. */
function gapOf(totalDebit: number, totalCredit: number): number {
  return fromCents(Math.abs((toCents(totalDebit) ?? 0) - (toCents(totalCredit) ?? 0)))
}

export function EntrySimulation({ entryLines, totalDebit, totalCredit, balanced, compact = false }: EntrySimulationProps) {
  if (entryLines.length === 0) {
    return (
      <Alert>
        <AlertDescription>Aucune ligne d&apos;écriture à afficher.</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-4">
      <Table containerClassName="rounded-lg border">
        <TableHeader>
          <TableRow>
            <TableHead>Compte</TableHead>
            <TableHead numeric>Débit</TableHead>
            <TableHead numeric>Crédit</TableHead>
            {!compact && <TableHead>Libellé</TableHead>}
            {!compact && <TableHead numeric>TVA</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {entryLines.map((line, index) => (
            <TableRow key={index}>
              <TableCell>
                <div className="font-mono text-xs">{line.account.code}</div>
                {!compact && <div className="text-muted-foreground text-xs">{line.account.label}</div>}
              </TableCell>
              <TableCell numeric>{line.debit > 0 ? <Amount value={line.debit} /> : null}</TableCell>
              <TableCell numeric>{line.credit > 0 ? <Amount value={line.credit} /> : null}</TableCell>
              {!compact && (
                <TableCell className="whitespace-normal">
                  <div>{line.description}</div>
                  {line.vatInfo && (
                    <div className="text-muted-foreground text-xs">
                      {VAT_TYPES[line.vatInfo.type] ?? line.vatInfo.type} {String(line.vatInfo.rate).replace('.', ',')} %
                    </div>
                  )}
                </TableCell>
              )}
              {!compact && (
                <TableCell numeric>{line.vatInfo ? <Amount value={line.vatInfo.amount} /> : null}</TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell>Total</TableCell>
            <TableCell numeric>
              <Amount value={totalDebit} />
            </TableCell>
            <TableCell numeric>
              <Amount value={totalCredit} />
            </TableCell>
            {!compact && <TableCell colSpan={2} />}
          </TableRow>
        </TableFooter>
      </Table>

      <p className="flex items-center gap-2 text-sm font-medium" role="status">
        {balanced ? (
          <>
            <CheckCircle2 aria-hidden className="text-success size-4" />
            Écriture équilibrée
          </>
        ) : (
          <>
            <XCircle aria-hidden className="text-destructive size-4" />
            <span>
              Écriture non équilibrée&nbsp;: écart de <Amount value={gapOf(totalDebit, totalCredit)} />
            </span>
          </>
        )}
      </p>
    </div>
  )
}
