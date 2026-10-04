/**
 * Lettering selection (components/features/lettering): the bar totals the
 * checked lines, says the gap of an unbalanced selection and letters only
 * a balanced one, with the same rules as the server
 * (lib/lettering/rules.ts); lettered lines cannot be checked and offer to
 * unletter; a role without entries:update sees no checkbox enabled.
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LetteringPanel, type PanelLine } from '../lettering-panel'
import { summarizeSelection, toggleAll, toggleLine } from '../selection'

function line(id: string, entryNumber: string, debitCents: number, creditCents: number, extra: Partial<PanelLine> = {}): PanelLine {
  return {
    id,
    entryId: `e-${id}`,
    entryNumber,
    date: '2026-02-01',
    journalCode: 'VE',
    reference: null,
    description: `Ligne ${entryNumber}`,
    debitCents,
    creditCents,
    auxiliaryAccountNumber: 'C001',
    auxiliaryAccountLabel: 'Martin SA',
    letteringCode: null,
    letteringDate: null,
    reconciled: false,
    runningBalanceCents: 0,
    ...extra,
  }
}

const LINES = [
  line('f1', '1', 120_000, 0),
  line('p1', '2', 0, 100_000, { journalCode: 'BQ', reconciled: true }),
  line('p2', '3', 0, 20_000, { journalCode: 'BQ' }),
  line('old', '4', 5_000, 0, { letteringCode: 'AA', letteringDate: '2026-01-15' }),
]

function renderPanel(props: Partial<React.ComponentProps<typeof LetteringPanel>> = {}) {
  const onLetter = vi.fn(async () => {})
  const onUnletter = vi.fn()
  render(<LetteringPanel lines={LINES} companyId="acme" canWrite onLetter={onLetter} onUnletter={onUnletter} empty="Rien" {...props} />)
  // The desktop table (the phone list holds the same checkboxes)
  const table = screen.getByRole('table')
  return { onLetter, onUnletter, table }
}

describe('selection helpers', () => {
  it('totals the selection and letters only balanced, unlettered lines', () => {
    expect(summarizeSelection(LINES, new Set(['f1', 'p1']))).toMatchObject({ count: 2, balanceCents: 20_000, canLetter: false })
    expect(summarizeSelection(LINES, new Set(['f1', 'p1', 'p2']))).toMatchObject({ count: 3, balanceCents: 0, canLetter: true, errors: [] })
    expect(summarizeSelection(LINES, new Set(['f1', 'old', 'gone']))).toMatchObject({ count: 2, canLetter: false })
    expect(toggleLine(new Set(['a']), 'a')).toEqual(new Set())
    expect(toggleAll(LINES, new Set())).toEqual(new Set(['f1', 'p1', 'p2']))
    expect(toggleAll(LINES, new Set(['f1', 'p1', 'p2']))).toEqual(new Set())
  })
})

describe('LetteringPanel', () => {
  it('shows the gap of an unbalanced selection and keeps the action disabled', async () => {
    const user = userEvent.setup()
    const { table, onLetter } = renderPanel()
    await user.click(within(table).getByRole('checkbox', { name: "Sélectionner la ligne de l'écriture 1" }))
    await user.click(within(table).getByRole('checkbox', { name: "Sélectionner la ligne de l'écriture 2" }))
    const bar = screen.getByRole('status', { name: 'Sélection' })
    expect(bar).toHaveTextContent('2 lignes sélectionnées')
    expect(screen.getByTestId('selection-gap')).toHaveTextContent(/Écart de 200,00\s€/)
    const button = screen.getByRole('button', { name: 'Lettrer la sélection' })
    expect(button).toBeDisabled()
    await user.click(button)
    expect(onLetter).not.toHaveBeenCalled()
  })

  it('letters a balanced selection with the ids in list order, then clears it', async () => {
    const user = userEvent.setup()
    const { table, onLetter } = renderPanel()
    await user.click(within(table).getByRole('checkbox', { name: "Sélectionner la ligne de l'écriture 3" }))
    await user.click(within(table).getByRole('checkbox', { name: "Sélectionner la ligne de l'écriture 1" }))
    await user.click(within(table).getByRole('checkbox', { name: "Sélectionner la ligne de l'écriture 2" }))
    expect(screen.getByRole('status', { name: 'Sélection' })).toHaveTextContent('ces lignes peuvent être lettrées')
    await user.click(screen.getByRole('button', { name: 'Lettrer la sélection' }))
    expect(onLetter).toHaveBeenCalledWith(['f1', 'p1', 'p2'])
    expect(await screen.findByText('Aucune ligne sélectionnée')).toBeInTheDocument()
  })

  it('selects every unlettered line from the header, never a lettered one', async () => {
    const user = userEvent.setup()
    const { table } = renderPanel()
    await user.click(within(table).getByRole('checkbox', { name: 'Sélectionner toutes les lignes à lettrer' }))
    expect(screen.getByRole('status', { name: 'Sélection' })).toHaveTextContent('3 lignes sélectionnées')
    expect(within(table).queryByRole('checkbox', { name: "Sélectionner la ligne de l'écriture 4" })).toBeNull()
  })

  it('offers to unletter a lettered line', async () => {
    const user = userEvent.setup()
    const { table, onUnletter } = renderPanel()
    await user.click(within(table).getByRole('button', { name: 'Délettrer AA' }))
    expect(onUnletter).toHaveBeenCalledWith('AA')
  })

  it('disables everything for a role that cannot letter', () => {
    const { table } = renderPanel({ canWrite: false })
    for (const checkbox of within(table).getAllByRole('checkbox')) expect(checkbox).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Lettrer la sélection' })).toBeNull()
    expect(within(table).queryByRole('button', { name: 'Délettrer AA' })).toBeNull()
  })

  it('says what to do when there is nothing to letter', () => {
    render(<LetteringPanel lines={[]} companyId="acme" canWrite onLetter={async () => {}} onUnletter={() => {}} empty="Toutes les lignes sont lettrées." />)
    expect(within(screen.getByRole('table')).getByText('Toutes les lignes sont lettrées.')).toBeInTheDocument()
  })
})
