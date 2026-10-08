'use client'

import * as React from 'react'
import { ResponsiveContainer, Sankey, Tooltip } from 'recharts'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableSkeleton } from '@/components/ui/table'
import { formatAmount, StatusBadge } from '@/components/shared'
import { FlowLegend, FlowLinkPath, FlowNodeShape, FlowTooltipShell, type SankeyLinkProps, type SankeyNodeProps } from '@/components/shared/flow-sankey'
import { flowDiagram, moneyFlows, MONEY_FLOW_LABELS, type MoneyFlow } from '@/lib/group/flows'
import type { GroupView } from '@/lib/group/get-group-view.service'
import { Cents, ExportButtons, LoadError, Notice, PerimeterNotes, SectionIntro, useGroupReport, useReportUrl } from './space'

/**
 * Flux entre sociétés of the Trésorerie view (docs/vue-groupe.md): the
 * money that went from one company of the group to another (management
 * fees, invoices, dividends over the year; loans, advances and unpaid
 * invoices at its end), as a flow diagram and as a table, from the flows
 * the vue combinée found (lib/group/flows.ts). Each kind of flow has its
 * own colour (--chart-flow-*), named in the legend; the tooltip and the
 * table also write the kind, so colour is never the only way to read it.
 * The node, link, tooltip and legend are shared with the Tiers page
 * (components/shared/flow-sankey.tsx).
 */

const FLOW_COLORS: Record<MoneyFlow['kind'], string> = {
  dividend: 'var(--chart-flow-dividend)',
  management_fee: 'var(--chart-flow-management-fee)',
  invoice: 'var(--chart-flow-invoice)',
  loan: 'var(--chart-flow-loan)',
  current_account: 'var(--chart-flow-current-account)',
  trade: 'var(--chart-flow-trade)',
}

type LinkProps = SankeyLinkProps<{ kind?: MoneyFlow['kind'] }>

function FlowLink({ payload, ...props }: LinkProps) {
  return <FlowLinkPath {...props} color={payload.kind ? FLOW_COLORS[payload.kind] : 'var(--chart-breakdown)'} kind={payload.kind} />
}

function GroupFlowLegend({ flows }: { flows: readonly MoneyFlow[] }) {
  const kinds = (Object.keys(MONEY_FLOW_LABELS) as MoneyFlow['kind'][]).filter((kind) => flows.some((f) => f.kind === kind))
  return <FlowLegend items={kinds.map((kind) => ({ key: kind, label: MONEY_FLOW_LABELS[kind], color: FLOW_COLORS[kind] }))} />
}

type NodeProps = SankeyNodeProps<{ name: string; side: 'from' | 'to' }>

function FlowNode({ payload, ...props }: NodeProps) {
  return <FlowNodeShape {...props} name={payload.name} label={payload.side === 'from' ? 'start' : 'end'} />
}

function FlowTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { source?: { name: string }; target?: { name: string }; value?: number; kind?: MoneyFlow['kind']; name?: string } }> }) {
  const item = payload?.[0]?.payload
  if (!active || !item) return null
  return (
    <FlowTooltipShell>
      {item.source && item.target ? (
        <>
          <p className="font-medium">
            {item.source.name} vers {item.target.name}
          </p>
          <p className="text-muted-foreground">{item.kind ? MONEY_FLOW_LABELS[item.kind] : null}</p>
        </>
      ) : (
        <p className="font-medium">{item.name}</p>
      )}
      <p className="num">{formatAmount(item.value ?? 0)}</p>
    </FlowTooltipShell>
  )
}

function FlowChart({ flows, names }: { flows: readonly MoneyFlow[]; names: ReadonlyMap<string, string> }) {
  const data = React.useMemo(() => flowDiagram(flows, names), [flows, names])
  if (data.links.length === 0) return <p className="text-muted-foreground text-sm">Aucun flux entre les sociétés lues sur cet exercice.</p>
  const height = Math.max(220, Math.max(data.nodes.filter((n) => n.side === 'from').length, data.nodes.filter((n) => n.side === 'to').length) * 64)
  return (
    <div className="space-y-3">
      <div style={{ height }} className="w-full" role="img" aria-label="Diagramme des flux entre les sociétés du groupe, détaillés dans le tableau ci-dessous">
        <ResponsiveContainer width="100%" height="100%">
          <Sankey
            data={data}
            nodeWidth={10}
            nodePadding={28}
            margin={{ left: 8, right: 8, top: 8, bottom: 8 }}
            node={(props: NodeProps) => <FlowNode {...props} />}
            link={(props: LinkProps) => <FlowLink {...props} />}
          >
            <Tooltip content={<FlowTooltip />} />
          </Sankey>
        </ResponsiveContainer>
      </div>
      <GroupFlowLegend flows={flows} />
    </div>
  )
}

export function GroupFlowsSection() {
  const report = useGroupReport<GroupView>(useReportUrl('view'), 'Les flux du groupe ne se sont pas chargés. Réessayez dans un instant.')
  const data = report.data
  const names = React.useMemo(() => new Map((data?.members ?? []).map((m) => [m.id, m.name])), [data])
  const flows = React.useMemo(() => (data ? moneyFlows(data.eliminations) : []), [data])
  const period = flows.filter((f) => f.nature === 'period')
  const balances = flows.filter((f) => f.nature === 'balance')
  if (report.error) return <LoadError message={report.error} onRetry={report.retry} />
  return (
    <>
      <SectionIntro
        description="L'argent qui passe d'une société du groupe à une autre : frais de gestion, factures et dividendes de l'exercice, prêts, avances et factures à régler en fin d'exercice."
        actions={<ExportButtons report="combined" disabled={!data} />}
      />
      <Notice>Flux trouvés dans les livres des sociétés lues, selon les règles de la vue combinée. Un flux avec une société non lue n&apos;apparaît pas.</Notice>
      {data ? <PerimeterNotes warnings={data.warnings.filter((w) => !w.includes('titres de participation'))} unreachable={data.unreachable} /> : null}
      <Card aria-busy={report.loading || undefined}>
        <CardHeader>
          <CardTitle>
            <h2>Flux de l&apos;exercice</h2>
          </CardTitle>
          <CardDescription>À gauche la société qui paie, à droite celle qui reçoit&nbsp;; l&apos;épaisseur suit le montant.</CardDescription>
        </CardHeader>
        <CardContent className="px-2 sm:px-5">{data ? <FlowChart flows={period} names={names} /> : <Skeleton className="h-56 w-full" />}</CardContent>
      </Card>
      <FlowsTable title="Détail des flux de l'exercice" flows={period} names={names} loading={!data} />
      <Card aria-busy={report.loading || undefined}>
        <CardHeader>
          <CardTitle>
            <h2>Qui doit quoi à qui</h2>
          </CardTitle>
          <CardDescription>Prêts, avances en compte courant et factures non réglées entre sociétés du groupe en fin d&apos;exercice, dans le sens de l&apos;argent prêté.</CardDescription>
        </CardHeader>
        <CardContent className="px-2 sm:px-5">{data ? <FlowChart flows={balances} names={names} /> : <Skeleton className="h-56 w-full" />}</CardContent>
      </Card>
      <FlowsTable title="Soldes entre sociétés" flows={balances} names={names} loading={!data} />
    </>
  )
}

function FlowsTable({ title, flows, names, loading }: { title: string; flows: readonly MoneyFlow[]; names: ReadonlyMap<string, string>; loading: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{title}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>De</TableHead>
                <TableHead>Vers</TableHead>
                <TableHead>Nature</TableHead>
                <TableHead numeric>Montant</TableHead>
                <TableHead numeric>Écart entre les livres</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableSkeleton columns={5} />
              ) : flows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    Aucun flux trouvé.
                  </TableCell>
                </TableRow>
              ) : (
                flows.map((f, i) => (
                  <TableRow key={`${f.fromId}-${f.toId}-${f.kind}-${i}`}>
                    <TableCell>{names.get(f.fromId) ?? 'Société du groupe'}</TableCell>
                    <TableCell>{names.get(f.toId) ?? 'Société du groupe'}</TableCell>
                    <TableCell>{MONEY_FLOW_LABELS[f.kind]}</TableCell>
                    <TableCell numeric>
                      <Cents value={f.cents} />
                    </TableCell>
                    <TableCell numeric>{f.gapCents === 0 ? <StatusBadge tone="success">Concordant</StatusBadge> : <Cents value={f.gapCents} signed />}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
