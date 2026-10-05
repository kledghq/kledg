'use client'

import { Amount } from '@/components/shared'
import { NON_DEDUCTIBLE_MEALS_ACCOUNT, mealSplitReason, type MealLineTreatment, type MealSplit } from '@/lib/expense-reports/exploitant-meals'

/**
 * The split of a meal alone of the exploitant of a company taxed at the
 * impôt sur le revenu (lib/expense-reports/exploitant-meals.ts): deductible
 * part on the line's account, non-deductible part on 62568, the reason
 * with the year's thresholds and the BOFiP source. Shared by the expense
 * report editor and detail and by simple mode.
 */
export function MealSplitNote({ split, account = '6256' }: { split: MealSplit; account?: string }) {
  const source = split.thresholds.source
  return (
    <div className="space-y-1 text-xs" data-testid="meal-split">
      <p>
        Déductible&nbsp;: <Amount value={split.deductibleCents / 100} /> (compte {account}), non déductible&nbsp;: <Amount value={split.nonDeductibleCents / 100} /> (compte{' '}
        {NON_DEDUCTIBLE_MEALS_ACCOUNT.root}, à réintégrer).
      </p>
      <p className="text-muted-foreground">
        {mealSplitReason(split)}{' '}
        <a href={source.url} target="_blank" rel="noreferrer" className="text-link hover:underline">
          {source.label}
        </a>
      </p>
    </div>
  )
}

/** What the rule does to an expense report line: the split, or why nothing is split, or what to answer. */
export function MealTreatmentNote({ treatment, account }: { treatment: MealLineTreatment; account?: string }) {
  if (treatment.status === 'split' && treatment.split) return <MealSplitNote split={treatment.split} account={account} />
  return (
    <p className={treatment.status === 'not-concerned' ? 'text-muted-foreground text-xs' : 'text-warning text-xs'} role={treatment.status === 'not-concerned' ? undefined : 'status'} data-testid="meal-note">
      {treatment.status === 'unknown-taxation' ? `${treatment.reason} Tant qu’il ne l’est pas, le repas reste entièrement en charge.` : treatment.reason}
    </p>
  )
}
