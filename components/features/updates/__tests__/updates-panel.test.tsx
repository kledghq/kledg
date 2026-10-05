import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateOverview } from '@/lib/updates/overview'
import type { ConnectionSummary } from '@/lib/updates/connection'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
const children = vi.hoisted(() => ({ connect: vi.fn(), actions: vi.fn() }))
vi.mock('sonner', () => ({ toast }))
vi.mock('../github-connect', () => ({
  GitHubConnect: (props: Record<string, unknown>) => {
    children.connect(props)
    return <div>GitHubConnect</div>
  },
}))
vi.mock('../update-actions', () => ({
  UpdateActions: (props: Record<string, unknown>) => {
    children.actions(props)
    return <div>UpdateActions</div>
  },
}))

import { UpdatesPanel } from '../updates-panel'
import { MANUAL_UPDATE_COMMANDS } from '@/lib/updates/hosting'

const connection: ConnectionSummary = {
  owner: 'acme',
  repo: 'kledg',
  kind: 'fork',
  defaultBranch: 'main',
  tokenLast4: 'a1b2',
  tokenExpiresAt: null,
  expired: false,
  expiresSoon: false,
  connectedAt: '2026-10-01T12:00:00.000Z',
}

function overview(overrides: Partial<UpdateOverview> = {}): UpdateOverview {
  return {
    current: {
      version: '1.3.0',
      commit: 'abcdef1234567890',
      branch: 'main',
      repository: { owner: 'acme', repo: 'kledg' },
      buildDate: null,
      platform: 'vercel',
      deploysFromGitHub: true,
    },
    state: 'available',
    latest: {
      tag: 'v1.4.0',
      version: '1.4.0',
      name: 'Kledg 1.4.0',
      body: '- Nouvelle **balance**',
      url: 'https://github.com/kledghq/kledg/releases/tag/v1.4.0',
      publishedAt: '2026-10-01T12:00:00.000Z',
      prerelease: false,
    },
    notes: [],
    releasesError: null,
    migrations: { names: ['20261001000000_add_x'], error: null },
    connection,
    managementRefused: null,
    ...overrides,
  }
}

let data: UpdateOverview
const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  data = overview()
  fetchMock.mockImplementation(async () => Response.json(data))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  vi.clearAllMocks()
})

describe('UpdatesPanel', () => {
  it('shows the available version, deployed commit link and the migrations to apply', async () => {
    data = overview({ notes: [overview().latest!] })
    render(<UpdatesPanel />)
    expect(await screen.findByText('La version 1.4.0 est disponible depuis le 1 octobre 2026.')).toBeInTheDocument()
    expect(screen.getByText('Mise à jour disponible')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'abcdef1' })).toHaveAttribute(
      'href',
      'https://github.com/acme/kledg/commit/abcdef1234567890',
    )
    expect(screen.getByText('(branche main)', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('Inconnu')).toBeInTheDocument()
    expect(screen.getByText('20261001000000_add_x')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Kledg 1.4.0' })).toBeInTheDocument()
    expect(screen.getByText('balance')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/updates', expect.objectContaining({ method: 'GET', cache: 'no-store' }))
  })

  it('offers the one-click update with the data it needs when the instance deploys from GitHub', async () => {
    render(<UpdatesPanel />)
    await screen.findByText('UpdateActions')
    expect(children.connect).toHaveBeenLastCalledWith(
      expect.objectContaining({ detected: { owner: 'acme', repo: 'kledg' }, connection, platform: 'vercel' }),
    )
    expect(children.actions).toHaveBeenLastCalledWith({
      platform: 'vercel',
      isFork: true,
      previousCommit: 'abcdef1234567890',
      overviewMigrations: ['20261001000000_add_x'],
      upToDate: false,
    })
  })

  it('hides the update actions while the token is expired or GitHub is not connected', async () => {
    data = overview({ connection: { ...connection, expired: true } })
    const { unmount } = render(<UpdatesPanel />)
    await screen.findByText('GitHubConnect')
    expect(screen.queryByText('UpdateActions')).toBeNull()
    unmount()
    data = overview({ connection: null })
    render(<UpdatesPanel />)
    await screen.findByText('GitHubConnect')
    expect(screen.queryByText('UpdateActions')).toBeNull()
  })

  it('says why updates cannot be managed instead of offering them', async () => {
    data = overview({ managementRefused: 'Les mises à jour sont gérées par votre hébergeur.' })
    render(<UpdatesPanel />)
    expect(await screen.findByText('Les mises à jour sont gérées par votre hébergeur.')).toBeInTheDocument()
    expect(screen.queryByText('GitHubConnect')).toBeNull()
  })

  it('gives the manual commands, copyable, when the host does not deploy from GitHub', async () => {
    const user = userEvent.setup()
    data = overview({
      state: 'up-to-date',
      current: { ...overview().current, platform: 'docker', deploysFromGitHub: false, repository: null, commit: null, branch: null },
    })
    render(<UpdatesPanel />)
    expect(await screen.findByText('Mettre à jour avec Docker')).toBeInTheDocument()
    expect(screen.getByText('À jour')).toBeInTheDocument()
    expect(screen.getByText('Vous utilisez la dernière version publiée.')).toBeInTheDocument()
    // No migrations card when already up to date.
    expect(screen.queryByText('Base de données')).toBeNull()
    expect(screen.getByText(/le conteneur sauvegarde la base avec pg_dump/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Copier les commandes' }))
    await expect(navigator.clipboard.readText()).resolves.toBe(MANUAL_UPDATE_COMMANDS.docker)
    expect(toast.success).toHaveBeenCalledWith('Commandes copiées')
  })

  it('explains an unknown state with the releases error', async () => {
    data = overview({ state: 'unknown', latest: null, releasesError: 'GitHub limite les requêtes, réessayez dans une heure.' })
    render(<UpdatesPanel />)
    expect(await screen.findByText('GitHub limite les requêtes, réessayez dans une heure.')).toBeInTheDocument()
    expect(screen.getByText('Statut inconnu')).toBeInTheDocument()
    expect(screen.getByText('Inconnue')).toBeInTheDocument()
  })

  it('shows the load error', async () => {
    fetchMock.mockImplementation(async () => Response.json({ error: 'Accès réservé aux administrateurs' }, { status: 403 }))
    render(<UpdatesPanel />)
    expect(await screen.findByText('Accès réservé aux administrateurs')).toBeInTheDocument()
  })
})
