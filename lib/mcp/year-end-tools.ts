/**
 * Read tools of the closing work (docs/provisions-et-subventions.md):
 * get_year_end_inventory (provisions, impairments and investment grants of
 * a fiscal year with the movements to book), list_doubtful_receivables
 * (customers overdue at the closing, candidates for an impairment) and
 * get_capital_composition (shareholders, shares, percentages, nominal
 * amounts and checks). Same rule as the web UI: the company guard with
 * reports:read, then the services scope everything by company. Amounts in
 * euros. Read only: recording and assessing provisions and preparing the
 * draft entries are draft-level tools (lib/mcp/drafts/year-end.ts);
 * validating the entries stays with a person (or full control).
 */

import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { CompanyGuard } from '@/lib/mcp/company-access'
import { json, run } from '@/lib/mcp/tool-result'
import { READ_ONLY, describeTool } from '@/lib/mcp/tool-meta'
import { getYearEndInventory } from '@/lib/year-end/get-year-end-inventory.service'
import { getCapitalComposition } from '@/lib/reports/capital-composition/get-capital-composition.service'
import { DoubtfulReceivablesQuerySchema, listDoubtfulReceivables } from '@/lib/provisions/doubtful-receivables.service'
import { parseInput } from '@/lib/api/zod-fields'
import { fromCents } from '@/lib/utils/money'

const euros = (cents: number | null) => (cents === null ? null : fromCents(cents))

export function registerYearEndReadTools(server: McpServer, guard: CompanyGuard) {
  server.registerTool(
    'get_year_end_inventory',
    {
      title: 'Travaux de clôture',
      description: describeTool({
        summary:
          'Year-end inventory of a fiscal year: every provision for risks and charges (accounts 151, 152) and impairment (29 fixed assets, 39 inventories, 49 receivables, 59 securities) with its balance at the start of the year, the balance required at the closing (null when not assessed yet), the movement already booked by its year-end entry and the movement still to book (positive: dotation to 681/686/687, negative: reprise to 781/786/787), and every investment grant (131) with the share to transfer to the result this year (139 to 747) following the depreciation of the financed asset, the inalienability period or tenths. Status per item: not_in_year, to_assess, up_to_date, to_post, draft, validated, to_correct. Totals of what remains to book.',
        access: 'read',
        permission: { reports: ['read'] },
        amounts: 'euros',
        never: 'prepares, validates or posts an entry (prepare_year_end_entries prepares drafts); changes nothing (read only).',
      }),
      inputSchema: z.object({
        companyId: z.string().describe('Company id, from list_companies.'),
        fiscalYearId: z.string().describe('Fiscal year id, from list_fiscal_years.'),
        includeOutOfYear: z.boolean().default(false).describe('true: also return the items not concerned by this fiscal year (status not_in_year).'),
      }),
      annotations: READ_ONLY,
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { reports: ['read'] })
        const inventory = await getYearEndInventory(args.companyId, args.fiscalYearId)
        const keep = (status: string) => args.includeOutOfYear || status !== 'not_in_year'
        return json({
          fiscalYear: inventory.fiscalYear,
          totals: {
            dotationsToBook: fromCents(inventory.totals.dotationsCents),
            reprisesToBook: fromCents(inventory.totals.reprisesCents),
            grantTransfersToBook: fromCents(inventory.totals.transfersCents),
            itemsToAssess: inventory.totals.toAssess,
            entriesToCorrect: inventory.totals.toCorrect,
          },
          provisions: inventory.provisions
            .filter((p) => keep(p.status))
            .map((p) => ({
              id: p.id,
              category: p.category,
              label: p.label,
              account: p.accountCode,
              nature: p.nature,
              dotationAccount: p.accounts.dotation.code,
              repriseAccount: p.accounts.reprise.code,
              taxDeductible: p.taxDeductible,
              reversible: p.reversible,
              fixedAsset: p.fixedAsset ? { id: p.fixedAsset.id, label: p.fixedAsset.label, netBookValue: fromCents(p.fixedAsset.netBookValueCents) } : null,
              customer: p.tiersCode,
              openedOn: p.openedOn,
              closedOn: p.closedOn,
              openingBalance: fromCents(p.openingCents),
              requiredBalance: euros(p.requiredCents),
              booked: fromCents(p.bookedCents),
              toBook: fromCents(p.proposedCents),
              reversalRefused: p.reversalRefused,
              status: p.status,
              entry: p.entry ? { id: p.entry.id, number: p.entry.entryNumber, status: p.entry.status } : null,
            })),
          grants: inventory.grants
            .filter((g) => keep(g.status))
            .map((g) => ({
              id: g.id,
              label: g.label,
              grantor: g.grantor,
              amount: fromCents(g.amountCents),
              grantedOn: g.grantedOn,
              spreading: g.spreading,
              durationYears: g.durationYears,
              fixedAsset: g.fixedAsset ? { id: g.fixedAsset.id, label: g.fixedAsset.label } : null,
              transferredBefore: fromCents(g.transferredBeforeCents),
              booked: fromCents(g.bookedCents),
              toBook: fromCents(g.proposedCents),
              remainingInEquity: fromCents(g.remainingCents),
              status: g.status,
              entry: g.entry ? { id: g.entry.id, number: g.entry.entryNumber, status: g.entry.status } : null,
            })),
        })
      }),
  )

  server.registerTool(
    'list_doubtful_receivables',
    {
      title: 'Créances douteuses',
      description: describeTool({
        summary:
          'Customers whose invoices are overdue at the closing of a fiscal year by more than a threshold (30, 60 or 90 days, 90 by default), from the aged balance: candidates for an impairment (491) and a transfer to 416. For each: auxiliary account, accounts, everything still owed including tax, the part overdue beyond the threshold, the oldest due date and the impairment already followed in Kledg. Suggestions only: the user judges each risk (CGI art. 39, 1-5°: a probable loss assessed customer by customer); the impairment base excludes the VAT (CGI art. 272, 1).',
        access: 'read',
        permission: { reports: ['read'] },
        amounts: 'euros',
        units: 'Dates as yyyy-mm-dd, threshold in days.',
        never: 'creates an impairment or a transfer entry (create_provision records one), or changes anything (read only).',
      }),
      inputSchema: z.object({
        companyId: z.string().describe('Company id, from list_companies.'),
        fiscalYearId: z.string().describe('Fiscal year id, from list_fiscal_years: its last day is the closing.'),
        minDaysOverdue: z.enum(['30', '60', '90']).default('90'),
      }),
      annotations: READ_ONLY,
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { reports: ['read'] })
        const query = parseInput(DoubtfulReceivablesQuerySchema, { fiscalYearId: args.fiscalYearId, minDaysOverdue: args.minDaysOverdue })
        const result = await listDoubtfulReceivables(args.companyId, query)
        return json({
          asOf: result.asOf,
          minDaysOverdue: result.minDaysOverdue,
          customers: result.items.map((i) => ({
            customer: i.tiersCode,
            label: i.label,
            accounts: i.accountCodes,
            openInclTax: fromCents(i.openInclTaxCents),
            overdueInclTax: fromCents(i.overdueInclTaxCents),
            oldestDueDate: i.oldestDueDate,
            impairment: i.provision,
          })),
        })
      }),
  )

  server.registerTool(
    'get_capital_composition',
    {
      title: 'Composition du capital',
      description: describeTool({
        summary:
          'Capital composition of the company: each shareholder (natural or legal person, SIREN of a legal person) with the number of shares, the recorded percentage, the percentage computed from the shares, the nominal amount (shares x nominal value), whether it holds at least 10 % (listed on forms 2033-F and 2059-F) or more than half; totals by kind; the share capital, number of shares and nominal value of the company; the capital booked in account 101 at the end of a fiscal year; and the inconsistencies found (capital different from shares x nominal value, shares or percentages not adding up).',
        access: 'read',
        permission: { reports: ['read'] },
        amounts: 'euros',
        units: 'Percentages in percent.',
        never: 'returns personal data beyond names, or changes anything (read only).',
      }),
      inputSchema: z.object({
        companyId: z.string().describe('Company id, from list_companies.'),
        fiscalYearId: z.string().optional().describe('Fiscal year of the booked capital check; the latest one by default.'),
      }),
      annotations: READ_ONLY,
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { reports: ['read'] })
        const report = await getCapitalComposition(args.companyId, { fiscalYearId: args.fiscalYearId })
        return json({
          company: report.company,
          shareKind: report.shareKind,
          shareCapital: euros(report.capital.shareCapitalCents),
          totalShares: report.capital.totalShares,
          nominalValue: euros(report.capital.nominalCents),
          bookedCapital: report.fiscalYear ? { fiscalYear: report.fiscalYear.year, amount: euros(report.bookedCapitalCents) } : null,
          shareholders: report.rows.map((r) => ({
            name: r.name,
            kind: r.kind,
            siren: r.siren,
            shares: r.shares,
            percent: r.percentHundredths / 100,
            percentFromShares: r.sharesPercentHundredths === null ? null : r.sharesPercentHundredths / 100,
            nominalAmount: euros(r.nominalAmountCents),
            listedOnForm2033F: r.declared,
            majority: r.majority,
          })),
          totals: {
            holders: report.totals.holders,
            naturalPersons: report.totals.physical,
            legalPersons: report.totals.legal,
            shares: report.totals.shares,
            percent: report.totals.percentHundredths / 100,
            nominalAmount: euros(report.totals.nominalAmountCents),
          },
          checks: report.checks,
        })
      }),
  )
}
