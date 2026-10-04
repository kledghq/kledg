import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getWidget, type WidgetDefinition } from '@/lib/dashboard/widgets'
import type { DeadlinesWidgetData } from '@/lib/deadlines/load-deadlines.service'
import type { Deadline } from '@/lib/deadlines/types'
import { DashboardDataProvider } from '../dashboard-data'
import { EcheancesList } from '../widgets/deadline-widget'

const onboarding = { data: null, loading: false, reload: vi.fn(), setDismissed: vi.fn(), nextStep: null }
const widget = getWidget('list-echeances') as WidgetDefinition

const deadline = (over: Partial<Deadline>): Deadline => ({
  id: 'x',
  date: '2026-10-20',
  legalDate: '2026-10-20',
  label: 'Déclaration et paiement de la TVA de septembre 2026',
  form: 'CA3',
  category: 'tva',
  ruleId: 'tva-ca3',
  estimated: false,
  projected: false,
  ...over,
})

const DATA: DeadlinesWidgetData = {
  today: '2026-10-04',
  horizonDays: 60,
  overdueDays: 15,
  missingRegimes: false,
  deadlines: [
    deadline({ id: 'late', date: '2026-10-01', legalDate: '2026-10-01', label: "Solde de l'IS de l'exercice clos le 30/06/2026", form: '2572', category: 'is', ruleId: 'is-solde' }),
    deadline({ id: 'today', date: '2026-10-04', legalDate: '2026-10-04', label: 'Acompte de CFE 2026', form: 'CFE', category: 'cfe', ruleId: 'cfe-acompte' }),
    deadline({ id: 'soon', date: '2026-10-09', estimated: true }),
    deadline({ id: 'later', date: '2026-11-30', legalDate: '2026-11-30', label: "Déclaration de résultat et liasse fiscale de l'exercice clos le 31/08/2026", form: '2065 et 2033', category: 'liasse', ruleId: 'liasse' }),
  ],
}

function respond(body: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })))
}

function renderWidget(size: 'S' | 'M' | 'L' = 'M') {
  return render(
    <DashboardDataProvider companyId="atelier" fiscalYearId="fy-1" onboarding={onboarding}>
      <EcheancesList widget={widget} size={size} editing={false} />
    </DashboardDataProvider>,
  )
}

describe('Échéances widget', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows a skeleton while the deadlines source loads, from one request', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    renderWidget()
    expect(screen.getByRole('heading', { level: 2, name: 'Échéances' })).toBeInTheDocument()
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
    const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url))
    expect(urls).toEqual(['/api/dashboard/widgets?companyId=atelier&source=deadlines&fiscalYearId=fy-1'])
  })

  it('lists the coming deadlines with their date, a relative label, the form and the category', async () => {
    respond(DATA)
    renderWidget()
    const list = await screen.findByRole('list', { name: 'Prochaines échéances' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(4)
    expect(rows[0]).toHaveTextContent('01/10/2026')
    expect(rows[0]).toHaveTextContent('en retard de 3 jours')
    expect(rows[0]).toHaveTextContent('2572')
    expect(rows[0]).toHaveTextContent('IS')
    expect(rows[1]).toHaveTextContent("aujourd'hui")
    expect(rows[2]).toHaveTextContent('dans 5 jours')
    expect(rows[2]).toHaveTextContent('indicative')
    expect(rows[3]).toHaveTextContent('Liasse')
    expect(within(rows[0]).getByText('en retard de 3 jours').closest('[data-tone]')).toHaveAttribute('data-tone', 'danger')
    expect(within(rows[3]).getByText('dans 57 jours').closest('[data-tone]')).toHaveAttribute('data-tone', 'neutral')
    expect(screen.getByRole('link', { name: /Toutes les échéances/ })).toHaveAttribute('href', '/atelier/echeances')
    expect(screen.getByText(/espace professionnel sur impots\.gouv\.fr fait foi/)).toBeInTheDocument()
  })

  it('keeps the next three in a small widget', async () => {
    respond(DATA)
    renderWidget('S')
    const list = await screen.findByRole('list', { name: 'Prochaines échéances' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
  })

  it('says when nothing is due, and asks for the regimes when they are missing', async () => {
    respond({ ...DATA, deadlines: [], missingRegimes: true })
    renderWidget()
    expect(await screen.findByText('Aucune échéance dans les 60 prochains jours')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Compléter les informations/ })).toHaveAttribute('href', '/atelier/informations#echeances')
  })

  it('shows the error and retries', async () => {
    respond({ error: 'Action non autorisée' }, 403)
    renderWidget()
    expect(await screen.findByRole('alert')).toHaveTextContent('Action non autorisée')
    respond(DATA)
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
    await waitFor(() => expect(screen.getByRole('list', { name: 'Prochaines échéances' })).toBeInTheDocument())
  })
})
