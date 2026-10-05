'use client'

import * as React from 'react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableSkeleton } from '@/components/ui/table'
import { Amount, DateDisplay, PageHeader, StatCard, formatAmount } from '@/components/shared'
import { cn } from '@/lib/utils'
import { FLOW_CATEGORY_LABELS } from '@/lib/group/labels'
import type { GroupTreasuryReport } from '@/lib/group/get-group-treasury.service'
import { TreasuryLineChart } from './charts'
import { Cents, CompanyLink, ExportButtons, GroupFiscalYear, LoadError, PerimeterNotes, useGroupReport, useReportUrl } from './space'

const GROUP = 'group'

/** Trésorerie of the group space: bank balances, monthly cash and current accounts between the companies. */
export function GroupTreasuryPage() {
  const report = useGroupReport<GroupTreasuryReport>(useReportUrl('treasury'), "La trésorerie du groupe ne s'est pas chargée. Réessayez dans un instant.")
  const data = report.data
  const [selected, setSelected] = React.useState(GROUP)
  const names = new Map((data?.companies ?? []).map((c) => [c.company.id, c.company.name]))
  const nameOf = (id: string) => names.get(id) ?? 'Société du groupe'
  const points = (data?.months ?? []).map((m) => ({ month: m.month, cents: selected === GROUP ? m.totalCents : (m.byCompany[selected] ?? 0) }))
  const eur = data?.totalsByCurrency.find((t) => t.currency === 'EUR')
  const others = data?.totalsByCurrency.filter((t) => t.currency !== 'EUR') ?? []
  return (
    <div className="space-y-6">
      <PageHeader
        title="Trésorerie"
        description="Les soldes bancaires de chaque société et du groupe, la trésorerie comptable mois par mois et les comptes courants entre sociétés."
        actions={<ExportButtons report="treasury" disabled={!data} />}
      />
      <GroupFiscalYear />
      {report.error ? (
        <LoadError message={report.error} onRetry={report.retry} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3" aria-busy={report.loading || undefined}>
            <StatCard label="Soldes bancaires du groupe" value={eur ? <Amount value={eur.balanceCents / 100} /> : data ? <Amount value={0} /> : '-'} hint="Derniers soldes connus des banques, en euros" busy={report.loading} />
            <StatCard label="Trésorerie comptable" value={data ? <Amount value={data.ledgerTotalCents / 100} /> : '-'} hint="Comptes 512 à la fin du dernier mois" busy={report.loading} />
            <StatCard
              label="Comptes courants entre sociétés"
              value={data ? <Amount value={data.currentAccounts.reduce((s, b) => s + b.receivableCents, 0) / 100} /> : '-'}
              hint="Avances et prêts consentis dans le groupe"
              busy={report.loading}
            />
          </div>
          {others.length > 0 ? (
            <p className="text-muted-foreground text-sm">
              Autres devises&nbsp;: {others.map((t) => `${formatAmount(t.balanceCents / 100, { currency: false })} ${t.currency}`).join(', ')}.
            </p>
          ) : null}
          {data ? <PerimeterNotes warnings={data.warnings} unreachable={data.unreachable} /> : null}

          <Card aria-busy={report.loading || undefined}>
            <CardHeader className="flex flex-wrap items-end justify-between gap-3">
              <div className="space-y-1.5">
                <CardTitle>
                  <h2>Trésorerie mois par mois</h2>
                </CardTitle>
                <CardDescription>Soldes des comptes 512 en fin de mois, d&apos;après les écritures validées.</CardDescription>
              </div>
              <div>
                <Label htmlFor="treasury-company" className="sr-only">
                  Société affichée
                </Label>
                <Select value={selected} onValueChange={setSelected}>
                  <SelectTrigger id="treasury-company" size="sm" className="w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={GROUP}>Le groupe</SelectItem>
                    {data?.companies
                      .filter((c) => c.ledgerCents !== null)
                      .map((c) => (
                        <SelectItem key={c.company.id} value={c.company.id}>
                          {c.company.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="px-2 sm:px-5">{data ? <TreasuryLineChart points={points} /> : <Skeleton className="h-64 w-full" />}</CardContent>
          </Card>

          <Card aria-busy={report.loading || undefined}>
            <CardHeader>
              <CardTitle>
                <h2>Comptes bancaires par société</h2>
              </CardTitle>
              <CardDescription>Le solde que la banque a communiqué à la dernière synchronisation.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Société</TableHead>
                      <TableHead>Compte</TableHead>
                      <TableHead className="hidden md:table-cell">IBAN</TableHead>
                      <TableHead className="hidden lg:table-cell">Synchronisé le</TableHead>
                      <TableHead numeric>Solde</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!data ? (
                      <TableSkeleton columns={5} />
                    ) : (
                      data.companies.flatMap((c) =>
                        c.accounts.length === 0
                          ? [
                              <TableRow key={c.company.id}>
                                <TableCell className="whitespace-normal">
                                  <CompanyLink company={c.company} to="/banking" />
                                </TableCell>
                                <TableCell colSpan={4} className="text-muted-foreground whitespace-normal">
                                  Aucun compte bancaire.
                                </TableCell>
                              </TableRow>,
                            ]
                          : c.accounts.map((a, i) => (
                              <TableRow key={a.id}>
                                <TableCell className="whitespace-normal">{i === 0 ? <CompanyLink company={c.company} to="/banking" /> : null}</TableCell>
                                <TableCell className="whitespace-normal">{a.name}</TableCell>
                                <TableCell className="hidden font-mono text-xs md:table-cell">{a.maskedIban ?? '-'}</TableCell>
                                <TableCell className="hidden lg:table-cell">{a.lastSyncedAt ? <DateDisplay value={a.lastSyncedAt} format="datetime" /> : 'Jamais'}</TableCell>
                                <TableCell numeric>
                                  {a.currency === 'EUR' ? (
                                    <Cents value={a.balanceCents} signed />
                                  ) : (
                                    <span className="num">
                                      {formatAmount(a.balanceCents / 100, { currency: false })} {a.currency}
                                    </span>
                                  )}
                                </TableCell>
                              </TableRow>
                            )),
                      )
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card aria-busy={report.loading || undefined}>
            <CardHeader>
              <CardTitle>
                <h2>Comptes courants et prêts entre sociétés</h2>
              </CardTitle>
              <CardDescription>
                Comptes 451, 455, 267 et 168 en fin d&apos;exercice, chaque côté tel qu&apos;il est comptabilisé. Un écart signale un côté manquant ou différent.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data && data.currentAccounts.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Aucun compte courant entre sociétés lues. Nommez les sous-comptes d&apos;après la société (ex. « 455100 Compte courant Filiale Nord ») pour qu&apos;ils soient reconnus.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Créancier</TableHead>
                        <TableHead>Débiteur</TableHead>
                        <TableHead className="hidden md:table-cell">Nature</TableHead>
                        <TableHead numeric>Créance</TableHead>
                        <TableHead numeric>Dette</TableHead>
                        <TableHead numeric>Écart</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {!data ? (
                        <TableSkeleton columns={6} />
                      ) : (
                        data.currentAccounts.map((b) => (
                          <TableRow key={`${b.creditorId}-${b.debtorId}`}>
                            <TableCell className="whitespace-normal">{nameOf(b.creditorId)}</TableCell>
                            <TableCell className="whitespace-normal">{nameOf(b.debtorId)}</TableCell>
                            <TableCell className="hidden whitespace-normal md:table-cell">{b.categories.map((c) => FLOW_CATEGORY_LABELS[c]).join(', ')}</TableCell>
                            <TableCell numeric>
                              <Cents value={b.receivableCents} />
                            </TableCell>
                            <TableCell numeric>
                              <Cents value={b.payableCents} />
                            </TableCell>
                            <TableCell numeric className={cn(b.gapCents !== 0 && 'text-warning')}>
                              {b.gapCents === 0 ? <span className="text-muted-foreground">-</span> : <Amount value={b.gapCents / 100} />}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
