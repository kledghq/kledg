import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

import { ColumnMapping } from '../column-mapping'

/**
 * The 18 columns of a FEC, in the order of the Livre des procédures fiscales,
 * art. A47 A-1 (tab separated, the usual export).
 */
const FEC_HEADER = [
  'JournalCode',
  'JournalLib',
  'EcritureNum',
  'EcritureDate',
  'CompteNum',
  'CompteLib',
  'CompAuxNum',
  'CompAuxLib',
  'PieceRef',
  'PieceDate',
  'EcritureLib',
  'Debit',
  'Credit',
  'EcritureLet',
  'DateLet',
  'ValidDate',
  'Montantdevise',
  'Idevise',
]

const fecLine = (num: string, account: string, label: string, debit: string, credit: string) =>
  ['VT', 'Ventes', num, '20260105', account, label, '', '', `F${num}`, '20260105', 'Facture', debit, credit, '', '', '20260106', '', ''].join('\t')

const FEC = [
  FEC_HEADER.join('\t'),
  fecLine('1', '41100000', 'Clients', '1200,00', '0,00'),
  fecLine('1', '70600000', 'Prestations', '0,00', '1000,00'),
  fecLine('1', '44571000', 'TVA collectée', '0,00', '200,00'),
  fecLine('2', '41100000', 'Clients', '60,00', '0,00'),
  fecLine('2', '70600000', 'Prestations', '0,00', '50,00'),
  fecLine('2', '44571000', 'TVA collectée', '0,00', '10,00'),
].join('\n')

const REQUIRED_LABELS = [
  'Code Journal',
  'Libellé Journal',
  'Numéro Écriture',
  'Date Écriture',
  'Numéro Compte',
  'Libellé Compte',
  'Débit',
  'Crédit',
]

/** The select of a field: the trigger next to its label (the label is not wired to it). */
function fieldSelect(label: string): HTMLElement {
  const row = screen.getByText(label, { selector: 'label' }).parentElement as HTMLElement
  return within(row).getByRole('combobox')
}

function renderMapping(content: string) {
  const onMappingComplete = vi.fn()
  const onCancel = vi.fn()
  render(<ColumnMapping fileContent={content} companyId="co-1" onMappingComplete={onMappingComplete} onCancel={onCancel} />)
  return { onMappingComplete, onCancel }
}

describe('ColumnMapping', () => {
  it('maps every column of a standard FEC by itself and passes the mapping on', async () => {
    const user = userEvent.setup()
    const { onMappingComplete } = renderMapping(FEC)

    for (const label of REQUIRED_LABELS) expect(fieldSelect(label)).not.toHaveTextContent('-- Aucune --')
    expect(fieldSelect('Numéro Compte')).toHaveTextContent('CompteNum')
    expect(fieldSelect('Code Devise')).toHaveTextContent('Idevise')

    await user.click(screen.getByRole('button', { name: 'Suivant' }))
    expect(onMappingComplete).toHaveBeenCalledWith(Object.fromEntries(FEC_HEADER.map((h) => [h, h])))
  })

  it('previews the first five lines of the file under its header', () => {
    renderMapping(FEC)
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(FEC_HEADER)
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(5)
    expect(within(rows[0]).getByText('41100000')).toBeInTheDocument()
    expect(within(rows[0]).getByText('1200,00')).toBeInTheDocument()
    // Empty cells read "-"
    expect(within(rows[0]).getAllByText('-').length).toBeGreaterThan(0)
    // The sixth data line is not previewed
    expect(within(table).queryByText('10,00')).not.toBeInTheDocument()
  })

  it('needs every required field before going on, and lets the user pick the missing columns', async () => {
    const user = userEvent.setup()
    const content = ['Jnl;Lib. jnl;N° pièce;Date;Compte;Intitulé;Montant D;Montant C', 'VT;Ventes;1;05/01/2026;411000;Clients;1200,00;0,00'].join('\n')
    const { onMappingComplete } = renderMapping(content)

    const next = screen.getByRole('button', { name: 'Suivant' })
    // Only the semicolon-separated columns with known names are found
    expect(fieldSelect('Date Écriture')).toHaveTextContent('Date')
    expect(fieldSelect('Numéro Compte')).toHaveTextContent('Compte')
    expect(fieldSelect('Code Journal')).toHaveTextContent('-- Aucune --')
    expect(fieldSelect('Libellé Journal')).toHaveTextContent('-- Aucune --')
    expect(next).toBeDisabled()

    const pick = async (label: string, column: string) => {
      await user.click(fieldSelect(label))
      await user.click(await screen.findByRole('option', { name: column }))
    }
    await pick('Code Journal', 'Jnl')
    await pick('Libellé Journal', 'Lib. jnl')
    await pick('Numéro Écriture', 'N° pièce')
    await pick('Libellé Compte', 'Intitulé')
    await pick('Débit', 'Montant D')
    expect(next).toBeDisabled()
    await pick('Crédit', 'Montant C')
    expect(next).toBeEnabled()

    // "Aucune" takes a required field away again
    await pick('Crédit', '-- Aucune --')
    expect(next).toBeDisabled()
    await pick('Crédit', 'Montant C')

    await user.click(next)
    expect(onMappingComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        JournalCode: 'Jnl',
        JournalLib: 'Lib. jnl',
        EcritureNum: 'N° pièce',
        EcritureDate: 'Date',
        CompteNum: 'Compte',
        CompteLib: 'Intitulé',
        Debit: 'Montant D',
        Credit: 'Montant C',
      }),
    )
  })

  // Each column goes to one field: the generic "journal" of Code Journal never takes "Libellé journal"
  it('does not give the journal label column to Code Journal', () => {
    renderMapping(['Jnl;Libellé journal;N° pièce', 'VT;Ventes;1'].join('\n'))
    expect(fieldSelect('Libellé Journal')).toHaveTextContent('Libellé journal')
    expect(fieldSelect('Code Journal')).not.toHaveTextContent('Libellé journal')
  })

  it('accepts a column without a header for a required field', async () => {
    const user = userEvent.setup()
    const content = ['JournalCode;;EcritureNum;EcritureDate;CompteNum;CompteLib;Debit;Credit', 'VT;Ventes;1;20260105;411000;Clients;10,00;0,00'].join('\n')
    const { onMappingComplete } = renderMapping(content)

    await user.click(fieldSelect('Libellé Journal'))
    await user.click(await screen.findByRole('option', { name: '(Colonne 2)' }))
    await user.click(screen.getByRole('button', { name: 'Suivant' }))
    expect(onMappingComplete).toHaveBeenCalledWith(expect.objectContaining({ JournalLib: '' }))
  })

  // A column without a header ('') is a mapped column, not "-- Aucune --"
  it('shows the headerless column chosen for a field', async () => {
    const user = userEvent.setup()
    renderMapping(['JournalCode;;EcritureNum', 'VT;Ventes;1'].join('\n'))
    await user.click(fieldSelect('Libellé Journal'))
    await user.click(await screen.findByRole('option', { name: '(Colonne 2)' }))
    expect(fieldSelect('Libellé Journal')).toHaveTextContent('(Colonne 2)')
  })

  it('cancels, and stays empty for an empty file', async () => {
    const user = userEvent.setup()
    const { onCancel, onMappingComplete } = renderMapping('\n\n')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Suivant' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onMappingComplete).not.toHaveBeenCalled()
  })
})
