/**
 * Minimal GitHub REST client for the "Mises à jour" page.
 *
 * Only https://api.github.com is ever called, with paths built here from
 * fixed templates: owner and repository names are checked against GitHub's
 * naming rules and every segment is URL-encoded, so no user input can change
 * the host or escape the path. The token is sent in the Authorization header
 * only and never appears in errors or logs.
 */

import { AccountingError } from '@/lib/accounting/errors'

const GITHUB_API = 'https://api.github.com'
export const UPSTREAM = { owner: 'kledghq', repo: 'kledg' } as const
export const WORKFLOW_FILE = 'update-from-kledg.yml'
export const WORKFLOW_PATH = `.github/workflows/${WORKFLOW_FILE}`
export const UPDATE_BRANCH = 'kledg-update'
export const CHANNEL_VARIABLE = 'KLEDG_UPDATES'

/** GitHub user or organization: alphanumeric and single hyphens, 39 characters at most. */
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/
/** Repository name: letters, digits, ".", "-" and "_", 100 characters at most, not "." or "..". */
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/
/** Git refs used in paths (tags like v1.2.3, branch names, commit SHAs). */
const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/

export function isValidOwner(owner: string): boolean {
  return OWNER_PATTERN.test(owner)
}

export function isValidRepo(repo: string): boolean {
  return REPO_PATTERN.test(repo) && repo !== '.' && repo !== '..' && !repo.endsWith('.git')
}

function isValidRef(ref: string): boolean {
  return REF_PATTERN.test(ref) && !ref.includes('..') && !ref.endsWith('/') && !ref.endsWith('.lock')
}

export interface RepoRef {
  owner: string
  repo: string
}

function assertRepo({ owner, repo }: RepoRef): void {
  if (!isValidOwner(owner) || !isValidRepo(repo)) {
    throw new GitHubError('invalid_repo', 'Nom de dépôt GitHub invalide (attendu : propriétaire/dépôt).', 400)
  }
}

function assertRef(ref: string): string {
  if (!isValidRef(ref)) throw new GitHubError('invalid_ref', 'Référence Git invalide.', 400)
  return ref
}

const seg = encodeURIComponent

/** Path of an endpoint of a repository: /repos/{owner}/{repo}/... (segments encoded). */
export function repoPath(target: RepoRef, ...rest: Array<string | number>): string {
  assertRepo(target)
  return ['', 'repos', seg(target.owner), seg(target.repo), ...rest.map((s) => seg(String(s)))].join('/')
}

/** /repos/{owner}/{repo}/contents/{path}?ref= with a validated ref (path segments encoded one by one). */
export function contentsPath(target: RepoRef, filePath: string, ref?: string): string {
  const parts = filePath.split('/').filter(Boolean)
  if (parts.some((p) => p === '.' || p === '..')) throw new GitHubError('invalid_path', 'Chemin invalide.', 400)
  const base = repoPath(target, 'contents', ...parts)
  return ref ? `${base}?ref=${seg(assertRef(ref))}` : base
}

/** /repos/{owner}/{repo}/compare/{base}...{head} */
export function comparePath(target: RepoRef, base: string, head: string): string {
  return `${repoPath(target)}/compare/${seg(assertRef(base))}...${seg(assertRef(head))}`
}

export type GitHubErrorCode =
  | 'invalid_repo'
  | 'invalid_ref'
  | 'invalid_path'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'conflict'
  | 'unprocessable'
  | 'network'
  | 'server'

export class GitHubError extends AccountingError {
  constructor(
    public githubCode: GitHubErrorCode,
    message: string,
    statusCode: number,
    /** HTTP status returned by GitHub (0 when unreachable). */
    public githubStatus = 0,
  ) {
    super(message, `GITHUB_${githubCode.toUpperCase()}`, statusCode)
    this.name = 'GitHubError'
  }
}

/** French label of the fine-grained permission GitHub says it expected. */
const PERMISSION_LABELS: Record<string, string> = {
  contents: 'Contents',
  pull_requests: 'Pull requests',
  actions: 'Actions',
  actions_variables: 'Variables',
  variables: 'Variables',
  workflows: 'Workflows',
  deployments: 'Deployments',
  metadata: 'Metadata',
}

function missingPermission(headers: Headers): string | null {
  // e.g. "contents=write; pull_requests=read"
  const accepted = headers.get('x-accepted-github-permissions')
  if (!accepted) return null
  const first = accepted.split(';')[0]?.trim().split(',')[0]?.trim()
  if (!first) return null
  const [name, level] = first.split('=')
  const label = PERMISSION_LABELS[name] ?? name
  return level ? `${label} (${level === 'write' ? 'lecture et écriture' : 'lecture'})` : label
}

/** Maps a GitHub HTTP error to a French message (never includes the token). */
export function errorFromResponse(status: number, headers: Headers, githubMessage?: string): GitHubError {
  if (status === 401) {
    return new GitHubError('unauthorized', 'Jeton GitHub refusé : il est invalide, expiré ou révoqué. Créez-en un nouveau.', 400, status)
  }
  if ((status === 403 || status === 429) && (headers.get('x-ratelimit-remaining') === '0' || headers.has('retry-after'))) {
    return new GitHubError('rate_limited', 'Limite de requêtes GitHub atteinte. Réessayez dans quelques minutes.', 429, status)
  }
  if (status === 403) {
    const permission = missingPermission(headers)
    return new GitHubError(
      'forbidden',
      permission
        ? `Le jeton GitHub n'a pas la permission nécessaire : ${permission}. Modifiez le jeton sur GitHub puis reconnectez-le.`
        : "GitHub refuse l'opération : vérifiez les permissions du jeton et les réglages du dépôt.",
      400,
      status,
    )
  }
  if (status === 404) {
    return new GitHubError(
      'not_found',
      "Ressource introuvable sur GitHub, ou le jeton n'a pas accès à ce dépôt.",
      400,
      status,
    )
  }
  if (status === 409) {
    return new GitHubError('conflict', 'GitHub signale un conflit : la branche a changé ou ne peut pas être fusionnée automatiquement.', 409, status)
  }
  if (status === 422) {
    const detail = githubMessage && githubMessage.length < 200 ? ` (${githubMessage})` : ''
    return new GitHubError('unprocessable', `GitHub a refusé la requête${detail}.`, 400, status)
  }
  return new GitHubError('server', 'GitHub ne répond pas correctement pour le moment. Réessayez plus tard.', 502, status)
}

export interface GitHubResponse<T> {
  status: number
  data: T
  headers: Headers
}

export interface GitHubRequestOptions {
  token?: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  /** Statuses returned as is instead of throwing (e.g. 404 for "absent"). */
  allow?: number[]
  timeoutMs?: number
}

/** The fetch used for GitHub calls; tests replace it with fixtures. */
let fetchImpl: typeof fetch = (...args) => fetch(...args)

export function setGitHubFetch(impl: typeof fetch | null): void {
  fetchImpl = impl ?? ((...args) => fetch(...args))
}

export async function githubRequest<T = unknown>(path: string, options: GitHubRequestOptions = {}): Promise<GitHubResponse<T>> {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new GitHubError('invalid_path', 'Chemin invalide.', 400)
  }
  const url = new URL(path, GITHUB_API)
  if (url.origin !== GITHUB_API) throw new GitHubError('invalid_path', 'Chemin invalide.', 400)

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'kledg-updates',
  }
  if (options.token) headers.Authorization = `Bearer ${options.token}`
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'

  let response: Response
  try {
    response = await fetchImpl(url.toString(), {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    })
  } catch {
    throw new GitHubError('network', 'GitHub est injoignable depuis le serveur. Réessayez plus tard.', 502, 0)
  }

  const text = await response.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }
  if (!response.ok && !(options.allow ?? []).includes(response.status)) {
    const message = data && typeof data === 'object' && 'message' in data ? String((data as { message: unknown }).message) : undefined
    throw errorFromResponse(response.status, response.headers, message)
  }
  return { status: response.status, data: data as T, headers: response.headers }
}

/** Expiry of a fine-grained token, from the header GitHub adds to authenticated responses. */
export function tokenExpiryFromHeaders(headers: Headers): Date | null {
  const value = headers.get('github-authentication-token-expiration')
  if (!value) return null
  // "2026-11-01 00:00:00 UTC" or "2026-11-01 00:00:00 +0200"
  const iso = value.trim().replace(' ', 'T').replace(/\s*UTC$/, 'Z').replace(/\s*([+-]\d{2})(\d{2})$/, '$1:$2')
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}
