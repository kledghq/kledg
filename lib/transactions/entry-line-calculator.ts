/**
 * Shared logic for calculating accounting entry lines from rule templates
 * 
 * This module contains the core logic for converting rule entry lines
 * into accounting entry lines, handling VAT calculations, and balancing entries.
 */

import type { EntryLine } from './types';
import { toCents } from '@/lib/utils/money';

/**
 * Generic rule entry line interface for calculations
 */
interface RuleEntryLine {
  id?: string;
  amountType: string;
  amountValue?: number | null;
  lineType: string;
  vatType?: string | null;
  vatRateSource?: string | null;
  vatRate?: number | null;
  vatOnDebit?: boolean | null;
}

/** TVA issue de la transaction (ex. détection Qonto) */
export interface TransactionVatContext {
  vatRate?: number | null;
  vatAmount?: number | null;
}

/**
 * Calculated amounts for a rule entry line
 */
interface CalculatedAmounts {
  lineAmount: number;
  amountHT: number;
  amountTTC: number;
  vatAmount: number;
  isDebit: boolean;
  isCredit: boolean;
}

/**
 * Calculates the base amount for a rule entry line based on transaction amount
 * 
 * @param line - Rule entry line
 * @param transactionAmount - Total transaction amount
 * @param remainingAmount - Remaining amount after other lines (for 'remaining' type)
 * @returns Calculated line amount
 */
export function calculateLineAmount(
  line: RuleEntryLine,
  transactionAmount: number,
  remainingAmount: number
): number {
  switch (line.amountType) {
    case 'full':
      return transactionAmount;
    case 'percentage':
      if (line.amountValue) {
        return transactionAmount * (Number(line.amountValue) / 100);
      }
      return 0;
    case 'fixed':
      if (line.amountValue) {
        return Number(line.amountValue);
      }
      return 0;
    case 'remaining':
      return remainingAmount;
    case 'ht':
    case 'ttc':
    case 'vat':
      // Will be calculated with VAT
      return 0;
    default:
      return 0;
  }
}

/**
 * Calculates all amounts (HT, TTC, VAT) for a rule entry line.
 * When vatRateSource === 'transaction', uses transactionVat (e.g. Qonto): on privilégie le montant TVA
 * pour calculer le HT (HT = TTC - TVA). Le taux Qonto est ignoré s'il est < 0 (ex. -1 = taux non standard).
 *
 * @param line - Rule entry line
 * @param lineAmount - Base line amount (typically transaction amount = TTC)
 * @param transactionVat - Optional VAT from bank transaction (vatAmount in euros; vatRate % only if >= 0)
 * @returns Calculated amounts including VAT
 */
export function calculateAmountsWithVAT(
  line: RuleEntryLine,
  lineAmount: number,
  transactionVat?: TransactionVatContext | null
): { amountHT: number; amountTTC: number; vatAmount: number } {
  let amountHT = lineAmount;
  let amountTTC = lineAmount;
  let vatAmount = 0;

  const useTransactionVat =
    line.vatRateSource === 'transaction' &&
    transactionVat &&
    (transactionVat.vatAmount != null ||
      (transactionVat.vatRate != null && Number(transactionVat.vatRate) >= 0));
  // Taux transaction : ignoré si < 0 (Qonto renvoie -1 pour taux non standard)
  const transactionRateValid =
    transactionVat?.vatRate != null && Number(transactionVat.vatRate) >= 0;
  const effectiveVatRate =
    useTransactionVat && transactionRateValid
      ? Number(transactionVat!.vatRate) / 100
      : line.vatRate != null
        ? Number(line.vatRate) / 100
        : null;
  const effectiveVatAmount =
    useTransactionVat && transactionVat.vatAmount != null
      ? Number(transactionVat.vatAmount)
      : null;

  if (line.vatType && line.vatType !== 'none' && (effectiveVatRate != null || effectiveVatAmount != null)) {
    if (effectiveVatAmount != null && effectiveVatAmount >= 0) {
      amountTTC = lineAmount;
      vatAmount = effectiveVatAmount;
      amountHT = amountTTC - vatAmount;
    } else if (effectiveVatRate != null) {
      const vatRate = effectiveVatRate;

    if (line.amountType === 'ht') {
      // HT amount given, calculate TTC and VAT
      amountHT = lineAmount;
      amountTTC = lineAmount * (1 + vatRate);
      vatAmount = amountTTC - amountHT;
    } else if (line.amountType === 'ttc') {
      // TTC amount given, calculate HT and VAT
      amountTTC = lineAmount;
      amountHT = lineAmount / (1 + vatRate);
      vatAmount = amountTTC - amountHT;
    } else if (line.amountType === 'vat') {
      // VAT amount given, calculate HT and TTC
      vatAmount = lineAmount;
      amountHT = vatAmount / vatRate;
      amountTTC = amountHT + vatAmount;
    } else if (
      (line.vatType === 'intracom' || line.vatType === 'import') &&
      (line.amountType === 'full' ||
        line.amountType === 'percentage' ||
        line.amountType === 'fixed' ||
        line.amountType === 'remaining')
    ) {
      // TVA intracommunautaire / import : le montant total reste dans le compte de charge,
      // la TVA est calculée en plus (taux × montant), sans toucher au montant HT
      amountHT = lineAmount;
      vatAmount = lineAmount * vatRate;
      amountTTC = amountHT + vatAmount;
    } else {
      // full, percentage, fixed, remaining: consider as TTC if VAT
      amountTTC = lineAmount;
      amountHT = lineAmount / (1 + vatRate);
      vatAmount = amountTTC - amountHT;
    }
    }
  }

  return { amountHT, amountTTC, vatAmount };
}

/**
 * Determines if a line should be debit or credit based on line type and transaction side
 * 
 * @param line - Rule entry line
 * @param transactionSide - Transaction side ('debit' or 'credit')
 * @returns Whether the line should be debit and/or credit
 */
export function determineLineType(
  line: { lineType: string },
  transactionSide: 'debit' | 'credit'
): { isDebit: boolean; isCredit: boolean } {
  if (line.lineType === 'debit') {
    return { isDebit: true, isCredit: false };
  }
  if (line.lineType === 'credit') {
    return { isDebit: false, isCredit: true };
  }
  if (line.lineType === 'auto') {
    // Auto: debit if transaction is debit, credit if transaction is credit
    if (transactionSide === 'debit') {
      return { isDebit: true, isCredit: false };
    } else {
      return { isDebit: false, isCredit: true };
    }
  }
  return { isDebit: false, isCredit: false };
}

/** A VAT rate the French way: 20 -> "20 %", 5.5 -> "5,5 %" (regular space before %). */
export function formatVatRate(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return '';
  return `${String(Math.round(rate * 100) / 100).replace('.', ',')} %`;
}

/**
 * French label of a generated VAT line, e.g. "TVA déductible 20 %",
 * "TVA collectée 5,5 %". Self-assessed VAT (intra-EU acquisitions, imports)
 * has two lines: the deductible one and the one due (`part`).
 */
export function vatLineDescription(
  vatType: string,
  rate: number | null | undefined,
  part: 'deductible' | 'due' = 'deductible'
): string {
  const label = (() => {
    switch (vatType) {
      case 'deductible':
        return 'TVA déductible';
      case 'collectible':
        return 'TVA collectée';
      case 'intracom':
        return part === 'due' ? 'TVA intracommunautaire due' : 'TVA intracommunautaire déductible';
      case 'import':
        return part === 'due' ? "TVA à l'import due" : "TVA à l'import déductible";
      case 'reverse_charge':
        return 'TVA autoliquidée';
      default:
        return 'TVA';
    }
  })();
  const formatted = formatVatRate(rate);
  return formatted ? `${label} ${formatted}` : label;
}

/**
 * Calculates VAT line debit/credit based on VAT type
 * 
 * @param vatType - Type of VAT
 * @param vatAmount - VAT amount
 * @param vatOnDebit - Whether VAT is on debit (for collectible VAT)
 * @param vatRecoveryRatio - VAT recovery ratio (0-1) for exempt companies. If null, full recovery (default: null)
 * @returns Debit and credit amounts for VAT line
 */
export function calculateVATLineAmounts(
  vatType: string,
  vatAmount: number,
  vatOnDebit?: boolean | null,
  vatRecoveryRatio?: number | null
): { vatDebit: number; vatCredit: number } {
  let vatDebit = 0;
  let vatCredit = 0;

  // If company is VAT exempt, apply recovery ratio to deductible VAT
  if (vatRecoveryRatio !== null && vatRecoveryRatio !== undefined && vatType === 'deductible') {
    // Apply ratio: only recover a portion of deductible VAT
    const recoverableVat = vatAmount * vatRecoveryRatio;
    vatDebit = recoverableVat;
    return { vatDebit, vatCredit };
  }

  switch (vatType) {
    case 'collectible':
      // Collectible VAT: credit account 44571
      if (vatOnDebit) {
        // VAT on debit (client credit note)
        vatDebit = vatAmount;
      } else {
        // VAT on credit (normal sale)
        vatCredit = vatAmount;
      }
      break;
    case 'deductible':
      // Deductible VAT: debit account 44566
      vatDebit = vatAmount;
      break;
    case 'intracom':
      // Intra-community VAT: account 4457
      vatDebit = vatAmount;
      break;
    case 'import':
      // Import VAT: account 4452
      vatDebit = vatAmount;
      break;
    case 'reverse_charge':
    case 'exempt':
      // No VAT line, just marking
      break;
  }

  return { vatDebit, vatCredit };
}

/**
 * Balances entry lines by adding a bank account line if needed
 * 
 * @param entryLines - Current entry lines
 * @param bankAccountId - Bank account ID to use for balancing
 * @param transactionLabel - Transaction label for the balancing line
 * @returns Balanced entry lines
 */
export function balanceEntryLines(
  entryLines: EntryLine[],
  bankAccountId: string,
  transactionLabel: string
): EntryLine[] {
  const totalDebit = entryLines.reduce((sum, line) => sum + line.debit, 0);
  const totalCredit = entryLines.reduce((sum, line) => sum + line.credit, 0);
  const balance = totalDebit - totalCredit;

  // Any imbalance of one cent or more gets a bank line (a 0,01 transaction too)
  if ((toCents(balance) ?? 0) !== 0) {
    // Balance with bank account
    if (balance > 0) {
      // More debit, add credit bank
      entryLines.push({
        accountId: bankAccountId,
        debit: 0,
        credit: balance,
        description: transactionLabel,
      });
    } else {
      // More credit, add debit bank
      entryLines.push({
        accountId: bankAccountId,
        debit: Math.abs(balance),
        credit: 0,
        description: transactionLabel,
      });
    }
  }

  return entryLines;
}

/**
 * Validates that entry lines are balanced
 * 
 * @param entryLines - Entry lines to validate
 * @returns Whether the entry is balanced
 */
export function validateEntryBalance(entryLines: EntryLine[]): boolean {
  const totalDebit = entryLines.reduce((sum, line) => sum + line.debit, 0);
  const totalCredit = entryLines.reduce((sum, line) => sum + line.credit, 0);
  return Math.abs(totalDebit - totalCredit) < 0.01;
}
