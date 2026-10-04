import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import type { OnboardingStep } from '@/lib/onboarding/checklist'
import { GettingStartedCard } from '../getting-started-card'
import type { CompanyOnboardingView } from '../use-company-onboarding'

const steps: OnboardingStep[] = [
  { id: 'chart', title: 'Plan comptable', why: 'Base des écritures', done: true, detail: '412 comptes', action: { label: 'Voir', href: '/c1/accounts' } },
  { id: 'bank', title: 'Connecter la banque', why: 'Les opérations arrivent seules', done: false, detail: null, action: null },
  { id: 'history', title: 'Reprendre l’historique', why: 'Pour partir des bons soldes', done: false, detail: null, action: { label: 'Importer un FEC', href: '/c1/import' } },
  { id: 'rule', title: 'Créer une règle', why: 'Pour comptabiliser sans saisie', done: false, detail: '3 libellés récurrents', action: { label: 'Créer la règle', href: '/c1/rules' } },
]

function data(overrides: Partial<CompanyOnboardingView> = {}): CompanyOnboardingView {
  return {
    enabled: true,
    dismissed: false,
    canManage: true,
    steps,
    done: 1,
    total: 3,
    complete: false,
    counts: { entries: 0, bankTransactions: 0 },
    ...overrides,
  }
}

afterEach(() => vi.clearAllMocks())

/**
 * The bar fill, as the shadcn Progress draws it. The Progress wrapper does not
 * forward `value` to Radix, so the bar has no aria-valuenow to read.
 */
function indicatorShift(): string {
  const indicator = document.querySelector<HTMLElement>('[data-slot="progress-indicator"]')
  return indicator?.style.transform ?? ''
}

describe('GettingStartedCard', () => {
  it('shows progress, each step state, and one link per undone step with an action', () => {
    render(<GettingStartedCard data={data()} onDismiss={vi.fn()} />)
    expect(screen.getByRole('heading', { level: 2, name: 'Démarrer' })).toBeInTheDocument()
    // 1 of 3 steps: 33 percent, rounded.
    expect(screen.getByRole('progressbar', { name: '1 étapes faites sur 3' })).toBeInTheDocument()
    expect(indicatorShift()).toBe('translateX(-67%)')

    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Plan comptable (fait)')
    expect(within(items[0]).queryByText('Base des écritures')).not.toBeInTheDocument()
    expect(within(items[0]).getByText('412 comptes')).toBeInTheDocument()
    expect(within(items[0]).queryByRole('link')).not.toBeInTheDocument()

    expect(items[1]).toHaveTextContent('Connecter la banque (à faire)')
    expect(within(items[1]).getByText('Les opérations arrivent seules')).toBeInTheDocument()
    expect(within(items[1]).queryByRole('link')).not.toBeInTheDocument()

    expect(within(items[2]).getByRole('link', { name: 'Importer un FEC' })).toHaveAttribute('href', '/c1/import')
    expect(within(items[3]).getByRole('link', { name: 'Créer la règle' })).toHaveAttribute('href', '/c1/rules')
    // Only the next step (first undone with an action) carries the arrow.
    expect(within(items[2]).getByRole('link').querySelector('svg')).not.toBeNull()
    expect(within(items[3]).getByRole('link').querySelector('svg')).toBeNull()
  })

  it('says everything is ready once complete, and shows 0 percent without steps', () => {
    const { rerender } = render(
      <GettingStartedCard data={data({ complete: true, done: 3, total: 3 })} onDismiss={vi.fn()} />,
    )
    expect(screen.getByRole('heading', { name: 'Tout est prêt' })).toBeInTheDocument()
    expect(screen.getByText(/Votre société est prête/)).toBeInTheDocument()
    expect(indicatorShift()).toBe('translateX(-0%)')

    rerender(<GettingStartedCard data={data({ steps: [], done: 0, total: 0 })} onDismiss={vi.fn()} />)
    expect(indicatorShift()).toBe('translateX(-100%)')
  })

  it('confirms when the guide is hidden', async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn().mockResolvedValue(true)
    render(<GettingStartedCard data={data()} onDismiss={onDismiss} />)
    await user.click(screen.getByRole('button', { name: 'Masquer le guide Démarrer' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        'Guide masqué. Retrouvez-le dans le menu Aide ou avec le bouton Démarrer du tableau de bord.',
      ),
    )
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('reports a failure to hide', async () => {
    const user = userEvent.setup()
    render(<GettingStartedCard data={data()} onDismiss={vi.fn().mockResolvedValue(false)} />)
    await user.click(screen.getByRole('button', { name: 'Masquer le guide Démarrer' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Le guide n'a pas pu être masqué. Réessayez."))
    expect(toast.success).not.toHaveBeenCalled()
  })
})
