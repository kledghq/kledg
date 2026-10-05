/**
 * Draft-level write tools (kledg:write): prepare work a person reviews in
 * Kledg. registerKledgTools (lib/mcp/tools.ts) calls this only when the
 * connection may write; every tool is registered through
 * registerDraftTool (define.ts), which checks the company guard with the
 * tool's rights on each call and writes the audit log.
 */

import type { McpServer } from '@modelcontextprotocol/server'
import type { CompanyGuard, McpAccess } from '@/lib/mcp/company-access'
import { registerDraftTool, type RegisterDraftTool } from './define'
import { registerBudgetDraftTools } from './budgets'
import { registerYearEndDraftTools } from './year-end'
import { registerExpenseReportDraftTools } from './expense-reports'
import { registerApprovalDraftTools } from './approval'
import { registerAnnexeDraftTools } from './annexe'
import { registerSimpleModeDraftTools } from './simple-mode'
import { registerVatReturnDraftTools } from './vat-returns'
import { registerCorporateTaxDraftTools } from './corporate-tax'
import { registerDeclarationDraftTools } from './declarations'
import { registerRecordDraftTools } from './records'
import { registerRemunerationDraftTools } from './remuneration'

export function registerDraftTools(server: McpServer, access: McpAccess, guard: CompanyGuard): void {
  if (!access.canWrite) return
  const register: RegisterDraftTool = (tool) => registerDraftTool(server, access, guard, tool)
  registerBudgetDraftTools(register)
  registerYearEndDraftTools(register)
  registerExpenseReportDraftTools(register)
  registerApprovalDraftTools(register)
  registerAnnexeDraftTools(register)
  registerSimpleModeDraftTools(register)
  registerVatReturnDraftTools(register)
  registerCorporateTaxDraftTools(register)
  registerDeclarationDraftTools(register)
  registerRecordDraftTools(register)
  registerRemunerationDraftTools(register)
}
