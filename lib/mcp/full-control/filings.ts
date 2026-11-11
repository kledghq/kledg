/**
 * Records of filed returns and paid deadlines (docs/echeances.md), for
 * every connection that may write (kledg:write or full control):
 * - mark_declaration records, through the service of
 *   PUT /api/companies/[id]/declarations/status and with its right
 *   (entries:create), that the user filed and/or paid a deadline of the
 *   calendar on impots.gouv.fr, with the date, the amount, a reference and a
 *   note, or that it is not due; clear removes what was recorded. Facts other
 *   modules own (VAT and IS filings, IS acomptes, approval of the accounts)
 *   are refused with the page where they go;
 * - record_tax_filing records the filing of a VAT return or of the
 *   corporate tax return (PUT .../vat-returns/filing,
 *   PUT .../corporate-tax/filing, same right), or removes it.
 *
 * Neither files, pays or posts anything, but a record settles a deadline:
 * its reminder stops and, for a VAT return with the automatic closing
 * "after_vat_filing", the periods it covers are closed. So both are high
 * impact (lib/mcp/full-control/define.ts, `level: 'write'`): on a draft-level
 * connection the call returns a dry run and a pending action the user
 * approves in Kledg (the page "Actions des assistants" shows the deadline
 * and its current status); with full control they follow the connection's
 * execution mode. Audited (MCP_FULL_CONTROL, besides the services' own
 * MARK_DECLARATION, RECORD_VAT_FILING...).
 */

import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ValidationError } from '@/lib/accounting/errors'
import { calendarDayOf } from '@/lib/utils/date'
import { centsFromEuros, eurosInput, kledgPageUrl } from '@/lib/mcp/tool-meta'
import { assistantInput, forAssistant, routeBody } from '@/lib/mcp/euros'
import { deadlineStatusJson } from '@/lib/mcp/local-tax-tools'
import type { CompanyGuard, McpAccess } from '@/lib/mcp/company-access'
import { fullControlTool, registerFullControlTool } from './define'
import { TWO_STEP } from './descriptions'
import { companyLock } from './fingerprint'
import { DEADLINE_ID_PATTERN, clearDeclaration, getTrackedDeadline, markDeclaration } from '@/lib/declarations/mark-declaration.service'
import { DECLARATIONS_WRITE } from '@/lib/declarations/permissions'
import { VatFilingBodySchema, VatFilingQuerySchema, deleteVatFiling, recordVatFiling } from '@/lib/vat-returns/record-vat-filing.service'
import {
  CorporateTaxFilingBodySchema,
  CorporateTaxFilingQuerySchema,
  deleteCorporateTaxFiling,
  recordCorporateTaxFiling,
} from '@/lib/corporate-tax/record-corporate-tax.service'
import { parseDeadlineSettings } from '@/lib/deadlines/settings'
import { fromCents, parseCents } from '@/lib/utils/money'

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide\u00a0: aaaa-mm-jj')

const DECLARATION_FIELDS = ['filedOn', 'paidOn', 'amount', 'notDue', 'attachmentReference', 'note'] as const

const SETTLES =
  'A record settles the deadline in Kledg (its reminder stops), so the call is approved by the user like other high-impact actions:'

export const markDeclarationTool = fullControlTool({
  name: 'mark_declaration',
  title: 'Marquer une échéance déposée ou payée',
  level: 'write',
  description: `Records in the declarations tracker that the user filed and/or paid a deadline of the calendar (deadlineId from list_declarations_status or list_tax_deadlines): filedOn for a return, paidOn for a payment (a CA3, CA12 or 1329-DEF takes both), the amount in euros, a reference of the receipt (accusé de réception, avis) and a note; notDue true when a conditional deadline does not apply (acompte under its threshold). Only the fields given change; null clears one. clear true removes the whole record. Dates cannot be in the future. Facts recorded elsewhere are refused with the page where they go: VAT returns (record_tax_filing), the 2065 and the IS acomptes (Impôt sur les sociétés), the approval and filing of the accounts (Approbation des comptes). Returns the deadline with its new status. ${SETTLES} ${TWO_STEP}`,
  input: {
    deadlineId: z.string().max(100).regex(DEADLINE_ID_PATTERN, 'Échéance inconnue').describe('Deadline id, e.g. cfe:2026, is-solde:2026-12-31, cvae-acompte:2026:1.'),
    filedOn: day.nullable().optional().describe('Day the return was filed (yyyy-mm-dd); null clears it.'),
    paidOn: day.nullable().optional().describe('Day the payment was made (yyyy-mm-dd); null clears it.'),
    amount: eurosInput.min(0).nullable().optional().describe('Amount filed or paid, in euros; null clears it.'),
    notDue: z.boolean().optional().describe('true: the deadline does not apply this time (clears the dates).'),
    attachmentReference: z.string().max(200).nullable().optional().describe('Reference of the receipt kept elsewhere.'),
    note: z.string().max(1000).nullable().optional().describe('Free note.'),
    clear: z.boolean().optional().describe('true: remove the whole record of this deadline (other fields ignored).'),
  },
  permission: DECLARATIONS_WRITE,
  amounts: 'euros',
  units: 'Dates as yyyy-mm-dd.',
  never: 'files or submits a return, pays a tax, posts or validates an entry.',
  idempotent: true,
  confirmation: true,
  // The deadline's status is in the dry run (bound to the approval); the company lock serializes the record.
  targetState: ({ companyId }) => [companyLock(companyId)],
  async preview(args) {
    if (!args.clear && DECLARATION_FIELDS.every((f) => args[f] === undefined)) throw new ValidationError('Indiquez au moins une date, un montant, une note ou notDue.')
    const current = await getTrackedDeadline(args.companyId, args.deadlineId)
    return {
      deadline: deadlineStatusJson(current),
      change: args.clear
        ? { clear: true }
        : Object.fromEntries(DECLARATION_FIELDS.filter((f) => args[f] !== undefined).map((f) => [f, args[f]])),
      effect: args.clear
        ? 'L’enregistrement de cette échéance sera retiré\u00a0: elle redeviendra à faire si elle est due.'
        : 'L’échéance sera enregistrée comme indiqué\u00a0: elle ne sera plus rappelée comme à faire. Rien n’est déposé ni payé par Kledg.',
    }
  },
  async execute(args, ctx) {
    if (args.clear) {
      const tracked = await clearDeclaration(args.companyId, args.deadlineId, { source: 'mcp' })
      return {
        deadline: deadlineStatusJson(tracked),
        changes: { deadlineId: args.deadlineId, cleared: true, status: tracked.status.status },
        reviewUrl: kledgPageUrl(args.companyId, 'echeances'),
        message: `Enregistrement retiré\u00a0: l’échéance est « ${tracked.status.label} ».`,
      }
    }
    if (DECLARATION_FIELDS.every((f) => args[f] === undefined)) throw new ValidationError('Indiquez au moins une date, un montant, une note ou notDue.')
    const tracked = await markDeclaration(
      args.companyId,
      {
        deadlineId: args.deadlineId,
        filedOn: args.filedOn,
        paidOn: args.paidOn,
        amountCents: args.amount === undefined || args.amount === null ? args.amount : centsFromEuros(args.amount, 'Montant'),
        notDue: args.notDue,
        attachmentReference: args.attachmentReference === undefined ? undefined : args.attachmentReference?.trim() || null,
        note: args.note === undefined ? undefined : args.note?.trim() || null,
      },
      { userId: ctx.access.user.id, source: 'mcp' },
    )
    return {
      deadline: deadlineStatusJson(tracked),
      changes: { deadlineId: args.deadlineId, status: tracked.status.status, filedOn: tracked.status.filedOn, paidOn: tracked.status.paidOn },
      reviewUrl: kledgPageUrl(args.companyId, 'echeances'),
      message: `Échéance enregistrée\u00a0: « ${tracked.status.label} ».`,
    }
  },
  audit: (args, result) => ({ deadlineId: args.deadlineId, status: result.changes.status }),
})

const euros = (value: Parameters<typeof parseCents>[0] | null) => (value === null ? null : fromCents(parseCents(value) ?? 0))

/** What Kledg holds today for the filing the call records or removes (the dry run). */
async function currentFiling(companyId: string, tax: 'vat' | 'corporate_tax', key: string | undefined) {
  if (!key) return null
  if (tax === 'vat') {
    const filing = await prisma.vatReturnFiling.findFirst({
      where: { companyId, periodKey: key },
      select: { periodKey: true, form: true, filedOn: true, amountDue: true, creditAmount: true },
    })
    return filing && { period: filing.periodKey, form: filing.form, filedOn: calendarDayOf(filing.filedOn), amountDue: euros(filing.amountDue), credit: euros(filing.creditAmount) }
  }
  const filing = await prisma.corporateTaxReturn.findFirst({
    where: { companyId, fiscalYearId: key, filedOn: { not: null } },
    select: { fiscalYearId: true, filedOn: true, resultBeforeDeficits: true, deficitsImputed: true, corporateTax: true, reducedRate: true },
  })
  return (
    filing && {
      fiscalYearId: filing.fiscalYearId,
      filedOn: filing.filedOn ? calendarDayOf(filing.filedOn) : null,
      resultBeforeDeficits: euros(filing.resultBeforeDeficits),
      deficitsImputed: euros(filing.deficitsImputed),
      corporateTax: euros(filing.corporateTax),
      reducedRate: filing.reducedRate,
    }
  )
}

export const recordTaxFilingTool = fullControlTool({
  name: 'record_tax_filing',
  title: 'Enregistrer le dépôt d’une déclaration',
  level: 'write',
  description: `Records that the user filed a return on impots.gouv.fr, or removes that record (action remove): tax vat for a VAT return (period aaaa-mm, aaaa-Tn or aaaa; filing date, amount paid and credit carried forward), tax corporate_tax for the corporate tax return of a fiscal year (filing date, result before deficits, deficits imputed, tax, reduced rate). The deadlines then show it filed; with the automatic closing after a VAT filing, the periods it covers are closed. Other deadlines are marked with mark_declaration. ${SETTLES} ${TWO_STEP}`,
  input: {
    tax: z.enum(['vat', 'corporate_tax']),
    action: z.enum(['record', 'remove']).default('record'),
    vat: assistantInput(VatFilingBodySchema).optional().describe('tax vat, action record: the filing (period, filedOn, amountDue, credit).'),
    corporateTax: assistantInput(CorporateTaxFilingBodySchema).optional().describe('tax corporate_tax, action record: the filing.'),
    period: z.string().max(20).optional().describe('tax vat, action remove: the period.'),
    fiscalYearId: z.string().max(100).optional().describe('tax corporate_tax, action remove: the fiscal year.'),
  },
  permission: { entries: ['create'] },
  amounts: 'euros',
  units: 'Dates as yyyy-mm-dd.',
  never: 'files or pays anything on impots.gouv.fr, and never books an entry.',
  destructive: true,
  idempotent: true,
  confirmation: true,
  // The current record is in the dry run (bound to the approval); the company lock serializes the record.
  targetState: ({ companyId }) => [companyLock(companyId)],
  async preview(args) {
    const vat = args.tax === 'vat'
    const given = (vat ? args.vat : args.corporateTax) as { period?: string; fiscalYearId?: string } | undefined
    const key = vat ? (args.action === 'remove' ? args.period : given?.period) : args.action === 'remove' ? args.fiscalYearId : given?.fiscalYearId
    const company = vat ? await prisma.company.findUnique({ where: { id: args.companyId }, select: { deadlineSettings: true } }) : null
    const closesPeriods = vat && args.action === 'record' && parseDeadlineSettings(company?.deadlineSettings).periodAutoLock === 'after_vat_filing'
    return {
      tax: args.tax,
      action: args.action,
      current: await currentFiling(args.companyId, args.tax, key),
      filing: args.action === 'record' ? (given ?? null) : null,
      effect:
        args.action === 'remove'
          ? 'L’enregistrement du dépôt sera retiré\u00a0: l’échéance redeviendra à faire.'
          : `Le dépôt sera enregistré\u00a0: l’échéance ne sera plus rappelée comme à faire.${closesPeriods ? ' La clôture automatique après la déclaration de TVA est active\u00a0: les périodes couvertes seront clôturées.' : ''} Rien n’est déposé ni payé par Kledg.`,
    }
  },
  async execute(args, ctx) {
    const options = { userId: ctx.access.user.id }
    const page = args.tax === 'vat' ? 'declarations-tva' : 'impot-societes'
    let changes: unknown
    if (args.tax === 'vat') {
      changes =
        args.action === 'remove'
          ? await deleteVatFiling(args.companyId, routeBody(VatFilingQuerySchema, { period: args.period }).period)
          : await recordVatFiling(args.companyId, routeBody(VatFilingBodySchema, args.vat ?? {}), options)
    } else {
      changes =
        args.action === 'remove'
          ? await deleteCorporateTaxFiling(args.companyId, routeBody(CorporateTaxFilingQuerySchema, { fiscalYearId: args.fiscalYearId }).fiscalYearId)
          : await recordCorporateTaxFiling(args.companyId, routeBody(CorporateTaxFilingBodySchema, args.corporateTax ?? {}), options)
    }
    return {
      changes: forAssistant(changes),
      reviewUrl: kledgPageUrl(args.companyId, page),
      message: args.action === 'remove' ? 'Enregistrement du dépôt retiré.' : 'Dépôt enregistré\u00a0: rien n’a été déposé ni payé par Kledg.',
    }
  },
  audit: (args) => ({
    tax: args.tax,
    action: args.action,
    period: args.period ?? (args.vat as { period?: string } | undefined)?.period ?? null,
    fiscalYearId: args.fiscalYearId ?? (args.corporateTax as { fiscalYearId?: string } | undefined)?.fiscalYearId ?? null,
  }),
})

/**
 * Registers the two record tools for every connection that may write: a
 * draft-level connection always waits for the user's approval in Kledg
 * (registerFullControlTool, `level: 'write'`).
 */
export function registerFilingTools(server: McpServer, access: McpAccess, guard: CompanyGuard): void {
  if (!access.canWrite) return
  registerFullControlTool(server, access, guard, markDeclarationTool)
  registerFullControlTool(server, access, guard, recordTaxFilingTool)
}
