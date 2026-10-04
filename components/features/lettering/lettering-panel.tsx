'use client'

import * as React from 'react'
import Link from 'next/link'
import { Link2, Unlink } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Amount, DateDisplay, StatusBadge } from '@/components/shared'
import { plural } from '@/lib/utils/plural'
import { cn } from '@/lib/utils'
import { selectableIds, summarizeSelection, toggleAll, toggleLine, type SelectionLine } from './selection'

export interface PanelLine extends SelectionLine {
  entryId: string
  entryNumber: string
  date: string
  journalCode: string
  reference: string | null
  description: string
  auxiliaryAccountLabel: string | null
  letteringDate: string | null
  reconciled: boolean
  runningBalanceCents: number
}

interface LetteringPanelProps {
  lines: PanelLine[]
  companyId: string
  /** The role may letter (entries:update) and the fiscal year is open. */
  canWrite: boolean
  /** Letters the selected lines; resolves once done (the page reloads the lines). */
  onLetter: (lineIds: string[]) => Promise<void>
  /** Removes a lettering code. */
  onUnletter: (code: string) => void
  busy?: boolean
  empty: React.ReactNode
}

const amount = (cents: number) => (cents === 0 ? <span className="text-muted-foreground">-</span> : <Amount value={cents / 100} />)

function LetteringCode({ line, canWrite, onUnletter }: { line: PanelLine; canWrite: boolean; onUnletter: (code: string) => void }) {
  if (!line.letteringCode) return <span className="text-muted-foreground">-</span>
  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-mono text-xs" title={line.letteringDate ? `Lettrée le ${line.letteringDate}` : undefined}>
        {line.letteringCode}
      </span>
      {canWrite ? (
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label={`Délettrer ${line.letteringCode}`}
          title={`Délettrer ${line.letteringCode}`}
          onClick={() => onUnletter(line.letteringCode as string)}
        >
          <Unlink aria-hidden />
        </Button>
      ) : null}
    </span>
  )
}

/**
 * The lines of a third-party account with a checkbox each, a running
 * balance, and a bar that totals the selection: it letters only when the
 * debits equal the credits (lib/lettering/rules.ts), and says what is
 * missing otherwise.
 */
export function LetteringPanel({ lines, companyId, canWrite, onLetter, onUnletter, busy, empty }: LetteringPanelProps) {
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set())
  // A reload (after a lettering) keeps only the lines still selectable.
  React.useEffect(() => {
    setSelected((current) => {
      const ids = new Set(selectableIds(lines))
      const kept = [...current].filter((id) => ids.has(id))
      return kept.length === current.size ? current : new Set(kept)
    })
  }, [lines])

  const summary = summarizeSelection(lines, selected)
  const selectable = selectableIds(lines)
  const allSelected = selectable.length > 0 && selectable.every((id) => selected.has(id))
  const someSelected = selectable.some((id) => selected.has(id))

  const letter = async () => {
    if (!summary.canLetter) return
    await onLetter(lines.filter((line) => selected.has(line.id)).map((line) => line.id))
    setSelected(new Set())
  }

  const checkboxFor = (line: PanelLine) =>
    line.letteringCode ? null : (
      <Checkbox
        checked={selected.has(line.id)}
        disabled={!canWrite}
        onCheckedChange={() => setSelected((current) => toggleLine(current, line.id))}
        aria-label={`Sélectionner la ligne de l'écriture ${line.entryNumber}`}
      />
    )

  const tiers = (line: PanelLine) =>
    line.auxiliaryAccountNumber ? (
      <span className="block min-w-0">
        <span className="font-mono text-xs">{line.auxiliaryAccountNumber}</span>
        {line.auxiliaryAccountLabel ? <span className="text-muted-foreground block truncate text-xs">{line.auxiliaryAccountLabel}</span> : null}
      </span>
    ) : (
      <span className="text-muted-foreground">-</span>
    )

  return (
    <div className="space-y-3">
      {/* Phones and tablets: one card per line */}
      <ul className="divide-y rounded-md border lg:hidden" aria-label="Lignes du compte">
        {lines.length === 0 ? (
          <li className="text-muted-foreground px-3 py-8 text-center text-sm">{empty}</li>
        ) : (
          lines.map((line) => (
            <li key={line.id} className={cn('flex items-start gap-3 px-3 py-2.5', selected.has(line.id) && 'bg-muted/50')}>
              <div className="pt-0.5">{checkboxFor(line)}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <Link href={`/${companyId}/entries/${line.entryId}`} className="text-link truncate text-sm">
                    {line.description || `Écriture ${line.entryNumber}`}
                  </Link>
                  <span className="shrink-0 text-sm">
                    {line.debitCents > 0 ? <Amount value={line.debitCents / 100} /> : <Amount value={-line.creditCents / 100} />}
                  </span>
                </div>
                <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
                  <DateDisplay value={line.date} />
                  <span className="font-mono">{line.journalCode}</span>
                  <span>n° {line.entryNumber}</span>
                  {line.auxiliaryAccountNumber ? <span className="font-mono">{line.auxiliaryAccountNumber}</span> : null}
                  {line.reconciled ? <StatusBadge tone="info">Rapprochée</StatusBadge> : null}
                  {line.letteringCode ? <LetteringCode line={line} canWrite={canWrite} onUnletter={onUnletter} /> : null}
                </div>
              </div>
            </li>
          ))
        )}
      </ul>

      <div className="hidden rounded-md border lg:block">
        <Table stickyHeader containerClassName="max-h-[60vh]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                  disabled={!canWrite || selectable.length === 0}
                  onCheckedChange={() => setSelected((current) => toggleAll(lines, current))}
                  aria-label="Sélectionner toutes les lignes à lettrer"
                />
              </TableHead>
              <TableHead className="w-24">Date</TableHead>
              <TableHead className="w-20">Écriture</TableHead>
              <TableHead>Libellé</TableHead>
              <TableHead className="w-40">Tiers</TableHead>
              <TableHead numeric>Débit</TableHead>
              <TableHead numeric>Crédit</TableHead>
              <TableHead numeric>Solde progressif</TableHead>
              <TableHead className="w-24">Lettrage</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.length === 0 ? (
              <TableEmpty colSpan={9}>{empty}</TableEmpty>
            ) : (
              lines.map((line) => (
                <TableRow key={line.id} data-state={selected.has(line.id) ? 'selected' : undefined}>
                  <TableCell>{checkboxFor(line)}</TableCell>
                  <TableCell>
                    <DateDisplay value={line.date} />
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs">{line.journalCode}</span>{' '}
                    <Link href={`/${companyId}/entries/${line.entryId}`} className="text-link text-xs">
                      {line.entryNumber}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-72">
                    <span className="block truncate" title={line.description}>
                      {line.description || '-'}
                    </span>
                    {line.reconciled ? <StatusBadge tone="info">Rapprochée</StatusBadge> : null}
                  </TableCell>
                  <TableCell>{tiers(line)}</TableCell>
                  <TableCell numeric>{amount(line.debitCents)}</TableCell>
                  <TableCell numeric>{amount(line.creditCents)}</TableCell>
                  <TableCell numeric>
                    <Amount value={line.runningBalanceCents / 100} />
                  </TableCell>
                  <TableCell>
                    <LetteringCode line={line} canWrite={canWrite} onUnletter={onUnletter} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {canWrite && selectable.length > 0 ? (
        <div
          className="bg-card sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 shadow-sm pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          role="status"
          aria-live="polite"
          aria-label="Sélection"
        >
          <div className="min-w-0 space-y-0.5 text-sm">
            <p>
              {summary.count === 0 ? 'Aucune ligne sélectionnée' : plural(summary.count, 'ligne sélectionnée', 'lignes sélectionnées')}
              {summary.count > 0 ? (
                <>
                  {' '}· Débit <Amount value={summary.debitCents / 100} /> · Crédit <Amount value={summary.creditCents / 100} />
                </>
              ) : null}
            </p>
            {summary.count > 0 && summary.balanceCents !== 0 ? (
              <p className="text-warning text-xs" data-testid="selection-gap">
                Écart de <Amount value={Math.abs(summary.balanceCents) / 100} />&nbsp;: sélectionnez les lignes qui soldent ce tiers.
              </p>
            ) : summary.count >= 2 && summary.errors.length > 0 ? (
              <p className="text-warning text-xs">{summary.errors[0]}</p>
            ) : summary.canLetter ? (
              <p className="text-muted-foreground text-xs">Débits et crédits sont égaux&nbsp;: ces lignes peuvent être lettrées.</p>
            ) : (
              <p className="text-muted-foreground text-xs">Cochez une facture et le règlement qui la solde.</p>
            )}
          </div>
          <Button type="button" size="sm" onClick={letter} disabled={!summary.canLetter || busy} loading={busy}>
            <Link2 aria-hidden />
            Lettrer la sélection
          </Button>
        </div>
      ) : null}
    </div>
  )
}
