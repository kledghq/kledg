/**
 * Read tools of bank transactions and assignment rules (kledg:read and
 * banking:read, like the matching routes): what the "Traiter la
 * transaction" dialog shows (locked bank line, fiscal years, suggested
 * counterparts), the rules that match a transaction and the rule a
 * transaction suggests, the simulation of a rule on an example, and the
 * rules library (templates, suggestions from the company's transactions).
 * Nothing is written: reconciling and creating rules are full control tools.
 */

import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { CompanyGuard } from '@/lib/mcp/company-access'
import { json, run } from '@/lib/mcp/tool-result'
import { READ_ONLY, describeTool } from '@/lib/mcp/tool-meta'
import { assistantInput, forAssistant, routeBody } from '@/lib/mcp/euros'
import { ValidationError } from '@/lib/accounting/errors'
import { getReconciliationContext } from '@/lib/reconciliation/context'
import { getRuleDraftFromTransaction, getTransactionRuleSuggestions } from '@/lib/transactions/rule-suggestions.service'
import { SimulateRuleDataSchema, TransactionExampleSchema, simulateRule, simulateRuleFromData } from '@/lib/transactions/rule-simulator'
import { getRuleTemplatePrefill, listRuleTemplates, type TemplateView } from '@/lib/rules-library/manage-rule-templates.service'

const companyId = z.string().describe('Company id, from list_companies.')

export function registerTransactionReadTools(server: McpServer, guard: CompanyGuard) {
  server.registerTool(
    'get_transaction_details',
    {
      title: 'Détail d’une transaction bancaire',
      description: describeTool({
        summary:
          'Returns what is needed to process one bank transaction: the transaction, its locked bank line, the fiscal years and the suggested counterpart lines (view reconciliation, the "Traiter la transaction" dialog), the assignment rules that match it (view rule_suggestions), or the rule it suggests to create (view rule_draft). Transaction ids come from list_bank_transactions.',
        access: 'read',
        permission: { banking: ['read'] },
        amounts: 'euros',
        units: 'Dates as yyyy-mm-dd.',
        never: 'reconciles the transaction or creates a rule (read only).',
      }),
      inputSchema: z.object({
        companyId,
        transactionId: z.string().min(1).max(64),
        view: z.enum(['reconciliation', 'rule_suggestions', 'rule_draft']).default('reconciliation'),
      }),
      annotations: READ_ONLY,
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { banking: ['read'] })
        if (args.view === 'rule_suggestions') return json(forAssistant(await getTransactionRuleSuggestions(args.companyId, args.transactionId)))
        if (args.view === 'rule_draft') return json(forAssistant(await getRuleDraftFromTransaction(args.companyId, args.transactionId)))
        return json(forAssistant(await getReconciliationContext(args.companyId, args.transactionId)))
      }),
  )

  server.registerTool(
    'simulate_rule',
    {
      title: 'Simuler une règle d’affectation',
      description: describeTool({
        summary:
          'Returns the entry an assignment rule would book for an example transaction (amount in euros and side, optional label and VAT): a saved rule (ruleId, from list_rules) or a rule being written (ruleData with its entry lines, the shape of create_rule).',
        access: 'read',
        permission: { banking: ['read'] },
        amounts: 'euros',
        never: 'books an entry, reconciles a transaction or saves the rule (nothing is written).',
      }),
      inputSchema: z.object({
        companyId,
        ruleId: z.string().max(64).optional(),
        ruleData: assistantInput(SimulateRuleDataSchema.shape.ruleData).optional(),
        transactionExample: TransactionExampleSchema,
      }),
      annotations: READ_ONLY,
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { banking: ['read'] })
        if (args.ruleId) return json(forAssistant(await simulateRule(args.ruleId, args.transactionExample, args.companyId)))
        if (!args.ruleData) throw new ValidationError('Indiquez ruleId (règle enregistrée) ou ruleData (règle à simuler).')
        const body = routeBody(SimulateRuleDataSchema, { ruleData: args.ruleData, transactionExample: args.transactionExample })
        return json(forAssistant(await simulateRuleFromData(body.ruleData, body.transactionExample, args.companyId)))
      }),
  )

  server.registerTool(
    'list_rule_templates',
    {
      title: 'Bibliothèque de règles',
      description: describeTool({
        summary:
          "Lists the templates of the rules library (bibliothèque de règles): ready-made assignment rules for common French suppliers and payments (bank fees, SaaS, telecoms, taxes, URSSAF, transport, fuel...), each with its conditions, entry lines, VAT treatment and why, official sources, its accounts mapped to the company's chart, whether the company already has it and the rules that look like it. `suggestions` ranks the templates by the company's bank transactions of the last 12 months they would recognise that no rule recognises yet (matchCount). With templateId, one template and the rule it would add. Add one with add_rule_from_template.",
        access: 'read',
        permission: { banking: ['read'] },
        amounts: 'none',
        units: 'VAT rates in percent.',
        never: 'adds a rule or creates an account (read only).',
      }),
      inputSchema: z.object({
        companyId,
        templateId: z.string().max(60).optional(),
        category: z.string().max(40).optional().describe('Category id (frais-bancaires, logiciels, telecom, energie, assurance, social, impots, encaissements, transport, repas, carburant, vehicules, loyers, honoraires, publicite, fournitures, poste, presse).'),
        search: z.string().max(100).optional().describe('Words of the name or description.'),
      }),
      annotations: READ_ONLY,
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { banking: ['read'] })
        if (args.templateId) {
          const { template, prefill } = await getRuleTemplatePrefill(args.companyId, args.templateId)
          return json({ template: templateForAssistant(template), rule: { name: prefill.name, description: prefill.description, conditions: prefill.conditions } })
        }
        const library = await listRuleTemplates(args.companyId)
        const search = args.search?.trim().toLowerCase()
        const templates = library.templates
          .filter((t) => !args.category || t.category === args.category)
          .filter((t) => !search || `${t.name} ${t.description}`.toLowerCase().includes(search))
        return json({
          categories: library.categories,
          suggestions: library.suggestions,
          analysis: library.analysis,
          templates: templates.map(templateForAssistant),
        })
      }),
  )
}

/** A template as the assistant reads it: what the card shows, without the test samples. */
function templateForAssistant(t: TemplateView) {
  return {
    id: t.id,
    name: t.name,
    category: t.category,
    description: t.description,
    conditions: t.conditions.map((c) => ({ conditionType: c.conditionType, operator: c.operator, value: c.value, display: c.display })),
    entryLines: t.lines,
    vat: t.vat,
    sources: t.sources,
    accounts: t.accounts,
    missingAccounts: t.missingAccounts,
    alreadyAdded: t.status.installed,
    nearDuplicates: t.status.nearDuplicates,
  }
}
