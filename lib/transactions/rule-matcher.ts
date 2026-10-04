/**
 * Rule matching logic for transaction rules engine
 *
 * A rule matches a transaction when ALL its conditions match (AND). Which
 * rules apply where (docs/regles-d-affectation.md):
 * - "Appliquer les règles" (Rapprochement page, run_rules) applies every
 *   enabled rule that matches: the user asked for it;
 * - the refresh of the header applies only the rules with "Créer
 *   automatiquement l'écriture" (autoCreate); the others stay suggestions,
 *   applied with one click in the Rapprochement queue.
 * When several rules match, pickRule chooses the highest priority, then the
 * most specific (most conditions). Entries created by a rule are always
 * drafts, validated by a person in Écritures.
 *
 * Regex conditions never run on the backtracking RegExp engine: they are
 * compiled by rule-regex.ts (linear time) and one call of findMatchingRules
 * shares a step budget across all of them (KLEDG-SEC-001). A stored pattern
 * the compiler refuses (saved before patterns were checked) or a test that
 * runs out of budget does not match and is logged, never thrown.
 */

import type { TransactionRule, TransactionRuleCondition } from '@prisma/client';
import { logger } from '@/lib/logger';
import { toCents } from '@/lib/utils/money';
import { compileRulePattern, DEFAULT_REGEX_STEP_BUDGET, type RegexBudget, type RulePatternResult } from './rule-regex';
import type { EnrichedTransaction, TransactionMatchResult } from './types';

/**
 * Rule with conditions for matching
 */
export type RuleWithConditions = TransactionRule & {
  conditions: TransactionRuleCondition[];
};

/**
 * Finds rules that match a transaction
 * 
 * @param rules - Rules to check against the transaction
 * @param transaction - Transaction to match
 * @returns Array of matching rules with confidence scores
 */
export function findMatchingRules(
  rules: RuleWithConditions[],
  transaction: EnrichedTransaction,
  budget: RegexBudget = { remaining: DEFAULT_REGEX_STEP_BUDGET }
): TransactionMatchResult[] {
  const results: TransactionMatchResult[] = [];

  for (const rule of rules) {
    const matchResult = matchRule(rule, transaction, budget);
    if (matchResult.matched) {
      results.push(matchResult);
    }
  }

  return results;
}

/**
 * Checks if a rule matches a transaction by verifying all its conditions
 * 
 * @param rule - Rule to check
 * @param transaction - Transaction to match
 * @returns Match result with confidence score
 */
function matchRule(
  rule: RuleWithConditions,
  transaction: EnrichedTransaction,
  budget: RegexBudget
): TransactionMatchResult {
  // If no conditions, the rule doesn't match
  if (rule.conditions.length === 0) {
    return {
      ruleId: rule.id,
      ruleName: rule.name,
      matched: false,
      confidence: 0,
    };
  }

  // Verify that ALL conditions are satisfied (AND logic)
  let allMatched = true;
  let matchedConditionsCount = 0;

  for (const condition of rule.conditions) {
    const conditionMatch = matchCondition(condition, transaction, budget);
    if (!conditionMatch.matched) {
      allMatched = false;
      break;
    }
    matchedConditionsCount++;
  }

  if (!allMatched) {
    return {
      ruleId: rule.id,
      ruleName: rule.name,
      matched: false,
      confidence: 0,
    };
  }

  // Calculate confidence based on the number of matched conditions
  const confidence = Math.min(0.5 + (matchedConditionsCount * 0.1), 0.95);

  return {
    ruleId: rule.id,
    ruleName: rule.name,
    matched: true,
    confidence,
    priority: rule.priority,
    autoCreate: rule.autoCreate,
  };
}

/**
 * The rule to apply among the matches of a transaction: the highest
 * priority, then the most specific (most conditions), then the first in
 * rule order. Null when nothing matches.
 */
export function pickRule<T extends Pick<TransactionMatchResult, 'confidence' | 'priority'>>(matches: T[]): T | null {
  let best: T | null = null;
  for (const match of matches) {
    const priority = match.priority ?? 0;
    const bestPriority = best?.priority ?? 0;
    if (!best || priority > bestPriority || (priority === bestPriority && match.confidence > best.confidence)) {
      best = match;
    }
  }
  return best;
}

/**
 * Checks if a condition matches a transaction
 * 
 * @param condition - Condition to check
 * @param transaction - Transaction to match
 * @returns Whether the condition matches
 */
function matchCondition(
  condition: TransactionRuleCondition,
  transaction: EnrichedTransaction,
  budget: RegexBudget
): { matched: boolean } {
  switch (condition.conditionType) {
    case 'label':
      if (!condition.value || !transaction.label) {
        return { matched: false };
      }
      return matchValue(transaction.label, condition.operator, condition.value, budget);

    case 'reference':
      if (!condition.value || !transaction.reference) {
        return { matched: false };
      }
      return matchValue(transaction.reference, condition.operator, condition.value, budget);

    case 'counterparty':
      if (!condition.value || !transaction.counterpartyName) {
        return { matched: false };
      }
      return matchValue(transaction.counterpartyName, condition.operator, condition.value, budget);

    case 'category':
      if (!condition.value || !transaction.category) {
        return { matched: false };
      }
      return matchValue(transaction.category, condition.operator, condition.value, budget);

    case 'cashflowCategory':
      if (!condition.value || !transaction.cashflowCategory) {
        return { matched: false };
      }
      return matchValue(transaction.cashflowCategory, condition.operator, condition.value, budget);

    case 'cashflowSubcategory':
      if (!condition.value || !transaction.cashflowSubcategory) {
        return { matched: false };
      }
      return matchValue(transaction.cashflowSubcategory, condition.operator, condition.value, budget);

    case 'operationType':
      if (!condition.value || !transaction.operationType) {
        return { matched: false };
      }
      return matchValue(transaction.operationType, condition.operator, condition.value, budget);

    case 'side':
      if (!condition.value || !transaction.side) {
        return { matched: false };
      }
      return matchValue(transaction.side, condition.operator, condition.value, budget);

    case 'status':
      if (!condition.value || !transaction.status) {
        return { matched: false };
      }
      return matchValue(transaction.status, condition.operator, condition.value, budget);

    case 'amount': {
      if (!condition.value) {
        return { matched: false };
      }
      return { matched: matchAmount(transaction.amount, condition.operator, condition.value, condition.value2) };
    }

    case 'attachment': {
      const attachmentsCount =
        (transaction as EnrichedTransaction & { attachmentsCount?: number }).attachmentsCount ??
        (transaction as { attachments?: unknown[] }).attachments?.length ??
        0;
      const hasJustificatif = attachmentsCount > 0;
      if (!condition.value) {
        return { matched: false };
      }
      const wantsWith = (condition.value ?? '').toLowerCase() === 'yes';
      return { matched: wantsWith === hasJustificatif };
    }

    default:
      return { matched: false };
  }
}

/**
 * Compares a value with an operator
 * 
 * @param transactionValue - Value from the transaction
 * @param operator - Comparison operator
 * @param conditionValue - Value from the condition
 * @returns Whether the values match according to the operator
 */
function matchValue(
  transactionValue: string,
  operator: string,
  conditionValue: string,
  budget: RegexBudget
): { matched: boolean } {
  const txLower = transactionValue.toLowerCase();
  const condLower = conditionValue.toLowerCase();

  switch (operator) {
    case 'equals':
      return { matched: txLower === condLower };
    case 'contains':
      return { matched: txLower.includes(condLower) };
    case 'startsWith':
      return { matched: txLower.startsWith(condLower) };
    case 'regex': {
      const compiled = compiledPattern(conditionValue);
      if (!compiled.ok) {
        warnOnce(`refused:${conditionValue}`, '[Rules] Regex condition refused by the safe compiler, it never matches', {
          reason: compiled.message,
        });
        return { matched: false };
      }
      const matched = compiled.pattern.test(transactionValue, budget);
      if (matched === null) {
        warnOnce(`budget:${conditionValue}`, '[Rules] Regex step budget exhausted, condition treated as not matching');
        return { matched: false };
      }
      return { matched };
    }
    default:
      return { matched: false };
  }
}

/** Compiled patterns by source, bounded: rules are few, labels many. */
const PATTERN_CACHE_SIZE = 500;
const patternCache = new Map<string, RulePatternResult>();

function compiledPattern(pattern: string): RulePatternResult {
  let compiled = patternCache.get(pattern);
  if (!compiled) {
    if (patternCache.size >= PATTERN_CACHE_SIZE) patternCache.clear();
    compiled = compileRulePattern(pattern);
    patternCache.set(pattern, compiled);
  }
  return compiled;
}

/** Logs a degraded match once per pattern and process, not once per transaction. */
const warned = new Set<string>();

function warnOnce(key: string, message: string, details?: Record<string, unknown>) {
  if (warned.has(key)) return;
  if (warned.size >= PATTERN_CACHE_SIZE) warned.clear();
  warned.add(key);
  logger.warn(message, details ?? {});
}

/**
 * Compares the absolute amount of a transaction with the bound(s) of an
 * amount condition, exactly: the transaction in cents, the bound as the
 * decimal the user (or rule-builder) wrote. A bound may have more than two
 * decimals ("94.99999" from an older 5% tolerance) and a French decimal
 * comma ("12,50"). An unreadable bound never matches.
 */
export function matchAmount(
  amount: { toString(): string } | number | string,
  operator: string,
  value: string,
  value2?: string | null
): boolean {
  const cents = toCents(amount);
  if (cents === null) return false;
  const abs = BigInt(Math.abs(cents));
  const compare = (bound: string) => compareCentsToDecimal(abs, bound);

  if (operator === 'between' && value2) {
    const low = compare(value);
    const high = compare(value2);
    return low !== null && high !== null && low >= 0 && high <= 0;
  }
  const c = compare(value);
  if (c === null) return false;
  switch (operator) {
    case 'gte':
      return c >= 0;
    case 'lte':
      return c <= 0;
    case 'gt':
      return c > 0;
    case 'lt':
      return c < 0;
    default: {
      // equals: same amount once the bound is rounded to the cent
      const bound = toCents(value.replace(/\s/g, '').replace(',', '.'));
      return bound !== null && BigInt(bound) === abs;
    }
  }
}

/**
 * Sign of (cents / 100 - decimal), exact, or null when `decimal` is not a
 * decimal number. Spaces are ignored and a comma is a decimal separator.
 */
function compareCentsToDecimal(cents: bigint, decimal: string): -1 | 0 | 1 | null {
  const match = /^([+-]?)(\d*)(?:[.,](\d*))?$/.exec(decimal.replace(/\s/g, ''));
  if (!match || (match[2] === '' && !match[3])) return null;
  const [, sign, integer, fraction = ''] = match;
  // Both sides scaled to the same number of decimals (at least 2) as integers.
  const scale = Math.max(2, fraction.length);
  let bound = BigInt((integer || '0') + fraction.padEnd(scale, '0'));
  if (sign === '-') bound = -bound;
  const scaled = cents * BigInt(10) ** BigInt(scale - 2);
  return scaled === bound ? 0 : scaled > bound ? 1 : -1;
}
