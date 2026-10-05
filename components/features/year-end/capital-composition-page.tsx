'use client'

import * as React from 'react'
import Link from 'next/link'
import { PieChart, Printer } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Amount, EmptyState, HelpTip, PageHeader, PersonAvatar, StatCard, StatusBadge, formatDisplayDate } from '@/components/shared'
import { FiscalYearSelector } from '@/components/features/accounting/fiscal-year-selector'
import { docsUrl } from '@/lib/docs-links'
import { plural } from '@/lib/utils/plural'
import type { CapitalCompositionReport } from '@/lib/reports/capital-composition/get-capital-composition.service'
import { euros, useJson } from './shared'

/** Hundredths of a percent as "33,33 %". */
const percent = (hundredths: number | null) =>
  hundredths === null ? '-' : `${(hundredths / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`

/**
 * Capital composition (répartition du capital): who holds the shares, for
 * the annexe, the general meeting and forms 2033-F or 2059-F. Names only:
 * birth data and addresses stay on the shareholder's record.
 */
export function CapitalCompositionPage({ companyId }: { companyId: string }) {
  const [fiscalYearId, setFiscalYearId] = React.useState('')
  const url = fiscalYearId ? `/api/reports/capital-composition?${new URLSearchParams({ companyId, fiscalYearId })}` : null
  const { data, error, reload } = useJson<CapitalCompositionReport>(url, "La composition du capital ne s'est pas chargée. Réessayez dans un instant.")
  const sharesLabel = data?.shareKind === 'actions' ? 'Actions' : 'Parts sociales'

  return (
    <div className="space-y-6">
      <PageHeader
        title="Composition du capital"
        description="La répartition du capital entre les associés, avec le nombre de titres, les pourcentages et la valeur nominale, pour l'annexe, l'assemblée générale et la liasse fiscale."
        docsHref={docsUrl('equity')}
        actions={
          data ? (
            <Button variant="outline" onClick={() => window.print()}>
              <Printer aria-hidden />
              Imprimer
            </Button>
          ) : null
        }
      />
      <FiscalYearSelector id="capital-fiscal-year" companyId={companyId} value={fiscalYearId} onValueChange={setFiscalYearId} showLabel={false} showPeriod={false} className="w-48" />

      {error ? (
        <EmptyState bordered title="La composition du capital ne s'est pas chargée" description={error} action={<Button size="sm" onClick={reload}>Réessayer</Button>} />
      ) : !data ? (
        <Skeleton className="h-64 w-full rounded-lg" aria-busy />
      ) : data.rows.length === 0 ? (
        <EmptyState
          bordered
          icon={PieChart}
          title="Aucun associé enregistré"
          description="Ajoutez les associés et le nombre de titres de chacun dans les informations de la société."
          action={
            <Button size="sm" asChild>
              <Link href={`/${companyId}/informations`}>Informations de la société</Link>
            </Button>
          }
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Capital social" value={<Amount value={euros(data.capital.shareCapitalCents)} empty="Non renseigné" />} hint={data.company.legalType ?? undefined} />
            <StatCard
              label={sharesLabel}
              value={<span className="num">{data.capital.totalShares?.toLocaleString('fr-FR') ?? '-'}</span>}
              hint={data.capital.nominalCents !== null ? <>Valeur nominale <Amount value={euros(data.capital.nominalCents)} /></> : 'Valeur nominale non renseignée'}
            />
            <StatCard
              label="Capital au compte 101"
              value={<Amount value={euros(data.bookedCapitalCents)} empty="-" />}
              hint={data.fiscalYear ? `Au ${formatDisplayDate(data.fiscalYear.endDate, 'short')}, écritures validées` : undefined}
            />
          </div>

          {data.checks.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>À vérifier</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {data.checks.map((check) => (
                    <li key={check}>{check}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Associés</CardTitle>
              <CardDescription>
                {plural(data.totals.holders, 'associé')}&nbsp;: {plural(data.totals.physical.holders, 'personne physique', 'personnes physiques')},{' '}
                {plural(data.totals.legal.holders, 'personne morale', 'personnes morales')}.
              </CardDescription>
            </CardHeader>
            <CardContent className="@container/list">
              <ul className="divide-y rounded-md border @min-[56rem]/list:hidden" aria-label="Associés">
                {data.rows.map((r) => (
                  <li key={r.id} className="space-y-1 px-3 py-3">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {r.kind === 'PHYSICAL' ? <PersonAvatar name={r.name} photo={r.photo} size="sm" /> : null}
                      {r.name}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {r.kind === 'PHYSICAL' ? 'Personne physique' : `Personne morale${r.siren ? `, SIREN ${r.siren}` : ''}`}
                    </p>
                    <p className="text-sm">
                      {r.shares ?? '-'} {sharesLabel.toLowerCase()}, {percent(r.sharesPercentHundredths ?? r.percentHundredths)}
                      {r.nominalAmountCents !== null ? (
                        <>
                          , <Amount value={euros(r.nominalAmountCents)} />
                        </>
                      ) : null}
                    </p>
                    {r.declared ? <StatusBadge tone="info">10&nbsp;% ou plus</StatusBadge> : null}
                  </li>
                ))}
              </ul>
              <div className="hidden rounded-md border @min-[56rem]/list:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Associé</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead numeric>{sharesLabel}</TableHead>
                      <TableHead numeric>Pourcentage</TableHead>
                      <TableHead numeric>Valeur nominale</TableHead>
                      <TableHead>
                        <span className="inline-flex items-center gap-1">
                          Liasse
                          <HelpTip term="Liasse">
                            Les associés qui détiennent au moins 10&nbsp;% du capital figurent sur le formulaire 2033-F (régime simplifié) ou 2059-F (régime normal).
                          </HelpTip>
                        </span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">
                          <span className="flex items-center gap-2">
                            {r.kind === 'PHYSICAL' ? <PersonAvatar name={r.name} photo={r.photo} size="sm" /> : null}
                            {r.name}
                          </span>
                        </TableCell>
                        <TableCell>
                          {r.kind === 'PHYSICAL' ? 'Personne physique' : 'Personne morale'}
                          {r.siren ? <span className="text-muted-foreground ml-2 font-mono text-xs">{r.siren}</span> : null}
                        </TableCell>
                        <TableCell numeric>{r.shares?.toLocaleString('fr-FR') ?? '-'}</TableCell>
                        <TableCell numeric>
                          {percent(r.sharesPercentHundredths ?? r.percentHundredths)}
                          {r.sharesPercentHundredths !== null && Math.abs(r.sharesPercentHundredths - r.percentHundredths) > 1 ? (
                            <span className="text-muted-foreground block text-xs">enregistré {percent(r.percentHundredths)}</span>
                          ) : null}
                        </TableCell>
                        <TableCell numeric>
                          <Amount value={euros(r.nominalAmountCents)} empty="-" />
                        </TableCell>
                        <TableCell>{r.declared ? <StatusBadge tone="info">2033-F / 2059-F</StatusBadge> : null}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={2}>Total</TableCell>
                      <TableCell numeric>{data.totals.shares.toLocaleString('fr-FR')}</TableCell>
                      <TableCell numeric>{percent(data.totals.percentHundredths)}</TableCell>
                      <TableCell numeric>
                        <Amount value={euros(data.totals.nominalAmountCents)} empty="-" />
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
