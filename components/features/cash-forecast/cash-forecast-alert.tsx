'use client'

import * as React from 'react'
import Link from 'next/link'
import { CircleCheck, TrendingUp, TriangleAlert } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatAmount } from '@/components/shared'
import { useCompanyAccess } from '@/components/features/companies/company-access'
import { CASH_FORECAST_PERMISSION } from '@/lib/cash-forecast/permissions'
import {
  ALERT_ACTIONS,
  ALERT_TITLES,
  NOT_A_GUARANTEE,
  NO_THRESHOLD_SENTENCES,
  STATUS_ERRORS,
  STATUS_TITLES,
  aboveThresholdSentence,
  alertSentence,
  type ForecastMode,
} from '@/lib/cash-forecast/wording'
import type { CashForecastAlert } from '@/lib/cash-forecast/alert'
import type { CashForecastStatus } from '@/lib/cash-forecast/load-cash-forecast.service'
import { cn } from '@/lib/utils'

/** Cents as the UI shows them ("1 234,56 €" with narrow spaces). */
export const formatCents = (cents: number) => formatAmount(cents / 100)

/** Path of the forecast page of a company (id or slug). */
export const forecastPath = (companyRef: string) => `/${companyRef}/prevision-tresorerie`

/**
 * The threshold alert (docs/prevision-tresorerie.md): the projected balance
 * goes under the company's minimum within the horizon. Shown on the forecast
 * page, and by the status card of the dashboard and of the simple home.
 */
export function CashForecastAlertCard({ alert, mode, href, className }: { alert: CashForecastAlert; mode: ForecastMode; href?: string; className?: string }) {
  return (
    <Alert data-slot="cash-forecast-alert" className={cn('border-warning/50', className)}>
      <TriangleAlert aria-hidden className="text-warning" />
      <AlertTitle>{ALERT_TITLES[mode]}</AlertTitle>
      <AlertDescription>
        <p>{alertSentence(alert, mode, formatCents)}</p>
        <p>{NOT_A_GUARANTEE[mode]}</p>
        {href ? (
          <Button asChild size="sm" variant="outline" className="mt-1">
            <Link href={href}>{ALERT_ACTIONS[mode]}</Link>
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}

type StatusState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: CashForecastStatus }

/** Same height in every state, so the content below never moves when the status arrives. */
const SLOT = 'min-h-28'

/**
 * The cash forecast status of the dashboard and of the simple home: asked
 * with GET /api/cash-forecast/alert once the page is displayed, so the
 * projection never delays the page. A skeleton of the same height holds its
 * place meanwhile. Then the alert when the projection crosses the saved
 * threshold, a line saying it stays above, or (no threshold) an invitation
 * to look at the forecast and set one, unless `invite` is false (the
 * dashboard shows it only to who may set the threshold). Nothing for a
 * member who may not read the bank.
 */
export function CashForecastStatusCard({ companyId, mode, href, invite = true }: { companyId: string; mode: ForecastMode; href: string; invite?: boolean }) {
  const access = useCompanyAccess()
  const allowed = access.can(CASH_FORECAST_PERMISSION)
  const [state, setState] = React.useState<StatusState>({ status: 'loading' })

  React.useEffect(() => {
    if (!allowed) return
    let cancelled = false
    fetch(`/api/cash-forecast/alert?${new URLSearchParams({ companyId })}`)
      .then((response) => (response.ok ? (response.json() as Promise<CashForecastStatus>) : Promise.reject(new Error('status'))))
      .then(
        (data) => !cancelled && setState({ status: 'ready', data }),
        () => !cancelled && setState({ status: 'error' }),
      )
    return () => {
      cancelled = true
    }
  }, [companyId, allowed])

  if (!allowed) return null
  if (state.status === 'loading') {
    return <Skeleton className={cn(SLOT, 'w-full rounded-lg')} aria-busy="true" aria-label={`Chargement : ${STATUS_TITLES[mode]}`} />
  }
  if (state.status === 'ready' && state.data.alert) {
    return <CashForecastAlertCard alert={state.data.alert} mode={mode} href={href} className={SLOT} />
  }
  const above = state.status === 'ready' && state.data.thresholdCents !== null
  if (state.status === 'ready' && !above && !invite) return null
  const Icon = above ? CircleCheck : TrendingUp
  const sentence =
    state.status === 'error'
      ? STATUS_ERRORS[mode]
      : above
        ? aboveThresholdSentence(state.data.thresholdCents as number, state.data.horizonMonths, mode, formatCents)
        : NO_THRESHOLD_SENTENCES[mode]
  return (
    <Alert data-slot="cash-forecast-status" role="region" aria-label={STATUS_TITLES[mode]} className={SLOT}>
      <Icon aria-hidden className={cn(above && 'text-success')} />
      <AlertTitle>{STATUS_TITLES[mode]}</AlertTitle>
      <AlertDescription>
        <p>{sentence}</p>
        <Button asChild size="sm" variant="outline" className="mt-1">
          <Link href={href}>{ALERT_ACTIONS[mode]}</Link>
        </Button>
      </AlertDescription>
    </Alert>
  )
}
