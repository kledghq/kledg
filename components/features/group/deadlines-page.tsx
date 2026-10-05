'use client'

import * as React from 'react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableSkeleton } from '@/components/ui/table'
import { DateDisplay, PageHeader, StatCard, StatusBadge, type StatusTone } from '@/components/shared'
import { DEADLINE_COLUMNS, DEADLINE_COLUMN_LABELS, type ColumnSummary } from '@/lib/group/deadline-summary'
import type { DeclarationStatusCode } from '@/lib/declarations/status'
import type { GroupDeadlinesReport } from '@/lib/group/get-group-deadlines.service'
import { Cents, CompanyLink, ExportButtons, GroupFiscalYear, LoadError, PerimeterNotes, useGroupReport, useReportUrl } from './space'

const STATUS_TONES: Record<DeclarationStatusCode, StatusTone> = { todo: 'neutral', filed: 'info', paid: 'success', overdue: 'danger', 'not-due': 'neutral' }

function SummaryCell({ summary }: { summary: ColumnSummary }) {
  if (summary.status === null) return <span className="text-muted-foreground">-</span>
  const tone: StatusTone = summary.status === 'overdue' ? 'danger' : summary.status === 'pending' ? 'warning' : 'success'
  const label = summary.status === 'overdue' ? `${summary.overdue} en retard` : summary.status === 'pending' ? `${summary.pending} à faire` : 'À jour'
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <StatusBadge tone={tone}>{label}</StatusBadge>
      <span className="text-muted-foreground text-xs">
        {summary.settled}/{summary.total} réglées
      </span>
    </span>
  )
}

/** Impôts et échéances of the group space: the tracker of every company, by kind, then the list. */
export function GroupDeadlinesPage() {
  const report = useGroupReport<GroupDeadlinesReport>(useReportUrl('deadlines'), "Les échéances du groupe ne se sont pas chargées. Réessayez dans un instant.")
  const data = report.data
  const [filter, setFilter] = React.useState<'open' | 'all' | 'overdue'>('open')
  const names = new Map((data?.companies ?? []).map((c) => [c.company.id, c.company]))
  const rows = (data?.deadlines ?? []).filter((d) => (filter === 'all' ? true : filter === 'overdue' ? !d.settled && d.status === 'overdue' : !d.settled))
  return (
    <div className="space-y-6">
      <PageHeader
        title="Impôts et échéances"
        description="Les déclarations de chaque société du groupe et leur suivi : TVA, impôt sur les sociétés, CFE et approbation des comptes. Le suivi se met à jour sur la page Échéances de chaque société."
        actions={<ExportButtons report="deadlines" disabled={!data} />}
      />
      <GroupFiscalYear />
      {report.error ? (
        <LoadError message={report.error} onRetry={report.retry} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3" aria-busy={report.loading || undefined}>
            <StatCard label="En retard" value={data ? data.totals.overdue : '-'} valueClassName={data && data.totals.overdue > 0 ? 'text-destructive' : undefined} busy={report.loading} />
            <StatCard label="À faire" value={data ? data.totals.pending : '-'} busy={report.loading} />
            <StatCard label="Réglées ou non dues" value={data ? data.totals.settled : '-'} busy={report.loading} />
          </div>
          {data ? <PerimeterNotes warnings={data.warnings} unreachable={data.unreachable} /> : null}
          <Card aria-busy={report.loading || undefined}>
            <CardHeader>
              <CardTitle>
                <h2>Par société</h2>
              </CardTitle>
              <CardDescription>Pour l&apos;exercice de chaque société qui correspond à celui de la holding.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Société</TableHead>
                      {DEADLINE_COLUMNS.map((c) => (
                        <TableHead key={c} className="min-w-36 whitespace-normal">
                          {DEADLINE_COLUMN_LABELS[c]}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!data ? (
                      <TableSkeleton columns={6} />
                    ) : (
                      data.companies.map((c) => (
                        <TableRow key={c.company.id}>
                          <TableCell className="whitespace-normal">
                            <CompanyLink company={c.company} to="/echeances" />
                            {c.fiscalYear ? <span className="text-muted-foreground block text-xs">Exercice {c.fiscalYear.year}</span> : null}
                          </TableCell>
                          {DEADLINE_COLUMNS.map((col) => (
                            <TableCell key={col}>
                              <SummaryCell summary={c.summary[col]} />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
          <Card aria-busy={report.loading || undefined}>
            <CardHeader className="flex flex-wrap items-end justify-between gap-3">
              <CardTitle>
                <h2>Échéances</h2>
              </CardTitle>
              <div className="flex items-center gap-2">
                <Label htmlFor="deadline-filter" className="text-sm">
                  Afficher
                </Label>
                <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
                  <SelectTrigger id="deadline-filter" size="sm" className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">À faire et en retard</SelectItem>
                    <SelectItem value="overdue">En retard</SelectItem>
                    <SelectItem value="all">Toutes</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Société</TableHead>
                      <TableHead>Échéance</TableHead>
                      <TableHead className="hidden md:table-cell">Formulaire</TableHead>
                      <TableHead numeric className="hidden lg:table-cell">
                        Montant
                      </TableHead>
                      <TableHead>Statut</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!data ? (
                      <TableSkeleton columns={6} />
                    ) : rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-muted-foreground whitespace-normal">
                          Aucune échéance à afficher pour ce filtre.
                        </TableCell>
                      </TableRow>
                    ) : (
                      rows.map((d) => {
                        const company = names.get(d.companyId)
                        return (
                          <TableRow key={`${d.companyId}-${d.id}`}>
                            <TableCell>
                              <DateDisplay value={d.date} />
                              {d.estimated ? <span className="text-muted-foreground block text-xs">Indicative</span> : null}
                            </TableCell>
                            <TableCell className="whitespace-normal">{company ? <CompanyLink company={company} to="/echeances" /> : null}</TableCell>
                            <TableCell className="whitespace-normal">{d.label}</TableCell>
                            <TableCell className="hidden md:table-cell">{d.form}</TableCell>
                            <TableCell numeric className="hidden lg:table-cell">
                              <Cents value={d.amountCents} />
                            </TableCell>
                            <TableCell>
                              <StatusBadge tone={STATUS_TONES[d.status]}>{d.statusLabel}</StatusBadge>
                            </TableCell>
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
