'use client'

import Link from 'next/link'
import { ArrowRight, CalendarClock, Info } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Amount, PageHeader, StatCard, StatusBadge } from '@/components/shared'
import { dayInWords } from '@/lib/simple/vocabulary'
import { SIMPLE_GROUP_LABELS, type SimpleGroupHome } from '@/lib/group/simple-home'
import { LoadError, useGroupReport, useReportUrl } from './space'
import { GroupOrganigramSection } from './structure-view'
import { GroupIdentity } from './view-frame'

/**
 * The group space in simple mode (docs/vue-groupe.md, docs/mode-simple.md):
 * four plain pages, the figures of the expert views in everyday words (GET
 * /api/group/simple-home, lib/group/simple-home.ts). No account number and
 * no accounting term: the jargon test reads these pages.
 */

function useSimpleHome() {
  return useGroupReport<SimpleGroupHome>(useReportUrl('simple-home', {}, false), 'Les chiffres du groupe ne se sont pas chargés. Réessayez dans un instant.')
}

function Frame({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <GroupIdentity />
        <PageHeader title={title} description={description} />
      </div>
      {children}
    </div>
  )
}

function Notes({ notes }: { notes: readonly string[] }) {
  if (notes.length === 0) return null
  return (
    <ul className="space-y-1">
      {notes.map((n) => (
        <li key={n} className="text-muted-foreground flex items-start gap-2 text-sm">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>{n}</span>
        </li>
      ))}
    </ul>
  )
}

export function SimpleGroupHomePage() {
  const home = useSimpleHome()
  const data = home.data
  return (
    <Frame title={SIMPLE_GROUP_LABELS.home} description="Où en est votre groupe : l'argent de toutes vos sociétés, ce que le groupe gagne, ce que vos sociétés se doivent et ce qu'il reste à faire.">
      {home.error ? (
        <LoadError message={home.error} onRetry={home.retry} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2" aria-busy={home.loading || undefined}>
            <StatCard label={SIMPLE_GROUP_LABELS.money} value={data ? <Amount value={data.moneyCents / 100} /> : '-'} hint="Ce que disent les banques de toutes vos sociétés" busy={home.loading} />
            <StatCard
              label={data?.earnedTitle ?? 'Ce que gagne le groupe'}
              value={data ? <Amount value={data.earnedCents / 100} /> : '-'}
              valueClassName={data && data.earnedCents < 0 ? 'text-destructive' : undefined}
              hint="Toutes vos sociétés ensemble, avant impôt"
              busy={home.loading}
            />
          </div>
          {data ? <Notes notes={data.notes} /> : null}

          <Card aria-busy={home.loading || undefined}>
            <CardHeader>
              <CardTitle>
                <h2>{SIMPLE_GROUP_LABELS.owes}</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!data ? (
                <Skeleton className="h-12 w-full" />
              ) : data.owes.length === 0 ? (
                <p className="text-muted-foreground text-sm">Vos sociétés ne se doivent rien entre elles.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {data.owes.map((o) => (
                    <li key={o.text}>{o.text}</li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card aria-busy={home.loading || undefined}>
            <CardHeader>
              <CardTitle>
                <h2>{SIMPLE_GROUP_LABELS.taxes}</h2>
              </CardTitle>
              <CardDescription>Dans les six prochaines semaines, et ce qui est en retard.</CardDescription>
            </CardHeader>
            <CardContent>
              {!data ? (
                <Skeleton className="h-16 w-full" />
              ) : data.taxes.length === 0 ? (
                <p className="text-muted-foreground text-sm">Rien à déclarer ni à payer dans les six prochaines semaines.</p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {data.taxes.map((t) => (
                    <li key={`${t.slug}-${t.title}-${t.date}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span className="min-w-0">
                        <span className="block font-medium">{t.title}</span>
                        <span className="text-muted-foreground block text-xs">
                          {t.companyName} · {t.hint}
                        </span>
                      </span>
                      {t.overdue ? <StatusBadge tone="danger">En retard</StatusBadge> : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card aria-busy={home.loading || undefined}>
            <CardHeader>
              <CardTitle>
                <h2>{SIMPLE_GROUP_LABELS.todo}</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!data ? (
                <Skeleton className="h-16 w-full" />
              ) : data.todo.length === 0 ? (
                <p className="text-muted-foreground text-sm">Rien à faire pour le moment dans vos sociétés.</p>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {data.todo.map((t) => (
                    <div key={t.company.slug} className="space-y-2 rounded-md border p-3">
                      <p className="text-sm font-medium">{t.company.name}</p>
                      <ul className="space-y-1">
                        {t.items.map((item) => (
                          <li key={item.label}>
                            <Link href={item.href} className="text-link inline-flex items-center gap-1 text-sm hover:underline">
                              {item.label}
                              <ArrowRight aria-hidden className="size-3.5" />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </Frame>
  )
}

export function SimpleGroupCompaniesPage() {
  const home = useSimpleHome()
  const data = home.data
  // "depuis janvier" for a year starting on the 1st, else "depuis le 15 mars".
  const since = data ? (data.since.endsWith('-01') ? `depuis ${dayInWords(data.since).slice('1er '.length)}` : `depuis le ${dayInWords(data.since)}`) : ''
  return (
    <Frame title={SIMPLE_GROUP_LABELS.companies} description="Chacune de vos sociétés en quatre chiffres : l'argent sur ses comptes, ses ventes, son bénéfice et sa prochaine déclaration.">
      {home.error ? (
        <LoadError message={home.error} onRetry={home.retry} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2" aria-busy={home.loading || undefined}>
          {!data
            ? [0, 1].map((i) => <Skeleton key={i} className="h-56 rounded-lg" />)
            : data.companies.map((c) => (
                <Card key={c.id}>
                  <CardHeader>
                    <CardTitle>
                      <h2 className="truncate">{c.name}</h2>
                    </CardTitle>
                    <CardDescription>{c.ownership}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      <dt className="text-muted-foreground">Argent sur les comptes</dt>
                      <dd className="text-right">
                        <Amount value={c.moneyCents / 100} />
                      </dd>
                      <dt className="text-muted-foreground">Ventes {since}</dt>
                      <dd className="text-right">{c.salesCents === null ? '-' : <Amount value={c.salesCents / 100} />}</dd>
                      <dt className="text-muted-foreground">{c.profitCents !== null && c.profitCents < 0 ? 'Perte' : 'Bénéfice'} {since}</dt>
                      <dd className="text-right">{c.profitCents === null ? '-' : <Amount value={c.profitCents / 100} />}</dd>
                      <dt className="text-muted-foreground">Prochaine déclaration</dt>
                      <dd className="text-right">
                        {c.nextDeadline ? (
                          <span className="inline-flex items-center gap-1">
                            <CalendarClock aria-hidden className="text-muted-foreground size-3.5" />
                            {c.nextDeadline.overdue ? 'En retard' : `Le ${dayInWords(c.nextDeadline.date)}`}
                          </span>
                        ) : (
                          'Rien de prévu'
                        )}
                      </dd>
                    </dl>
                    {c.nextDeadline ? <p className="text-muted-foreground text-xs">{c.nextDeadline.title}</p> : null}
                    <Link href={`/${c.slug}/simple`} className="text-link inline-flex items-center gap-1 text-sm hover:underline">
                      Ouvrir {c.name}
                      <ArrowRight aria-hidden className="size-3.5" />
                    </Link>
                  </CardContent>
                </Card>
              ))}
        </div>
      )}
      {data ? <Notes notes={data.notes} /> : null}
    </Frame>
  )
}

export function SimpleGroupStructurePage() {
  return (
    <Frame title={SIMPLE_GROUP_LABELS.structure} description="Qui possède vos sociétés, et quelle part : les personnes en haut, puis chaque société, avec le pourcentage sur chaque flèche.">
      <GroupOrganigramSection simple />
    </Frame>
  )
}

export function SimpleGroupFlowsPage() {
  const home = useSimpleHome()
  const data = home.data
  return (
    <Frame title={SIMPLE_GROUP_LABELS.flows} description="L'argent qui passe d'une de vos sociétés à une autre depuis le début de l'année : gestion facturée, achats, dividendes, prêts et avances.">
      {home.error ? (
        <LoadError message={home.error} onRetry={home.retry} />
      ) : (
        <Card aria-busy={home.loading || undefined}>
          <CardContent>
            {!data ? (
              <Skeleton className="h-24 w-full" />
            ) : data.flows.length === 0 ? (
              <p className="text-muted-foreground text-sm">Aucun argent n&apos;a circulé entre vos sociétés pour le moment.</p>
            ) : (
              <ul className="divide-y">
                {data.flows.map((f) => (
                  <li key={f.text} className="py-2 text-sm first:pt-0 last:pb-0">
                    {f.text}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
      {data ? <Notes notes={data.notes} /> : null}
    </Frame>
  )
}
