/**
 * How the consent page presents the client asking for access: its name and,
 * for clients vouched for by a domain (CIMD), its logo. Pure helpers.
 */

import type { AssistantKind } from './use-assistant-connections'

const KNOWN_NAMES: Partial<Record<AssistantKind, string>> = {
  claude: 'Claude',
  chatgpt: 'ChatGPT',
  'claude-code': 'Claude Code',
}

/** Shown instead of the name an unverified client declares. */
export const UNVERIFIED_CLIENT_NAME = 'Application non vérifiée'

/**
 * Name shown as the client's identity: a verified assistant (Claude,
 * ChatGPT, Claude Code: a metadata document on their own origin), the name
 * declared by a client identified by its own domain (CIMD, `identifiedBy`),
 * or "Application non vérifiée": the name a dynamically registered client
 * declares is chosen by whoever registered it, so it is never presented as
 * its identity (the consent page shows it apart, as declared).
 */
export function clientDisplayName(clientName: string | undefined, kind: AssistantKind, identifiedBy: string | null = null): string {
  if (kind !== 'other') return KNOWN_NAMES[kind] ?? UNVERIFIED_CLIENT_NAME
  if (identifiedBy) return clientName?.trim() || identifiedBy
  return UNVERIFIED_CLIENT_NAME
}

/**
 * A remote logo is shown only for an unknown client identified by a metadata
 * document (CIMD), whose domain vouches for it, and only as an https raster
 * image: no SVG, no data or http URL. Known assistants get Kledg's own marks.
 */
export function safeLogoUri(logoUri: string | undefined, identifiedBy: string | null): string | null {
  if (!logoUri || !identifiedBy) return null
  try {
    const url = new URL(logoUri)
    if (url.protocol !== 'https:' || url.username || url.password) return null
    if (/\.svgz?$/i.test(url.pathname)) return null
    return url.toString()
  } catch {
    return null
  }
}
