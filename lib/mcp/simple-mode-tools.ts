/**
 * Read tool of simple mode (docs/categories-simples.md):
 * list_expenses_to_review, the bank transactions not reconciled yet with
 * the plain language category Kledg proposes (rules, history, French payee
 * dictionary, keywords, bank category), its confidence and reason. Same
 * rule as the page: the company guard with banking:read, then the service
 * scopes everything by company. Amounts in euros. Confirming a suggestion
 * is the draft-level tool accept_expense_suggestion (lib/mcp/drafts/simple-mode.ts).
 */

import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { CompanyGuard } from '@/lib/mcp/company-access'
import { json, run } from '@/lib/mcp/tool-result'
import { READ_ONLY, describeTool } from '@/lib/mcp/tool-meta'
import { listExpensesToReview, MAX_EXPENSES } from '@/lib/simple/expenses-to-review.service'
import { findCategory } from '@/lib/simple/categories'
import { fromCents } from '@/lib/utils/money'

export function registerSimpleModeReadTools(server: McpServer, guard: CompanyGuard) {
  server.registerTool(
    'list_expenses_to_review',
    {
      title: 'Dépenses à vérifier',
      description: describeTool({
        summary:
          "Lists the company's bank transactions not reconciled yet (simple mode, \"Dépenses à vérifier\"), latest first, each with the category Kledg proposes from its plain language catalogue: categoryId and label, the transaction rule when one matches (ruleId), confidence (high, medium or low; low means no category, the line is to classify), the source (rule, history of the same counterparty, built-in French payee dictionary, label keyword, bank category) and the reason in French, the question to answer first when the category needs one (fixed asset above 500 € HT, meal guests, vehicle type, rent VAT) with its answer ids, whether it can be confirmed without anything else (bulkConfirmable), whether a receipt is attached, and why it cannot be confirmed yet (no open fiscal year). Kledg never invents a category: a payee it recognises without knowing what was bought stays to classify with a hint.",
        access: 'read',
        permission: { banking: ['read'] },
        amounts: 'euros',
        units: 'Dates as yyyy-mm-dd. side: debit is money out, credit money in.',
        never: 'confirms a line or writes anything (accept_expense_suggestion does, as a draft, with kledg:write); changes nothing (read only).',
      }),
      inputSchema: z.object({
        companyId: z.string().describe('Company id, from list_companies.'),
        side: z.enum(['debit', 'credit', 'all']).default('debit').describe('debit (default): money out; credit: money in; all.'),
        limit: z.number().int().min(1).max(MAX_EXPENSES).default(50).describe(`Lines returned, ${MAX_EXPENSES} at most; count covers them all.`),
      }),
      annotations: READ_ONLY,
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { banking: ['read'] })
        const list = await listExpensesToReview(args.companyId, { side: args.side, limit: args.limit })
        return json({
          count: list.count,
          expenses: list.items.map((item) => {
            const s = item.suggestion
            return {
              transactionId: item.id,
              date: item.date,
              side: item.side,
              amount: fromCents(item.amountCents),
              payee: item.name,
              label: item.label,
              suggestion: {
                categoryId: s.categoryId,
                category: findCategory(s.categoryId)?.label ?? null,
                ruleId: s.ruleId,
                ruleName: s.ruleName,
                confidence: s.confidence,
                source: s.source,
                reason: s.reason,
                answers: s.answers,
                question: s.pendingQuestion
                  ? { id: s.pendingQuestion.id, text: s.pendingQuestion.text, answers: s.pendingQuestion.answers.map((a) => ({ id: a.id, label: a.label })) }
                  : null,
                bulkConfirmable: s.bulkConfirmable,
              },
              hasReceipt: item.hasReceipt,
              blockedReason: item.blockedReason,
            }
          }),
        })
      }),
  )
}
