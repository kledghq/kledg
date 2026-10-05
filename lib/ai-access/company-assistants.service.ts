/**
 * The AI assistants a user has connected to one company, for the "Proposer
 * avec l'IA" button (components/features/ai-assist): shown only when one
 * exists, and opening the assistant the user actually uses.
 *
 * A connection counts when its grant reaches the company (every company or
 * the company in its list) and it is still usable:
 * - an assistant authorized through OAuth: the user's consent is still there
 *   (revoking it on the "Assistants IA" page deletes it) and the client is
 *   not disabled; Claude or ChatGPT only for a verified client id
 *   (lib/ai-access/assistant-kind.ts), anything else is 'other';
 * - an API key of the user (Claude Code, Claude Desktop, a script): enabled
 *   and not expired; which app uses it is unknown, so it is 'other'.
 *
 * Fail closed like the MCP server: a connection without a grant reaches no
 * company. Read only; nothing secret leaves this module (kinds only).
 */

import { prisma } from '@/lib/prisma'
import { ASSISTANT_APP_ORDER, type AssistantApp } from '@/lib/ai-assist/apps'
import { assistantKind } from './assistant-kind'

/** The apps of `userId`'s usable connections that reach `companyId`, Claude first, without duplicates. */
export async function companyAssistants(userId: string, companyId: string, now: Date = new Date()): Promise<AssistantApp[]> {
  const grants = await prisma.aiAccessGrant.findMany({
    where: { userId, OR: [{ allCompanies: true }, { companies: { some: { companyId } } }] },
    select: {
      clientId: true,
      client: { select: { disabled: true } },
      apiKey: { select: { referenceId: true, enabled: true, expiresAt: true } },
    },
    take: 100,
  })
  const clientIds = grants.flatMap((g) => (g.clientId && g.client && !g.client.disabled ? [g.clientId] : []))
  const consented = clientIds.length
    ? new Set((await prisma.oauthConsent.findMany({ where: { userId, clientId: { in: clientIds } }, select: { clientId: true }, take: 100 })).map((c) => c.clientId))
    : new Set<string>()

  const apps = new Set<AssistantApp>()
  for (const grant of grants) {
    if (grant.clientId && consented.has(grant.clientId)) {
      const kind = assistantKind(grant.clientId)
      apps.add(kind === 'claude' || kind === 'chatgpt' ? kind : 'other')
    }
    const key = grant.apiKey
    if (key && key.referenceId === userId && key.enabled !== false && (!key.expiresAt || key.expiresAt > now)) apps.add('other')
  }
  return ASSISTANT_APP_ORDER.filter((app) => apps.has(app))
}
