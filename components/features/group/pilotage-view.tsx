'use client'

import Link from 'next/link'
import { CalendarClock, FileText, ListChecks } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow, TableSkeleton } from '@/components/ui/table'
import { Amount, DateDisplay, EmptyState, StatCard, StatusBadge, formatPercent } from '@/components/shared'
import { DEADLINE_CATEGORY_LABELS } from '@/lib/deadlines/types'
import { INDICATIVE_NOTICE } from '@/lib/group/labels'
import type { KeyFigures } from '@/lib/group/combine'
import type { GroupAlerts } from '@/lib/group/get-group-alerts.service'
import type { GroupView } from '@/lib/group/get-group-view.service'
import { cn } from '@/lib/utils'
import { GroupEvolutionSection } from './evolution-page'
import { GroupComparisonSection, GroupRatiosSection } from './indicators-pages'
import { CompanyLink, Cents, ExportButtons, LoadError, Notice, PerimeterNotes, roleLabel, SectionIntro, useGroupReport, useGroupSpace, useReportUrl } from './space'
import { GroupViewFrame } from './view-frame'

const KPIS = [
  { key: 'chiffreAffairesCents', label: "Chiffre d'affaires" },
  { key: 'ebeCents', label: "Excédent brut d'exploitation", signed: true },
  { key: 'resultatCents', label: 'Résultat', signed: true },
  { key: 'tresorerieCents', label: 'Trésorerie', hint: "Comptes 512 en fin d'exercice" },
  { key: 'capitauxPropresCents', label: 'Capitaux propres', signed: true },
  { key: 'endettementCents', label: 'Endettement financier' },
] as const

const ALL = 'group'

function useView() {
  return useGroupReport<GroupView>(useReportUrl('view'), 'La vue du groupe ne s’est pas chargée. Réessayez dans un instant.')
}

/** Share of a total, "45,2 %", "-" when the total is not positive. */
const shareOf = (part: number, total: number) => (total > 0 ? formatPercent(Math.round((part / total) * 1000) / 10) : '-')

/**
 * Synthèse of Pilotage: how the group is doing (KPIs after eliminations, or
 * one company's), what each company contributes, and what needs attention.
 */
export function GroupSynthesisSection() {
  const { companyId, companyFilter } = useGroupSpace()
  const view = useView()
  const alerts = useGroupReport<GroupAlerts>(useReportUrl('alerts', {}, false), 'Les alertes du groupe ne se sont pas chargées. Réessayez dans un instant.')
  const data = view.data
  const loading = view.loading || !data
  const selected = data?.members.find((m) => m.id === companyFilter) ?? null
  const figures: KeyFigures | null = selected ? selected.figures : (data?.afterEliminations ?? null)
  const noGroup = data !== null && data.members.length === 1 && data.unreachable.length === 0
  const alertsOf = new Map((alerts.data?.companies ?? []).map((c) => [c.company.id, c]))
  const combined = data?.combined

  if (view.error) return <LoadError message={view.error} onRetry={view.retry} />
  if (noGroup) {
    return (
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
    )
  }
  return (
    <>
      <SectionIntro
        description={selected ? `Les chiffres de ${selected.name} sur son exercice, et sa part dans le groupe.` : 'Les chiffres clés du groupe après élimination des flux entre ses sociétés, la contribution de chaque société et ce qui demande votre attention.'}
        actions={<ExportButtons report="combined" disabled={!data} />}
      />
      {selected ? null : <Notice>{INDICATIVE_NOTICE}</Notice>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy={loading || undefined}>
        {KPIS.map((k) => (
          <StatCard
            key={k.key}
            label={k.label}
            value={figures ? <Amount value={figures[k.key] / 100} /> : '-'}
            valueClassName={figures && 'signed' in k && figures[k.key] < 0 ? 'text-destructive' : undefined}
            hint={'hint' in k ? k.hint : selected ? selected.name : 'Groupe, après éliminations'}
            busy={loading}
          />
        ))}
      </div>
      {data ? <PerimeterNotes warnings={data.warnings} unreachable={data.unreachable} /> : null}

      <Card aria-busy={loading || undefined}>
        <CardHeader>
          <CardTitle>
            <h2>Contribution de chaque société</h2>
          </CardTitle>
          <CardDescription>Chaque société à 100 %, sa part dans l&apos;agrégat, puis les éliminations des flux entre sociétés du groupe.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-44">Société</TableHead>
                  <TableHead numeric>Chiffre d&apos;affaires</TableHead>
                  <TableHead numeric>Part</TableHead>
                  <TableHead numeric>EBE</TableHead>
                  <TableHead numeric>Résultat</TableHead>
                  <TableHead numeric>Part</TableHead>
                  <TableHead numeric>Trésorerie</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!data || !combined ? (
                  <TableSkeleton columns={7} />
                ) : (
                  data.members.map((m) => (
                    <TableRow key={m.id} className={cn(m.id === companyFilter && 'bg-muted/60 font-medium')}>
                      <TableCell className="whitespace-normal">
                        <CompanyLink company={m} />
                        <span className="text-muted-foreground block text-xs">{roleLabel(m)}</span>
                      </TableCell>
                      <TableCell numeric>
                        <Cents value={m.figures?.chiffreAffairesCents} />
                      </TableCell>
                      <TableCell numeric>{m.figures ? shareOf(m.figures.chiffreAffairesCents, combined.chiffreAffairesCents) : '-'}</TableCell>
                      <TableCell numeric>
                        <Cents value={m.figures?.ebeCents} signed />
                      </TableCell>
                      <TableCell numeric>
                        <Cents value={m.figures?.resultatCents} signed />
                      </TableCell>
                      <TableCell numeric>{m.figures ? shareOf(m.figures.resultatCents, combined.resultatCents) : '-'}</TableCell>
                      <TableCell numeric>
                        <Cents value={m.figures?.tresorerieCents} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
              {data && combined ? (
                <TableFooter>
                  <TableRow>
                    <TableCell>Agrégat</TableCell>
                    <TableCell numeric>
                      <Cents value={combined.chiffreAffairesCents} />
                    </TableCell>
                    <TableCell numeric>100&nbsp;%</TableCell>
                    <TableCell numeric>
                      <Cents value={combined.ebeCents} signed />
                    </TableCell>
                    <TableCell numeric>
                      <Cents value={combined.resultatCents} signed />
                    </TableCell>
                    <TableCell numeric>100&nbsp;%</TableCell>
                    <TableCell numeric>
                      <Cents value={combined.tresorerieCents} />
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Éliminations</TableCell>
                    <TableCell numeric>
                      <Cents value={data.eliminations.effect.chiffreAffairesCents} signed />
                    </TableCell>
                    <TableCell />
                    <TableCell numeric>
                      <Cents value={data.eliminations.effect.ebeCents} signed />
                    </TableCell>
                    <TableCell numeric>
                      <Cents value={data.eliminations.effect.resultatCents} signed />
                    </TableCell>
                    <TableCell />
                    <TableCell numeric>
                      <Cents value={data.eliminations.effect.tresorerieCents} signed />
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Groupe après éliminations</TableCell>
                    <TableCell numeric>
                      <Cents value={data.afterEliminations.chiffreAffairesCents} />
                    </TableCell>
                    <TableCell />
                    <TableCell numeric>
                      <Cents value={data.afterEliminations.ebeCents} signed />
                    </TableCell>
                    <TableCell numeric>
                      <Cents value={data.afterEliminations.resultatCents} signed />
                    </TableCell>
                    <TableCell />
                    <TableCell numeric>
                      <Cents value={data.afterEliminations.tresorerieCents} />
                    </TableCell>
                  </TableRow>
                </TableFooter>
              ) : null}
            </Table>
          </div>
        </CardContent>
      </Card>

      <section aria-labelledby="group-companies" className="space-y-3">
        <h2 id="group-companies" className="text-base font-semibold">
          État de chaque société
        </h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-busy={alerts.loading || undefined}>
          {!data
            ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-28 rounded-lg" />)
            : data.members
                .filter((m) => !companyFilter || m.id === companyFilter)
                .map((m) => {
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
                      <CardContent>
                        {a ? (
                          <div className="flex flex-wrap gap-2">
                            {a.overdue > 0 ? <StatusBadge tone="danger">{a.overdue} en retard</StatusBadge> : null}
                            {a.unreconciled > 0 ? <StatusBadge tone="warning">{a.unreconciled} à rapprocher</StatusBadge> : null}
                            {a.drafts > 0 ? <StatusBadge tone="info">{a.drafts} brouillons</StatusBadge> : null}
                            {a.overdue + a.unreconciled + a.drafts === 0 ? <StatusBadge tone="success">À jour</StatusBadge> : null}
                          </div>
                        ) : (
                          <Skeleton className="h-6 w-40" />
                        )}
                      </CardContent>
                    </Card>
                  )
                })}
        </div>
      </section>

      <GroupAlertsCard alerts={alerts.data} loading={alerts.loading} error={alerts.error} onRetry={alerts.retry} names={new Map((data?.members ?? []).map((m) => [m.id, m]))} />
    </>
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

/** The company filter of Pilotage: the group, or one company read. */
function CompanyFilter() {
  const { companyFilter, setCompanyFilter } = useGroupSpace()
  const view = useView()
  return (
    <div className="space-y-2">
      <Label htmlFor="group-company-filter">Société</Label>
      <Select value={companyFilter ?? ALL} onValueChange={(v) => setCompanyFilter(v === ALL ? null : v)}>
        <SelectTrigger id="group-company-filter">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Tout le groupe</SelectItem>
          {view.data?.members.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/**
 * Pilotage (/<holding>/group): how is the group doing, and each company in
 * it? Combined KPIs, the contribution of each company, N against N-1, month
 * by month and the ratios, with one company filter for every tab.
 */
export function GroupPilotageView() {
  return (
    <GroupViewFrame
      title="Pilotage"
      description="Comment se porte le groupe et chacune de ses sociétés : chiffres combinés, contribution de chaque société, comparaison avec l'exercice précédent et évolution mois par mois."
      controls={<CompanyFilter />}
      hint="Écritures validées de chaque société pour l'exercice de la holding. Chaque filiale est lue avec vos droits dans cette filiale."
      tabs={[
        { id: 'synthese', label: 'Synthèse', content: <GroupSynthesisSection /> },
        { id: 'comparaison', label: 'N et N-1', content: <GroupComparisonSection /> },
        { id: 'evolution', label: 'Évolution', content: <GroupEvolutionSection /> },
        { id: 'ratios', label: 'Ratios', content: <GroupRatiosSection /> },
      ]}
    />
  )
}
