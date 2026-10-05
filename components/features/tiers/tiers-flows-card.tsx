'use client'

import * as React from 'react'
import { Waypoints } from 'lucide-react'
import { ResponsiveContainer, Sankey, Tooltip } from 'recharts'

import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState } from '@/components/shared'
import { FlowLegend, FlowLinkPath, FlowNodeShape, FlowTooltipShell, type SankeyLinkProps, type SankeyNodeProps } from '@/components/shared/flow-sankey'
import { FiscalYearSelector } from '@/components/features/accounting/fiscal-year-selector'
import { responseError } from '@/hooks/use-cursor-list'
import type { TiersFlowsReport } from '@/lib/reports/third-parties/get-third-party-reports.service'
import { shareOf, tiersFlowDiagram, type TiersFlowNode, type TiersFlowSide } from '@/lib/reports/third-parties/tiers-flows'
import { formatCentsFr } from '@/lib/utils/money'
import { plural } from '@/lib/utils/plural'

/**
 * Clients et fournisseurs de l'exercice, on the Tiers page
 * (docs/factures-et-tiers.md#flux-de-lexercice): a flow diagram of a fiscal
 * year with the customers on the left flowing into the company, and the
 * company flowing out to its suppliers on the right; the thickness is the
 * amount billed (GET /api/reports/tiers-flows, rule in
 * lib/reports/third-parties/tiers-flows.ts). Customers and suppliers each
 * have their colour (--chart-flow-customer, --chart-flow-supplier), the
 * company is neutral; the legend names both colours and "Lire les flux en
 * texte" gives every figure as tables.
 */

const COLORS = { customer: 'var(--chart-flow-customer)', supplier: 'var(--chart-flow-supplier)' } as const

const LEGEND = [
  { key: 'customer', label: 'Clients', color: COLORS.customer },
  { key: 'supplier', label: 'Fournisseurs', color: COLORS.supplier },
]

const percent = (share: number) => `${share.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`

type LinkProps = SankeyLinkProps<{ role: 'customer' | 'supplier' }>
type NodeProps = SankeyNodeProps<TiersFlowNode>

function FlowLink({ payload, ...props }: LinkProps) {
  return <FlowLinkPath {...props} color={COLORS[payload.role]} kind={payload.role} />
}

function FlowNode({ payload, ...props }: NodeProps) {
  if (payload.role === 'company') return <FlowNodeShape {...props} name={payload.name} label="top" />
  return <FlowNodeShape {...props} name={payload.name} label={payload.role === 'customer' ? 'start' : 'end'} fill={COLORS[payload.role]} />
}

interface TooltipItem {
  source?: TiersFlowNode
  target?: TiersFlowNode
  role?: TiersFlowNode['role']
  name?: string
  cents?: number
  share?: number
}

function FlowTooltip({ active, payload, report }: { active?: boolean; payload?: Array<{ payload: TooltipItem }>; report: TiersFlowsReport }) {
  const item = payload?.[0]?.payload
  if (!active || !item) return null
  if (item.role === 'company') {
    return (
      <FlowTooltipShell>
        <p className="font-medium">{item.name}</p>
        <p>Facturé aux clients&nbsp;: {formatCentsFr(report.customers.totalCents)}</p>
        <p>Facturé par les fournisseurs&nbsp;: {formatCentsFr(report.suppliers.totalCents)}</p>
      </FlowTooltipShell>
    )
  }
  const customer = item.role === 'customer'
  const name = item.source && item.target ? (customer ? item.source.name : item.target.name) : item.name
  return (
    <FlowTooltipShell>
      <p className="font-medium">{name}</p>
      <p className="num">{formatCentsFr(item.cents ?? 0)} TTC</p>
      <p className="text-muted-foreground">
        {percent(item.share ?? 0)} {customer ? 'du facturé aux clients' : 'du facturé par les fournisseurs'}
      </p>
    </FlowTooltipShell>
  )
}

export function TiersFlowsChart({ report }: { report: TiersFlowsReport }) {
  const diagram = React.useMemo(() => tiersFlowDiagram(report, report.company.name), [report])
  const height = Math.max(240, Math.max(report.customers.shown.length, report.suppliers.shown.length) * 48)
  const label =
    `Diagramme des flux de l'exercice ${report.fiscalYear.year} : ${formatCentsFr(report.customers.totalCents)} facturés à ${plural(report.customers.tiers.length, 'client', 'clients')}, ` +
    `${formatCentsFr(report.suppliers.totalCents)} facturés par ${plural(report.suppliers.tiers.length, 'fournisseur', 'fournisseurs')}. Les montants sont détaillés dans « Lire les flux en texte ».`
  return (
    <div className="space-y-3">
      <div style={{ height }} className="w-full" role="img" aria-label={label}>
        <ResponsiveContainer width="100%" height="100%">
          <Sankey
            data={diagram}
            nodeWidth={10}
            nodePadding={24}
            margin={{ left: 8, right: 8, top: 24, bottom: 8 }}
            node={(props: NodeProps) => <FlowNode {...props} />}
            link={(props: LinkProps) => <FlowLink {...props} />}
          >
            <Tooltip content={<FlowTooltip report={report} />} />
          </Sankey>
        </ResponsiveContainer>
      </div>
      <FlowLegend items={LEGEND} label="Légende des flux avec les tiers" />
    </div>
  )
}

function SideTable({ side, title, tiersLabel }: { side: TiersFlowSide; title: string; tiersLabel: string }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">{title}</h3>
      {side.tiers.length === 0 ? (
        <p className="text-muted-foreground text-sm">Rien de facturé sur l&apos;exercice.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tiersLabel}</TableHead>
                <TableHead numeric>Montant TTC</TableHead>
                <TableHead numeric>Part</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {side.tiers.map((t) => (
                <TableRow key={t.code}>
                  <TableCell>{t.name}</TableCell>
                  <TableCell numeric>{formatCentsFr(t.cents)}</TableCell>
                  <TableCell numeric>{percent(shareOf(t.cents, side.totalCents))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>Total</TableCell>
                <TableCell numeric>{formatCentsFr(side.totalCents)}</TableCell>
                <TableCell numeric>{percent(100)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}
    </div>
  )
}

export function TiersFlowsText({ report }: { report: TiersFlowsReport }) {
  return (
    <details className="text-sm">
      <summary className="text-link cursor-pointer">Lire les flux en texte</summary>
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <SideTable side={report.customers} title="Facturé aux clients" tiersLabel="Client" />
        <SideTable side={report.suppliers} title="Facturé par les fournisseurs" tiersLabel="Fournisseur" />
      </div>
    </details>
  )
}

export function TiersFlowsCard({ companyId }: { companyId: string }) {
  const [fiscalYearId, setFiscalYearId] = React.useState<string>()
  const [report, setReport] = React.useState<TiersFlowsReport | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [version, setVersion] = React.useState(0)
  // The year the server chose when none was asked: already loaded, not fetched again.
  const loadedYear = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (fiscalYearId && loadedYear.current === fiscalYearId) {
      loadedYear.current = null
      return
    }
    let cancelled = false
    setLoading(true)
    const query = new URLSearchParams({ companyId, ...(fiscalYearId ? { fiscalYearId } : {}) })
    fetch(`/api/reports/tiers-flows?${query}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response, 'Les flux avec vos clients et fournisseurs ne se sont pas chargés. Réessayez.'))
        return (await response.json()) as TiersFlowsReport
      })
      .then((result) => {
        if (cancelled) return
        setReport(result)
        setError(null)
        if (!fiscalYearId) {
          loadedYear.current = result.fiscalYear.id
          setFiscalYearId(result.fiscalYear.id)
        }
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [companyId, fiscalYearId, version])

  const empty = report !== null && report.customers.tiers.length === 0 && report.suppliers.tiers.length === 0

  return (
    <Card aria-busy={loading || undefined}>
      <CardHeader>
        <CardTitle>
          <h2>Clients et fournisseurs de l&apos;exercice</h2>
        </CardTitle>
        <CardDescription>
          Qui vous a apporté de l&apos;argent et où il est allé&nbsp;: montants TTC facturés sur l&apos;exercice, avoirs déduits, écritures validées seulement.
        </CardDescription>
        <CardAction className="w-44 space-y-1">
          <Label htmlFor="tiers-flows-fiscal-year" className="sr-only">
            Exercice
          </Label>
          <FiscalYearSelector companyId={companyId} value={fiscalYearId} onValueChange={setFiscalYearId} showLabel={false} showPeriod={false} id="tiers-flows-fiscal-year" />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4 px-2 sm:px-5">
        {error ? (
          <div role="alert" className="flex flex-col items-start gap-3 px-3 sm:px-0">
            <p className="text-sm">{error}</p>
            <Button size="sm" variant="outline" onClick={() => setVersion((v) => v + 1)}>
              Réessayer
            </Button>
          </div>
        ) : !report ? (
          <Skeleton className="h-60 w-full" />
        ) : empty ? (
          <EmptyState
            icon={Waypoints}
            title="Rien de facturé sur cet exercice"
            description="Les factures de vente et d'achat validées de l'exercice, et leurs avoirs, dessineront ici qui vous paie et qui vous payez."
          />
        ) : (
          <>
            <TiersFlowsChart report={report} />
            <TiersFlowsText report={report} />
          </>
        )}
      </CardContent>
    </Card>
  )
}
