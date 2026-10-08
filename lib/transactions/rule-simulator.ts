/**
 * Rule simulation logic for transaction rules engine
 *
 * Rules store PCG account codes. For display purposes the simulator resolves
 * each code against the company's active fiscal year to fetch the label.
 */

import { prisma } from '@/lib/prisma';
import type { TransactionRule } from '@prisma/client';
import type { TransactionExample, SimulationResult, SimulatedEntryLine } from './types';
import {
  calculateLineAmount,
  calculateAmountsWithVAT,
  determineLineType,
  calculateVATLineAmounts,
  vatLineDescription,
} from './entry-line-calculator';
import { todayUtc } from '@/lib/utils/date';
import { fromCents, sumCents, toCents } from '@/lib/utils/money';
import { NotFoundError, ValidationError } from '@/lib/accounting/errors';
import { z } from 'zod';
import { RuleEntryLineSchema } from './manage-rules.service';

/**
 * Share of deductible VAT the company recovers today (its provisional
 * coefficient de déduction, lib/vat-deduction/coefficient.ts), null when it
 * deducts all of it. A preview never fails on it: an error shows no recovery.
 */
async function deductionShareToday(companyId: string): Promise<number | null> {
  try {
    const { vatDeductionShareOn } = await import('@/lib/vat-deduction/coefficient');
    return await vatDeductionShareOn(companyId, todayUtc());
  } catch {
    return 0;
  }
}

const RULE_NOT_FOUND_MESSAGE = 'Règle introuvable';
const NO_LINES_MESSAGE = "La règle n'a aucune ligne d'écriture à simuler : ajoutez-en une.";

type AccountDisplay = { code: string; label: string };

type ResolvedLine = {
  id: string;
  account: AccountDisplay;
  lineType: string;
  amountType: string;
  amountValue?: number | null;
  description?: string | null;
  order: number;
  vatType?: string | null;
  vatRateSource?: string | null;
  vatRate?: number | null;
  vatAccount?: AccountDisplay | null;
  vatAccount2?: AccountDisplay | null;
  vatOnDebit?: boolean | null;
};

type ResolvedRule = {
  entryLines: ResolvedLine[];
  defaultVatAccount?: AccountDisplay | null;
};

/**
 * Build an account code → display lookup by resolving rule codes against the
 * active fiscal year. Falls back to a bare `{ code, label: code }` when a
 * code doesn't match any account in the current fiscal year (rare, but
 * possible after a plan change). We return the fallback so the simulation
 * can still render; the executor enforces strict matching separately.
 */
async function buildCodeLookup(
  companyId: string,
  codes: string[]
): Promise<Map<string, AccountDisplay>> {
  const unique = Array.from(new Set(codes.filter((c): c is string => !!c)));
  if (unique.length === 0) return new Map();

  const { getActiveFiscalYear } = await import('@/lib/accounting/fiscal-year-utils');
  const activeFiscalYear = await getActiveFiscalYear(companyId);

  const accounts = await prisma.account.findMany({
    where: {
      companyId,
      ...(activeFiscalYear ? { fiscalYearId: activeFiscalYear.id } : {}),
      code: { in: unique },
    },
    select: { code: true, label: true },
  });

  const byCode = new Map<string, AccountDisplay>();
  for (const a of accounts) {
    byCode.set(a.code, { code: a.code, label: a.label });
  }
  for (const c of unique) {
    if (!byCode.has(c)) {
      byCode.set(c, { code: c, label: c });
    }
  }
  return byCode;
}

/**
 * Simulates applying a rule without creating the entry in the database
 */
export async function simulateRule(
  ruleId: string,
  transactionExample: TransactionExample,
  companyId: string
): Promise<SimulationResult> {
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
    throw new NotFoundError(RULE_NOT_FOUND_MESSAGE);
  }

  if (rule.entryLines.length === 0) {
    throw new ValidationError(NO_LINES_MESSAGE);
  }

  const codes: string[] = [];
  for (const line of rule.entryLines) {
    if (line.accountCode) codes.push(line.accountCode);
    if (line.vatAccountCode) codes.push(line.vatAccountCode);
    if (line.vatAccount2Code) codes.push(line.vatAccount2Code);
  }
  if (rule.defaultVatAccountCode) codes.push(rule.defaultVatAccountCode);

  const byCode = await buildCodeLookup(rule.companyId, codes);

  const resolved: ResolvedRule = {
    entryLines: rule.entryLines.map((line) => ({
      id: line.id,
      account: byCode.get(line.accountCode) ?? { code: line.accountCode, label: line.accountCode },
      lineType: line.lineType,
      amountType: line.amountType,
      amountValue: line.amountValue != null ? Number(line.amountValue) : null,
      description: line.description,
      order: line.order,
      vatType: line.vatType,
      vatRateSource: line.vatRateSource,
      vatRate: line.vatRate != null ? Number(line.vatRate) : null,
      vatAccount: line.vatAccountCode ? byCode.get(line.vatAccountCode) ?? null : null,
      vatAccount2: line.vatAccount2Code ? byCode.get(line.vatAccount2Code) ?? null : null,
      vatOnDebit: line.vatOnDebit,
    })),
    defaultVatAccount: rule.defaultVatAccountCode
      ? byCode.get(rule.defaultVatAccountCode) ?? null
      : null,
  };

  const vatRecoveryRatio = await deductionShareToday(rule.companyId);

  return calculateSimulationResult(resolved, transactionExample, vatRecoveryRatio);
}

const EXAMPLE_MESSAGE = 'transactionExample avec amount et side requis';

/** Example transaction of a simulation: a non-zero amount in euros and its side. */
export const TransactionExampleSchema = z.object(
  {
    amount: z.number({ error: EXAMPLE_MESSAGE }).refine((amount) => amount !== 0, EXAMPLE_MESSAGE),
    side: z.enum(['debit', 'credit'], { error: EXAMPLE_MESSAGE }),
    label: z.string().max(500).optional(),
    vatRate: z.number().nullable().optional(),
    vatAmount: z.number().nullable().optional(),
  },
  { error: EXAMPLE_MESSAGE },
);

/** Body of POST /api/transaction-rules/[id]/simulate. */
export const SimulateRuleSchema = z.object({ transactionExample: TransactionExampleSchema });

const RULE_DATA_MESSAGE = 'ruleData avec entryLines requis';

/** Body of POST /api/transaction-rules/simulate: a rule being edited (lines ordered by `order`, else as sent). */
export const SimulateRuleDataSchema = z.object({
  companyId: z.string().optional(),
  ruleData: z.object(
    {
      entryLines: z
        .array(RuleEntryLineSchema, { error: RULE_DATA_MESSAGE })
        .min(1, RULE_DATA_MESSAGE)
        .max(50)
        .transform((lines) => lines.map((line, index) => ({ ...line, order: line.order ?? index }))),
      defaultVatAccountCode: z.string().max(20).nullable().optional(),
    },
    { error: RULE_DATA_MESSAGE },
  ),
  transactionExample: TransactionExampleSchema,
});

/**
 * Rule data for simulation (without database IDs)
 */
export interface RuleData {
  entryLines: Array<{
    accountCode: string;
    lineType: string;
    amountType: string;
    amountValue?: number | null;
    description?: string | null;
    order: number;
    vatType?: string | null;
    vatRateSource?: string | null;
    vatRate?: number | null;
    vatAccountCode?: string | null;
    vatAccount2Code?: string | null;
    vatOnDebit?: boolean;
  }>;
  defaultVatAccountCode?: string | null;
}

/**
 * Simulates applying a rule from data (without ID)
 */
export async function simulateRuleFromData(
  ruleData: RuleData,
  transactionExample: TransactionExample,
  companyId?: string
): Promise<SimulationResult> {
  if (!ruleData.entryLines || ruleData.entryLines.length === 0) {
    throw new ValidationError(NO_LINES_MESSAGE);
  }

  const codes: string[] = [];
  for (const line of ruleData.entryLines) {
    if (line.accountCode) codes.push(line.accountCode);
    if (line.vatAccountCode) codes.push(line.vatAccountCode);
    if (line.vatAccount2Code) codes.push(line.vatAccount2Code);
  }
  if (ruleData.defaultVatAccountCode) codes.push(ruleData.defaultVatAccountCode);

  const byCode = companyId
    ? await buildCodeLookup(companyId, codes)
    : new Map(codes.map((c) => [c, { code: c, label: c }]));

  const resolved: ResolvedRule = {
    entryLines: [...ruleData.entryLines]
      .sort((a, b) => a.order - b.order)
      .map((line, idx) => ({
        id: `sim-${idx}`,
        account: byCode.get(line.accountCode) ?? { code: line.accountCode, label: line.accountCode },
        lineType: line.lineType,
        amountType: line.amountType,
        amountValue: line.amountValue,
        description: line.description,
        order: line.order,
        vatType: line.vatType,
        vatRateSource: line.vatRateSource,
        vatRate: line.vatRate,
        vatAccount: line.vatAccountCode ? byCode.get(line.vatAccountCode) ?? null : null,
        vatAccount2: line.vatAccount2Code ? byCode.get(line.vatAccount2Code) ?? null : null,
        vatOnDebit: line.vatOnDebit ?? false,
      })),
    defaultVatAccount: ruleData.defaultVatAccountCode
      ? byCode.get(ruleData.defaultVatAccountCode) ?? null
      : null,
  };

  const vatRecoveryRatio = companyId ? await deductionShareToday(companyId) : null;

  return calculateSimulationResult(resolved, transactionExample, vatRecoveryRatio);
}

function calculateSimulationResult(
  rule: ResolvedRule,
  transactionExample: TransactionExample,
  vatRecoveryRatio?: number | null
): SimulationResult {
  const transactionAmount = Math.abs(transactionExample.amount);
  const transactionSide = transactionExample.side;
  const transactionVat =
    transactionExample.vatRate != null || transactionExample.vatAmount != null
      ? {
          vatRate: transactionExample.vatRate ?? null,
          vatAmount: transactionExample.vatAmount ?? null,
        }
      : null;

  const entryLines: SimulatedEntryLine[] = [];
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
    const mainLineAmount = line.vatType && line.vatType !== 'none' ? amountHT : lineAmount;
    const effectiveRate =
      line.vatRateSource === 'transaction' && transactionVat?.vatRate != null
        ? transactionVat.vatRate
        : line.vatRate != null
          ? Number(line.vatRate)
          : null;

    const mainLine: SimulatedEntryLine = {
      account: {
        code: line.account.code,
        label: line.account.label,
      },
      debit: isDebit ? mainLineAmount : 0,
      credit: isCredit ? mainLineAmount : 0,
      description: line.description || transactionExample.label || 'Transaction bancaire',
      vatInfo:
        line.vatType && line.vatType !== 'none' && vatAmount > 0
          ? {
              type: line.vatType,
              rate: effectiveRate ?? 0,
              amount: vatAmount,
            }
          : undefined,
    };
    entryLines.push(mainLine);

    if (line.vatType && line.vatType !== 'none' && vatAmount > 0) {
      const vatAccountDebit = line.vatAccount || rule.defaultVatAccount;
      const vatAccount2 = line.vatAccount2 ?? null;

      if (
        (line.vatType === 'intracom' || line.vatType === 'import') &&
        vatAccountDebit &&
        vatAccount2
      ) {
        entryLines.push({
          account: { code: vatAccountDebit.code, label: vatAccountDebit.label },
          debit: vatAmount,
          credit: 0,
          description: vatLineDescription(line.vatType, effectiveRate, 'deductible'),
          vatInfo: { type: line.vatType, rate: effectiveRate ?? 0, amount: vatAmount },
        });
        entryLines.push({
          account: { code: vatAccount2.code, label: vatAccount2.label },
          debit: 0,
          credit: vatAmount,
          description: vatLineDescription(line.vatType, effectiveRate, 'due'),
          vatInfo: { type: line.vatType, rate: effectiveRate ?? 0, amount: vatAmount },
        });
      } else if (vatAccountDebit) {
        const { vatDebit, vatCredit } = calculateVATLineAmounts(
          line.vatType,
          vatAmount,
          line.vatOnDebit,
          vatRecoveryRatio
        );
        // Unrecovered deductible VAT stays in the cost, as rule-executor.ts writes it
        const unrecovered = line.vatType === 'deductible' ? vatAmount - vatDebit : 0;
        if (unrecovered > 0) {
          if (mainLine.debit > 0) mainLine.debit += unrecovered;
          else if (mainLine.credit > 0) mainLine.credit += unrecovered;
        }
        if (vatDebit > 0 || vatCredit > 0) {
          entryLines.push({
            account: { code: vatAccountDebit.code, label: vatAccountDebit.label },
            debit: vatDebit,
            credit: vatCredit,
            description: vatLineDescription(line.vatType, effectiveRate),
            vatInfo: {
              type: line.vatType,
              rate: effectiveRate ?? 0,
              amount: vatAmount,
            },
          });
        }
      }
    }
  }

  // Sums in cents (lib/utils/money.ts): exact totals, balanced to the cent
  const debitCents = Number(sumCents(entryLines.map((line) => toCents(line.debit) ?? 0)));
  const creditCents = Number(sumCents(entryLines.map((line) => toCents(line.credit) ?? 0)));
  const totalDebit = fromCents(debitCents);
  const totalCredit = fromCents(creditCents);
  const balanced = debitCents === creditCents;

  return {
    entryLines,
    totalDebit,
    totalCredit,
    balanced,
  };
}
