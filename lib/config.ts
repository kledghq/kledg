/**
 * Instance configuration, resolved from environment variables.
 * See .env.example for the full list.
 */

export const APP_NAME = 'Kledg'
export const DOCS_URL = 'https://www.kledg.com/docs'
export const REPO_URL = 'https://github.com/kledghq/kledg'

type Env = Record<string, string | undefined>

/** A bare host name as hosts give it (no scheme, path, port or credentials). */
const HOSTNAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i
/** A Fly.io app name, which is also the first label of its fly.dev host. */
const FLY_APP = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

function httpsHost(host: string | undefined): string | null {
  const value = host?.trim()
  return value && HOSTNAME.test(value) ? `https://${value.toLowerCase()}` : null
}

/** The origin of an absolute http(s) URL set by a host, or null when it is anything else. */
function originOf(url: string | undefined): string | null {
  const value = url?.split(',')[0]?.trim()
  if (!value) return null
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    if (parsed.username || parsed.password) return null
    return parsed.origin
  } catch {
    return null
  }
}

/**
 * Default public URLs the host gives the instance, most specific first,
 * when BETTER_AUTH_URL is not set. Each comes from a variable the platform
 * sets on the deployment, never from a request:
 *
 * - Vercel: VERCEL_PROJECT_PRODUCTION_URL, then VERCEL_URL (host names).
 * - Railway: RAILWAY_PUBLIC_DOMAIN (host name, set once a public domain is
 *   generated for the service).
 * - Render: RENDER_EXTERNAL_URL (https://<service>.onrender.com).
 * - Fly.io: FLY_APP_NAME (the app answers on https://<app>.fly.dev).
 * - Coolify: COOLIFY_URL (the domains of the resource, comma separated).
 *
 * Clever Cloud exposes no domain variable: set BETTER_AUTH_URL there.
 */
function platformUrls(env: Env = process.env): string[] {
  const urls = [
    httpsHost(env.VERCEL_PROJECT_PRODUCTION_URL),
    httpsHost(env.VERCEL_URL),
    httpsHost(env.RAILWAY_PUBLIC_DOMAIN),
    env.RENDER_EXTERNAL_URL?.trim().startsWith('https://') ? originOf(env.RENDER_EXTERNAL_URL) : null,
    env.FLY_APP_NAME && FLY_APP.test(env.FLY_APP_NAME.trim()) ? `https://${env.FLY_APP_NAME.trim()}.fly.dev` : null,
    originOf(env.COOLIFY_URL),
  ]
  return [...new Set(urls.filter((url): url is string => Boolean(url)))]
}

/**
 * Public URL of this instance: BETTER_AUTH_URL (or NEXT_PUBLIC_APP_URL),
 * otherwise the default URL of the host (platformUrls), so a one-click
 * deploy works before a custom domain is configured.
 */
export function getAppUrl(env: Env = process.env): string {
  const explicit = env.BETTER_AUTH_URL || env.NEXT_PUBLIC_APP_URL
  if (explicit) return explicit.replace(/\/$/, '')
  return platformUrls(env)[0] ?? 'http://localhost:3000'
}

/** Public URL of the MCP endpoint, also the OAuth resource identifier for its tokens. */
export function getMcpResourceUrl(): string {
  return `${getAppUrl()}/api/mcp`
}

/**
 * Origins allowed to call the auth API: the instance URL, plus the URLs the
 * host serves the same deployment on (Vercel preview and branch URLs, the
 * onrender.com, fly.dev or Railway domain next to a custom domain).
 */
export function getTrustedOrigins(env: Env = process.env): string[] {
  const origins = new Set<string>([getAppUrl(env), ...platformUrls(env)])
  const branch = httpsHost(env.VERCEL_BRANCH_URL)
  if (branch) origins.add(branch)
  if (env.NODE_ENV !== 'production') origins.add('http://localhost:3000')
  return [...origins]
}
