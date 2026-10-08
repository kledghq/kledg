/**
 * The single way full control MCP tools are registered.
 *
 * `registerFullControlTool` wraps every tool so that, on each call, in order:
 * 1. the company is checked by `guard.requireFullControl(companyId, permission)`
 *    (403 without kledg:admin, then the connection's company grant and the
 *    user's role, exactly like the other tools: a company outside the grant
 *    is "Société introuvable");
 *    A tool grouping several routes behind an `action` input also checks,
 *    the same way, the right of the route of that action (`actions`);
 * 2. the user's full control calls are rate limited;
 * 3. a tool with `confirmation: true` (high impact) runs according to the
 *    connection's execution mode (access.executionMode, stored on its grant):
 *    - 'validation': it returns a dry run and records a pending action the
 *      user must approve in Kledg; called again with that `actionId`, it acts
 *      only once the user approved (pending-actions.ts). The assistant
 *      cannot approve by itself;
 *    - 'automatic' (the owner's choice for full control): it executes on
 *      the call, with no pending action. `dryRun: true` still returns the
 *      preview without writing, for an assistant that wants to show it;
 *    When only some actions of a tool are high impact (`highImpactActions`),
 *    the others run at once, like a direct tool;
 *    In validation mode the approval is bound to the data, not only to the
 *    arguments: a fingerprint of the dry run and of the rows the tool
 *    targets (`targetState`) is stored with the pending action and computed
 *    again before the execution; when the data changed since the approval
 *    the action is refused (fingerprint.ts);
 * 4. every action (not the dry runs nor the plain reads) is written to the
 *    audit log with the user, the assistant (OAuth client name or API key
 *    name), the execution mode, the tool and the main ids.
 *
 * Tools are thin: `preview` and `execute` call the lib services the web UI
 * uses, which keep every accounting invariant (and the database triggers
 * behind them). Errors go through handleError: typed errors keep their French
 * message, anything else becomes the generic message.
 */

import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { writeAuditLog } from '@/lib/audit'
import { enforceRateLimit } from '@/lib/rate-limit'
import type { Permission } from '@/lib/rbac/authorize'
import { FULL_CONTROL_REQUIRED_MESSAGE, type CompanyGuard, type McpAccess } from '@/lib/mcp/company-access'
import { json, run, type ToolResult } from '@/lib/mcp/tool-result'
import { READ_ONLY, describeTool, permissionsOfAction, writeAnnotations, type ActionPermissions } from '@/lib/mcp/tool-meta'
import { ConflictError, ForbiddenError } from '@/lib/accounting/errors'
import type { GroupAccess } from '@/lib/management-fees/access'
import type { ExecutionMode } from '@/lib/ai-access/access'
import { claimApprovedAction, createPendingAction, finishAction } from './pending-actions'
import { STATE_CHANGED_MESSAGE, stateFingerprint } from './fingerprint'
import { TWO_STEP, stepFor } from './descriptions'

export const companyIdInput = z.string().describe('Company id, from list_companies.')

export interface FullControlContext {
  access: McpAccess
  companyId: string
  /** Checks one more right in the company (rights that depend on the data, like the route's `authorize`). */
  authorize: (permission: Permission) => Promise<void>
  /** Whether the user's role in the company also grants `permission` (like the route's `can`), without throwing. */
  can: (permission: Permission) => Promise<boolean>
  /** Refuses (403) a user who is not an instance administrator, like the route's adminRoute. */
  requireInstanceAdministrator: () => void
  /** Access to other companies of a group (subsidiaries): full control, grant and role in each. */
  group: GroupAccess
}

type Shape = z.ZodRawShape
type Args<S extends Shape> = z.infer<z.ZodObject<S>> & { companyId: string }

interface ToolBase<S extends Shape, R> {
  name: string
  title: string
  description: string
  /** Input fields; companyId is added to every tool. */
  input: S
  /** Permission checked in the company by requireFullControl. */
  permission: Permission
  /**
   * Tools with an `action` input: the rights of each action, checked by
   * requireFullControl besides `permission`, like each matching route.
   */
  actions?: ActionPermissions
  /** Main ids written to the audit log with the action; null for plain reads (not audited). */
  audit: ((args: Args<S>, result: R) => Record<string, unknown>) | null
  execute: (args: Args<S>, ctx: FullControlContext) => Promise<R>
  /** 'euros' when the tool takes or returns amounts (lib/mcp/tool-meta.ts). */
  amounts: 'euros' | 'none'
  /** Extra unit notes (rates, dates). */
  units?: string
  /** What the tool never does, starting with a verb (describeTool). */
  never: string
  readOnly?: boolean
  destructive?: boolean
  idempotent?: boolean
  /** The tool calls a third party (a bank). */
  openWorld?: boolean
}

export interface DirectTool<S extends Shape, R> extends ToolBase<S, R> {
  confirmation: false
}

export interface ConfirmedTool<S extends Shape, P, R> extends ToolBase<S, R> {
  /**
   * High impact: approved by the user in Kledg before it runs
   * (pending-actions.ts) in validation mode, executed on the call in
   * automatic mode. Its description contains TWO_STEP (replaced per mode).
   */
  confirmation: true
  /** Dry run: exactly what `execute` would do, without writing. */
  preview: (args: Args<S>, ctx: FullControlContext) => Promise<P>
  /**
   * Tools with an `action` input whose actions are not all high impact: the
   * actions that follow the execution mode; the others run at once, like a
   * direct tool. Every action is high impact when absent.
   */
  highImpactActions?: readonly string[]
  /**
   * Tools whose calls are high impact only with some arguments (a rule
   * marked autoCreate, applied without a click): whether this call is. The
   * other calls run at once, like a direct tool. Replaces highImpactActions.
   */
  highImpactWhen?: (args: Args<S>) => boolean
  /**
   * The rows the action acts on (entries with their lines, an invoice with
   * its lines, rules...), read again before the execution: in validation
   * mode the approval is refused when they, or the dry run, changed since
   * the user approved it (fingerprint.ts). The dry run alone is compared
   * when absent.
   */
  targetState?: (args: Args<S>, ctx: FullControlContext) => Promise<unknown>
}

export type FullControlTool<S extends Shape, P, R> = DirectTool<S, R> | ConfirmedTool<S, P, R>

/** Declares a tool (identity, for type inference of its arguments and result). */
export function fullControlTool<S extends Shape, P, R>(tool: FullControlTool<S, P, R>): FullControlTool<S, P, R> {
  return tool
}

/** Registers one tool through registerFullControlTool (given to each tool module). */
export type RegisterTool = <S extends Shape, P, R>(tool: FullControlTool<S, P, R>) => void

/** Input of a high-impact tool in validation mode. */
const confirmFields = {
  actionId: z
    .string()
    .max(100)
    .optional()
    .describe(
      'Leave empty for the dry run, which returns an actionId and an approvalUrl. Pass the actionId (with the same arguments) only after the user approved the action in Kledg at that URL.',
    ),
}

/** Input of a high-impact tool in automatic mode: the preview stays available, never required. */
const dryRunFields = {
  dryRun: z
    .boolean()
    .optional()
    .describe('true: only return the preview of what the call would do (nothing is written). Omit it, or false, to execute.'),
}

/** Name of the assistant for the audit log: the OAuth client's name or the API key's name. */
export async function assistantOf(access: McpAccess): Promise<{ kind: string; id: string; name: string | null }> {
  if (access.caller.kind === 'oauth') {
    const client = await prisma.oauthClient.findUnique({ where: { clientId: access.caller.clientId }, select: { name: true } })
    return { kind: 'oauth', id: access.caller.clientId, name: client?.name ?? null }
  }
  const key = await prisma.apikey.findUnique({ where: { id: access.caller.apiKeyId }, select: { name: true } })
  return { kind: 'apiKey', id: access.caller.apiKeyId, name: key?.name ?? null }
}

const MODE_NOTES: Record<ExecutionMode, string> = { automatic: 'mode automatique', validation: 'validation dans Kledg' }

async function audit(
  tool: string,
  access: McpAccess,
  companyId: string | null,
  ids: Record<string, unknown>,
  refused?: string,
  action?: string,
) {
  const assistant = await assistantOf(access)
  const who = assistant.name ?? assistant.id
  const mode = access.executionMode
  await writeAuditLog(refused ? 'warn' : 'info', `MCP full control${refused ? ' refused' : action ? ' pending' : ''} (${MODE_NOTES[mode]}): ${tool} by ${who}`, {
    action: action ?? (refused ? 'MCP_FULL_CONTROL_REFUSED' : 'MCP_FULL_CONTROL'),
    companyId: companyId ?? undefined,
    metadata: {
      source: 'mcp',
      tool,
      userId: access.user.id,
      assistant,
      executionMode: mode,
      ...ids,
      ...(refused && { reason: refused }),
    },
    context: { userId: access.user.email || access.user.id, ipAddress: null, userAgent: `mcp:${assistant.kind}` },
  })
}

async function limitFullControl(userId: string) {
  await enforceRateLimit('mcp-full-control', userId)
}

const APPROVAL_NEXT_STEP =
  "Aperçu seulement : rien n'a été modifié. Montrez cet aperçu à l'utilisateur et donnez-lui le lien approvalUrl : il doit approuver l'action lui-même dans Kledg (vous ne pouvez pas l'approuver). Une fois approuvée, rappelez l'outil avec les mêmes arguments et actionId."

const AUTOMATIC_NEXT_STEP =
  "Aperçu seulement : rien n'a été modifié. Pour exécuter l'action, rappelez l'outil avec les mêmes arguments, sans dryRun."

export function registerFullControlTool<S extends Shape, P, R>(
  server: McpServer,
  access: McpAccess,
  guard: CompanyGuard,
  tool: FullControlTool<S, P, R>,
): void {
  const mode = access.executionMode
  const automatic = mode === 'automatic'
  const base = z.object({ companyId: companyIdInput, ...tool.input })
  const inputSchema = tool.confirmation ? base.extend(automatic ? dryRunFields : confirmFields) : base
  const description = describeTool({
    summary: tool.confirmation ? tool.description.replace(TWO_STEP, stepFor(mode)) : tool.description,
    access: 'admin',
    permission: tool.permission,
    actions: tool.actions,
    amounts: tool.amounts,
    units: tool.units,
    never: tool.never,
  })

  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description,
      inputSchema,
      annotations: tool.readOnly
        ? { ...READ_ONLY, openWorldHint: tool.openWorld ?? false }
        : writeAnnotations({ destructive: tool.destructive ?? false, idempotent: tool.idempotent ?? false, openWorld: tool.openWorld }),
    },
    (raw: unknown) =>
      run(async () => {
        const { actionId, dryRun, ...rest } = inputSchema.parse(raw) as Args<S> & { actionId?: string; dryRun?: boolean }
        const args = rest as Args<S>
        const companyId = args.companyId
        await guard.requireFullControl(companyId, tool.permission)
        const action = (args as { action?: unknown }).action
        for (const permission of permissionsOfAction(tool.actions, action)) await guard.requireFullControl(companyId, permission)
        await limitFullControl(access.user.id)
        const ctx: FullControlContext = {
          access,
          companyId,
          authorize: (permission) => guard.requireFullControl(companyId, permission),
          can: (permission) =>
            guard.requireFullControl(companyId, permission).then(
              () => true,
              (error) => {
                if (error instanceof ForbiddenError) return false
                throw error
              },
            ),
          requireInstanceAdministrator: () => guard.requireInstanceAdministrator(),
          group: {
            userId: access.user.id,
            require: (id, permission) => guard.requireFullControl(id, permission),
            companyIds: () => guard.companyIds(),
          },
        }
        const highImpact =
          tool.confirmation &&
          (tool.highImpactWhen ? tool.highImpactWhen(args) : !tool.highImpactActions || tool.highImpactActions.includes(String(action)))

        // A dry run asked in automatic mode only previews, whatever the action.
        if (tool.confirmation && automatic && dryRun) {
          return json({ dryRun: true, preview: await tool.preview(args, ctx), nextStep: AUTOMATIC_NEXT_STEP })
        }

        if (tool.confirmation && highImpact) {
          const audited = tool.audit
          const targetState = tool.targetState
          return highImpactCall<P, R>({
            access,
            tool: tool.name,
            companyId,
            args,
            actionId,
            preview: () => tool.preview(args, ctx),
            targetState: targetState && (() => targetState(args, ctx)),
            execute: () => tool.execute(args, ctx),
            audit: audited && ((result: R) => audited(args, result)),
          })
        }

        const result = await tool.execute(args, ctx)
        if (tool.audit) await audit(tool.name, access, companyId, tool.audit(args, result))
        // An action of a high-impact tool that is not high impact itself answers like an executed one.
        return json(tool.confirmation ? { executed: true, result } : result)
      }),
  )
}

interface HighImpactCall<P, R> {
  access: McpAccess
  tool: string
  /** The company of the action; null for a tool outside any company (create_company). */
  companyId: string | null
  /** Arguments of the call, without actionId nor dryRun (bound to the pending action). */
  args: unknown
  actionId?: string
  preview: () => Promise<P>
  /** The rows the action acts on, part of the fingerprint the approval is bound to. */
  targetState?: () => Promise<unknown>
  execute: () => Promise<R>
  /** Main ids written to the audit log with the action. */
  audit: ((result: R) => Record<string, unknown>) | null
  /** The company of the audit entry once executed, when the action created it. */
  auditCompany?: (result: R) => string | null
}

/**
 * A high-impact action according to the connection's execution mode: at
 * once in automatic mode (scope, grant, role and rate limit were checked by
 * the caller), else a dry run and a pending action the user approves in
 * Kledg, executed once when called again with its actionId.
 */
async function highImpactCall<P, R>(call: HighImpactCall<P, R>): Promise<ToolResult> {
  const { access, tool, companyId } = call
  const auditCompany = (result: R) => call.auditCompany?.(result) ?? companyId
  if (access.executionMode === 'automatic') {
    // The user chose automatic execution for this connection: no pending
    // action. The service and the database triggers keep the accounting invariants.
    const result = await call.execute()
    if (call.audit) await audit(tool, access, auditCompany(result), call.audit(result))
    return json({ executed: true, result })
  }

  const binding = { userId: access.user.id, caller: access.caller, tool, companyId, args: call.args }
  const fingerprintOf = async (preview: P) => stateFingerprint(preview, call.targetState ? await call.targetState() : null)
  if (!call.actionId) {
    const preview = await call.preview()
    const assistant = await assistantOf(access)
    const pending = await createPendingAction(binding, preview, assistant.name, await fingerprintOf(preview))
    await audit(tool, access, companyId, { actionId: pending.id }, undefined, 'MCP_FULL_CONTROL_PENDING')
    return json({
      dryRun: true,
      preview,
      actionId: pending.id,
      approvalUrl: pending.approvalUrl,
      expiresAt: pending.expiresAt.toISOString(),
      nextStep: APPROVAL_NEXT_STEP,
    })
  }
  const actionId = call.actionId
  let approvedFingerprint: string | null
  try {
    approvedFingerprint = (await claimApprovedAction(actionId, binding)).fingerprint
  } catch (error) {
    // Unapproved, refused, replayed, expired or tampered actions leave a trace before the refusal.
    await audit(tool, access, companyId, { actionId }, error instanceof Error ? error.message : 'refused')
    throw error
  }
  // The approval covers the data the user saw: the action is claimed (it
  // cannot run twice), then refused if the dry run or the target rows
  // changed since (an approved draft edited by a direct tool, say).
  try {
    const current = await fingerprintOf(await call.preview())
    if (approvedFingerprint === null || current !== approvedFingerprint) throw new ConflictError(STATE_CHANGED_MESSAGE)
  } catch (error) {
    await finishAction(actionId, false)
    await audit(tool, access, companyId, { actionId }, error instanceof Error ? error.message : 'refused')
    throw error
  }
  let result: R
  try {
    result = await call.execute()
  } catch (error) {
    await finishAction(actionId, false)
    throw error
  }
  await finishAction(actionId, true)
  if (call.audit) await audit(tool, access, auditCompany(result), { ...call.audit(result), actionId })
  return json({ executed: true, result })
}

export const ALL_COMPANIES_REQUIRED_MESSAGE =
  "Cette connexion est limitée à certaines sociétés\u00a0: une société créée lui resterait inaccessible. Créez la société dans Kledg, ou utilisez une connexion autorisée sur toutes vos sociétés."

/**
 * A full control tool acting outside any company: creating one
 * (create_company). Always high impact (the execution mode applies).
 */
export interface InstanceTool<S extends Shape, P, R> {
  name: string
  title: string
  /** What the tool does; contains TWO_STEP (replaced per mode). */
  description: string
  input: S
  /** The right the tool needs: the instance policy on company creation. */
  permission: 'company-creation'
  amounts: 'euros' | 'none'
  units?: string
  never: string
  destructive?: boolean
  idempotent?: boolean
  /** Dry run: exactly what `execute` would do, without writing (with the policy checks). */
  preview: (args: z.infer<z.ZodObject<S>>, access: McpAccess) => Promise<P>
  execute: (args: z.infer<z.ZodObject<S>>, access: McpAccess) => Promise<R>
  /** The company of the audit entry (the created one) and the main ids. */
  audit: (args: z.infer<z.ZodObject<S>>, result: R) => { companyId: string | null; ids: Record<string, unknown> }
}

/** Declares an instance tool (identity, for type inference). */
export function instanceTool<S extends Shape, P, R>(tool: InstanceTool<S, P, R>): InstanceTool<S, P, R> {
  return tool
}

/**
 * Registers a tool acting outside any company. On each call: 403 without
 * kledg:admin; 403 for a connection limited to some companies (the grant
 * names companies, it cannot name one that does not exist yet, and row
 * level security would hide the new company from it), so only a connection
 * granted every company of the user acts, and the new company is in its
 * grant from the start; the rate limit of full control; then the execution
 * mode, like every high-impact tool (pending action without company).
 */
export function registerInstanceTool<S extends Shape, P, R>(
  server: McpServer,
  access: McpAccess,
  guard: CompanyGuard,
  tool: InstanceTool<S, P, R>,
): void {
  const mode = access.executionMode
  const automatic = mode === 'automatic'
  const inputSchema = z.object(tool.input).extend(automatic ? dryRunFields : confirmFields)
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: describeTool({
        summary: tool.description.replace(TWO_STEP, stepFor(mode)),
        access: 'admin',
        permission: tool.permission,
        amounts: tool.amounts,
        units: tool.units,
        never: tool.never,
      }),
      inputSchema,
      annotations: writeAnnotations({ destructive: tool.destructive ?? false, idempotent: tool.idempotent ?? false }),
    },
    (raw: unknown) =>
      run(async () => {
        const { actionId, dryRun, ...rest } = inputSchema.parse(raw) as z.infer<z.ZodObject<S>> & { actionId?: string; dryRun?: boolean }
        const args = rest as z.infer<z.ZodObject<S>>
        if (!access.canAdmin) throw new ForbiddenError(FULL_CONTROL_REQUIRED_MESSAGE)
        if ((await guard.companyIds()) !== null) throw new ForbiddenError(ALL_COMPANIES_REQUIRED_MESSAGE)
        await limitFullControl(access.user.id)
        if (automatic && dryRun) {
          return json({ dryRun: true, preview: await tool.preview(args, access), nextStep: AUTOMATIC_NEXT_STEP })
        }
        return highImpactCall({
          access,
          tool: tool.name,
          companyId: null,
          args,
          actionId,
          preview: () => tool.preview(args, access),
          execute: () => tool.execute(args, access),
          audit: (result) => tool.audit(args, result).ids,
          auditCompany: (result) => tool.audit(args, result).companyId,
        })
      }),
  )
}
