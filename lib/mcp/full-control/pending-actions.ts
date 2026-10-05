/**
 * Human approval of high-impact full control tools (validate, reverse,
 * delete, import, close...), for connections in validation mode
 * (ExecutionMode 'validation', lib/ai-access/access.ts). In automatic mode,
 * the owner's default for full control, define.ts executes on the call and
 * nothing here is used: the residual prompt injection risk is accepted there
 * (SECURITY.md, finding KLEDG-DEL-mcp-self-confirm).
 *
 * The assistant must never be able to approve its own action: a prompt
 * injected in a bank label, a statement or a document could otherwise make
 * it call the tool, read the confirmation it received and confirm. So:
 *
 * 1. Called without `actionId`, a high-impact tool computes its dry run and
 *    records a pending action (table mcp_pending_actions) bound to the user,
 *    the connection (OAuth client or API key), the tool, the company and the
 *    normalized arguments, with the preview. It returns the action id and the
 *    URL of the approval page: nothing the assistant can use to approve.
 * 2. The user opens that page in Kledg (their browser session, not the
 *    assistant's token), sees the exact preview, types their password again
 *    and approves or refuses (POST /api/ai-actions/[id], same origin and
 *    JSON only through the route wrapper). MCP tokens and API keys never
 *    authenticate that route.
 * 3. Called again with the `actionId` and the same arguments, the tool runs
 *    only if the action is approved, of this user and connection, for this
 *    tool, company and arguments, and not expired. The approved action is
 *    claimed with a conditional update before it runs: it executes once,
 *    even when two calls race.
 *
 * Why the assistant executes after approval rather than Kledg executing on
 * approval: execution stays inside the MCP authorization path (scope of the
 * connection, company grant, the user's role at execution time, rate limit,
 * audit entry naming the assistant), the result reaches the assistant as a
 * normal tool result, and the approval page needs no copy of each tool's
 * execution logic. MCP elicitation in URL mode would carry the same URL;
 * returning it in the result works with every client today.
 */

import { createHash, randomBytes } from 'crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { getAppUrl } from '@/lib/config'
import type { McpCaller } from '@/lib/mcp/company-access'

/** Time the user has to approve, and the assistant to execute once approved. */
export const PENDING_ACTION_TTL_MS = 30 * 60 * 1000

/** Decided, executed or expired actions are kept 30 days (shown as history), then purged. */
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export const PENDING_ACTION_MESSAGES = {
  unknown: "Action introuvable : appelez de nouveau l'outil sans actionId pour préparer une nouvelle action.",
  pending:
    "Cette action attend encore l'accord de l'utilisateur : demandez-lui d'ouvrir le lien d'approbation dans Kledg, puis rappelez l'outil avec le même actionId.",
  rejected: "L'utilisateur a refusé cette action dans Kledg : elle ne sera pas exécutée.",
  done: "Cette action a déjà été exécutée. Pour la refaire, préparez une nouvelle action.",
  expired: 'Cette action a expiré (30 minutes) : préparez une nouvelle action et faites-la approuver de nouveau.',
  mismatch:
    "Les arguments ne correspondent pas à l'action approuvée (outil, société ou paramètres différents) : rappelez l'outil avec exactement les arguments de l'aperçu.",
} as const

export interface ActionBinding {
  userId: string
  caller: McpCaller
  tool: string
  /** The company of the action; null for a tool outside any company (create_company). */
  companyId: string | null
  /** Arguments of the call, without actionId. */
  args: unknown
}

export function callerKey(caller: McpCaller): string {
  return caller.kind === 'oauth' ? `oauth:${caller.clientId}` : `apiKey:${caller.apiKeyId}`
}

/** JSON with object keys sorted at every level, so equal arguments always hash the same. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
}

export function argsHash(args: unknown): string {
  return createHash('sha256').update(canonicalJson(args)).digest('hex')
}

/** URL of the approval page of an action. */
export function approvalUrl(id: string): string {
  return `${getAppUrl()}/settings/ai-actions?action=${encodeURIComponent(id)}`
}

/** JSON as the assistant receives it (Decimal, Date and other toJSON values serialized the same way). */
const toJson = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue

/** Records a pending action and returns its id, approval URL and expiry. */
export async function createPendingAction(
  binding: ActionBinding,
  preview: unknown,
  callerName: string | null,
  now: Date = new Date(),
): Promise<{ id: string; approvalUrl: string; expiresAt: Date }> {
  const id = `act_${randomBytes(24).toString('base64url')}`
  const expiresAt = new Date(now.getTime() + PENDING_ACTION_TTL_MS)
  await prisma.mcpPendingAction.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - RETENTION_MS) } } })
  await prisma.mcpPendingAction.create({
    data: {
      id,
      userId: binding.userId,
      caller: callerKey(binding.caller),
      callerName,
      tool: binding.tool,
      companyId: binding.companyId,
      args: toJson(binding.args),
      argsHash: argsHash(binding.args),
      preview: toJson(preview ?? null),
      expiresAt,
    },
  })
  return { id, approvalUrl: approvalUrl(id), expiresAt }
}

/**
 * Claims an approved action for execution, or throws: ValidationError when
 * it is unknown, of another user or connection (reported alike) or for
 * other arguments; ConflictError when it is still pending, refused, already
 * executed or expired.
 */
export async function claimApprovedAction(actionId: string, binding: ActionBinding, now: Date = new Date()): Promise<void> {
  const row = await prisma.mcpPendingAction.findUnique({ where: { id: actionId } })
  if (!row || row.userId !== binding.userId || row.caller !== callerKey(binding.caller)) {
    throw new ValidationError(PENDING_ACTION_MESSAGES.unknown)
  }
  if (row.tool !== binding.tool || row.companyId !== binding.companyId || row.argsHash !== argsHash(binding.args)) {
    throw new ValidationError(PENDING_ACTION_MESSAGES.mismatch)
  }
  if (row.status === 'rejected') throw new ConflictError(PENDING_ACTION_MESSAGES.rejected)
  if (['executing', 'executed', 'failed'].includes(row.status)) throw new ConflictError(PENDING_ACTION_MESSAGES.done)
  if (row.expiresAt <= now) throw new ConflictError(PENDING_ACTION_MESSAGES.expired)
  if (row.status !== 'approved') throw new ConflictError(PENDING_ACTION_MESSAGES.pending)
  const claimed = await prisma.mcpPendingAction.updateMany({
    where: { id: row.id, status: 'approved', expiresAt: { gt: now } },
    data: { status: 'executing' },
  })
  if (claimed.count === 0) throw new ConflictError(PENDING_ACTION_MESSAGES.done)
}

/** Records how a claimed action ended. */
export async function finishAction(actionId: string, ok: boolean): Promise<void> {
  await prisma.mcpPendingAction.updateMany({
    where: { id: actionId, status: 'executing' },
    data: { status: ok ? 'executed' : 'failed', executedAt: new Date() },
  })
}

/** Shown instead of a company name for an action outside any company (create_company). */
export const NO_COMPANY_LABEL = 'Nouvelle société'

export interface PendingActionView {
  id: string
  tool: string
  companyId: string | null
  companyName: string
  callerName: string | null
  args: unknown
  preview: unknown
  status: string
  expiresAt: string
  createdAt: string
  decidedAt: string | null
  executedAt: string | null
}

/** The user's actions waiting for a decision, then the recent ones (history), newest first. */
export async function listActionsOfUser(userId: string, now: Date = new Date()): Promise<PendingActionView[]> {
  const rows = await prisma.mcpPendingAction.findMany({
    where: { userId, createdAt: { gt: new Date(now.getTime() - RETENTION_MS) } },
    include: { company: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  return rows.map((row) => ({
    id: row.id,
    tool: row.tool,
    companyId: row.companyId,
    companyName: row.company?.name ?? NO_COMPANY_LABEL,
    callerName: row.callerName,
    args: row.args,
    preview: row.preview,
    status: row.status === 'pending' && row.expiresAt <= now ? 'expired' : row.status,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    executedAt: row.executedAt?.toISOString() ?? null,
  }))
}

/**
 * The user's decision on one of their pending actions. Another user's
 * action is "introuvable"; a decided or expired one is a 409. The password
 * check and the audit entry are done by the route.
 */
export async function decideAction(
  userId: string,
  actionId: string,
  decision: 'approve' | 'reject',
  now: Date = new Date(),
): Promise<{ id: string; tool: string; companyId: string | null; status: 'approved' | 'rejected' }> {
  const row = await prisma.mcpPendingAction.findFirst({ where: { id: actionId, userId } })
  if (!row) throw new NotFoundError('Action introuvable')
  if (row.status !== 'pending') throw new ConflictError('Cette action a déjà été traitée.')
  if (row.expiresAt <= now) throw new ConflictError("Cette action a expiré : demandez à l'assistant de la préparer de nouveau.")
  const status = decision === 'approve' ? 'approved' : 'rejected'
  const updated = await prisma.mcpPendingAction.updateMany({
    where: { id: row.id, userId, status: 'pending', expiresAt: { gt: now } },
    data: { status, decidedAt: now },
  })
  if (updated.count === 0) throw new ConflictError('Cette action a déjà été traitée.')
  return { id: row.id, tool: row.tool, companyId: row.companyId, status }
}
