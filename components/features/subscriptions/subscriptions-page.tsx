'use client'

import * as React from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Check, EyeOff, MoreHorizontal, Repeat, RotateCcw, RotateCw, Target, Workflow } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Amount, EmptyState, PageHeader, StatCard, StatusBadge, formatAmount, formatDisplayDate, type StatusTone } from '@/components/shared'
import { useCompanyAccess } from '@/components/features/companies/company-access'
import { responseError } from '@/hooks/use-cursor-list'
import { CADENCE_LABELS, CHARGE_REASON_LABELS, STATUS_LABELS, type SubscriptionStatus } from '@/lib/subscriptions/detect'
import type { SubscriptionList, SubscriptionView } from '@/lib/subscriptions/detect-subscriptions.service'
import { AddToBudgetDialog } from './add-to-budget-dialog'

type Filter = 'todo' | 'confirmed' | 'charges' | 'ignored' | 'all'
type Decision = 'confirmed' | 'ignored' | 'pending'

const STATUS_TONES: Record<SubscriptionStatus, StatusTone> = { active: 'success', price_changed: 'warning', possibly_stopped: 'neutral' }

const FILTERS: Array<{ value: Filter; label: string; matches: (s: SubscriptionView) => boolean }> = [
  { value: 'todo', label: 'À traiter', matches: (s) => s.countsAsSubscription && s.decision === null },
  { value: 'confirmed', label: 'Confirmés', matches: (s) => s.countsAsSubscription && s.decision?.status === 'confirmed' },
  // Salaries, social charges, taxes, loans: recurring, but not in the subscriptions nor their yearly cost
  { value: 'charges', label: 'Charges récurrentes', matches: (s) => !s.countsAsSubscription && s.decision?.status !== 'ignored' },
  { value: 'ignored', label: 'Ignorés', matches: (s) => s.decision?.status === 'ignored' },
  { value: 'all', label: 'Tous', matches: () => true },
]

const DECISION_TOASTS: Record<Decision, string> = { confirmed: 'Abonnement confirmé', ignored: 'Abonnement ignoré', pending: 'Remis à traiter' }

const day = (value: string) => formatDisplayDate(value, 'short')

/** One line of context under the counterparty: rhythm, history, price change, budget. */
function details(s: SubscriptionView): string {
  const parts = [`${CADENCE_LABELS[s.cadence]}, ${s.occurrences} paiements depuis le ${day(s.firstDay)}`]
  if (s.chargeReason) {
    parts.push(`charge récurrente : ${CHARGE_REASON_LABELS[s.chargeReason].toLowerCase()} (${s.classifiedBy === 'ledger' ? 'compte du rapprochement' : 'libellé'})`)
  }
  if (s.missedPayments > 0) parts.push(`${s.missedPayments} manqué${s.missedPayments > 1 ? 's' : ''}`)
  if (s.priceChange) {
    parts.push(`passé de ${formatAmount(s.priceChange.previousAmountCents / 100)} à ${formatAmount(s.priceChange.newAmountCents / 100)} le ${day(s.priceChange.sinceDay)}`)
  }
  if (s.variableAmount) parts.push('montant variable')
  if (s.decision?.budgetLine) parts.push(`au budget ${s.decision.budgetLine.fiscalYear}, ligne ${s.decision.budgetLine.accountPrefix}`)
  return parts.join(' · ')
}

function Badges({ s }: { s: SubscriptionView }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      <StatusBadge tone={STATUS_TONES[s.status]}>{STATUS_LABELS[s.status]}</StatusBadge>
      {s.decision ? <StatusBadge tone={s.decision.status === 'confirmed' ? 'info' : 'neutral'}>{s.decision.status === 'confirmed' ? 'Confirmé' : 'Ignoré'}</StatusBadge> : null}
    </span>
  )
}

/**
 * Recurring payments detected in the bank lines (docs/abonnements.md):
 * members who read the bank see them; those who reconcile confirm or
 * ignore them, and add them to the budget when they also build it.
 */
export function SubscriptionsPage({ companyId }: { companyId: string }) {
  const { can } = useCompanyAccess()
  const canDecide = can({ banking: ['reconcile'] })
  const canBudget = canDecide && can({ budgets: ['manage'] })
  const canRule = can({ ledger: ['manage'] })
  const [data, setData] = React.useState<SubscriptionList | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [version, setVersion] = React.useState(0)
  // Version of the last answer (list or error): loading while it is behind the version asked for
  const [answered, setAnswered] = React.useState(-1)
  const loading = answered !== version
  const [filter, setFilter] = React.useState<Filter>('todo')
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [budgetFor, setBudgetFor] = React.useState<SubscriptionView | null>(null)

  React.useEffect(() => {
    if (!companyId) return
    let cancelled = false
    fetch(`/api/subscriptions?${new URLSearchParams({ companyId })}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response, 'Les abonnements ne se sont pas chargés. Réessayez dans un instant.'))
        return response.json() as Promise<SubscriptionList>
      })
      .then((list) => {
        if (cancelled) return
        setData(list)
        setError(null)
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setAnswered(version))
    return () => {
      cancelled = true
    }
  }, [companyId, version])

  const replace = (updated: SubscriptionView) =>
    setData((current) => (current ? { ...current, items: current.items.map((s) => (s.id === updated.id ? updated : s)) } : current))

  const decide = async (s: SubscriptionView, status: Decision) => {
    setBusyId(s.id)
    try {
      const response = await fetch('/api/subscriptions/decision', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ companyId, subscriptionId: s.id, status }),
      })
      if (!response.ok) throw new Error(await responseError(response, "La décision n'a pas été enregistrée. Réessayez dans un instant."))
      replace((await response.json()) as SubscriptionView)
      toast.success(DECISION_TOASTS[status])
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  const items = data?.items ?? []
  const shown = items.filter(FILTERS.find((f) => f.value === filter)!.matches)

  const actions = (s: SubscriptionView) => {
    const entries: React.ReactNode[] = []
    if (canDecide && s.decision?.status !== 'confirmed') {
      entries.push(
        <DropdownMenuItem key="confirm" onSelect={() => decide(s, 'confirmed')}>
          <Check aria-hidden />
          {s.kind === 'recurring_charge' ? 'Compter comme abonnement' : 'Confirmer'}
        </DropdownMenuItem>,
      )
    }
    if (canDecide && s.decision?.status !== 'ignored') {
      entries.push(
        <DropdownMenuItem key="ignore" onSelect={() => decide(s, 'ignored')}>
          <EyeOff aria-hidden />
          Ignorer
        </DropdownMenuItem>,
      )
    }
    if (canDecide && s.decision) {
      entries.push(
        <DropdownMenuItem key="pending" onSelect={() => decide(s, 'pending')}>
          <RotateCcw aria-hidden />
          Remettre à traiter
        </DropdownMenuItem>,
      )
    }
    if (canBudget && s.cadence !== 'weekly') {
      entries.push(
        <DropdownMenuItem key="budget" onSelect={() => setBudgetFor(s)}>
          <Target aria-hidden />
          Ajouter au budget
        </DropdownMenuItem>,
      )
    }
    if (canRule) {
      entries.push(
        <DropdownMenuItem key="rule" asChild>
          <Link href={`/${companyId}/rules?${new URLSearchParams({ fromTransaction: s.lastTransactionId })}`}>
            <Workflow aria-hidden />
            Créer une règle d&apos;affectation
          </Link>
        </DropdownMenuItem>,
      )
    }
    if (entries.length === 0) return null
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions sur ${s.name}`} title="Actions" disabled={busyId === s.id}>
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">{entries}</DropdownMenuContent>
      </DropdownMenu>
    )
  }

  const emptyMessage =
    filter === 'todo'
      ? 'Rien à traiter : chaque abonnement détecté a une décision.'
      : filter === 'confirmed'
        ? 'Aucun abonnement confirmé.'
        : filter === 'charges'
          ? 'Aucune charge récurrente hors abonnements (salaires, cotisations sociales, impôts, emprunts).'
          : filter === 'ignored'
            ? 'Aucun abonnement ignoré.'
            : 'Aucun abonnement détecté.'

  return (
    <div className="space-y-6">
      <PageHeader
        title="Abonnements"
        description="Les paiements récurrents repérés dans vos opérations bancaires : logiciels, loyers, assurances. Confirmez-les, ignorez les autres et ajoutez-les au budget."
        actions={
          <Button variant="outline" onClick={() => setVersion((n) => n + 1)} disabled={loading}>
            <RotateCw aria-hidden />
            Actualiser
          </Button>
        }
      />

      {error ? (
        <EmptyState bordered title="Les abonnements ne se sont pas chargés" description={error} action={<Button size="sm" onClick={() => setVersion((n) => n + 1)}>Réessayer</Button>} />
      ) : loading && !data ? (
        <div className="space-y-6" aria-busy>
          <div className="grid gap-4 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
      ) : data && items.length === 0 ? (
        <EmptyState
          bordered
          icon={Repeat}
          title="Aucun abonnement détecté"
          description={
            data.observedUntil
              ? 'Aucun paiement ne revient à un rythme régulier dans vos opérations des trois dernières années. Un abonnement apparaît dès son troisième paiement mensuel.'
              : 'Connectez un compte bancaire ou importez un relevé : les abonnements se repèrent dans les opérations.'
          }
          action={
            <Button size="sm" asChild>
              <Link href={`/${companyId}/banking`}>Voir les comptes bancaires</Link>
            </Button>
          }
        />
      ) : data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Abonnements actifs" value={<span className="num">{data.totals.activeCount}</span>} hint="Hors salaires, charges sociales, impôts et emprunts" />
            <StatCard label="Coût annuel" value={<Amount value={data.totals.activeAnnualizedCents / 100} />} hint="Montant actuel multiplié par le rythme" />
            <StatCard
              label="Opérations lues jusqu'au"
              value={data.observedUntil ? day(data.observedUntil) : '-'}
              hint="Un paiement en retard se juge à cette date"
            />
          </div>

          <Card>
            <CardContent className="space-y-4">
              <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
                <TabsList className="max-w-full overflow-x-auto">
                  {FILTERS.map((f) => (
                    <TabsTrigger key={f.value} value={f.value}>
                      {f.label} <span className="text-muted-foreground num ml-1">{items.filter(f.matches).length}</span>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>

              {filter === 'charges' ? (
                <p className="text-muted-foreground max-w-prose text-sm">
                  Salaires, cotisations sociales, impôts et remboursements d&apos;emprunt reviennent eux aussi, mais ce ne sont pas des abonnements&nbsp;: ils ne
                  comptent pas dans le coût annuel. Kledg les reconnaît au compte de l&apos;écriture rapprochée, sinon au libellé. «&nbsp;Compter comme
                  abonnement&nbsp;» corrige une erreur.
                </p>
              ) : null}
              {shown.length === 0 ? (
                <p className="text-muted-foreground py-6 text-sm">{emptyMessage}</p>
              ) : (
                <>
                  <ul className="divide-y rounded-md border lg:hidden" aria-label="Abonnements">
                    {shown.map((s) => (
                      <li key={s.id} className="flex items-start justify-between gap-3 px-3 py-3">
                        <div className="min-w-0 space-y-1">
                          <p className="truncate text-sm font-medium">{s.name}</p>
                          <Badges s={s} />
                          <p className="text-muted-foreground text-xs">{details(s)}</p>
                          <p className="text-muted-foreground text-xs">
                            Dernier le {day(s.lastDay)}, prochain vers le {day(s.nextExpectedDay)}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <Amount value={s.typicalAmountCents / 100} className="text-sm font-semibold" />
                          <span className="text-muted-foreground text-xs">
                            <Amount value={s.annualizedCents / 100} /> par an
                          </span>
                          {actions(s)}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="hidden rounded-md border lg:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Contrepartie</TableHead>
                          <TableHead>Rythme</TableHead>
                          <TableHead numeric>Montant</TableHead>
                          <TableHead numeric>Coût annuel</TableHead>
                          <TableHead>Dernier paiement</TableHead>
                          <TableHead>Prochain paiement</TableHead>
                          <TableHead className="w-12">
                            <span className="sr-only">Actions</span>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {shown.map((s) => (
                          <TableRow key={s.id}>
                            <TableCell className="max-w-96">
                              <div className="space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="truncate font-medium">{s.name}</span>
                                  <Badges s={s} />
                                </div>
                                <p className="text-muted-foreground truncate text-xs" title={details(s)}>
                                  {details(s)}
                                </p>
                              </div>
                            </TableCell>
                            <TableCell>{CADENCE_LABELS[s.cadence]}</TableCell>
                            <TableCell numeric>
                              <Amount value={s.typicalAmountCents / 100} />
                            </TableCell>
                            <TableCell numeric>
                              <Amount value={s.annualizedCents / 100} />
                            </TableCell>
                            <TableCell>{day(s.lastDay)}</TableCell>
                            <TableCell>{day(s.nextExpectedDay)}</TableCell>
                            <TableCell>{actions(s)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}

      <AddToBudgetDialog
        companyId={companyId}
        subscription={budgetFor}
        today={data?.today ?? ''}
        onOpenChange={(open) => !open && setBudgetFor(null)}
        onAdded={replace}
      />
    </div>
  )
}
