'use client'

import * as React from 'react'
import Link from 'next/link'
import { TriangleAlert } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { formatAmount } from '@/components/shared'
import { useCompanyAccess } from '@/components/features/companies/company-access'
import { CASH_FORECAST_PERMISSION } from '@/lib/cash-forecast/permissions'
import { ALERT_ACTIONS, ALERT_TITLES, NOT_A_GUARANTEE, alertSentence, type ForecastMode } from '@/lib/cash-forecast/wording'
import type { CashForecastAlert } from '@/lib/cash-forecast/alert'

/** Cents as the UI shows them ("1 234,56 €" with narrow spaces). */
export const formatCents = (cents: number) => formatAmount(cents / 100)

/** Path of the forecast page of a company (id or slug). */
export const forecastPath = (companyRef: string) => `/${companyRef}/prevision-tresorerie`

/**
 * The threshold alert (docs/prevision-tresorerie.md): the projected balance
 * goes under the company's minimum within the horizon. Shown on the
 * dashboard, the simple home and the forecast page itself (without link).
 */
export function CashForecastAlertCard({ alert, mode, href }: { alert: CashForecastAlert; mode: ForecastMode; href?: string }) {
  return (
    <Alert data-slot="cash-forecast-alert" className="border-warning/50">
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

/**
 * The dashboard's card: asks GET /api/cash-forecast/alert once and renders
 * only when the projection crosses the saved threshold. Nothing while it
 * loads, on error, or for a member who may not read the forecast: an alert
 * that cannot be shown is not a dashboard error.
 */
export function DashboardCashForecastAlert({ companyId }: { companyId: string }) {
  const access = useCompanyAccess()
  const allowed = access.can(CASH_FORECAST_PERMISSION)
  const [alert, setAlert] = React.useState<CashForecastAlert | null>(null)

  React.useEffect(() => {
    if (!allowed) return
    let cancelled = false
    fetch(`/api/cash-forecast/alert?${new URLSearchParams({ companyId })}`)
      .then((response) => (response.ok ? (response.json() as Promise<{ alert: CashForecastAlert | null }>) : { alert: null }))
      .catch(() => ({ alert: null }))
      .then((body) => {
        if (!cancelled) setAlert(body.alert)
      })
    return () => {
      cancelled = true
    }
  }, [companyId, allowed])

  if (!allowed || !alert) return null
  return <CashForecastAlertCard alert={alert} mode="expert" href={forecastPath(companyId)} />
}
