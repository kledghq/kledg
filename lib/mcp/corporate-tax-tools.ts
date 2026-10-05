/**
 * Read tool of the impôt sur les sociétés worksheet (lib/corporate-tax,
 * docs/impot-societes.md): get_corporate_tax. Same rule as
 * GET /api/companies/[id]/corporate-tax: the company guard with
 * CORPORATE_TAX_READ (reports:read), then the service computes the tax
 * result, the IS, the acomptes of the next year and the balance from the
 * validated entries. Subsidiaries are read through the same guard (the
 * connection's grant and the user's role in each). Kledg prepares; the
 * user files the return and pays on impots.gouv.fr.
 */

import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { CompanyGuard, McpAccess } from '@/lib/mcp/company-access'
import { json, run } from '@/lib/mcp/tool-result'
import { parseInput } from '@/lib/api/zod-fields'
import { READ_ONLY, describeTool, kledgPageUrl } from '@/lib/mcp/tool-meta'
import type { GroupAccess } from '@/lib/management-fees/access'
import { loadCorporateTax } from '@/lib/corporate-tax/load-corporate-tax.service'
import { CORPORATE_TAX_DEADLINE_PATTERN } from '@/lib/corporate-tax/deadline-links'
import { CORPORATE_TAX_READ } from '@/lib/corporate-tax/permissions'
import { fromCents } from '@/lib/utils/money'

const euros = (cents: number | null) => (cents === null ? null : fromCents(cents))

const InputSchema = z.object({
  companyId: z.string().min(1, 'La société est requise').describe('Company id, from list_companies.'),
  fiscalYearId: z.string().min(1).max(100).optional().describe('Fiscal year id, from list_fiscal_years; by default the exercice whose balance is due next, else the one in progress.'),
  deadline: z.string().regex(CORPORATE_TAX_DEADLINE_PATTERN, 'Échéance inconnue').optional().describe('A deadline id from list_tax_deadlines (is-acompte, is-solde, liasse): opens the worksheet that computes it.'),
})

/** The group access of a connection: its company guard (grant, membership, role) for each subsidiary. */
export function mcpGroupAccess(access: McpAccess, guard: CompanyGuard): GroupAccess {
  return { userId: access.user.id, require: (id, permission) => guard.require(id, permission), companyIds: () => guard.companyIds() }
}

export function registerCorporateTaxReadTools(server: McpServer, access: McpAccess, guard: CompanyGuard) {
  server.registerTool(
    'get_corporate_tax',
    {
      title: 'Préparation de l’impôt sur les sociétés',
      description: describeTool({
        summary:
          'Prepares the impôt sur les sociétés of a fiscal year from the validated entries: the tax result worksheet (accounting result, reintegrations read with certainty from the accounts: IS 695, vehicle taxes 63514, fines 6582 or 6712; deductions: carry-back credit 699, dividends of subsidiaries held 5 % or more with the 5 % quote-part; manual lines), with the line of the 2033-B-SD (régime simplifié) or 2058-A-SD (régime normal); the deficits carried forward and their history (1 000 000 € plus 50 % cap, CGI art. 209); the IS at 15 % up to 42 500 € (prorated) when eligible and 25 % above (CGI art. 219), with the eligibility answers; the contribution sociale (3,3 % above 763 000 €); credits; the balance of the relevé 2572-SD and its date; the acomptes 2571-SD of the next exercice (dates, amounts, exemption at 3 000 €, CGI art. 1668); checks; what stays manual; sources. status not-subject: the company is at the impôt sur le revenu, nothing to compute. Kledg never files: the user files on impots.gouv.fr.',
        access: 'read',
        permission: CORPORATE_TAX_READ,
        amounts: 'euros',
        units: 'Amounts in euros with cents; form amounts (formEuros) in whole euros. Dates as yyyy-mm-dd.',
        never: 'files or submits a return, pays a tax, posts an entry or changes the books.',
      }),
      inputSchema: InputSchema,
      annotations: READ_ONLY,
    },
    (raw: unknown) =>
      run(async () => {
        const args = parseInput(InputSchema, raw)
        await guard.require(args.companyId, CORPORATE_TAX_READ)
        const view = await loadCorporateTax(args.companyId, { fiscalYearId: args.fiscalYearId, deadline: args.deadline }, { access: mcpGroupAccess(access, guard) })
        const c = view.computation
        return json({
          status: view.status,
          today: view.today,
          fiscalYear: view.fiscalYear,
          regime: view.regime,
          forms: view.formTitle,
          reliable: view.reliable,
          worksheet: (c?.lines ?? []).map((l) => ({ formLine: l.formLine, label: l.label, kind: l.kind, origin: l.origin, amount: euros(l.amountCents), formEuros: l.euros, hint: l.hint })),
          tax: c
            ? {
                taxableProfit: euros(c.taxableProfitCents),
                reducedRate: { applied: c.reducedRate.applied, eligible: c.eligibility.eligible, base: euros(c.reducedRate.baseCents), ceiling: euros(c.reducedRate.ceilingCents), tax: euros(c.reducedRate.taxCents) },
                normalRate: { base: euros(c.normalRate.baseCents), tax: euros(c.normalRate.taxCents) },
                corporateTax: euros(c.corporateTaxCents),
                ifEligible: euros(c.ifEligibleCents),
                socialContribution: { exempt: c.socialContribution.exempt, amount: euros(c.socialContribution.cents) },
                credits: euros(c.creditsCents),
                total: euros(c.totalCents),
                turnoverAnnualized: euros(c.eligibility.turnoverAnnualCents),
              }
            : null,
          answers: view.answers,
          deficits: c ? { ...Object.fromEntries(Object.entries(c.deficits).map(([k, v]) => [k, typeof v === 'number' ? euros(v) : v])), history: view.deficits.history.map((h) => ({ year: h.year, opening: euros(h.openingCents), imputed: euros(h.imputedCents), created: euros(h.createdCents), closing: euros(h.closingCents), basis: h.basis })) } : null,
          balance: view.balance ? { deadline: view.balance.deadline?.date ?? null, acomptesPaid: euros(view.balance.paidCents), balance: euros(view.balance.balanceCents), acomptesBooked: euros(view.balance.acomptesBookedCents) } : null,
          acomptes: view.acomptes
            ? {
                exercice: view.acomptes.exercice,
                referenceTax: euros(view.acomptes.referenceTaxCents),
                exempt: view.acomptes.exempt,
                items: view.acomptes.items.map((i) => ({ number: i.number, date: i.date, amount: euros(i.amountCents), reference: i.reference, exempt: i.exempt, note: i.note, deadlineId: i.deadlineId })),
              }
            : null,
          liasse: view.liasse,
          chargeEntry: view.charge,
          filing: view.filing,
          checks: view.checks.map((check) => ({ id: check.id, severity: check.severity, title: check.title, detail: check.detail, items: check.items ?? [] })),
          toFillByHand: view.notFromTheBooks,
          sources: view.sources,
          reviewUrl: kledgPageUrl(args.companyId, view.fiscalYear ? `impot-societes?exercice=${view.fiscalYear.id}` : 'impot-societes'),
        })
      }),
  )
}
