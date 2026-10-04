/**
 * Version of the running instance, without any token: package.json version,
 * deployed commit and build date.
 *
 * - The host is detected from its own variables (lib/updates/hosting.ts).
 * - The commit comes from the host when it deploys from a repository:
 *   VERCEL_GIT_COMMIT_SHA, RAILWAY_GIT_COMMIT_SHA, RENDER_GIT_COMMIT,
 *   CC_COMMIT_ID (Clever Cloud), SOURCE_COMMIT (Coolify, when "Include
 *   Source Commit in Build" is on). Otherwise from KLEDG_COMMIT, baked into
 *   the Docker image at build time (build argument, see Dockerfile; Fly.io:
 *   `fly deploy --build-arg KLEDG_COMMIT=...`).
 * - The GitHub repository the host deploys from: VERCEL_GIT_REPO_OWNER and
 *   VERCEL_GIT_REPO_SLUG, RAILWAY_GIT_REPO_OWNER and RAILWAY_GIT_REPO_NAME,
 *   RENDER_GIT_REPO_SLUG (owner/name).
 * - KLEDG_VERSION is baked into the Docker image; KLEDG_BUILD_DATE is
 *   inlined by next.config.ts at build time.
 */

import pkg from '@/package.json'
import { isValidOwner, isValidRepo, type RepoRef } from './github'
import { deploysFromGitHub, detectPlatform, type Platform } from './hosting'

export type { Platform }

export interface DeployedVersion {
  version: string
  commit: string | null
  branch: string | null
  /** The GitHub repository the host deploys from, when it says so (null elsewhere). */
  repository: RepoRef | null
  buildDate: string | null
  platform: Platform
  /** Merging on GitHub redeploys the instance: the one-click update is offered (lib/updates/hosting.ts). */
  deploysFromGitHub: boolean
}

const SHA_PATTERN = /^[0-9a-f]{7,40}$/i

type Env = Record<string, string | undefined>

function firstSha(...values: Array<string | undefined>): string | null {
  for (const value of values) {
    const raw = value?.trim()
    if (raw && SHA_PATTERN.test(raw)) return raw.toLowerCase()
  }
  return null
}

function repoRef(owner: string | undefined, repo: string | undefined): RepoRef | null {
  return owner && repo && isValidOwner(owner) && isValidRepo(repo) ? { owner, repo } : null
}

function deployedRepository(env: Env, platform: Platform): RepoRef | null {
  if (platform === 'vercel') {
    if (env.VERCEL_GIT_PROVIDER && env.VERCEL_GIT_PROVIDER !== 'github') return null
    return repoRef(env.VERCEL_GIT_REPO_OWNER, env.VERCEL_GIT_REPO_SLUG)
  }
  // Railway deploys from GitHub only.
  if (platform === 'railway') return repoRef(env.RAILWAY_GIT_REPO_OWNER, env.RAILWAY_GIT_REPO_NAME)
  if (platform === 'render') {
    // Render does not name the provider: a GitLab or Bitbucket slug is
    // refused later, when the token is checked against GitHub.
    const [owner, repo, ...rest] = (env.RENDER_GIT_REPO_SLUG ?? '').split('/')
    return rest.length ? null : repoRef(owner, repo)
  }
  return null
}

export function getDeployedVersion(env: Env = process.env): DeployedVersion {
  const platform = detectPlatform(env)
  const commit = firstSha(
    env.VERCEL_GIT_COMMIT_SHA,
    env.RAILWAY_GIT_COMMIT_SHA,
    env.RENDER_GIT_COMMIT,
    env.CC_COMMIT_ID,
    env.SOURCE_COMMIT,
    env.KLEDG_COMMIT,
  )
  const rawVersion = env.KLEDG_VERSION || pkg.version
  const version = parseVersion(rawVersion) ? rawVersion.replace(/^v/, '') : pkg.version

  return {
    version,
    commit,
    branch: env.VERCEL_GIT_COMMIT_REF || env.RAILWAY_GIT_BRANCH || env.RENDER_GIT_BRANCH || env.COOLIFY_BRANCH || null,
    repository: deployedRepository(env, platform),
    // Literal process.env access: next.config.ts inlines it at build time.
    buildDate: env.KLEDG_BUILD_DATE || (env === process.env ? process.env.KLEDG_BUILD_DATE : undefined) || null,
    platform,
    deploysFromGitHub: deploysFromGitHub(platform, env),
  }
}

export interface ParsedVersion {
  major: number
  minor: number
  patch: number
  prerelease: string[]
}

const SEMVER =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

/** Parses "1.2.3", "v1.2.3-beta.1" or "1.2.3+build"; null when not semver. */
export function parseVersion(value: string | null | undefined): ParsedVersion | null {
  if (!value) return null
  const match = SEMVER.exec(value.trim())
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  }
}

function compareIdentifiers(a: string, b: string): number {
  const an = /^\d+$/.test(a)
  const bn = /^\d+$/.test(b)
  if (an && bn) return Math.sign(Number(a) - Number(b))
  if (an) return -1
  if (bn) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Semantic versioning precedence (semver.org, section 11): -1, 0 or 1.
 * A pre-release is lower than its release (1.0.0-rc.1 < 1.0.0); build
 * metadata is ignored. Unparseable versions sort first.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return pa ? 1 : pb ? -1 : 0
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (pa[key] !== pb[key]) return Math.sign(pa[key] - pb[key])
  }
  if (!pa.prerelease.length && !pb.prerelease.length) return 0
  if (!pa.prerelease.length) return 1
  if (!pb.prerelease.length) return -1
  const length = Math.max(pa.prerelease.length, pb.prerelease.length)
  for (let i = 0; i < length; i++) {
    if (pa.prerelease[i] === undefined) return -1
    if (pb.prerelease[i] === undefined) return 1
    const c = compareIdentifiers(pa.prerelease[i], pb.prerelease[i])
    if (c !== 0) return c
  }
  return 0
}

export function isPrerelease(version: string): boolean {
  return (parseVersion(version)?.prerelease.length ?? 0) > 0
}
