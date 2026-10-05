'use client'

import * as React from 'react'
import { Download, Info, LineChart as LineChartIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Amount, DateDisplay, EmptyState, PageHeader, StatCard, StatusBadge } from '@/components/shared'
import { useCompanyAccess } from '@/components/features/companies/company-access'
import { responseError } from '@/hooks/use-cursor-list'
import { cn } from '@/lib/utils'
import { CASH_FORECAST_COMPONENTS, COMPONENT_INFO, overlapsTrend, type CashForecastComponent } from '@/lib/cash-forecast/components'
import { projectCashForecast, type CashFlowItem, type ForecastGranularity } from '@/lib/cash-forecast/projection'
import { CASH_FORECAST_HORIZONS, type CashForecastSettings } from '@/lib/cash-forecast/settings'
import type { CashForecastView } from '@/lib/cash-forecast/load-cash-forecast.service'
import { alertOf } from '@/lib/cash-forecast/alert'
import {
  FORECAST_DESCRIPTIONS,
  FORECAST_TITLES,
  LATE_FLOW,
  NOT_A_GUARANTEE,
  aboveThresholdSentence,
  periodLabel,
  type ForecastMode,
} from '@/lib/cash-forecast/wording'
import { dateInWords, declarationTitle } from '@/lib/simple/vocabulary'
import { CashForecastAlertCard, formatCents } from './cash-forecast-alert'
import { CashForecastChart } from './cash-forecast-chart'
import { CashForecastSettingsCard } from './cash-forecast-settings-card'

/** Flows listed before "Tout afficher". */
const FLOWS_SHOWN = 50

const TEXT = {
  expert: {
    today: 'Solde du jour',
    end: 'Solde projeté en fin d’horizon',
    lowest: 'Point le plus bas',
    components: 'Flux pris en compte',
    componentsHint: 'Cochez ou décochez un flux pour voir ce qu’il change. Les hypothèses sont décochées par défaut.',
    periods: 'Détail par période',
    period: 'Période',
    opening: 'Début',
    inflows: 'Encaissements',
    outflows: 'Décaissements',
    closing: 'Fin',
    flows: 'Flux comptés',
    flowsHint: 'Chaque flux à sa date, du plus proche au plus lointain.',
    unknownTaxes: 'Échéances sans montant connu',
    unknownTaxesHint: 'Ces paiements ne sont pas dans la courbe : saisissez leur montant dans le suivi des échéances pour les compter.',
    overlap: 'Le rythme récent contient déjà les paiements récurrents et ce que prévoit le budget : les cocher ensemble compte ces montants deux fois.',
    assumption: 'Hypothèse',
    empty: 'Aucun flux à venir sur la période',
    emptyHint: 'Le solde reste celui d’aujourd’hui. Rapprochez vos opérations et saisissez vos factures pour enrichir la prévision.',
    noThreshold: 'Aucun seuil d’alerte : renseignez-en un plus bas pour être prévenu.',
    horizon: 'Horizon',
    granularity: 'Découpage',
    months: 'Par mois',
    weeks: 'Par semaine',
    export: 'Exporter en CSV',
  },
  simple: {
    today: 'Sur vos comptes aujourd’hui',
    end: 'Prévu à la fin',
    lowest: 'Au plus bas',
    components: 'Ce que Kledg compte',
    componentsHint: 'Cochez ou décochez une ligne pour voir ce qu’elle change. Les deux dernières sont des suppositions.',
    periods: 'Période par période',
    period: 'Période',
    opening: 'Au début',
    inflows: 'Arrive',
    outflows: 'Part',
    closing: 'À la fin',
    flows: 'Ce qui va arriver et partir',
    flowsHint: 'Chaque montant à sa date, du plus proche au plus lointain.',
    unknownTaxes: 'Impôts dont le montant n’est pas encore connu',
    unknownTaxesHint: 'Ils ne sont pas comptés dans la courbe.',
    overlap: '« Si les derniers mois se répètent » contient déjà vos paiements réguliers et votre budget : en cocher plusieurs compte les mêmes montants deux fois.',
    assumption: 'Supposition',
    empty: 'Rien de prévu sur la période',
    emptyHint: 'Votre compte resterait au même montant qu’aujourd’hui.',
    noThreshold: 'Indiquez plus bas le minimum à garder sur votre compte pour être prévenu.',
    horizon: 'Durée',
    granularity: 'Affichage',
    months: 'Par mois',
    weeks: 'Par semaine',
    export: 'Télécharger',
  },
} as const

function openingHint(view: CashForecastView, mode: ForecastMode): string {
  const { opening } = view
  if (opening.source === 'bank') {
    const accounts = `${opening.bankAccounts} compte${opening.bankAccounts > 1 ? 's' : ''}`
    return mode === 'simple' ? `D’après vos banques (${accounts})` : `Soldes déclarés par les banques, ${accounts} en euros`
  }
  if (opening.source === 'ledger') return mode === 'simple' ? 'D’après vos comptes saisis dans Kledg' : 'Solde des comptes 512 en comptabilité'
  return mode === 'simple' ? 'Aucun compte bancaire connecté' : 'Aucun compte bancaire ni écriture de banque : départ à zéro'
}

/** The words of a flow: the plain title of a tax in simple mode, the label of the books otherwise. */
function flowLabel(item: CashFlowItem, mode: ForecastMode): string {
  if (mode === 'simple' && item.ruleId) return declarationTitle(item.ruleId)
  return item.label
}

const componentLabel = (component: CashForecastComponent, mode: ForecastMode) => (mode === 'simple' ? COMPONENT_INFO[component].simpleLabel : COMPONENT_INFO[component].label)

/**
 * Prévision de trésorerie (docs/prevision-tresorerie.md): the flows come
 * from GET /api/cash-forecast for the horizon; the projection is computed
 * here with the same pure function as the server (lib/cash-forecast/projection.ts),
 * so switching a component or the granularity answers at once.
 */
export function CashForecastPage({ companyId, mode }: { companyId: string; mode: ForecastMode }) {
  const text = TEXT[mode]
  const access = useCompanyAccess()
  const [horizon, setHorizon] = React.useState<number | null>(null)
  const [granularity, setGranularity] = React.useState<ForecastGranularity>('month')
  const [components, setComponents] = React.useState<CashForecastComponent[] | null>(null)
  const [data, setData] = React.useState<CashForecastView | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [version, setVersion] = React.useState(0)
  // The request being answered: loading until its answer arrives (no state set inside the effect body).
  const requestKey = `${horizon ?? 'saved'}:${version}`
  const [answered, setAnswered] = React.useState<string | null>(null)
  const loading = answered !== requestKey
  const [showAll, setShowAll] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams({ companyId })
    if (horizon !== null) params.set('horizon', String(horizon))
    fetch(`/api/cash-forecast?${params}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response, 'La prévision ne s’est pas chargée. Réessayez dans un instant.'))
        return response.json() as Promise<CashForecastView>
      })
      .then((view) => {
        if (cancelled) return
        setData(view)
        setError(null)
        setComponents((current) => current ?? view.settings.components)
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setAnswered(`${horizon ?? 'saved'}:${version}`))
    return () => {
      cancelled = true
    }
  }, [companyId, horizon, version])

  const projection = React.useMemo(
    () =>
      data && components
        ? projectCashForecast({
            today: data.today,
            horizonMonths: data.horizonMonths,
            granularity,
            openingCents: data.opening.cents,
            items: data.items,
            components,
            thresholdCents: data.settings.thresholdCents,
          })
        : null,
    [data, components, granularity],
  )
  const alert = projection ? alertOf({ projection }) : null
  const counted = React.useMemo(() => (data && components ? data.items.filter((item) => components.includes(item.component)) : []), [data, components])

  const toggle = (component: CashForecastComponent, on: boolean) =>
    setComponents((current) => {
      const set = new Set(current ?? [])
      if (on) set.add(component)
      else set.delete(component)
      return CASH_FORECAST_COMPONENTS.filter((c) => set.has(c))
    })

  // Null until the user picks one: the saved horizon of the first answer.
  const shownHorizon = horizon ?? data?.horizonMonths ?? null
  const onSaved = (settings: CashForecastSettings) => setData((current) => (current ? { ...current, settings } : current))

  const exportHref = `/api/cash-forecast/export?${new URLSearchParams({
    companyId,
    horizon: String(shownHorizon ?? 6),
    granularity,
    components: (components ?? []).join(','),
  })}`

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title={FORECAST_TITLES[mode]}
        description={FORECAST_DESCRIPTIONS[mode]}
        actions={
          <>
            <Select value={shownHorizon === null ? undefined : String(shownHorizon)} onValueChange={(value) => setHorizon(Number(value))}>
              <SelectTrigger className="w-auto" aria-label={text.horizon}>
                <SelectValue placeholder={text.horizon} />
              </SelectTrigger>
              <SelectContent>
                {CASH_FORECAST_HORIZONS.map((months) => (
                  <SelectItem key={months} value={String(months)}>
                    {months} mois
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={granularity} onValueChange={(value) => setGranularity(value as ForecastGranularity)}>
              <SelectTrigger className="w-auto" aria-label={text.granularity}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="month">{text.months}</SelectItem>
                <SelectItem value="week">{text.weeks}</SelectItem>
              </SelectContent>
            </Select>
            {access.can({ reports: ['export'], banking: ['read'] }) && components ? (
              <Button variant="outline" asChild>
                <a href={exportHref} download>
                  <Download aria-hidden />
                  {text.export}
                </a>
              </Button>
            ) : null}
          </>
        }
      />

      <p className="text-muted-foreground flex items-start gap-2 text-sm">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
        {NOT_A_GUARANTEE[mode]}
      </p>

      {error ? (
        <EmptyState
          bordered
          title="La prévision ne s’est pas chargée"
          description={error}
          action={
            <Button size="sm" onClick={() => setVersion((n) => n + 1)}>
              Réessayer
            </Button>
          }
        />
      ) : !data || !projection || !components ? (
        <div className="space-y-4" aria-busy="true" aria-label="Chargement de la prévision">
          <div className="grid gap-4 sm:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-72 rounded-lg" />
        </div>
      ) : (
        <div className={cn('flex flex-col gap-6', loading && 'opacity-60')} aria-busy={loading}>
          {alert ? (
            <CashForecastAlertCard alert={alert} mode={mode} />
          ) : projection.thresholdCents !== null ? (
            <p className="text-success text-sm">{aboveThresholdSentence(projection.thresholdCents, projection.horizonMonths, mode, formatCents)}</p>
          ) : (
            <p className="text-muted-foreground text-sm">{text.noThreshold}</p>
          )}

          <section aria-label="Chiffres clés" className="grid gap-4 sm:grid-cols-3">
            <StatCard label={text.today} value={<Amount value={projection.openingCents / 100} />} hint={openingHint(data, mode)} />
            <StatCard
              label={text.end}
              value={<Amount value={projection.closingCents / 100} />}
              hint={<DateDisplay value={projection.end} format="long" />}
            />
            <StatCard
              label={text.lowest}
              value={<Amount value={projection.lowest.cents / 100} />}
              valueClassName={cn(projection.thresholdCents !== null && projection.lowest.cents < projection.thresholdCents && 'text-destructive')}
              hint={projection.lowest.day === data.today ? 'Aujourd’hui' : `Le ${dateInWords(projection.lowest.day)}`}
            />
          </section>

          <Card>
            <CardHeader>
              <CardTitle>
                <h2>{mode === 'simple' ? 'Votre compte dans le temps' : 'Solde projeté'}</h2>
              </CardTitle>
              <CardDescription>
                Du <DateDisplay value={projection.start} format="long" /> au <DateDisplay value={projection.end} format="long" />
              </CardDescription>
            </CardHeader>
            <CardContent className="px-2 sm:px-6">
              {counted.length === 0 ? (
                <EmptyState icon={LineChartIcon} title={text.empty} description={text.emptyHint} />
              ) : (
                <CashForecastChart projection={projection} mode={mode} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <h2>{text.components}</h2>
              </CardTitle>
              <CardDescription>{text.componentsHint}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="divide-y">
                {CASH_FORECAST_COMPONENTS.map((component) => {
                  const info = COMPONENT_INFO[component]
                  const totals = projection.totals[component]
                  const availability = data.availability[component]
                  const id = `component-${component}`
                  return (
                    <li key={component} className="flex flex-wrap items-start gap-3 py-3 first:pt-0 last:pb-0">
                      <Checkbox id={id} checked={components.includes(component)} onCheckedChange={(checked) => toggle(component, checked === true)} className="mt-0.5" />
                      <div className="min-w-0 flex-1 basis-64 space-y-1">
                        <Label htmlFor={id} className="flex flex-wrap items-center gap-2">
                          {componentLabel(component, mode)}
                          {info.assumption ? <StatusBadge tone="info">{text.assumption}</StatusBadge> : null}
                        </Label>
                        <p className="text-muted-foreground text-sm">{mode === 'simple' ? info.simpleDescription : info.description}</p>
                        {!availability.available ? <p className="text-muted-foreground text-sm italic">{mode === 'simple' ? info.simpleEmpty : (availability.reason ?? info.empty)}</p> : null}
                      </div>
                      {components.includes(component) && totals.count > 0 ? (
                        <div className="text-right text-sm">
                          {totals.inflowsCents !== 0 ? <Amount value={totals.inflowsCents / 100} sign="always" className="block" /> : null}
                          {totals.outflowsCents !== 0 ? <Amount value={totals.outflowsCents / 100} className="block" /> : null}
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
              {overlapsTrend(components) ? (
                <p role="status" className="text-warning text-sm">
                  {text.overlap}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <h2>{text.periods}</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{text.period}</TableHead>
                    <TableHead className="text-right">{text.opening}</TableHead>
                    <TableHead className="text-right">{text.inflows}</TableHead>
                    <TableHead className="text-right">{text.outflows}</TableHead>
                    <TableHead className="text-right">{text.closing}</TableHead>
                    <TableHead className="text-right">{text.lowest}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {projection.periods.map((p) => (
                    <TableRow key={p.period} data-below={p.belowThreshold || undefined} className={cn(p.belowThreshold && 'bg-destructive/5')}>
                      <TableCell>
                        {periodLabel(p, projection.granularity)}
                        {p.belowThreshold ? <span className="sr-only"> (sous le seuil)</span> : null}
                      </TableCell>
                      <TableCell className="text-right">
                        <Amount value={p.openingCents / 100} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Amount value={p.inflowsCents / 100} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Amount value={p.outflowsCents / 100} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Amount value={p.closingCents / 100} />
                      </TableCell>
                      <TableCell className={cn('text-right', p.belowThreshold && 'text-destructive')}>
                        <Amount value={p.lowestCents / 100} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <h2>{text.flows}</h2>
              </CardTitle>
              <CardDescription>{text.flowsHint}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {counted.length === 0 ? (
                <p className="text-muted-foreground text-sm">{text.empty}</p>
              ) : (
                <>
                  <ul className="divide-y">
                    {(showAll ? counted : counted.slice(0, FLOWS_SHOWN)).map((item, index) => (
                      <li key={`${item.component}-${item.day}-${index}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm">
                        <span className="text-muted-foreground w-36 shrink-0">
                          <DateDisplay value={item.day} />
                          {item.overdue ? <span className="text-warning block text-xs">{LATE_FLOW[mode]}</span> : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          {flowLabel(item, mode)}
                          <span className="text-muted-foreground block text-xs">{componentLabel(item.component, mode)}</span>
                        </span>
                        <Amount value={item.amountCents / 100} sign="always" />
                      </li>
                    ))}
                  </ul>
                  {!showAll && counted.length > FLOWS_SHOWN ? (
                    <Button variant="outline" size="sm" onClick={() => setShowAll(true)}>
                      Tout afficher ({counted.length})
                    </Button>
                  ) : null}
                </>
              )}
              {data.unknownTaxes.length > 0 ? (
                <div className="space-y-2 border-t pt-3">
                  <h3 className="text-sm font-medium">{text.unknownTaxes}</h3>
                  <p className="text-muted-foreground text-sm">{text.unknownTaxesHint}</p>
                  <ul className="text-sm">
                    {data.unknownTaxes.map((tax) => (
                      <li key={`${tax.ruleId}-${tax.day}`}>
                        <DateDisplay value={tax.day} /> {mode === 'simple' ? declarationTitle(tax.ruleId) : tax.label}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <CashForecastSettingsCard
            key={`${data.settings.thresholdCents}`}
            companyId={companyId}
            mode={mode}
            settings={data.settings}
            horizonMonths={data.horizonMonths}
            components={components}
            canEdit={access.can({ settings: ['update'] })}
            onSaved={onSaved}
          />
        </div>
      )}
    </div>
  )
}
