/**
 * Read tool of detected subscriptions: list_detected_subscriptions, the
 * recurring debits found in the company's bank lines (docs/abonnements.md).
 * Same rule as the web UI: the company guard with banking:read (so the
 * connection's company grant applies), then the service scopes everything
 * by company. Amounts in euros. Read only: decisions and additions to
 * the budget are draft-level tools (lib/mcp/drafts/budgets.ts).
 */

import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { CompanyGuard } from '@/lib/mcp/company-access'
import { json, run } from '@/lib/mcp/tool-result'
import { READ_ONLY, describeTool } from '@/lib/mcp/tool-meta'
import { listDetectedSubscriptions } from '@/lib/subscriptions/detect-subscriptions.service'
import { fromCents } from '@/lib/utils/money'

export function registerSubscriptionReadTools(server: McpServer, guard: CompanyGuard) {
  server.registerTool(
    'list_detected_subscriptions',
    {
      title: 'Abonnements détectés',
      description: describeTool({
        summary:
          "Lists the recurring debits (subscriptions) detected in the company's bank transactions over the last three years: debits to the same counterparty at a regular cadence (weekly, monthly, quarterly, yearly), with day jitter and small price changes tolerated. For each: counterparty, cadence, current amount, annualized cost, first, last and next expected payment day, number of payments and missed ones, status (active; price_changed when the amount changed recently; possibly_stopped when the next payment is overdue at the last day the bank lines cover), the user's decision (confirmed or ignored, and the budget line it was added to) and the class 6 account of the latest reconciled payment. Recurring debits that are not subscriptions (kind recurring_charge: the reconciled payment was booked to 42 personnel, 43 social bodies, 44 State, 455 associates or 16 loans, or the label names a payroll, social or tax payee such as URSSAF or DGFIP) are left out unless includeRecurringCharges is true or a user counted one as a subscription; they are never in activeAnnualizedCost. Ignored subscriptions are left out unless includeIgnored is true. Detection is recomputed at each call.",
        access: 'read',
        permission: { banking: ['read'] },
        amounts: 'euros',
        units: 'Dates as yyyy-mm-dd.',
        never: 'records a decision or changes the budget (classify_subscription and add_subscription_to_budget do, with kledg:write); changes nothing (read only).',
      }),
      inputSchema: z.object({
        companyId: z.string().describe('Company id, from list_companies.'),
        includeIgnored: z.boolean().default(false).describe('true: also return the subscriptions a user marked as ignored.'),
        includeRecurringCharges: z
          .boolean()
          .default(false)
          .describe('true: also return recurring debits that are not subscriptions (salaries, social charges, taxes, associates, loans), unless a user counted one as a subscription.'),
      }),
      annotations: READ_ONLY,
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { banking: ['read'] })
        const list = await listDetectedSubscriptions(args.companyId)
        const items = list.items
          .filter((s) => args.includeIgnored || s.decision?.status !== 'ignored')
          .filter((s) => args.includeRecurringCharges || s.countsAsSubscription || s.decision?.status === 'ignored')
        return json({
          today: list.today,
          observedUntil: list.observedUntil,
          activeCount: list.totals.activeCount,
          activeAnnualizedCost: fromCents(list.totals.activeAnnualizedCents),
          subscriptions: items.map((s) => ({
            id: s.id,
            counterparty: s.name,
            cadence: s.cadence,
            amount: fromCents(s.typicalAmountCents),
            annualizedCost: fromCents(s.annualizedCents),
            firstPayment: s.firstDay,
            lastPayment: s.lastDay,
            nextExpectedPayment: s.nextExpectedDay,
            payments: s.occurrences,
            missedPayments: s.missedPayments,
            status: s.status,
            priceChange: s.priceChange
              ? { previousAmount: fromCents(s.priceChange.previousAmountCents), newAmount: fromCents(s.priceChange.newAmountCents), since: s.priceChange.sinceDay }
              : null,
            variableAmount: s.variableAmount,
            kind: s.kind,
            chargeReason: s.chargeReason,
            countsAsSubscription: s.countsAsSubscription,
            decision: s.decision?.status ?? null,
            budgetLine: s.decision?.budgetLine ? { accountPrefix: s.decision.budgetLine.accountPrefix, label: s.decision.budgetLine.label, fiscalYear: s.decision.budgetLine.fiscalYear } : null,
            suggestedAccount: s.suggestedAccountCode,
          })),
        })
      }),
  )
}
