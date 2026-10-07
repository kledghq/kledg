/**
 * Kledg releases and their database migrations, from the public GitHub API
 * (unauthenticated, cached for an hour per server instance).
 */

import { contentsPath, githubRequest, GitHubError, repoPath, UPSTREAM } from './github'
import { compareVersions, isPrerelease, parseVersion } from './version'

export interface Release {
  tag: string
  version: string
  name: string
  body: string
  url: string
  publishedAt: string | null
  prerelease: boolean
}

export type Fetched<T> =
  | { status: 'ok'; data: T }
  /** GitHub could not be reached, rate-limited us, or the repository is not public. */
  | { status: 'unavailable'; message: string }

const HOUR = 60 * 60 * 1000
const FAILURE_TTL = 5 * 60 * 1000

const cache = new Map<string, { expires: number; value: Fetched<unknown> }>()

export function clearReleaseCache(): void {
  cache.clear()
}

async function cached<T>(key: string, load: () => Promise<T>): Promise<Fetched<T>> {
  const hit = cache.get(key)
  if (hit && hit.expires > Date.now()) return hit.value as Fetched<T>
  let value: Fetched<T>
  let ttl = HOUR
  try {
    value = { status: 'ok', data: await load() }
  } catch (error) {
    ttl = FAILURE_TTL
    value = {
      status: 'unavailable',
      message:
        error instanceof GitHubError && error.githubCode === 'rate_limited'
          ? error.message
          : error instanceof GitHubError && error.githubCode === 'not_found'
            ? "Les versions de Kledg ne sont pas consultables pour le moment (dépôt non public)."
            : 'Impossible de consulter les versions de Kledg sur GitHub pour le moment.',
    }
  }
  cache.set(key, { expires: Date.now() + ttl, value })
  return value
}

interface GitHubRelease {
  tag_name: string
  name: string | null
  body: string | null
  html_url: string
  published_at: string | null
  draft: boolean
  prerelease: boolean
}

function toRelease(r: GitHubRelease): Release | null {
  if (r.draft || !parseVersion(r.tag_name)) return null
  return {
    tag: r.tag_name,
    version: r.tag_name.replace(/^v/, ''),
    name: r.name || `Kledg ${r.tag_name}`,
    body: (r.body ?? '').slice(0, 20_000),
    url: r.html_url.startsWith('https://github.com/') ? r.html_url : `https://github.com/${UPSTREAM.owner}/${UPSTREAM.repo}/releases`,
    publishedAt: r.published_at,
    prerelease: r.prerelease || isPrerelease(r.tag_name),
  }
}

/** Published releases of kledghq/kledg, newest version first. */
export function fetchReleases(): Promise<Fetched<Release[]>> {
  return cached('releases', async () => {
    const { data } = await githubRequest<GitHubRelease[]>(`${repoPath(UPSTREAM, 'releases')}?per_page=50`)
    return (Array.isArray(data) ? data : [])
      .map(toRelease)
      .filter((r): r is Release => r !== null)
      .sort((a, b) => compareVersions(b.version, a.version))
  })
}

/**
 * The release to offer: the highest version, ignoring pre-releases unless
 * the instance already runs a pre-release. Null when nothing is published.
 */
export function latestRelease(releases: Release[], currentVersion: string): Release | null {
  const allowPre = isPrerelease(currentVersion)
  return releases.find((r) => allowPre || !r.prerelease) ?? null
}

/** Releases newer than the current version, up to and including `target`, newest first. */
export function releasesSince(releases: Release[], currentVersion: string, target: Release | null): Release[] {
  if (!target) return []
  return releases
    .filter((r) => compareVersions(r.version, currentVersion) > 0 && compareVersions(r.version, target.version) <= 0)
    .filter((r) => !r.prerelease || r.tag === target.tag || isPrerelease(currentVersion))
    .sort((a, b) => compareVersions(b.version, a.version))
}

export type UpdateState = 'up-to-date' | 'available' | 'ahead' | 'unknown'

export function updateState(currentVersion: string, latest: Release | null): UpdateState {
  if (!latest) return 'unknown'
  const c = compareVersions(latest.version, currentVersion)
  return c > 0 ? 'available' : c === 0 ? 'up-to-date' : 'ahead'
}

const MIGRATION_NAME = /^[0-9]{14}_[A-Za-z0-9_]+$/

/** Migration folder names of kledghq/kledg at a ref (tag), sorted. */
export function fetchUpstreamMigrations(ref: string): Promise<Fetched<string[]>> {
  return cached(`migrations:${ref}`, async () => {
    const { data } = await githubRequest<Array<{ name: string; type: string }>>(contentsPath(UPSTREAM, 'prisma/migrations', ref))
    return (Array.isArray(data) ? data : [])
      .filter((e) => e.type === 'dir' && MIGRATION_NAME.test(e.name))
      .map((e) => e.name)
      .sort()
  })
}

/** Migrations present in `target` but not yet applied (or not in the current version), sorted. */
export function diffMigrations(target: string[], current: string[]): string[] {
  const known = new Set(current)
  return target.filter((name) => !known.has(name)).sort()
}

/** Migration names added by a list of changed files (pull request or compare). */
export function migrationsFromFiles(files: Array<{ filename: string; status: string }>): string[] {
  const names = new Set<string>()
  for (const f of files) {
    const match = /^prisma\/migrations\/([^/]+)\/migration\.sql$/.exec(f.filename)
    if (match && f.status === 'added' && MIGRATION_NAME.test(match[1])) names.add(match[1])
  }
  return [...names].sort()
}
