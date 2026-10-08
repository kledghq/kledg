/**
 * The single way draft-level write tools (kledg:write) are registered.
 *
 * These tools prepare work a person reviews in Kledg: budget lines,
 * decisions on detected subscriptions, provisions and their assessment,
 * investment grants, year-end entries as DRAFTS, draft expense reports,
 * the data of the approval of the accounts. None of them validates or
 * posts an entry, generates a final document or acts outside the company.
 *
 * `registerDraftTool` wraps every tool so that, on each call, in order:
 * 1. the arguments are parsed with French messages (parseInput);
 * 2. every right of the tool is checked in the company through the company
 *    guard (connection grant, membership, role, archived company), exactly
 *    like the matching API route: a company outside the grant is
 *    "Société introuvable";
 *    a tool grouping several routes behind an `action` input also checks
 *    the right of the route of that action (`actions`);
 * 3. the tool calls the lib service the web UI uses (same checks, locks and
 *    database triggers);
 * 4. the call is written to the audit log (MCP_WRITE) with the user, the
 *    assistant and the main ids, besides the service's own entry.
 *
 * Every result says what changed (`changes`) and links to the page of
 * Kledg where a person reviews it (`reviewUrl`).
 */

import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { writeAuditLog } from '@/lib/audit'
import { enforceRateLimit } from '@/lib/rate-limit'
import { ValidationError } from '@/lib/accounting/errors'
import { parseInput } from '@/lib/api/zod-fields'
import type { Permission } from '@/lib/rbac/authorize'
import type { CompanyGuard, McpAccess } from '@/lib/mcp/company-access'
import { json, run } from '@/lib/mcp/tool-result'
import { describeTool, permissionsOfAction, writeAnnotations, type ActionPermissions } from '@/lib/mcp/tool-meta'
import { assistantOf } from '@/lib/mcp/full-control/define'

export const companyIdInput = z.string().min(1, 'La société est requise').describe('Company id, from list_companies.')

type Shape = z.ZodRawShape
export type DraftArgs<S extends Shape> = z.infer<z.ZodObject<S>> & { companyId: string }

/** What every draft tool returns, besides its own fields. */
export interface DraftResult {
  /** What the call changed, in plain words or ids. */
  changes: unknown
  /** The page of Kledg where a person reviews the change. */
  reviewUrl: string
  /** French message for the user. */
  message: string
}

export interface DraftContext {
  access: McpAccess
  companyId: string
  /** Checks one more right in the company (actions whose right depends on the data, like the route's `authorize`). */
  authorize: (permission: Permission) => Promise<void>
}

export interface DraftTool<S extends Shape, R extends DraftResult> {
  name: string
  title: string
  summary: string
  /** What the tool never does (see describeTool). */
  never: string
  amounts: 'euros' | 'none'
  units?: string
  /** Input fields; companyId is added to every tool. */
  input: S
  /** Rights checked in the company, all of them, like the API route (empty when every action states its own). */
  permission: Permission | readonly Permission[]
  /** Tools with an `action` input: the rights of each action, checked besides `permission`, like each matching route. */
  actions?: ActionPermissions
  destructive: boolean
  idempotent: boolean
  execute: (args: DraftArgs<S>, ctx: DraftContext) => Promise<R>
  /** Main ids written to the audit log; null when nothing was written (a dry run). */
  audit: (args: DraftArgs<S>, result: R) => Record<string, unknown> | null
}

/** Declares a draft tool (identity, for type inference of its arguments and result). */
export function draftTool<S extends Shape, R extends DraftResult>(tool: DraftTool<S, R>): DraftTool<S, R> {
  return tool
}

export type RegisterDraftTool = <S extends Shape, R extends DraftResult>(tool: DraftTool<S, R>) => void

/**
 * The audit entry of a draft write (MCP_WRITE): the user, the assistant
 * (OAuth client or API key, assistantOf) and the main ids, never text the
 * assistant wrote. Every draft-level write goes through it, create_draft_entry
 * included (lib/mcp/tools.ts).
 */
export async function auditDraftWrite(tool: string, access: McpAccess, companyId: string, ids: Record<string, unknown>) {
  const assistant = await assistantOf(access)
  await writeAuditLog('info', `MCP draft write: ${tool} by ${assistant.name ?? assistant.id}`, {
    action: 'MCP_WRITE',
    companyId,
    metadata: { source: 'mcp', tool, userId: access.user.id, assistant, ...ids },
    context: { userId: access.user.email || access.user.id, ipAddress: null, userAgent: `mcp:${assistant.kind}` },
  })
}

export function registerDraftTool<S extends Shape, R extends DraftResult>(server: McpServer, access: McpAccess, guard: CompanyGuard, tool: DraftTool<S, R>): void {
  const inputSchema = z.object({ companyId: companyIdInput, ...tool.input })
  const basePermissions: readonly Permission[] = Array.isArray(tool.permission) ? tool.permission : [tool.permission as Permission]
  if (basePermissions.length === 0 && !tool.actions) throw new Error(`${tool.name}: a draft tool checks at least one right`)

  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: describeTool({ summary: tool.summary, access: 'write', permission: tool.permission, actions: tool.actions, amounts: tool.amounts, units: tool.units, never: tool.never }),
      inputSchema,
      annotations: writeAnnotations({ destructive: tool.destructive, idempotent: tool.idempotent }),
    },
    (raw: unknown) =>
      run(async () => {
        const args = parseInput(inputSchema, raw) as DraftArgs<S>
        const permissions = [...basePermissions, ...permissionsOfAction(tool.actions, (args as { action?: unknown }).action)]
        if (permissions.length === 0) throw new ValidationError('Action inconnue.')
        for (const permission of permissions) await guard.require(args.companyId, permission)
        await enforceRateLimit('mcp-write', access.user.id)
        const authorize = (permission: Permission) => guard.require(args.companyId, permission)
        const result = await tool.execute(args, { access, companyId: args.companyId, authorize })
        const ids = tool.audit(args, result)
        if (ids) await auditDraftWrite(tool.name, access, args.companyId, ids)
        return json(result)
      }),
  )
}
