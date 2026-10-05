/**
 * Read tools of the annexe and of the fixed asset forms
 * (docs/annexe-et-2054.md): get_annexe returns, for a fiscal year, the
 * notes the size category requires with what is still missing, the
 * register of methods and the changes of the year; get_fixed_asset_movements
 * returns forms 2054-SD, 2055-SD and 2033-C-SD with their box codes and the
 * checks against the balance sheet and the register. Same rule as the web
 * UI: the company guard with reports:read, then the services scope
 * everything by company. Amounts in euros. Read only: the methods register
 * and the answers of the annexe are written by draft tools
 * (lib/mcp/drafts/annexe.ts); the documents are generated in the app only.
 */

import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { CompanyGuard, McpAccess } from '@/lib/mcp/company-access'
import type { GroupAccess } from '@/lib/management-fees/access'
import { json, run } from '@/lib/mcp/tool-result'
import { READ_ONLY, describeTool } from '@/lib/mcp/tool-meta'
import { getAnnexe } from '@/lib/annexe/get-annexe.service'
import { getFixedAssetMovements } from '@/lib/annexe/get-fixed-asset-movements.service'
import { getAccountingRegister } from '@/lib/annexe/methods/manage-accounting-methods.service'
import type { FormRow } from '@/lib/annexe/movements'
import type { Block } from '@/lib/approval/documents/model'
import { fromCents } from '@/lib/utils/money'

const euros = (cents: number | null) => (cents === null ? null : fromCents(cents))

/** A form row for an assistant: label, box code and amount in euros per column. */
function formRow<C extends string>(row: FormRow<C>) {
  return {
    line: row.label,
    total: row.isTotal,
    boxes: Object.fromEntries(Object.entries(row.amounts).map(([column, cents]) => [column, { box: row.codes[column as C] ?? null, amount: euros(cents as number | null) }])),
    accounts: row.accounts,
  }
}

/** A note block as plain text (tables as rows of cells). */
function blockText(block: Block): unknown {
  switch (block.kind) {
    case 'table':
      return { columns: block.columns, rows: block.rows }
    case 'list':
    case 'checklist':
      return block.items
    case 'signatures':
      return null
    default:
      return block.text
  }
}

export function registerAnnexeReadTools(server: McpServer, access: McpAccess, guard: CompanyGuard) {
  const group: GroupAccess = { userId: access.user.id, require: (id, permission) => guard.require(id, permission) }

  server.registerTool(
    'get_annexe',
    {
      title: 'Annexe des comptes',
      description: describeTool({
        summary:
          "Annexe des comptes annuels of a fiscal year (PCG art. 811-6 to 838-x), driven by the size category of the approval (confirmed, else proposed): micro-entreprise (no annexe, the information after the balance sheet of PCG art. 811-7), small company under the régime simplifié (art. 811-8), small company (art. 811-9) or medium and large (every article). Returns each note (rules and methods, changes of method or estimate and corrections of errors, fixed assets, depreciation, provisions and impairments, revaluation, subsidiaries and participations, receivables and debts by maturity, equity, own shares, accruals, exceptional result, tax credits, related parties, officers, commitments off the balance sheet, headcount, events after the closing) with its PCG source and its tables, what the user must still answer (missing), warnings, the register of accounting methods and the changes of the year. Figures come from the validated entries.",
        access: 'read',
        permission: { reports: ['read'] },
        amounts: 'euros',
        units: 'Dates as yyyy-mm-dd; amounts inside the note tables are formatted French text.',
        never: 'invents an answer (missing items are listed, not filled), generates the document or changes anything (read only; update_annexe_notes fills the answers).',
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
        const [view, register] = await Promise.all([getAnnexe(args.companyId, args.fiscalYearId, group), getAccountingRegister(args.companyId, args.fiscalYearId)])
        const a = view.annexe
        return json({
          fiscalYear: view.fiscalYear,
          sizeCategory: { category: a.category, label: a.categoryLabel, confirmed: a.categoryConfirmed },
          annexe: { list: a.list, label: a.listLabel, source: a.listSource, required: a.required },
          notes: a.notes.map((n) => ({ id: n.id, title: n.title, source: n.source, content: n.blocks.map(blockText).filter((b) => b !== null) })),
          missing: a.missing,
          warnings: a.warnings,
          methods: register.methods,
          changes: register.changes.map((c) => ({
            id: c.id,
            kind: c.kind,
            treatment: c.treatment,
            label: c.label,
            description: c.description,
            method: c.method,
            impactBeforeTax: euros(c.impactCents),
            taxEffect: euros(c.taxEffectCents),
            impactAfterTax: euros(c.netImpactCents),
            account: c.accountCode,
            entryDate: c.entryDate,
            entry: c.entry,
          })),
          answers: view.details,
        })
      }),
  )

  server.registerTool(
    'get_fixed_asset_movements',
    {
      title: 'Immobilisations et amortissements (2054, 2055, 2033-C)',
      description: describeTool({
        summary:
          'Movements of fixed assets and depreciation of a fiscal year, line by line of the official 2026 forms with their box codes: 2054-SD (gross value at the start, increases from revaluation, acquisitions and transfers in, transfers out, disposals, gross value at the end), 2055-SD cadre A (depreciation at the start, allowances, decreases, at the end) and 2033-C-SD cadres I and II for the régime simplifié; totals by rubrique; and the checks: gross value at the end against the "Actif immobilisé" of the balance sheet (box BJ), depreciation plus impairments against its depreciation column, acquisitions, disposals, gross values and allowances of the fixed asset register against the lines. Read from the validated entries of the year (opening entry included, closing entry excluded).',
        access: 'read',
        permission: { reports: ['read'] },
        amounts: 'euros',
        never: 'computes derogatory depreciation (2055 cadre B), the original value of revalued items or capital gains (2033-C cadre III), or changes anything (read only).',
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
        const report = await getFixedAssetMovements(args.companyId, args.fiscalYearId)
        return json({
          fiscalYear: report.fiscalYear,
          form2054: report.form2054.map(formRow),
          form2055: report.form2055.map(formRow),
          form2033c: { assets: report.form2033c.assets.map(formRow), depreciation: report.form2033c.depreciation.map(formRow) },
          rubriques: report.rubriques.map((r) => ({ rubrique: r.label, opening: euros(r.openingCents), increase: euros(r.increaseCents), decrease: euros(r.decreaseCents), closing: euros(r.closingCents) })),
          impairments: euros(report.impairmentCents),
          checks: report.checks.map((c) => ({ check: c.label, books: euros(c.booksCents), other: euros(c.otherCents), ok: c.ok, message: c.message })),
          warnings: report.warnings,
        })
      }),
  )
}
