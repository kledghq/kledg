/**
 * GitHub connection of the instance: a fine-grained personal access token
 * limited to the instance's own repository, validated, stored encrypted and
 * never returned to the browser (only its last 4 characters and its expiry).
 */

import { prisma } from '@/lib/prisma'
import { encrypt, decrypt } from '@/lib/integrations/encryption'
import { getEncryptionKey } from '@/lib/crypto/encryption-key'
import { ValidationError } from '@/lib/accounting/errors'
import {
  contentsPath,
  githubRequest,
  GitHubError,
  repoPath,
  tokenExpiryFromHeaders,
  UPSTREAM,
  type RepoRef,
} from './github'

/** Fine-grained tokens only: classic tokens cannot be limited to one repository. */
const TOKEN_PATTERN = /^github_pat_[A-Za-z0-9_]{20,250}$/

/** Days before expiry from which the page warns. */
const EXPIRY_WARNING_DAYS = 14

export type RepoKind = 'fork' | 'copy'

export interface PermissionCheck {
  key: 'contents' | 'pull_requests' | 'actions' | 'variables' | 'deployments'
  label: string
  required: boolean
  ok: boolean
}

export interface TokenValidation {
  repository: RepoRef
  kind: RepoKind
  defaultBranch: string
  expiresAt: Date | null
  checks: PermissionCheck[]
}

interface GitHubRepo {
  full_name: string
  fork: boolean
  default_branch: string
  parent?: { full_name: string }
  source?: { full_name: string }
}

const UPSTREAM_NAME = `${UPSTREAM.owner}/${UPSTREAM.repo}`

/** A fork of kledghq/kledg (directly or through another fork), or a copy. */
export function repoKind(repo: Pick<GitHubRepo, 'fork' | 'parent' | 'source'>): RepoKind | 'other-fork' {
  if (!repo.fork) return 'copy'
  const names = [repo.parent?.full_name, repo.source?.full_name].map((n) => n?.toLowerCase())
  return names.includes(UPSTREAM_NAME) ? 'fork' : 'other-fork'
}

function decodeJsonFile(content: unknown): Record<string, unknown> | null {
  if (!content || typeof content !== 'object' || !('content' in content)) return null
  try {
    return JSON.parse(Buffer.from(String((content as { content: string }).content), 'base64').toString('utf8'))
  } catch {
    return null
  }
}

/**
 * Checks the token against the repository: access, kind (fork or copy), that
 * the repository holds Kledg, and the read side of each permission (GitHub
 * offers no way to test write access without writing; a missing write
 * permission is reported by the first action that needs it).
 */
export async function validateToken(token: string, target: RepoRef): Promise<TokenValidation> {
  if (!TOKEN_PATTERN.test(token)) {
    throw new ValidationError(
      "Ce jeton n'est pas un jeton GitHub « fine-grained » (il commence par github_pat_). Créez-en un avec le lien proposé.",
    )
  }

  let repoResponse
  try {
    repoResponse = await githubRequest<GitHubRepo>(repoPath(target), { token })
  } catch (error) {
    if (error instanceof GitHubError && error.githubCode === 'not_found') {
      throw new ValidationError(
        `Le jeton n'a pas accès au dépôt ${target.owner}/${target.repo}. Sur GitHub, dans « Repository access », choisissez « Only select repositories » puis ce dépôt.`,
      )
    }
    throw error
  }
  const repo = repoResponse.data
  const kind = repoKind(repo)
  if (kind === 'other-fork') {
    throw new ValidationError("Ce dépôt est un fork d'un autre projet que kledghq/kledg.")
  }

  const probe = async (path: string): Promise<boolean> => {
    try {
      await githubRequest(path, { token })
      return true
    } catch (error) {
      if (error instanceof GitHubError && (error.githubCode === 'forbidden' || error.githubCode === 'not_found')) return false
      throw error
    }
  }

  // Contents: read package.json, which also confirms the repository holds Kledg.
  let contentsOk = true
  let isKledg = kind === 'fork'
  try {
    const pkg = await githubRequest(contentsPath(target, 'package.json', repo.default_branch), { token })
    isKledg = isKledg || decodeJsonFile(pkg.data)?.name === 'kledg'
  } catch (error) {
    if (!(error instanceof GitHubError) || !['forbidden', 'not_found'].includes(error.githubCode)) throw error
    contentsOk = false
  }
  if (contentsOk && !isKledg) {
    throw new ValidationError("Ce dépôt ne contient pas Kledg (package.json). Vérifiez le dépôt choisi.")
  }

  const checks: PermissionCheck[] = [
    { key: 'contents', label: 'Contents', required: true, ok: contentsOk },
    { key: 'pull_requests', label: 'Pull requests', required: true, ok: await probe(`${repoPath(target, 'pulls')}?per_page=1`) },
    { key: 'actions', label: 'Actions', required: true, ok: await probe(`${repoPath(target, 'actions', 'workflows')}?per_page=1`) },
    { key: 'variables', label: 'Variables', required: false, ok: await probe(`${repoPath(target, 'actions', 'variables')}?per_page=1`) },
    { key: 'deployments', label: 'Deployments', required: false, ok: await probe(`${repoPath(target, 'deployments')}?per_page=1`) },
  ]
  const missing = checks.filter((c) => c.required && !c.ok)
  if (missing.length) {
    throw new ValidationError(
      `Permissions manquantes sur le jeton : ${missing.map((c) => c.label).join(', ')}. Modifiez le jeton sur GitHub (Repository permissions) puis réessayez.`,
    )
  }

  return {
    repository: { owner: target.owner, repo: target.repo },
    kind,
    defaultBranch: repo.default_branch,
    expiresAt: tokenExpiryFromHeaders(repoResponse.headers),
    checks,
  }
}

function requireKey(): string {
  const key = getEncryptionKey()
  if (!key) throw new ValidationError("Clé de chiffrement absente : définissez BETTER_AUTH_SECRET ou ENCRYPTION_KEY.")
  return key
}

export async function saveConnection(token: string, validation: TokenValidation, userId: string): Promise<void> {
  const data = {
    owner: validation.repository.owner,
    repo: validation.repository.repo,
    tokenEncrypted: encrypt(token, requireKey()),
    tokenLast4: token.slice(-4),
    tokenExpiresAt: validation.expiresAt,
    isFork: validation.kind === 'fork',
    defaultBranch: validation.defaultBranch,
    connectedById: userId,
  }
  await prisma.updateConnection.upsert({ where: { id: 'default' }, create: { id: 'default', ...data }, update: data })
}

export async function deleteConnection(): Promise<boolean> {
  const { count } = await prisma.updateConnection.deleteMany({ where: { id: 'default' } })
  return count > 0
}

/** What the browser may see about the connection. */
export interface ConnectionSummary {
  owner: string
  repo: string
  kind: RepoKind
  defaultBranch: string
  tokenLast4: string
  tokenExpiresAt: string | null
  expired: boolean
  expiresSoon: boolean
  connectedAt: string
}

export function summarize(
  row: { owner: string; repo: string; isFork: boolean; defaultBranch: string; tokenLast4: string; tokenExpiresAt: Date | null; createdAt: Date; updatedAt: Date },
  now = new Date(),
): ConnectionSummary {
  const expiresAt = row.tokenExpiresAt
  const msLeft = expiresAt ? expiresAt.getTime() - now.getTime() : Infinity
  return {
    owner: row.owner,
    repo: row.repo,
    kind: row.isFork ? 'fork' : 'copy',
    defaultBranch: row.defaultBranch,
    tokenLast4: row.tokenLast4,
    tokenExpiresAt: expiresAt ? expiresAt.toISOString() : null,
    expired: msLeft <= 0,
    expiresSoon: msLeft > 0 && msLeft <= EXPIRY_WARNING_DAYS * 24 * 3600 * 1000,
    connectedAt: row.updatedAt.toISOString(),
  }
}

export async function getConnectionSummary(): Promise<ConnectionSummary | null> {
  const row = await prisma.updateConnection.findUnique({ where: { id: 'default' } })
  return row ? summarize(row) : null
}

export interface ActiveConnection {
  repository: RepoRef
  kind: RepoKind
  defaultBranch: string
  token: string
}

/** The stored connection with its decrypted token, for server-side GitHub calls only. */
export async function loadConnection(): Promise<ActiveConnection> {
  const row = await prisma.updateConnection.findUnique({ where: { id: 'default' } })
  if (!row) throw new ValidationError("Aucun dépôt GitHub connecté. Connectez votre dépôt d'abord.")
  let token: string
  try {
    token = decrypt(row.tokenEncrypted, requireKey())
  } catch (error) {
    if (error instanceof ValidationError) throw error
    throw new ValidationError('Le jeton enregistré est illisible (clé de chiffrement modifiée). Reconnectez GitHub.')
  }
  return {
    repository: { owner: row.owner, repo: row.repo },
    kind: row.isFork ? 'fork' : 'copy',
    defaultBranch: row.defaultBranch,
    token,
  }
}
