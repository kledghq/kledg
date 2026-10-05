/**
 * Metadata shared by every MCP tool: annotations, descriptions and the one
 * convention for amounts.
 *
 * Amounts (docs/mcp.md, "Montants"): every amount an assistant sends or
 * reads is in EUROS, as a decimal number with two decimals at most (12.5 is
 * 12,50 €), never in cents. Tools convert at the edge with
 * lib/utils/money.ts (toCents in, fromCents out); services keep working in
 * cents. Rates are in percent (20 for 20 %), ratios are fractions
 * (0.25 for 25 %), dates are calendar days (yyyy-mm-dd), months yyyy-mm.
 *
 * Annotations (MCP ToolAnnotations): every tool states all four hints, so a
 * client never falls back to the protocol defaults (which assume a
 * destructive, open world tool):
 * - read tools: readOnly, not destructive, idempotent, closed world;
 * - writes: readOnly false; destructive when the call replaces or deletes
 *   something that exists (a line's amounts, an assessment, a draft entry),
 *   not when it only adds; idempotent when repeating the same call changes
 *   nothing more; open world only when the tool talks to a third party
 *   (sync_bank calls the bank).
 *
 * Descriptions say what the tool does, the unit of its amounts, the access
 * level and the right it needs in the company, and what it never does
 * (describeTool). A guard test (lib/mcp/__tests__/tool-metadata.test.ts)
 * checks every registered tool.
 */

import { z } from 'zod'
import type { Permission } from '@/lib/rbac/authorize'
import { getAppUrl } from '@/lib/config'
import { ValidationError } from '@/lib/accounting/errors'
import { parseCents } from '@/lib/utils/money'

export interface ToolAnnotations {
  readOnlyHint: boolean
  destructiveHint: boolean
  idempotentHint: boolean
  openWorldHint: boolean
}

/** Annotations of every read tool. */
export const READ_ONLY: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }

/** Annotations of a tool that writes in Kledg's database only. */
export function writeAnnotations(options: { destructive: boolean; idempotent: boolean; openWorld?: boolean }): ToolAnnotations {
  return { readOnlyHint: false, destructiveHint: options.destructive, idempotentHint: options.idempotent, openWorldHint: options.openWorld ?? false }
}

/** The sentence stating the amount convention, written in every description. */
export const AMOUNTS_IN_EUROS = 'Amounts in and out are in euros (decimal numbers, two decimals at most), never in cents.'
export const NO_AMOUNTS = 'No amounts.'

export type AccessLevel = 'read' | 'write' | 'admin'

const LEVELS: Record<AccessLevel, string> = {
  read: 'kledg:read',
  write: 'kledg:write (read and drafts)',
  admin: 'kledg:admin (full control)',
}

/** "reports:read", "entries:create and entries:validate". */
export function permissionLabel(permissions: Permission | readonly Permission[]): string {
  const list = Array.isArray(permissions) ? permissions : [permissions as Permission]
  const rights = list.flatMap((permission) => Object.entries(permission).flatMap(([resource, actions]) => ((actions ?? []) as readonly string[]).map((action) => `${resource}:${action}`)))
  return [...new Set(rights)].join(' and ')
}

export interface ToolDescription {
  /** What the tool does and returns. */
  summary: string
  access: AccessLevel
  /**
   * Right(s) checked in the company, like the matching API route; 'membership'
   * when being a member is enough; 'company-creation' for the tools outside
   * any company that the instance policy on company creation governs
   * (create_company, lookup_siren).
   */
  permission: Permission | readonly Permission[] | 'membership' | 'company-creation'
  /** Tools with an `action` input: the rights each action needs besides `permission`, like each matching route. */
  actions?: ActionPermissions
  /** 'euros' when the tool takes or returns amounts. */
  amounts: 'euros' | 'none'
  /** Extra unit notes (rates, ratios, days). */
  units?: string
  /** What the tool never does, starting with a verb ("validates an entry..."). */
  never: string
}

/** Rights per value of a tool's `action` input (checked besides the tool's own permission). */
export type ActionPermissions = Readonly<Record<string, Permission | readonly Permission[]>>

/** The rights an action needs, as a list (none when the action has no entry). */
export function permissionsOfAction(actions: ActionPermissions | undefined, action: unknown): readonly Permission[] {
  const rights = typeof action === 'string' && actions && Object.hasOwn(actions, action) ? actions[action] : undefined
  if (!rights) return []
  return Array.isArray(rights) ? rights : [rights as Permission]
}

/** The description of a tool, in the order the guard test checks. */
export function describeTool(d: ToolDescription): string {
  const units = [d.amounts === 'euros' ? AMOUNTS_IN_EUROS : NO_AMOUNTS, d.units].filter(Boolean).join(' ')
  if (d.permission === 'company-creation') {
    return `${d.summary} ${units} Access: ${LEVELS[d.access]} and the instance's company creation policy (instance administrators by default), outside any company. Never ${d.never}`
  }
  const label = d.permission === 'membership' ? '' : permissionLabel(d.permission)
  const right = d.permission === 'membership' || !label ? 'membership of the company' : `the ${label} right${label.includes(' and ') ? 's' : ''} in the company`
  const perAction = d.actions
    ? `, plus per action the rights in the company: ${Object.entries(d.actions).map(([action, rights]) => `${action} (${permissionLabel(rights)})`).join(', ')}`
    : ''
  return `${d.summary} ${units} Access: ${LEVELS[d.access]} and ${right}${perAction}. Never ${d.never}`
}

/** Link to a page of a company in Kledg (the id is redirected to the company's slug). */
export function kledgPageUrl(companyId: string, page: string): string {
  return `${getAppUrl()}/${encodeURIComponent(companyId)}/${page.replace(/^\//, '')}`
}

/** An amount sent by an assistant: euros, a number with two decimals at most. */
export const eurosInput = z.number({ error: 'Montant invalide\u00a0: un nombre en euros est attendu' }).finite().min(-1e13).max(1e13)

/** Cents of an amount in euros sent by an assistant, or a French 400 naming the field. */
export function centsFromEuros(value: number, field: string): number {
  const cents = parseCents(value)
  if (cents === null) throw new ValidationError(`${field}\u00a0: montant invalide, en euros avec deux décimales au plus.`)
  return cents
}
