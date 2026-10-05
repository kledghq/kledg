/**
 * The flows card of the Tiers page (tiers-flows-card.tsx) with its API
 * answer mocked: the diagram as an image with a label, the legend with the
 * customer and supplier colours, every figure in "Lire les flux en texte",
 * the empty state of a year with nothing billed, and the French error.
 */

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))

import { TiersFlowsCard } from '../tiers-flows-card'
import { buildTiersFlows, type FlowEntry } from '@/lib/reports/third-parties/tiers-flows'
import type { TiersFlowsReport } from '@/lib/reports/third-parties/get-third-party-reports.service'

const plain = (s: string | null | undefined) => (s ?? '').replace(/[  ]/g, ' ')

const sale = (aux: string, name: string, cents: number): FlowEntry => ({
  opening: false,
  lines: [
    { accountCode: '411000', debitCents: cents, creditCents: 0, auxiliaryAccountNumber: aux, auxiliaryAccountLabel: name },
    { accountCode: '706000', debitCents: 0, creditCents: cents, auxiliaryAccountNumber: null, auxiliaryAccountLabel: null },
  ],
})
const purchase = (aux: string, name: string, cents: number): FlowEntry => ({
  opening: false,
  lines: [
    { accountCode: '606100', debitCents: cents, creditCents: 0, auxiliaryAccountNumber: null, auxiliaryAccountLabel: null },
    { accountCode: '401000', debitCents: 0, creditCents: cents, auxiliaryAccountNumber: aux, auxiliaryAccountLabel: name },
  ],
})

const fiscalYear = { id: 'fy-2026', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', isClosed: false }
const report = (entries: FlowEntry[]): TiersFlowsReport => ({ fiscalYear, company: { name: 'Atelier Lumen' }, ...buildTiersFlows(entries) })

const fetchMock = vi.fn<typeof fetch>()
let answer: () => Response

beforeEach(() => {
  answer = () => Response.json(report([sale('C001', 'Martin SA', 300_000), sale('C002', 'Durand', 100_000), purchase('F001', 'Papeterie Centrale', 50_000)]))
  fetchMock.mockImplementation(async (input) => {
    const url = String(input)
    if (url.startsWith('/api/companies/atelier/fiscal-years')) return Response.json([fiscalYear])
    if (url.startsWith('/api/reports/tiers-flows')) return answer()
    return Response.json({ error: 'Introuvable' }, { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

describe('TiersFlowsCard', () => {
  it('draws the flows of the year with a legend and gives every figure as text', async () => {
    render(<TiersFlowsCard companyId="atelier" />)
    const chart = await screen.findByRole('img', { name: /Diagramme des flux de l'exercice 2026/ })
    expect(plain(chart.getAttribute('aria-label'))).toContain('4 000,00 € facturés à 2 clients, 500,00 € facturés par 1 fournisseur')
    expect(screen.getByRole('heading', { name: "Clients et fournisseurs de l'exercice" })).toBeInTheDocument()

    const legend = screen.getByRole('list', { name: 'Légende des flux avec les tiers' })
    const items = within(legend).getAllByRole('listitem')
    expect(items.map((i) => i.textContent)).toEqual(['Clients', 'Fournisseurs'])
    expect(items[0].querySelector('span')?.getAttribute('style')).toContain('--chart-flow-customer')
    expect(items[1].querySelector('span')?.getAttribute('style')).toContain('--chart-flow-supplier')

    await userEvent.click(screen.getByText('Lire les flux en texte'))
    const martin = screen.getByRole('row', { name: /Martin SA/ })
    expect(plain(martin.textContent)).toContain('3 000,00 €')
    expect(plain(martin.textContent)).toContain('75 %')
    expect(plain(screen.getByRole('row', { name: /Durand/ }).textContent)).toContain('25 %')
    expect(plain(screen.getByRole('row', { name: /Papeterie Centrale/ }).textContent)).toContain('500,00 €')
    expect(screen.getAllByRole('row', { name: /^Total/ }).map((r) => plain(r.textContent))).toEqual(['Total4 000,00 €100 %', 'Total500,00 €100 %'])
    expect(fetchMock).toHaveBeenCalledWith('/api/reports/tiers-flows?companyId=atelier')
  })

  it('says so when nothing was billed over the year', async () => {
    answer = () => Response.json(report([]))
    render(<TiersFlowsCard companyId="atelier" />)
    expect(await screen.findByText('Rien de facturé sur cet exercice')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByText('Lire les flux en texte')).not.toBeInTheDocument()
  })

  it('shows the French error of the API with a retry', async () => {
    answer = () => Response.json({ error: "Aucun exercice pour cette société : créez d'abord un exercice." }, { status: 400 })
    render(<TiersFlowsCard companyId="atelier" />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/Aucun exercice pour cette société/)
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument()
  })
})
