import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { getWidget, type WidgetDefinition } from '@/lib/dashboard/widgets'
import { WidgetCatalogue } from '../widget-catalogue'

const w = (id: string) => getWidget(id) as WidgetDefinition

describe('WidgetCatalogue', () => {
  it('groups the hidden widgets by kind, in a fixed order, with their formats', () => {
    // Given out of order: the catalogue sorts by category (guide, kpi, chart, list).
    const available = [w('list-brouillons'), w('chart-tresorerie'), w('kpi-marge'), w('guide-demarrer')]
    render(<WidgetCatalogue open onOpenChange={vi.fn()} available={available} onAdd={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'Ajouter un widget' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Guide',
      'Indicateurs',
      'Graphiques',
      'Listes',
    ])

    const kpis = within(screen.getByRole('region', { name: 'Indicateurs' }))
    expect(kpis.getByText('Marge commerciale')).toBeInTheDocument()
    expect(kpis.getByText(/Ventes de marchandises moins leur coût d'achat/)).toBeInTheDocument()
    expect(kpis.getByText('Formats : petit, moyen')).toBeInTheDocument()

    expect(within(screen.getByRole('region', { name: 'Guide' })).getByText('Format : large')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Listes' })).getByText('Formats : petit, moyen, large')).toBeInTheDocument()
  })

  it('hides a kind with no widget left', () => {
    render(<WidgetCatalogue open onOpenChange={vi.fn()} available={[w('kpi-tva')]} onAdd={vi.fn()} />)
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Indicateurs'])
  })

  it('adds the chosen widget', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    render(<WidgetCatalogue open onOpenChange={vi.fn()} available={[w('kpi-tva'), w('kpi-marge')]} onAdd={onAdd} />)
    await user.click(screen.getByRole('button', { name: 'Ajouter Marge commerciale' }))
    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(onAdd).toHaveBeenCalledWith(w('kpi-marge'))
  })

  it('says when every widget is already shown', () => {
    render(<WidgetCatalogue open onOpenChange={vi.fn()} available={[]} onAdd={vi.fn()} />)
    expect(screen.getByText('Tous les widgets disponibles sont déjà sur votre tableau de bord.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Ajouter / })).not.toBeInTheDocument()
  })

  it('closes with Escape', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<WidgetCatalogue open onOpenChange={onOpenChange} available={[]} onAdd={vi.fn()} />)
    await user.keyboard('{Escape}')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
