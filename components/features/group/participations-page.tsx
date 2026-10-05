'use client'

import { Lock } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableSkeleton } from '@/components/ui/table'
import { Amount, PageHeader, formatDisplayDate } from '@/components/shared'
import { cn } from '@/lib/utils'
import { PARTICIPATION_KIND_LABELS } from '@/lib/group/labels'
import type { ParticipationsReport } from '@/lib/group/get-participations.service'
import { ExportButtons, GroupFiscalYear, LoadError, ownership, useGroupReport, useReportUrl } from './space'

const cents = (value: number | null | undefined, signed = false) =>
  value === null || value === undefined ? <span className="text-muted-foreground">-</span> : <Amount value={value / 100} className={cn(signed && value < 0 && 'text-destructive')} />

/** Participations of the group space: the tableau des filiales et participations (2059-G-SD, 2033-G-SD). */
export function GroupParticipationsPage() {
  const url = useReportUrl('participations')
  const report = useGroupReport<ParticipationsReport>(url, "Les participations ne se sont pas chargées. Réessayez dans un instant.")
  return (
    <div className="space-y-6">
      <PageHeader
        title="Participations"
        description="Les titres détenus par la holding et les chiffres de chaque filiale, pour le tableau des filiales et participations."
        actions={<ExportButtons report="participations" disabled={!report.data} />}
      />
      <GroupFiscalYear />
      {report.error ? <LoadError message={report.error} onRetry={report.retry} /> : <ParticipationsTab report={report.data} loading={report.loading || !report.data} />}
    </div>
  )
}

function ParticipationsTab({ report, loading }: { report: ParticipationsReport | null; loading: boolean }) {
  return (
    <Card aria-busy={loading || undefined}>
      <CardHeader>
        <CardTitle>
          <h2>Filiales et participations</h2>
        </CardTitle>
        <CardDescription>
          Les titres détenus par la holding (261, nets de la dépréciation 2961) et les chiffres de chaque filiale, pour le tableau des filiales et participations (formulaires 2059-G-SD ou
          2033-G-SD, annexe). Plus de 50&nbsp;% du capital&nbsp;: filiale&nbsp;; de 10 à 50&nbsp;%&nbsp;: participation (Code de commerce, art. L233-1 et L233-2).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-40">Société</TableHead>
                <TableHead className="hidden md:table-cell">Catégorie</TableHead>
                <TableHead numeric>Détention</TableHead>
                <TableHead numeric>Valeur nette des titres</TableHead>
                <TableHead numeric className="hidden lg:table-cell">
                  Capitaux propres
                </TableHead>
                <TableHead numeric className="hidden sm:table-cell">
                  Quote-part
                </TableHead>
                <TableHead numeric className="hidden lg:table-cell">
                  Résultat
                </TableHead>
                <TableHead numeric className="hidden lg:table-cell">
                  Prêts et avances
                </TableHead>
                <TableHead numeric className="hidden md:table-cell">
                  Dividendes
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && !report ? (
                <TableSkeleton columns={9} />
              ) : report && report.rows.length === 0 && report.unreachable.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-muted-foreground whitespace-normal">
                    Aucune filiale lisible pour cet exercice.
                  </TableCell>
                </TableRow>
              ) : report ? (
                <>
                  {report.rows.map((r) => (
                    <TableRow key={r.subsidiaryId}>
                      <TableCell className="whitespace-normal">
                        <span className="block font-medium">{r.name}</span>
                        <span className="text-muted-foreground block text-xs">
                          {r.siren ? <span className="font-mono">{r.siren}</span> : null}
                          {r.fiscalYear && !r.samePeriod ? ` Exercice du ${formatDisplayDate(r.fiscalYear.startDate)} au ${formatDisplayDate(r.fiscalYear.endDate)}` : null}
                        </span>
                      </TableCell>
                      <TableCell className="hidden whitespace-normal md:table-cell">{PARTICIPATION_KIND_LABELS[r.kind]}</TableCell>
                      <TableCell numeric>{ownership(r.ownershipBp)}</TableCell>
                      <TableCell numeric>{cents(r.bookValueNetCents)}</TableCell>
                      <TableCell numeric className="hidden lg:table-cell">
                        {cents(r.capitauxPropresCents, true)}
                      </TableCell>
                      <TableCell numeric className="hidden sm:table-cell">
                        {cents(r.quotePartCents, true)}
                      </TableCell>
                      <TableCell numeric className="hidden lg:table-cell">
                        {cents(r.resultatCents, true)}
                      </TableCell>
                      <TableCell numeric className="hidden lg:table-cell">
                        {cents(r.loansCents)}
                      </TableCell>
                      <TableCell numeric className="hidden md:table-cell">
                        {cents(r.dividendsCents)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {report.unreachable.map((u, i) => (
                    <TableRow key={`unreachable-${i}`}>
                      <TableCell colSpan={9} className="text-muted-foreground whitespace-normal">
                        <span className="inline-flex items-start gap-2">
                          <Lock aria-hidden className="mt-0.5 size-4 shrink-0" />
                          {u.name ? `${u.name} : votre rôle ne permet pas de lire ses états.` : 'Filiale non accessible avec votre compte.'}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/50 font-semibold">
                    <TableCell>Total</TableCell>
                    <TableCell className="hidden md:table-cell" />
                    <TableCell />
                    <TableCell numeric>{cents(report.totals.bookValueNetCents)}</TableCell>
                    <TableCell className="hidden lg:table-cell" />
                    <TableCell className="hidden sm:table-cell" />
                    <TableCell className="hidden lg:table-cell" />
                    <TableCell className="hidden lg:table-cell" />
                    <TableCell numeric className="hidden md:table-cell">
                      {cents(report.totals.dividendsCents)}
                    </TableCell>
                  </TableRow>
                </>
              ) : null}
            </TableBody>
          </Table>
        </div>
        {report && report.unattributed.length > 0 ? (
          <div className="space-y-2 text-sm">
            <p>
              Titres non rattachés à une filiale&nbsp;: le libellé du compte ne nomme aucune filiale lisible. Renommez le sous-compte (ex. « Titres Filiale Nord ») pour le rattacher.
            </p>
            <ul className="space-y-1">
              {report.unattributed.map((u) => (
                <li key={u.accountCode} className="flex justify-between gap-4">
                  <span>
                    <span className="font-mono text-xs">{u.accountCode}</span> {u.label}
                  </span>
                  <Amount value={u.cents / 100} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
