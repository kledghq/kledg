'use client'

import * as React from 'react'
import Link from 'next/link'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Amount, Field, formatDisplayDate } from '@/components/shared'
import { responseError } from '@/hooks/use-cursor-list'
import { matchPrefix } from '@/lib/budgets/prefixes'
import { CADENCE_LABELS } from '@/lib/subscriptions/detect'
import type { BudgetDetail, BudgetSummary } from '@/lib/budgets/manage-budgets.service'
import type { SubscriptionView } from '@/lib/subscriptions/detect-subscriptions.service'

async function load<T>(url: string, fallback: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(await responseError(response, fallback))
  return response.json() as Promise<T>
}

/** The budget of the fiscal year containing `day`, else the latest open one. */
function defaultBudget(budgets: BudgetSummary[], day: string): BudgetSummary | null {
  const open = budgets.filter((b) => !b.fiscalYear.isClosed)
  return open.find((b) => b.fiscalYear.startDate <= day && day <= b.fiscalYear.endDate) ?? open[0] ?? null
}

/**
 * Adds a detected subscription to a charges line of an open budget as a
 * recurring item (docs/abonnements.md). The line matching the account of
 * the subscription's latest reconciled payment is chosen first.
 */
export function AddToBudgetDialog({
  companyId,
  subscription,
  today,
  onOpenChange,
  onAdded,
}: {
  companyId: string
  subscription: SubscriptionView | null
  today: string
  onOpenChange: (open: boolean) => void
  onAdded: (updated: SubscriptionView) => void
}) {
  return (
    <Dialog open={subscription !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Keyed by subscription: each opening starts from its own defaults */}
        {subscription ? (
          <AddToBudgetForm key={subscription.id} companyId={companyId} subscription={subscription} today={today} onOpenChange={onOpenChange} onAdded={onAdded} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function AddToBudgetForm({
  companyId,
  subscription,
  today,
  onOpenChange,
  onAdded,
}: {
  companyId: string
  subscription: SubscriptionView
  today: string
  onOpenChange: (open: boolean) => void
  onAdded: (updated: SubscriptionView) => void
}) {
  const [budgets, setBudgets] = React.useState<BudgetSummary[] | null>(null)
  const [budgetId, setBudgetId] = React.useState('')
  const [loaded, setLoaded] = React.useState<BudgetDetail | null>(null)
  const [lineId, setLineId] = React.useState('')
  const [label, setLabel] = React.useState(subscription.name.slice(0, 120))
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  // The detail shown is the one of the budget selected: another one loading shows a skeleton
  const budget = loaded?.id === budgetId ? loaded : null

  React.useEffect(() => {
    let cancelled = false
    load<{ items: BudgetSummary[] }>(`/api/budgets?${new URLSearchParams({ companyId })}`, 'Les budgets ne se sont pas chargés. Réessayez dans un instant.')
      .then(({ items }) => {
        if (cancelled) return
        const open = items.filter((b) => !b.fiscalYear.isClosed)
        setBudgets(open)
        setBudgetId(defaultBudget(open, today)?.id ?? '')
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [companyId, today])

  React.useEffect(() => {
    if (!budgetId) return
    let cancelled = false
    load<BudgetDetail>(`/api/budgets/${budgetId}`, "Le budget ne s'est pas chargé. Réessayez dans un instant.")
      .then((detail) => {
        if (cancelled) return
        setLoaded(detail)
        const charges = detail.lines.filter((l) => l.side === 'charges')
        const prefix = subscription.suggestedAccountCode ? matchPrefix(subscription.suggestedAccountCode, charges.map((l) => l.accountPrefix)) : null
        setLineId(charges.find((l) => l.accountPrefix === prefix)?.id ?? '')
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [budgetId, subscription.suggestedAccountCode])

  const charges = budget?.lines.filter((l) => l.side === 'charges') ?? []

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!lineId) return
    setSaving(true)
    try {
      const response = await fetch('/api/subscriptions/budget-item', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ companyId, subscriptionId: subscription.id, budgetLineId: lineId, label: label.trim() || undefined }),
      })
      if (!response.ok) throw new Error(await responseError(response, "L'abonnement n'a pas été ajouté au budget. Réessayez dans un instant."))
      toast.success(`Ajouté au budget ${budget?.fiscalYear.year ?? ''}`.trim())
      onAdded((await response.json()) as SubscriptionView)
      onOpenChange(false)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Ajouter au budget</DialogTitle>
        <DialogDescription>
          Un élément récurrent {CADENCE_LABELS[subscription.cadence].toLowerCase()} de <Amount value={subscription.typicalAmountCents / 100} /> sur une ligne de
          charges, à partir de {formatDisplayDate(`${subscription.firstDay.slice(0, 7)}-01`, 'month')}, le mois du premier paiement. Vous pourrez le modifier
          sur la page Budget.
        </DialogDescription>
      </DialogHeader>
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : budgets === null ? (
        <div className="space-y-3" aria-busy>
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : budgets.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Aucun budget ouvert. Créez celui de l&apos;exercice sur la page{' '}
          <Link className="text-link underline-offset-4 hover:underline" href={`/${companyId}/budget`}>
            Budget
          </Link>
          , puis revenez ici.
        </p>
      ) : (
        <form id="subscription-budget-form" onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Exercice" htmlFor="subscription-budget">
            <Select value={budgetId} onValueChange={setBudgetId}>
              <SelectTrigger id="subscription-budget" className="w-full">
                <SelectValue placeholder="Choisissez un exercice" />
              </SelectTrigger>
              <SelectContent>
                {budgets.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    Exercice {b.fiscalYear.year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field
            label="Ligne de charges"
            htmlFor="subscription-line"
            required
            hint={subscription.suggestedAccountCode ? `Dernier paiement rapproché sur le compte ${subscription.suggestedAccountCode}.` : undefined}
          >
            {budget === null ? (
              <Skeleton className="h-9 w-full" />
            ) : charges.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Ce budget n&apos;a pas de ligne de charges. Ajoutez-en une sur la page{' '}
                <Link className="text-link underline-offset-4 hover:underline" href={`/${companyId}/budget`}>
                  Budget
                </Link>
                .
              </p>
            ) : (
              <Select value={lineId} onValueChange={setLineId}>
                <SelectTrigger id="subscription-line" className="w-full">
                  <SelectValue placeholder="Choisissez une ligne" />
                </SelectTrigger>
                <SelectContent>
                  {charges.map((line) => (
                    <SelectItem key={line.id} value={line.id}>
                      <span className="font-mono text-xs">{line.accountPrefix}</span> {line.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          <Field label="Libellé" htmlFor="subscription-label" hint="Le nom de l'élément récurrent dans le budget.">
            <Input id="subscription-label" autoComplete="off" maxLength={120} value={label} onChange={(e) => setLabel(e.target.value)} />
          </Field>
        </form>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Annuler
        </Button>
        <Button type="submit" form="subscription-budget-form" loading={saving} disabled={!lineId || !budgets?.length}>
          Ajouter au budget
        </Button>
      </DialogFooter>
    </>
  )
}
