/**
 * Table of a financial statement side (Produits, Charges, Actif, Passif).
 *
 * The official labels are long ("Produits nets partiels sur cessions de
 * valeurs mobilières de placement..."), so the layout is fixed: the form
 * code sits in a narrow column, each amount column has a fixed width, never
 * wraps and is right aligned with tabular figures, and the label takes what
 * is left and wraps. The amounts are therefore always visible, whatever the
 * label length, without scrolling the table sideways.
 *
 * Widths follow the table's own container (container queries), not the
 * viewport: the same table sits in a half-width card next to its other side
 * or alone on a phone. Secondary columns (Brut, Amortissement) leave their
 * column when the container is narrow and are listed under the label
 * instead, so the Net column keeps a readable width at 375 px.
 */

import type { CSSProperties } from 'react'

import { cn } from '@/lib/utils'
import { formatAmount } from '@/components/shared'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { StatementRow, StatementValue } from './statement-rows'

export interface StatementColumn {
  key: string
  label: string
  /** Moved under the label when the table is narrow (Brut, Amortissement). */
  secondary?: boolean
}

interface Props {
  columns: StatementColumn[]
  rows: StatementRow[]
  /** Total of the side, in the footer, each amount under its column. */
  footer?: { label: string; values: Record<string, StatementValue> }
  emptyMessage?: string
  /** Accessible name of the table ("Produits"). */
  label: string
}

/** Statement amounts: negative in parentheses, the accounting convention of the forms. */
export function formatStatementAmount(value: number): string {
  const text = formatAmount(Math.abs(value), { currency: false })
  const rounded = formatAmount(value, { currency: false })
  return `${rounded.startsWith('-') ? `(${text})` : text} €`
}

function renderValue(value: StatementValue): string {
  if (value === undefined) return ''
  if (value === null) return '-'
  return formatStatementAmount(value)
}

// Amount columns: 120 px on narrow containers, 144 px from 28rem. Enough for
// "12 345 678,90 €" in tabular figures at text-sm.
const AMOUNT_WIDTH = 'w-30 @min-[28rem]/statement:w-36'
const AMOUNT_PADDING = 'px-2 @min-[28rem]/statement:px-3'
// Secondary columns appear from 40rem of table width.
const SECONDARY_COLUMN = 'hidden @min-[40rem]/statement:table-cell'
const SECONDARY_INLINE = '@min-[40rem]/statement:hidden'
// Sub-line indentation: 8 px a level on narrow tables, 12 px from 28rem.
const INDENT = 'pl-[calc(8px+var(--level)*8px)] @min-[28rem]/statement:pl-[calc(12px+var(--level)*12px)]'

function SecondaryValues({ columns, values }: { columns: StatementColumn[]; values: Record<string, StatementValue> }) {
  const shown = columns.filter((c) => values[c.key] !== undefined && values[c.key] !== null)
  if (shown.length === 0) return null
  return (
    <span
      data-slot="statement-secondary"
      className={cn('mt-0.5 flex flex-wrap gap-x-3 text-xs font-normal text-muted-foreground', SECONDARY_INLINE)}
    >
      {shown.map((c) => (
        <span key={c.key} className="num whitespace-nowrap">
          {c.label}&nbsp;: {renderValue(values[c.key])}
        </span>
      ))}
    </span>
  )
}

export function StatementTable({ columns, rows, footer, emptyMessage, label }: Props) {
  const hasCodes = rows.some((r) => r.formCode && !r.hideLabel)
  const secondary = columns.filter((c) => c.secondary)
  const columnClass = (c: StatementColumn) => cn(AMOUNT_WIDTH, AMOUNT_PADDING, c.secondary && SECONDARY_COLUMN)
  const colCount = columns.length + 1 + (hasCodes ? 1 : 0)

  return (
    <div data-slot="statement-table" className="@container/statement">
      <Table aria-label={label} className="table-fixed">
        <TableHeader>
          <TableRow>
            {hasCodes && (
              <TableHead className="w-11 px-2">
                <span className="sr-only">Code</span>
              </TableHead>
            )}
            <TableHead>Libellé</TableHead>
            {columns.map((c) => (
              <TableHead key={c.key} numeric data-column={c.key} className={columnClass(c)}>
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={colCount} className="py-8 text-center whitespace-normal text-muted-foreground">
                {emptyMessage ?? 'Aucune ligne à afficher.'}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow
                key={row.id}
                data-kind={row.kind}
                className={cn(
                  row.kind === 'total' && 'bg-muted/60 font-semibold',
                  row.kind === 'section' && 'bg-muted/30 font-medium',
                )}
              >
                {hasCodes && (
                  <TableCell className="w-11 px-2 align-top font-mono text-xs text-muted-foreground">
                    {!row.hideLabel && row.formCode}
                  </TableCell>
                )}
                <TableCell
                  data-slot="statement-label"
                  // Words are hyphenated (lang="fr") rather than cut anywhere on narrow tables.
                  className={cn('align-top whitespace-normal hyphens-auto break-words', INDENT)}
                  // Indentation of sub-lines, compact and capped so deep lines keep their width.
                  style={{ '--level': Math.min(row.level, 4) } as CSSProperties}
                >
                  {!row.hideLabel && (
                    <>
                      {row.label}
                      {row.note && <span className="ml-2 text-xs font-normal text-muted-foreground">({row.note})</span>}
                    </>
                  )}
                  <SecondaryValues columns={secondary} values={row.values} />
                </TableCell>
                {columns.map((c) => (
                  <TableCell
                    key={c.key}
                    numeric
                    data-column={c.key}
                    className={cn('align-top whitespace-nowrap', columnClass(c))}
                  >
                    {renderValue(row.values[c.key])}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
        {footer && (
          <TableFooter>
            <TableRow className="font-semibold">
              <TableCell colSpan={hasCodes ? 2 : 1} className="align-top whitespace-normal">
                {footer.label}
                <SecondaryValues columns={secondary} values={footer.values} />
              </TableCell>
              {columns.map((c) => (
                <TableCell
                  key={c.key}
                  numeric
                  data-column={c.key}
                  className={cn('align-top whitespace-nowrap', columnClass(c))}
                >
                  {renderValue(footer.values[c.key])}
                </TableCell>
              ))}
            </TableRow>
          </TableFooter>
        )}
      </Table>
    </div>
  )
}
