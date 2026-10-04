/**
 * FEC page: downloads the file of the selected fiscal year under the name the
 * server gives (SirenFECAAAAMMJJ.txt, LPF art. A47 A-1), then shows the
 * compliance report of the same file. fetch is mocked.
 */

import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('next/navigation', () => ({
  useParams: () => ({ companyId: 'c1' }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/c1/reports/fec',
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/features/accounting/fiscal-year-selector', () => ({
  FiscalYearSelector: ({ onValueChange }: { onValueChange: (id: string) => void }) => {
    useEffect(() => onValueChange('fy-2025'), [onValueChange])
    return null
  },
}))

import { toast } from 'sonner'
import FECExportPage from '../page'

let replies: Record<string, Response>
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  replies = {}
  fetchMock = vi.fn(async (input: RequestInfo | URL) => replies[String(input)] ?? new Response('{}', { status: 404 }))
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fec')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

const FILE = '/api/fec?companyId=c1&fiscalYearId=fy-2025'
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('FEC export page', () => {
  it('downloads the file under the server name, then shows a compliant report', async () => {
    replies[FILE] = new Response('JournalCode\tJournalLib\n', {
      headers: { 'content-disposition': "attachment; filename=\"FEC.txt\"; filename*=UTF-8''123456789FEC20251231.txt" },
    })
    replies[`${FILE}&report=1`] = json(200, { fileName: '123456789FEC20251231.txt', entries: 42, lines: 96, valid: true, errors: [], warnings: [] })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const user = userEvent.setup()
    render(<FECExportPage />)
    await user.click(await screen.findByRole('button', { name: /Exporter le FEC/ }))

    await waitFor(() => expect(click).toHaveBeenCalledTimes(1))
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('123456789FEC20251231.txt')
    expect(toast.success).toHaveBeenCalledWith('FEC exporté')
    expect(await screen.findByText('Fichier conforme')).toBeInTheDocument()
    expect(screen.getByText('123456789FEC20251231.txt : 42 écritures, 96 lignes.')).toBeInTheDocument()
  })

  it('lists the anomalies of a non compliant file with their line', async () => {
    replies[FILE] = new Response('x', { headers: { 'content-disposition': 'attachment; filename="123456789FEC20251231.txt"' } })
    replies[`${FILE}&report=1`] = json(200, {
      fileName: '123456789FEC20251231.txt',
      entries: 2,
      lines: 4,
      valid: false,
      errors: [{ line: 3, message: 'EcritureDate manquante' }],
      warnings: [{ line: null, message: 'Aucune écriture à-nouveaux en tête de fichier' }],
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const user = userEvent.setup()
    render(<FECExportPage />)
    await user.click(await screen.findByRole('button', { name: /Exporter le FEC/ }))

    expect(await screen.findByText('1 anomalie dans le fichier')).toBeInTheDocument()
    const items = screen.getAllByRole('listitem').map((item) => item.textContent)
    expect(items).toEqual(['Ligne 3\u00a0: EcritureDate manquante', 'Aucune écriture à-nouveaux en tête de fichier'])
  })

  it('shows the refusal of the server and downloads nothing', async () => {
    replies[FILE] = json(400, { error: "Aucune écriture validée dans l'exercice 2025" })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const user = userEvent.setup()
    render(<FECExportPage />)
    await user.click(await screen.findByRole('button', { name: /Exporter le FEC/ }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Aucune écriture validée dans l'exercice 2025"))
    expect(click).not.toHaveBeenCalled()
    expect(fetchMock.mock.calls.map(([input]) => String(input))).not.toContain(`${FILE}&report=1`)
  })
})
