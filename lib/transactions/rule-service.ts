/**
 * Rule service for transaction rules engine
 * 
 * This module handles database queries and orchestrates rule matching.
 */

import { prisma } from '@/lib/prisma';
import { findMatchingRules as findMatchingRulesInternal } from './rule-matcher';
import type { EnrichedTransaction, TransactionMatchResult } from './types';

/**
 * Finds rules that match a transaction by querying the database and matching
 * 
 * @param companyId - ID of the company
 * @param transaction - Transaction to match
 * @returns Array of matching rules with confidence scores
 */
export async function findMatchingRules(
  companyId: string,
  transaction: EnrichedTransaction
): Promise<TransactionMatchResult[]> {
  return findMatchingRulesInternal(await loadEnabledRules(companyId), transaction);
}

/**
 * Loads the enabled rules of the company once and returns a matcher that
 * works in memory: for runs over many transactions (rules engine, refresh),
 * which otherwise read the rules again for every transaction.
 */
export async function loadRuleMatcher(
  companyId: string
): Promise<(transaction: EnrichedTransaction) => TransactionMatchResult[]> {
  const rules = await loadEnabledRules(companyId);
  return (transaction) => findMatchingRulesInternal(rules, transaction);
}

function loadEnabledRules(companyId: string) {
  return prisma.transactionRule.findMany({
    where: {
      companyId,
      enabled: true,
    },
    include: {
      conditions: true,
      entryLines: {
        orderBy: {
          order: 'asc',
        },
      },
    },
    orderBy: {
      priority: 'desc',
    },
  });
}
