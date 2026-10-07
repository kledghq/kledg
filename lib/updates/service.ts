/**
 * Update actions on the instance's own repository, with the stored token.
 *
 * Preparing an update always goes through the "Update from Kledg" workflow
 * of the repository (workflow_dispatch): it works the same way for forks and
 * for copies made by the Vercel button (whose history is unrelated to Kledg's,
 * see the workflow), and its pull request gets a preview where the host builds
 * one (Vercel, Railway or Render pull request environments). Copies that
 * lack the workflow (the Vercel button may drop .github) get it installed
 * first, through the Contents API.
 *
 * Forks without the workflow fall back to GitHub's "merge upstream" API,
 * which syncs the default branch with kledghq/kledg main directly (no pull
 * request): it is run by "Installer la mise à jour", after the confirmation.
 */

import { ConflictError, ValidationError } from '@/lib/accounting/errors'
import {
  CHANNEL_VARIABLE,
  contentsPath,
  githubRequest,
  GitHubError,
  repoPath,
  UPDATE_BRANCH,
  WORKFLOW_FILE,
  WORKFLOW_PATH,
} from './github'
import type { ActiveConnection } from './connection'
import { migrationsFromFiles } from './releases'
import { UPDATE_WORKFLOW } from './workflow-template'

export const CHANNELS = ['releases', 'main', 'off'] as const
export type Channel = (typeof CHANNELS)[number]

function isChannel(value: unknown): value is Channel {
  return typeof value === 'string' && (CHANNELS as readonly string[]).includes(value)
}

/** Marker of the workflow version that handles copies with unrelated history. */
const WORKFLOW_MARKER = '# BEGIN kledg-merge'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
let delay = sleep
/** Tests skip the waits between retries. */
export function setRetryDelay(fn: ((ms: number) => Promise<unknown>) | null): void {
  delay = fn ?? sleep
}

// ---------------------------------------------------------------------------
// Channel (repository variable KLEDG_UPDATES)

export async function getChannel(conn: ActiveConnection): Promise<Channel | null> {
  try {
    const { status, data } = await githubRequest<{ value?: string }>(
      repoPath(conn.repository, 'actions', 'variables', CHANNEL_VARIABLE),
      { token: conn.token, allow: [404] },
    )
    if (status === 404) return 'releases'
    const value = data?.value?.trim()
    return isChannel(value) ? value : 'releases'
  } catch (error) {
    // Without the Variables permission the channel is simply unknown.
    if (error instanceof GitHubError && error.githubCode === 'forbidden') return null
    throw error
  }
}

export async function setChannel(conn: ActiveConnection, channel: Channel): Promise<void> {
  const { status } = await githubRequest(repoPath(conn.repository, 'actions', 'variables', CHANNEL_VARIABLE), {
    token: conn.token,
    method: 'PATCH',
    body: { name: CHANNEL_VARIABLE, value: channel },
    allow: [404],
  })
  if (status === 404) {
    await githubRequest(repoPath(conn.repository, 'actions', 'variables'), {
      token: conn.token,
      method: 'POST',
      body: { name: CHANNEL_VARIABLE, value: channel },
    })
  }
}

// ---------------------------------------------------------------------------
// Workflow

export interface WorkflowInfo {
  present: boolean
  state: string | null
  /** The file handles copies with unrelated history (BEGIN kledg-merge marker). */
  current: boolean
  sha: string | null
}

export async function getWorkflow(conn: ActiveConnection): Promise<WorkflowInfo> {
  const file = await githubRequest<{ sha: string; content?: string }>(
    contentsPath(conn.repository, WORKFLOW_PATH, conn.defaultBranch),
    { token: conn.token, allow: [404] },
  )
  if (file.status === 404) return { present: false, state: null, current: false, sha: null }
  const content = file.data?.content ? Buffer.from(file.data.content, 'base64').toString('utf8') : ''
  const workflow = await githubRequest<{ state: string }>(repoPath(conn.repository, 'actions', 'workflows', WORKFLOW_FILE), {
    token: conn.token,
    allow: [404],
  })
  return {
    present: true,
    state: workflow.status === 404 ? null : (workflow.data?.state ?? null),
    current: content.includes(WORKFLOW_MARKER),
    sha: file.data?.sha ?? null,
  }
}

/** Adds (or upgrades) the update workflow on the default branch. Needs the Workflows permission. */
async function installWorkflow(conn: ActiveConnection, existingSha: string | null): Promise<void> {
  try {
    await githubRequest(contentsPath(conn.repository, WORKFLOW_PATH), {
      token: conn.token,
      method: 'PUT',
      body: {
        message: existingSha ? 'Update the Kledg update workflow' : 'Add the Kledg update workflow',
        content: Buffer.from(UPDATE_WORKFLOW, 'utf8').toString('base64'),
        branch: conn.defaultBranch,
        ...(existingSha ? { sha: existingSha } : {}),
      },
    })
  } catch (error) {
    if (error instanceof GitHubError && (error.githubCode === 'forbidden' || error.githubCode === 'not_found')) {
      throw new ValidationError(
        "Impossible d'ajouter le workflow de mise à jour à votre dépôt : le jeton doit avoir la permission Workflows (lecture et écriture).",
      )
    }
    throw error
  }
}

export interface WorkflowRun {
  id: number
  status: string
  conclusion: string | null
  url: string
  createdAt: string
}

export async function latestRun(conn: ActiveConnection): Promise<WorkflowRun | null> {
  const { status, data } = await githubRequest<{ workflow_runs?: Array<{ id: number; status: string; conclusion: string | null; html_url: string; created_at: string }> }>(
    `${repoPath(conn.repository, 'actions', 'workflows', WORKFLOW_FILE, 'runs')}?event=workflow_dispatch&per_page=1`,
    { token: conn.token, allow: [404] },
  )
  const run = status === 404 ? undefined : data?.workflow_runs?.[0]
  if (!run) return null
  return {
    id: run.id,
    status: run.status,
    conclusion: run.conclusion,
    url: safeGitHubUrl(run.html_url),
    createdAt: run.created_at,
  }
}

function safeGitHubUrl(url: string | undefined | null): string {
  return typeof url === 'string' && url.startsWith('https://github.com/') ? url : 'https://github.com/'
}

// ---------------------------------------------------------------------------
// Prepare

export type PrepareResult =
  | { mode: 'workflow'; workflowInstalled: boolean; dispatchedAt: string }
  | { mode: 'merge-upstream' }

export async function prepareUpdate(conn: ActiveConnection, channel: Channel | null): Promise<PrepareResult> {
  if (channel === 'off') {
    throw new ValidationError('Les mises à jour sont désactivées (canal « off »). Choisissez un canal pour préparer une mise à jour.')
  }
  const workflow = await getWorkflow(conn)

  if (!workflow.present && conn.kind === 'fork') {
    // A fork without the workflow: GitHub can sync it with kledghq/kledg main
    // directly. Nothing to prepare; installing runs merge-upstream.
    return { mode: 'merge-upstream' }
  }

  let installed = false
  if (!workflow.present || (!workflow.current && conn.kind === 'copy')) {
    await installWorkflow(conn, workflow.sha)
    installed = true
  }
  if (workflow.state && workflow.state !== 'active') {
    await githubRequest(repoPath(conn.repository, 'actions', 'workflows', WORKFLOW_FILE, 'enable'), {
      token: conn.token,
      method: 'PUT',
    })
  }

  // A workflow that was just added can take a moment to be dispatchable.
  const dispatchedAt = new Date().toISOString()
  for (let attempt = 0; ; attempt++) {
    try {
      await githubRequest(repoPath(conn.repository, 'actions', 'workflows', WORKFLOW_FILE, 'dispatches'), {
        token: conn.token,
        method: 'POST',
        body: { ref: conn.defaultBranch },
      })
      break
    } catch (error) {
      if (installed && attempt < 3 && error instanceof GitHubError && (error.githubCode === 'not_found' || error.githubCode === 'unprocessable')) {
        await delay(2000 * (attempt + 1))
        continue
      }
      throw error
    }
  }
  return { mode: 'workflow', workflowInstalled: installed, dispatchedAt }
}

// ---------------------------------------------------------------------------
// Pull request

export interface UpdatePull {
  number: number
  title: string
  url: string
  headSha: string
  mergeable: boolean | null
  mergeableState: string | null
  migrations: string[]
  preview: { url: string | null; state: string | null } | null
}

interface GitHubPull {
  number: number
  title: string
  html_url: string
  head: { sha: string; ref: string }
  mergeable?: boolean | null
  mergeable_state?: string
}

export async function findUpdatePull(conn: ActiveConnection): Promise<UpdatePull | null> {
  const head = `${conn.repository.owner}:${UPDATE_BRANCH}`
  const { data: list } = await githubRequest<GitHubPull[]>(
    `${repoPath(conn.repository, 'pulls')}?state=open&head=${encodeURIComponent(head)}&base=${encodeURIComponent(conn.defaultBranch)}&per_page=1`,
    { token: conn.token },
  )
  const first = Array.isArray(list) ? list[0] : undefined
  if (!first) return null
  const { data: pull } = await githubRequest<GitHubPull>(repoPath(conn.repository, 'pulls', first.number), { token: conn.token })

  const files: Array<{ filename: string; status: string }> = []
  for (let page = 1; page <= 3; page++) {
    const { data } = await githubRequest<Array<{ filename: string; status: string }>>(
      `${repoPath(conn.repository, 'pulls', pull.number, 'files')}?per_page=100&page=${page}`,
      { token: conn.token },
    )
    if (!Array.isArray(data) || data.length === 0) break
    files.push(...data)
    if (data.length < 100) break
  }

  return {
    number: pull.number,
    title: pull.title,
    url: safeGitHubUrl(pull.html_url),
    headSha: pull.head.sha,
    mergeable: pull.mergeable ?? null,
    mergeableState: pull.mergeable_state ?? null,
    migrations: migrationsFromFiles(files),
    preview: await previewFor(conn, pull.head.sha),
  }
}

/** The preview of a commit, from the GitHub deployments the host creates (Vercel, Railway, Render). */
async function previewFor(conn: ActiveConnection, sha: string): Promise<UpdatePull['preview']> {
  if (!/^[0-9a-f]{40}$/i.test(sha)) return null
  try {
    const { data: deployments } = await githubRequest<Array<{ id: number }>>(
      `${repoPath(conn.repository, 'deployments')}?sha=${sha}&per_page=5`,
      { token: conn.token },
    )
    const deployment = Array.isArray(deployments) ? deployments[0] : undefined
    if (!deployment) return { url: null, state: null }
    const { data: statuses } = await githubRequest<Array<{ state: string; environment_url?: string; target_url?: string }>>(
      `${repoPath(conn.repository, 'deployments', deployment.id, 'statuses')}?per_page=1`,
      { token: conn.token },
    )
    const status = Array.isArray(statuses) ? statuses[0] : undefined
    const url = status?.environment_url
    return {
      url: typeof url === 'string' && url.startsWith('https://') ? url : null,
      state: status?.state ?? 'pending',
    }
  } catch (error) {
    // Without the Deployments permission the preview link is just not shown.
    if (error instanceof GitHubError && (error.githubCode === 'forbidden' || error.githubCode === 'not_found')) return null
    throw error
  }
}

// ---------------------------------------------------------------------------
// Install

export interface InstallResult {
  /** Commit the next deployment is built from. */
  sha: string | null
}

/** Merges the update pull request, only if its head is still the commit the admin confirmed. */
export async function mergeUpdatePull(conn: ActiveConnection, pullNumber: number, headSha: string): Promise<InstallResult> {
  const pull = await githubRequest<GitHubPull>(repoPath(conn.repository, 'pulls', pullNumber), { token: conn.token })
  if (pull.data.head.ref !== UPDATE_BRANCH) {
    throw new ValidationError("Cette pull request n'est pas une mise à jour Kledg.")
  }
  if (pull.data.head.sha !== headSha) {
    throw new ConflictError('La mise à jour a changé depuis votre confirmation. Vérifiez-la de nouveau.')
  }
  const { status, data } = await githubRequest<{ sha?: string; merged?: boolean; message?: string }>(
    repoPath(conn.repository, 'pulls', pullNumber, 'merge'),
    {
      token: conn.token,
      method: 'PUT',
      body: { sha: headSha, merge_method: 'merge' },
      allow: [405],
    },
  )
  if (status === 405 || !data?.merged) {
    throw new ConflictError(
      "GitHub refuse de fusionner la mise à jour (conflits, vérifications en attente ou protection de branche). Ouvrez la pull request sur GitHub.",
    )
  }
  return { sha: data.sha ?? null }
}

/** Forks without the workflow: sync the default branch with kledghq/kledg main. */
export async function mergeUpstream(conn: ActiveConnection): Promise<InstallResult> {
  if (conn.kind !== 'fork') throw new ValidationError("Ce dépôt n'est pas un fork de kledghq/kledg.")
  const { status } = await githubRequest<{ merge_type?: string }>(repoPath(conn.repository, 'merge-upstream'), {
    token: conn.token,
    method: 'POST',
    body: { branch: conn.defaultBranch },
    allow: [409],
  })
  if (status === 409) {
    throw new ConflictError('Votre fork contient des modifications en conflit avec Kledg : synchronisez-le sur GitHub (Sync fork).')
  }
  const { data } = await githubRequest<{ commit?: { sha?: string } }>(repoPath(conn.repository, 'branches', conn.defaultBranch), {
    token: conn.token,
  })
  return { sha: data?.commit?.sha ?? null }
}
