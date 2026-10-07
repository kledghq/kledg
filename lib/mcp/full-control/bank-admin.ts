/**
 * Full control tools that complete banking and reconciliation, with the
 * rights of their routes: bank account settings and connections
 * (banking:manage), reconciliation in bulk and rule application
 * (banking:reconcile), deletion of bank transactions (banking:manage), copy
 * of a rule (ledger:manage), synchronizations with the providers and
 * receipts sent to Qonto (banking:reconcile, within the per-company limit
 * of bank calls). Thin wrappers over the services of app/api/banking/**,
 * app/api/transactions/**, app/api/transaction-rules/**,
 * app/api/integrations/** and app/api/simple/expenses/[id]/receipt.
 */

import { createHash } from 'crypto'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { writeAuditLog } from '@/lib/audit'
import { forAssistant, routeBody } from '@/lib/mcp/euros'
import { limitBankCalls } from '@/lib/banking/guard'
import { disconnectConnection, setBankAccountSync, setConnectionSyncedAccounts, updateBankAccount } from '@/lib/banking/connections.service'
import { selectBankAccount } from '@/lib/banking/select-bank-account.service'
import { AutoReconcileBodySchema, autoReconcile } from '@/lib/services/banking/reconciliation-service'
import { BulkTransactionsSchema, deleteTransactions, reconcileTransactions, unreconcileTransactions } from '@/lib/transactions/bulk-transactions.service'
import { applyRuleToTransaction } from '@/lib/transactions/rule-executor'
import { duplicateRule, findRule } from '@/lib/transactions/manage-rules.service'
import { SyncCompanyIntegrationsSchema, SyncIntegrationSchema, syncCompanyIntegration, syncCompanyIntegrations } from '@/lib/integrations/sync-company-integrations.service'
import { RefreshCompanyBodySchema, refreshCompany } from '@/lib/tasks/refresh-company'
import { syncQontoAttachments } from '@/lib/integrations/providers/qonto/sync-attachments'
import { uploadExpenseReceipt } from '@/lib/simple/upload-receipt.service'
import { fullControlTool, type RegisterTool } from './define'
import { ACTS_AS_USER, TWO_STEP } from './descriptions'
import { isoDate } from './resolve'
import { decodeBase64File, receiptTypeOf } from './files'
import { rulesState } from './fingerprint'

const transactionIds = z.array(z.string().min(1).max(64)).min(1).max(500).describe('Transaction ids, from list_bank_transactions.')

/** Transactions of the company among `ids`, for the dry runs (ids of other companies are not found). */
async function transactionsOf(companyId: string, ids: string[]) {
  const rows = await prisma.bankTransaction.findMany({
    where: { id: { in: ids }, bankAccount: { bankConnection: { companyId } } },
    select: { id: true, date: true, amount: true, side: true, label: true, counterpartyName: true, reconciled: true },
    orderBy: { date: 'asc' },
  })
  return { found: forAssistant(rows), notFound: ids.filter((id) => !rows.some((row) => row.id === id)) }
}

const manageBankAccountsTool = fullControlTool({
  name: 'manage_bank_accounts',
  title: 'Paramétrer les comptes bancaires',
  description: `Settings of the bank accounts and connections, like the Banque page: action update changes the display name, the 512 ledger account or the synchronization of bankAccountId (only the fields given); action select_default chooses the bank account shown by default (bankAccountId, null to clear); action set_synced_accounts keeps synchronized only accountIds among the accounts of connectionId; action disconnect disconnects connectionId (its credentials are deleted, its accounts and transactions stay, no longer synced). Ids come from list_bank_accounts. Connecting a bank stays in Kledg. ${ACTS_AS_USER} Actions set_synced_accounts and disconnect are high impact: ${TWO_STEP}`,
  input: {
    action: z.enum(['update', 'select_default', 'set_synced_accounts', 'disconnect']),
    bankAccountId: z.string().max(200).nullable().optional(),
    connectionId: z.string().max(64).optional(),
    displayName: z.string().trim().max(100).nullable().optional(),
    ledgerAccountCode: z.string().trim().max(8).nullable().optional().describe('512 account number of the bank account, null to clear.'),
    shouldSync: z.boolean().optional(),
    accountIds: z.array(z.string().min(1)).max(500).optional().describe('set_synced_accounts: the accounts to keep synchronized.'),
  },
  permission: { banking: ['manage'] },
  amounts: 'euros',
  never: 'connects a bank, reads or stores credentials, or deletes a transaction.',
  confirmation: true,
  highImpactActions: ['set_synced_accounts', 'disconnect'],
  destructive: true,
  async preview({ companyId, action, connectionId, accountIds }) {
    if (!connectionId) return { action }
    const connection = await prisma.bankConnection.findFirst({
      where: { id: connectionId, companyId },
      select: { id: true, provider: true, status: true, bankAccounts: { select: { id: true, name: true, shouldSync: true } } },
    })
    if (!connection) throw new ValidationError('Connexion bancaire introuvable')
    return { action, connection, keepSynced: accountIds ?? null }
  },
  async execute({ companyId, action, bankAccountId, connectionId, displayName, ledgerAccountCode, shouldSync, accountIds }) {
    if (action === 'select_default') return { action, selected: forAssistant(await selectBankAccount(companyId, bankAccountId ?? null)) }
    if (action === 'update') {
      if (!bankAccountId) throw new ValidationError('bankAccountId est requis pour cette action.')
      if (shouldSync !== undefined) {
        await setBankAccountSync(companyId, bankAccountId, shouldSync)
        await writeAuditLog('info', shouldSync ? 'Bank account sync enabled' : 'Bank account sync disabled', {
          action: shouldSync ? 'BANK_ACCOUNT_SYNC_ON' : 'BANK_ACCOUNT_SYNC_OFF',
          companyId,
          metadata: { bankAccountId, source: 'mcp' },
        })
      }
      const account = await updateBankAccount(bankAccountId, companyId, { displayName, ledgerAccountCode })
      return { action, account: { id: account.id, name: account.name, displayName: account.displayName, ledgerAccountCode: account.ledgerAccountCode, shouldSync: account.shouldSync } }
    }
    if (!connectionId) throw new ValidationError('connectionId est requis pour cette action.')
    if (action === 'set_synced_accounts') return { action, accounts: forAssistant(await setConnectionSyncedAccounts(companyId, connectionId, accountIds ?? [])) }
    await disconnectConnection(connectionId, companyId)
    await writeAuditLog('info', 'Bank connection disconnected', { action: 'BANK_DISCONNECT', companyId, metadata: { connectionId, source: 'mcp' } })
    return { action, disconnected: connectionId }
  },
  audit: ({ action, bankAccountId, connectionId }) => ({ action, bankAccountId: bankAccountId ?? null, connectionId: connectionId ?? null }),
})

const bulkReconcileTool = fullControlTool({
  name: 'bulk_reconcile',
  title: 'Rapprocher en masse',
  description: `Reconciliation of several transactions, like the Transactions and Rapprochement pages: action mark_reconciled marks transactionIds reconciled without an entry; action unreconcile undoes their reconciliation (deletes the draft entries it created, refused per transaction when the entry is validated); action auto_match matches the entries of the BQ journal with unreconciled transactions of the same amount, side and date within a day, over a period; action apply_rule applies the assignment rule ruleId to transactionId (a draft entry, reconciled at once; 409 if already reconciled). Failures are reported per transaction. ${ACTS_AS_USER} Every action is high impact, like run_rules: ${TWO_STEP}`,
  input: {
    action: z.enum(['mark_reconciled', 'unreconcile', 'auto_match', 'apply_rule']),
    transactionIds: transactionIds.optional(),
    transactionId: z.string().max(64).optional().describe('apply_rule: the transaction.'),
    ruleId: z.string().max(64).optional().describe('apply_rule: the rule, from list_rules.'),
    startDate: isoDate.optional().describe('auto_match: first day of the period.'),
    endDate: isoDate.optional().describe('auto_match: last day of the period.'),
  },
  permission: { banking: ['reconcile'] },
  amounts: 'euros',
  units: 'Dates as yyyy-mm-dd.',
  never: 'validates an entry or deletes a transaction.',
  confirmation: true,
  // Reconciling, by rule or without an entry, follows the approval of run_rules (KLEDG-R3-MCP-10).
  highImpactActions: ['mark_reconciled', 'unreconcile', 'auto_match', 'apply_rule'],
  destructive: true,
  targetState: ({ companyId, action, ruleId }) => (action === 'apply_rule' && ruleId ? rulesState(companyId, ruleId) : Promise.resolve(null)),
  async preview({ companyId, action, transactionIds: ids, transactionId, ruleId, startDate, endDate }) {
    if (action === 'apply_rule') {
      if (!transactionId || !ruleId) throw new ValidationError('transactionId et ruleId sont requis pour appliquer une règle.')
      const rule = await findRule(companyId, ruleId)
      return {
        action,
        transactions: await transactionsOf(companyId, [transactionId]),
        rule: { id: rule.id, name: rule.name, journalCode: rule.journalCode, entryLines: rule.entryLines.map((l) => ({ accountCode: l.accountCode, lineType: l.lineType, amountType: l.amountType, amountValue: l.amountValue })) },
        effect: 'Écriture en brouillon créée par la règle, transaction rapprochée.',
      }
    }
    if (action === 'auto_match') {
      const where = {
        bankAccount: { bankConnection: { companyId } },
        reconciled: false,
        ...((startDate || endDate) && { date: { ...(startDate && { gte: new Date(`${startDate}T00:00:00.000Z`) }), ...(endDate && { lte: new Date(`${endDate}T00:00:00.000Z`) }) } }),
      }
      return { action, unreconciledTransactions: await prisma.bankTransaction.count({ where }), startDate: startDate ?? null, endDate: endDate ?? null }
    }
    return { action, transactions: ids ? await transactionsOf(companyId, ids) : null }
  },
  async execute({ companyId, action, transactionIds: ids, transactionId, ruleId, startDate, endDate }) {
    if (action === 'apply_rule') {
      if (!transactionId || !ruleId) throw new ValidationError('transactionId et ruleId sont requis pour appliquer une règle.')
      return { action, ...(await applyRuleToTransaction(companyId, transactionId, ruleId)) }
    }
    if (action === 'auto_match') return { action, ...forAssistant(await autoReconcile({ companyId, ...routeBody(AutoReconcileBodySchema, { startDate, endDate }) })) as object }
    const body = routeBody(BulkTransactionsSchema, { transactionIds: ids })
    const outcome = action === 'mark_reconciled' ? await reconcileTransactions(companyId, body.transactionIds) : await unreconcileTransactions(companyId, body.transactionIds)
    return { action, done: outcome.results.length, failed: outcome.errors.length, results: outcome.results, errors: outcome.errors }
  },
  audit: ({ action, transactionIds: ids, transactionId, ruleId }) => ({ action, transactionIds: ids ?? (transactionId ? [transactionId] : null), ruleId: ruleId ?? null }),
})

const deleteBankTransactionsTool = fullControlTool({
  name: 'delete_bank_transactions',
  title: 'Supprimer des transactions bancaires',
  description: `Deletes bank transactions (an imported statement line in error, a duplicate); failures (a reconciled transaction...) are reported per transaction. ${ACTS_AS_USER} ${TWO_STEP}`,
  input: { transactionIds },
  permission: { banking: ['manage'] },
  amounts: 'euros',
  never: 'deletes an accounting entry.',
  confirmation: true,
  destructive: true,
  preview: async ({ companyId, transactionIds: ids }) => transactionsOf(companyId, ids),
  async execute({ companyId, transactionIds: ids }) {
    const outcome = await deleteTransactions(companyId, routeBody(BulkTransactionsSchema, { transactionIds: ids }).transactionIds)
    return { deleted: outcome.results.length, failed: outcome.errors.length, results: outcome.results, errors: outcome.errors }
  },
  audit: ({ transactionIds: ids }, result) => ({ transactionIds: ids, deleted: result.deleted }),
})

const duplicateRuleTool = fullControlTool({
  name: 'duplicate_rule',
  title: 'Dupliquer une règle d’affectation',
  description: `Copies an assignment rule with its conditions and lines; the copy is disabled until it is changed with update_rule and enabled. ${ACTS_AS_USER}`,
  input: { ruleId: z.string().min(1).max(64).describe('Rule id, from list_rules.') },
  permission: { ledger: ['manage'] },
  amounts: 'none',
  never: 'runs the rule or changes the original.',
  confirmation: false,
  async execute({ companyId, ruleId }) {
    const { original, copy } = await duplicateRule(companyId, ruleId)
    await writeAuditLog('info', `Transaction rule duplicated: ${copy.name}`, {
      action: 'DUPLICATE_TRANSACTION_RULE',
      companyId,
      metadata: { originalRuleId: original.id, duplicatedRuleId: copy.id, name: copy.name, source: 'mcp' },
    })
    return { ruleId: copy.id, name: copy.name, enabled: copy.enabled }
  },
  audit: ({ ruleId }, result) => ({ originalRuleId: ruleId, ruleId: result.ruleId }),
})

const syncBankDataTool = fullControlTool({
  name: 'sync_bank_data',
  title: 'Synchroniser les intégrations bancaires',
  description: `Synchronizes with the bank providers, like the buttons of the Banque and Tâches pages: scope integration syncs one integration (integrationId, from get_bank_sync_status) and optionally some of its features; scope all_integrations syncs every active bank integration (maxDays of history, 1 to 365); scope refresh syncs the banks then runs the assignment rules marked autoCreate (the Actualiser button of the tasks); scope qonto_receipts copies the receipts Qonto holds for the Qonto debits. Within the per-company limit of bank calls; a failing bank does not stop the others. Bank connections (sync_bank) are synchronized one by one. ${ACTS_AS_USER} Scope refresh applies rules, like run_rules, so it is high impact: ${TWO_STEP}`,
  input: {
    scope: z.enum(['integration', 'all_integrations', 'refresh', 'qonto_receipts']),
    integrationId: z.string().max(64).optional(),
    features: z.array(z.string().max(40)).max(10).optional().describe('scope integration: features to sync (unknown ones are ignored).'),
    maxDays: z.number().int().min(1).max(365).optional().describe('Days of history to read.'),
  },
  permission: { banking: ['reconcile'] },
  amounts: 'none',
  never: 'stores credentials, connects a bank or validates an entry.',
  openWorld: true,
  // The refresh runs the autoCreate rules: it follows the approval of run_rules (KLEDG-R3-MCP-10).
  confirmation: true,
  highImpactWhen: ({ scope }) => scope === 'refresh',
  targetState: ({ companyId, scope }) => (scope === 'refresh' ? rulesState(companyId) : Promise.resolve(null)),
  idempotent: true,
  async preview({ companyId, scope, maxDays }) {
    const rules = await prisma.transactionRule.findMany({
      where: { companyId, enabled: true, autoCreate: true },
      select: { id: true, name: true },
      orderBy: { priority: 'desc' },
    })
    const unreconciled = await prisma.bankTransaction.count({ where: { bankAccount: { bankConnection: { companyId } }, reconciled: false } })
    return {
      scope,
      maxDays: maxDays ?? null,
      autoCreateRules: rules,
      unreconciledTransactions: unreconciled,
      effect: 'Synchronisation des banques, puis écritures en brouillon créées par les règles «\u00a0Créer automatiquement l’écriture\u00a0» pour les transactions qui leur correspondent, rapprochées.',
    }
  },
  async execute({ companyId, scope, integrationId, features, maxDays }) {
    await limitBankCalls(companyId)
    if (scope === 'integration') {
      if (!integrationId) throw new ValidationError('integrationId est requis pour cette synchronisation.')
      return { scope, ...forAssistant(await syncCompanyIntegration(companyId, integrationId, routeBody(SyncIntegrationSchema, { features }))) as object }
    }
    if (scope === 'all_integrations') return { scope, ...forAssistant(await syncCompanyIntegrations(companyId, routeBody(SyncCompanyIntegrationsSchema, { maxDays }))) as object }
    if (scope === 'refresh') return { scope, ...forAssistant(await refreshCompany(companyId, routeBody(RefreshCompanyBodySchema, { maxDays }).maxDays)) as object }
    return { scope, ...forAssistant(await syncQontoAttachments(companyId)) as object }
  },
  audit: ({ scope, integrationId }) => ({ scope, integrationId: integrationId ?? null }),
})

/** Receipts sent through MCP: base64 in the JSON call. */
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024

const uploadReceiptTool = fullControlTool({
  name: 'upload_receipt',
  title: 'Envoyer un justificatif',
  description: `Sends the receipt of a Qonto bank transaction (JPEG, PNG or PDF, base64, 5 MB at most) to Qonto and records its reference in Kledg, like the receipt button of the simple mode and of the transactions; other banks answer what to do instead. Within the per-company limit of bank calls. A file sent to Qonto cannot be taken back by Kledg: ${ACTS_AS_USER} ${TWO_STEP} The dry run shows the transaction and the file (name, type, size, SHA-256).`,
  input: {
    transactionId: z.string().min(1).max(64).describe('Transaction id, from list_bank_transactions or list_missing_receipts.'),
    fileName: z.string().min(1).max(200).describe('E.g. "facture-martin.pdf" (.pdf, .png, .jpg).'),
    contentBase64: z.string().min(1).max(Math.ceil((MAX_RECEIPT_BYTES * 4) / 3) + 4),
  },
  permission: { banking: ['reconcile'] },
  amounts: 'none',
  never: 'reconciles the transaction or books an entry.',
  openWorld: true,
  // A write at Qonto that Kledg cannot undo, like the other Qonto writes (create_draft_invoice, import_qonto_invoices).
  confirmation: true,
  async preview({ companyId, transactionId, fileName, contentBase64 }) {
    const bytes = decodeBase64File(contentBase64, MAX_RECEIPT_BYTES)
    const type = receiptTypeOf(fileName)
    const [transaction] = (await transactionsOf(companyId, [transactionId])).found as unknown[]
    if (!transaction) throw new NotFoundError('Transaction introuvable')
    return {
      transaction,
      file: { name: fileName, type, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') },
      destination: 'Qonto',
    }
  },
  async execute({ companyId, transactionId, fileName, contentBase64 }) {
    const bytes = decodeBase64File(contentBase64, MAX_RECEIPT_BYTES)
    const file = new File([bytes as BlobPart], fileName, { type: receiptTypeOf(fileName) })
    return uploadExpenseReceipt(companyId, transactionId, file)
  },
  audit: ({ transactionId, fileName }) => ({ transactionId, fileName }),
})

export function registerBankAdminTools(register: RegisterTool) {
  register(manageBankAccountsTool)
  register(bulkReconcileTool)
  register(deleteBankTransactionsTool)
  register(duplicateRuleTool)
  register(syncBankDataTool)
  register(uploadReceiptTool)
}
