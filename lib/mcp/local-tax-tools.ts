/**
 * Read tools of the local taxes and of the declarations tracker
 * (docs/impots-locaux.md, docs/echeances.md):
 * - get_local_taxes: the CFE (from the avis entered) and the CVAE (from
 *   the books) of a year, as GET /api/companies/[id]/local-taxes;
 * - list_declarations_status: every deadline of a fiscal year with its
 *   status (à faire, déposée, payée, en retard, non due), as the Échéances
 *   page, GET /api/deadlines.
 * Both check the company guard with reports:read first. Kledg never files
 * nor pays: the user does on impots.gouv.fr.
 */

import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { CompanyGuard } from '@/lib/mcp/company-access'
import { json, run } from '@/lib/mcp/tool-result'
import { parseInput } from '@/lib/api/zod-fields'
import { READ_ONLY, describeTool, kledgPageUrl } from '@/lib/mcp/tool-meta'
import { loadDeadlinesView } from '@/lib/deadlines/load-deadlines.service'
import { DEADLINE_CATEGORIES } from '@/lib/deadlines/types'
import { DECLARATIONS_READ } from '@/lib/declarations/permissions'
import { DECLARATION_STATUS_CODES, type TrackedDeadline } from '@/lib/declarations/status'
import { loadLocalTaxes } from '@/lib/local-taxes/load-local-taxes.service'
import { cvaeStatusText } from '@/lib/local-taxes/export-local-taxes.service'
import { LOCAL_TAXES_READ } from '@/lib/local-taxes/permissions'
import { fromCents } from '@/lib/utils/money'

const euros = (cents: number | null | undefined) => (cents === null || cents === undefined ? null : fromCents(cents))

/** A deadline with its status, as the tools return it (amounts in euros). */
export function deadlineStatusJson(d: TrackedDeadline) {
  return {
    deadlineId: d.id,
    date: d.date,
    lateAfter: d.status.lateAfter,
    label: d.label,
    form: d.form,
    category: d.category,
    rule: d.ruleId,
    kind: d.status.kind,
    status: d.status.status,
    statusLabel: d.status.label,
    settled: d.status.settled,
    filedOn: d.status.filedOn,
    paidOn: d.status.paidOn,
    amount: euros(d.status.amountCents),
    filedFrom: d.status.filedFrom,
    paidFrom: d.status.paidFrom,
    lockedFields: d.status.locked,
    recordedOn: d.status.sourcePage ? { page: d.status.sourcePage.label } : null,
    note: d.status.record?.note ?? null,
    attachment: d.status.record?.attachmentId ? { id: d.status.record.attachmentId, fileName: d.status.record.attachmentName } : null,
    attachmentReference: d.status.record?.attachmentReference ?? null,
    condition: d.condition ?? null,
    estimated: d.estimated,
  }
}

const LocalTaxesInput = z.object({
  companyId: z.string().min(1, 'La société est requise').describe('Company id, from list_companies.'),
  year: z.number().int().min(2010).max(2100).optional().describe('Calendar year of imposition; the current year by default.'),
})

const StatusInput = z.object({
  companyId: z.string().min(1, 'La société est requise').describe('Company id, from list_companies.'),
  fiscalYearId: z.string().max(64).optional().describe('Fiscal year id, from list_fiscal_years. Defaults to the current fiscal year.'),
  category: z.enum(DEADLINE_CATEGORIES).optional().describe('tva, is, liasse, cfe, cvae or juridique; all by default.'),
  status: z.enum(DECLARATION_STATUS_CODES).optional().describe('todo, filed, paid, overdue or not-due; all by default.'),
  unsettledOnly: z.boolean().default(false).describe('true: only the deadlines with something left to do.'),
})

export function registerLocalTaxReadTools(server: McpServer, guard: CompanyGuard) {
  server.registerTool(
    'get_local_taxes',
    {
      title: 'Impôts locaux (CFE, CVAE)',
      description: describeTool({
        summary:
          'The local taxes of a calendar year. CFE: the avis d’imposition the user entered (Kledg cannot compute the rental value of CGI art. 1467 nor the commune rate), the situation (creation year: no CFE; the year after: base halved, CGI art. 1478), the acompte of 15 June (50 % of last year’s CFE when it reached 3 000 €, CGI art. 1679 quinquies) and the balance of 15 December, the expected charge on 63511 by month, the cotisation minimum exemption (turnover of year N-2 of 5 000 € or less, art. 1647 D), the CFE drafts. CVAE: status of the year (in force 2024 to 2029, abolished from 2030 by loi n° 2025-127 art. 62, earlier years not covered), maximum rate (0,28 % in 2026), turnover and value added of the fiscal years closed in the year from the SIG plus 74, 75, 791 minus 65 and manual adjustments, capped at 80 or 85 % of turnover, declaration 1330 due above 152 500 €, CVAE above 500 000 €, effective rate rounded to the hundredth, dégrèvement under 2 M€, franchise of 63 €, contribution complémentaire of 2025, acomptes 1329-AC when last year’s CVAE exceeded 1 500 €. Plafonnement estimate (art. 1647 B sexies). Deadlines of both taxes with their status. Sources.',
        access: 'read',
        permission: LOCAL_TAXES_READ,
        amounts: 'euros',
        units: 'Amounts in euros with cents. Dates as yyyy-mm-dd. Rates as French percentages.',
        never: 'files a declaration, pays a tax, posts an entry or changes the books.',
      }),
      inputSchema: LocalTaxesInput,
      annotations: READ_ONLY,
    },
    (raw: unknown) =>
      run(async () => {
        const args = parseInput(LocalTaxesInput, raw)
        await guard.require(args.companyId, LOCAL_TAXES_READ)
        const view = await loadLocalTaxes(args.companyId, { year: args.year })
        const c = view.cvae.computation
        return json({
          today: view.today,
          year: view.year,
          foundationYear: view.foundationYear,
          cfe: {
            situation: view.cfe.situation,
            avis: view.cfe.avis ? { total: euros(view.cfe.avis.totalCents), acompte: euros(view.cfe.avis.acompteCents), noticeOn: view.cfe.avis.noticeOn, note: view.cfe.avis.note } : null,
            previousYear: view.cfe.previous ? { year: view.cfe.previous.year, total: euros(view.cfe.previous.totalCents) } : null,
            acompte: euros(view.cfe.schedule.acompteCents),
            acompteFrom: view.cfe.schedule.acompteFrom,
            balance: euros(view.cfe.schedule.balanceCents),
            expectedCharge: { amount: euros(view.cfe.expected.cents), source: view.cfe.expected.source, account: view.cfe.expected.account.code, months: view.cfe.expected.months.map((m) => ({ month: m.month, amount: euros(m.cents) })) },
            cotisationMinimum: { referenceYear: view.cfe.minimum.referenceYear, turnover: euros(view.cfe.minimum.turnoverCents), exempt: view.cfe.minimum.exempt },
            drafts: view.cfe.drafts,
          },
          cvae: {
            status: view.cvae.status,
            summary: cvaeStatusText(view),
            maxRate: view.cvae.maxRate,
            period: view.cvae.period,
            turnover: euros(view.cvae.books?.turnoverCents),
            turnoverAnnualized: euros(view.cvae.turnoverAnnualCents),
            valueAdded: view.cvae.books
              ? {
                  sig: euros(view.cvae.books.sigValueAddedCents),
                  subsidies: euros(view.cvae.books.subsidiesCents),
                  otherProducts: euros(view.cvae.books.otherProductsCents),
                  chargeTransfers: euros(view.cvae.books.chargeTransfersCents),
                  otherCharges: euros(view.cvae.books.otherChargesCents),
                  adjustments: view.cvae.adjustments.map((a) => ({ label: a.label, amount: euros(a.amountCents) })),
                  retained: euros(c?.valueAdded.cents),
                  capped: c?.valueAdded.capped ?? false,
                }
              : null,
            declarationRequired: c?.declarationRequired ?? false,
            taxable: c?.taxable ?? false,
            rate: c?.rateLabel ?? null,
            gross: euros(c?.grossCents),
            degrevement: euros(c?.degrevementCents),
            franchise: c?.franchise ?? false,
            cvae: euros(c?.cvaeCents),
            complementary: euros(c?.complementaryCents),
            total: euros(c?.totalCents),
            previousYear: view.cvae.previous ? { year: view.cvae.previous.year, cvae: euros(view.cvae.previous.cvaeCents) } : null,
            acomptes: { due: view.cvae.acomptes.due, each: euros(view.cvae.acomptes.eachCents) },
            hints: view.cvae.hints,
          },
          plafonnement: view.plafonnement ? { rate: `${(view.plafonnement.rate / 1000).toFixed(3).replace('.', ',')} %`, ceiling: euros(view.plafonnement.ceilingCents), possibleRelief: euros(view.plafonnement.excessCents) } : null,
          deadlines: view.deadlines.map(deadlineStatusJson),
          sources: view.sources,
          reviewUrl: kledgPageUrl(args.companyId, `impots-locaux?annee=${view.year}`),
        })
      }),
  )

  server.registerTool(
    'list_declarations_status',
    {
      title: 'Suivi des déclarations et paiements',
      description: describeTool({
        summary:
          'Lists the tax and legal deadlines of a fiscal year (the current one by default) with their status: todo (à faire), filed (déposée), paid (payée), overdue (en retard: nothing recorded after the day, or after the online filing extension), not-due (non due). kind says what the deadline asks (file, pay, file-and-pay). The status comes from what the user marked in the tracker and from the records of other modules, never entered twice: VAT filings (a CA3 or CA12 is paid with the return), corporate tax filings and acomptes paid, approval and filing of the accounts, a CFE avis of zero. lockedFields are recorded on another page (recordedOn). settled: nothing left to do.',
        access: 'read',
        permission: DECLARATIONS_READ,
        amounts: 'euros',
        units: 'Dates as yyyy-mm-dd; amounts in euros with cents.',
        never: 'files a return, pays a tax or marks a deadline (mark_declaration does, with kledg:write).',
      }),
      inputSchema: StatusInput,
      annotations: READ_ONLY,
    },
    (raw: unknown) =>
      run(async () => {
        const args = parseInput(StatusInput, raw)
        await guard.require(args.companyId, DECLARATIONS_READ)
        const view = await loadDeadlinesView(args.companyId, { fiscalYearId: args.fiscalYearId })
        const deadlines = view.deadlines
          .filter((d) => !args.category || d.category === args.category)
          .filter((d) => !args.status || d.status.status === args.status)
          .filter((d) => !args.unsettledOnly || !d.status.settled)
        const counts = Object.fromEntries(DECLARATION_STATUS_CODES.map((code) => [code, view.deadlines.filter((d) => d.status.status === code).length]))
        return json({
          today: view.today,
          fiscalYear: view.fiscalYear,
          counts,
          deadlines: deadlines.map(deadlineStatusJson),
          reviewUrl: kledgPageUrl(args.companyId, 'echeances'),
        })
      }),
  )
}
