import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VersionHistoryEntry, VersionHistoryPage } from '@/lib/updates/history'
import { EXTERNAL_INSTALL_LABEL, UpdateHistory } from '../update-history'

function entry(overrides: Partial<VersionHistoryEntry> = {}): VersionHistoryEntry {
  return {
    id: 'v2',
    version: '1.4.0',
    commit: 'bbbbbbb1234567890',
    branch: 'main',
    platform: 'vercel',
    firstSeenAt: '2026-10-05T08:30:00.000Z',
    previousVersion: '1.3.0',
    previousCommit: 'aaaaaaa1234567890',
    source: 'update-page',
    installedBy: { name: 'Alice Martin' },
    migrations: ['20261101090000_add_x', '20261102090000_add_y'],
    migrationsKnown: true,
    notesUrl: 'https://github.com/kledghq/kledg/releases/tag/v1.4.0',
    notesKind: 'release',
    ...overrides,
  }
}

let pages: VersionHistoryPage[]
const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  fetchMock.mockImplementation(async () => Response.json(pages.shift() ?? { items: [], nextCursor: null }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

describe('UpdateHistory', () => {
  it('lists the versions with their installer, previous version and release notes link', async () => {
    pages = [{ items: [entry()], nextCursor: null }]
    render(<UpdateHistory currentVersion="1.4.0" />)
    const table = await screen.findByRole('table', { name: 'Historique des mises à jour' })
    expect(await within(table).findByText('Alice Martin')).toBeInTheDocument()
    const row = within(table).getAllByRole('row')[1]
    expect(row).toHaveTextContent('1.3.0 (aaaaaaa)')
    expect(row).toHaveTextContent('1.4.0 (bbbbbbb)')
    // French date and time
    expect(within(row).getByText('05/10/2026', { exact: false })).toBeInTheDocument()
    expect(within(row).getByRole('link', { name: /Notes de version/ })).toHaveAttribute(
      'href',
      'https://github.com/kledghq/kledg/releases/tag/v1.4.0',
    )
    expect(fetchMock).toHaveBeenCalledWith('/api/updates/history', expect.objectContaining({ method: 'GET' }))
  })

  it('names an external update and links its commit when the version is not a release', async () => {
    pages = [
      {
        items: [
          entry({
            source: 'external',
            installedBy: null,
            version: '1.5.0-rc.1',
            notesUrl: 'https://github.com/acme/kledg/commit/bbbbbbb1234567890',
            notesKind: 'commit',
          }),
        ],
        nextCursor: null,
      },
    ]
    render(<UpdateHistory currentVersion="1.5.0-rc.1" />)
    expect(await screen.findByText(EXTERNAL_INSTALL_LABEL)).toBeInTheDocument()
    expect(EXTERNAL_INSTALL_LABEL).toBe('Hôte ou dépôt (hors de cette page)')
    expect(screen.getByRole('link', { name: /Voir le commit/ })).toHaveAttribute(
      'href',
      'https://github.com/acme/kledg/commit/bbbbbbb1234567890',
    )
  })

  it('counts the migrations and expands their list', async () => {
    pages = [{ items: [entry()], nextCursor: null }]
    render(<UpdateHistory currentVersion="1.4.0" />)
    const toggle = await screen.findByRole('button', { name: '2 migrations' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('20261101090000_add_x')).not.toBeInTheDocument()
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('20261101090000_add_x')).toBeInTheDocument()
    expect(screen.getByText('20261102090000_add_y')).toBeInTheDocument()
  })

  it('says when there was no migration, or when they could not be read', async () => {
    pages = [
      {
        items: [
          entry({ id: 'a', migrations: [] }),
          entry({ id: 'b', migrations: [], migrationsKnown: false, previousVersion: null, previousCommit: null, notesUrl: null, notesKind: null }),
        ],
        nextCursor: null,
      },
    ]
    render(<UpdateHistory currentVersion="1.4.0" />)
    await screen.findByText('Inconnues')
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows[0]).toHaveTextContent('Aucune')
    expect(rows[1]).toHaveTextContent('Inconnues')
    expect(rows[1]).toHaveTextContent('Indisponibles')
  })

  it('shows the empty state with the running version', async () => {
    pages = [{ items: [], nextCursor: null }]
    render(<UpdateHistory currentVersion="1.4.0" />)
    expect(await screen.findByText("L'historique commence à cette version (1.4.0).")).toBeInTheDocument()
  })

  it('loads the next page from the cursor', async () => {
    pages = [
      { items: [entry()], nextCursor: 'v2' },
      { items: [entry({ id: 'v1', version: '1.3.0', previousVersion: '1.2.0', installedBy: { name: 'Bob' } })], nextCursor: null },
    ]
    render(<UpdateHistory currentVersion="1.4.0" />)
    await userEvent.click(await screen.findByRole('button', { name: /Charger plus/ }))
    expect(await screen.findByText('Bob')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenLastCalledWith('/api/updates/history?cursor=v2', expect.anything())
  })

  it('shows the load error', async () => {
    fetchMock.mockImplementation(async () => Response.json({ error: "Action réservée aux administrateurs de l'instance." }, { status: 403 }))
    render(<UpdateHistory currentVersion="1.4.0" />)
    expect(await screen.findByText("Action réservée aux administrateurs de l'instance.")).toBeInTheDocument()
  })
})
