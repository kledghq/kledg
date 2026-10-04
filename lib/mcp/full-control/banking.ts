/**
 * Full control tools on banking: reconcile and undo, assignment rules
 * (règles d'affectation) and their engine, bank sync, statement import,
 * manual bank accounts. Thin wrappers over lib/reconciliation/service.ts,
 * lib/transactions/manage-rules.service.ts,
 * lib/services/transactions/transaction-processing-service.ts,
 * lib/banking/connections.service.ts and
 * lib/banking/import/import-statement.service.ts.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ValidationError } from '@/lib/accounting/errors'
import { assertFileSize } from '@/lib/api/files'
import { getEncryptionKey } from '@/lib/crypto/encryption-key'
import {
  MESSAGES as RECONCILIATION_MESSAGES,
  loadTransaction,
  reconcileWithEntrySchema,
  reconcileWithExistingEntry,
  reconcileWithNewEntry,
  unreconcileTransaction,
} from '@/lib/reconciliation/service'
import { processTransactions } from '@/lib/services/transactions/transaction-processing-service'
import { createRule, deleteRule, findRule, listRules, updateRule } from '@/lib/transactions/manage-rules.service'
import { limitBankCalls } from '@/lib/banking/guard'
import { createManualAccount, refreshConnection } from '@/lib/banking/connections.service'
import {
  analyzeStatement,
  importStatement,
  keptProbablesSchema,
  statementOptionsSchema,
} from '@/lib/banking/import/import-statement.service'
import type { TabularOptions } from '@/lib/banking/import/types'
import { day } from '@/lib/mcp/tool-result'
import { fullControlTool, type RegisterTool } from './define'
import { ACTS_AS_USER, TWO_STEP } from './descriptions'
import { accountIdsByCode, euros, fiscalYearOfDay, isoDate, journalIdByCode } from './resolve'

const transactionId = z.string().min(1).describe('Bank transaction id, from list_bank_transactions.')

// Reconciliation

const reconcileInput = {
  transactionId,
  entryId: z
    .string()
    .optional()
    .describe('Reconcile with this existing entry of the company (no new entry). Leave empty to create the entry from lines.'),
  journalCode: z.string().optional().describe('Journal of the new entry, usually "BQ".'),
  date: isoDate.optional().describe('Date of the new entry (yyyy-mm-dd), usually the transaction date.'),
  description: z.string().max(500).optional(),
  reference: z.string().max(200).optional(),
  lines: z
    .array(
      z.object({
        accountCode: z.string().min(1).describe('Counterpart account number (e.g. 401, 606100, 44566).'),
        debit: euros.optional(),
        credit: euros.optional(),
        label: z.string().max(500).optional(),
      }),
    )
    .max(100)
    .optional()
    .describe(
      'Counterpart lines in euros, WITHOUT the bank line: Kledg adds the bank (512) line itself from the transaction amount. Together they must balance the transaction.',
    ),
  withoutEntry: z
    .boolean()
    .optional()
    .describe('true marks the transaction reconciled without any entry (pointage), when neither lines nor entryId are given.'),
}

const reconcileTransaction = fullControlTool({
  name: 'reconcile_transaction',
  title: 'Rapprocher une transaction',
  description: `Reconciles a bank transaction (rapprochement): with counterpart lines, creates the DRAFT entry (bank line added by Kledg) and links it, atomically; with entryId, links an existing entry; with withoutEntry, only marks it reconciled. Refused (409) when the transaction is already reconciled, so a retry never creates a second entry. ${ACTS_AS_USER}`,
  input: reconcileInput,
  permission: { banking: ['reconcile'] },
  amounts: 'euros',
  never: 'validates the draft entry it creates.',
  confirmation: false,
  async execute({ companyId, transactionId, entryId, journalCode, date, description, reference, lines, withoutEntry }) {
    if (lines && lines.length > 0) {
      const transaction = await loadTransaction(companyId, transactionId)
      const entryDay = date ?? day(transaction.date)
      const fiscalYear = await fiscalYearOfDay(companyId, entryDay)
      const byCode = await accountIdsByCode(companyId, fiscalYear.id, lines.map((l) => l.accountCode))
      const input = reconcileWithEntrySchema.parse({
        journalId: await journalIdByCode(companyId, journalCode ?? 'BQ'),
        date: entryDay,
        description,
        reference,
        lines: lines.map((l) => ({
          accountId: byCode.get(l.accountCode)!,
          debit: l.debit ?? null,
          credit: l.credit ?? null,
          description: l.label,
        })),
      })
      const entry = await reconcileWithNewEntry(companyId, transactionId, input)
      return { transactionId, reconciled: true, entryId: entry.id, entryNumber: entry.entryNumber, entryStatus: 'draft' }
    }
    if (!entryId && !withoutEntry) {
      throw new ValidationError('Indiquez les lignes de contrepartie (lines), une écriture existante (entryId) ou withoutEntry: true.')
    }
    const transaction = await reconcileWithExistingEntry(companyId, transactionId, entryId || null)
    return { transactionId, reconciled: transaction.reconciled, entryId: transaction.reconciledWith }
  },
  audit: ({ transactionId }, result) => ({ transactionId, entryId: result.entryId }),
})

const unreconcileTransactionTool = fullControlTool({
  name: 'unreconcile_transaction',
  title: 'Annuler un rapprochement',
  description: `Undoes the reconciliation of a bank transaction: deletes the draft entry the reconciliation created, or only unlinks an entry it did not create. Refused when that entry is validated or in a closed fiscal year (reverse it instead). ${ACTS_AS_USER} ${TWO_STEP}`,
  input: { transactionId },
  permission: { banking: ['reconcile'] },
  amounts: 'none',
  never: 'deletes a validated entry or touches a closed fiscal year (refused).',
  confirmation: true,
  destructive: true,
  async preview({ companyId, transactionId }) {
    const transaction = await loadTransaction(companyId, transactionId)
    const base = {
      transaction: { id: transaction.id, date: day(transaction.date), label: transaction.label, amount: transaction.amount, side: transaction.side },
    }
    if (!transaction.reconciled) return { ...base, effect: 'none', warnings: [RECONCILIATION_MESSAGES.notReconciled] }
    const entry = transaction.reconciledWith
      ? await prisma.accountingEntry.findFirst({
          where: { id: transaction.reconciledWith, companyId },
          select: { id: true, entryNumber: true, status: true, sourceBankTransactionId: true, fiscalYear: { select: { year: true, isClosed: true } } },
        })
      : null
    if (!entry) return { ...base, effect: 'unmark', entry: null, warnings: [] }
    const created = entry.sourceBankTransactionId === transactionId
    const warnings: string[] = []
    if (created && entry.status !== 'draft') warnings.push(`L'écriture n° ${entry.entryNumber} est validée : l'annulation sera refusée. Contre-passez-la.`)
    if (created && entry.fiscalYear.isClosed) warnings.push(`L'exercice ${entry.fiscalYear.year} est clôturé : l'annulation sera refusée.`)
    return {
      ...base,
      effect: created ? 'delete_draft_entry' : 'unlink_entry',
      entry: { id: entry.id, number: entry.entryNumber, status: entry.status },
      warnings,
    }
  },
  execute: ({ companyId, transactionId }) => unreconcileTransaction(companyId, transactionId),
  audit: ({ transactionId }, result) => ({ transactionId, deletedEntryId: result.deletedEntryId, unlinkedEntryId: result.unlinkedEntryId }),
})

// Assignment rules engine

const runRules = fullControlTool({
  name: 'run_rules',
  title: "Exécuter les règles d'affectation",
  description: `Runs the assignment rules engine (règles d'affectation) on unreconciled bank transactions of the current fiscal year, or on the given ones: each transaction that meets every condition of an enabled rule gets its DRAFT entry and is reconciled (several matching rules: highest priority, then most conditions); reconciled transactions are skipped, so running it twice creates nothing twice. ${ACTS_AS_USER} ${TWO_STEP} The dry run counts the transactions processed, matched and that would be applied.`,
  input: {
    transactionIds: z.array(z.string().min(1)).min(1).max(500).optional().describe('Only these transactions (default: every unreconciled transaction of the current fiscal year).'),
  },
  permission: { banking: ['reconcile'] },
  amounts: 'none',
  never: 'validates the entries the rules create (drafts), or reconciles a transaction twice.',
  idempotent: true,
  confirmation: true,
  async preview({ companyId, transactionIds }) {
    const result = await processTransactions({ companyId, transactionIds, autoApply: false })
    return { processed: result.processed, matched: result.matched, wouldApply: result.applicable, errors: result.errors }
  },
  execute: ({ companyId, transactionIds }) => processTransactions({ companyId, transactionIds, autoApply: true }),
  audit: ({ transactionIds }, result) => ({ transactionIds: transactionIds ?? 'all', applied: result.applied, processed: result.processed }),
})

const ruleCondition = z.object({
  conditionType: z
    .enum(['label', 'reference', 'counterparty', 'category', 'cashflowCategory', 'cashflowSubcategory', 'operationType', 'side', 'status', 'amount', 'attachment'])
    .describe('What the condition tests on the transaction.'),
  operator: z
    .enum(['equals', 'contains', 'startsWith', 'regex', 'between', 'gte', 'lte', 'gt', 'lt'])
    .describe('Text: equals, contains, startsWith, regex. Amount: equals, between (value and value2), gte, lte, gt, lt.'),
  value: z.string().max(500).optional().describe('Side: "debit" or "credit". Attachment: "with" or "without".'),
  value2: z.string().max(500).optional(),
})

const ruleLine = z.object({
  accountCode: z.string().min(1).max(20).describe('Account number (resolved in the fiscal year of each transaction).'),
  lineType: z.enum(['debit', 'credit', 'auto']).describe('auto: the side opposite to the bank line.'),
  amountType: z.enum(['full', 'percentage', 'fixed', 'remaining', 'ht', 'ttc', 'vat']),
  amountValue: z.number().min(0).optional().describe('Percentage or fixed amount in euros.'),
  description: z.string().max(500).optional(),
  order: z.number().int().min(0).optional(),
  vatType: z.enum(['none', 'deductible', 'collectible', 'intracom', 'import', 'reverse_charge']).optional(),
  vatRateSource: z.enum(['fixed', 'transaction']).optional(),
  vatRate: z.number().min(0).max(100).optional(),
  vatAccountCode: z.string().max(20).optional(),
  vatAccount2Code: z.string().max(20).optional(),
  vatOnDebit: z.boolean().optional(),
})

const ruleInput = {
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(0).max(1000).default(0),
  journalCode: z.string().max(3).default('BQ'),
  defaultVatAccountCode: z.string().max(20).optional(),
  autoCreate: z
    .boolean()
    .default(false)
    .describe("Créer automatiquement l'écriture: the refresh of the app applies the rule without a click. Otherwise it is a suggestion; run_rules applies it either way."),
  conditions: z.array(ruleCondition).min(1).max(20).describe('All conditions must match (AND).'),
  entryLines: z.array(ruleLine).min(1).max(20),
}

function summarizeRule(rule: Awaited<ReturnType<typeof findRule>>) {
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description,
    enabled: rule.enabled,
    priority: rule.priority,
    autoCreate: rule.autoCreate,
    journalCode: rule.journalCode,
    conditions: rule.conditions.map((c) => ({ conditionType: c.conditionType, operator: c.operator, value: c.value, value2: c.value2 })),
    entryLines: rule.entryLines.map((l) => ({
      accountCode: l.accountCode,
      lineType: l.lineType,
      amountType: l.amountType,
      amountValue: l.amountValue,
      vatType: l.vatType,
      vatRate: l.vatRate,
      vatAccountCode: l.vatAccountCode,
    })),
  }
}

const listRulesTool = fullControlTool({
  name: 'list_rules',
  title: "Lister les règles d'affectation",
  description: `Lists the assignment rules (règles d'affectation) of a company with their conditions and entry lines, highest priority first. ${ACTS_AS_USER}`,
  input: {},
  permission: { banking: ['read'] },
  amounts: 'euros',
  never: 'changes a rule (read only).',
  confirmation: false,
  readOnly: true,
  execute: async ({ companyId }) => (await listRules(companyId)).map(summarizeRule),
  audit: null,
})

const createRuleTool = fullControlTool({
  name: 'create_rule',
  title: "Créer une règle d'affectation",
  description: `Creates an assignment rule (règle d'affectation): conditions on bank transactions and the entry lines to book when they match (applied by run_rules). ${ACTS_AS_USER}`,
  input: ruleInput,
  permission: { ledger: ['manage'] },
  amounts: 'euros',
  never: 'runs the rule (run_rules does).',
  confirmation: false,
  execute: async ({ companyId, ...input }) => summarizeRule(await createRule(companyId, input)),
  audit: (_args, rule) => ({ ruleId: rule.id, name: rule.name }),
})

const updateRuleTool = fullControlTool({
  name: 'update_rule',
  title: "Modifier une règle d'affectation",
  description: `Replaces an assignment rule (règle d'affectation): its settings, all its conditions and all its entry lines (give the complete rule, as list_rules returns it). Entries already created stay. ${ACTS_AS_USER}`,
  input: { ruleId: z.string().min(1).describe('Rule id, from list_rules.'), ...ruleInput },
  permission: { ledger: ['manage'] },
  amounts: 'euros',
  never: 'runs the rule (run_rules does).',
  confirmation: false,
  idempotent: true,
  execute: async ({ companyId, ruleId, ...input }) => summarizeRule(await updateRule(companyId, ruleId, input)),
  audit: ({ ruleId }) => ({ ruleId }),
})

const deleteRuleTool = fullControlTool({
  name: 'delete_rule',
  title: "Supprimer une règle d'affectation",
  description: `Deletes an assignment rule (règle d'affectation). Entries it already created stay. ${ACTS_AS_USER} ${TWO_STEP}`,
  input: { ruleId: z.string().min(1).describe('Rule id, from list_rules.') },
  permission: { ledger: ['manage'] },
  amounts: 'none',
  never: 'deletes the entries the rule created.',
  confirmation: true,
  destructive: true,
  preview: async ({ companyId, ruleId }) => ({ ruleToDelete: summarizeRule(await findRule(companyId, ruleId)) }),
  execute: async ({ companyId, ruleId }) => ({ deleted: true, ...(await deleteRule(companyId, ruleId)) }),
  audit: ({ ruleId }, result) => ({ ruleId, name: result.name }),
})

// Bank accounts, sync and statements

const listBankAccounts = fullControlTool({
  name: 'list_bank_accounts',
  title: 'Lister les comptes bancaires',
  description: `Lists the bank connections of a company (Qonto, Revolut, Ponto or MANUAL for statement files) and their accounts, with the ids sync_bank and import_statement need. ${ACTS_AS_USER}`,
  input: {},
  permission: { banking: ['read'] },
  amounts: 'euros',
  never: 'returns bank credentials, or changes anything (read only).',
  confirmation: false,
  readOnly: true,
  async execute({ companyId }) {
    const connections = await prisma.bankConnection.findMany({
      where: { companyId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        provider: true,
        status: true,
        lastSyncAt: true,
        bankAccounts: {
          orderBy: { name: 'asc' },
          select: { id: true, name: true, displayName: true, iban: true, currency: true, balance: true, ledgerAccountCode: true, shouldSync: true, lastSyncedAt: true },
        },
      },
    })
    return connections.map((c) => ({
      connectionId: c.id,
      provider: c.provider,
      status: c.status,
      lastSyncAt: c.lastSyncAt?.toISOString() ?? null,
      accounts: c.bankAccounts.map((a) => ({ ...a, lastSyncedAt: a.lastSyncedAt?.toISOString() ?? null })),
    }))
  },
  audit: null,
})

const createBankAccount = fullControlTool({
  name: 'create_bank_account',
  title: 'Ajouter un compte bancaire manuel',
  description: `Adds a bank account without bank connection (MANUAL), fed by statement files through import_statement, mapped to its 512 ledger account. ${ACTS_AS_USER}`,
  input: {
    name: z.string().trim().min(1).max(100).describe('E.g. "Compte courant BoursoBank".'),
    iban: z.string().trim().max(42).optional(),
    ledgerAccountCode: z.string().trim().min(3).max(8).describe('Existing 512 account number, e.g. 512000.'),
  },
  permission: { banking: ['manage'] },
  amounts: 'none',
  never: 'connects a bank or stores credentials (that stays in the interface).',
  confirmation: false,
  execute: ({ companyId, name, iban, ledgerAccountCode }) =>
    createManualAccount(companyId, { name, iban: iban || null, currency: 'EUR', ledgerAccountCode }),
  audit: (_args, account) => ({ bankAccountId: account.id }),
})

const syncBank = fullControlTool({
  name: 'sync_bank',
  title: 'Synchroniser une banque',
  description: `Synchronizes one bank connection now (accounts, balances, transactions) from what the provider holds, like the scheduled sync. Never asks Ponto for a new bank refresh (Ponto reserves it to the user present on the page) and respects the per-company limit of bank calls. Idempotent: transactions already there are not duplicated. ${ACTS_AS_USER}`,
  input: { connectionId: z.string().min(1).describe('Bank connection id, from list_bank_accounts.') },
  permission: { banking: ['reconcile'] },
  amounts: 'none',
  never: 'asks the bank for a new refresh (Ponto), stores credentials or reconciles transactions.',
  openWorld: true,
  confirmation: false,
  idempotent: true,
  async execute({ companyId, connectionId }) {
    await limitBankCalls(companyId)
    const encryptionKey = getEncryptionKey()
    if (!encryptionKey) throw new ValidationError("La clé de chiffrement de l'instance n'est pas configurée.")
    const result = await refreshConnection({
      connectionId,
      companyId,
      customerIp: 'unknown',
      encryptionKey,
      requestBankRefresh: false,
    })
    return { success: result.success, itemsSynced: result.itemsSynced, errors: result.errors }
  },
  audit: ({ connectionId }, result) => ({ connectionId, itemsSynced: result.itemsSynced }),
})

/** Statement files sent through MCP: base64 in the JSON call, so kept smaller than browser uploads. */
export const MAX_MCP_STATEMENT_BYTES = 5 * 1024 * 1024

const importInput = {
  bankAccountId: z.string().min(1).describe('Bank account id, from list_bank_accounts (create_bank_account for a new one).'),
  fileName: z.string().min(1).max(200).describe('Original file name, e.g. "releve-2025-03.csv" (.csv, .xlsx, .ofx, .qfx, .xml camt.053).'),
  contentBase64: z.string().min(1).max(Math.ceil((MAX_MCP_STATEMENT_BYTES * 4) / 3) + 4).describe('The file content, base64 encoded (5 MB at most).'),
  options: statementOptionsSchema.optional().describe('Column mapping, date format, decimal separator... when the automatic detection is wrong.'),
  keep: keptProbablesSchema
    .optional()
    .describe('Probable duplicates to import anyway: [{ index, key }] as listed in the dry run (preview.probable).'),
  allowErrors: z.boolean().optional().describe('true imports the valid lines of a file with lines in error.'),
}

function decodeStatement(contentBase64: string): Uint8Array {
  const text = contentBase64.replace(/\s+/g, '')
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(text)) throw new ValidationError('Contenu du fichier invalide : encodez-le en base64.')
  const bytes = new Uint8Array(Buffer.from(text, 'base64'))
  if (bytes.length === 0) throw new ValidationError('Fichier vide.')
  assertFileSize({ size: bytes.length }, MAX_MCP_STATEMENT_BYTES)
  return bytes
}

const importStatementTool = fullControlTool({
  name: 'import_statement',
  title: 'Importer un relevé bancaire',
  description: `Imports a bank statement file (CSV, Excel, OFX/QFX, camt.053) into a bank account. ${ACTS_AS_USER} ${TWO_STEP} The dry run is the analysis: format, lines to import, exact duplicates (always skipped) and probable duplicates (same day and amount as an existing transaction, skipped unless kept), period, totals, errors. Importing the same file twice creates nothing the second time.`,
  input: importInput,
  permission: { banking: ['reconcile'] },
  amounts: 'euros',
  never: 'imports a transaction twice (exact duplicates are skipped) or reconciles the imported lines.',
  idempotent: true,
  confirmation: true,
  async preview({ companyId, bankAccountId, fileName, contentBase64, options, keep }) {
    const analysis = await analyzeStatement({
      companyId,
      bankAccountId,
      fileName,
      bytes: decodeStatement(contentBase64),
      options: options as TabularOptions | undefined,
      keep,
    })
    return analysis
  },
  async execute({ companyId, bankAccountId, fileName, contentBase64, options, keep, allowErrors }) {
    const result = await importStatement({
      companyId,
      bankAccountId,
      fileName,
      bytes: decodeStatement(contentBase64),
      options: options as TabularOptions | undefined,
      keep,
      allowErrors,
    })
    return {
      created: result.created,
      duplicates: result.duplicates,
      probableSkipped: result.probableSkipped,
      summary: result.summary,
      warnings: result.warnings,
      errorCount: result.errorCount,
    }
  },
  audit: ({ bankAccountId, fileName }, result) => ({ bankAccountId, fileName, created: result.created }),
})

export function registerBankingTools(register: RegisterTool) {
  register(reconcileTransaction)
  register(unreconcileTransactionTool)
  register(runRules)
  register(listRulesTool)
  register(createRuleTool)
  register(updateRuleTool)
  register(deleteRuleTool)
  register(listBankAccounts)
  register(createBankAccount)
  register(syncBank)
  register(importStatementTool)
}
