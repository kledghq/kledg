/**
 * The /share page (files shared from another app, kept on the device by
 * public/sw.js): nothing is sent before the company is chosen; the files are
 * then dropped as receipts of that company, the device copy is forgotten,
 * and the Justificatifs page opens. "Ne pas déposer" forgets them too.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), useSearchParams: () => new URLSearchParams('files=2') }))

import SharePage from '../page'
import { SHARE_CACHE } from '@/components/features/receipts/shared-files'

/** The share cache as public/sw.js leaves it. */
function sharedCache(files: Array<{ name: string; type: string; body: string }>) {
  const entries = new Map(files.map((f, i) => [`https://kledg.example/share/file/${i}`, f]))
  const cache = {
    keys: async () => [...entries.keys()].reverse().map((url) => new Request(url)),
    match: async (request: Request) => {
      const f = entries.get(request.url)
      return f ? new Response(f.body, { headers: { 'Content-Type': f.type, 'X-Kledg-File-Name': encodeURIComponent(f.name) } }) : undefined
    },
  }
  const storage = { open: vi.fn(async () => cache), delete: vi.fn(async () => true) }
  vi.stubGlobal('caches', storage)
  return storage
}

let companies: Array<{ id: string; slug: string; name: string }> = []
let staged: FormData[] = []

beforeEach(() => {
  staged = []
  companies = [{ id: 'c1', slug: 'atelier-martin', name: 'Atelier Martin' }]
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/companies') return Response.json(companies)
      if (String(input) === '/api/receipts/staged') {
        staged.push(init?.body as FormData)
        return Response.json({ receipt: { id: `r${staged.length}` } }, { status: 201 })
      }
      return Response.json({}, { status: 404 })
    }),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  push.mockReset()
})

describe('SharePage', () => {
  it('drops the shared files in the chosen company, forgets them and opens its receipts', async () => {
    const storage = sharedCache([
      { name: 'ticket café.jpg', type: 'image/jpeg', body: 'jpeg' },
      { name: 'facture.pdf', type: 'application/pdf', body: '%PDF' },
    ])
    render(<SharePage />)
    expect(await screen.findByText('2 fichiers à déposer')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem').map((li) => li.textContent?.replace(/\d+ Ko$/, ''))).toEqual(['ticket café.jpg', 'facture.pdf'])
    expect(staged).toHaveLength(0)

    fireEvent.click(await screen.findByRole('button', { name: 'Déposer dans les justificatifs' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/atelier-martin/banking/missing-receipts'))
    expect(staged.map((form) => [form.get('companyId'), (form.get('file') as File).name])).toEqual([
      ['c1', 'ticket café.jpg'],
      ['c1', 'facture.pdf'],
    ])
    expect(storage.delete).toHaveBeenCalledWith(SHARE_CACHE)
  })

  it('asks for the company when the user has several, and sends nothing until then', async () => {
    companies = [
      { id: 'c1', slug: 'atelier-martin', name: 'Atelier Martin' },
      { id: 'c2', slug: 'studio-nord', name: 'Studio Nord' },
    ]
    sharedCache([{ name: 'facture.pdf', type: 'application/pdf', body: '%PDF' }])
    render(<SharePage />)
    expect(await screen.findByRole('button', { name: 'Déposer dans les justificatifs' })).toBeDisabled()
  })

  it('forgets the files without sending them on « Ne pas déposer »', async () => {
    const storage = sharedCache([{ name: 'facture.pdf', type: 'application/pdf', body: '%PDF' }])
    render(<SharePage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ne pas déposer' }))
    await waitFor(() => expect(screen.getByText('Aucun fichier à déposer')).toBeInTheDocument())
    expect(storage.delete).toHaveBeenCalledWith(SHARE_CACHE)
    expect(staged).toHaveLength(0)
  })
})
