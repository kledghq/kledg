import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LayoutItem } from '@/lib/dashboard/widgets'
import { DashboardDataProvider } from '../dashboard-data'
import { DashboardGrid, EditableDashboardGrid } from '../dashboard-grid'

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }))

const onboarding = { data: null, loading: false, reload: vi.fn(), setDismissed: vi.fn(), nextStep: null }

const ITEMS: LayoutItem[] = [
  { id: 'kpi-chiffre-affaires', size: 'S' },
  { id: 'kpi-resultat', size: 'S' },
  { id: 'chart-produits-charges', size: 'M' },
]

function renderGrid(ui: React.ReactNode) {
  return render(
    <DashboardDataProvider companyId="atelier" fiscalYearId="fy-1" onboarding={onboarding}>
      {ui}
    </DashboardDataProvider>,
  )
}

describe('dashboard grid', () => {
  beforeEach(() => {
    // Widgets stay loading: the grid is what is tested here.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('names every widget with a heading and shows a skeleton while its data loads', () => {
    renderGrid(<DashboardGrid items={ITEMS} />)
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      "Chiffre d'affaires",
      'Résultat',
      'Produits et charges par mois',
    ])
    expect(document.querySelectorAll('[aria-busy="true"]')).toHaveLength(3)
    // One request per source: the two indicators share the ledger source.
    const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url))
    expect(urls.filter((u) => u.includes('source=ledger'))).toHaveLength(1)
    expect(urls.filter((u) => u.includes('source=monthly'))).toHaveLength(1)
  })

  it('sizes widgets on a container grid: S one column, M two, L the whole row', () => {
    renderGrid(<DashboardGrid items={[...ITEMS, { id: 'list-comptes-bancaires', size: 'L' }]} />)
    const cell = (id: string) => document.querySelector(`[data-widget="${id}"]`) as HTMLElement
    expect(cell('kpi-resultat').className).toContain('col-span-1')
    expect(cell('chart-produits-charges').className).toContain('@md/dashboard:col-span-2')
    expect(cell('list-comptes-bancaires').className).toContain('@5xl/dashboard:col-span-4')
  })

  it('reorders with the Monter and Descendre buttons and says what happened', () => {
    const onChange = vi.fn()
    renderGrid(<EditableDashboardGrid items={ITEMS} onChange={onChange} />)
    expect(screen.getByRole('button', { name: "Monter Chiffre d'affaires" })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Descendre Produits et charges par mois' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Descendre Résultat' }))
    const [items, message] = onChange.mock.calls[0]
    expect((items as LayoutItem[]).map((i) => i.id)).toEqual(['kpi-chiffre-affaires', 'chart-produits-charges', 'kpi-resultat'])
    expect(message).toBe('« Résultat » déplacé en position 3 sur 3.')
  })

  it('offers only the sizes a widget supports, and removes a widget', () => {
    const onChange = vi.fn()
    renderGrid(<EditableDashboardGrid items={ITEMS} onChange={onChange} />)
    const sizes = within(screen.getByRole('group', { name: 'Taille de Résultat' }))
    expect(sizes.getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['Petit', 'Moyen'])
    fireEvent.click(sizes.getByRole('radio', { name: 'Moyen' }))
    expect(onChange.mock.calls[0][0][1]).toEqual({ id: 'kpi-resultat', size: 'M' })

    fireEvent.click(screen.getByRole('button', { name: "Retirer Chiffre d'affaires" }))
    expect((onChange.mock.calls[1][0] as LayoutItem[]).map((i) => i.id)).toEqual(['kpi-resultat', 'chart-produits-charges'])
  })

  it('keeps widget contents out of the tab order while editing', () => {
    renderGrid(<EditableDashboardGrid items={ITEMS} onChange={vi.fn()} />)
    for (const content of document.querySelectorAll('li[data-widget] > div[inert]')) {
      expect(content.querySelector('h2')).not.toBeNull()
    }
    expect(document.querySelectorAll('li[data-widget] > div[inert]')).toHaveLength(3)
  })
})
