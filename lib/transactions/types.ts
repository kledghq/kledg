/**
 * Types and interfaces for transaction rules engine
 */

import type { BankTransaction } from '@prisma/client';

/**
 * Result of matching a transaction against a rule
 */
export interface TransactionMatchResult {
  ruleId: string;
  ruleName: string;
  matched: boolean;
  /** Specificity of the match, 0-1: grows with the number of conditions. Orders suggestions; never a threshold. */
  confidence: number;
  /** Priority of the rule (higher first). */
  priority?: number;
  /** "Créer automatiquement l'écriture": the refresh applies the rule without a click. */
  autoCreate?: boolean;
  suggestedEntry?: {
    journalId: string;
    entryLines: Array<{
      accountId: string;
      debit: number;
      credit: number;
      description: string;
    }>;
  };
}

/**
 * Transaction with enriched data for rule matching
 */
export interface EnrichedTransaction extends BankTransaction {
  bankAccount: { name: string; iban: string | null };
  logoUrl: string | null;
  counterpartyName: string | null;
  category: string | null;
  cashflowCategory: string | null;
  cashflowSubcategory: string | null;
  operationType: string | null;
}

/**
 * Entry line for accounting entry
 */
export interface EntryLine {
  accountId: string;
  debit: number;
  credit: number;
  description: string;
}

/**
 * Entry line with account details for simulation
 */
export interface SimulatedEntryLine {
  account: { code: string; label: string };
  debit: number;
  credit: number;
  description: string;
  vatInfo?: {
    type: string;
    rate: number;
    amount: number;
  };
}

/**
 * Result of simulating a rule
 */
export interface SimulationResult {
  entryLines: SimulatedEntryLine[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
}

/**
 * Transaction example for simulation
 */
export interface TransactionExample {
  amount: number;
  side: 'debit' | 'credit';
  label?: string;
  /** Optional: for simulating "Détecté (transaction)" (e.g. Qonto VAT) */
  vatRate?: number | null;
  vatAmount?: number | null;
}

/**
 * Input type for creating/updating transaction rule conditions
 */
export interface TransactionRuleConditionInput {
  conditionType: string;
  operator: string;
  value?: string | null;
  value2?: string | null;
}

/**
 * Input type for creating/updating transaction rule entry lines.
 * Rules store account codes (PCG) rather than FKs; the code is resolved
 * against the active fiscal year's accounts when the rule is applied.
 */
export interface TransactionRuleEntryLineInput {
  accountCode: string;
  lineType: string;
  amountType: string;
  amountValue?: number | null;
  description?: string | null;
  order?: number;
  vatType?: string | null;
  /** 'fixed' = taux saisi, 'transaction' = taux/montant détecté (ex. Qonto) */
  vatRateSource?: string | null;
  vatRate?: number | null;
  vatAccountCode?: string | null;
  vatAccount2Code?: string | null;
  vatOnDebit?: boolean;
}
