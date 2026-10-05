'use client'

import Link from 'next/link'
import { ArrowRight, Building2 } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PersonAvatar, formatDisplayDate } from '@/components/shared'
import { displayCompanyName } from '@/lib/companies/legal-forms'
import { FIGURE_ROWS } from '@/lib/group/labels'
import type { GroupCompaniesReport } from '@/lib/group/get-group-companies.service'
import { Cents, ExportButtons, LoadError, PerimeterNotes, roleLabel, useGroupReport, useReportUrl, SectionIntro } from './space'

/** Sociétés of the group space: each company read, its legal form, the holding's stake, officers and key figures. */
export function GroupCompaniesSection() {
  const report = useGroupReport<GroupCompaniesReport>(useReportUrl('companies'), "Les sociétés du groupe ne se sont pas chargées. Réessayez dans un instant.")
  const data = report.data
  return (
    <div className="space-y-6">
      <SectionIntro
        description="Chaque société du groupe que vous lisez : forme juridique, détention par la holding, dirigeants et chiffres clés de l'exercice."
        actions={<ExportButtons report="companies" disabled={!data} />}
      />
      {report.error ? (
        <LoadError message={report.error} onRetry={report.retry} />
      ) : (
        <>
          {data ? <PerimeterNotes warnings={data.warnings} unreachable={data.unreachable} /> : null}
          <div className="grid gap-4 lg:grid-cols-2" aria-busy={report.loading || undefined}>
            {!data
              ? [0, 1].map((i) => <Skeleton key={i} className="h-72 rounded-lg" />)
              : data.companies.map((c) => (
                  <Card key={c.company.id}>
                    <CardHeader className="flex flex-row items-start gap-3">
                      {c.logo ? (
                        <span className="bg-background flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border">
                          <img src={c.logo} alt="" className="size-10 object-contain" />
                        </span>
                      ) : (
                        <span aria-hidden className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-md border">
                          <Building2 className="size-4" />
                        </span>
                      )}
                      <div className="min-w-0 flex-1 space-y-1">
                        <CardTitle>
                          <h2 className="truncate">{displayCompanyName(c.company.name, c.legalType)}</h2>
                        </CardTitle>
                        <CardDescription>
                          {roleLabel(c.company)} · SIREN <span className="font-mono text-xs">{c.siren}</span>
                          {c.legalForm ? ` · ${c.legalForm}` : null}
                        </CardDescription>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <h3 className="text-muted-foreground text-xs font-medium">Dirigeants</h3>
                        {c.officers.length === 0 ? (
                          <p className="text-muted-foreground text-sm">Aucun dirigeant enregistré dans l&apos;approbation des comptes.</p>
                        ) : (
                          <ul className="flex flex-wrap gap-3">
                            {c.officers.map((o) => (
                              <li key={`${o.name}-${o.title}`} className="flex items-center gap-2 text-sm">
                                <PersonAvatar name={o.name} photo={o.photo} size="sm" />
                                <span>
                                  {o.name}
                                  {o.title ? <span className="text-muted-foreground"> ({o.title})</span> : null}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      {c.figures ? (
                        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm">
                          {FIGURE_ROWS.map((row) => (
                            <div key={row.key} className="contents">
                              <dt className="text-muted-foreground">{row.label}</dt>
                              <dd className="text-right">
                                <Cents value={c.figures?.[row.key]} signed={row.key === 'resultatCents'} />
                              </dd>
                            </div>
                          ))}
                        </dl>
                      ) : (
                        <p className="text-muted-foreground text-sm">Aucun exercice sur cette période.</p>
                      )}
                      {c.fiscalYear && !c.samePeriod ? (
                        <p className="text-muted-foreground text-xs">
                          Exercice lu du {formatDisplayDate(c.fiscalYear.startDate)} au {formatDisplayDate(c.fiscalYear.endDate)}.
                        </p>
                      ) : null}
                      <Link href={`/${c.company.slug}`} className="text-link inline-flex items-center gap-1 text-sm hover:underline">
                        Ouvrir la société
                        <ArrowRight aria-hidden className="size-3.5" />
                      </Link>
                    </CardContent>
                  </Card>
                ))}
          </div>
        </>
      )}
    </div>
  )
}
