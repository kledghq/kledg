'use client'

import * as React from 'react'

import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow, TableSkeleton } from '@/components/ui/table'
import { Amount, DateDisplay, LoadMore, StatusBadge } from '@/components/shared'
import { responseError, useCursorList } from '@/hooks/use-cursor-list'
import type { GroupTransaction, GroupTransactionsPage } from '@/lib/group/list-group-transactions.service'
import type { GroupCompanyLink } from '@/lib/group/members'
import { CompanyLink, ExportButtons, LoadError, PerimeterNotes, useGroupSpace, SectionIntro } from './space'

const ALL = 'all'
const PAGE = 50

interface Meta {
  companies: GroupCompanyLink[]
  warnings: string[]
  unreachable: GroupTransactionsPage['unreachable']
}

function SignedAmount({ t }: { t: GroupTransaction }) {
  return <Amount value={(t.side === 'debit' ? -t.amountCents : t.amountCents) / 100} sign="always" />
}

/** Transactions of the group space: every company's bank transactions in one list, read only. */
export function GroupTransactionsSection() {
  const { companyId } = useGroupSpace()
  const [company, setCompany] = React.useState(ALL)
  const [side, setSide] = React.useState(ALL)
  const [reconciled, setReconciled] = React.useState(ALL)
  const [searchInput, setSearchInput] = React.useState('')
  const [search, setSearch] = React.useState('')
  React.useEffect(() => {
    const timeout = setTimeout(() => setSearch(searchInput.trim()), 300)
    return () => clearTimeout(timeout)
  }, [searchInput])
  const filters = {
    company: company === ALL ? undefined : company,
    side: side === ALL ? undefined : side,
    reconciled: reconciled === ALL ? undefined : reconciled,
    search: search || undefined,
  }
  const queryKey = JSON.stringify([companyId, filters])
  const list = useCursorList<GroupTransaction, Meta>(queryKey, async (cursor, signal) => {
    const params = new URLSearchParams({ companyId, limit: String(PAGE) })
    for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v)
    if (cursor) params.set('cursor', cursor)
    const response = await fetch(`/api/group/transactions?${params}`, { signal, cache: 'no-store' })
    if (!response.ok) throw new Error(await responseError(response, "Les transactions du groupe ne se sont pas chargées. Réessayez dans un instant."))
    const page = (await response.json()) as GroupTransactionsPage
    return { items: page.items, nextCursor: page.nextCursor, meta: { companies: page.companies, warnings: page.warnings, unreachable: page.unreachable } }
  })
  // The companies stay listed in the filter while another query loads.
  const [companies, setCompanies] = React.useState<GroupCompanyLink[]>([])
  if (list.meta && list.meta.companies !== companies) setCompanies(list.meta.companies)
  const byId = new Map(companies.map((c) => [c.id, c]))

  return (
    <div className="space-y-6">
      <SectionIntro
        description="Les transactions bancaires de toutes les sociétés du groupe, des plus récentes aux plus anciennes. Consultation seule : le rapprochement se fait dans chaque société."
        actions={<ExportButtons report="transactions" extra={filters} />}
      />
      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="tx-search">Recherche</Label>
            <Input id="tx-search" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="ex. loyer, URSSAF" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tx-company">Société</Label>
            <Select value={company} onValueChange={setCompany}>
              <SelectTrigger id="tx-company" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Toutes les sociétés</SelectItem>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tx-side">Sens</Label>
            <Select value={side} onValueChange={setSide}>
              <SelectTrigger id="tx-side" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Entrées et sorties</SelectItem>
                <SelectItem value="credit">Entrées</SelectItem>
                <SelectItem value="debit">Sorties</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tx-reconciled">Rapprochement</Label>
            <Select value={reconciled} onValueChange={setReconciled}>
              <SelectTrigger id="tx-reconciled" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Toutes</SelectItem>
                <SelectItem value="false">À rapprocher</SelectItem>
                <SelectItem value="true">Rapprochées</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
      {list.error ? (
        <LoadError message={list.error} onRetry={list.reload} />
      ) : (
        <>
          {list.meta ? <PerimeterNotes warnings={list.meta.warnings} unreachable={list.meta.unreachable} /> : null}
          <Card aria-busy={list.loading || undefined}>
            <CardContent className="space-y-4">
              <ul className="divide-y rounded-md border lg:hidden" aria-label="Transactions">
                {list.items.map((t) => {
                  const c = byId.get(t.companyId)
                  return (
                    <li key={t.id} className="space-y-1 px-3 py-3 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <span className="min-w-0 font-medium break-words">{t.counterpartyName || t.label || 'Sans libellé'}</span>
                        <SignedAmount t={t} />
                      </div>
                      <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
                        <DateDisplay value={t.date} />
                        {c ? <CompanyLink company={c} to="/transactions" /> : null}
                        <span>{t.bankAccountName}</span>
                        {t.reconciled ? null : <StatusBadge tone="warning">À rapprocher</StatusBadge>}
                      </div>
                    </li>
                  )
                })}
                {!list.loading && list.items.length === 0 ? <li className="text-muted-foreground px-3 py-3 text-sm">Aucune transaction pour ces filtres.</li> : null}
              </ul>
              <div className="hidden overflow-x-auto rounded-md border lg:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Société</TableHead>
                      <TableHead>Libellé</TableHead>
                      <TableHead>Compte</TableHead>
                      <TableHead numeric>Montant</TableHead>
                      <TableHead>Rapprochement</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {list.loading ? (
                      <TableSkeleton columns={6} />
                    ) : list.items.length === 0 ? (
                      <TableEmpty colSpan={6}>Aucune transaction pour ces filtres. Modifiez la recherche ou choisissez une autre société.</TableEmpty>
                    ) : (
                      list.items.map((t) => {
                        const c = byId.get(t.companyId)
                        return (
                          <TableRow key={t.id}>
                            <TableCell>
                              <DateDisplay value={t.date} />
                            </TableCell>
                            <TableCell className="whitespace-normal">{c ? <CompanyLink company={c} to="/transactions" /> : null}</TableCell>
                            <TableCell className="max-w-96 whitespace-normal">
                              <span className="block">{t.counterpartyName || t.label || 'Sans libellé'}</span>
                              {t.counterpartyName && t.label ? <span className="text-muted-foreground block text-xs">{t.label}</span> : null}
                            </TableCell>
                            <TableCell className="whitespace-normal">{t.bankAccountName}</TableCell>
                            <TableCell numeric>
                              <SignedAmount t={t} />
                            </TableCell>
                            <TableCell>{t.reconciled ? <StatusBadge tone="success">Rapprochée</StatusBadge> : <StatusBadge tone="warning">À rapprocher</StatusBadge>}</TableCell>
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
              <LoadMore
                hasMore={list.hasMore}
                loading={list.loadingMore}
                error={list.loadMoreError}
                onLoadMore={list.loadMore}
                summary={`${list.items.length} ${list.items.length > 1 ? 'transactions affichées' : 'transaction affichée'}`}
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
