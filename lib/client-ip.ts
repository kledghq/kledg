/**
 * The one way Kledg reads the client IP (rate limits, Better Auth, audit
 * entries, bank provider calls). Proxy headers are client input unless a
 * proxy the operator configured rewrites them, so they are trusted only by
 * configuration:
 *
 * - RATE_LIMIT_IP_HEADER: the header the operator's proxy sets (for example
 *   CF-Connecting-IP); one address expected.
 * - On Vercel (VERCEL set by the platform): x-vercel-forwarded-for, written
 *   by Vercel's edge and not forgeable, then x-real-ip.
 * - TRUST_PROXY_HOPS=N: Kledg runs behind N reverse proxies that each append
 *   the address they saw to X-Forwarded-For. The client is the N-th address
 *   from the right; anything to its left was sent by the client. A request
 *   with fewer addresses did not go through the proxies and gets none.
 * - Otherwise: no address. Next.js does not expose the socket address to
 *   route handlers (it copies it into X-Forwarded-For only when the client
 *   sent none, so that header is forgeable on a direct connection). Callers
 *   then share one bucket (CLIENT_IP_UNKNOWN), like Better Auth does: rate
 *   limits still stop a guessing run, at the price of being shared by all
 *   clients until a proxy is configured.
 */

import { isIP } from 'node:net'
import { logger } from '@/lib/logger'

type Env = Record<string, string | undefined>

/** Request header carrying the resolved client IP to Better Auth (set by app/api/auth and proxy.ts, never trusted from the client). */
export const CLIENT_IP_HEADER = 'x-kledg-client-ip'

/** Rate limit subject when no trusted address is known. */
export const CLIENT_IP_UNKNOWN = 'no-trusted-ip'

const MAX_HOPS = 10

function single(value: string | null): string | null {
  const ip = value?.trim()
  return ip && !ip.includes(',') && isIP(ip) ? ip : null
}

/** Number of trusted reverse proxies (TRUST_PROXY_HOPS), or null when unset or invalid. */
function trustProxyHops(env: Env = process.env): number | null {
  const raw = env.TRUST_PROXY_HOPS?.trim()
  if (!raw || !/^\d+$/.test(raw)) return null
  const hops = Number(raw)
  return hops >= 1 && hops <= MAX_HOPS ? hops : null
}

/** Whether the deployment tells Kledg how to read the client IP. */
function clientIpConfigured(env: Env = process.env): boolean {
  return Boolean(env.RATE_LIMIT_IP_HEADER?.trim() || env.VERCEL || trustProxyHops(env))
}

/** The client IP the configuration vouches for, or null (see the module header). */
export function resolveClientIp(headers: Headers, env: Env = process.env): string | null {
  const custom = env.RATE_LIMIT_IP_HEADER?.trim().toLowerCase()
  if (custom) return single(headers.get(custom))

  if (env.VERCEL) {
    const forwarded = headers.get('x-vercel-forwarded-for')?.split(',')[0] ?? null
    return single(forwarded) ?? single(headers.get('x-real-ip'))
  }

  const hops = trustProxyHops(env)
  if (hops) {
    const chain = (headers.get('x-forwarded-for') ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
    if (chain.length < hops) return null
    return single(chain[chain.length - hops])
  }

  return null
}

/** The 8 groups of an IPv6 address as numbers, or null (isIP said it is one). */
function ipv6Groups(ip: string): number[] | null {
  let address = ip.split('%')[0].toLowerCase()
  // An embedded IPv4 tail (::ffff:192.0.2.1) counts as its two groups.
  const v4 = address.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number)
    address = `${address.slice(0, v4.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }
  const [head, tail] = address.split('::')
  const left = head ? head.split(':') : []
  const right = tail !== undefined && tail ? tail.split(':') : []
  const missing = 8 - left.length - right.length
  if (missing < 0 || (tail === undefined && missing !== 0)) return null
  const groups = [...left, ...Array<string>(missing).fill('0'), ...right].map((group) => Number.parseInt(group, 16))
  return groups.length === 8 && groups.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff) ? groups : null
}

/**
 * The rate limit subject of an address. One IPv6 subscriber holds a whole
 * /64 (2^64 addresses), so IPv6 addresses count per /64 prefix
 * ("2001:db8:1:2::/64"); an IPv4-mapped address counts as its IPv4 address.
 */
export function rateLimitIpSubject(ip: string): string {
  if (isIP(ip) !== 6) return ip
  const groups = ipv6Groups(ip)
  if (!groups) return ip
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join('.')
  }
  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(':')}::/64`
}

let warned = false

/**
 * The rate limit subject of the client: its IP (an IPv6 address by its /64
 * prefix, rateLimitIpSubject), or the shared CLIENT_IP_UNKNOWN subject.
 */
export function clientIpOrUnknown(headers: Headers, env: Env = process.env): string {
  const ip = resolveClientIp(headers, env)
  if (!ip && !warned && !clientIpConfigured(env) && env.NODE_ENV === 'production') {
    warned = true
    logger.warn(
      'No trusted client IP: rate limits are shared by all clients. Behind a reverse proxy, set TRUST_PROXY_HOPS (docs/configuration.md).',
    )
  }
  return ip ? rateLimitIpSubject(ip) : CLIENT_IP_UNKNOWN
}

/**
 * Headers with CLIENT_IP_HEADER set from the raw request: any value sent by
 * the client is replaced (or removed when no address is trusted).
 */
export function withResolvedClientIp(headers: Headers, env: Env = process.env): Headers {
  const next = new Headers(headers)
  next.delete(CLIENT_IP_HEADER)
  const ip = resolveClientIp(headers, env)
  if (ip) next.set(CLIENT_IP_HEADER, ip)
  return next
}
