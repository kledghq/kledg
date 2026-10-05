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
 *
 * The tools of the group space (docs/vue-groupe.md) follow the same rules:
 * get_group_companies, get_group_indicators, get_group_evolution,
 * get_group_treasury, get_group_shareholders, get_group_deadlines,
 * get_group_alerts, list_group_transactions and get_group_ledger. All read
 * only; aggregates are labelled as such, never as consolidated accounts.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { CompanyGuard, McpAccess } from "@/lib/mcp/company-access";
import { json, run } from "@/lib/mcp/tool-result";
import { describeTool, READ_ONLY } from "@/lib/mcp/tool-meta";
import type { GroupAccess } from "@/lib/management-fees/access";
import type { KeyFigures } from "@/lib/group/combine";
import { getGroupView } from "@/lib/group/get-group-view.service";
import { getParticipations } from "@/lib/group/get-participations.service";
import { getGroupAlerts } from "@/lib/group/get-group-alerts.service";
import { getGroupCompanies } from "@/lib/group/get-group-companies.service";
import { getGroupDeadlines } from "@/lib/group/get-group-deadlines.service";
import { getGroupEvolution } from "@/lib/group/get-group-evolution.service";
import { getGroupIndicators } from "@/lib/group/get-group-indicators.service";
import { getGroupLedger } from "@/lib/group/get-group-ledger.service";
import { getGroupPersons } from "@/lib/group/get-group-persons.service";
import { getGroupTreasury } from "@/lib/group/get-group-treasury.service";
import {
  DEFAULT_GROUP_TRANSACTIONS_PAGE,
  listGroupTransactions,
  MAX_GROUP_TRANSACTIONS_PAGE,
} from "@/lib/group/list-group-transactions.service";
import type { FinancialIndicators } from "@/lib/reports/financial-indicators/indicators";
import {
  FLOW_CATEGORY_LABELS,
  INDICATIVE_NOTICE,
  PARTICIPATION_KIND_LABELS,
} from "@/lib/group/labels";
import { fromCents } from "@/lib/utils/money";

const input = z.object({
  companyId: z.string().describe("Holding company id, from list_companies."),
  fiscalYearId: z
    .string()
    .optional()
    .describe(
      "Holding's fiscal year id, from list_fiscal_years. Defaults to the current fiscal year.",
    ),
});

const euros = (cents: number | null) =>
  cents === null ? null : fromCents(cents);
const pct = (bp: number | null) => (bp === null ? null : bp / 100);

function figures(f: KeyFigures | null) {
  if (!f) return null;
  return {
    revenue: fromCents(f.chiffreAffairesCents),
    ebitda: fromCents(f.ebeCents),
    netResult: fromCents(f.resultatCents),
    cash: fromCents(f.tresorerieCents),
    equity: fromCents(f.capitauxPropresCents),
    financialDebt: fromCents(f.endettementCents),
    balanceSheetTotal: fromCents(f.totalBilanCents),
  };
}

function indicators(i: FinancialIndicators | null) {
  if (!i) return null;
  return {
    revenue: fromCents(i.sig.chiffreAffairesCents),
    valueAdded: fromCents(i.sig.valeurAjouteeCents),
    ebitda: fromCents(i.sig.ebeCents),
    operatingResult: fromCents(i.sig.resultatExploitationCents),
    netResult: fromCents(i.sig.resultatExerciceCents),
    selfFinancingCapacity: fromCents(i.caf.cafCents),
    workingCapitalRequirement: fromCents(i.bilan.bfrCents),
    netCash: fromCents(i.bilan.tresorerieNetteCents),
    financialDebt: fromCents(i.bilan.dettesFinancieresCents),
    equity: fromCents(i.bilan.capitauxPropresCents),
    ebitdaMargin: i.ratios.margeEbe,
    netMargin: i.ratios.margeNette,
    gearing: i.ratios.endettement,
    dsoDays: i.delais.dsoDays,
    dpoDays: i.delais.dpoDays,
  };
}

const NEVER_READ_ONLY =
  "changes the books of the holding or of a subsidiary, and never reads or names a subsidiary outside the connection's companies (read only).";

export function registerGroupTools(
  server: McpServer,
  access: McpAccess,
  guard: CompanyGuard,
) {
  const group: GroupAccess = {
    userId: access.user.id,
    require: (id, permission) => guard.require(id, permission),
  };

  server.registerTool(
    "get_group_view",
    {
      title: "Vue groupe",
      description: describeTool({
        summary:
          "Combined (aggregated, 100 %) key figures of a holding and its subsidiaries for a fiscal year: revenue (accounts 70), EBITDA (EBE), net result, cash (512), equity, financial debt and balance sheet total per company and summed; the intragroup flows found in the books (management fees, invoices between group companies by SIREN, current accounts 451/455, loans, dividends 761) and the figures after eliminating them, with the gaps when both sides disagree. An indicative combined view, not consolidated accounts (no minority interests, investments not eliminated against equity). Subsidiaries the connection cannot read are counted, not read.",
        access: "read",
        permission: { reports: ["read"] },
        amounts: "euros",
        units: "Percentages in percent.",
        never:
          "changes the books of the holding or of a subsidiary, and never reads or names a subsidiary outside the connection's companies (read only).",
      }),
      inputSchema: input,
      annotations: READ_ONLY,
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { reports: ["read"] });
        const view = await getGroupView(
          args.companyId,
          { fiscalYearId: args.fiscalYearId },
          group,
        );
        const names = new Map(view.members.map((m) => [m.id, m.name]));
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
          notAccessibleNames: view.unreachable.flatMap((u) =>
            u.name ? [u.name] : [],
          ),
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
          dividends: view.eliminations.dividends.map((d) => ({
            receiver: names.get(d.receiverId),
            payer: names.get(d.payerId),
            amount: fromCents(d.cents),
          })),
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
            .map((f) => ({
              company: names.get(f.companyId),
              counterparty: names.get(f.counterpartyId),
              kind: FLOW_CATEGORY_LABELS[f.category],
              reference: f.reference,
              amount: fromCents(f.cents),
            })),
          cashByMonth: view.treasury.map((t) => ({
            month: t.month,
            total: fromCents(t.totalCents),
          })),
          investmentsNotEliminated: fromCents(view.titresParticipationCents),
          warnings: view.warnings,
        });
      }),
  );

  server.registerTool(
    "get_participations",
    {
      title: "Filiales et participations",
      description: describeTool({
        summary:
          "The holding's subsidiaries and participations for a fiscal year (forms 2059-G-SD / 2033-G-SD, annexe): category (more than 50 %: filiale, 10 to 50 %: participation), percentage held, number of shares, gross and net book value of the investments (261, 2961), the subsidiary's capital, equity, revenue and result, the share of its equity, loans and advances granted, dividends received. Investment accounts whose label names no readable subsidiary are listed apart. Subsidiaries the connection cannot read are counted, not read.",
        access: "read",
        permission: { reports: ["read"] },
        amounts: "euros",
        units: "Percentages in percent.",
        never:
          "changes the books of the holding or of a subsidiary, and never reads or names a subsidiary outside the connection's companies (read only).",
      }),
      inputSchema: input,
      annotations: READ_ONLY,
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { reports: ["read"] });
        const report = await getParticipations(
          args.companyId,
          { fiscalYearId: args.fiscalYearId },
          group,
        );
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
          unattributedInvestments: report.unattributed.map((u) => ({
            account: u.accountCode,
            label: u.label,
            amount: fromCents(u.cents),
          })),
          notAccessibleSubsidiaries: report.unreachable.length,
          totals: {
            bookValueGross: fromCents(report.totals.bookValueGrossCents),
            depreciation: fromCents(report.totals.depreciationCents),
            bookValueNet: fromCents(report.totals.bookValueNetCents),
            dividendsReceived: fromCents(report.totals.dividendsCents),
          },
        });
      }),
  );

  const holdingOnly = z.object({
    companyId: z.string().describe("Holding company id, from list_companies."),
  });

  server.registerTool(
    "get_group_companies",
    {
      title: "Sociétés du groupe",
      description: describeTool({
        summary:
          "The companies of a holding's group the connection can read: legal form, SIREN, the holding's stake, the officers recorded in the latest approval of the accounts, and the key figures of the fiscal year matched to the holding's (revenue, EBITDA, net result, cash, equity, financial debt, balance sheet total). Subsidiaries the connection cannot read are counted, not read.",
        access: "read",
        permission: { reports: ["read"] },
        amounts: "euros",
        units: "Percentages in percent.",
        never: NEVER_READ_ONLY,
      }),
      inputSchema: input,
      annotations: READ_ONLY,
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { reports: ["read"] });
        const report = await getGroupCompanies(args.companyId, { fiscalYearId: args.fiscalYearId }, group);
        return json({
          holding: report.holding,
          fiscalYear: report.fiscalYear,
          companies: report.companies.map((c) => ({
            id: c.company.id,
            name: c.company.name,
            role: c.company.role,
            siren: c.siren,
            legalForm: c.legalForm ?? c.legalType,
            ownershipPercent: pct(c.company.ownershipBp),
            officers: c.officers,
            fiscalYear: c.fiscalYear,
            figures: figures(c.figures),
          })),
          notAccessibleSubsidiaries: report.unreachable.length,
          warnings: report.warnings,
        });
      }),
  );

  server.registerTool(
    "get_group_indicators",
    {
      title: "Indicateurs du groupe",
      description: describeTool({
        summary:
          "Financial indicators of every company of a holding's group, for the fiscal year matched to the holding's (N) and the one before (N-1): revenue, value added, EBITDA, operating and net result, self-financing capacity (CAF), working capital requirement, net cash, financial debt, equity, margins, gearing, DSO and DPO. Plus the aggregate of the group: the same indicators on the companies' accounts added up at 100 %, intragroup flows not eliminated (not consolidated accounts).",
        access: "read",
        permission: { reports: ["read"] },
        amounts: "euros",
        units: "Margins and gearing are fractions (0.25 for 25 %); delays in days.",
        never: NEVER_READ_ONLY,
      }),
      inputSchema: input,
      annotations: READ_ONLY,
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { reports: ["read"] });
        const report = await getGroupIndicators(args.companyId, { fiscalYearId: args.fiscalYearId }, group);
        return json({
          notice: report.notice,
          holding: report.holding,
          fiscalYear: report.fiscalYear,
          companies: report.members.map((m) => ({
            id: m.company.id,
            name: m.company.name,
            fiscalYear: m.fiscalYear,
            previousFiscalYear: m.previousFiscalYear,
            current: indicators(m.current),
            previous: indicators(m.previous),
          })),
          aggregate: { current: indicators(report.combined.current), previous: indicators(report.combined.previous) },
          notAccessibleSubsidiaries: report.unreachable.length,
          warnings: report.warnings,
        });
      }),
  );

  server.registerTool(
    "get_group_evolution",
    {
      title: "Évolution du groupe",
      description: describeTool({
        summary:
          "Month by month over the holding's fiscal year: income (class 7), expenses (class 6), result and cash (512 at month end) of every company of the group the connection can read, and their sum (an aggregate, intragroup flows included).",
        access: "read",
        permission: { reports: ["read"] },
        amounts: "euros",
        units: "Months as yyyy-mm.",
        never: NEVER_READ_ONLY,
      }),
      inputSchema: input,
      annotations: READ_ONLY,
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { reports: ["read"] });
        const report = await getGroupEvolution(args.companyId, { fiscalYearId: args.fiscalYearId }, group);
        const names = new Map(report.companies.map((c) => [c.id, c.name]));
        return json({
          holding: report.holding,
          fiscalYear: report.fiscalYear,
          months: report.months.map((m) => ({
            month: m.month,
            total: { income: fromCents(m.total.produitsCents), expenses: fromCents(m.total.chargesCents), result: fromCents(m.total.resultatCents), cash: euros(m.total.tresorerieCents) },
            byCompany: Object.entries(m.byCompany).map(([id, f]) => ({
              company: names.get(id),
              income: fromCents(f.produitsCents),
              expenses: fromCents(f.chargesCents),
              result: fromCents(f.resultatCents),
              cash: euros(f.tresorerieCents),
            })),
          })),
          notAccessibleSubsidiaries: report.unreachable.length,
          warnings: report.warnings,
        });
      }),
  );

  server.registerTool(
    "get_group_treasury",
    {
      title: "Trésorerie du groupe",
      description: describeTool({
        summary:
          "Treasury of a holding's group: the bank accounts of every company the connection can read (masked IBAN, balance last reported by the bank, currency), totals by currency, the books' cash (512) per month, and the current accounts and loans between companies of the group (451, 455, 267, 168) with the gap when both sides disagree.",
        access: "read",
        permission: { reports: ["read"] },
        amounts: "euros",
        never: NEVER_READ_ONLY,
      }),
      inputSchema: input,
      annotations: READ_ONLY,
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { reports: ["read"] });
        const report = await getGroupTreasury(args.companyId, { fiscalYearId: args.fiscalYearId }, group);
        const names = new Map(report.companies.map((c) => [c.company.id, c.company.name]));
        return json({
          holding: report.holding,
          fiscalYear: report.fiscalYear,
          companies: report.companies.map((c) => ({
            name: c.company.name,
            bankBalanceEur: fromCents(c.bankEurCents),
            ledgerCash: euros(c.ledgerCents),
            accounts: c.accounts.map((a) => ({ name: a.name, iban: a.maskedIban, currency: a.currency, balance: fromCents(a.balanceCents), lastSyncedAt: a.lastSyncedAt })),
          })),
          totalsByCurrency: report.totalsByCurrency.map((t) => ({ currency: t.currency, balance: fromCents(t.balanceCents) })),
          cashByMonth: report.months.map((m) => ({ month: m.month, total: fromCents(m.totalCents) })),
          currentAccounts: report.currentAccounts.map((b) => ({
            creditor: names.get(b.creditorId),
            debtor: names.get(b.debtorId),
            receivable: fromCents(b.receivableCents),
            payable: fromCents(b.payableCents),
            gap: fromCents(b.gapCents),
          })),
          notAccessibleSubsidiaries: report.unreachable.length,
          warnings: report.warnings,
        });
      }),
  );

  server.registerTool(
    "get_group_shareholders",
    {
      title: "Associés et dirigeants du groupe",
      description: describeTool({
        summary:
          "Who holds shares in the companies of a holding's group (natural persons, companies, other legal persons) with their direct, indirect (through the holding and the other companies of the group) and total percentage in each company, and the officers recorded in each company's latest approval of the accounts. Names only: no birth details, address or contact, no photo.",
        access: "read",
        permission: { reports: ["read"] },
        amounts: "none",
        units: "Percentages in percent.",
        never: NEVER_READ_ONLY,
      }),
      inputSchema: holdingOnly,
      annotations: READ_ONLY,
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { reports: ["read"] });
        const report = await getGroupPersons(args.companyId, group);
        const names = new Map(report.companies.map((c) => [c.id, c.name]));
        return json({
          holding: report.holding,
          holders: report.holders.map((h) => ({
            name: h.name ?? "Filiale non accessible",
            kind: h.kind,
            officerOf: h.titles.map((t) => ({ company: names.get(t.companyId), title: t.title })),
            holdings: h.interests.map((i) => ({ company: names.get(i.companyId), directPercent: pct(i.directBp), indirectPercent: pct(i.indirectBp), totalPercent: pct(i.totalBp), shares: i.shares })),
          })),
          notAccessibleSubsidiaries: report.unreachable.length,
          warnings: report.warnings,
        });
      }),
  );

  server.registerTool(
    "get_group_deadlines",
    {
      title: "Impôts et échéances du groupe",
      description: describeTool({
        summary:
          "The tax and legal deadlines of every company of a holding's group the connection can read (VAT, corporate tax, CFE and CVAE, approval and filing of the accounts), for the fiscal year matched to the holding's, with the status from each company's declarations tracker (à faire, déposée, payée, en retard, non due) and a summary per kind.",
        access: "read",
        permission: { reports: ["read"] },
        amounts: "euros",
        never: "records a status (it is recorded in each company) and never reads or names a subsidiary outside the connection's companies (read only).",
      }),
      inputSchema: input,
      annotations: READ_ONLY,
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { reports: ["read"] });
        const report = await getGroupDeadlines(args.companyId, { fiscalYearId: args.fiscalYearId }, group);
        const names = new Map(report.companies.map((c) => [c.company.id, c.company.name]));
        return json({
          holding: report.holding,
          fiscalYear: report.fiscalYear,
          today: report.today,
          totals: report.totals,
          companies: report.companies.map((c) => ({ name: c.company.name, missingVatRegime: c.missingRegimes, summary: c.summary })),
          deadlines: report.deadlines.map((d) => ({
            company: names.get(d.companyId),
            date: d.date,
            label: d.label,
            form: d.form,
            status: d.statusLabel,
            settled: d.settled,
            amount: euros(d.amountCents),
          })),
          notAccessibleSubsidiaries: report.unreachable.length,
          warnings: report.warnings,
        });
      }),
  );

  server.registerTool(
    "get_group_alerts",
    {
      title: "Alertes du groupe",
      description: describeTool({
        summary:
          "What needs attention in a holding's group: per company the connection can read, the late declarations of the tracker, the bank transactions still to reconcile and the draft entries, with the list of late declarations.",
        access: "read",
        permission: { reports: ["read"] },
        amounts: "none",
        never: NEVER_READ_ONLY,
      }),
      inputSchema: holdingOnly,
      annotations: READ_ONLY,
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { reports: ["read"] });
        const report = await getGroupAlerts(args.companyId, group);
        const names = new Map(report.companies.map((c) => [c.company.id, c.company.name]));
        return json({
          totals: report.totals,
          companies: report.companies.map((c) => ({ name: c.company.name, lateDeclarations: c.overdue, transactionsToReconcile: c.unreconciled, draftEntries: c.drafts })),
          lateDeclarations: report.overdue.map((d) => ({ company: names.get(d.companyId), label: d.label, form: d.form, dueOn: d.date })),
          notAccessibleSubsidiaries: report.unreachable.length,
          warnings: report.warnings,
        });
      }),
  );

  server.registerTool(
    "list_group_transactions",
    {
      title: "Transactions du groupe",
      description: describeTool({
        summary:
          "The bank transactions of every company of a holding's group the connection can read, in one list, newest first, page by page (pass nextCursor back as cursor). Filters: one company of the group, text, direction, reconciled or not, period.",
        access: "read",
        permission: { reports: ["read"] },
        amounts: "euros",
        units: "Amounts are positive; side says debit (money out) or credit (money in).",
        never: "reconciles or changes a transaction, and never reads or names a subsidiary outside the connection's companies (read only).",
      }),
      inputSchema: holdingOnly.extend({
        company: z.string().optional().describe("Id of one company of the group; every company read by default."),
        search: z.string().max(200).optional().describe("Text in the label, counterparty or reference."),
        side: z.enum(["debit", "credit"]).optional(),
        reconciled: z.boolean().optional(),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("First day, yyyy-mm-dd."),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Last day, yyyy-mm-dd."),
        limit: z.number().int().min(1).max(MAX_GROUP_TRANSACTIONS_PAGE).optional().describe(`Page size, ${DEFAULT_GROUP_TRANSACTIONS_PAGE} by default.`),
        cursor: z.string().optional().describe("nextCursor of the previous page."),
      }),
      annotations: READ_ONLY,
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { reports: ["read"] });
        const { reconciled, ...rest } = args;
        const page = await listGroupTransactions(
          args.companyId,
          { ...rest, reconciled: reconciled === undefined ? undefined : reconciled ? "true" : "false" },
          group,
        );
        const names = new Map(page.companies.map((c) => [c.id, c.name]));
        return json({
          transactions: page.items.map((t) => ({
            company: names.get(t.companyId),
            companyId: t.companyId,
            date: t.date,
            label: t.label,
            counterparty: t.counterpartyName,
            amount: fromCents(t.amountCents),
            side: t.side,
            reconciled: t.reconciled,
            bankAccount: t.bankAccountName,
          })),
          nextCursor: page.nextCursor,
          notAccessibleSubsidiaries: page.unreachable.length,
        });
      }),
  );

  server.registerTool(
    "get_group_ledger",
    {
      title: "Grand livre combiné",
      description: describeTool({
        summary:
          "Combined general ledger of a holding's group for a fiscal year: every account number used by the companies the connection can read, with each company's balance and the totals (an aggregation at 100 %, intragroup flows included, not a consolidation). With account, the lines of that account number in every company, most recent first.",
        access: "read",
        permission: { reports: ["read"] },
        amounts: "euros",
        never: NEVER_READ_ONLY,
      }),
      inputSchema: input.extend({
        prefix: z.string().regex(/^\d{1,10}$/).optional().describe("Only the account numbers starting with these digits (6, 512...)."),
        account: z.string().regex(/^\d{1,20}$/).optional().describe("An account number: its lines in every company."),
      }),
      annotations: READ_ONLY,
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { reports: ["read"] });
        const report = await getGroupLedger(args.companyId, { fiscalYearId: args.fiscalYearId, prefix: args.prefix, account: args.account }, group);
        const names = new Map(report.companies.map((c) => [c.id, c.name]));
        return json({
          notice: report.notice,
          holding: report.holding,
          fiscalYear: report.fiscalYear,
          accounts: report.accounts.slice(0, 500).map((a) => ({
            account: a.code,
            label: a.label,
            byCompany: Object.entries(a.byCompany).map(([id, x]) => ({ company: names.get(id), debit: fromCents(x.debitCents), credit: fromCents(x.creditCents), balance: fromCents(x.balanceCents) })),
            total: { debit: fromCents(a.total.debitCents), credit: fromCents(a.total.creditCents), balance: fromCents(a.total.balanceCents) },
          })),
          accountsTruncated: report.accounts.length > 500,
          lines: report.detail
            ? report.detail.lines.map((l) => ({ company: names.get(l.companyId), date: l.date, journal: l.journal, entry: l.entryNumber, label: l.label, debit: fromCents(l.debitCents), credit: fromCents(l.creditCents) }))
            : null,
          linesTruncated: report.detail?.truncated ?? false,
          notAccessibleSubsidiaries: report.unreachable.length,
          warnings: report.warnings,
        });
      }),
  );
}
