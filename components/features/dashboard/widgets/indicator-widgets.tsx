'use client'

import * as React from 'react'
import Link from 'next/link'

import { Skeleton } from '@/components/ui/skeleton'
import { HelpTip, StatCard, StatusBadge, formatAmount } from '@/components/shared'
import type { IndicatorsData } from '@/lib/dashboard/load-widget-data.service'
import type { FinancialIndicators } from '@/lib/reports/financial-indicators/indicators'
import { useWidgetSource } from '../dashboard-data'
import { KpiCents } from '../kpi-amount'
import { WidgetError } from '../widget-frame'
import type { WidgetProps } from './types'

interface KpiView {
  value: React.ReactNode
  hint?: React.ReactNode
  aside?: React.ReactNode
  valueClassName?: string
}

const money = (cents: number) => formatAmount(cents / 100)
const days = (value: number | null) => (value === null ? '-' : `${value} j`)

function KpiSkeleton() {
  return (
    <>
      <Skeleton className="h-7 w-36" />
      <Skeleton className="h-3 w-44" />
    </>
  )
}

/** A tile reading the financial indicators source (SIG, CAF, BFR, delays), with a link to the full page. */
function IndicatorKpi({
  widget,
  help,
  view,
}: WidgetProps & { help: React.ReactNode; view: (indicators: FinancialIndicators, data: IndicatorsData) => KpiView }) {
  const { state, retry, companyId } = useWidgetSource('indicators')
  const ready = state.status === 'ready' ? state.data : null
  const shown = ready?.fiscalYear && ready.indicators ? view(ready.indicators, ready) : null
  return (
    <StatCard
      labelAs="h2"
      label={widget.title}
      busy={state.status === 'loading'}
      aside={shown?.aside ?? help}
      value={
        state.status === 'loading' ? (
          <span className="sr-only">Chargement</span>
        ) : shown ? (
          shown.value
        ) : state.status === 'error' ? null : (
          <span className="text-muted-foreground text-base font-normal">Aucun exercice</span>
        )
      }
      valueClassName={shown?.valueClassName}
      hint={shown?.hint}
      className="h-full"
    >
      {state.status === 'loading' ? <KpiSkeleton /> : null}
      {state.status === 'error' ? <WidgetError compact message={state.message} onRetry={retry} /> : null}
      {shown ? (
        <Link href={`/${companyId}/reports/sig`} className="text-link self-start text-xs hover:underline">
          Soldes de gestion et ratios
        </Link>
      ) : null}
    </StatCard>
  )
}

export function EbeKpi(props: WidgetProps) {
  return (
    <IndicatorKpi
      {...props}
      help={
        <HelpTip term="Excédent brut d'exploitation">
          Valeur ajoutée, plus les subventions d&apos;exploitation, moins les impôts et taxes et les charges de personnel.
          C&apos;est ce que l&apos;activité dégage avant amortissements, frais financiers et impôt sur les bénéfices.
        </HelpTip>
      }
      view={(i) => ({
        value: <KpiCents cents={i.sig.ebeCents} />,
        valueClassName: i.sig.ebeCents < 0 ? 'text-destructive' : undefined,
        aside: i.sig.ebeCents < 0 ? <StatusBadge tone="danger">Insuffisance</StatusBadge> : undefined,
        hint: (
          <>
            Résultat d&apos;exploitation&nbsp;: <span className="num text-foreground font-medium">{money(i.sig.resultatExploitationCents)}</span>
          </>
        ),
      })}
    />
  )
}

export function CafKpi(props: WidgetProps) {
  return (
    <IndicatorKpi
      {...props}
      help={
        <HelpTip term="Capacité d'autofinancement">
          Résultat de l&apos;exercice, plus les dotations et la valeur des actifs cédés, moins les reprises, les produits de
          cession et les subventions d&apos;investissement virées au résultat.
        </HelpTip>
      }
      view={(i) => ({
        value: <KpiCents cents={i.caf.cafCents} />,
        valueClassName: i.caf.cafCents < 0 ? 'text-destructive' : undefined,
        hint: (
          <>
            Résultat de l&apos;exercice&nbsp;: <span className="num text-foreground font-medium">{money(i.caf.resultatExerciceCents)}</span>
          </>
        ),
      })}
    />
  )
}

export function BfrKpi(props: WidgetProps) {
  return (
    <IndicatorKpi
      {...props}
      help={
        <HelpTip term="Besoin en fonds de roulement">
          Stocks, créances clients et autres créances d&apos;exploitation, moins dettes fournisseurs, fiscales et sociales.
          Positif, c&apos;est l&apos;argent que le cycle d&apos;exploitation immobilise&nbsp;; négatif, une ressource.
        </HelpTip>
      }
      view={(i) => ({
        value: <KpiCents cents={i.bilan.bfrCents} />,
        hint: (
          <>
            Trésorerie nette&nbsp;:{' '}
            <span className={i.bilan.tresorerieNetteCents < 0 ? 'num text-destructive font-medium' : 'num text-foreground font-medium'}>
              {money(i.bilan.tresorerieNetteCents)}
            </span>
          </>
        ),
      })}
    />
  )
}

export function DelaisPaiementKpi(props: WidgetProps) {
  return (
    <IndicatorKpi
      {...props}
      help={
        <HelpTip term="Délais de paiement">
          Créances clients rapportées au chiffre d&apos;affaires, dettes fournisseurs rapportées aux achats, TVA comprise des
          deux côtés, en jours de l&apos;exercice écoulés.
        </HelpTip>
      }
      view={(i) => ({
        value: (
          <>
            <span className="num">{days(i.delais.dsoDays)}</span>{' '}
            <span className="text-muted-foreground text-sm font-normal">clients</span>
          </>
        ),
        hint: (
          <>
            Fournisseurs&nbsp;: <span className="num text-foreground font-medium">{days(i.delais.dpoDays)}</span>
          </>
        ),
      })}
    />
  )
}
