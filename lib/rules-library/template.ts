/**
 * Format of a template of the rules library (bibliothèque de règles,
 * docs/bibliotheque-de-regles.md): a ready-made assignment rule that a
 * company adds to its rules, its accounts mapped to its own chart
 * (account-mapping.ts).
 *
 * A template is data, versioned in lib/rules-library/catalog: anyone can
 * contribute one by pull request. The schema below is checked for every
 * template by lib/rules-library/__tests__/catalog.test.ts, with the rules
 * a schema cannot express (PCG accounts that exist, VAT fields coherent with
 * the declared treatment, sources for any special VAT treatment, sample
 * labels that match and labels that do not).
 *
 * Entry lines have the shape of the lines of a saved rule
 * (RuleEntryLineSchema of lib/transactions/manage-rules.service.ts), with
 * standard PCG codes: a template never books the bank line, the engine
 * balances the entry on the bank account of the transaction.
 */

import { z } from 'zod'

export const RULE_TEMPLATE_CATEGORIES = [
  { id: 'frais-bancaires', label: 'Frais bancaires' },
  { id: 'logiciels', label: 'Logiciels et SaaS' },
  { id: 'telecom', label: 'Télécom et internet' },
  { id: 'energie', label: 'Énergie' },
  { id: 'assurance', label: 'Assurances' },
  { id: 'social', label: 'Cotisations sociales' },
  { id: 'impots', label: 'Impôts et taxes' },
  { id: 'encaissements', label: 'Encaissements' },
  { id: 'transport', label: 'Transport' },
  { id: 'repas', label: "Repas d'affaires" },
  { id: 'carburant', label: 'Carburant' },
  { id: 'vehicules', label: 'Véhicules de tourisme' },
  { id: 'loyers', label: 'Loyers' },
  { id: 'honoraires', label: 'Honoraires' },
  { id: 'publicite', label: 'Publicité' },
  { id: 'fournitures', label: 'Fournitures' },
  { id: 'poste', label: 'Poste' },
  { id: 'presse', label: 'Presse' },
] as const

export type RuleTemplateCategory = (typeof RULE_TEMPLATE_CATEGORIES)[number]['id']

const CATEGORY_IDS = RULE_TEMPLATE_CATEGORIES.map((c) => c.id) as [RuleTemplateCategory, ...RuleTemplateCategory[]]

/**
 * VAT treatment of a template, what its lines must say (checked by the
 * catalog test):
 * - `standard`: VAT deductible at 20 %, detected by the bank (Qonto) with
 *   20 % as the fallback rate, on 44566;
 * - `reduced`: deductible at a reduced rate (10, 5,5 or 2,1 %), fixed or
 *   detected with that fallback; needs a source;
 * - `detected`: the rate depends on the invoice (exempt unless the supplier
 *   opted, mixed sellers): VAT detected by the bank only, no fallback rate;
 *   needs a source;
 * - `self-assessed`: a supplier established outside France, VAT
 *   autoliquidée at 20 % on 44566 and 4452 (CGI art. 283, 2); needs a
 *   source;
 * - `partial`: VAT deductible on a share of the amount only (fuel of
 *   passenger cars): a percentage line with VAT, the rest without; needs a
 *   source;
 * - `not-deductible`: VAT that cannot be deducted stays in the cost, no
 *   VAT line; needs a source;
 * - `none`: no VAT (exempt or outside its scope: insurance, taxes, social
 *   contributions, transfers); needs a source.
 */
export const VAT_TREATMENTS = ['standard', 'reduced', 'detected', 'self-assessed', 'partial', 'not-deductible', 'none'] as const
export type VatTreatment = (typeof VAT_TREATMENTS)[number]

/** Treatments that are not the plain 20 % deduction: the template cites its legal source. */
export const SPECIAL_VAT_TREATMENTS: readonly VatTreatment[] = ['reduced', 'detected', 'self-assessed', 'partial', 'not-deductible', 'none']

const pcgCode = z.string().regex(/^\d{2,8}$/, 'Code de compte PCG attendu')

export const TemplateConditionSchema = z.object({
  conditionType: z.enum(['label', 'counterparty', 'reference', 'side', 'operationType', 'amount']),
  operator: z.enum(['equals', 'contains', 'startsWith', 'regex', 'gt', 'gte', 'lt', 'lte', 'between']),
  value: z.string().min(1).max(300),
  value2: z.string().max(300).optional(),
  /** The condition as a sentence for the card, required for a pattern ("Libellé contenant OVH ou OVHCLOUD"). */
  display: z.string().min(5).max(200).optional(),
})

export const TemplateLineSchema = z.object({
  accountCode: pcgCode,
  lineType: z.enum(['debit', 'credit']),
  amountType: z.enum(['full', 'percentage', 'remaining']),
  amountValue: z.number().positive().max(100).optional(),
  description: z.string().max(200).optional(),
  vatType: z.enum(['none', 'deductible', 'intracom', 'import']).optional(),
  vatRateSource: z.enum(['fixed', 'transaction']).optional(),
  vatRate: z.number().min(0).max(100).optional(),
  vatAccountCode: pcgCode.optional(),
  vatAccount2Code: pcgCode.optional(),
})

export const TemplateSourceSchema = z.object({
  label: z.string().min(3).max(200),
  url: z.string().url().startsWith('https://'),
})

export const RuleTemplateSchema = z.object({
  /** Stable id (kebab-case): links and installed rules refer to it, never rename it. */
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(60),
  name: z.string().min(3).max(80),
  category: z.enum(CATEGORY_IDS),
  description: z.string().min(10).max(300),
  conditions: z.array(TemplateConditionSchema).min(1).max(5),
  lines: z.array(TemplateLineSchema).min(1).max(5),
  vat: z.object({
    treatment: z.enum(VAT_TREATMENTS),
    /** One line: why this VAT treatment, shown on the card. */
    why: z.string().min(10).max(400),
  }),
  /** Official sources (BOFiP, Légifrance, impots.gouv) of the VAT or deductibility rule. */
  sources: z.array(TemplateSourceSchema).max(4),
  /** Bank labels the conditions must recognise (2 or 3), and close ones they must not. */
  samples: z.object({
    match: z.array(z.string().min(2)).min(2).max(4),
    noMatch: z.array(z.string().min(2)).max(4).optional(),
  }),
})

export type RuleTemplate = z.infer<typeof RuleTemplateSchema>
export type RuleTemplateLine = z.infer<typeof TemplateLineSchema>
export type RuleTemplateCondition = z.infer<typeof TemplateConditionSchema>

/** Side condition of an expense (a debit of the bank account). */
export const DEBIT = { conditionType: 'side', operator: 'equals', value: 'debit' } as const
/** Side condition of a receipt (a credit of the bank account). */
export const CREDIT = { conditionType: 'side', operator: 'equals', value: 'credit' } as const

/**
 * Label condition: a case-insensitive pattern run by the linear-time
 * matcher (lib/transactions/rule-regex.ts), and the bank labels it stands
 * for, in words ("OVH, OVHCLOUD").
 */
export function labelMatches(pattern: string, words: string): RuleTemplateCondition {
  return { conditionType: 'label', operator: 'regex', value: pattern, display: `Libellé contenant ${words}` }
}

/** Expense line with VAT deductible at 20 %, detected by the bank, 20 % when it detects nothing. */
export function standardVatLine(accountCode: string): RuleTemplateLine {
  return { accountCode, lineType: 'debit', amountType: 'full', vatType: 'deductible', vatRateSource: 'transaction', vatRate: 20, vatAccountCode: '44566' }
}

/** Expense line whose VAT is the one detected by the bank, none when it detects nothing. */
export function detectedVatLine(accountCode: string): RuleTemplateLine {
  return { accountCode, lineType: 'debit', amountType: 'full', vatType: 'deductible', vatRateSource: 'transaction', vatAccountCode: '44566' }
}

/** Expense line with VAT deductible at a reduced rate, detected by the bank, `rate` when it detects nothing. */
export function reducedVatLine(accountCode: string, rate: number): RuleTemplateLine {
  return { accountCode, lineType: 'debit', amountType: 'full', vatType: 'deductible', vatRateSource: 'transaction', vatRate: rate, vatAccountCode: '44566' }
}

/**
 * Service bought from a supplier established outside France: the amount
 * paid is the price without VAT, the company self-assesses 20 % (deductible
 * on 44566, due on 4452), CGI art. 283, 2. `intracom` for a supplier in the
 * European Union, `import` outside it: the entry is the same.
 */
export function selfAssessedLine(accountCode: string, vatType: 'intracom' | 'import'): RuleTemplateLine {
  return { accountCode, lineType: 'debit', amountType: 'full', vatType, vatRateSource: 'fixed', vatRate: 20, vatAccountCode: '44566', vatAccount2Code: '4452' }
}

/** Line without VAT (exempt, outside the scope of VAT, or VAT that is not deductible and stays in the cost). */
export function noVatLine(accountCode: string, lineType: 'debit' | 'credit' = 'debit'): RuleTemplateLine {
  return { accountCode, lineType, amountType: 'full' }
}
