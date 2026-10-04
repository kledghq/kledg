/**
 * Draft-level tool of the VAT returns (docs/declarations-tva.md):
 * prepare_vat_settlement prepares the settlement entry of a period's
 * return as a DRAFT, through the service of
 * POST /api/companies/[id]/vat-returns/settlement, with its right
 * (entries:create). Idempotent: a matching draft is kept, a stale draft is
 * replaced, a validated settlement is never touched. It never validates
 * the entry and never files the return: the user files it on
 * impots.gouv.fr, then validates the draft in Kledg.
 */

import { z } from 'zod'
import { fromCents } from '@/lib/utils/money'
import { kledgPageUrl } from '@/lib/mcp/tool-meta'
import { prepareVatSettlement } from '@/lib/vat-returns/prepare-vat-settlement.service'
import { PERIOD_KEY_PATTERN } from '@/lib/vat-returns/periods'
import { VAT_RETURN_WRITE } from '@/lib/vat-returns/permissions'
import { draftTool, type RegisterDraftTool } from './define'

const prepareVatSettlementTool = draftTool({
  name: 'prepare_vat_settlement',
  title: 'Préparer l’écriture de liquidation de la TVA',
  summary:
    'Prepares, as a DRAFT entry in the OD journal dated on the last day of the period, the settlement of the VAT return of a period (get_vat_return): debit of the collected VAT (4457) and self-assessed VAT (4452) of the period, credit of the deductible VAT (44562, 44566, 44563), of the credit carried (44567) and, on a CA12, of the acomptes (44581), then credit of 44551 by the amount due on the form or debit of 44567 by the credit to carry; the rounding of the form to the euro goes to 658 or 758. Reference TVA-<form>-<period>. Idempotent: status unchanged when the draft already matches, replaced when a stale draft was deleted and prepared again, validated when the settlement is already validated (nothing changed), nothing when the period has no VAT.',
  never: 'validates or posts an entry, files or submits a return, pays a tax, or changes a validated entry.',
  amounts: 'euros',
  input: {
    period: z.string().regex(PERIOD_KEY_PATTERN, 'Période invalide : aaaa-mm, aaaa-Tn ou aaaa.').describe('yyyy-mm (monthly CA3), yyyy-Tn (quarterly CA3) or yyyy (CA12), from get_vat_return.'),
  },
  permission: VAT_RETURN_WRITE,
  destructive: true,
  idempotent: true,
  async execute(args) {
    const result = await prepareVatSettlement(args.companyId, args.period, { source: 'mcp' })
    return {
      status: result.status,
      entryId: result.entryId,
      lines: result.lines.map((l) => ({ account: l.code, label: l.label, debit: fromCents(l.debitCents), credit: fromCents(l.creditCents) })),
      changes: { status: result.status, entryId: result.entryId, entryNumber: result.entryNumber, reference: result.reference },
      reviewUrl: kledgPageUrl(args.companyId, result.entryId ? `entries/${result.entryId}` : `declarations-tva?periode=${args.period}`),
      message: result.message,
    }
  },
  audit: (args, result) => (result.status === 'created' || result.status === 'replaced' ? { period: args.period, entryId: result.entryId } : null),
})

export function registerVatReturnDraftTools(register: RegisterDraftTool): void {
  register(prepareVatSettlementTool)
}
