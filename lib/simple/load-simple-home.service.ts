/**
 * Data of the simple home (app/(company)/[companyId]/simple, docs/mode-simple.md):
 * four figures in plain words, the "À faire" list and the accountant.
 *
 * No financial rule is written here: every figure comes from a service the
 * expert screens already use, so the simple home and the reports agree to
 * the cent.
 * - Argent sur vos comptes: the balances the banks report (the dashboard's
 *   bank accounts source), plus the bank lines of the current month.
 * - Vos clients vous doivent: the customers of the aged balance
 *   (getAgedBalance), overdue part included.
 * - TVA à payer: the next VAT deadline of lib/deadlines and the amount of
 *   its return, computed like the VAT return worksheet
 *   (lib/vat-returns/vat-return-for-deadline.service.ts) when its checks
 *   pass; otherwise the balance of the comptes 445 (summarizeLedger), shown
 *   as an estimate.
 * - Bénéfice: the result of the fiscal year from its validated entries, as
 *   the income statement computes it (loadStatementAccounts, computeSig),
 *   before the impôt sur les bénéfices (comptes 69 except 691).
 *
 * Each part is loaded only when the user's roles may read it (the same
 * permissions as the dashboard sources and their routes); otherwise it is
 * null and the page leaves it out. Every query is scoped by the company.
 */

import type { FiscalYear } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { transactionOfCompany } from "@/lib/api/resources";
import {
  getUserRolesForCompany,
  isGlobalAdmin,
  type Permission,
} from "@/lib/rbac/authorize";
import { grantedPermissions, grants } from "@/lib/rbac/granted-permissions";
import { resolveCompanyRef } from "@/lib/companies/slug";
import { displayCompanyName } from "@/lib/companies/legal-forms";
import type { CurrentUser } from "@/lib/session";
import { loadWidgetSource } from "@/lib/dashboard/load-widget-data.service";
import { SOURCE_PERMISSIONS } from "@/lib/dashboard/widgets";
import { summarizeLedger } from "@/lib/dashboard/ledger-summary";
import { loadStatementAccounts } from "@/lib/reports/statements/load";
import { computeSig } from "@/lib/reports/financial-indicators/sig";
import { getAgedBalance } from "@/lib/reports/third-parties/get-third-party-reports.service";
import { daysBetween } from "@/lib/reports/third-parties/payment-terms";
import { overdueCents } from "@/lib/reports/third-parties/third-party-balances";
import { loadDeadlinesWidget } from "@/lib/deadlines/load-deadlines.service";
import { DEADLINES_PERMISSION } from "@/lib/deadlines/permissions";
import { vatReturnForDeadline } from "@/lib/vat-returns/vat-return-for-deadline.service";
import {
  listMissingReceipts,
  MissingReceiptsQuerySchema,
} from "@/lib/banking/missing-receipts.service";
import { listMembers } from "@/lib/rbac/manage-members.service";
import { simpleValidationSummary } from "./simple-validation.service";
import { calendarDayOf, todayUtc, utcDate } from "@/lib/utils/date";
import { parseCents } from "@/lib/utils/money";
import { countExpensesToCheck } from "./count-expenses-to-check.service";

/** Customers to chase listed at most on the home. */
export const MAX_CUSTOMERS_TO_CHASE = 3;

export interface SimpleHomeFiscalYear {
  id: string;
  startDate: string;
  endDate: string;
}

export interface SimpleHome {
  /** Today, yyyy-mm-dd (UTC calendar day). */
  today: string;
  fiscalYear: SimpleHomeFiscalYear | null;
  /** Null without banking:read. */
  bank: {
    /** Euro accounts only, as reported by the banks. */
    balanceCents: number;
    accounts: number;
    /** Credits minus debits of the euro accounts since the first day of the month. */
    monthChangeCents: number;
  } | null;
  /** Null without reports:read or without a fiscal year. */
  receivables: { totalCents: number; overdueCents: number } | null;
  /** Null without reports:read. */
  vat: {
    /**
     * Positive to pay, negative a credit; null when the books hold no VAT.
     * The return of the next deadline's period when its checks pass
     * (source 'return', lib/vat-returns), else the balance of the comptes
     * 445, credit minus debit (source 'estimate').
     */
    estimateCents: number | null;
    source: "return" | "estimate";
    /** The period of that return ("septembre 2026"), null for an estimate. */
    periodLabel: string | null;
    /** The next VAT deadline (today included), from lib/deadlines. */
    deadline: { date: string; label: string; estimated: boolean } | null;
  } | null;
  /** Null without reports:read or without a fiscal year. */
  profit: {
    /** Result of the fiscal year before the impôt sur les bénéfices. */
    beforeTaxCents: number;
    /** The result of the income statement (after that tax), for reference. */
    resultCents: number;
  } | null;
  todo: {
    /** Null without banking:read. */
    expensesToCheck: number | null;
    /** Bank lines of the fiscal year without a supporting document; null without banking:read or fiscal year. */
    missingReceipts: number | null;
    /** The customers most overdue; null without reports:read or fiscal year. */
    customersToChase: Array<{
      label: string;
      overdueCents: number;
      oldestDueDate: string | null;
      daysLate: number | null;
    }> | null;
  };
  /** The members with the Comptable role; null without settings:read. */
  accountants: Array<{ name: string | null; email: string }> | null;
  /** Simple mode entries of the month so far and how many the accountant validated; null without entries:read. */
  validation: {
    classified: number;
    validated: number;
    toValidate: number;
    accountantReview: boolean;
  } | null;
}

interface LoadContext {
  can: (permission: Permission) => boolean;
  /** Injected by tests; the clock otherwise. */
  now?: Date;
}

const day = (value: Date) => calendarDayOf(value) as string;

/** The fiscal year containing today, else the latest one (as the dashboard picks it). */
async function currentFiscalYear(
  companyId: string,
  today: Date,
): Promise<FiscalYear | null> {
  return (
    (await prisma.fiscalYear.findFirst({
      where: { companyId, startDate: { lte: today }, endDate: { gte: today } },
      orderBy: { startDate: "desc" },
    })) ??
    (await prisma.fiscalYear.findFirst({
      where: { companyId },
      orderBy: { startDate: "desc" },
    }))
  );
}

/** Today within the fiscal year: its first day before it starts, its last day once over. */
function dayWithin(
  fy: Pick<FiscalYear, "startDate" | "endDate">,
  today: Date,
): string {
  if (today < fy.startDate) return day(fy.startDate);
  if (today > fy.endDate) return day(fy.endDate);
  return day(today);
}

async function loadBank(
  companyId: string,
  today: Date,
  ctx: LoadContext,
): Promise<SimpleHome["bank"]> {
  const monthStart = utcDate(
    today.getUTCFullYear(),
    today.getUTCMonth() + 1,
    1,
  );
  const [{ accounts }, flows] = await Promise.all([
    loadWidgetSource(companyId, { source: "bank-accounts" }, ctx),
    prisma.bankTransaction.groupBy({
      by: ["side"],
      where: {
        bankAccount: {
          ...transactionOfCompany(companyId).bankAccount,
          supersededById: null,
          currency: "EUR",
        },
        date: { gte: monthStart, lte: today },
      },
      _sum: { amount: true },
    }),
  ]);
  const euros = accounts.filter((a) => a.currency === "EUR");
  const sideCents = (side: string) =>
    parseCents(flows.find((f) => f.side === side)?._sum.amount ?? 0) ?? 0;
  return {
    balanceCents: euros.reduce((sum, a) => sum + a.balanceCents, 0),
    accounts: euros.length,
    monthChangeCents: sideCents("credit") - sideCents("debit"),
  };
}

async function loadAged(
  companyId: string,
  fy: FiscalYear,
  today: Date,
  ctx: LoadContext,
) {
  const report = await getAgedBalance(
    companyId,
    { fiscalYearId: fy.id, asOf: dayWithin(fy, today) },
    ctx.now,
  );
  const customers = report.customers;
  const toChase = customers.tiers
    .map((t) => ({
      label: t.label,
      overdueCents: overdueCents(t.buckets),
      oldestDueDate: t.oldestDueDate,
    }))
    .filter((t) => t.overdueCents > 0)
    .sort(
      (a, b) =>
        b.overdueCents - a.overdueCents || a.label.localeCompare(b.label, "fr"),
    )
    .slice(0, MAX_CUSTOMERS_TO_CHASE)
    .map((t) => ({
      ...t,
      daysLate: t.oldestDueDate
        ? Math.max(daysBetween(t.oldestDueDate, report.asOf), 0)
        : null,
    }));
  return {
    receivables: {
      totalCents: customers.totals.totalCents,
      overdueCents: overdueCents(customers.totals),
    },
    toChase,
  };
}

async function loadResult(companyId: string, fy: FiscalYear) {
  const accounts = await loadStatementAccounts(companyId, fy);
  const sig = computeSig(accounts);
  return {
    vatCents: summarizeLedger(accounts).tvaCents,
    // Résultat de l'exercice (2053 HN) + impôts sur les bénéfices (69 except 691, 2053 HK): the result before that tax
    profit: {
      beforeTaxCents: sig.resultatExerciceCents + sig.impotsBeneficesCents,
      resultCents: sig.resultatExerciceCents,
    },
  };
}

interface NextVatDeadline {
  date: string;
  label: string;
  estimated: boolean;
  /** The amount of its return when the books allow it (lib/vat-returns). */
  amount: Awaited<ReturnType<typeof vatReturnForDeadline>>;
}

async function nextVatDeadline(
  companyId: string,
  today: string,
  now?: Date,
): Promise<NextVatDeadline | null> {
  const { deadlines } = await loadDeadlinesWidget(companyId, now);
  const next = deadlines.find((d) => d.category === "tva" && d.date >= today);
  if (!next) return null;
  return {
    date: next.date,
    label: next.label,
    estimated: next.estimated,
    amount: await vatReturnForDeadline(companyId, next, now),
  };
}

async function countMissingReceipts(
  companyId: string,
  fy: FiscalYear,
): Promise<number> {
  const { count } = await listMissingReceipts(
    companyId,
    MissingReceiptsQuerySchema.parse({ fiscalYearId: fy.id, limit: 1 }),
  );
  return count;
}

async function loadAccountants(
  companyId: string,
): Promise<NonNullable<SimpleHome["accountants"]>> {
  const members = await listMembers(companyId);
  return members
    .filter((m) => m.roles.includes("accountant"))
    .map((m) => ({ name: m.name, email: m.email }));
}

const skip = <T>(): Promise<T | null> => Promise.resolve(null);

export async function loadSimpleHome(
  companyId: string,
  ctx: LoadContext,
): Promise<SimpleHome> {
  const todayDate = todayUtc(ctx.now);
  const today = day(todayDate);
  const fy = await currentFiscalYear(companyId, todayDate);
  const canBank = ctx.can(SOURCE_PERMISSIONS["bank-accounts"]);
  const canReports = ctx.can(SOURCE_PERMISSIONS["aged-balance"]);

  const monthStart = `${today.slice(0, 7)}-01`;
  const [
    bank,
    aged,
    result,
    deadline,
    expensesToCheck,
    missingReceipts,
    accountants,
    validation,
  ] = await Promise.all([
    canBank ? loadBank(companyId, todayDate, ctx) : skip<SimpleHome["bank"]>(),
    canReports && fy
      ? loadAged(companyId, fy, todayDate, ctx)
      : skip<Awaited<ReturnType<typeof loadAged>>>(),
    canReports && fy
      ? loadResult(companyId, fy)
      : skip<Awaited<ReturnType<typeof loadResult>>>(),
    ctx.can(DEADLINES_PERMISSION)
      ? nextVatDeadline(companyId, today, ctx.now)
      : skip<NextVatDeadline>(),
    canBank ? countExpensesToCheck(companyId) : skip<number>(),
    canBank && fy ? countMissingReceipts(companyId, fy) : skip<number>(),
    ctx.can({ settings: ["read"] })
      ? loadAccountants(companyId)
      : skip<NonNullable<SimpleHome["accountants"]>>(),
    ctx.can({ entries: ["read"] })
      ? simpleValidationSummary(companyId, {
          from: monthStart,
          to: today,
        }).then((v) => ({
          classified: v.classifiedCount,
          validated: v.validatedCount,
          toValidate: v.toValidateCount,
          accountantReview: v.accountantReview,
        }))
      : skip<NonNullable<SimpleHome["validation"]>>(),
  ]);

  return {
    today,
    fiscalYear: fy
      ? { id: fy.id, startDate: day(fy.startDate), endDate: day(fy.endDate) }
      : null,
    bank,
    receivables: aged?.receivables ?? null,
    vat: canReports
      ? {
          estimateCents: deadline?.amount
            ? deadline.amount.amountCents
            : (result?.vatCents ?? null),
          source: deadline?.amount ? "return" : "estimate",
          periodLabel: deadline?.amount?.periodLabel ?? null,
          deadline: deadline
            ? {
                date: deadline.date,
                label: deadline.label,
                estimated: deadline.estimated,
              }
            : null,
        }
      : null,
    profit: result?.profit ?? null,
    todo: {
      expensesToCheck,
      missingReceipts,
      customersToChase: aged?.toChase ?? null,
    },
    accountants,
    validation,
  };
}

export interface SimpleHomePage {
  companyName: string;
  slug: string;
  home: SimpleHome;
}

/**
 * The simple home of a company for the signed-in user (the page). Null when
 * the company does not exist or the user is not a member (the company
 * layout has already sent them away). Each part follows the user's roles.
 */
export async function loadSimpleHomeForUser(
  user: CurrentUser,
  companyRef: string,
  now?: Date,
): Promise<SimpleHomePage | null> {
  const companyId = await resolveCompanyRef(companyRef);
  if (!companyId) return null;
  const admin = isGlobalAdmin(user);
  const roles = admin ? [] : await getUserRolesForCompany(user.id, companyId);
  if (!admin && roles.length === 0) return null;
  const granted = grantedPermissions(roles, admin);
  const [company, home] = await Promise.all([
    prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, slug: true, legalType: true },
    }),
    loadSimpleHome(companyId, {
      can: (permission) => grants(granted, permission),
      now,
    }),
  ]);
  if (!company) return null;
  return {
    companyName: displayCompanyName(company.name, company.legalType),
    slug: company.slug,
    home,
  };
}
