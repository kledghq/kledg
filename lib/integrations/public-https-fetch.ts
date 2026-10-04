/**
 * HTTPS GET to a host on the public internet only, for URLs taken from a
 * provider payload (the files Qonto links to).
 *
 * Invariant: the connection is only opened to an address checked as public.
 * The check runs in the `lookup` of the socket, so the address validated is
 * the address connected to: a host name that resolves to a public address
 * when checked and to 127.0.0.1 or 169.254.169.254 a moment later (DNS
 * rebinding) is refused, which a dns.lookup before fetch() could not
 * guarantee. node:https is used rather than fetch() because fetch only
 * accepts a custom resolver through an undici dispatcher, which would mean a
 * new dependency; here it takes a few lines of the platform. Redirects are
 * never followed (a 3xx is returned as is and the caller refuses it).
 */

import { request } from 'node:https'
import { BlockList, isIP, type LookupFunction } from 'node:net'
import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import { Readable } from 'node:stream'
import { logger } from '@/lib/logger'

/**
 * Addresses Kledg never connects to for a provider URL: loopback, private
 * (RFC 1918, unique local), link-local (cloud metadata 169.254.169.254),
 * carrier-grade NAT, "this network", documentation, benchmarking, multicast
 * and reserved ranges (IANA special-purpose registries).
 */
const BLOCKED = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  BLOCKED.addSubnet(network, prefix, 'ipv4')
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96], // NAT64: embeds an IPv4 address
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23], // IETF protocol assignments (Teredo, ORCHID...)
  ['2001:db8::', 32],
  ['2002::', 16], // 6to4: embeds an IPv4 address
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) {
  BLOCKED.addSubnet(network, prefix, 'ipv6')
}

/** The eight 16-bit groups of a valid IPv6 literal (a trailing dotted IPv4 becomes two groups). */
function ipv6Groups(address: string): number[] {
  let text = address
  const dotted = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text)
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number)
    text = text.slice(0, dotted.index) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16)
  }
  const [head, tail] = text.includes('::') ? text.split('::') : [text, null]
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const missing = 8 - left.length - right.length
  const groups = tail === null ? left : [...left, ...Array<string>(missing).fill('0'), ...right]
  return groups.map((group) => parseInt(group, 16))
}

/**
 * The IPv4 address carried by an IPv4-mapped (::ffff:a.b.c.d, in dotted or
 * hexadecimal form) or IPv4-compatible (::a.b.c.d) IPv6 address, else null:
 * such an address reaches the IPv4 host, so the IPv4 ranges apply.
 */
function embeddedIpv4(address: string): string | null {
  const groups = ipv6Groups(address)
  if (groups.length !== 8 || groups.slice(0, 5).some((group) => group !== 0)) return null
  if (groups[5] !== 0xffff && groups[5] !== 0) return null
  // :: and ::1 are IPv6 addresses of their own, covered by the IPv6 list
  if (groups[5] === 0 && groups[6] === 0) return null
  return [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255].join('.')
}

/** Whether `address` (an IP literal) is a public unicast address Kledg may connect to. */
export function isPublicAddress(address: string): boolean {
  const unbracketed = address.replace(/^\[|\]$/g, '').replace(/%.*$/, '')
  const family = isIP(unbracketed)
  if (family === 4) return !BLOCKED.check(unbracketed, 'ipv4')
  if (family !== 6) return false
  const v4 = embeddedIpv4(unbracketed)
  if (v4 !== null) return isIP(v4) === 4 && !BLOCKED.check(v4, 'ipv4')
  return !BLOCKED.check(unbracketed, 'ipv6')
}

export class BlockedAddressError extends Error {
  constructor(host: string) {
    super(`Refused to connect to ${host}: it resolves to a non-public address`)
    this.name = 'BlockedAddressError'
  }
}

type Resolver = (hostname: string, options: { all: true; family?: number }, callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void) => void

const systemResolver: Resolver = (hostname, options, callback) => dnsLookup(hostname, options, callback)

/**
 * A socket `lookup` that resolves every address of the host and refuses the
 * connection when any of them is not public (a host mixing public and
 * private records is treated as hostile).
 */
export function publicOnlyLookup(resolve: Resolver = systemResolver): LookupFunction {
  return (hostname, options, callback) => {
    const family = typeof options.family === 'number' ? options.family : undefined
    resolve(hostname, { all: true, family }, (error, addresses) => {
      if (error) return callback(error, '', 0)
      if (addresses.length === 0 || addresses.some((entry) => !isPublicAddress(entry.address))) {
        logger.error('[Network] Refused a provider host resolving to a non-public address', { host: hostname })
        return callback(new BlockedAddressError(hostname), '', 0)
      }
      if (options.all) {
        ;(callback as unknown as (error: null, addresses: LookupAddress[]) => void)(null, addresses)
      } else {
        callback(null, addresses[0].address, addresses[0].family)
      }
    })
  }
}

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304])

/**
 * GET `url` over https, connecting only to public addresses (see the module
 * header), as a fetch Response whose body is streamed. `init.signal` aborts
 * the request; other init fields but headers are ignored.
 */
export function publicHttpsFetch(url: string, init: RequestInit = {}, lookup: LookupFunction = publicOnlyLookup()): Promise<Response> {
  const target = new URL(url)
  if (target.protocol !== 'https:') return Promise.reject(new TypeError('Only https URLs are fetched'))
  if (isIP(target.hostname.replace(/^\[|\]$/g, '')) && !isPublicAddress(target.hostname)) {
    return Promise.reject(new BlockedAddressError(target.hostname))
  }
  const headers = Object.fromEntries(new Headers(init.headers).entries())
  return new Promise((resolve, reject) => {
    const req = request(target, { method: 'GET', headers, lookup, signal: init.signal ?? undefined }, (res) => {
      const status = res.statusCode ?? 502
      const responseHeaders = new Headers()
      for (const [name, value] of Object.entries(res.headers)) {
        if (value === undefined) continue
        for (const item of Array.isArray(value) ? value : [value]) responseHeaders.append(name, item)
      }
      if (NULL_BODY_STATUSES.has(status)) {
        res.resume()
        resolve(new Response(null, { status, headers: responseHeaders }))
        return
      }
      const body = Readable.toWeb(res) as ReadableStream<Uint8Array>
      resolve(new Response(body, { status, headers: responseHeaders }))
    })
    req.on('error', reject)
    req.end()
  })
}

/** publicHttpsFetch with the signature of fetch, for code that takes an injectable fetch. */
export const publicFetch: typeof fetch = (input, init) =>
  publicHttpsFetch(input instanceof Request ? input.url : String(input), init)
