/**
 * Draft-level tool of the impôt sur les sociétés (docs/impot-societes.md):
 * prepare_corporate_tax_entry prepares, through the service of
 * POST /api/companies/[id]/corporate-tax/entries and with its right
 * (entries:create), the IS charge of a fiscal year (695 / 444) or the
 * payment of an acompte of the next year (444 / 512) as a DRAFT.
 * Idempotent: a matching draft is kept, a stale draft is replaced, a
 * validated entry is never touched. It never validates the entry, never
 * files a return and never pays.
 */

import { z } from 'zod'
import { ValidationError } from '@/lib/accounting/errors'
import { fromCents } from '@/lib/utils/money'
import { kledgPageUrl } from '@/lib/mcp/tool-meta'
import { companyGuard } from '@/lib/mcp/company-access'
import { mcpGroupAccess } from '@/lib/mcp/corporate-tax-tools'
import { prepareCorporateTaxEntry } from '@/lib/corporate-tax/prepare-corporate-tax-entries.service'
import { CORPORATE_TAX_WRITE } from '@/lib/corporate-tax/permissions'
import { draftTool, type RegisterDraftTool } from './define'

const prepareCorporateTaxEntryTool = draftTool({
  name: 'prepare_corporate_tax_entry',
  title: 'Préparer une écriture d’impôt sur les sociétés',
  summary:
    'Prepares as a DRAFT entry, from the worksheet of get_corporate_tax: kind charge, the IS and contribution sociale of the fiscal year (debit 695, credit 444, journal OD, last day of the year, reference IS-<year>); kind acompte with its number, the payment of that acompte of the next fiscal year (debit 444, credit 512, journal BQ, on its due date, reference IS-AC-<year>-<n>, in the next fiscal year, which must exist). Idempotent: status unchanged when the draft already matches, replaced when a stale draft was deleted and prepared again, validated when the entry is already validated (nothing changed), nothing when the amount is zero.',
  never: 'validates or posts an entry, files or submits a return, pays a tax, or changes a validated entry.',
  amounts: 'euros',
  input: {
    fiscalYearId: z.string().min(1).max(100).describe('Fiscal year of the worksheet (get_corporate_tax). For an acompte, the year whose IS is the reference; the entry goes in the next year.'),
    kind: z.enum(['charge', 'acompte']).describe('charge: the IS of the year; acompte: one acompte of the next year.'),
    number: z.number().int().min(1).max(8).optional().describe('Acompte number (1 to 4), required for kind acompte.'),
  },
  permission: CORPORATE_TAX_WRITE,
  destructive: true,
  idempotent: true,
  async execute(args, ctx) {
    if (args.kind === 'acompte' && !args.number) throw new ValidationError('Le numéro de l’acompte est requis')
    const body = args.kind === 'acompte' ? { kind: 'acompte' as const, fiscalYearId: args.fiscalYearId, number: args.number as number } : { kind: 'charge' as const, fiscalYearId: args.fiscalYearId }
    const result = await prepareCorporateTaxEntry(args.companyId, body, { source: 'mcp', access: mcpGroupAccess(ctx.access, companyGuard(ctx.access)) })
    return {
      status: result.status,
      entryId: result.entryId,
      lines: result.lines.map((l) => ({ account: l.code, label: l.label, debit: fromCents(l.debitCents), credit: fromCents(l.creditCents) })),
      changes: { status: result.status, entryId: result.entryId, entryNumber: result.entryNumber, reference: result.reference },
      reviewUrl: kledgPageUrl(args.companyId, result.entryId ? `entries/${result.entryId}` : `impot-societes?exercice=${args.fiscalYearId}`),
      message: result.message,
    }
  },
  audit: (args, result) => (result.status === 'created' || result.status === 'replaced' ? { fiscalYearId: args.fiscalYearId, kind: args.kind, entryId: result.entryId } : null),
})

export function registerCorporateTaxDraftTools(register: RegisterDraftTool): void {
  register(prepareCorporateTaxEntryTool)
}
