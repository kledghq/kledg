import Link from "next/link";
import { CircleAlert, FileText, HandCoins, UserPlus } from "lucide-react";

import type { SimpleHome as SimpleHomeData } from "@/lib/simple/load-simple-home.service";
import {
  ACCOUNTANT_PENDING,
  validationProgress,
  EXPENSES_TO_CHECK_HINT,
  MISSING_RECEIPTS_HINT,
  NO_ACCOUNTANT,
  NO_BANK_ACCOUNT_HINT,
  NO_VAT_HINT,
  NOTHING_TO_DO,
  PROFIT_HINT,
  SIMPLE_LABELS,
  VAT_ESTIMATE_HINT,
  chaseLabel,
  expensesToCheckLabel,
  greeting,
  lateLabel,
  missingReceiptsLabel,
  monthChangeLabel,
  overdueLabel,
  profitTitle,
  CORPORATE_TAX_TITLE,
  corporateTaxHint,
  situationSentence,
  vatTitle,
  vatReturnHint,
} from "@/lib/simple/vocabulary";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Amount,
  PageHeader,
  StatCard,
  formatAmount,
} from "@/components/shared";
import { initials } from "@/components/layout/initials";
import { cn } from "@/lib/utils";

const euros = (cents: number) => cents / 100;

interface TodoItem {
  key: string;
  icon: typeof FileText;
  title: string;
  hint: string;
  href: string;
  action: string;
  primary?: boolean;
}

function todoItems(home: SimpleHomeData, base: string): TodoItem[] {
  const items: TodoItem[] = [];
  const { expensesToCheck, missingReceipts, customersToChase } = home.todo;
  if (expensesToCheck) {
    items.push({
      key: "expenses",
      icon: CircleAlert,
      title: expensesToCheckLabel(expensesToCheck),
      hint: EXPENSES_TO_CHECK_HINT,
      href: `${base}/simple/depenses`,
      action: "Vérifier",
      primary: true,
    });
  }
  if (missingReceipts) {
    items.push({
      key: "receipts",
      icon: FileText,
      title: missingReceiptsLabel(missingReceipts),
      hint: MISSING_RECEIPTS_HINT,
      href: `${base}/banking/missing-receipts`,
      action: "Ajouter",
    });
  }
  for (const customer of customersToChase ?? []) {
    items.push({
      key: `chase-${customer.label}`,
      icon: HandCoins,
      title: chaseLabel(
        customer.label,
        formatAmount(euros(customer.overdueCents)),
      ),
      hint: lateLabel(customer.oldestDueDate, customer.daysLate),
      href: `${base}/invoices/sales`,
      action: "Voir les factures",
    });
  }
  return items;
}

/**
 * The simple home (docs/mode-simple.md), as in the approved mockup: a
 * greeting, four figures in plain words, the "À faire" list and the
 * accountant. Renders only the parts the user's roles may read (null data).
 * Every sentence comes from lib/simple/vocabulary.ts.
 */
export function SimpleHome({
  home,
  companyName,
  companySlug,
  userName,
}: {
  home: SimpleHomeData;
  companyName: string;
  companySlug: string;
  userName: string | null;
}) {
  const base = `/${companySlug}`;
  const items = todoItems(home, base);
  const {
    bank,
    receivables,
    vat,
    profit,
    corporateTax,
    fiscalYear,
    accountants,
    validation,
  } = home;

  return (
    <div className="space-y-6">
      <PageHeader
        title={greeting(userName)}
        description={situationSentence(companyName, home.today)}
      />

      <section
        aria-label="Vos chiffres"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        {bank ? (
          <StatCard
            label={SIMPLE_LABELS.bankBalance}
            value={<Amount value={euros(bank.balanceCents)} />}
            hint={
              bank.accounts === 0 ? (
                <Link
                  href={`${base}/banking`}
                  className="text-link underline-offset-4 hover:underline"
                >
                  {NO_BANK_ACCOUNT_HINT}
                </Link>
              ) : (
                <span
                  className={cn(bank.monthChangeCents > 0 && "text-success")}
                >
                  {monthChangeLabel(
                    bank.monthChangeCents,
                    formatAmount(euros(bank.monthChangeCents), {
                      sign: "always",
                    }),
                  )}
                </span>
              )
            }
          />
        ) : null}
        {receivables ? (
          <StatCard
            label={SIMPLE_LABELS.receivables}
            value={<Amount value={euros(receivables.totalCents)} />}
            hint={
              <span
                className={cn(receivables.overdueCents > 0 && "text-warning")}
              >
                {overdueLabel(
                  receivables.overdueCents,
                  formatAmount(euros(receivables.overdueCents)),
                )}
              </span>
            }
          />
        ) : null}
        {vat ? (
          <StatCard
            label={vatTitle(vat.estimateCents, vat.deadline?.date ?? null)}
            value={<Amount value={euros(Math.abs(vat.estimateCents ?? 0))} />}
            hint={
              vat.source === "return" && vat.periodLabel
                ? vatReturnHint(vat.periodLabel)
                : vat.estimateCents === null
                  ? NO_VAT_HINT
                  : VAT_ESTIMATE_HINT
            }
          />
        ) : null}
        {profit && fiscalYear ? (
          <StatCard
            label={profitTitle(profit.beforeTaxCents, fiscalYear.startDate)}
            value={<Amount value={euros(Math.abs(profit.beforeTaxCents))} />}
            valueClassName={cn(profit.beforeTaxCents < 0 && "text-destructive")}
            hint={
              corporateTax ? (
                <span className="flex flex-col gap-0.5">
                  <span>{PROFIT_HINT}</span>
                  <span title={corporateTaxHint(fiscalYear.startDate)}>
                    {CORPORATE_TAX_TITLE}{"\u00a0"}: {formatAmount(euros(corporateTax.estimateCents))}
                  </span>
                </span>
              ) : (
                PROFIT_HINT
              )
            }
          />
        ) : null}
      </section>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>
              <h2>{SIMPLE_LABELS.todo}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {items.length === 0 ? (
              <p className="text-muted-foreground text-sm">{NOTHING_TO_DO}</p>
            ) : (
              <ul className="divide-y">
                {items.map((item) => (
                  <li
                    key={item.key}
                    className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <span
                      aria-hidden
                      className="bg-background text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md border"
                    >
                      <item.icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{item.title}</p>
                      <p className="text-muted-foreground text-sm">
                        {item.hint}
                      </p>
                    </div>
                    <Button
                      asChild
                      size="sm"
                      variant={item.primary ? "default" : "outline"}
                    >
                      <Link href={item.href}>{item.action}</Link>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {accountants ? (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>
                <h2>{SIMPLE_LABELS.accountantCard}</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {accountants.length === 0 ? (
                <>
                  <p className="text-muted-foreground text-sm">
                    {NO_ACCOUNTANT}
                  </p>
                  <Button asChild size="sm" variant="outline">
                    <Link href={`${base}/members`}>
                      <UserPlus aria-hidden />
                      Inviter votre comptable
                    </Link>
                  </Button>
                </>
              ) : (
                <>
                  <ul className="space-y-3">
                    {accountants.map((accountant) => {
                      const name = accountant.name?.trim() || accountant.email;
                      return (
                        <li
                          key={accountant.email}
                          className="flex items-center gap-3"
                        >
                          <Avatar className="size-9">
                            <AvatarFallback className="text-xs font-medium">
                              {initials(name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {name}
                            </p>
                            <p className="text-muted-foreground truncate text-sm">
                              {accountant.email}
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  {validation && validation.accountantReview ? (
                    <div className="space-y-2">
                      <p className="text-sm">
                        {validationProgress(
                          validation.classified,
                          validation.validated,
                          validation.toValidate,
                        )}
                      </p>
                      {validation.classified > 0 ? (
                        <div
                          className="bg-muted h-2 overflow-hidden rounded-full"
                          role="progressbar"
                          aria-label="Dépenses validées par votre comptable"
                          aria-valuemin={0}
                          aria-valuemax={validation.classified}
                          aria-valuenow={validation.validated}
                        >
                          <div
                            className="bg-primary h-2"
                            style={{
                              width: `${Math.round((validation.validated / validation.classified) * 100)}%`,
                            }}
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <p className="text-muted-foreground text-sm">
                    {ACCOUNTANT_PENDING}
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
