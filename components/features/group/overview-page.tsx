'use client'

import Link from 'next/link'
import { CalendarClock, FileText, ListChecks } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Amount, DateDisplay, EmptyState, PageHeader, StatCard, StatusBadge } from '@/components/shared'
import { DEADLINE_CATEGORY_LABELS } from '@/lib/deadlines/types'
import { INDICATIVE_NOTICE } from '@/lib/group/labels'
import type { GroupAlerts } from '@/lib/group/get-group-alerts.service'
import type { GroupView } from '@/lib/group/get-group-view.service'
import { TreasuryLineChart } from './charts'
import { CompanyLink, Cents, GroupFiscalYear, LoadError, Notice, PerimeterNotes, roleLabel, useGroupReport, useReportUrl, useGroupSpace } from './space'

const KPIS = [
  { key: 'chiffreAffairesCents', label: "Chiffre d'affaires", hint: 'Après éliminations' },
  { key: 'ebeCents', label: "Excédent brut d'exploitation", hint: 'Après éliminations', signed: true },
  { key: 'resultatCents', label: 'Résultat combiné', hint: 'Après éliminations', signed: true },
  { key: 'tresorerieCents', label: 'Trésorerie', hint: "Comptes 512 en fin d'exercice" },
  { key: 'capitauxPropresCents', label: 'Capitaux propres', hint: 'Agrégés, titres non éliminés', signed: true },
  { key: 'endettementCents', label: 'Endettement financier', hint: 'Après éliminations des prêts du groupe' },
] as const

/** Vue d'ensemble of the group space: combined KPIs, the companies, the group's cash and what needs attention. */
export function GroupOverviewPage() {
  const { companyId } = useGroupSpace()
  const view = useGroupReport<GroupView>(useReportUrl('view'), "La vue d'ensemble ne s'est pas chargée. Réessayez dans un instant.")
  const alerts = useGroupReport<GroupAlerts>(useReportUrl('alerts', {}, false), "Les alertes du groupe ne se sont pas chargées. Réessayez dans un instant.")
  const data = view.data
  const loading = view.loading || !data
  const after = data?.afterEliminations
  const noGroup = data !== null && data.members.length === 1 && data.unreachable.length === 0
  const alertsOf = new Map((alerts.data?.companies ?? []).map((c) => [c.company.id, c]))

  return (
    <div className="space-y-6">
      <PageHeader title="Vue d'ensemble" description="Les chiffres clés du groupe, ses sociétés, sa trésorerie et ce qui demande votre attention." />
      <GroupFiscalYear hint="Écritures validées de chaque société pour l'exercice de la holding. Chaque filiale est lue avec vos droits dans cette filiale." />
      {view.error ? (
        <LoadError message={view.error} onRetry={view.retry} />
      ) : noGroup ? (
        <EmptyState
          bordered
          title="Aucune filiale pour cette société"
          description="Une société est la holding d'une autre quand elle figure parmi ses actionnaires. Enregistrez la holding comme actionnaire « Société » sur la page Informations de chaque filiale."
          action={
            <Link href={`/${companyId}`} className="text-link text-sm hover:underline">
              Revenir à la société
            </Link>
          }
        />
      ) : (
        <>
          <Notice>{INDICATIVE_NOTICE}</Notice>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy={loading || undefined}>
            {KPIS.map((k) => (
              <StatCard
                key={k.key}
                label={k.label}
                value={after ? <Amount value={after[k.key] / 100} /> : '-'}
                valueClassName={after && 'signed' in k && after[k.key] < 0 ? 'text-destructive' : undefined}
                hint={k.hint}
                busy={loading}
              />
            ))}
          </div>
          {data ? <PerimeterNotes warnings={data.warnings} unreachable={data.unreachable} /> : null}

          <section aria-labelledby="group-companies" className="space-y-3">
            <h2 id="group-companies" className="text-base font-semibold">
              Sociétés du groupe
            </h2>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-busy={loading || undefined}>
              {loading && !data
                ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-40 rounded-lg" />)
                : data?.members.map((m) => {
                    const a = alertsOf.get(m.id)
                    return (
                      <Card key={m.id} className="gap-3">
                        <CardHeader>
                          <CardTitle>
                            <h3 className="truncate">
                              <CompanyLink company={m} />
                            </h3>
                          </CardTitle>
                          <CardDescription>{roleLabel(m)}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          {m.figures ? (
                            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                              <dt className="text-muted-foreground">Chiffre d&apos;affaires</dt>
                              <dd className="text-right">
                                <Cents value={m.figures.chiffreAffairesCents} />
                              </dd>
                              <dt className="text-muted-foreground">Résultat</dt>
                              <dd className="text-right">
                                <Cents value={m.figures.resultatCents} signed />
                              </dd>
                              <dt className="text-muted-foreground">Trésorerie</dt>
                              <dd className="text-right">
                                <Cents value={m.figures.tresorerieCents} />
                              </dd>
                            </dl>
                          ) : (
                            <p className="text-muted-foreground text-sm">Aucun exercice sur cette période.</p>
                          )}
                          {a ? (
                            <div className="flex flex-wrap gap-2">
                              {a.overdue > 0 ? <StatusBadge tone="danger">{a.overdue} en retard</StatusBadge> : null}
                              {a.unreconciled > 0 ? <StatusBadge tone="warning">{a.unreconciled} à rapprocher</StatusBadge> : null}
                              {a.drafts > 0 ? <StatusBadge tone="info">{a.drafts} brouillons</StatusBadge> : null}
                              {a.overdue + a.unreconciled + a.drafts === 0 ? <StatusBadge tone="success">À jour</StatusBadge> : null}
                            </div>
                          ) : null}
                        </CardContent>
                      </Card>
                    )
                  })}
            </div>
          </section>

          <Card aria-busy={loading || undefined}>
            <CardHeader>
              <CardTitle>
                <h2>Trésorerie du groupe</h2>
              </CardTitle>
              <CardDescription>Somme des soldes des comptes bancaires (512) des sociétés lues, en fin de mois.</CardDescription>
            </CardHeader>
            <CardContent className="px-2 sm:px-5">
              {data && data.treasury.length > 0 ? (
                <TreasuryLineChart points={data.treasury.map((t) => ({ month: t.month, cents: t.totalCents }))} label="Trésorerie du groupe" />
              ) : loading ? (
                <Skeleton className="h-64 w-full" />
              ) : (
                <p className="text-muted-foreground px-3 text-sm sm:px-0">Aucun mois à afficher pour cet exercice.</p>
              )}
            </CardContent>
          </Card>

          <GroupAlertsCard alerts={alerts.data} loading={alerts.loading} error={alerts.error} onRetry={alerts.retry} names={new Map((data?.members ?? []).map((m) => [m.id, m]))} />
        </>
      )}
    </div>
  )
}

function GroupAlertsCard({
  alerts,
  loading,
  error,
  onRetry,
  names,
}: {
  alerts: GroupAlerts | null
  loading: boolean
  error: string | null
  onRetry: () => void
  names: Map<string, { name: string; slug: string }>
}) {
  if (error) return <LoadError message={error} onRetry={onRetry} />
  const companyOf = (id: string) => names.get(id) ?? alerts?.companies.find((c) => c.company.id === id)?.company
  return (
    <Card aria-busy={loading || undefined}>
      <CardHeader>
        <CardTitle>
          <h2>À traiter dans le groupe</h2>
        </CardTitle>
        <CardDescription>Déclarations en retard selon le suivi de chaque société, transactions à rapprocher et écritures en brouillon.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!alerts ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <p className="flex items-center gap-2 text-sm">
                <CalendarClock aria-hidden className="text-muted-foreground size-4" />
                <span className="num font-medium">{alerts.totals.overdue}</span> déclarations en retard
              </p>
              <p className="flex items-center gap-2 text-sm">
                <ListChecks aria-hidden className="text-muted-foreground size-4" />
                <span className="num font-medium">{alerts.totals.unreconciled}</span> transactions à rapprocher
              </p>
              <p className="flex items-center gap-2 text-sm">
                <FileText aria-hidden className="text-muted-foreground size-4" />
                <span className="num font-medium">{alerts.totals.drafts}</span> écritures en brouillon
              </p>
            </div>
            {alerts.overdue.length === 0 ? (
              <p className="text-muted-foreground text-sm">Aucune déclaration en retard dans les sociétés lues.</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {alerts.overdue.map((d) => {
                  const company = companyOf(d.companyId)
                  return (
                    <li key={`${d.companyId}-${d.deadlineId}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span className="min-w-0">
                        <span className="block font-medium">{d.label}</span>
                        <span className="text-muted-foreground block text-xs">
                          {company ? <CompanyLink company={company} to="/echeances" /> : null} · {DEADLINE_CATEGORY_LABELS[d.category]} · {d.form}
                        </span>
                      </span>
                      <StatusBadge tone="danger">
                        En retard depuis le <DateDisplay value={d.date} />
                      </StatusBadge>
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
