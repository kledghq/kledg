/**
 * Read tool of the liasse fiscale (docs/liasse-fiscale.md): get_liasse_fiscale
 * returns, for a fiscal year, every table of the company's regime with where
 * Kledg prepares it, and the tables prepared on the Liasse fiscale page box
 * by box: computed (with the box code, the value and where it comes from)
 * or to fill by hand (with the reason). Same rule as the web UI: the company
 * guard with reports:read, then the service scopes everything by company;
 * subsidiaries are read through the guard. Amounts in euros. Read only.
 */

import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { CompanyGuard, McpAccess } from '@/lib/mcp/company-access'
import type { GroupAccess } from '@/lib/management-fees/access'
import { json, run } from '@/lib/mcp/tool-result'
import { READ_ONLY, describeTool } from '@/lib/mcp/tool-meta'
import { getLiasse } from '@/lib/liasse/get-liasse.service'
import type { CellValue, LiasseCell, LiasseForm } from '@/lib/liasse/cells'
import { fromCents } from '@/lib/utils/money'

/** A value for an assistant: amounts in euros, percentages as numbers. */
function plain(value: CellValue | null | undefined): unknown {
  if (!value) return null
  switch (value.kind) {
    case 'amount':
      return fromCents(value.cents)
    case 'percent':
      return value.hundredths / 100
    default:
      return value.value
  }
}

function cellOf(c: LiasseCell) {
  return {
    box: c.box,
    label: c.label,
    value: plain(c.value),
    unit: c.value?.kind ?? null,
    source: c.source,
    toFillByHand: c.value === null,
    ...(c.note ? { note: c.note } : {}),
    ...(c.pending?.length ? { withoutBoxesToFill: c.pending } : {}),
    ...(c.hint ? { hint: plain(c.hint) } : {}),
    ...(c.accounts?.length ? { accounts: c.accounts } : {}),
  }
}

function formOf(form: LiasseForm) {
  return {
    form: form.number,
    title: form.title,
    required: form.required,
    sections: form.sections.map((s) => ({
      title: s.title,
      ...(s.note ? { note: s.note } : {}),
      rows: s.rows.map((r) => ({ line: r.label, total: r.total ?? false, cells: r.cells.map(cellOf) })),
    })),
    checks: form.checks.map((c) => ({ check: c.label, ok: c.ok, message: c.message })),
    warnings: form.warnings,
  }
}

export function registerLiasseReadTools(server: McpServer, access: McpAccess, guard: CompanyGuard) {
  const group: GroupAccess = { userId: access.user.id, require: (id, permission) => guard.require(id, permission) }

  server.registerTool(
    'get_liasse_fiscale',
    {
      title: 'Liasse fiscale',
      description: describeTool({
        summary:
          "Liasse fiscale of a fiscal year for a company subject to the impôt sur les sociétés, by regime: régime simplifié (2065-SD and tables 2033-A-SD to 2033-G-SD) or régime réel normal (2065-SD and 2050-SD to 2059-G-SD). Returns every table with where Kledg prepares it (here; on another page: balance sheet, income statement, impôt sur les sociétés, fixed assets; or to fill by hand), and the tables prepared here box by box with the official box codes of the 2026 forms: each cell is computed from the validated entries, a record of the company (company information, shareholders, provisions register, group) or the impôt sur les sociétés worksheet, or flagged toFillByHand with the reason (and sometimes a hint from the books, never the answer). Régime simplifié: 2065-SD fields, 2033-D (provisions, amortissements dérogatoires, déficits, VAT collected and deductible), 2033-E (headcount, value added), 2033-F (capital), 2033-G (subsidiaries). Régime normal: 2065-SD fields, 2056 (provisions), 2057 (maturities of receivables and debts), 2058-B (deficits, non deductible provisions), 2058-C (allocation of the previous result, details of charges and taxes), 2059-E, 2059-F, 2059-G; 2054 bis and 2059-A to 2059-D are to fill by hand. Also returns the checks (provisions against the balance sheet, the income statement and the provisions register, debts against the balance sheet, allocation of the result against the vote, capital composition, titres de participation against the subsidiaries listed, the impôt sur les sociétés worksheet) and warnings. status not-subject or missing-regime: no tables.",
        access: 'read',
        permission: { reports: ['read'] },
        amounts: 'euros',
        units: 'Percentages as numbers (12.5 means 12,5 %); dates in French text as printed on the forms.',
        never: 'invents a value for a box the books do not give, returns the birth data or address of a shareholder (only whether they are recorded), or files the liasse (Kledg prepares it; the user files it in the professional space or through an EDI partner).',
      }),
      inputSchema: z.object({
        companyId: z.string().describe('Company id, from list_companies.'),
        fiscalYearId: z.string().describe('Fiscal year id, from list_fiscal_years.'),
      }),
      annotations: READ_ONLY,
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { reports: ['read'] })
        const view = await getLiasse(args.companyId, args.fiscalYearId, group)
        return json({
          status: view.status,
          regime: view.regime,
          fiscalYear: view.fiscalYear,
          tables: view.tables.map((t) => ({ form: t.number, title: t.title, where: t.status, page: t.href, note: t.note, coverage: t.coverage })),
          forms: view.forms.map(formOf),
          warnings: view.warnings,
          filing: view.filing,
          sources: view.sources,
        })
      }),
  )
}
