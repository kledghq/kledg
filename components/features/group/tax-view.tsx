'use client'

import * as React from 'react'
import { CircleCheck, CircleHelp, CircleX } from 'lucide-react'

import { AmountInput } from '@/components/ui/amount-input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow, TableSkeleton } from '@/components/ui/table'
import { DateDisplay, Field, StatCard, StatusBadge, Amount } from '@/components/shared'
import { cn } from '@/lib/utils'
import type { GroupTaxReport } from '@/lib/group/get-group-tax.service'
import { MANUAL_NEUTRALISATIONS, simulateTaxIntegration, type CheckStatus, type IntegrationCheck, type IntegrationSimulation, type ManualNeutralisationId } from '@/lib/group/tax-integration'
import { GroupDeadlinesSection } from './deadlines-page'
import { Cents, CompanyLink, ExportButtons, LoadError, Notice, PerimeterNotes, SectionIntro, ownership, roleLabel, useGroupReport, useReportUrl } from './space'
import { GroupViewFrame } from './view-frame'

/**
 * Fiscalité (/<holding>/group/tax): what does the group owe in corporate
 * tax, does the régime mère-fille apply, what is due when, and would an
 * intégration fiscale pay? Each company's IS as its own worksheet computes
 * it, the 5 % threshold between the companies, the deadlines, and the
 * indicative simulation (lib/group/tax-integration.ts) with its sources.
 */

function useTax() {
  return useGroupReport<GroupTaxReport>(useReportUrl('tax'), 'La fiscalité du groupe ne s’est pas chargée. Réessayez dans un instant.')
}

const STATUS_TEXT: Record<GroupTaxReport['companies'][number]['status'], string> = {
  ready: 'Calculé',
  'not-subject': 'Impôt sur le revenu',
  'missing-regime': 'Régime à renseigner',
  'no-fiscal-year': 'Aucun exercice',
}

function GroupCorporateTaxSection() {
  const report = useTax()
  const data = report.data
  if (report.error) return <LoadError message={report.error} onRetry={report.retry} />
  const totals = (data?.companies ?? []).reduce((s, c) => ({ tax: s.tax + (c.totalCents ?? 0), balance: s.balance + (c.balanceCents ?? 0) }), { tax: 0, balance: 0 })
  return (
    <>
      <SectionIntro
        description="L'impôt sur les sociétés de chaque société, tel que sa page Impôt sur les sociétés le calcule, et le régime mère-fille entre les sociétés du groupe."
        actions={<ExportButtons report="tax" disabled={!data} />}
      />
      {data ? <PerimeterNotes warnings={data.warnings} unreachable={data.unreachable} /> : null}
      <div className="grid gap-4 sm:grid-cols-2" aria-busy={report.loading || undefined}>
        <StatCard label="Impôt des sociétés lues" value={data ? <Amount value={totals.tax / 100} /> : '-'} hint="Impôt sur les sociétés et contribution sociale, moins les crédits" busy={report.loading} />
        <StatCard label="Soldes à payer" value={data ? <Amount value={totals.balance / 100} /> : '-'} hint="Après les acomptes enregistrés ; négatif, un excédent à récupérer" busy={report.loading} />
      </div>
      <Card aria-busy={report.loading || undefined}>
        <CardHeader>
          <CardTitle>
            <h2>Impôt sur les sociétés par société</h2>
          </CardTitle>
          <CardDescription>Chaque société sur son exercice qui correspond à celui de la holding. Le détail et les contrôles sont sur sa page Impôt sur les sociétés.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-44">Société</TableHead>
                  <TableHead numeric>Résultat fiscal</TableHead>
                  <TableHead numeric>Impôt</TableHead>
                  <TableHead>Taux réduit</TableHead>
                  <TableHead numeric>Contribution sociale</TableHead>
                  <TableHead numeric>Solde à payer</TableHead>
                  <TableHead>Échéance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!data ? (
                  <TableSkeleton columns={7} />
                ) : (
                  data.companies.map((c) => (
                    <TableRow key={c.company.id}>
                      <TableCell className="whitespace-normal">
                        <CompanyLink company={c.company} to="/impot-societes" />
                        <span className="text-muted-foreground block text-xs">
                          {roleLabel(c.company)} · {STATUS_TEXT[c.status]}
                          {c.status === 'ready' && c.checksToReview > 0 ? ` · ${c.checksToReview} contrôle${c.checksToReview > 1 ? 's' : ''} à revoir` : ''}
                        </span>
                      </TableCell>
                      <TableCell numeric>
                        <Cents value={c.resultBeforeDeficitsCents} signed />
                      </TableCell>
                      <TableCell numeric>
                        <Cents value={c.corporateTaxCents} />
                      </TableCell>
                      <TableCell>{c.reducedRateApplied === null ? '-' : c.reducedRateApplied ? 'Oui' : 'Non'}</TableCell>
                      <TableCell numeric>
                        <Cents value={c.socialContributionCents} />
                      </TableCell>
                      <TableCell numeric>
                        <Cents value={c.balanceCents} />
                      </TableCell>
                      <TableCell>{c.balanceDue ? <DateDisplay value={c.balanceDue} /> : '-'}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      <Card aria-busy={report.loading || undefined}>
        <CardHeader>
          <CardTitle>
            <h2>Régime mère-fille</h2>
          </CardTitle>
          <CardDescription>
            Une société qui détient 5&nbsp;% au moins du capital d&apos;une autre déduit les dividendes qu&apos;elle en reçoit, sauf une quote-part de frais et charges de 5&nbsp;% (CGI, art. 145 et 216). Kledg ne voit pas la forme nominative des titres ni leur durée de détention (deux ans)&nbsp;: à vérifier.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Société mère</TableHead>
                  <TableHead>Filiale</TableHead>
                  <TableHead numeric>Détention</TableHead>
                  <TableHead>Seuil de 5&nbsp;%</TableHead>
                  <TableHead numeric>Dividendes reçus</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!data ? (
                  <TableSkeleton columns={5} />
                ) : data.parentSubsidiary.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground">
                      Aucune détention entre les sociétés lues.
                    </TableCell>
                  </TableRow>
                ) : (
                  data.parentSubsidiary.map((p) => (
                    <TableRow key={`${p.parent.id}-${p.subsidiary.id}`}>
                      <TableCell>{p.parent.name}</TableCell>
                      <TableCell>{p.subsidiary.name}</TableCell>
                      <TableCell numeric>{ownership(p.stakeBp)}</TableCell>
                      <TableCell>{p.eligible ? <StatusBadge tone="success">Atteint</StatusBadge> : <StatusBadge tone="neutral">Non atteint</StatusBadge>}</TableCell>
                      <TableCell numeric>
                        <Cents value={p.dividendsCents} />
                        {p.dividendsCents > 0 ? <span className="text-muted-foreground block text-xs">{p.applied ? 'Déduits dans son impôt' : 'Imposés dans son impôt'}</span> : null}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </>
  )
}

const CHECK_ICONS: Record<CheckStatus, { icon: typeof CircleCheck; label: string; className: string }> = {
  ok: { icon: CircleCheck, label: 'Remplie', className: 'text-success' },
  ko: { icon: CircleX, label: 'Non remplie', className: 'text-destructive' },
  check: { icon: CircleHelp, label: 'À vérifier', className: 'text-warning' },
}

function CheckLine({ check, sources }: { check: IntegrationCheck; sources: IntegrationSimulation['sources'] }) {
  const { icon: Icon, label, className } = CHECK_ICONS[check.status]
  const source = sources.find((s) => s.id === check.source)
  return (
    <li className="flex items-start gap-2 text-sm">
      <Icon aria-hidden className={cn('mt-0.5 size-4 shrink-0', className)} />
      <span className="min-w-0">
        <span className="font-medium">{check.label}</span>
        <span className="sr-only"> : {label}</span>
        <span className="text-muted-foreground block text-xs">
          {check.detail}
          {source ? (
            <>
              {' '}
              <a href={source.url} target="_blank" rel="noreferrer" className="text-link hover:underline">
                Source
              </a>
            </>
          ) : null}
        </span>
      </span>
    </li>
  )
}

function GroupTaxIntegrationSection() {
  const report = useTax()
  const data = report.data
  const [manual, setManual] = React.useState<Partial<Record<ManualNeutralisationId, number>>>({})
  const sim = React.useMemo(() => (data ? (Object.keys(manual).length > 0 ? simulateTaxIntegration({ ...data.integrationInput, manual }) : data.integration) : null), [data, manual])
  if (report.error) return <LoadError message={report.error} onRetry={report.retry} />
  const exportExtra = Object.fromEntries(Object.entries(manual).map(([k, v]) => [k, v === undefined ? undefined : String(v)]))
  return (
    <>
      <SectionIntro
        description="Et si les sociétés formaient un groupe intégré ? Les conditions, le résultat d'ensemble, l'impôt du groupe face à la somme des impôts de chaque société."
        actions={<ExportButtons report="tax" extra={exportExtra} disabled={!data} />}
      />
      {sim ? <Notice>{sim.notice}</Notice> : null}
      <div className="grid gap-4 sm:grid-cols-3" aria-busy={report.loading || undefined}>
        <StatCard label="Impôts des sociétés séparées" value={sim?.possible ? <Amount value={sim.separateTotalCents / 100} /> : '-'} hint="Membres possibles, impôt et contribution sociale" busy={report.loading} />
        <StatCard label="Impôt du groupe intégré" value={sim?.group ? <Amount value={sim.group.totalCents / 100} /> : '-'} hint="Taux réduit et contribution sociale une seule fois" busy={report.loading} />
        <StatCard
          label={sim && sim.savingCents < 0 ? 'Surcoût estimé' : 'Économie estimée'}
          value={sim?.possible ? <Amount value={Math.abs(sim.savingCents) / 100} /> : '-'}
          valueClassName={sim && sim.savingCents < 0 ? 'text-destructive' : undefined}
          hint="Pour cet exercice, à confirmer par votre expert-comptable"
          busy={report.loading}
        />
      </div>
      {sim && sim.warnings.length > 0 ? <PerimeterNotes warnings={sim.warnings} unreachable={[]} /> : null}

      <Card aria-busy={report.loading || undefined}>
        <CardHeader>
          <CardTitle>
            <h2>Conditions</h2>
          </CardTitle>
          <CardDescription>La holding, puis chaque société&nbsp;: détention de 95&nbsp;% au moins, directement ou par des sociétés du groupe, impôt sur les sociétés, exercices de douze mois aux mêmes dates.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {!sim ? (
            <TableSkeletonBlock />
          ) : (
            sim.members.map((m) => (
              <div key={m.companyId} className="space-y-2">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {m.name}
                  <span className="text-muted-foreground font-normal">{m.interestBp === null ? 'Société mère' : `Détenue à ${ownership(m.interestBp)} par le groupe`}</span>
                  {m.member ? <StatusBadge tone="success">Membre possible</StatusBadge> : <StatusBadge tone="neutral">Hors du groupe</StatusBadge>}
                </p>
                <ul className="space-y-1.5 pl-1">
                  {m.checks.map((c) => (
                    <CheckLine key={c.id} check={c} sources={sim.sources} />
                  ))}
                </ul>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card aria-busy={report.loading || undefined}>
        <CardHeader>
          <CardTitle>
            <h2>Résultat d&apos;ensemble et impôt du groupe</h2>
          </CardTitle>
          <CardDescription>La somme des résultats fiscaux des membres, les retraitements du groupe, les déficits antérieurs de chaque membre sur son propre bénéfice, puis l&apos;impôt une fois pour le groupe.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-64">Ligne</TableHead>
                  <TableHead numeric>Montant</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!sim ? (
                  <TableSkeleton columns={2} />
                ) : !sim.possible ? (
                  <TableRow>
                    <TableCell colSpan={2} className="text-muted-foreground whitespace-normal">
                      Pas de groupe à simuler avec les sociétés lues&nbsp;: voyez les conditions ci-dessus.
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {sim.results.map((r) => (
                      <TableRow key={r.companyId}>
                        <TableCell>Résultat fiscal de {r.name}</TableCell>
                        <TableCell numeric>
                          <Cents value={r.resultBeforeDeficitsCents} signed />
                        </TableCell>
                      </TableRow>
                    ))}
                    {sim.adjustments.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="whitespace-normal">
                          <span className="block">{a.label}</span>
                          <span className="text-muted-foreground block text-xs">{a.detail}</span>
                        </TableCell>
                        <TableCell numeric>{a.origin === 'info' ? <span className="text-muted-foreground text-xs">{a.amountCents === 0 && a.id.startsWith('fees-') ? 'Neutre' : 'Non calculé'}</span> : <Cents value={a.amountCents} signed />}</TableCell>
                      </TableRow>
                    ))}
                  </>
                )}
              </TableBody>
              {sim?.possible && sim.group ? (
                <TableFooter>
                  <TableRow>
                    <TableCell>Résultat d&apos;ensemble avant déficits</TableCell>
                    <TableCell numeric>
                      <Cents value={sim.resultBeforeDeficitsCents} signed />
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="whitespace-normal">Déficits antérieurs imputés (chacun sur le bénéfice de sa société)</TableCell>
                    <TableCell numeric>
                      <Cents value={-sim.deficits.imputedCents} signed />
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="whitespace-normal">
                      Impôt sur les sociétés du groupe{' '}
                      <span className="text-muted-foreground text-xs">
                        {sim.group.reducedRate.applied ? '(15 % sur 42 500 € une fois, 25 % au-delà)' : sim.group.reducedRate.eligible === null ? '(taux normal\u00a0: conditions de capital à renseigner)' : '(taux normal)'}
                      </span>
                    </TableCell>
                    <TableCell numeric>
                      <Cents value={sim.group.corporateTaxCents} />
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Contribution sociale du groupe</TableCell>
                    <TableCell numeric>
                      <Cents value={sim.group.socialContribution.cents} />
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Somme des impôts des membres imposés séparément</TableCell>
                    <TableCell numeric>
                      <Cents value={sim.separateTotalCents} />
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>{sim.savingCents < 0 ? 'Surcoût' : 'Économie'}</TableCell>
                    <TableCell numeric className={cn(sim.savingCents < 0 && 'text-destructive')}>
                      <Cents value={Math.abs(sim.savingCents)} />
                    </TableCell>
                  </TableRow>
                </TableFooter>
              ) : null}
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Retraitements à saisir</h2>
          </CardTitle>
          <CardDescription>Ce que les livres ne montrent pas. Saisissez le montant que votre expert-comptable retient&nbsp;: la simulation se met à jour. Positif, il s&apos;ajoute au résultat d&apos;ensemble&nbsp;; négatif, il s&apos;en déduit.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {MANUAL_NEUTRALISATIONS.map((m) => (
            <Field key={m.id} label={m.label} hint={m.hint} optional>
              <AmountInput
                allowNegative
                value={manual[m.id] ?? null}
                onValueChange={(cents) =>
                  setManual((previous) => {
                    const next = { ...previous }
                    if (cents === null) delete next[m.id]
                    else next[m.id] = cents
                    return next
                  })
                }
                placeholder="ex. -12 000,00"
              />
            </Field>
          ))}
        </CardContent>
      </Card>

      {sim ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Sources</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {sim.sources.map((s) => (
                <li key={s.id}>
                  <a href={s.url} target="_blank" rel="noreferrer" className="text-link hover:underline">
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground mt-3 text-xs">Les résultats de chaque société viennent de sa page Impôt sur les sociétés, avec ses contrôles (onglet Impôt sur les sociétés).</p>
          </CardContent>
        </Card>
      ) : null}
    </>
  )
}

function TableSkeletonBlock() {
  return <div className="bg-muted h-24 animate-pulse rounded-md" />
}

export function GroupTaxView({ page }: { page?: string } = {}) {
  return (
    <GroupViewFrame
      view="tax"
      page={page}
      sections={{
        impot: <GroupCorporateTaxSection />,
        integration: <GroupTaxIntegrationSection />,
        echeances: <GroupDeadlinesSection />,
      }}
    />
  )
}
