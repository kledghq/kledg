import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { ReceiptDropZone } from '../receipt-drop-zone'

const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const receipt = (over: Record<string, unknown> = {}) => ({
  id: 'sr_1',
  status: 'staged',
  fileName: '2026-10-03 Carrefour 23,45.jpg',
  contentType: 'image/jpeg',
  size: 12,
  sha256: 'a'.repeat(64),
  source: 'app',
  stagedAt: '2026-10-08T10:00:00.000Z',
  expiresAt: '2026-11-07T10:00:00.000Z',
  fields: { amountCents: null, currency: null, date: null, merchant: null, vatLines: [], paymentHint: null },
  bankTransactionId: null,
  expenseReportId: null,
  hasFile: true,
  ...over,
})

const candidate = (id: string, sendsToBank: boolean) => ({
  transactionId: id,
  date: '2026-10-04',
  label: `CB CARREFOUR ${id}`,
  counterpartyName: null,
  amountCents: 2_345,
  bankAccountName: sendsToBank ? 'Qonto' : 'Banque Populaire',
  bankProvider: sendsToBank ? 'QONTO' : 'MANUAL',
  sendsToBank,
  score: 0.8,
  reasons: ['Montant identique'],
})

let matchAnswer: unknown
let stageAnswer: unknown
let fetchMock: ReturnType<typeof vi.fn>
const calls = () => fetchMock.mock.calls.map(([input, init]) => ({ url: String(input), method: (init as RequestInit | undefined)?.method ?? 'GET', body: (init as RequestInit | undefined)?.body }))

beforeEach(() => {
  stageAnswer = { receipt: receipt(), duplicate: false, guess: { date: '2026-10-03', amountCents: 2_345, merchant: 'Carrefour' } }
  matchAnswer = { receipt: receipt(), outcome: 'candidates', match: null, candidates: [candidate('t1', false), candidate('t2', true)], reason: null, expenseProposal: null }
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname === '/api/receipts/staged' && (init?.method ?? 'GET') === 'GET') return respond({ receipts: [] })
    if (url.pathname === '/api/receipts/staged') return respond(stageAnswer, 201)
    if (url.pathname.endsWith('/match')) return respond(matchAnswer)
    if (url.pathname.endsWith('/attach')) return respond({ destination: 'kledg', receipts: 1 })
    if (url.pathname.endsWith('/expense')) return respond({ reportId: 'er_9', number: 'NDF-0009', created: true, alreadyDone: false, totalOwedCents: 2_345, lines: 1 }, 201)
    return respond({})
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function dropOne() {
  render(<ReceiptDropZone companyId="c1" canAttach onAttached={onAttached} />)
  const input = screen.getByLabelText('Choisir des justificatifs') as HTMLInputElement
  expect(input).toHaveAttribute('accept', 'image/*,application/pdf')
  expect(input).toHaveAttribute('multiple')
  expect(screen.getByLabelText('Prendre une photo du justificatif')).toHaveAttribute('capture', 'environment')
  fireEvent.change(input, { target: { files: [new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], '2026-10-03 Carrefour 23,45.jpg', { type: 'image/jpeg' })] } })
  await screen.findByRole('button', { name: 'Rechercher la transaction' })
}

const onAttached = vi.fn()

describe('ReceiptDropZone', () => {
  it('stages a dropped photo and prefills the form from its file name', async () => {
    await dropOne()
    const upload = calls().find((c) => c.method === 'POST' && c.url === '/api/receipts/staged')!
    expect(upload.body).toBeInstanceOf(FormData)
    expect((upload.body as FormData).get('companyId')).toBe('c1')
    expect(((upload.body as FormData).get('file') as File).name).toBe('2026-10-03 Carrefour 23,45.jpg')
    expect(screen.getByLabelText('Montant TTC')).toHaveValue('23,45')
    expect(screen.getByLabelText('Date')).toHaveValue('03/10/2026')
    expect(screen.getByLabelText(/Commerçant/)).toHaveValue('Carrefour')
  })

  it('finds the candidates and attaches to the chosen one; a Qonto one asks a confirmation first', async () => {
    await dropOne()
    fireEvent.click(screen.getByRole('button', { name: 'Rechercher la transaction' }))
    await screen.findByText(/Plusieurs transactions peuvent correspondre/)
    const match = calls().find((c) => c.url.endsWith('/match'))!
    expect(JSON.parse(String(match.body))).toEqual({ fields: { amountCents: 2_345, date: '2026-10-03', merchant: 'Carrefour' } })

    // Qonto: a confirmation, nothing sent before it
    const rows = screen.getAllByRole('button', { name: 'Rattacher' })
    fireEvent.click(rows[1])
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/^Envoyer le justificatif à Qonto\s\?$/)).toBeInTheDocument()
    expect(calls().some((c) => c.url.endsWith('/attach'))).toBe(false)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Annuler' }))

    // Another bank: attached at once
    fireEvent.click(screen.getAllByRole('button', { name: 'Rattacher' })[0])
    await screen.findByText(/Rattaché et conservé par Kledg/)
    const attach = calls().find((c) => c.url.endsWith('/attach'))!
    expect(attach.url).toBe('/api/receipts/staged/sr_1/attach')
    expect(JSON.parse(String(attach.body))).toEqual({ transactionId: 't1' })
    expect(onAttached).toHaveBeenCalled()
  })

  it('proposes an expense report when no transaction matches, and links to it', async () => {
    matchAnswer = {
      receipt: receipt(),
      outcome: 'none',
      match: null,
      candidates: [],
      reason: 'no_candidate',
      expenseProposal: { date: '2026-10-03', merchant: 'Carrefour', amountCents: 2_345, currency: 'EUR', vatLines: [], category: 'OTHER', categoryLabel: 'Autre dépense', accountCode: '6257', openDraft: null, needsEuroAmount: false },
    }
    await dropOne()
    fireEvent.click(screen.getByRole('button', { name: 'Rechercher la transaction' }))
    await screen.findByText(/Est-ce une note de frais\s\?/)
    fireEvent.click(screen.getByRole('button', { name: 'Créer une note de frais' }))
    const link = await screen.findByRole('link', { name: 'vérifiez-la et soumettez-la' })
    expect(link).toHaveAttribute('href', '/c1/expense-reports/er_9')
    expect(calls().find((c) => c.url.endsWith('/expense'))?.url).toBe('/api/receipts/staged/sr_1/expense')
  })

  it('asks for the amount and the date before searching, and hides Rattacher without the right to reconcile', async () => {
    stageAnswer = { receipt: receipt({ fileName: 'IMG_0001.jpg' }), duplicate: false, guess: { date: null, amountCents: null, merchant: null } }
    render(<ReceiptDropZone companyId="c1" canAttach={false} />)
    fireEvent.change(screen.getByLabelText('Choisir des justificatifs'), { target: { files: [new File([new Uint8Array([1])], 'IMG_0001.jpg', { type: 'image/jpeg' })] } })
    fireEvent.click(await screen.findByRole('button', { name: 'Rechercher la transaction' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Indiquez le montant TTC et la date')
    expect(calls().some((c) => c.url.endsWith('/match'))).toBe(false)
    fireEvent.change(screen.getByLabelText('Montant TTC'), { target: { value: '23,45' } })
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '03/10/2026' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rechercher la transaction' }))
    await screen.findByText(/Plusieurs transactions peuvent correspondre/)
    expect(screen.queryByRole('button', { name: 'Rattacher' })).toBeNull()
    expect(screen.getByText('Le rattachement est réservé aux membres qui rapprochent la banque.')).toBeInTheDocument()
  })
})
