/**
 * Registration of the receipt tools (lib/mcp/full-control/receipts.ts) for
 * every connection that may write (kledg:write or full control): they are
 * draft-level tools whose attach action waits for the user's approval in
 * Kledg unless the connection has full control in automatic mode
 * (registerFullControlTool, `level: 'write'`).
 */

import type { McpServer } from '@modelcontextprotocol/server'
import type { CompanyGuard, McpAccess } from '@/lib/mcp/company-access'
import { registerFullControlTool } from '@/lib/mcp/full-control/define'
import { captureReceiptTool, fileReceiptTool, stageReceiptTool } from '@/lib/mcp/full-control/receipts'

export function registerReceiptTools(server: McpServer, access: McpAccess, guard: CompanyGuard): void {
  if (!access.canWrite) return
  registerFullControlTool(server, access, guard, captureReceiptTool)
  registerFullControlTool(server, access, guard, stageReceiptTool)
  registerFullControlTool(server, access, guard, fileReceiptTool)
}
