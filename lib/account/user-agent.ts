/**
 * Short French description of a browser from its User-Agent ("Chrome sur
 * macOS"), for the list of active sessions. Pure; no dependency: the list
 * only needs to help users recognise their own devices.
 */

const BROWSERS: Array<[RegExp, string]> = [
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/CriOS\/|Chrome\//, 'Chrome'],
  [/Version\/[\d.]+.*Safari\//, 'Safari'],
]

const SYSTEMS: Array<[RegExp, string]> = [
  [/iPhone/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Android/, 'Android'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
]

const CLIENTS: Array<[RegExp, string]> = [
  [/^node|undici|node-fetch/i, 'Application (Node.js)'],
  [/^curl\//i, 'curl'],
  [/python/i, 'Script Python'],
]

export function describeUserAgent(userAgent: string | null | undefined): string {
  const ua = userAgent?.trim()
  if (!ua) return 'Appareil inconnu'
  for (const [pattern, label] of CLIENTS) if (pattern.test(ua)) return label
  const browser = BROWSERS.find(([pattern]) => pattern.test(ua))?.[1]
  const system = SYSTEMS.find(([pattern]) => pattern.test(ua))?.[1]
  if (browser && system) return `${browser} sur ${system}`
  return browser ?? system ?? 'Navigateur inconnu'
}
