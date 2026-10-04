/**
 * Statement tables of the bilan and the compte de résultat. On the owner's
 * screen the long official labels ("Produits nets partiels sur cessions de
 * valeurs mobilières de placement...") never wrapped, so the Montant column
 * was pushed out of the card and the Produits table had to be scrolled
 * sideways to read any amount. The layout is now fixed: labels wrap, amount
 * columns have a fixed width and never wrap.
 *
 * The actif total is the Net column: on Atelier Lumen 2026 the old total
 * line printed Brut (45 547,41), Amortissement (646,58) and Net (44 900,83)
 * in a row without headers, which read as "TOTAL ACTIF 45 547,41 €" against
 * a passif of 44 900,83 €.
 */

import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { StatementTable, formatStatementAmount, type StatementColumn } from '../statement-table'
import { flattenStatementLines, isZeroAmount, type StatementRow } from '../statement-rows'

const LONG_LABEL =
  'Produits nets partiels sur cessions de valeurs mobilières de placement et autres produits financiers'

const montant: StatementColumn[] = [{ key: 'montant', label: 'Montant' }]
const brutAmortNet: StatementColumn[] = [
  { key: 'brut', label: 'Brut', secondary: true },
  { key: 'amortissements', label: 'Amortissement', secondary: true },
  { key: 'net', label: 'Net' },
]

const row = (over: Partial<StatementRow> & { id: string }): StatementRow => ({
  level: 0,
  label: over.id,
  kind: 'line',
  values: {},
  ...over,
})

const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s/g, ' ')

describe('StatementTable', () => {
  it('renders the amount in a fixed, unwrapped column next to a wrapping label', () => {
    const { container } = render(
      <StatementTable
        label="Produits"
        columns={montant}
        rows={[row({ id: 'fs', label: LONG_LABEL, formCode: 'GN', values: { montant: 1234.56 } })]}
      />,
    )

    const table = screen.getByRole('table', { name: 'Produits' })
    // Fixed layout: column widths come from the header, never from the label length.
    expect(table.className).toContain('table-fixed')
    expect(container.querySelector('[data-slot="statement-table"]')?.className).toContain('@container/statement')

    const label = container.querySelector('[data-slot="statement-label"]')
    expect(label?.textContent).toContain(LONG_LABEL)
    expect(label?.className).toContain('whitespace-normal')
    expect(label?.className).not.toContain('whitespace-nowrap')

    const header = container.querySelector('th[data-column="montant"]')
    expect(header?.className).toMatch(/\bw-30\b/)
    expect(header?.className).toMatch(/w-36/)

    const cell = container.querySelector('tbody td[data-column="montant"]')
    expect(cell).not.toBeNull()
    expect(cell?.className).toContain('whitespace-nowrap')
    expect(cell?.className).toContain('text-right')
    expect(cell?.className).toContain('num')
    // Not truncated: the full amount is in the cell, no ellipsis or clipping.
    expect(text(cell)).toBe(text({ textContent: formatStatementAmount(1234.56) } as Element))
    expect(cell?.className).not.toMatch(/truncate|overflow-hidden|text-ellipsis/)

    // The form code sits in its own narrow column, before the label.
    const code = container.querySelector('tbody td:first-child')
    expect(code?.textContent).toBe('GN')
    expect(code?.className).toContain('w-11')
  })

  it('formats negative statement amounts in parentheses with the euro sign', () => {
    expect(text({ textContent: formatStatementAmount(-1500) } as Element)).toBe('(1 500,00) €')
    expect(text({ textContent: formatStatementAmount(0) } as Element)).toBe('0,00 €')
  })

  it('puts each actif total under its column and the net in the Net column', () => {
    const { container } = render(
      <StatementTable
        label="Actif"
        columns={brutAmortNet}
        rows={[row({ id: 'a', values: { brut: 100, amortissements: 10, net: 90 } })]}
        footer={{ label: 'TOTAL ACTIF (net)', values: { brut: 45547.41, amortissements: 646.58, net: 44900.83 } }}
      />,
    )
    const foot = container.querySelector('tfoot tr')!
    const cell = (column: string) => text(foot.querySelector(`[data-column="${column}"]`))
    expect(within(foot as HTMLElement).getByText('TOTAL ACTIF (net)')).toBeInTheDocument()
    expect(cell('brut')).toBe(text({ textContent: formatStatementAmount(45547.41) } as Element))
    expect(cell('amortissements')).toBe(text({ textContent: formatStatementAmount(646.58) } as Element))
    expect(cell('net')).toBe(text({ textContent: formatStatementAmount(44900.83) } as Element))
    // Last cell of the row: the Net column, the total of the side.
    expect(foot.querySelector('td:last-child')?.getAttribute('data-column')).toBe('net')
  })

  it('moves Brut and Amortissement under the label on narrow tables, keeping Net in its column', () => {
    const { container } = render(
      <StatementTable
        label="Actif"
        columns={brutAmortNet}
        rows={[row({ id: 'a', label: 'Constructions', values: { brut: 100, amortissements: 10, net: 90 } })]}
      />,
    )
    const brutHeader = container.querySelector('th[data-column="brut"]')
    expect(brutHeader?.className).toContain('hidden')
    expect(brutHeader?.className).toContain('@min-[40rem]/statement:table-cell')
    expect(container.querySelector('th[data-column="net"]')?.className).not.toContain('hidden')

    const inline = container.querySelector('[data-slot="statement-secondary"]')
    expect(inline?.className).toContain('@min-[40rem]/statement:hidden')
    expect(text(inline)).toContain('Brut : 100,00 €')
    expect(text(inline)).toContain('Amortissement : 10,00 €')
  })

  it('leaves out the code column when no line has a form code', () => {
    const { container } = render(
      <StatementTable label="Charges" columns={montant} rows={[row({ id: 'x', values: { montant: 1 } })]} />,
    )
    expect(container.querySelectorAll('thead th')).toHaveLength(2)
  })
})

interface Line {
  id: string
  label: string
  value: number
  children?: Line[]
}

const flatten = (lines: Line[], hideZeroLines: boolean) =>
  flattenStatementLines(lines, {
    hideZeroLines,
    isZero: (l) => isZeroAmount(l.value),
    toRow: (l, level) => ({
      id: l.id,
      level,
      label: l.label,
      kind: l.label.startsWith('Total') ? 'total' : l.children ? 'section' : 'line',
      values: { montant: l.value },
    }),
  })

describe('flattenStatementLines', () => {
  const lines: Line[] = [
    {
      id: 'g',
      label: 'Produits d’exploitation',
      value: 0,
      children: [
        { id: 'a', label: 'Ventes de marchandises', value: 1000 },
        { id: 'b', label: 'Production vendue', value: 0 },
      ],
    },
    { id: 'empty', label: 'Produits financiers', value: 0, children: [{ id: 'c', label: 'Intérêts', value: 0 }] },
    { id: 't', label: 'Total produits', value: 0 },
  ]

  it('keeps every line with their depth when zero lines are shown', () => {
    const { rows, hiddenCount } = flatten(lines, false)
    expect(rows.map((r) => [r.id, r.level])).toEqual([
      ['g', 0],
      ['a', 1],
      ['b', 1],
      ['empty', 0],
      ['c', 1],
      ['t', 0],
    ])
    expect(hiddenCount).toBe(0)
  })

  it('hides zero lines but keeps totals and the headers of visible lines', () => {
    const { rows, hiddenCount } = flatten(lines, true)
    expect(rows.map((r) => r.id)).toEqual(['g', 'a', 't'])
    expect(hiddenCount).toBe(3)
  })
})
