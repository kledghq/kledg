/**
 * What Kledg sets up when a company connects Stripe (#1).
 *
 * 1. The ledger account of the Stripe balance, in every open fiscal year:
 *    517100 "Stripe" by default (PCG 517 "Autres organismes financiers",
 *    class 51 "Banques, établissements financiers et assimilés": funds the
 *    company can pay out, cash in the balance sheet), or 467100 "Stripe"
 *    (PCG 467 "Divers comptes débiteurs et produits à recevoir": a claim on
 *    Stripe) when the company chose it. A code already used by an account
 *    of another name is skipped for the next one (517101...). The euro
 *    account of the connection is mapped to it by the sync; an account in
 *    another currency is not posted from its amount (#131) and keeps no
 *    mapping.
 * 2. The Stripe rules of the library (lib/rules-library/catalog/stripe.ts),
 *    with the accounts they need. A rule the company already has (same name
 *    or same conditions) is left as it is and reported: in particular a
 *    "Virements Stripe" rule that books payouts on 467 must be changed to
 *    58, or the payout would be booked twice (58 on the Stripe side, 467 on the bank side).
 *
 * Both steps are idempotent: running them again creates nothing new.
 */

import { ConflictError, ValidationError } from '@/lib/accounting/errors'
import { ensureAccounts } from '@/lib/accounting/fiscal-year-closure/ledger'
import { prisma } from '@/lib/prisma'
import { addRuleFromTemplate } from '@/lib/rules-library/manage-rule-templates.service'
import { STRIPE_TEMPLATES } from '@/lib/rules-library/catalog/stripe'
import type { StripeConnectionConfig } from '@/lib/integrations/create-integration.service'

export type StripeBalanceAccount = StripeConnectionConfig['balanceAccount']

const STRIPE_ACCOUNT_LABEL = 'Stripe'

/** Rules applied by the refresh without a click: their entry does not depend on the sale (fees, payouts). */
const AUTOMATIC_TEMPLATES = new Set(['stripe-commissions', 'stripe-frais-logiciels', 'stripe-virements-sortants', 'stripe-virements-recus'])

/** Above the rules a company writes by default (0): a Stripe line is booked by its Stripe rule first. */
const STRIPE_RULE_PRIORITY = 10

/** The balance account a connection was set up with (517 when not said). */
export function stripeBalanceAccountOf(config: unknown): StripeBalanceAccount {
  const value = (config as { balanceAccount?: unknown } | null)?.balanceAccount
  return value === '467' ? '467' : '517'
}

/**
 * Code of the Stripe account: the first of 517100 to 517199 (or 467100...)
 * that no fiscal year holds under another name.
 */
function pickStripeCode(base: StripeBalanceAccount, taken: ReadonlyMap<string, string>): string | null {
  for (let n = 100; n < 200; n++) {
    const code = `${base}${n}`
    const label = taken.get(code)
    if (label === undefined || label.trim().toLowerCase() === STRIPE_ACCOUNT_LABEL.toLowerCase()) return code
  }
  return null
}

/**
 * Creates the Stripe account in every open fiscal year of the company and
 * returns its code (null without an open fiscal year: the euro account then
 * stays unmapped, to map on the Banque page).
 */
export async function ensureStripeLedgerAccount(companyId: string, base: StripeBalanceAccount): Promise<string | null> {
  const years = await prisma.fiscalYear.findMany({ where: { companyId, isClosed: false }, select: { id: true } })
  if (years.length === 0) return null
  const existing = await prisma.account.findMany({
    where: { companyId, fiscalYearId: { in: years.map((y) => y.id) }, code: { startsWith: base } },
    select: { code: true, label: true },
  })
  const taken = new Map(existing.map((a) => [a.code, a.label]))
  const code = pickStripeCode(base, taken)
  if (!code) return null
  await prisma.$transaction(async (tx) => {
    for (const year of years) await ensureAccounts(tx, companyId, year.id, [{ code, label: STRIPE_ACCOUNT_LABEL }])
  })
  return code
}

export interface StripeRulesOutcome {
  /** Names of the rules added. */
  added: string[]
  /** Rules the company already had, left unchanged: name of the template, and of the existing rule. */
  kept: Array<{ template: string; rule: string }>
}

/** Adds the Stripe rules the company does not have yet (none without an open fiscal year). */
export async function installStripeRules(companyId: string): Promise<StripeRulesOutcome> {
  const outcome: StripeRulesOutcome = { added: [], kept: [] }
  for (const template of STRIPE_TEMPLATES) {
    try {
      const { rule } = await addRuleFromTemplate(companyId, template.id, {
        createMissingAccounts: true,
        autoCreate: AUTOMATIC_TEMPLATES.has(template.id),
        priority: STRIPE_RULE_PRIORITY,
      })
      outcome.added.push(rule.name)
    } catch (error) {
      if (error instanceof ConflictError) {
        const existing = /«\s*(.+?)\s*»/.exec(error.message)?.[1] ?? template.name
        outcome.kept.push({ template: template.name, rule: existing })
        continue
      }
      // No open fiscal year: nothing to add the rules to yet
      if (error instanceof ValidationError) return outcome
      throw error
    }
  }
  return outcome
}

/** Both steps, run once the Stripe connection is saved. */
export async function setUpStripeBooks(companyId: string, base: StripeBalanceAccount): Promise<{ ledgerAccountCode: string | null; rules: StripeRulesOutcome }> {
  const ledgerAccountCode = await ensureStripeLedgerAccount(companyId, base)
  const rules = await installStripeRules(companyId)
  return { ledgerAccountCode, rules }
}
