/**
 * Counts of the simple navigation (GET /api/companies/[id]/simple/counts)
 * and of the "À faire" list of the simple home (docs/mode-simple.md).
 *
 * "Dépenses à vérifier" counts the money that left the bank and is not yet
 * classified: debits of the company's bank accounts not reconciled with an
 * entry, nor declined: the lines of the page simple/depenses
 * (lib/simple/expenses-to-review.service.ts). "Recettes à vérifier" counts
 * the credits the same way: the lines of the page simple/recettes.
 */

import { countExpensesToReview } from "./expenses-to-review.service";

export interface SimpleCounts {
  /** Bank debits not reconciled yet. */
  expensesToCheck: number;
  /** Bank credits not reconciled yet. */
  incomeToCheck: number;
}

export async function countExpensesToCheck(companyId: string): Promise<number> {
  return countExpensesToReview(companyId, "debit");
}

export async function countIncomeToCheck(companyId: string): Promise<number> {
  return countExpensesToReview(companyId, "credit");
}

export async function loadSimpleCounts(
  companyId: string,
): Promise<SimpleCounts> {
  const [expensesToCheck, incomeToCheck] = await Promise.all([
    countExpensesToCheck(companyId),
    countIncomeToCheck(companyId),
  ]);
  return { expensesToCheck, incomeToCheck };
}
