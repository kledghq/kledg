/**
 * Draft-level tool of the declarations tracker (docs/echeances.md):
 * mark_declaration records, through the service of
 * PUT /api/companies/[id]/declarations/status and with its right
 * (entries:create), that the user filed and/or paid a deadline of the
 * calendar on impots.gouv.fr, with the date, the amount, a reference and a
 * note, or that it is not due; clear removes what was recorded. A record,
 * like a VAT filing record: it never files, never pays, never posts an
 * entry. Facts other modules own (VAT and IS filings, IS acomptes,
 * approval of the accounts) are refused with the page where they go.
 * Audited (MARK_DECLARATION, CLEAR_DECLARATION and MCP_WRITE).
 */

import { z } from 'zod'
import { ValidationError } from '@/lib/accounting/errors'
import { centsFromEuros, eurosInput, kledgPageUrl } from '@/lib/mcp/tool-meta'
import { deadlineStatusJson } from '@/lib/mcp/local-tax-tools'
import { DEADLINE_ID_PATTERN, clearDeclaration, markDeclaration } from '@/lib/declarations/mark-declaration.service'
import { DECLARATIONS_WRITE } from '@/lib/declarations/permissions'
import { draftTool, type RegisterDraftTool } from './define'

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide : aaaa-mm-jj')

const markDeclarationTool = draftTool({
  name: 'mark_declaration',
  title: 'Marquer une échéance déposée ou payée',
  summary:
    'Records in the declarations tracker that the user filed and/or paid a deadline of the calendar (deadlineId from list_declarations_status or list_tax_deadlines): filedOn for a return, paidOn for a payment (a CA3, CA12 or 1329-DEF takes both), the amount in euros, a reference of the receipt (accusé de réception, avis) and a note; notDue true when a conditional deadline does not apply (acompte under its threshold). Only the fields given change; null clears one. clear true removes the whole record. Dates cannot be in the future. Facts recorded elsewhere are refused with the page where they go: VAT returns (Déclarations de TVA), the 2065 and the IS acomptes (Impôt sur les sociétés), the approval and filing of the accounts (Approbation des comptes). Returns the deadline with its new status.',
  never: 'files or submits a return, pays a tax, posts or validates an entry.',
  amounts: 'euros',
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
  destructive: false,
  idempotent: true,
  async execute(args, ctx) {
    if (args.clear) {
      const tracked = await clearDeclaration(args.companyId, args.deadlineId, { source: 'mcp' })
      return {
        deadline: deadlineStatusJson(tracked),
        changes: { deadlineId: args.deadlineId, cleared: true, status: tracked.status.status },
        reviewUrl: kledgPageUrl(args.companyId, 'echeances'),
        message: `Enregistrement retiré : l’échéance est « ${tracked.status.label} ».`,
      }
    }
    const fields = ['filedOn', 'paidOn', 'amount', 'notDue', 'attachmentReference', 'note'] as const
    if (fields.every((f) => args[f] === undefined)) throw new ValidationError('Indiquez au moins une date, un montant, une note ou notDue.')
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
      message: `Échéance enregistrée : « ${tracked.status.label} ».`,
    }
  },
  audit: (args, result) => ({ deadlineId: args.deadlineId, status: result.changes.status }),
})

export function registerDeclarationDraftTools(register: RegisterDraftTool): void {
  register(markDeclarationTool)
}
