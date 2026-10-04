/**
 * Full control MCP tools (kledg:admin): act like the user beyond drafts.
 *
 * registerKledgTools (lib/mcp/tools.ts) calls this only when the connection
 * has full control; every tool is registered through registerFullControlTool
 * (define.ts), which checks `guard.requireFullControl` on each call, rate
 * limits, runs high-impact actions according to the connection's execution
 * mode (at once, or after the user's approval in Kledg) and writes the audit
 * log.
 */

import type { McpServer } from '@modelcontextprotocol/server'
import type { CompanyGuard, McpAccess } from '@/lib/mcp/company-access'
import { registerFullControlTool, type RegisterTool } from './define'
import { registerEntryTools } from './entries'
import { registerBankingTools } from './banking'
import { registerLedgerTools } from './ledger'
import { registerYearEndTools } from './year-end'
import { registerLetteringTools } from './lettering'
import { registerInvoiceTools } from './invoices'
import { registerExpenseReportTools } from './expense-reports'

export function registerFullControlTools(server: McpServer, access: McpAccess, guard: CompanyGuard): void {
  if (!access.canAdmin) return
  const register: RegisterTool = (tool) => registerFullControlTool(server, access, guard, tool)
  registerEntryTools(register)
  registerBankingTools(register)
  registerLedgerTools(register)
  registerYearEndTools(register)
  registerLetteringTools(register)
  registerInvoiceTools(register)
  registerExpenseReportTools(register)
}
