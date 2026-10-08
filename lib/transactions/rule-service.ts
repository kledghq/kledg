/**
 * Rule service for transaction rules engine
 * 
 * This module handles database queries and orchestrates rule matching.
 */

import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { approvedStateActive, checkApprovedState } from '@/lib/approved-state/guard';
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
  if (!approvedStateActive()) return enabledRules(prisma, companyId);
  // An approved MCP run applies the rules as the user saw them (KLEDG-R3-MCP-01):
  // checked under a lock of the rules, read in the same transaction.
  return prisma.$transaction(async (tx) => {
    await checkApprovedState(tx, { kind: 'rules', companyId });
    return enabledRules(tx, companyId);
  });
}

function enabledRules(db: Prisma.TransactionClient | typeof prisma, companyId: string) {
  return db.transactionRule.findMany({
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
