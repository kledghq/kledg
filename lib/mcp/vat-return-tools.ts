/**
 * Read tool of the VAT return worksheet (lib/vat-returns,
 * docs/declarations-tva.md): get_vat_return. Same rule as
 * GET /api/companies/[id]/vat-returns: the company guard with
 * VAT_RETURN_READ (reports:read), then the service computes the CA3 or the
 * CA12 of a period from the validated entries, with the form line numbers,
 * the checks and what stays to fill by hand. Kledg prepares; the user
 * files the return on impots.gouv.fr.
 */

import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { CompanyGuard } from '@/lib/mcp/company-access'
import { json, run } from '@/lib/mcp/tool-result'
import { parseInput } from '@/lib/api/zod-fields'
import { READ_ONLY, describeTool, kledgPageUrl } from '@/lib/mcp/tool-meta'
import { loadVatReturn } from '@/lib/vat-returns/load-vat-return.service'
import { PERIOD_KEY_PATTERN } from '@/lib/vat-returns/periods'
import { VAT_RETURN_READ } from '@/lib/vat-returns/permissions'
import { fromCents } from '@/lib/utils/money'

const euros = (cents: number | null) => (cents === null ? null : fromCents(cents))

const InputSchema = z.object({
  companyId: z.string().min(1, 'La société est requise').describe('Company id, from list_companies.'),
  period: z.string().regex(PERIOD_KEY_PATTERN, 'Période invalide : aaaa-mm, aaaa-Tn ou aaaa.').optional().describe('yyyy-mm, yyyy-Tn or yyyy; the return due next by default.'),
})

export function registerVatReturnReadTools(server: McpServer, guard: CompanyGuard) {
  server.registerTool(
    'get_vat_return',
    {
      title: 'Préparation de la déclaration de TVA',
      description: describeTool({
        summary:
          'Prepares the VAT return of a period from the validated entries: the CA3 (3310-CA3-SD, réel normal, monthly or quarterly) or the CA12 (3517-S-SD, réel simplifié, annual with the July and December acomptes). Returns each line with its form code (A1, 08, 16, 20, 28...) and box code, the amounts of the books and the whole euros to type, which lines Kledg computed and which the user fills by hand, the amount due or the credit, the deadline, the consistency checks (draft entries, unreconciled bank lines, VAT rates not identified, VAT accounts not settled, 4455 against the previous return), whether the figures are reliable, the settlement draft prepared if any and the official sources. status exempt: franchise en base, no return to file. period: yyyy-mm (monthly CA3), yyyy-Tn (quarterly CA3) or yyyy (CA12); by default the return due next. Kledg never files a return: the user files it on impots.gouv.fr.',
        access: 'read',
        permission: VAT_RETURN_READ,
        amounts: 'euros',
        units: 'Form amounts (base, amount, due, credit) are whole euros as the form wants them; books amounts are euros with cents. Dates as yyyy-mm-dd.',
        never: 'files or submits a return, pays a tax, posts an entry or changes the books.',
      }),
      inputSchema: InputSchema,
      annotations: READ_ONLY,
    },
    (raw: unknown) =>
      run(async () => {
        const args = parseInput(InputSchema, raw)
        await guard.require(args.companyId, VAT_RETURN_READ)
        const view = await loadVatReturn(args.companyId, { period: args.period })
        const c = view.computation
        return json({
          status: view.status,
          today: view.today,
          period: view.period,
          form: view.formTitle,
          deadline: view.deadline,
          reliable: view.reliable,
          result: c ? { kind: c.result.kind, due: c.result.dueEuros, credit: c.result.creditEuros, booksNet: euros(c.result.booksNetCents) } : null,
          lines: (c?.lines ?? []).map((l) => ({
            code: l.code,
            box: l.box,
            label: l.label,
            base: l.base,
            amount: l.amount,
            booksBase: euros(l.baseCents),
            booksAmount: euros(l.amountCents),
            source: l.status,
            hint: l.hint,
          })),
          acomptes: c?.acomptes
            ? { paid: euros(c.acomptes.paidCents), nextBase: c.acomptes.nextBaseEuros, nextDue: c.acomptes.nextDue, nextJuly: c.acomptes.nextJulyEuros, nextDecember: c.acomptes.nextDecemberEuros }
            : null,
          checks: view.checks.map((check) => ({ id: check.id, severity: check.severity, title: check.title, detail: check.detail, items: check.items ?? [] })),
          settlement: view.settlement,
          filing: view.filing ? { filedOn: view.filing.filedOn, amountDue: euros(view.filing.amountDueCents), credit: euros(view.filing.creditCents) } : null,
          toFillByHand: view.notFromTheBooks,
          periods: view.periods.map((p) => ({ period: p.id, label: p.label, form: p.form, filed: p.filed })),
          sources: view.sources,
          reviewUrl: kledgPageUrl(args.companyId, view.period ? `declarations-tva?periode=${view.period.id}` : 'declarations-tva'),
        })
      }),
  )
}
