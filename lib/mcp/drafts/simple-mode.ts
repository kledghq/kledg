/**
 * Draft-level tool of simple mode (docs/categories-simples.md):
 * accept_expense_suggestion confirms a line of "Dépenses à vérifier" as a
 * DRAFT entry, reconciled with its transaction, through the service of the
 * page (confirmExpense, source mcp): the suggestion as proposed, or a
 * category of the catalogue with the answer to its question, or a matching
 * rule, or for money in the open sales invoice it pays (the payment is
 * recorded on the invoice when a person validates the entry). The rights are those of the page's route (banking:reconcile and
 * entries:create). Whatever the company setting, the entry is never
 * validated by the assistant: a person validates it in Kledg ("Saisies du
 * mode simple à valider"). It never creates a transaction rule from the
 * choice (learn off): rules come from people's repeated choices.
 */

import { z } from 'zod'
import { kledgPageUrl } from '@/lib/mcp/tool-meta'
import { CATEGORY_IDS } from '@/lib/simple/categories'
import { confirmExpense } from '@/lib/simple/confirm-expense.service'
import { fromCents } from '@/lib/utils/money'
import { draftTool, type RegisterDraftTool } from './define'

export function registerSimpleModeDraftTools(register: RegisterDraftTool): void {
  register(
    draftTool({
      name: 'accept_expense_suggestion',
      title: 'Classer une dépense ou une recette à vérifier',
      summary:
        'Confirms one bank transaction of list_expenses_to_review as a DRAFT entry reconciled with it: the bank line on 512, the charge or product of the category and its VAT (recoverable VAT per the category rule: none on passenger transport, staff lodging and passenger vehicles, 80 % on passenger car fuel, gifts up to 73 € TTC), in the BQ journal, on the accounts of the fiscal year of the transaction date. Money in (side credit) works the same way: an income category (sale with its collected VAT on 44571, subsidy, interest...), a movement (loan received, partner current account, VAT refund) or the refund of an expense (the charge and its VAT reversed); or, with invoiceId (suggestion.invoice.invoiceId), the payment of an open sales invoice: bank line and customer line (411 of the invoice, customer auxiliary account), the payment being recorded on the invoice and lettered by the invoices module once a person validates the entry. Without categoryId, ruleId nor invoiceId it confirms the suggestion as proposed; with categoryId, that category of the catalogue (answers: { questionId: answerId } when the category asks a question; for a company taxed at the impôt sur le revenu, the meal answer alone means the exploitant or an associé: the charge is split, only the frais supplémentaires on 6256, the rest on 62568 to add back, BOI-BNC-BASE-40-60-60, explained in mealNote; alone-employee keeps it whole); with ruleId, the entry that transaction rule produces. Returns the entry id and its lines. 409 when the transaction is already reconciled or the invoice already paid; 404 for an invoice of another company.',
      never: 'validates the entry (it stays a draft whatever the company setting, a person validates it in Kledg), creates a transaction rule, or sends a receipt to the bank.',
      amounts: 'euros',
      units: 'Line amounts returned in euros.',
      input: {
        transactionId: z.string().min(1, 'La transaction est requise').max(64).describe('Transaction id, from list_expenses_to_review.'),
        categoryId: z.enum(CATEGORY_IDS as [string, ...string[]]).optional().describe('Category of the catalogue (ids from list_expenses_to_review); omit to confirm the suggestion.'),
        ruleId: z.string().min(1).max(64).optional().describe('Transaction rule to apply instead of a category (suggestion.ruleId).'),
        invoiceId: z.string().min(1).max(64).optional().describe('Open sales invoice a credit pays (suggestion.invoice.invoiceId), instead of a category.'),
        answers: z.record(z.string().max(40), z.string().max(40)).optional().describe('Answer to the category question, { questionId: answerId }, e.g. { "durable": "durable" }.'),
        note: z.string().max(1000).optional().describe('Note for the accountant (the guests of a business meal...).'),
      },
      permission: [{ banking: ['reconcile'] }, { entries: ['create'] }],
      destructive: false,
      idempotent: false,
      execute: async (args, { access }) => {
        const result = await confirmExpense(
          args.companyId,
          args.transactionId,
          { categoryId: args.categoryId, ruleId: args.ruleId, invoiceId: args.invoiceId, answers: args.answers, note: args.note, learn: false },
          { userId: access.user.id, canValidate: false, source: 'mcp' },
        )
        return {
          changes: { entryId: result.entryId, transactionId: result.transactionId, status: result.status },
          reviewUrl: kledgPageUrl(args.companyId, 'entries/simple-mode'),
          message: `Écriture créée en brouillon et rapprochée${result.needsReview ? ', à valider par le comptable' : ''}.`,
          entryId: result.entryId,
          entryNumber: result.entryNumber,
          status: result.status,
          categoryId: result.categoryId,
          ruleId: result.ruleId,
          lines: result.lines.map((l) => ({ accountCode: l.accountCode, debit: fromCents(l.debitCents), credit: fromCents(l.creditCents) })),
          vatNote: result.vatNote,
          mealNote: result.mealNote,
          invoice: result.invoice ? { invoiceId: result.invoice.id, number: result.invoice.number, customer: result.invoice.customerName, recorded: result.invoice.recorded } : null,
        }
      },
      audit: (args, result) => ({ transactionId: args.transactionId, entryId: result.entryId, categoryId: result.categoryId, ruleId: result.ruleId, invoiceId: result.invoice?.invoiceId ?? null }),
    }),
  )
}
