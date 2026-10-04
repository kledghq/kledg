/**
 * Nested layout editors of the bilan and the compte de résultat: lines are
 * split by section, editing a label and the account codes of a line changes
 * the tree handed to onSave, the delete button names its line, and adding a
 * line at the root of a section posts that section with the sense of its
 * side (debit for the actif and the charges, credit for the passif and the
 * produits) after the last order.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast: toasts }))

import { BalanceSheetNestedConfigEditor } from '../balance-sheet-nested-config-editor'
import { IncomeStatementNestedConfigEditor } from '../income-statement-nested-config-editor'
import type { BalanceSheetLineConfig } from '@/lib/reports/balance-sheet/types'
import type { IncomeStatementLineConfig } from '@/lib/reports/income-statement/types'

const fetchMock = vi.fn<typeof fetch>()
const stamp = new Date('2026-01-01T00:00:00.000Z')

function bsLine(id: string, overrides: Partial<BalanceSheetLineConfig>): BalanceSheetLineConfig {
  return {
    id,
    companyId: 'atelier',
    reportVariant: 'simplified',
    parentId: null,
    section: null,
    lineLabel: id,
    lineType: 'line',
    formCode: null,
    accountCodes: [],
    excludedAccountCodes: [],
    amortissementAccountCodes: [],
    filterType: 'starts_with',
    balanceType: 'debit',
    displayType: 'net',
    hideLabel: false,
    order: 1,
    version: 1,
    isActive: true,
    createdAt: stamp,
    updatedAt: stamp,
    children: [],
    ...overrides,
  }
}

function isLine(id: string, overrides: Partial<IncomeStatementLineConfig>): IncomeStatementLineConfig {
  return {
    id,
    companyId: 'atelier',
    reportVariant: 'simplified',
    parentId: null,
    section: null,
    lineLabel: id,
    formCode: null,
    accountCodes: [],
    excludedAccountCodes: [],
    filterType: 'starts_with',
    balanceType: 'credit',
    hideLabel: false,
    order: 1,
    version: 1,
    isActive: true,
    createdAt: stamp,
    updatedAt: stamp,
    children: [],
    ...overrides,
  }
}

/** The card of one line (its own controls, without its children). */
const lineCard = (id: string) => {
  const item = document.querySelector<HTMLElement>(`[data-sortable-id="${id}"]`)
  if (!item?.firstElementChild) throw new Error(`No line ${id}`)
  return within(item.firstElementChild as HTMLElement)
}

const sentBody = () => JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<string, unknown>

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  // The editors reload the page after adding a line; jsdom does not navigate.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('BalanceSheetNestedConfigEditor', () => {
  // 2033-A: 084 Disponibilités on the actif, 142 Capitaux propres > 120 Capital on the passif.
  const configs = [
    bsLine('cash', { section: 'actif', lineLabel: 'Disponibilités', formCode: '084', accountCodes: ['51'], order: 3 }),
    bsLine('equity', {
      section: 'passif',
      lineLabel: 'Capitaux propres',
      formCode: '142',
      lineType: 'sum',
      balanceType: 'auto',
      order: 5,
      children: [bsLine('capital', { parentId: 'equity', lineLabel: 'Capital social', formCode: '120', accountCodes: ['101'], balanceType: 'credit' })],
    }),
  ]

  function renderEditor() {
    const onSave = vi.fn<(configs: BalanceSheetLineConfig[]) => Promise<void>>().mockResolvedValue()
    const onDelete = vi.fn<(id: string) => Promise<void>>().mockResolvedValue()
    render(<BalanceSheetNestedConfigEditor configs={configs} companyId="atelier" reportVariant="simplified" onSave={onSave} onDelete={onDelete} />)
    return { onSave, onDelete }
  }

  it('saves the tree with the edited label and account codes of a nested line', async () => {
    const user = userEvent.setup()
    const { onSave } = renderEditor()
    expect(screen.getByRole('heading', { name: 'Actif' })).toBeInTheDocument()

    const capital = lineCard('capital')
    const label = capital.getByDisplayValue('Capital social')
    await user.clear(label)
    await user.type(label, 'Capital individuel')
    // Regression: the line was remounted on each keystroke, the input lost its focus after one character.
    expect(label).toHaveValue('Capital individuel')
    await user.click(capital.getByRole('button', { name: 'Ouvrir les réglages de la ligne' }))
    await user.type(capital.getAllByPlaceholderText('Ajouter un code...')[0], '108{Enter}')
    await user.click(capital.getByRole('button', { name: 'Retirer 101' }))
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))

    expect(onSave).toHaveBeenCalledTimes(1)
    const [saved] = onSave.mock.calls[0]
    expect(saved.map((c) => c.id)).toEqual(['cash', 'equity'])
    expect(saved[1].children?.[0]).toMatchObject({ id: 'capital', lineLabel: 'Capital individuel', accountCodes: ['108'], formCode: '120' })
    expect(saved[0]).toMatchObject({ lineLabel: 'Disponibilités', accountCodes: ['51'] })
  })

  it('deletes the line whose button is clicked', async () => {
    const { onDelete } = renderEditor()
    await userEvent.click(lineCard('cash').getByRole('button', { name: 'Supprimer la ligne' }))
    expect(onDelete).toHaveBeenCalledWith('cash')
  })

  it('adds a credit line at the root of the passif after the last order', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'new' }), { status: 201 }))
    renderEditor()
    const passif = screen.getByRole('heading', { name: 'Passif' }).parentElement as HTMLElement
    await userEvent.click(within(passif).getByRole('button', { name: 'Ligne' }))
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith('Ligne ajoutée avec succès'))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/companies/atelier/balance-sheet/config/line')
    expect(sentBody()).toMatchObject({ reportVariant: 'simplified', parentId: null, section: 'passif', lineType: 'line', balanceType: 'credit', order: 6, lineLabel: 'Nouvelle ligne' })
  })

  it('adds a sum under a group with the section of its parent, and shows the refusal of the server', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Ligne parente introuvable' }), { status: 404 }))
    renderEditor()
    await userEvent.click(lineCard('equity').getByRole('button', { name: 'Ajouter une somme' }))
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('Ligne parente introuvable'))
    // Under "Capitaux propres" (one child of order 1): order 2, section passif.
    expect(sentBody()).toMatchObject({ parentId: 'equity', section: 'passif', lineType: 'sum', balanceType: 'auto', order: 2 })
  })
})

describe('IncomeStatementNestedConfigEditor', () => {
  // 2033-B: 232 Total des produits d'exploitation > 209 chiffre d'affaires; 264 charges d'exploitation.
  const configs = [
    isLine('products', {
      section: 'produits',
      lineLabel: "Total des produits d'exploitation",
      formCode: '232',
      balanceType: 'auto',
      order: 1,
      children: [isLine('sales', { parentId: 'products', lineLabel: "Chiffre d'affaires", formCode: '209', accountCodes: ['70'], order: 1 })],
    }),
    isLine('expenses', { section: 'charges', lineLabel: "Total des charges d'exploitation", formCode: '264', balanceType: 'auto', order: 4 }),
  ]

  function renderEditor() {
    const onSave = vi.fn<(configs: IncomeStatementLineConfig[]) => Promise<void>>().mockResolvedValue()
    const onDelete = vi.fn<(id: string) => Promise<void>>().mockResolvedValue()
    render(<IncomeStatementNestedConfigEditor configs={configs} companyId="atelier" reportVariant="simplified" onSave={onSave} onDelete={onDelete} />)
    return { onSave, onDelete }
  }

  it('saves the tree with the edited label and account codes of a line', async () => {
    const user = userEvent.setup()
    const { onSave } = renderEditor()
    const sales = lineCard('sales')
    await user.type(sales.getByDisplayValue("Chiffre d'affaires"), ' net')
    await user.click(sales.getByRole('button', { name: 'Ouvrir les réglages de la ligne' }))
    await user.type(sales.getAllByPlaceholderText('Ajouter un code...')[1], '709{Enter}')
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
    const [saved] = onSave.mock.calls[0]
    // 709 (rabais, remises et ristournes accordés) excluded from the line.
    expect(saved[0].children?.[0]).toMatchObject({ id: 'sales', lineLabel: "Chiffre d'affaires net", accountCodes: ['70'], excludedAccountCodes: ['709'] })
  })

  it('adds a debit line at the root of the charges after the last order', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'new' }), { status: 201 }))
    renderEditor()
    const charges = screen.getByRole('heading', { name: 'Charges' }).parentElement as HTMLElement
    await userEvent.click(within(charges).getByRole('button', { name: 'Ligne' }))
    await waitFor(() => expect(toasts.success).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0][0]).toBe('/api/companies/atelier/income-statement/config/line')
    expect(sentBody()).toMatchObject({ parentId: null, section: 'charges', balanceType: 'debit', order: 5 })
  })
})
