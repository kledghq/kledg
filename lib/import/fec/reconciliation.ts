/**
 * Bank reconciliation logic for FEC import
 * 
 * This module handles automatic reconciliation of bank entries
 * with bank transactions during FEC import.
 */

import { prisma } from '@/lib/prisma';
import type { EntryLine } from '@/lib/accounting/types';
import { logger } from '@/lib/logger';
import { bankLineCents, reconciliationWindow, transactionMatchesBankLine } from '@/lib/reconciliation/bank-line-match';

/**
 * Attempts to automatically reconcile a bank entry with bank transactions
 * 
 * This function searches for unreconciled bank transactions that match the entry
 * based on amount (to the cent) and date (within ±1 day). It handles the inversion
 * between accounting entries and bank transactions (debit entry = credit transaction).
 * 
 * @param companyId - Company ID
 * @param entryId - Accounting entry ID
 * @param entryLines - Entry lines to reconcile
 * @param entryDate - Entry date
 */
export async function attemptBankReconciliation(
  companyId: string,
  entryId: string,
  entryLines: EntryLine[],
  entryDate: Date
): Promise<void> {
  try {
    // Find all bank lines in the entry (account class 51)
    const bankLines: Array<{ line: EntryLine; account: { id: string; code: string } }> = [];

    for (const line of entryLines) {
      const account = await prisma.account.findUnique({
        where: { id: line.accountId },
        select: { id: true, code: true },
      });

      if (account && account.code.startsWith('51')) {
        bankLines.push({ line, account });
      }
    }

    if (bankLines.length === 0) {
      return; // No bank line in this entry
    }

    // Search for unreconciled bank transactions that match
    // Criteria: same amount (to the cent), same date (within 1 day), corresponding bank account
    const bankAccounts = await prisma.bankAccount.findMany({
      where: {
        bankConnection: {
          companyId,
        },
      },
      include: {
        bankConnection: true,
      },
    });

    if (bankAccounts.length === 0) {
      return;
    }

    // For each bank line, search for a matching transaction
    for (const { line: bankLine } of bankLines) {
      // Calculate the bank entry amount (debit - credit)
      const lineCents = bankLineCents(bankLine);

      // For each bank account, search for matching transactions
      for (const bankAccount of bankAccounts) {
        // Search for unreconciled transactions within a ±1 day window

        const matchingTransactions = await prisma.bankTransaction.findMany({
          where: {
            bankAccountId: bankAccount.id,
            reconciled: false,
            date: reconciliationWindow(entryDate),
          },
        });

        // Same amount to the cent, opposite side (a debit on the bank account is a credit transaction)
        const exactMatches = matchingTransactions.filter((transaction) => transactionMatchesBankLine(lineCents, transaction));

        // Reconcile all transactions that match (same amount and same date)
        if (exactMatches.length > 0) {
          for (const transaction of exactMatches) {
            await prisma.bankTransaction.update({
              where: { id: transaction.id },
              data: {
                reconciled: true,
                reconciledAt: new Date(),
                reconciledWith: entryId,
              },
            });
          }
          // Stop after the first successful reconciliation for this bank line
          return;
        }
      }
    }
  } catch (error) {
    // Don't block import if reconciliation fails
    logger.error('Error during automatic bank reconciliation:', error);
  }
}
