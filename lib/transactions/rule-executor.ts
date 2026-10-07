/**
 * Rule execution logic for transaction rules engine
 *
 * This module handles applying rules to transactions and creating accounting entries.
 * Rules store PCG account codes rather than per-fiscal-year account IDs; codes are
 * resolved against the fiscal year of the transaction date (strict equality match).
 *
 * Applying a rule goes through the same atomic reconciliation as the dialog
 * (lib/reconciliation/service.ts): the transaction is claimed, the entry
 * created and linked in one database transaction, so running the engine twice,
 * even concurrently, never creates two entries for a transaction.
 */

import { prisma } from '@/lib/prisma';
import { journalByCode } from '@/lib/accounting/journal-by-code';
import type { TransactionRule } from '@prisma/client';
import type { EntryLine } from './types';
import {
  calculateLineAmount,
  calculateAmountsWithVAT,
  determineLineType,
  calculateVATLineAmounts,
  balanceEntryLines,
  vatLineDescription,
} from './entry-line-calculator';
import { AccountingError, ConflictError, NotFoundError, ValidationError } from '@/lib/accounting/errors';
import { toCents } from '@/lib/utils/money';
import { isoDateToUtc, toIsoDateUtc } from '@/lib/utils/date';
import { checkEntryDate } from '@/lib/reconciliation/validation';
import {
  MESSAGES as RECONCILIATION_MESSAGES,
  assertWritableLines,
  bankAccountMissingMessage,
  createEntryAndReconcile,
  fiscalYearPeriods,
  normalizeSide,
  resolveBankLedgerAccount,
  type GeneratedLine,
} from '@/lib/reconciliation/service';

/**
 * Rule with entry lines for execution
 */
type RuleWithEntryLines = TransactionRule & {
  entryLines: Array<{
    id: string;
    accountId: string;
    lineType: string;
    amountType: string;
    amountValue?: number | null;
    description?: string | null;
    order: number;
    vatType?: string | null;
    vatRateSource?: string | null;
    vatRate?: number | null;
    vatAccountId?: string | null;
    vatAccount2Id?: string | null;
    vatOnDebit?: boolean | null;
  }>;
  defaultVatAccountId?: string | null;
};

/** The entry a rule produces for a transaction, ready to write (amounts in cents). */
export interface PreparedRuleEntry {
  ok: true;
  ruleName: string;
  journalId: string;
  fiscalYearId: string;
  date: Date;
  description: string;
  reference: string | null;
  bankAccountId: string;
  lines: GeneratedLine[];
}

export type RuleFailure = { ok: false; error: string; status: number };

const fail = (error: string, status = 400): RuleFailure => ({ ok: false, error, status });

/**
 * Converts the calculator's float lines to whole cents: negative amounts move
 * to the other side, a line with both sides is netted, empty lines are dropped,
 * and the rounding residue (at most one cent per line, e.g. 100 / 1,2) goes to
 * the largest counterpart line so the entry balances to the cent.
 */
export function toCentLines(lines: EntryLine[], bankAccountId: string): GeneratedLine[] | null {
  const result: GeneratedLine[] = [];
  for (const line of lines) {
    const debit = toCents(line.debit) ?? 0;
    const credit = toCents(line.credit) ?? 0;
    const net = debit - credit;
    if (net === 0) continue;
    result.push({
      accountId: line.accountId,
      debitCents: Math.max(net, 0),
      creditCents: Math.max(-net, 0),
      description: line.description,
    });
  }

  const residue = result.reduce((sum, l) => sum + l.debitCents - l.creditCents, 0);
  if (residue === 0) return result;
  if (Math.abs(residue) > result.length) return null;

  const counterparts = result.filter((l) => l.accountId !== bankAccountId);
  const largest = counterparts.sort(
    (a, b) => Math.max(b.debitCents, b.creditCents) - Math.max(a.debitCents, a.creditCents),
  )[0];
  if (!largest) return null;
  if (largest.debitCents > 0) largest.debitCents -= residue;
  else largest.creditCents += residue;
  if (largest.debitCents < 0 || largest.creditCents < 0) return null;
  return result;
}

/**
 * Computes the entry a rule creates for a transaction, without writing it.
 * Used by applyRule and by the reconciliation dialog's prefill.
 */
export async function prepareRuleEntry(
  ruleId: string,
  transactionId: string,
  companyId: string
): Promise<PreparedRuleEntry | RuleFailure> {
  // Both the rule and the transaction must belong to the company
  const rule = await prisma.transactionRule.findFirst({
    where: { id: ruleId, companyId },
    include: {
      entryLines: {
        orderBy: {
          order: 'asc',
        },
      },
    },
  });

  if (!rule) {
    return fail('Règle introuvable', 404);
  }

  if (rule.entryLines.length === 0) {
    return fail(`La règle « ${rule.name} » ne contient aucune ligne d'écriture.`);
  }

  const transaction = await prisma.bankTransaction.findFirst({
    where: { id: transactionId, bankAccount: { bankConnection: { companyId } } },
  });

  if (!transaction) {
    return fail(RECONCILIATION_MESSAGES.transactionNotFound, 404);
  }
  if (transaction.reconciled) {
    return fail(RECONCILIATION_MESSAGES.alreadyReconciled, 409);
  }

  // Entries go in the fiscal year of the transaction date, which must be open
  const entryDate = toIsoDateUtc(transaction.date);
  const dateCheck = checkEntryDate(await fiscalYearPeriods(companyId), entryDate);
  if (dateCheck.error !== null) {
    return fail(dateCheck.error);
  }
  const fiscalYear = dateCheck.fiscalYear;

  // Share of deductible VAT recovered on the day of the transaction: null for a
  // company subject to VAT on everything, else its provisional coefficient de
  // déduction (CGI ann. II art. 206, lib/vat-deduction/coefficient.ts)
  const { vatDeductionShareOn } = await import('@/lib/vat-deduction/coefficient');
  const vatRecoveryRatio: number | null = await vatDeductionShareOn(companyId, entryDate);

  const journal = await journalByCode(prisma, companyId, rule.journalCode || 'BQ');

  if (!journal) {
    return fail(`Journal ${rule.journalCode || 'BQ'} introuvable.`);
  }

  // Collect every account code referenced by the rule and resolve them against
  // the fiscal year by strict equality on Account.code.
  const codeSet = new Set<string>();
  for (const line of rule.entryLines) {
    if (line.accountCode) codeSet.add(line.accountCode);
    if (line.vatAccountCode) codeSet.add(line.vatAccountCode);
    if (line.vatAccount2Code) codeSet.add(line.vatAccount2Code);
  }
  if (rule.defaultVatAccountCode) codeSet.add(rule.defaultVatAccountCode);

  const targetAccounts = await prisma.account.findMany({
    where: {
      companyId,
      fiscalYearId: fiscalYear.id,
      code: { in: Array.from(codeSet) },
    },
    select: {
      id: true,
      code: true,
    },
  });

  const codeToId = new Map<string, string>();
  for (const a of targetAccounts) {
    codeToId.set(a.code, a.id);
  }

  const missingCodes = Array.from(codeSet).filter((code) => !codeToId.has(code));
  if (missingCodes.length > 0) {
    return fail(
      `Certains comptes de la règle n'existent pas dans l'exercice ${fiscalYear.year} : ${missingCodes.join(', ')}`
    );
  }

  const resolveCode = (code: string | null | undefined): string | null =>
    code ? codeToId.get(code) ?? null : null;

  const mappedRule: RuleWithEntryLines = {
    ...rule,
    entryLines: rule.entryLines.map((line) => ({
      id: line.id,
      accountId: codeToId.get(line.accountCode)!,
      lineType: line.lineType,
      amountType: line.amountType,
      amountValue: line.amountValue ? Number(line.amountValue) : null,
      description: line.description,
      order: line.order,
      vatType: line.vatType,
      vatRateSource: line.vatRateSource ?? 'fixed',
      vatRate: line.vatRate ? Number(line.vatRate) : null,
      vatAccountId: resolveCode(line.vatAccountCode),
      vatAccount2Id: resolveCode(line.vatAccount2Code),
      vatOnDebit: line.vatOnDebit,
    })),
    defaultVatAccountId: resolveCode(rule.defaultVatAccountCode),
  };

  // Use the bank account from the rule template if present (e.g. 512101), otherwise
  // the company's bank account (default code, else 512). Prefer the rule's bank to
  // avoid balancing on parent account 51.
  const ruleBankAccount = targetAccounts
    .filter((a) => a.code.startsWith('51'))
    .sort((a, b) => b.code.length - a.code.length)[0];
  const bankAccount = ruleBankAccount ?? (await resolveBankLedgerAccount(companyId, fiscalYear.id));

  if (!bankAccount) {
    return fail(bankAccountMissingMessage(fiscalYear.year));
  }

  const providerData = transaction.providerData as
    | { vat_rate?: number; vat_amount?: number; vat_amount_cents?: number }
    | null
    | undefined;
  const rawRate =
    transaction.vatRate != null ? Number(transaction.vatRate) : providerData?.vat_rate ?? null;
  const effectiveVatRate =
    rawRate != null && rawRate >= 0 ? rawRate : null;
  const effectiveVatAmount =
    transaction.vatAmount != null
      ? Number(transaction.vatAmount)
      : providerData?.vat_amount ??
        (providerData?.vat_amount_cents != null
          ? providerData.vat_amount_cents / 100
          : null);

  const transactionVat =
    effectiveVatRate != null || effectiveVatAmount != null
      ? {
          vatRate: effectiveVatRate,
          vatAmount: effectiveVatAmount,
        }
      : null;

  const transactionAmount = Math.abs(Number(transaction.amount));
  const transactionSide = normalizeSide(transaction.side);
  const description = transaction.label || 'Transaction bancaire';

  let lines: GeneratedLine[] | null;
  try {
    const entryLines = calculateEntryLines(
      mappedRule,
      transactionAmount,
      transactionSide,
      description,
      vatRecoveryRatio,
      transactionVat
    );
    lines = toCentLines(balanceEntryLines(entryLines, bankAccount.id, description), bankAccount.id);
  } catch (error) {
    return fail(`La règle « ${rule.name} » ne peut pas être appliquée : ${error instanceof Error ? error.message : 'erreur de calcul'}`);
  }

  if (!lines) {
    return fail(`La règle « ${rule.name} » produit une écriture déséquilibrée.`);
  }
  try {
    assertWritableLines(lines);
  } catch (error) {
    return fail(`La règle « ${rule.name} » produit une écriture invalide : ${(error as Error).message}`);
  }

  return {
    ok: true,
    ruleName: rule.name,
    journalId: journal.id,
    fiscalYearId: fiscalYear.id,
    date: isoDateToUtc(entryDate),
    description,
    reference: transaction.reference,
    bankAccountId: bankAccount.id,
    lines,
  };
}

/**
 * Applies a rule: creates the draft entry and reconciles the transaction, atomically.
 *
 * @param ruleId - ID of the rule to apply
 * @param transactionId - ID of the transaction to apply the rule to
 * @param companyId - ID of the company
 * @returns The entry id, or an error with its HTTP status (409 when the transaction is already reconciled)
 */
export async function applyRule(
  ruleId: string,
  transactionId: string,
  companyId: string
): Promise<{ success: boolean; entryId?: string; error?: string; status?: number }> {
  const prepared = await prepareRuleEntry(ruleId, transactionId, companyId);
  if (!prepared.ok) {
    return { success: false, error: prepared.error, status: prepared.status };
  }

  try {
    const entry = await createEntryAndReconcile({
      companyId,
      transactionId,
      journalId: prepared.journalId,
      fiscalYearId: prepared.fiscalYearId,
      date: prepared.date,
      description: prepared.description,
      reference: prepared.reference,
      lines: prepared.lines,
    });

    await prisma.transactionRule.update({
      where: { id: ruleId },
      data: {
        usageCount: { increment: 1 },
        lastUsedAt: new Date(),
      },
    });

    return { success: true, entryId: entry.id };
  } catch (error) {
    if (error instanceof ConflictError || error instanceof ValidationError) {
      return { success: false, error: error.message, status: error.statusCode };
    }
    throw error;
  }
}

/** The typed error of a refused rule application, with its status (409 when already reconciled). */
function refusal(message: string, status: number | undefined): AccountingError {
  if (status === 409) return new ConflictError(message);
  if (status === 404) return new NotFoundError(message);
  return new ValidationError(message);
}

/**
 * applyRule for one request (POST /api/transactions/[id]/apply-rule): the rule
 * must belong to the company (404), and a refusal is thrown as a typed error
 * with its French message instead of being returned.
 */
export async function applyRuleToTransaction(
  companyId: string,
  transactionId: string,
  ruleId: string
): Promise<{ entryId: string }> {
  const rule = await prisma.transactionRule.findFirst({ where: { id: ruleId, companyId }, select: { id: true } });
  if (!rule) throw new NotFoundError('Règle introuvable');
  const result = await applyRule(rule.id, transactionId, companyId);
  if (!result.success || !result.entryId) {
    throw refusal(result.error || "Impossible d'appliquer la règle", result.status);
  }
  return { entryId: result.entryId };
}

/**
 * Calculates entry lines from a rule template
 */
function calculateEntryLines(
  rule: RuleWithEntryLines,
  transactionAmount: number,
  transactionSide: 'debit' | 'credit',
  transactionLabel: string,
  vatRecoveryRatio?: number | null,
  transactionVat?: { vatRate: number | null; vatAmount: number | null } | null
): EntryLine[] {
  const entryLines: EntryLine[] = [];

  const lineAmounts: Map<string, number> = new Map();
  let remainingAmount = transactionAmount;

  for (const line of rule.entryLines) {
    const lineAmount = calculateLineAmount(line, transactionAmount, remainingAmount);
    lineAmounts.set(line.id, lineAmount);

    if (
      line.amountType !== 'remaining' &&
      line.amountType !== 'ht' &&
      line.amountType !== 'ttc' &&
      line.amountType !== 'vat'
    ) {
      remainingAmount -= lineAmount;
    }
  }

  let totalVatFromRule = 0;
  for (const line of rule.entryLines) {
    if (line.vatType && line.vatType !== 'none') {
      const lineAmount = lineAmounts.get(line.id) || 0;
      const { vatAmount } = calculateAmountsWithVAT(line, lineAmount, transactionVat);
      totalVatFromRule += vatAmount;
    }
  }
  for (const line of rule.entryLines) {
    if (line.amountType === 'vat') {
      lineAmounts.set(line.id, totalVatFromRule);
    }
  }

  for (const line of rule.entryLines) {
    let lineAmount = lineAmounts.get(line.id) || 0;

    if (line.amountType === 'remaining') {
      lineAmount = remainingAmount;
    }

    const { isDebit, isCredit } = determineLineType(line, transactionSide);

    const { amountHT, amountTTC, vatAmount } = calculateAmountsWithVAT(
      line,
      lineAmount,
      transactionVat
    );

    const effectiveVatRate =
      line.vatRateSource === 'transaction' &&
      transactionVat &&
      transactionVat.vatRate != null
        ? Number(transactionVat.vatRate)
        : line.vatRate != null
          ? Number(line.vatRate)
          : null;

    const mainLineAmount = line.vatType && line.vatType !== 'none' ? amountHT : lineAmount;

    const mainLine: EntryLine = {
      accountId: line.accountId,
      debit: isDebit ? mainLineAmount : 0,
      credit: isCredit ? mainLineAmount : 0,
      description: line.description || transactionLabel,
    };
    entryLines.push(mainLine);

    if (line.vatType && line.vatType !== 'none' && vatAmount > 0) {
      const vatAccountDebitId = line.vatAccountId || rule.defaultVatAccountId;
      const vatAccount2Id = line.vatAccount2Id ?? null;

      if (
        (line.vatType === 'intracom' || line.vatType === 'import') &&
        vatAccountDebitId &&
        vatAccount2Id
      ) {
        entryLines.push({
          accountId: vatAccountDebitId,
          debit: vatAmount,
          credit: 0,
          description: vatLineDescription(line.vatType, effectiveVatRate, 'deductible'),
        });
        entryLines.push({
          accountId: vatAccount2Id,
          debit: 0,
          credit: vatAmount,
          description: vatLineDescription(line.vatType, effectiveVatRate, 'due'),
        });
      } else {
        if (!vatAccountDebitId) {
          throw new Error(`aucun compte de TVA pour la ligne ${rule.entryLines.indexOf(line) + 1} : choisissez-le dans la règle.`);
        }
        const { vatDebit, vatCredit } = calculateVATLineAmounts(
          line.vatType,
          vatAmount,
          line.vatOnDebit,
          vatRecoveryRatio
        );
        // Deductible VAT the company cannot recover (coefficient de déduction,
        // CGI ann. II art. 206) stays in the cost of the line, so the entry
        // still adds up to the bank movement
        const unrecovered = line.vatType === 'deductible' ? vatAmount - vatDebit : 0;
        if (unrecovered > 0) {
          if (mainLine.debit > 0) mainLine.debit += unrecovered;
          else if (mainLine.credit > 0) mainLine.credit += unrecovered;
        }
        if (vatDebit > 0 || vatCredit > 0) {
          entryLines.push({
            accountId: vatAccountDebitId,
            debit: vatDebit,
            credit: vatCredit,
            description: vatLineDescription(line.vatType, effectiveVatRate),
          });
        }
      }
    }
  }

  return entryLines;
}
