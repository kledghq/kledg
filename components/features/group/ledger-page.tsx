'use client'

import * as React from 'react'
import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableEmpty, TableFooter, TableHead, TableHeader, TableRow, TableSkeleton } from '@/components/ui/table'
import { DateDisplay, PageHeader } from '@/components/shared'
import type { GroupLedgerReport } from '@/lib/group/get-group-ledger.service'
import { Cents, CompanyLink, ExportButtons, GroupFiscalYear, LoadError, Notice, PerimeterNotes, useGroupReport, useReportUrl } from './space'

/** Grand livre combiné of the group space: an aggregation of the books, read only. */
export function GroupLedgerPage() {
  const [prefixInput, setPrefixInput] = React.useState('')
  const [prefix, setPrefix] = React.useState('')
  const [account, setAccount] = React.useState<string | null>(null)
  React.useEffect(() => {
    const value = prefixInput.replace(/\D/g, '').slice(0, 10)
    const timeout = setTimeout(() => setPrefix(value), 300)
    return () => clearTimeout(timeout)
  }, [prefixInput])
  const extra = { prefix: prefix || undefined, account: account ?? undefined }
  const report = useGroupReport<GroupLedgerReport>(useReportUrl('ledger', extra), "Le grand livre combiné ne s'est pas chargé. Réessayez dans un instant.")
  const data = report.data
  const names = new Map((data?.companies ?? []).map((c) => [c.id, c]))
  return (
    <div className="space-y-6">
      <PageHeader
        title="Grand livre combiné"
        description="Chaque compte utilisé par les sociétés du groupe, avec le solde de chacune et leur total. Choisissez un compte pour voir ses lignes dans toutes les sociétés."
        actions={<ExportButtons report="ledger" extra={extra} disabled={!data} />}
      />
      <GroupFiscalYear />
      {report.error ? (
        <LoadError message={report.error} onRetry={report.retry} />
      ) : (
        <>
          {data ? <Notice>{data.notice}</Notice> : null}
          {data ? <PerimeterNotes warnings={data.warnings} unreachable={data.unreachable} /> : null}
          <div className="max-w-xs space-y-2">
            <Label htmlFor="ledger-prefix">Comptes commençant par</Label>
            <Input id="ledger-prefix" inputMode="numeric" autoComplete="off" value={prefixInput} onChange={(e) => setPrefixInput(e.target.value)} placeholder="ex. 6, 512, 455" />
          </div>
          {account ? (
            <Card aria-busy={report.loading || undefined}>
              <CardHeader className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1.5">
                  <CardTitle>
                    <h2>
                      Compte <span className="font-mono">{account}</span> dans le groupe
                    </h2>
                  </CardTitle>
                  <CardDescription>
                    Lignes validées de l&apos;exercice, des plus récentes aux plus anciennes.
                    {data?.detail?.truncated ? ' Seules les 1 000 plus récentes sont affichées.' : null}
                  </CardDescription>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setAccount(null)}>
                  <X aria-hidden />
                  Fermer
                </Button>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto rounded-md border">
                  <Table stickyHeader containerClassName="max-h-[28rem]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Société</TableHead>
                        <TableHead>Écriture</TableHead>
                        <TableHead>Libellé</TableHead>
                        <TableHead numeric>Débit</TableHead>
                        <TableHead numeric>Crédit</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {!data?.detail || report.loading ? (
                        <TableSkeleton columns={6} />
                      ) : data.detail.lines.length === 0 ? (
                        <TableEmpty colSpan={6}>Aucune ligne sur ce compte pour l&apos;exercice.</TableEmpty>
                      ) : (
                        data.detail.lines.map((l, i) => {
                          const c = names.get(l.companyId)
                          return (
                            <TableRow key={`${l.companyId}-${l.entryNumber}-${i}`}>
                              <TableCell>
                                <DateDisplay value={l.date} />
                              </TableCell>
                              <TableCell className="whitespace-normal">{c ? <CompanyLink company={c} to="/entries" /> : null}</TableCell>
                              <TableCell>
                                <span className="font-mono text-xs">
                                  {l.journal} {l.entryNumber}
                                </span>
                              </TableCell>
                              <TableCell className="max-w-80 whitespace-normal">{l.label}</TableCell>
                              <TableCell numeric>{l.debitCents ? <Cents value={l.debitCents} /> : null}</TableCell>
                              <TableCell numeric>{l.creditCents ? <Cents value={l.creditCents} /> : null}</TableCell>
                            </TableRow>
                          )
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          ) : null}
          <Card aria-busy={report.loading || undefined}>
            <CardHeader>
              <CardTitle>
                <h2>Comptes</h2>
              </CardTitle>
              <CardDescription>Solde de chaque société (débit moins crédit) et total agrégé du groupe.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-md border">
                <Table stickyHeader containerClassName="max-h-[40rem]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Compte</TableHead>
                      <TableHead className="min-w-48">Libellé</TableHead>
                      {data?.companies.map((c) => (
                        <TableHead key={c.id} numeric className="min-w-32 whitespace-normal">
                          {c.name}
                        </TableHead>
                      ))}
                      <TableHead numeric className="min-w-32">
                        Total
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!data ? (
                      <TableSkeleton columns={4} />
                    ) : data.accounts.length === 0 ? (
                      <TableEmpty colSpan={3 + data.companies.length}>Aucun compte mouvementé{prefix ? ` commençant par ${prefix}` : ''} sur l&apos;exercice.</TableEmpty>
                    ) : (
                      data.accounts.map((a) => (
                        <TableRow key={a.code}>
                          <TableCell>
                            <Button variant="link" size="xs" className="font-mono" onClick={() => setAccount(a.code)} aria-label={`Voir les lignes du compte ${a.code}`}>
                              {a.code}
                            </Button>
                          </TableCell>
                          <TableCell className="whitespace-normal">{a.label}</TableCell>
                          {data.companies.map((c) => (
                            <TableCell key={c.id} numeric>
                              {a.byCompany[c.id] ? <Cents value={a.byCompany[c.id].balanceCents} /> : <span className="text-muted-foreground">-</span>}
                            </TableCell>
                          ))}
                          <TableCell numeric className="font-medium">
                            <Cents value={a.total.balanceCents} />
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                  {data && data.accounts.length > 0 ? (
                    <TableFooter>
                      <TableRow>
                        <TableCell colSpan={2 + data.companies.length}>Total des débits et des crédits</TableCell>
                        <TableCell numeric>
                          <Cents value={data.total.debitCents} /> / <Cents value={data.total.creditCents} />
                        </TableCell>
                      </TableRow>
                    </TableFooter>
                  ) : null}
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
