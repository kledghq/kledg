/**
 * Full control tools of the rules library (bibliothèque de règles), at the
 * level of create_rule: add the rule of a template, its accounts mapped to
 * the company's chart, and copy rules from another company of the user.
 * Thin wrappers over lib/rules-library/manage-rule-templates.service.ts and
 * lib/rules-library/copy-rules.service.ts. The catalog and the suggestions
 * are read with list_rule_templates (lib/mcp/transaction-read-tools.ts).
 */

import { z } from 'zod'
import { addRuleFromTemplate } from '@/lib/rules-library/manage-rule-templates.service'
import { MAX_COPIED_RULES, copyRulesFromCompany } from '@/lib/rules-library/copy-rules.service'
import { fullControlTool, type RegisterTool } from './define'
import { ACTS_AS_USER, TWO_STEP } from './descriptions'
import { AUTO_CREATE_EFFECT, AUTO_CREATE_STEP } from './banking'
import { companyLock, ruleTargets } from './fingerprint'

const createMissingAccounts = z
  .boolean()
  .default(false)
  .describe('true: create the accounts the chart lacks (under the account they subdivide, active fiscal year). false: use the parent account when there is one; a code without one is refused.')

const addRuleFromTemplateTool = fullControlTool({
  name: 'add_rule_from_template',
  title: 'Ajouter une règle de la bibliothèque',
  description: `Adds the assignment rule of a template of the rules library (ids from list_rule_templates) to a company: its conditions, its entry lines and VAT, account codes mapped to the company's chart (a subdivision the company made is preferred, e.g. 6262 for 626). Refused when the same rule exists (same name or same conditions) unless allowDuplicate. ${ACTS_AS_USER} ${AUTO_CREATE_STEP}`,
  input: {
    templateId: z.string().min(1).max(60).describe('Template id, from list_rule_templates.'),
    createMissingAccounts,
    allowDuplicate: z.boolean().default(false).describe('Add it even when a rule with the same name or the same conditions exists.'),
    name: z.string().max(200).optional().describe("The rule's name; the template's name by default."),
    enabled: z.boolean().default(true),
    autoCreate: z.boolean().default(false).describe("Créer automatiquement l'écriture: the refresh of the app applies the rule without a click."),
    priority: z.number().int().min(-1000).max(1000).default(0),
  },
  permission: { ledger: ['manage'] },
  amounts: 'none',
  never: 'runs the rule (run_rules does), or creates an account unless createMissingAccounts is true.',
  targetState: ({ companyId }) => [companyLock(companyId), ...ruleTargets(companyId)],
  confirmation: true,
  highImpactWhen: ({ autoCreate }) => autoCreate === true,
  preview: async (input) => ({ ruleFromTemplate: input, effect: AUTO_CREATE_EFFECT }),
  async execute({ companyId, templateId, ...input }) {
    const result = await addRuleFromTemplate(companyId, templateId, input)
    return {
      ruleId: result.rule.id,
      name: result.rule.name,
      templateId: result.templateId,
      enabled: result.rule.enabled,
      entryLines: result.rule.entryLines.map((l) => ({ accountCode: l.accountCode, vatType: l.vatType, vatRateSource: l.vatRateSource, vatRate: l.vatRate, vatAccountCode: l.vatAccountCode, vatAccount2Code: l.vatAccount2Code })),
      createdAccounts: result.createdAccounts,
      parentAccountsUsed: result.fallbacks,
      nearDuplicates: result.nearDuplicates,
    }
  },
  audit: ({ templateId }, result) => ({ templateId, ruleId: result.ruleId, createdAccounts: result.createdAccounts }),
})

const copyRulesFromCompanyTool = fullControlTool({
  name: 'copy_rules_from_company',
  title: 'Copier des règles depuis une autre société',
  description: `Copies assignment rules of another company of the user (sourceCompanyId, from list_companies; rule ids from list_rules on that company) into this company, account codes mapped to its chart. Needs banking:read in the source company and ledger:manage here, both within this connection's companies. Copies are inactive unless enabled; a rule with the same name or conditions as one of this company is skipped. ${ACTS_AS_USER} Enabled copies keep the autoCreate of their source (applied without a click by every refresh), so enabled: true is high impact, like run_rules: ${TWO_STEP} Inactive copies are made at once.`,
  input: {
    sourceCompanyId: z.string().min(1).max(64).describe('Company to copy from, from list_companies.'),
    ruleIds: z.array(z.string().min(1).max(64)).min(1).max(MAX_COPIED_RULES).describe('Rule ids of the source company, from list_rules.'),
    createMissingAccounts,
    enabled: z.boolean().default(false).describe('Activate the copies at once; inactive by default so their accounts are checked first.'),
  },
  permission: { ledger: ['manage'] },
  amounts: 'none',
  never: 'changes the source company, or runs the copied rules.',
  targetState: ({ companyId, sourceCompanyId }) => [companyLock(companyId), ...ruleTargets(companyId), ...ruleTargets(sourceCompanyId)],
  confirmation: true,
  highImpactWhen: ({ enabled }) => enabled === true,
  preview: async ({ sourceCompanyId, ruleIds, createMissingAccounts, enabled }) => ({ sourceCompanyId, ruleIds, createMissingAccounts, enabled, effect: AUTO_CREATE_EFFECT }),
  execute: ({ companyId, ...input }, ctx) => copyRulesFromCompany(ctx.group, companyId, input),
  audit: ({ sourceCompanyId }, result) => ({ sourceCompanyId, ruleIds: result.copied.map((c) => c.ruleId), createdAccounts: result.createdAccounts }),
})

export function registerRulesLibraryTools(register: RegisterTool) {
  register(addRuleFromTemplateTool)
  register(copyRulesFromCompanyTool)
}
