import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PendingDeployment, UpdateBranch, UpdatePull, WorkflowRun } from '@/lib/updates/service'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

import { UpdateActions } from '../update-actions'

const pull: UpdatePull = {
  number: 42,
  title: 'Kledg 1.4.0',
  url: 'https://github.com/acme/kledg/pull/42',
  headSha: 'abc1234',
  mergeable: true,
  mergeableState: 'clean',
  migrations: ['20261001000000_add_x', '20261002000000_add_y'],
  preview: { url: 'https://preview.example.com', state: 'success' },
}

type GitHubState = {
  channel: 'releases' | 'main' | 'off' | null
  repository: string
  workflow: { present: boolean; state: string | null; current: boolean }
  run: WorkflowRun | null
  pull: UpdatePull | null
  branch?: UpdateBranch | null
  deployment?: PendingDeployment | null
}

let github: GitHubState
let version: { version: string; commit: string | null }
const fetchMock = vi.fn<typeof fetch>()

function routes(overrides: Partial<Record<string, () => Response>> = {}) {
  fetchMock.mockImplementation(async (input, init) => {
    const key = `${init?.method ?? 'GET'} ${String(input)}`
    const override = overrides[key]
    if (override) return override()
    switch (key) {
      case 'GET /api/updates/github':
        return Response.json(github)
      case 'GET /api/updates/version':
        return Response.json(version)
      case 'PUT /api/updates/channel':
        return Response.json({ success: true })
      case 'POST /api/updates/install':
        return Response.json({ sha: 'merged999' })
      case 'POST /api/updates/prepare':
        return Response.json({ mode: 'workflow', workflowInstalled: false, dispatchedAt: '2026-10-03T10:00:00.000Z' })
      default:
        return new Response(null, { status: 404 })
    }
  })
}

beforeEach(() => {
  github = { channel: 'releases', repository: 'acme/kledg', workflow: { present: true, state: 'active', current: true }, run: null, pull: null }
  version = { version: '1.3.0', commit: 'old0000' }
  routes()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  vi.clearAllMocks()
})

function bodyOf(key: string) {
  const call = fetchMock.mock.calls.find(([url, init]) => `${init?.method ?? 'GET'} ${String(url)}` === key)
  return call ? JSON.parse(String(call[1]?.body)) : undefined
}

describe('UpdateActions', () => {
  it('without the Variables permission, shows the default channel and how to change it', async () => {
    github.channel = null
    render(<UpdateActions platform="vercel" isFork={false} previousCommit="old0000" overviewMigrations={[]} />)
    expect(await screen.findByText('Versions publiées (recommandé)')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'jeton GitHub' })).toHaveAttribute('href', 'https://github.com/settings/personal-access-tokens')
    expect(screen.getByRole('link', { name: 'variables du dépôt' })).toHaveAttribute(
      'href',
      'https://github.com/acme/kledg/settings/variables/actions',
    )
    expect(screen.getByRole('button', { name: 'Préparer la mise à jour' })).toBeEnabled()
  })

  it('cannot install before a pull request is prepared', async () => {
    render(<UpdateActions platform="vercel" isFork={false} previousCommit="old0000" overviewMigrations={[]} />)
    expect(await screen.findByRole('button', { name: 'Préparer la mise à jour' })).toBeEnabled()
    await waitFor(() => expect(screen.getByRole('combobox')).toBeEnabled())
    expect(screen.getByRole('button', { name: 'Installer la mise à jour' })).toBeDisabled()
  })

  it('shows the pull request, its preview and migrations, and warns to back up before installing it', async () => {
    const user = userEvent.setup()
    github.pull = pull
    render(<UpdateActions platform="vercel" isFork={false} previousCommit="old0000" overviewMigrations={[]} />)
    expect(await screen.findByText('Version prête : Kledg 1.4.0')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'voir sur GitHub (#42)' })).toHaveAttribute('href', pull.url)
    expect(screen.getByText(/Aperçu : prêt/)).toBeInTheDocument()
    expect(screen.getByText('2 migrations de la base')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Préparer de nouveau' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Installer la mise à jour' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('20261001000000_add_x')).toBeInTheDocument()
    expect(within(dialog).getByText('Sauvegardez la base avant de continuer.')).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: 'Branches Neon' })).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/updates/install')).toBe(false)

    await user.click(within(dialog).getByRole('button', { name: "J'ai sauvegardé, installer" }))
    expect(await screen.findByText('Déploiement en cours')).toBeInTheDocument()
    expect(bodyOf('POST /api/updates/install')).toEqual({ mode: 'pull', pullNumber: 42, headSha: 'abc1234', confirm: true })
  })

  it('follows the deployment until the new commit answers, then offers to reload', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    github.pull = { ...pull, migrations: [] }
    render(<UpdateActions platform="docker" isFork={false} previousCommit="old0000" overviewMigrations={[]} />)
    await screen.findByRole('link', { name: 'voir sur GitHub (#42)' })
    await user.click(screen.getByRole('button', { name: 'Installer la mise à jour' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/ne modifie pas la base de données/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Installer' }))
    expect(await screen.findByText('Déploiement en cours')).toBeInTheDocument()
    expect(screen.getByText(/Votre hébergeur construit la nouvelle version/)).toBeInTheDocument()

    // Still the old commit after 10 s: keep waiting.
    await act(() => vi.advanceTimersByTimeAsync(10_000))
    expect(screen.getByText('Déploiement en cours')).toBeInTheDocument()

    version = { version: '1.4.0', commit: 'merged999' }
    await act(() => vi.advanceTimersByTimeAsync(10_000))
    expect(await screen.findByText('Kledg 1.4.0 est installé.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Recharger la page' })).toBeInTheDocument()
  })

  it('after a reload, shows the deployment GitHub reports as building, until the new commit answers', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const SHA = 'f'.repeat(40)
    github.deployment = { sha: SHA, state: 'building' }
    render(<UpdateActions platform="vercel" isFork={false} previousCommit="old0000" overviewMigrations={[]} />)
    expect(await screen.findByText('Déploiement en cours')).toBeInTheDocument()

    await act(() => vi.advanceTimersByTimeAsync(10_000))
    expect(screen.getByText('Déploiement en cours')).toBeInTheDocument()

    // The host gives a short commit
    version = { version: '1.4.0', commit: SHA.slice(0, 7) }
    github.deployment = null
    await act(() => vi.advanceTimersByTimeAsync(10_000))
    expect(await screen.findByText('Kledg 1.4.0 est installé.')).toBeInTheDocument()
  })

  it('says when the host failed to deploy, and leaves the deployment card for it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const SHA = 'e'.repeat(40)
    github.deployment = { sha: SHA, state: 'building' }
    render(<UpdateActions platform="vercel" isFork={false} previousCommit="old0000" overviewMigrations={[]} />)
    expect(await screen.findByText('Déploiement en cours')).toBeInTheDocument()

    github.deployment = { sha: SHA, state: 'failed' }
    await act(() => vi.advanceTimersByTimeAsync(10_000))
    const alert = await screen.findByText(/n'a pas réussi à déployer la dernière version de votre dépôt \(commit eeeeeee\)/)
    expect(alert).toBeInTheDocument()
    expect(screen.queryByText('Déploiement en cours')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Préparer la mise à jour' })).toBeInTheDocument()
  })

  it('shows the preparation as requested until GitHub lists its run', async () => {
    const user = userEvent.setup()
    github.run = { id: 1, status: 'completed', conclusion: 'success', url: 'https://github.com/acme/kledg/actions/runs/1', createdAt: '2026-01-01T10:00:00.000Z' }
    render(<UpdateActions platform="vercel" isFork={false} previousCommit={null} overviewMigrations={[]} />)
    expect(await screen.findByText('Préparation terminée')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Préparer la mise à jour' }))
    expect(await screen.findByText('Préparation demandée')).toBeInTheDocument()
    expect(screen.queryByText('Préparation terminée')).not.toBeInTheDocument()

    github.run = { id: 2, status: 'in_progress', conclusion: null, url: 'https://github.com/acme/kledg/actions/runs/2', createdAt: new Date().toISOString() }
    await user.click(screen.getByRole('button', { name: 'Rafraîchir' }))
    expect(await screen.findByText('Préparation en cours')).toBeInTheDocument()
    expect(screen.queryByText('Préparation demandée')).not.toBeInTheDocument()
  })

  it('blocks installation of a pull request with conflicts', async () => {
    github.pull = { ...pull, mergeable: false }
    render(<UpdateActions platform="vercel" isFork={false} previousCommit={null} overviewMigrations={[]} />)
    expect(await screen.findByText('Conflits')).toBeInTheDocument()
    expect(screen.getByText(/résolvez-les sur GitHub/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Installer la mise à jour' })).toBeDisabled()
  })

  it('prepares through the workflow and toasts what happens', async () => {
    const user = userEvent.setup()
    github.workflow = { present: false, state: null, current: false }
    routes({
      'POST /api/updates/prepare': () =>
        Response.json({ mode: 'workflow', workflowInstalled: true, dispatchedAt: '2026-10-03T10:00:00.000Z' }),
    })
    render(<UpdateActions platform="vercel" isFork={false} previousCommit={null} overviewMigrations={[]} />)
    expect(await screen.findByText(/Première fois : « Préparer » ajoute d'abord à votre dépôt l'outil de mise à jour de Kledg/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Préparer la mise à jour' }))
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        'Kledg a ajouté son outil de mise à jour à votre dépôt et lancé la préparation. La nouvelle version est prête dans une minute environ.',
      ),
    )
  })

  it('installs an update prepared without its pull request (Actions may not open pull requests in the repository)', async () => {
    const user = userEvent.setup()
    github.run = { id: 1, status: 'completed', conclusion: 'success', url: 'https://github.com/acme/kledg/actions/runs/1', createdAt: '2026-10-03T10:00:00.000Z' }
    github.branch = {
      headSha: 'f'.repeat(40),
      label: 'v1.4.0',
      url: 'https://github.com/acme/kledg/compare/main...kledg-update',
      migrations: ['20261001000000_add_x'],
      preview: null,
      settings: {
        organization: { name: 'acme', url: 'https://github.com/organizations/acme/settings/actions' },
        repositoryUrl: 'https://github.com/acme/kledg/settings/actions',
      },
    }
    render(<UpdateActions platform="vercel" isFork={false} previousCommit="old0000" overviewMigrations={[]} />)
    expect(await screen.findByText('Version prête : Kledg v1.4.0')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'voir sur GitHub' })).toHaveAttribute('href', 'https://github.com/acme/kledg/compare/main...kledg-update')
    expect(screen.getByText(/Kledg la proposera au moment de l'installer/)).toBeInTheDocument()
    // The organization's box comes first: the repository's stays greyed out until the organization allows it.
    expect(screen.getByRole('link', { name: "réglages de l'organisation acme" })).toHaveAttribute('href', 'https://github.com/organizations/acme/settings/actions')
    expect(screen.getByRole('link', { name: 'réglages du dépôt' })).toHaveAttribute('href', 'https://github.com/acme/kledg/settings/actions')
    expect(screen.queryByText(/aucune version à installer/)).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Installer la mise à jour' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('20261001000000_add_x')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: "J'ai sauvegardé, installer" }))
    await screen.findByText('Déploiement en cours')
    expect(bodyOf('POST /api/updates/install')).toEqual({ mode: 'branch', headSha: 'f'.repeat(40), confirm: true })
  })

  it('switches a fork without workflow to a direct sync and installs with merge-upstream', async () => {
    const user = userEvent.setup()
    routes({ 'POST /api/updates/prepare': () => Response.json({ mode: 'merge-upstream' }) })
    render(<UpdateActions platform="vercel" isFork previousCommit="old0000" overviewMigrations={['20261001000000_add_x']} />)
    await user.click(await screen.findByRole('button', { name: 'Préparer la mise à jour' }))
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith('Votre fork peut être synchronisé directement avec Kledg.'))
    expect(screen.getByText(/l’aligne directement sur Kledg/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Installer la mise à jour' }))
    const dialog = await screen.findByRole('alertdialog')
    // The migrations come from the overview when there is no pull request.
    expect(within(dialog).getByText('20261001000000_add_x')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: "J'ai sauvegardé, installer" }))
    await screen.findByText('Déploiement en cours')
    expect(bodyOf('POST /api/updates/install')).toEqual({ mode: 'merge-upstream', confirm: true })
  })

  it('toasts a failed preparation or installation', async () => {
    const user = userEvent.setup()
    github.pull = pull
    routes({
      'POST /api/updates/prepare': () => Response.json({ error: 'Le jeton a expiré' }, { status: 400 }),
      'POST /api/updates/install': () => Response.json({ error: 'La pull request a changé' }, { status: 409 }),
    })
    render(<UpdateActions platform="vercel" isFork={false} previousCommit={null} overviewMigrations={[]} />)
    await user.click(await screen.findByRole('button', { name: 'Préparer de nouveau' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Le jeton a expiré'))
    await user.click(screen.getByRole('button', { name: 'Installer la mise à jour' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: "J'ai sauvegardé, installer" }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('La pull request a changé'))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(screen.queryByText('Déploiement en cours')).toBeNull()
  })

  it('saves the update channel with PUT', async () => {
    const user = userEvent.setup()
    render(<UpdateActions platform="vercel" isFork={false} previousCommit={null} overviewMigrations={[]} />)
    const select = await screen.findByRole('combobox')
    await waitFor(() => expect(select).toBeEnabled())
    expect(select).toHaveTextContent('Versions publiées (recommandé)')
    await user.click(select)
    await user.click(await screen.findByRole('option', { name: 'Branche principale (tests)' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Canal de mise à jour enregistré.'))
    expect(bodyOf('PUT /api/updates/channel')).toEqual({ channel: 'main' })
  })

  it('disables preparation when the channel is off', async () => {
    github.channel = 'off'
    const { unmount } = render(<UpdateActions platform="vercel" isFork={false} previousCommit={null} overviewMigrations={[]} />)
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveTextContent('Désactivé'))
    expect(screen.getByRole('button', { name: 'Préparer la mise à jour' })).toBeDisabled()
    unmount()
  })

  it('labels the last workflow run and links its log', async () => {
    github.run = { id: 1, status: 'completed', conclusion: 'failure', url: 'https://github.com/acme/kledg/actions/runs/1', createdAt: '2026-10-03T10:00:00.000Z' }
    render(<UpdateActions platform="vercel" isFork={false} previousCommit={null} overviewMigrations={[]} />)
    expect(await screen.findByText('Préparation en échec')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Journal sur GitHub/ })).toHaveAttribute('href', 'https://github.com/acme/kledg/actions/runs/1')
  })

  it('says there is nothing to install when the preparation found the instance up to date', async () => {
    github.run = { id: 2, status: 'completed', conclusion: 'success', url: 'https://github.com/acme/kledg/actions/runs/2', createdAt: '2026-10-05T14:55:00.000Z' }
    const { unmount } = render(<UpdateActions platform="vercel" isFork={false} previousCommit={null} overviewMigrations={[]} upToDate />)
    expect(await screen.findByText(/Rien à installer/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Installer la mise à jour' })).toBeDisabled()
    unmount()

    render(<UpdateActions platform="vercel" isFork={false} previousCommit={null} overviewMigrations={[]} />)
    expect(await screen.findByText(/aucune version à installer/)).toBeInTheDocument()
  })

  it('shows the load error', async () => {
    routes({ 'GET /api/updates/github': () => Response.json({ error: 'GitHub ne répond pas' }, { status: 502 }) })
    render(<UpdateActions platform="vercel" isFork={false} previousCommit={null} overviewMigrations={[]} />)
    expect(await screen.findByText('GitHub ne répond pas')).toBeInTheDocument()
  })
})
