/**
 * Draft-level tools of budgets and detected subscriptions (docs/budget.md,
 * docs/abonnements.md): create the budget of an open fiscal year, add or
 * change a budget line (monthly amounts, recurring items), record a
 * decision on a detected subscription and add one to the budget. Thin
 * wrappers over lib/budgets/manage-budgets.service.ts and
 * lib/subscriptions/decide-subscriptions.service.ts, with the rights of
 * their API routes. A budget only plans: nothing here touches the books.
 */

import { z } from 'zod'
import { NotFoundError } from '@/lib/accounting/errors'
import { parseInput } from '@/lib/api/zod-fields'
import {
  CreateBudgetBodySchema,
  CreateBudgetLineBodySchema,
  UpdateBudgetLineBodySchema,
  createBudget,
  createBudgetLine,
  findBudgetOfFiscalYear,
  updateBudgetLine,
  type BudgetLineView,
} from '@/lib/budgets/manage-budgets.service'
import { BUDGET_FREQUENCIES } from '@/lib/budgets/recurring'
import {
  AddSubscriptionToBudgetBodySchema,
  SubscriptionDecisionBodySchema,
  addSubscriptionToBudget,
  decideSubscription,
} from '@/lib/subscriptions/decide-subscriptions.service'
import type { SubscriptionView } from '@/lib/subscriptions/detect-subscriptions.service'
import { fromCents } from '@/lib/utils/money'
import { centsFromEuros, eurosInput, kledgPageUrl } from '@/lib/mcp/tool-meta'
import { draftTool, type RegisterDraftTool } from './define'

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mois attendu au format AAAA-MM')
const fiscalYearId = z.string().min(1, "L'exercice est requis").max(64).describe('Fiscal year id, from list_fiscal_years or list_budgets.')

const amountsInput = z
  .array(z.object({ month, amount: eurosInput.describe('Budget of the month, in euros.') }))
  .max(36)
  .describe('Amounts entered per month (months of the fiscal year). On update, they REPLACE every month entered on the line; omit to keep them.')

const recurringInput = z
  .array(
    z.object({
      label: z.string().min(1).max(120),
      amount: eurosInput.describe('Amount of each occurrence, in euros.'),
      frequency: z.enum(BUDGET_FREQUENCIES).describe('MONTHLY, QUARTERLY or YEARLY.'),
      startMonth: month.describe('First month it falls due (yyyy-mm); sets the rhythm of a quarterly or yearly item.'),
      endMonth: month.nullable().optional().describe('Last month, or null for no end.'),
    }),
  )
  .max(50)
  .describe('Recurring items of the line (rent, subscriptions...). On update, they REPLACE the line’s items; omit to keep them.')

function centsOfAmounts(amounts: Array<{ month: string; amount: number }> | undefined) {
  return amounts?.map((a) => ({ month: a.month, amountCents: centsFromEuros(a.amount, `Montant de ${a.month}`) }))
}

function centsOfItems(items: z.infer<typeof recurringInput> | undefined) {
  return items?.map(({ amount, ...item }) => ({ ...item, amountCents: centsFromEuros(amount, `Montant de « ${item.label} »`) }))
}

function lineOut(line: BudgetLineView) {
  return {
    id: line.id,
    accountPrefix: line.accountPrefix,
    label: line.label,
    side: line.side,
    annualBudget: fromCents(line.annualCents),
    amounts: line.amounts.map((a) => ({ month: a.month, amount: fromCents(a.amountCents) })),
    recurringItems: line.recurringItems.map((i) => ({ label: i.label, amount: fromCents(i.amountCents), frequency: i.frequency, startMonth: i.startMonth, endMonth: i.endMonth })),
  }
}

async function budgetIdOf(companyId: string, fiscalYearId: string): Promise<string> {
  const budget = await findBudgetOfFiscalYear(companyId, fiscalYearId)
  if (!budget) throw new NotFoundError("Cet exercice n'a pas de budget : créez-le d'abord avec create_budget.")
  return budget.id
}

const NEVER_BOOKS = 'creates or changes an accounting entry, and never changes the budget of a closed fiscal year (409).'

const createBudgetTool = draftTool({
  name: 'create_budget',
  title: 'Créer le budget d’un exercice',
  summary:
    'Creates the budget of an open fiscal year, empty or with one line per main post (template "posts": 60 to 65 charges and 70 sales), to fill with create_budget_line or update_budget_line. One budget per fiscal year: a second call answers 409 and changes nothing.',
  never: NEVER_BOOKS,
  amounts: 'none',
  input: { fiscalYearId, template: z.enum(['empty', 'posts']).default('empty') },
  permission: { budgets: ['manage'] },
  destructive: false,
  idempotent: true,
  async execute(args) {
    const budget = await createBudget(args.companyId, parseInput(CreateBudgetBodySchema, { fiscalYearId: args.fiscalYearId, template: args.template }))
    return {
      budgetId: budget.id,
      fiscalYear: budget.fiscalYear.year,
      changes: { budgetCreated: budget.id, lines: budget.lines.map((l) => ({ id: l.id, accountPrefix: l.accountPrefix, label: l.label })) },
      reviewUrl: kledgPageUrl(args.companyId, 'budget'),
      message: `Budget de l'exercice ${budget.fiscalYear.year} créé : complétez ses lignes, puis vérifiez-le dans Kledg.`,
    }
  },
  audit: (args, result) => ({ budgetId: result.budgetId, fiscalYearId: args.fiscalYearId }),
})

const createBudgetLineTool = draftTool({
  name: 'create_budget_line',
  title: 'Ajouter une ligne de budget',
  summary:
    'Adds a line to the budget of a fiscal year: an account number or prefix of charges (class 6) or produits (class 7), e.g. 606 or 706 (an account goes to the line with the longest matching prefix), with amounts per month and recurring items. Answers the line as saved with its annual budget.',
  never: NEVER_BOOKS,
  amounts: 'euros',
  input: {
    fiscalYearId,
    accountPrefix: z.string().min(1).max(10).describe('Account number or prefix, class 6 or 7.'),
    label: z.string().max(120).optional().describe('Defaults to the label of the account.'),
    amounts: amountsInput.optional(),
    recurringItems: recurringInput.optional(),
  },
  permission: { budgets: ['manage'] },
  destructive: false,
  idempotent: false,
  async execute(args) {
    const budgetId = await budgetIdOf(args.companyId, args.fiscalYearId)
    const body = parseInput(CreateBudgetLineBodySchema, {
      accountPrefix: args.accountPrefix,
      label: args.label,
      amounts: centsOfAmounts(args.amounts),
      recurringItems: centsOfItems(args.recurringItems),
    })
    const line = await createBudgetLine(args.companyId, budgetId, body)
    return {
      line: lineOut(line),
      changes: { lineCreated: line.id, accountPrefix: line.accountPrefix },
      reviewUrl: kledgPageUrl(args.companyId, 'budget'),
      message: `Ligne ${line.accountPrefix} ajoutée au budget : vérifiez-la dans Kledg.`,
    }
  },
  audit: (_args, result) => ({ budgetLineId: result.line.id }),
})

const updateBudgetLineTool = draftTool({
  name: 'update_budget_line',
  title: 'Modifier une ligne de budget',
  summary:
    'Changes a budget line (id from get_budget): its account prefix, its label (null: the account label again), its amounts per month and its recurring items. Amounts and recurring items, when given, REPLACE the line’s; omitted, they are kept. Answers the line before and after.',
  never: `${NEVER_BOOKS.replace(/\.$/, '')}, and never deletes a line or a budget.`,
  amounts: 'euros',
  input: {
    lineId: z.string().min(1).max(64).describe('Budget line id, from get_budget.'),
    accountPrefix: z.string().min(1).max(10).optional(),
    label: z.string().max(120).nullable().optional(),
    amounts: amountsInput.optional(),
    recurringItems: recurringInput.optional(),
  },
  permission: { budgets: ['manage'] },
  destructive: true,
  idempotent: true,
  async execute(args) {
    const body = parseInput(UpdateBudgetLineBodySchema, {
      accountPrefix: args.accountPrefix,
      label: args.label,
      amounts: centsOfAmounts(args.amounts),
      recurringItems: centsOfItems(args.recurringItems),
    })
    const line = await updateBudgetLine(args.companyId, args.lineId, body)
    const changed = (['accountPrefix', 'label', 'amounts', 'recurringItems'] as const).filter((field) => args[field] !== undefined)
    return {
      line: lineOut(line),
      changes: { lineUpdated: line.id, fields: changed },
      reviewUrl: kledgPageUrl(args.companyId, 'budget'),
      message: `Ligne ${line.accountPrefix} du budget modifiée : vérifiez-la dans Kledg.`,
    }
  },
  audit: (_args, result) => ({ budgetLineId: result.line.id, fields: result.changes.fields }),
})

function subscriptionOut(s: SubscriptionView) {
  return {
    id: s.id,
    counterparty: s.name,
    cadence: s.cadence,
    amount: fromCents(s.typicalAmountCents),
    kind: s.kind,
    decision: s.decision?.status ?? null,
    countsAsSubscription: s.countsAsSubscription,
    budgetLine: s.decision?.budgetLine ? { accountPrefix: s.decision.budgetLine.accountPrefix, label: s.decision.budgetLine.label, fiscalYear: s.decision.budgetLine.fiscalYear } : null,
  }
}

const DECISIONS = { confirm: 'confirmed', ignore: 'ignored', count_as_subscription: 'confirmed', reset: 'pending' } as const

const classifySubscriptionTool = draftTool({
  name: 'classify_subscription',
  title: 'Décider d’un abonnement détecté',
  summary:
    'Records the decision on a detected subscription (id from list_detected_subscriptions): confirm it, ignore it (a salary, a transfer between own accounts, a false positive), count a recurring charge as a subscription (confirms it, so it counts in the totals), or reset it to undecided. The subscription is detected again from the bank lines at each call; answers it with its decision.',
  never: 'changes a bank transaction, an entry or the budget (use add_subscription_to_budget for the budget).',
  amounts: 'euros',
  input: {
    subscriptionId: z.string().min(1).max(100).describe('Subscription id, from list_detected_subscriptions.'),
    decision: z.enum(['confirm', 'ignore', 'count_as_subscription', 'reset']),
  },
  permission: { banking: ['reconcile'] },
  destructive: true,
  idempotent: true,
  async execute(args) {
    const body = parseInput(SubscriptionDecisionBodySchema, { subscriptionId: args.subscriptionId, status: DECISIONS[args.decision] })
    const subscription = await decideSubscription(args.companyId, body)
    return {
      subscription: subscriptionOut(subscription),
      changes: { subscriptionId: subscription.id, decision: subscription.decision?.status ?? 'pending' },
      reviewUrl: kledgPageUrl(args.companyId, 'subscriptions'),
      message: `Décision enregistrée pour ${subscription.name} : vous pouvez la revoir dans Kledg.`,
    }
  },
  audit: (args, result) => ({ subscriptionId: result.subscription.id, decision: args.decision }),
})

const addSubscriptionToBudgetTool = draftTool({
  name: 'add_subscription_to_budget',
  title: 'Ajouter un abonnement au budget',
  summary:
    'Adds a detected subscription to a charges line (class 6) of an open budget as a recurring item, at its current amount and cadence, from the month of its first payment unless startMonth is given, and confirms the subscription; both or neither are written. A weekly subscription is refused (enter its amounts per month). The same label at the same rhythm on the line answers 409, so a retry adds nothing.',
  never: NEVER_BOOKS,
  amounts: 'euros',
  input: {
    subscriptionId: z.string().min(1).max(100).describe('Subscription id, from list_detected_subscriptions.'),
    budgetLineId: z.string().min(1).max(64).describe('Charges line id, from get_budget.'),
    label: z.string().max(120).optional().describe('Defaults to the counterparty name.'),
    startMonth: month.optional(),
  },
  permission: [{ budgets: ['manage'] }, { banking: ['reconcile'] }],
  destructive: false,
  idempotent: true,
  async execute(args) {
    const body = parseInput(AddSubscriptionToBudgetBodySchema, { subscriptionId: args.subscriptionId, budgetLineId: args.budgetLineId, label: args.label, startMonth: args.startMonth })
    const subscription = await addSubscriptionToBudget(args.companyId, body)
    return {
      subscription: subscriptionOut(subscription),
      changes: { recurringItemAdded: { budgetLineId: args.budgetLineId, amount: fromCents(subscription.typicalAmountCents), cadence: subscription.cadence }, decision: 'confirmed' },
      reviewUrl: kledgPageUrl(args.companyId, 'budget'),
      message: `${subscription.name} ajouté au budget comme élément récurrent : vérifiez la ligne dans Kledg.`,
    }
  },
  audit: (args, result) => ({ subscriptionId: result.subscription.id, budgetLineId: args.budgetLineId }),
})

export function registerBudgetDraftTools(register: RegisterDraftTool) {
  register(createBudgetTool)
  register(createBudgetLineTool)
  register(updateBudgetLineTool)
  register(classifySubscriptionTool)
  register(addSubscriptionToBudgetTool)
}
