'use client'

import { Building2, Lock } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState, HelpTip, PersonAvatar } from '@/components/shared'
import type { GroupHolder, GroupPersonsReport, HolderKind } from '@/lib/group/get-group-persons.service'
import { CompanyLink, ExportButtons, LoadError, PerimeterNotes, ownership, useGroupReport, useReportUrl, SectionIntro } from './space'

const KIND_LABELS: Record<HolderKind, string> = {
  person: 'Personne physique',
  company: 'Société',
  other: 'Personne morale',
  officer: 'Dirigeant non associé',
}

/** Associés et dirigeants of the group space: who holds what, directly and through the group, and who runs each company. */
export function GroupPersonsSection() {
  const report = useGroupReport<GroupPersonsReport>(useReportUrl('persons', {}, false), "Les associés du groupe ne se sont pas chargés. Réessayez dans un instant.")
  const data = report.data
  const people = data?.holders.filter((h) => h.kind === 'person' || h.kind === 'officer') ?? []
  const entities = data?.holders.filter((h) => h.kind === 'company' || h.kind === 'other') ?? []
  return (
    <div className="space-y-6">
      <SectionIntro
        description="Les personnes et les sociétés qui détiennent des parts dans le groupe, directement ou par la holding, et les dirigeants de chaque société."
        actions={<ExportButtons report="persons" disabled={!data} />}
      />
      {report.error ? (
        <LoadError message={report.error} onRetry={report.retry} />
      ) : (
        <>
          {data ? <PerimeterNotes warnings={data.warnings} unreachable={data.unreachable} /> : null}
          <section aria-labelledby="group-people" className="space-y-3">
            <h2 id="group-people" className="flex items-center gap-1 text-base font-semibold">
              Personnes
              <HelpTip term="Détention indirecte">
                Ce qu&apos;une personne détient par les sociétés du groupe&nbsp;: 60&nbsp;% de la holding qui détient 80&nbsp;% d&apos;une filiale font 48&nbsp;% de la filiale. Un
                pourcentage d&apos;intérêt indicatif, jamais appliqué aux chiffres.
              </HelpTip>
            </h2>
            {!data ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-busy>
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-44 rounded-lg" />
                ))}
              </div>
            ) : people.length === 0 ? (
              <EmptyState
                bordered
                title="Aucun associé personne physique enregistré"
                description="Ajoutez les associés sur la page Informations de chaque société, section Actionnaires."
              />
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {people.map((h) => (
                  <HolderCard key={h.holderId} holder={h} companies={data.companies} />
                ))}
              </div>
            )}
          </section>
          {data && entities.length > 0 ? (
            <section aria-labelledby="group-entities" className="space-y-3">
              <h2 id="group-entities" className="text-base font-semibold">
                Sociétés et autres personnes morales
              </h2>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {entities.map((h) => (
                  <HolderCard key={h.holderId} holder={h} companies={data.companies} />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  )
}

function HolderCard({ holder, companies }: { holder: GroupHolder; companies: GroupPersonsReport['companies'] }) {
  const byId = new Map(companies.map((c) => [c.id, c]))
  const isPerson = holder.kind === 'person' || holder.kind === 'officer'
  return (
    <Card className="gap-3">
      <CardHeader className="flex flex-row items-center gap-3">
        {isPerson ? (
          <PersonAvatar name={holder.name} photo={holder.photo} size="lg" />
        ) : (
          <span aria-hidden className="bg-muted flex size-12 shrink-0 items-center justify-center rounded-full border">
            {holder.name ? <Building2 className="size-5" /> : <Lock className="size-5" />}
          </span>
        )}
        <div className="min-w-0 space-y-1">
          <CardTitle>
            <h3 className="truncate">{holder.groupCompany ? <CompanyLink company={holder.groupCompany} /> : (holder.name ?? 'Filiale non accessible')}</h3>
          </CardTitle>
          <CardDescription>{KIND_LABELS[holder.kind]}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {holder.titles.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {holder.titles.map((t) => {
              const company = byId.get(t.companyId)
              return (
                <li key={`${t.companyId}-${t.title}`}>
                  {t.title ?? 'Dirigeant'} de {company ? <CompanyLink company={company} /> : 'une société du groupe'}
                </li>
              )
            })}
          </ul>
        ) : null}
        {holder.interests.length > 0 ? (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Société</TableHead>
                  <TableHead numeric>Direct</TableHead>
                  <TableHead numeric>Indirect</TableHead>
                  <TableHead numeric>Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {holder.interests.map((i) => {
                  const company = byId.get(i.companyId)
                  return (
                    <TableRow key={i.companyId}>
                      <TableCell className="whitespace-normal">{company ? <CompanyLink company={company} to="/informations" /> : null}</TableCell>
                      <TableCell numeric>{i.directBp > 0 ? ownership(i.directBp) : <span className="text-muted-foreground">-</span>}</TableCell>
                      <TableCell numeric>{i.indirectBp > 0 ? ownership(i.indirectBp) : <span className="text-muted-foreground">-</span>}</TableCell>
                      <TableCell numeric className="font-medium">
                        {ownership(i.totalBp)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">Ne détient pas de parts dans les sociétés lues.</p>
        )}
      </CardContent>
    </Card>
  )
}
