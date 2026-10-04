/**
 * Read tools of the group view (docs/vue-groupe.md): get_group_view, the
 * combined key figures of a holding and its subsidiaries with the
 * intragroup flows and the figures after eliminations, and
 * get_participations, the table of filiales et participations. Same rules
 * as the web UI: the company guard with reports:read on the holding, then
 * every subsidiary through the same guard (lib/management-fees/access.ts),
 * so the connection's company grant applies to the subsidiaries too: a
 * subsidiary outside the grant is counted as not accessible, never read
 * and never named. Amounts in euros, percentages in percent.
 */

import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { CompanyGuard, McpAccess } from '@/lib/mcp/company-access'
import { json, run } from '@/lib/mcp/tool-result'
import type { GroupAccess } from '@/lib/management-fees/access'
import type { KeyFigures } from '@/lib/group/combine'
import { getGroupView } from '@/lib/group/get-group-view.service'
import { getParticipations } from '@/lib/group/get-participations.service'
import { FLOW_CATEGORY_LABELS, INDICATIVE_NOTICE, PARTICIPATION_KIND_LABELS } from '@/lib/group/labels'
import { fromCents } from '@/lib/utils/money'

const input = z.object({
  companyId: z.string().describe('Holding company id, from list_companies.'),
  fiscalYearId: z.string().optional().describe("Holding's fiscal year id, from list_fiscal_years. Defaults to the current fiscal year."),
})

const euros = (cents: number | null) => (cents === null ? null : fromCents(cents))
const pct = (bp: number | null) => (bp === null ? null : bp / 100)

function figures(f: KeyFigures | null) {
  if (!f) return null
  return {
    revenue: fromCents(f.chiffreAffairesCents),
    ebitda: fromCents(f.ebeCents),
    netResult: fromCents(f.resultatCents),
    cash: fromCents(f.tresorerieCents),
    equity: fromCents(f.capitauxPropresCents),
    financialDebt: fromCents(f.endettementCents),
    balanceSheetTotal: fromCents(f.totalBilanCents),
  }
}

export function registerGroupTools(server: McpServer, access: McpAccess, guard: CompanyGuard) {
  const readOnly = { readOnlyHint: true, openWorldHint: false } as const
  const group: GroupAccess = { userId: access.user.id, require: (id, permission) => guard.require(id, permission) }

  server.registerTool(
    'get_group_view',
    {
      title: 'Vue groupe',
      description:
        "Combined (aggregated, 100 %) key figures of a holding and its subsidiaries for a fiscal year: revenue (accounts 70), EBITDA (EBE), net result, cash (512), equity, financial debt and balance sheet total per company and summed; the intragroup flows found in the books (management fees, invoices between group companies by SIREN, current accounts 451/455, loans, dividends 761) and the figures after eliminating them, with the gaps when both sides disagree. An indicative combined view, not consolidated accounts (no minority interests, investments not eliminated against equity). Subsidiaries the connection cannot read are counted, not read.",
      inputSchema: input,
      annotations: readOnly,
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { reports: ['read'] })
        const view = await getGroupView(args.companyId, { fiscalYearId: args.fiscalYearId }, group)
        const names = new Map(view.members.map((m) => [m.id, m.name]))
        return json({
          notice: INDICATIVE_NOTICE,
          holding: view.holding,
          fiscalYear: view.fiscalYear,
          companies: view.members.map((m) => ({
            id: m.id,
            name: m.name,
            siren: m.siren,
            role: m.role,
            ownershipPercent: pct(m.ownershipBp),
            fiscalYear: m.fiscalYear,
            samePeriodAsHolding: m.samePeriod,
            figures: figures(m.figures),
          })),
          notAccessibleSubsidiaries: view.unreachable.length,
          notAccessibleNames: view.unreachable.flatMap((u) => (u.name ? [u.name] : [])),
          combined: figures(view.combined),
          eliminationsEffect: figures(view.eliminations.effect),
          afterEliminations: figures(view.afterEliminations),
          operations: view.eliminations.operations.map((p) => ({
            seller: names.get(p.sellerId),
            buyer: names.get(p.buyerId),
            kinds: p.categories.map((c) => FLOW_CATEGORY_LABELS[c]),
            revenue: fromCents(p.revenueCents),
            charges: fromCents(p.chargeCents),
            gap: fromCents(p.gapCents),
          })),
          dividends: view.eliminations.dividends.map((d) => ({ receiver: names.get(d.receiverId), payer: names.get(d.payerId), amount: fromCents(d.cents) })),
          balances: view.eliminations.balances.map((b) => ({
            creditor: names.get(b.creditorId),
            debtor: names.get(b.debtorId),
            kinds: b.categories.map((c) => FLOW_CATEGORY_LABELS[c]),
            receivable: fromCents(b.receivableCents),
            payable: fromCents(b.payableCents),
            eliminated: fromCents(b.eliminatedCents),
            gap: fromCents(b.gapCents),
          })),
          pendingFlows: view.flows
            .filter((f) => !f.inBooks)
            .map((f) => ({ company: names.get(f.companyId), counterparty: names.get(f.counterpartyId), kind: FLOW_CATEGORY_LABELS[f.category], reference: f.reference, amount: fromCents(f.cents) })),
          cashByMonth: view.treasury.map((t) => ({ month: t.month, total: fromCents(t.totalCents) })),
          investmentsNotEliminated: fromCents(view.titresParticipationCents),
          warnings: view.warnings,
        })
      }),
  )

  server.registerTool(
    'get_participations',
    {
      title: 'Filiales et participations',
      description:
        "The holding's subsidiaries and participations for a fiscal year (forms 2059-G-SD / 2033-G-SD, annexe): category (more than 50 %: filiale, 10 to 50 %: participation), percentage held, number of shares, gross and net book value of the investments (261, 2961), the subsidiary's capital, equity, revenue and result, the share of its equity, loans and advances granted, dividends received. Investment accounts whose label names no readable subsidiary are listed apart. Subsidiaries the connection cannot read are counted, not read.",
      inputSchema: input,
      annotations: readOnly,
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { reports: ['read'] })
        const report = await getParticipations(args.companyId, { fiscalYearId: args.fiscalYearId }, group)
        return json({
          holding: report.holding,
          fiscalYear: report.fiscalYear,
          participations: report.rows.map((r) => ({
            id: r.subsidiaryId,
            name: r.name,
            siren: r.siren,
            category: PARTICIPATION_KIND_LABELS[r.kind],
            ownershipPercent: pct(r.ownershipBp),
            numberOfShares: r.numberOfShares,
            bookValueGross: fromCents(r.bookValueGrossCents),
            depreciation: fromCents(r.depreciationCents),
            bookValueNet: fromCents(r.bookValueNetCents),
            fiscalYear: r.fiscalYear,
            capital: euros(r.capitalCents),
            equity: euros(r.capitauxPropresCents),
            equityShare: euros(r.quotePartCents),
            revenue: euros(r.chiffreAffairesCents),
            netResult: euros(r.resultatCents),
            loansAndAdvances: fromCents(r.loansCents),
            dividendsReceived: fromCents(r.dividendsCents),
          })),
          unattributedInvestments: report.unattributed.map((u) => ({ account: u.accountCode, label: u.label, amount: fromCents(u.cents) })),
          notAccessibleSubsidiaries: report.unreachable.length,
          totals: {
            bookValueGross: fromCents(report.totals.bookValueGrossCents),
            depreciation: fromCents(report.totals.depreciationCents),
            bookValueNet: fromCents(report.totals.bookValueNetCents),
            dividendsReceived: fromCents(report.totals.dividendsCents),
          },
        })
      }),
  )
}
