'use client'

import * as React from 'react'
import Link from 'next/link'
import { ArrowUpRight, CalendarCheck, CircleCheck, Info, ListFilter, Settings2 } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { DateDisplay, EmptyState, PageHeader, formatDisplayDate } from '@/components/shared'
import { useCompanyAccess } from '@/components/features/companies/company-access'
import { FiscalYearSelector } from '@/components/features/accounting/fiscal-year-selector'
import { useMediaQuery } from '@/hooks/ui/use-media-query'
import { docsUrl } from '@/lib/docs-links'
import { DEADLINE_CATEGORIES, DEADLINE_CATEGORY_LABELS, type Deadline, type DeadlineCategory, type DeadlineRule } from '@/lib/deadlines/types'
import type { DeadlinesView } from '@/lib/deadlines/load-deadlines.service'
import { periodKeyOfDeadline } from '@/lib/vat-returns/period-keys'
import { corporateTaxPageOf } from '@/lib/corporate-tax/deadline-links'
import { DECLARATION_STATUS_CODES, type DeclarationStatusCode, type TrackedDeadline } from '@/lib/declarations/status'
import { DeadlineStatusBadge } from './deadline-status-badge'
import { MarkDeclarationDialog } from './mark-declaration-dialog'

type Category = DeadlineCategory | 'all'
type StatusFilter = DeclarationStatusCode | 'all'

/** Plural labels of the status filter. */
const STATUS_FILTER_LABELS: Record<DeclarationStatusCode, string> = { todo: 'À faire', filed: 'Déposées', paid: 'Payées', overdue: 'En retard', 'not-due': 'Non dues' }

type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: DeadlinesView }

const MONTH_NAMES = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']

/** "2026-05" -> "Mai 2026". */
const monthTitle = (month: string) => `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`

const FALLBACK_ERROR = 'Les échéances ne se sont pas chargées. Réessayez dans un instant.'

/** Months of the list, in date order: "2026-05" -> its deadlines. */
function byMonth(deadlines: TrackedDeadline[]): Array<[string, TrackedDeadline[]]> {
  const groups = new Map<string, TrackedDeadline[]>()
  for (const d of deadlines) {
    const key = d.date.slice(0, 7)
    groups.set(key, [...(groups.get(key) ?? []), d])
  }
  return [...groups.entries()]
}

/** The rule behind a deadline: what the texts say and where, in a popover that opens on tap. */
function RuleSource({ rule, deadline }: { rule: DeadlineRule | undefined; deadline: Deadline }) {
  if (!rule) return null
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="xs" aria-label={`Source de l'échéance ${deadline.label}`}>
          <Info aria-hidden />
          Source
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[70dvh] w-80 space-y-2 overflow-y-auto text-sm">
        <p className="font-medium">Règle</p>
        <p className="text-muted-foreground">{rule.summary}</p>
        {deadline.legalDate !== deadline.date ? (
          <p className="text-muted-foreground">
            Date légale le {formatDisplayDate(deadline.legalDate, 'long')}, reportée au jour ouvré suivant.
          </p>
        ) : null}
        <ul className="space-y-1">
          {rule.sources.map((s) => (
            <li key={s.url}>
              <a href={s.url} target="_blank" rel="noreferrer" className="text-link inline-flex items-center gap-1 underline-offset-4 hover:underline">
                {s.label}
                <ArrowUpRight aria-hidden className="size-3.5" />
              </a>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

/** What the tracker recorded, in a line: "Déposée le 04/05/2026, payée le 05/05/2026, 1 234,00 €". */
function recordedLine(deadline: TrackedDeadline): string | null {
  const s = deadline.status
  const parts = [
    s.filedOn ? `${deadline.ruleId === 'approbation' ? 'approuvés' : 'déposée'} le ${formatDisplayDate(s.filedOn)}` : null,
    s.paidOn ? `payée le ${formatDisplayDate(s.paidOn)}` : null,
    s.amountCents !== null && s.amountCents > 0 ? formatAmountFr(s.amountCents) : null,
    s.record?.attachmentName ? `pièce ${s.record.attachmentName}` : null,
    s.record?.attachmentReference ? `réf. ${s.record.attachmentReference}` : null,
  ].filter(Boolean)
  if (parts.length === 0) return null
  const text = parts.join(', ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const formatAmountFr = (cents: number) => `${(cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\u00a0€`

function DeadlineItem({
  deadline,
  rule,
  today,
  companyId,
  onMark,
}: {
  deadline: TrackedDeadline
  rule: DeadlineRule | undefined
  today: string
  companyId: string
  onMark: ((deadline: TrackedDeadline) => void) | null
}) {
  const vatPeriod = periodKeyOfDeadline(deadline)
  const corporateTaxPage = corporateTaxPageOf(deadline)
  const status = <DeadlineStatusBadge deadline={deadline} today={today} className="shrink-0" />
  const recorded = deadline.status ? recordedLine(deadline) : null
  // CFE and CVAE deadlines open the local taxes of their year ("cfe:2026", "cvae-acompte:2026:1").
  const localTaxYear = deadline.category === 'cfe' || deadline.category === 'cvae' ? (/:(\d{4})(?::|$)/.exec(deadline.id)?.[1] ?? null) : null
  return (
    <li className="flex flex-col gap-1.5 py-3 sm:flex-row sm:items-start sm:gap-4">
      {/* Phones: the date and the status on one line, above the label. */}
      <div className="flex items-center justify-between gap-3 sm:w-24 sm:shrink-0">
        <span className="text-sm font-medium">
          <DateDisplay value={deadline.date} />
        </span>
        <span className="sm:hidden">{status}</span>
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm">{deadline.label}</p>
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="font-mono">{deadline.form}</span>
          <Badge variant="muted">{DEADLINE_CATEGORY_LABELS[deadline.category]}</Badge>
          {deadline.estimated ? <Badge variant="outline">Jour indicatif</Badge> : null}
          {deadline.projected ? <Badge variant="outline">Exercice prévisionnel</Badge> : null}
        </div>
        {deadline.condition ? <p className="text-muted-foreground text-xs">{deadline.condition}</p> : null}
        {deadline.note ? <p className="text-muted-foreground text-xs">{deadline.note}</p> : null}
        {deadline.extendedDate ? (
          <p className="text-muted-foreground text-xs">Télédéclaration possible jusqu&apos;au {formatDisplayDate(deadline.extendedDate)}.</p>
        ) : null}
        {recorded ? <p className="text-xs">{recorded}</p> : null}
        {deadline.status?.record?.note ? <p className="text-muted-foreground text-xs">{deadline.status.record.note}</p> : null}
        {localTaxYear ? (
          <Link
            href={`/${companyId}/impots-locaux?annee=${localTaxYear}`}
            className="text-link inline-flex items-center gap-1 text-xs underline-offset-4 hover:underline pointer-coarse:-my-3 pointer-coarse:py-3"
          >
            Voir les impôts locaux
            <ArrowUpRight aria-hidden className="size-3.5" />
          </Link>
        ) : null}
        {vatPeriod ? (
          <Link
            href={`/${companyId}/declarations-tva?periode=${vatPeriod}`}
            className="text-link inline-flex items-center gap-1 text-xs underline-offset-4 hover:underline pointer-coarse:-my-3 pointer-coarse:py-3"
          >
            {deadline.ruleId === 'tva-acompte' ? 'Voir le calcul de l’acompte' : 'Préparer la déclaration'}
            <ArrowUpRight aria-hidden className="size-3.5" />
          </Link>
        ) : null}
        {corporateTaxPage ? (
          <Link
            href={`/${companyId}/${corporateTaxPage}`}
            className="text-link inline-flex items-center gap-1 text-xs underline-offset-4 hover:underline pointer-coarse:-my-3 pointer-coarse:py-3"
          >
            {deadline.ruleId === 'is-acompte' ? 'Voir le calcul de l’acompte' : deadline.ruleId === 'is-solde' ? 'Préparer le relevé de solde' : 'Préparer le résultat fiscal'}
            <ArrowUpRight aria-hidden className="size-3.5" />
          </Link>
        ) : null}
      </div>
      <div className="flex items-center gap-2 sm:shrink-0 sm:flex-col sm:items-end">
        <span className="hidden sm:inline-flex">{status}</span>
        <div className="flex items-center gap-1">
          {onMark && deadline.status ? (
            <Button variant="outline" size="xs" onClick={() => onMark(deadline)} aria-label={`Enregistrer le dépôt ou le paiement\u00a0: ${deadline.label}`}>
              <CircleCheck aria-hidden />
              {deadline.status.record ? 'Modifier' : 'Enregistrer'}
            </Button>
          ) : null}
          <RuleSource rule={rule} deadline={deadline} />
        </div>
      </div>
    </li>
  )
}

function ListSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      {[0, 1].map((i) => (
        <Card key={i} className="py-4">
          <CardContent className="space-y-4 px-4">
            <Skeleton className="h-5 w-32" />
            {[0, 1, 2].map((j) => (
              <div key={j} className="flex gap-4">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 flex-1" />
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export function DeadlinesPage({ companyId }: { companyId: string }) {
  const [fiscalYearId, setFiscalYearId] = React.useState('')
  const [category, setCategory] = React.useState<Category>('all')
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>('all')
  const [marking, setMarking] = React.useState<TrackedDeadline | null>(null)
  const [saved, setSaved] = React.useState<{ key: string; byId: Record<string, TrackedDeadline> }>({ key: '', byId: {} })
  const { can } = useCompanyAccess()
  const canMark = can({ entries: ['create'] })
  const canListReceipts = can({ expenses: ['submit'], banking: ['read'] })
  const [result, setResult] = React.useState<{ key: string; state: LoadState } | null>(null)
  const [attempt, setAttempt] = React.useState(0)
  const [sheetOpen, setSheetOpen] = React.useState(false)
  const isMobile = useMediaQuery('(max-width: 47.99rem)')

  // One request per fiscal year and attempt; until its answer arrives the list shows its skeleton.
  const requestKey = `${fiscalYearId}|${attempt}`
  const resultKey = React.useRef<string | null>(null)
  React.useEffect(() => {
    // The first answer (no fiscal year chosen yet) already holds the year the server picked.
    if (resultKey.current === requestKey) return
    let cancelled = false
    const query = new URLSearchParams({ companyId })
    if (fiscalYearId) query.set('fiscalYearId', fiscalYearId)
    fetch(`/api/deadlines?${query.toString()}`)
      .then(async (response) => {
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null
          throw new Error(body?.error || FALLBACK_ERROR)
        }
        return (await response.json()) as DeadlinesView
      })
      .then(
        (data) => {
          if (cancelled) return
          const key = !fiscalYearId && data.fiscalYear ? `${data.fiscalYear.id}|${attempt}` : requestKey
          resultKey.current = key
          setResult({ key, state: { status: 'ready', data } })
          if (!fiscalYearId && data.fiscalYear) setFiscalYearId(data.fiscalYear.id)
        },
        (error: unknown) => {
          const message = error instanceof Error && error.message !== 'Failed to fetch' ? error.message : FALLBACK_ERROR
          if (!cancelled) setResult({ key: requestKey, state: { status: 'error', message } })
        },
      )
    return () => {
      cancelled = true
    }
  }, [companyId, fiscalYearId, attempt, requestKey])

  const state: LoadState = result?.key === requestKey ? result.state : { status: 'loading' }
  const data = state.status === 'ready' ? state.data : null
  const rules = React.useMemo(() => new Map((data?.rules ?? []).map((r) => [r.id, r])), [data])
  // Statuses saved from the dialog replace the loaded ones until the next load.
  const updates = saved.key === requestKey ? saved.byId : null
  const deadlines = React.useMemo(() => (data ? data.deadlines.map((d) => updates?.[d.id] ?? d) : []), [data, updates])
  const shown = React.useMemo(
    () => deadlines.filter((d) => (category === 'all' || d.category === category) && (statusFilter === 'all' || d.status?.status === statusFilter)),
    [deadlines, category, statusFilter],
  )
  const months = byMonth(shown)

  const activeFilters = (category !== 'all' ? 1 : 0) + (statusFilter !== 'all' ? 1 : 0)

  const statusField = (
    <div className="space-y-2">
      <Label htmlFor="deadline-status">Statut</Label>
      <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
        <SelectTrigger id="deadline-status" className="w-full sm:w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Tous les statuts</SelectItem>
          {DECLARATION_STATUS_CODES.map((code) => (
            <SelectItem key={code} value={code}>
              {STATUS_FILTER_LABELS[code]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )

  const categoryField = (
    <div className="space-y-2">
      <Label htmlFor="deadline-category">Catégorie</Label>
      <Select value={category} onValueChange={(value) => setCategory(value as Category)}>
        <SelectTrigger id="deadline-category" className="w-full sm:w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Toutes les catégories</SelectItem>
          {DEADLINE_CATEGORIES.map((c) => (
            <SelectItem key={c} value={c}>
              {DEADLINE_CATEGORY_LABELS[c]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Échéances"
        description="Les déclarations et paiements fiscaux et les obligations juridiques de la société, mois par mois, avec la règle d'où vient chaque date."
        docsHref={docsUrl('calendar')}
        actions={
          <Button asChild variant="outline">
            <Link href={`/${companyId}/informations#echeances`}>
              <Settings2 aria-hidden />
              Paramètres des échéances
            </Link>
          </Button>
        }
      />

      <Alert role="note">
        <Info aria-hidden />
        <AlertTitle>Dates indicatives</AlertTitle>
        <AlertDescription>
          <p>
            Kledg calcule ces dates d&apos;après les textes et les informations de la société. Votre espace professionnel sur{' '}
            <a href="https://www.impots.gouv.fr/professionnel" target="_blank" rel="noreferrer" className="text-link underline-offset-4 hover:underline">
              impots.gouv.fr
            </a>{' '}
            reste la référence, ainsi que le calendrier fiscal publié chaque année.
          </p>
        </AlertDescription>
      </Alert>

      <Card className="py-4">
        <CardContent className="px-4">
          {isMobile ? (
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1 space-y-2">
                <Label htmlFor="deadline-fiscal-year">Exercice</Label>
                <FiscalYearSelector id="deadline-fiscal-year" companyId={companyId} value={fiscalYearId} onValueChange={setFiscalYearId} showLabel={false} showPeriod={false} />
              </div>
              <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
                <SheetTrigger asChild>
                  <Button variant="outline" aria-label={activeFilters === 0 ? 'Filtres' : `Filtres, ${activeFilters} actif${activeFilters > 1 ? 's' : ''}`}>
                    <ListFilter aria-hidden />
                    Filtres
                    {activeFilters > 0 ? (
                      <Badge variant="secondary" className="num">
                        {activeFilters}
                      </Badge>
                    ) : null}
                  </Button>
                </SheetTrigger>
                <SheetContent side="bottom" className="max-h-[85dvh] gap-0 rounded-t-lg">
                  <SheetHeader className="border-b">
                    <SheetTitle>Filtres</SheetTitle>
                    <SheetDescription>La liste se met à jour à chaque choix.</SheetDescription>
                  </SheetHeader>
                  <div className="grid gap-3 overflow-y-auto p-4">
                    {categoryField}
                    {statusField}
                  </div>
                  <SheetFooter className="flex-row justify-end border-t">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setCategory('all')
                        setStatusFilter('all')
                      }}
                    >
                      Réinitialiser
                    </Button>
                    <Button onClick={() => setSheetOpen(false)}>Voir les échéances</Button>
                  </SheetFooter>
                </SheetContent>
              </Sheet>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-56 space-y-2">
                <Label htmlFor="deadline-fiscal-year">Exercice</Label>
                <FiscalYearSelector id="deadline-fiscal-year" companyId={companyId} value={fiscalYearId} onValueChange={setFiscalYearId} showLabel={false} showPeriod={false} />
              </div>
              {categoryField}
              {statusField}
            </div>
          )}
        </CardContent>
      </Card>

      {data?.deadlines.some((d) => d.estimated) ? (
        <p className="text-muted-foreground text-sm">
          Le jour de déclaration de TVA n&apos;est pas renseigné&nbsp;: Kledg retient le plus tôt possible pour la forme juridique de la société (jour indicatif). Votre jour figure dans votre espace professionnel sur impots.gouv.fr.{' '}
          <Link href={`/${companyId}/informations#echeances`} className="text-link underline-offset-4 hover:underline">
            Indiquer le jour
          </Link>
        </p>
      ) : null}

      {data?.missingRegimes ? (
        <p className="text-muted-foreground text-sm">
          Les régimes de TVA ou d&apos;impôt sur les sociétés ne sont pas renseignés&nbsp;: seules les échéances qui n&apos;en dépendent pas sont listées.{' '}
          <Link href={`/${companyId}/informations#regimes-fiscaux`} className="text-link underline-offset-4 hover:underline">
            Renseigner les régimes
          </Link>
        </p>
      ) : null}

      <div aria-busy={state.status === 'loading' || undefined}>
        {state.status === 'loading' ? (
          <ListSkeleton />
        ) : state.status === 'error' ? (
          <Card className="py-4">
            <CardContent className="flex flex-col items-start gap-2 px-4" role="alert">
              <p className="text-muted-foreground text-sm">{state.message}</p>
              <Button size="sm" variant="outline" onClick={() => setAttempt((n) => n + 1)}>
                Réessayer
              </Button>
            </CardContent>
          </Card>
        ) : !data?.fiscalYear ? (
          <EmptyState
            bordered
            icon={CalendarCheck}
            title="Aucun exercice pour cette société"
            description="Les échéances se calculent à partir des exercices. Créez le premier exercice pour les voir."
            action={
              <Button asChild size="sm">
                <Link href={`/${companyId}/fiscal-years`}>Créer un exercice</Link>
              </Button>
            }
          />
        ) : months.length === 0 ? (
          <EmptyState
            bordered
            icon={CalendarCheck}
            title={
              statusFilter !== 'all'
                ? `Aucune échéance « ${STATUS_FILTER_LABELS[statusFilter].toLowerCase()} » sur cet exercice`
                : category === 'all'
                  ? 'Aucune échéance sur cet exercice'
                  : `Aucune échéance ${DEADLINE_CATEGORY_LABELS[category]} sur cet exercice`
            }
            description="Vérifiez les régimes fiscaux et les paramètres des échéances de la société."
          />
        ) : (
          <div className="space-y-4">
            {months.map(([month, items]) => (
              <Card key={month} className="gap-2 py-4">
                <CardContent className="px-4">
                  <h2 className="text-base font-semibold">{monthTitle(month)}</h2>
                  <ul className="divide-y" aria-label={`Échéances de ${monthTitle(month).toLowerCase()}`}>
                    {items.map((d) => (
                      <DeadlineItem key={d.id} deadline={d} rule={rules.get(d.ruleId)} today={data.today} companyId={companyId} onMark={canMark ? setMarking : null} />
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {marking ? (
        <MarkDeclarationDialog
          key={marking.id}
          companyId={companyId}
          deadline={marking}
          open
          onOpenChange={(open) => !open && setMarking(null)}
          onSaved={(updated) => setSaved((current) => ({ key: requestKey, byId: { ...(current.key === requestKey ? current.byId : {}), [updated.id]: updated } }))}
          canListReceipts={canListReceipts}
        />
      ) : null}
    </div>
  )
}
