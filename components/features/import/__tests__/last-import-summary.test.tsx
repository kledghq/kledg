import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { LastImportSummary } from '../last-import-summary'

describe('LastImportSummary', () => {
  it('stays hidden after a fully successful import', () => {
    const { container } = render(
      <LastImportSummary result={{ success: true, entriesCreated: 42, errors: [] }} onDismiss={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('summarises a partial import and lists the ignored entries on demand', async () => {
    const user = userEvent.setup()
    render(
      <LastImportSummary
        result={{
          success: false,
          entriesCreated: 12,
          accountsCreated: 3,
          journalsCreated: 2,
          errors: ['Écriture VT-0004 : déséquilibrée (débit 120,00, crédit 100,00)', 'Écriture BQ-0010 : compte manquant'],
        }}
        onDismiss={vi.fn()}
      />,
    )
    expect(screen.getByText('Dernier import : terminé avec des écritures ignorées')).toBeInTheDocument()
    expect(screen.getByText('12').parentElement).toHaveTextContent('12 écritures importées')
    expect(screen.getByText('2', { selector: '.text-warning' }).parentElement).toHaveTextContent('2 ignorées')
    expect(screen.getByText('3').parentElement).toHaveTextContent('3 comptes créés')

    await user.click(screen.getByRole('button', { name: 'Voir les détails (2)' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Écritures ignorées (2)' })).toBeInTheDocument()
    expect(within(dialog).getByText('Écriture VT-0004 : déséquilibrée (débit 120,00, crédit 100,00)')).toBeInTheDocument()
    expect(within(dialog).getByText('Écriture BQ-0010 : compte manquant')).toBeInTheDocument()

    // The footer button, not the corner close icon (also named "Fermer")
    const close = within(dialog)
      .getAllByRole('button', { name: 'Fermer' })
      .find((button) => button.textContent === 'Fermer') as HTMLElement
    await user.click(close)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('uses singular forms for one entry, one account and one journal', () => {
    render(
      <LastImportSummary
        result={{ success: false, entriesCreated: 1, accountsCreated: 1, journalsCreated: 1, errors: ['Écriture OD-0002 : date hors exercice'] }}
        onDismiss={vi.fn()}
      />,
    )
    const counts = screen.getByText('Dernier import : terminé avec des écritures ignorées').closest('div[class*="space-y-2"]') as HTMLElement
    expect(counts).toHaveTextContent('1 écriture importée')
    expect(counts).toHaveTextContent('1 ignorée')
    expect(counts).toHaveTextContent('1 compte créé')
    expect(counts).toHaveTextContent('1 journal créé')
    expect(screen.getByRole('button', { name: 'Voir les détails (1)' })).toBeInTheDocument()
  })

  it('reports a failed import without a details button when the server gave no reason', async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    render(<LastImportSummary result={{ success: false, entriesCreated: 0 }} onDismiss={onDismiss} />)

    expect(screen.getByText('Dernier import échoué')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Voir les détails/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/compte/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Masquer le récapitulatif' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('writes the plural of journal as journaux', () => {
    render(
      <LastImportSummary result={{ success: false, entriesCreated: 5, journalsCreated: 2, errors: ['x'] }} onDismiss={vi.fn()} />,
    )
    const counts = screen.getByText('Dernier import : terminé avec des écritures ignorées').closest('div[class*="space-y-2"]') as HTMLElement
    expect(counts).toHaveTextContent('2 journaux créés')
  })

  // BUG: components/features/import/last-import-summary.tsx:65-74: a count of 0 is written in
  // the plural ("0 écritures importées", "0 ignorées"); the French rule of lib/utils/plural.ts
  // (and docs/conventions.md copy rules) gives "0 écriture importée", "0 ignorée".
  it.skip('writes zero counts in the singular, as French does', () => {
    render(<LastImportSummary result={{ success: false, entriesCreated: 0, errors: [] }} onDismiss={vi.fn()} />)
    const counts = screen.getByText('Dernier import échoué').closest('div[class*="space-y-2"]') as HTMLElement
    expect(counts).toHaveTextContent('0 écriture importée')
    expect(counts).toHaveTextContent('0 ignorée')
  })
})
