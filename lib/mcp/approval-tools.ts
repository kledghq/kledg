/**
 * Read tool of the approval of the accounts (docs/approbation-des-comptes.md):
 * get_year_end_formalities returns, for a fiscal year, the legal regime of the
 * company's form (who decides, officer title, majority), the deadlines, the
 * proposed allocation of the result, the resolutions with their outcome,
 * the documents of the pack with what each still misses, and the filing
 * checklist with its sources. Same rule as the web UI: the company guard
 * with reports:read, then the service scopes everything by company.
 * Amounts in euros. Read only: update_year_end_formalities
 * (lib/mcp/drafts/approval.ts) fills the details; the documents are
 * generated in the app only.
 */

import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { CompanyGuard } from '@/lib/mcp/company-access'
import { json, run } from '@/lib/mcp/tool-result'
import { READ_ONLY, describeTool } from '@/lib/mcp/tool-meta'
import { getApproval } from '@/lib/approval/get-approval.service'
import { fromCents } from '@/lib/utils/money'

export function registerApprovalReadTools(server: McpServer, guard: CompanyGuard) {
  server.registerTool(
    'get_year_end_formalities',
    {
      title: 'Approbation des comptes',
      description: describeTool({
        summary:
          "Annual approval of the accounts of a fiscal year (approbation des comptes) and their filing with the greffe, driven by the company's legal form (SARL, EURL, SAS, SASU, SA, SCI; other forms are reported as unsupported): who decides (assembly, written consultation or the associé unique) and the officer title (gérant for SARL, EURL and SCI; président for SAS and SASU), the majority rule, the approval deadline (six months after the closing where the law sets it), the convocation and filing deadlines, the result and its proposed allocation (legal reserve, dividends, other reserves, report à nouveau), each resolution with its outcome when votes were entered, the size category and whether a management report is required, the confidentiality options at filing, the documents of the pack with what each still misses, the filing checklist and warnings, each rule with its legal source.",
        access: 'read',
        permission: { reports: ['read'] },
        amounts: 'euros',
        units: 'Dates as yyyy-mm-dd.',
        never: 'invents missing data (it is listed, not filled), generates a document or changes anything (read only; update_year_end_formalities fills the data).',
      }),
      inputSchema: z.object({
        companyId: z.string().describe('Company id, from list_companies.'),
        fiscalYearId: z.string().describe('Fiscal year whose accounts are approved, from list_fiscal_years.'),
      }),
      annotations: READ_ONLY,
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { reports: ['read'] })
        const { pack, context, details, sources } = await getApproval(args.companyId, args.fiscalYearId)
        const regime = pack.regime
        return json({
          fiscalYear: context.fiscalYear,
          legalType: context.company.legalType,
          unsupported: pack.unsupported,
          regime: regime
            ? {
                form: regime.form,
                soleShareholder: regime.sole,
                officerTitle: regime.officerTitle.singular,
                decidingBody: regime.decidingBody,
                decisionModes: regime.decisionModes,
                decisionMode: pack.decisionMode,
                document: pack.decisionTitle,
                filingRequired: regime.filing.required,
                filingWorthApproval: regime.filingWorthApproval?.condition ?? null,
              }
            : null,
          deadlines: pack.deadlines,
          result: fromCents(pack.resultCents),
          allocation: {
            legalReserveRequired: pack.plan.legalReserveRequired,
            legalReserve: fromCents(pack.plan.legalReserveCents),
            distributable: fromCents(pack.plan.distributableCents),
            dividends: fromCents(pack.plan.dividendsCents),
            otherReserves: fromCents(pack.plan.otherReservesCents),
            priorLossesCleared: fromCents(pack.plan.priorLossesClearedCents),
            retainedEarnings: fromCents(pack.plan.retainedEarningsCents),
            errors: pack.plan.errors,
          },
          votes: { total: pack.totalVotes, presentOrRepresented: pack.presentVotes },
          resolutions: pack.resolutions.map((r) => ({ id: r.id, title: r.title, adopted: r.outcome.adopted, quorumMet: r.outcome.quorumMet })),
          size: pack.size,
          managementReport: pack.managementReport,
          confidentiality: pack.confidentiality,
          documents: pack.documents.map((d) => ({ id: d.id, title: d.title, required: d.required, reason: d.reason, missing: d.missing })),
          publication: pack.publication,
          approvedOn: details.approvedOn ?? null,
          filedOn: details.filedOn ?? null,
          warnings: pack.warnings,
          sources,
        })
      }),
  )
}
