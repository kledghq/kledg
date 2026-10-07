/**
 * Read tools of the documents held by Qonto: get_qonto_statements (the
 * monthly statements), list_qonto_receipts (the receipts Qonto holds for a
 * transaction) and get_file (the file of a receipt, of an invoice imported
 * from Qonto, or of a statement). Same rules as their routes
 * (app/api/qonto/statements/**, app/api/qonto/transactions/[id]/attachments,
 * app/api/banking/attachments/[attachmentId]/proxy,
 * app/api/invoices/[id]/attachment):
 * - the company guard with the route's right (banking:read, entries:read
 *   for an invoice), so the connection's grant and the user's role apply;
 * - Qonto is only asked with the company's own stored API key, for objects
 *   of the company (a receipt, transaction or invoice of another company is
 *   "introuvable"), and the file URL fetched comes from the stored object or
 *   a fresh Qonto response, never from the arguments (fetchQontoFile checks
 *   Qonto's file hosts);
 * - Qonto's signed file URLs are never returned: the file itself travels in
 *   the result as an embedded resource (lib/mcp/file-result.ts);
 * - every call that reaches Qonto counts in the company's limit of bank
 *   calls (limitBankCalls), and a file is refused above 5 MB from Qonto's
 *   metadata, or cut as soon as its download passes 5 MB (MCP_FILE_BUDGET),
 *   never read in full first.
 * The statement import of the POST route is a listing with the filters in
 * the body: get_qonto_statements covers both.
 */

import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { CompanyGuard } from '@/lib/mcp/company-access'
import { json, run } from '@/lib/mcp/tool-result'
import { READ_ONLY, describeTool } from '@/lib/mcp/tool-meta'
import { MCP_FILE_BUDGET, documentMimeType, fileResult } from '@/lib/mcp/file-result'
import type { Permission } from '@/lib/rbac/authorize'
import { NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { limitBankCalls } from '@/lib/banking/guard'
import { qontoClientFor } from '@/lib/integrations/providers/qonto/get-credentials'
import { assertDeclaredFileSize, fetchQontoFile } from '@/lib/integrations/providers/qonto/files'
import { listQontoStatements, StatementsBodySchema } from '@/lib/integrations/providers/qonto/list-qonto-statements.service'
import { listQontoTransactionAttachments, readQontoReceipt } from '@/lib/integrations/providers/qonto/read-qonto-attachments.service'
import { readInvoiceAttachment } from '@/lib/invoices/read-invoice-attachment.service'
import type { QontoStatement, QontoTransactionAttachment } from '@/lib/integrations/providers/qonto/types'

/** Qonto ids are UUIDs: never let an argument reach the Qonto API path otherwise (same check as the routes). */
const QONTO_ID = /^[A-Za-z0-9-]{1,100}$/
const INVALID_STATEMENT = 'Identifiant de relevé invalide.'

const BANKING_READ: Permission = { banking: ['read'] }

/** A statement without Qonto's signed file URL. */
function statementView(statement: QontoStatement) {
  const file = statement.file
  return {
    id: statement.id,
    bankAccountId: statement.bank_account_id,
    period: statement.period,
    file: file ? { fileName: file.file_name, contentType: file.file_content_type, size: Number(file.file_size) || null } : null,
  }
}

/** A receipt without Qonto's signed file URLs. */
function receiptView(attachment: QontoTransactionAttachment) {
  return {
    id: attachment.id,
    createdAt: attachment.created_at,
    fileName: attachment.file_name,
    contentType: attachment.file_content_type,
    size: Number(attachment.file_size) || null,
    probative: attachment.probative_attachment ? { status: attachment.probative_attachment.status } : null,
  }
}

/** Rights of each source of get_file, like each route. */
const FILE_SOURCES = {
  bank_receipt: BANKING_READ,
  invoice: { entries: ['read'] },
  qonto_statement: BANKING_READ,
} as const satisfies Record<string, Permission>

type FileSource = keyof typeof FILE_SOURCES

const companyId = z.string().describe('Company id, from list_companies.')

export function registerDocumentTools(server: McpServer, guard: CompanyGuard) {
  server.registerTool(
    'get_qonto_statements',
    {
      title: 'Relevés bancaires Qonto',
      description: describeTool({
        summary:
          "Monthly bank statements of the company's Qonto accounts, read from Qonto with the company's stored API key: the list (filters by bank account, IBAN and period, page by page or every statement with getAll) or one statement by its id. Each statement gives its id, bank account, period (MM-YYYY) and file name, type and size; get the PDF with get_file (source qonto_statement). Kledg imports the operations through sync_bank_data, not from these PDFs.",
        access: 'read',
        permission: BANKING_READ,
        amounts: 'none',
        units: 'Periods as MM-YYYY, the format of Qonto.',
        never: "returns Qonto's file URLs or the API key, uses another company's Qonto account, or changes anything (read only).",
      }),
      inputSchema: z.object({
        companyId,
        statementId: z.string().max(100).optional().describe('One statement (Qonto id): returns it alone. Omit to list.'),
        page: z.number().int().min(1).max(10_000).optional(),
        perPage: z.number().int().min(1).max(100).optional().describe('Statements per page, 100 at most.'),
        sortBy: z.enum(['period:asc', 'period:desc']).optional(),
        getAll: z.boolean().optional().describe('true: every statement (page and perPage ignored).'),
        bankAccountIds: z.array(z.string().max(200)).max(100).optional().describe('Qonto bank account ids.'),
        ibans: z.array(z.string().max(200)).max(100).optional(),
        periodFrom: z.string().max(20).optional().describe('First period, MM-YYYY.'),
        periodTo: z.string().max(20).optional().describe('Last period, MM-YYYY.'),
      }),
      annotations: { ...READ_ONLY, openWorldHint: true },
    },
    ({ companyId, statementId, ...filters }) =>
      run(async () => {
        await guard.require(companyId, BANKING_READ)
        if (statementId !== undefined) {
          if (!QONTO_ID.test(statementId)) throw new ValidationError(INVALID_STATEMENT)
          await limitBankCalls(companyId)
          const { statement } = await (await qontoClientFor(companyId)).getStatement(statementId)
          return json({ statement: statementView(statement) })
        }
        await limitBankCalls(companyId)
        const listed = await listQontoStatements(companyId, StatementsBodySchema.parse(filters))
        return json({ statements: listed.statements.map(statementView), meta: listed.meta })
      }),
  )

  server.registerTool(
    'list_qonto_receipts',
    {
      title: 'Justificatifs Qonto d’une transaction',
      description: describeTool({
        summary:
          'Receipts (pièces justificatives) Qonto holds for a transaction of the company, given by its Qonto id or its external id in Kledg (list_bank_transactions): id, date, file name, type, size and whether a probative copy exists. Get a file with get_file (source bank_receipt).',
        access: 'read',
        permission: BANKING_READ,
        amounts: 'none',
        never: "returns Qonto's file URLs, reads a transaction of another company, or changes anything (read only).",
      }),
      inputSchema: z.object({
        companyId,
        transactionId: z.string().min(1).max(200).describe('Qonto transaction id (UUID) or the external id of a transaction synced from Qonto.'),
        page: z.number().int().min(1).max(10_000).optional(),
        perPage: z.number().int().min(1).max(100).optional(),
      }),
      annotations: { ...READ_ONLY, openWorldHint: true },
    },
    ({ companyId, transactionId, page, perPage }) =>
      run(async () => {
        await guard.require(companyId, BANKING_READ)
        const listed = await listQontoTransactionAttachments(companyId, transactionId, { page, per_page: perPage })
        return json({ receipts: (listed.attachments ?? []).map(receiptView) })
      }),
  )

  server.registerTool(
    'get_file',
    {
      title: 'Obtenir un document',
      description: describeTool({
        summary:
          "Returns a document of the company as an embedded resource (base64 blob with its MIME type and file name), read from Qonto at the time of the call: bank_receipt (a receipt of a bank transaction, by the attachment id of list_bank_transactions or list_qonto_receipts; transactionUuid for a receipt not synced yet), invoice (the PDF of an invoice imported from Qonto, by its id from list_invoices) or qonto_statement (the PDF of a statement, by its id from get_qonto_statements). Files above 5 MB are refused: the user downloads them from Kledg.",
        access: 'read',
        permission: 'membership',
        actions: FILE_SOURCES,
        amounts: 'none',
        never: "creates a download link, returns Qonto's file URLs, reads a document of another company, or changes anything (read only).",
      }),
      inputSchema: z.object({
        companyId,
        source: z.enum(Object.keys(FILE_SOURCES) as [FileSource, ...FileSource[]], { error: 'Source inconnue' }).describe('Which kind of document.'),
        attachmentId: z.string().min(1).max(200).optional().describe('bank_receipt: the attachment id (Kledg or Qonto id).'),
        transactionUuid: z.string().max(200).optional().describe('bank_receipt: the Qonto transaction of a receipt not synced yet.'),
        invoiceId: z.string().min(1).max(100).optional().describe('invoice: the invoice id.'),
        statementId: z.string().min(1).max(100).optional().describe('qonto_statement: the statement id.'),
      }),
      annotations: { ...READ_ONLY, openWorldHint: true },
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, FILE_SOURCES[args.source])
        const base = `companies/${args.companyId}/files/${args.source}`
        if (args.source === 'bank_receipt') {
          if (!args.attachmentId) throw new ValidationError('attachmentId est requis pour un justificatif.')
          const receipt = await readQontoReceipt(args.companyId, args.attachmentId, args.transactionUuid, MCP_FILE_BUDGET)
          return fileResult({ content: receipt.body, fileName: receipt.fileName, contentType: documentMimeType(receipt.contentType) }, base, { source: args.source })
        }
        if (args.source === 'invoice') {
          if (!args.invoiceId) throw new ValidationError('invoiceId est requis pour une facture.')
          const file = await readInvoiceAttachment(args.companyId, args.invoiceId, undefined, MCP_FILE_BUDGET)
          return fileResult({ content: file.body, fileName: file.fileName, contentType: documentMimeType(file.contentType) }, base, { source: args.source })
        }
        if (!args.statementId || !QONTO_ID.test(args.statementId)) throw new ValidationError(INVALID_STATEMENT)
        await limitBankCalls(args.companyId)
        const { statement } = await (await qontoClientFor(args.companyId)).getStatement(args.statementId)
        if (!statement?.file?.file_url) throw new NotFoundError('Relevé non trouvé ou fichier non disponible')
        // Qonto file URLs are signed and valid for 30 minutes; they come from Qonto's answer, never from the arguments.
        assertDeclaredFileSize(statement.file.file_size, MCP_FILE_BUDGET)
        const body = await fetchQontoFile(statement.file.file_url, undefined, MCP_FILE_BUDGET)
        return fileResult(
          {
            content: body,
            fileName: statement.file.file_name || `releve-${args.statementId}.pdf`,
            contentType: documentMimeType(statement.file.file_content_type || 'application/pdf'),
          },
          base,
          { source: args.source, period: statement.period },
        )
      }),
  )
}
