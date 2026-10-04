import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { FixedAssetFormDialog, type FixedAssetFormData } from '../fixed-asset-form-dialog'

// Native inputs instead of the Radix popover pickers, so the tests drive the
// form logic and not the calendar widget.
vi.mock('@/components/ui/date-picker', () => ({
  DatePicker: ({
    id,
    date,
    onDateChange,
  }: {
    id?: string
    date?: Date
    onDateChange: (d: Date | undefined) => void
  }) => {
    const pad = (n: number) => String(n).padStart(2, '0')
    const value = date ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` : ''
    return (
      <input
        data-testid={`date-${id}`}
        type="date"
        value={value}
        onChange={(e) => onDateChange(e.target.value ? new Date(`${e.target.value}T00:00:00`) : undefined)}
      />
    )
  },
}))

vi.mock('@/components/features/accounting/account-combobox', () => ({
  AccountCombobox: ({
    id,
    accounts,
    value,
    onValueChange,
  }: {
    id?: string
    accounts: Array<{ id: string; code: string; label: string }>
    value: string
    onValueChange: (v: string) => void
  }) => (
    <select data-testid={`account-${id}`} value={value} onChange={(e) => onValueChange(e.target.value)}>
      <option value="none">Sélectionner un compte</option>
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.code}
        </option>
      ))}
    </select>
  ),
}))

const accounts = [
  { id: 'acc-2183', code: '218300', label: 'Matériel de bureau et informatique' },
  { id: 'acc-28183', code: '281830', label: 'Amortissements du matériel informatique' },
  { id: 'acc-6811', code: '681120', label: 'Dotations aux amortissements des immobilisations corporelles' },
]

/** Intl fr-FR puts narrow no-break spaces in amounts: compare on plain spaces. */
const norm = (s: string | null | undefined) => (s ?? '').replace(/[  ]/g, ' ')

type Props = React.ComponentProps<typeof FixedAssetFormDialog>

function renderForm(props: Partial<Props> = {}) {
  const onSubmit = vi.fn<(data: FixedAssetFormData) => void>()
  const onCancel = vi.fn()
  render(
    <FixedAssetFormDialog
      open
      onOpenChange={vi.fn()}
      editingAsset={null}
      accounts={accounts}
      submitting={false}
      error={null}
      onSubmit={onSubmit}
      onCancel={onCancel}
      {...props}
    />
  )
  return { onSubmit, onCancel, user: userEvent.setup() }
}

function setDate(id: string, iso: string) {
  fireEvent.change(screen.getByTestId(`date-${id}`), { target: { value: iso } })
}

async function chooseMethod(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole('combobox', { name: "Type d'amortissement *" }))
  await user.click(await screen.findByRole('option', { name: label }))
}

/** Rows of the table under the heading `title`, as normalised cell texts. */
function tableRows(title: string): string[][] {
  const section = screen.getByRole('heading', { name: title }).closest('div.border-t') as HTMLElement
  return within(section)
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).queryAllByRole('cell').map((c) => norm(c.textContent)))
}

async function fillLinearAsset(user: ReturnType<typeof userEvent.setup>, opts: { value: string; start: string; years: string }) {
  await user.type(screen.getByLabelText('Nom de cette immobilisation *'), 'Mac Studio')
  setDate('acquisitionDate', opts.start)
  await user.type(screen.getByLabelText("Montant d'achat (Hors Taxes) *"), opts.value)
  setDate('depreciationStartDate', opts.start)
  await user.type(screen.getByLabelText("Nombre d'années d'amortissement *"), opts.years)
}

describe('FixedAssetFormDialog', () => {
  it('refuses an empty form with the French validation messages', async () => {
    const { onSubmit, user } = renderForm()

    await user.click(screen.getByRole('button', { name: 'Créer' }))

    expect(await screen.findByText('Le libellé est requis')).toBeInTheDocument()
    expect(screen.getByText("La date d'acquisition est requise")).toBeInTheDocument()
    expect(screen.getByText("La valeur d'acquisition doit être supérieure à 0")).toBeInTheDocument()
    expect(screen.getByText("Le compte d'immobilisation est requis")).toBeInTheDocument()
    expect(screen.getByText("La date de début d'amortissement est requise")).toBeInTheDocument()
    expect(screen.getByText("Le compte d'amortissement est requis")).toBeInTheDocument()
    expect(screen.getByText('Le compte de charge est requis')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('previews a linear plan from the duration and submits the asset in euros with its three accounts', async () => {
    const { onSubmit, user } = renderForm()
    await fillLinearAsset(user, { value: '3600', start: '2024-01-01', years: '3' })

    // Linear rate = 100 / duration (BOFiP BOI-BIC-AMT-20-20-10-10): 3 years gives 33,33 %.
    expect(screen.getByText(/Taux calculé automatiquement/).textContent).toContain('33.33% par an')

    // A start on the first day of the year gives three full years of 1 200 euros.
    expect(norm(screen.getByText(/Amortissement annuel sur/).textContent)).toBe(
      'Amortissement annuel sur 3 exercices (base 3 600,00 €).'
    )
    expect(tableRows('Récapitulatif annuel')).toEqual([
      ['2024', '33,33 %', '33,33 %', '1 200,00 €', '1 200,00 €', '2 400,00 €'],
      ['2025', '33,33 %', '66,67 %', '1 200,00 €', '2 400,00 €', '1 200,00 €'],
      ['2026', '33,33 %', '100 %', '1 200,00 €', '3 600,00 €', '0,00 €'],
      ['Total', '3 600,00 €', '3 600,00 €', '0,00 €'],
    ])

    const monthly = tableRows('Tableau prévisionnel mensuel')
    // 36 months plus three year separators plus the total line.
    expect(monthly).toHaveLength(36 + 3 + 1)
    expect(monthly[0]).toEqual(['Année 2024'])
    expect(monthly[1]).toEqual(['janvier 2024', '100,00 €', '100,00 €'])
    expect(monthly.at(-1)).toEqual(['Total prévisionnel', '3 600,00 €', '3 600,00 €'])

    await user.selectOptions(screen.getByTestId('account-assetAccountId'), 'acc-2183')
    await user.selectOptions(screen.getByTestId('account-depreciationAccountId'), 'acc-28183')
    await user.selectOptions(screen.getByTestId('account-expenseAccountId'), 'acc-6811')
    await user.click(screen.getByRole('switch', { name: 'Cette immobilisation est entièrement payée' }))
    await user.click(screen.getByRole('button', { name: 'Créer' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      label: 'Mac Studio',
      acquisitionDate: '2024-01-01',
      acquisitionValue: 3600,
      depreciationMethod: 'linear',
      depreciationStartDate: '2024-01-01',
      depreciationDuration: 3,
      depreciationRate: 33.33,
      assetAccountId: 'acc-2183',
      depreciationAccountId: 'acc-28183',
      expenseAccountId: 'acc-6811',
      isFullyPaid: true,
      disposalDate: null,
    })
  })

  it('takes the amortizable amount as the base instead of the purchase price', async () => {
    const { user } = renderForm()
    await fillLinearAsset(user, { value: '5000', start: '2025-01-01', years: '2' })
    await user.type(screen.getByLabelText('Montant amortissable'), '4000')

    expect(norm(screen.getByText(/Amortissement annuel sur/).textContent)).toBe(
      'Amortissement annuel sur 2 exercices (base 4 000,00 €).'
    )
    expect(tableRows('Tableau prévisionnel mensuel').at(-1)).toEqual([
      'Total prévisionnel',
      '4 000,00 €',
      '4 000,00 €',
    ])
  })

  it('ends the linear plan on the full base when the first month is a prorata', async () => {
    const { user } = renderForm()
    // In service on 16 July: PCG art. 214-13 starts depreciation on that day,
    // so July carries 16/31 of a month and the remainder falls in the month
    // after the last full year (July 2025), as the server plan does
    // (lib/fixed-assets/depreciation-plan.ts).
    await fillLinearAsset(user, { value: '1200', start: '2024-07-16', years: '1' })

    const monthly = tableRows('Tableau prévisionnel mensuel')
    expect(monthly[1]).toEqual(['juillet 2024', '51,61 €', '51,61 €'])
    expect(monthly.at(-2)).toEqual(['juillet 2025', '48,39 €', '1 200,00 €'])
    expect(monthly.at(-1)).toEqual(['Total prévisionnel', '1 200,00 €', '1 200,00 €'])
    expect(tableRows('Récapitulatif annuel').map((r) => r.slice(0, 1).concat(r.slice(3, 4)))).toEqual([
      ['2024', '551,61 €'],
      ['2025', '648,39 €'],
      ['Total', '0,00 €'],
    ])
  })

  it('shows the declining schedule with the switch to linear once it gives more', async () => {
    const { user } = renderForm()
    await chooseMethod(user, 'Dégressif')
    await user.type(screen.getByLabelText('Nom de cette immobilisation *'), 'Presse')
    setDate('acquisitionDate', '2024-01-01')
    await user.type(screen.getByLabelText("Montant d'achat (Hors Taxes) *"), '10000')
    setDate('depreciationStartDate', '2024-01-01')
    await user.type(screen.getByLabelText("Nombre d'années d'amortissement"), '5')
    await user.type(screen.getByLabelText('Coefficient dégressif'), '1.75')

    // CGI art. 39 A and BOFiP BOI-BIC-AMT-20-20-20-20: declining rate =
    // linear rate x coefficient (20 % x 1,75 = 35 %) applied to the net book
    // value, switching to linear over the remaining years when the linear
    // allowance becomes higher (year 4: 2 746,25 / 2 > 2 746,25 x 35 %).
    expect(tableRows('Taux annuels dégressifs')).toEqual([
      ['2024', '10 000,00 €', '35 %', '35 %', 'Dégressif', '3 500,00 €', '3 500,00 €', '6 500,00 €'],
      ['2025', '6 500,00 €', '35 %', '57,75 %', 'Dégressif', '2 275,00 €', '5 775,00 €', '4 225,00 €'],
      ['2026', '4 225,00 €', '35 %', '72,54 %', 'Dégressif', '1 478,75 €', '7 253,75 €', '2 746,25 €'],
      ['2027', '2 746,25 €', '50 %', '86,27 %', 'Linéaire (bascule)', '1 373,13 €', '8 626,88 €', '1 373,13 €'],
      ['2028', '1 373,13 €', '100 %', '100 %', 'Linéaire (bascule)', '1 373,13 €', '10 000,00 €', '0,00 €'],
      ['Total', '10 000,00 €', '10 000,00 €', '0,00 €'],
    ])
  })

  it('shows the declining coefficient as a plain number, not an amount', async () => {
    const { user } = renderForm()
    await chooseMethod(user, 'Dégressif')
    const coefficient = screen.getByLabelText('Coefficient dégressif')
    expect(coefficient.parentElement?.textContent).not.toContain('€')
  })

  it('submits a non depreciable asset with only its asset account', async () => {
    const { onSubmit, user } = renderForm()
    await chooseMethod(user, 'Non amortissable')

    expect(screen.queryByLabelText('Montant amortissable')).not.toBeInTheDocument()
    expect(screen.queryByTestId('account-depreciationAccountId')).not.toBeInTheDocument()
    expect(screen.queryByText('Tableau prévisionnel mensuel')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Nom de cette immobilisation *'), 'Terrain')
    setDate('acquisitionDate', '2024-03-15')
    await user.type(screen.getByLabelText("Montant d'achat (Hors Taxes) *"), '80000.50')
    await user.selectOptions(screen.getByTestId('account-assetAccountId'), 'acc-2183')
    await user.click(screen.getByRole('button', { name: 'Créer' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      label: 'Terrain',
      acquisitionDate: '2024-03-15',
      acquisitionValue: 80000.5,
      depreciationMethod: 'none',
      assetAccountId: 'acc-2183',
      depreciationAccountId: '',
      expenseAccountId: '',
    })
  })

  it('clears the disposal date with its button', async () => {
    renderForm()
    setDate('disposalDate', '2025-06-30')
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer la date de cession' }))
    expect(screen.getByTestId('date-disposalDate')).toHaveValue('')
    expect(screen.queryByTitle('Supprimer la date de cession')).not.toBeInTheDocument()
  })

  it('shows the total borrowing costs to capitalize (PCG art. 213-9)', async () => {
    const { user } = renderForm()
    await user.click(
      screen.getByRole('switch', { name: 'Actif nécessitant une longue période de préparation/construction' })
    )
    await user.click(screen.getByRole('combobox', { name: 'Méthode de traitement' }))
    await user.click(await screen.findByRole('option', { name: "Capitaliser dans le coût de l'actif" }))

    const direct = screen.getByLabelText('Coûts directement attribuables (€)')
    await user.clear(direct)
    await user.type(direct, '1500')
    const general = screen.getByLabelText("Coûts d'emprunt généraux (€)")
    await user.clear(general)
    await user.type(general, '250')

    expect(screen.getByLabelText('Taux de capitalisation (%)')).toBeInTheDocument()
    expect(norm(screen.getByText(/Coûts d'emprunt totaux/).textContent)).toContain("Coûts d'emprunt totaux : 1750 €")
    expect(screen.getByText("Ces coûts seront inclus dans la valeur d'acquisition de l'actif.")).toBeInTheDocument()
  })

  it('prefills an asset being edited and submits its values as numbers and calendar days', async () => {
    const { onSubmit, user } = renderForm({
      editingAsset: {
        id: 'fa-1',
        label: 'Serveur',
        comment: null,
        acquisitionDate: '2023-04-01T00:00:00.000Z',
        acquisitionValue: '2400.00' as unknown as number,
        amortizableAmount: null,
        disposalDate: null,
        depreciationRate: '25.00' as unknown as number,
        depreciationDuration: 4,
        depreciationMethod: 'linear',
        decliningCoefficient: null,
        depreciationStartDate: '2023-04-01T00:00:00.000Z',
        assetAccountId: 'acc-2183',
        depreciationAccountId: 'acc-28183',
        expenseAccountId: 'acc-6811',
        isFullyPaid: true,
      },
    })

    expect(screen.getByRole('heading', { name: "Modifier l'immobilisation" })).toBeInTheDocument()
    expect(screen.getByLabelText('Nom de cette immobilisation *')).toHaveValue('Serveur')
    expect(screen.getByTestId('date-acquisitionDate')).toHaveValue('2023-04-01')
    // 2 400 over 4 years from 1 April 2023: 9 months in 2023 = 450 euros.
    expect(tableRows('Récapitulatif annuel')[0]).toEqual(['2023', '18,75 %', '18,75 %', '450,00 €', '450,00 €', '1 950,00 €'])

    await user.click(screen.getByRole('button', { name: 'Modifier' }))
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      acquisitionDate: '2023-04-01',
      depreciationStartDate: '2023-04-01',
      acquisitionValue: 2400,
      depreciationRate: 25,
      depreciationDuration: 4,
    })
  })

  it('shows the server error and locks the buttons while submitting', async () => {
    const { onCancel, user } = renderForm({ error: 'Exercice clôturé', submitting: true })
    expect(screen.getByText('Exercice clôturé')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enregistrement...' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('calls onCancel from the cancel button', async () => {
    const { onCancel, user } = renderForm()
    await user.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
