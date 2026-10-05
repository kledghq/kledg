'use client'

import * as React from 'react'
import Link from 'next/link'
import { Plus, ReceiptText, Search, Settings2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow, TableSkeleton } from '@/components/ui/table'
import { Amount, DateDisplay, EmptyState, LoadMore, PageHeader, StatusBadge } from '@/components/shared'
import { AccessNotice, useCompanyAccess } from '@/components/features/companies/company-access'
import { responseError, useCursorList } from '@/hooks/use-cursor-list'
import {
  CLAIMANT_KIND_LABELS,
  EXPENSE_STATUS_LABELS,
  EXPENSE_STATUS_TONES,
  type ExpenseReportStatus,
  type ExpenseStatusFilter,
} from '@/lib/expense-reports/status'
import { plural } from '@/lib/utils/plural'

interface ReportRow {
  id: string
  number: string
  label: string | null
  periodStart: string
  periodEnd: string
  status: ExpenseReportStatus
  claimant: { id: string; name: string; kind: 'EMPLOYEE' | 'DIRIGEANT' | 'ASSOCIE' }
  totalInclTaxCents: number
  recoverableVatCents: number
  lineCount: number
}

const FILTERS: Record<ExpenseStatusFilter, string> = {
  all: 'Toutes',
  draft: 'Brouillons',
  submitted: 'Soumises',
  validated: 'Validées',
  posted: 'Comptabilisées',
  reimbursed: 'Remboursées',
}

/**
 * Expense reports of the company (`mine`: the user's own only). A member who
 * does not validate reports sees their own on both pages.
 */
export function ExpenseReportList({ companyId, mine }: { companyId: string; mine: boolean }) {
  const { can, denied } = useCompanyAccess()
  const maySubmit = can({ expenses: ['submit'] })
  const mayManage = can({ expenses: ['validate'] })
  const [search, setSearch] = React.useState('')
  const [debounced, setDebounced] = React.useState('')
  const [status, setStatus] = React.useState<ExpenseStatusFilter>('all')

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 300)
    return () => clearTimeout(timer)
  }, [search])

  const query = new URLSearchParams({ companyId, status, mine: String(mine), ...(debounced ? { search: debounced } : {}) }).toString()
  const list = useCursorList<ReportRow>(query, async (cursor, signal) => {
    const response = await fetch(`/api/expense-reports?${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { signal })
    if (!response.ok) throw new Error(await responseError(response, 'Les notes de frais ne se sont pas chargées. Réessayez dans un instant.'))
    return response.json()
  })

  const base = `/${companyId}/expense-reports`
  const showClaimant = !mine && mayManage

  return (
    <div className="space-y-6">
      <PageHeader
        title={mine ? 'Mes notes de frais' : 'Notes de frais'}
        description={
          mine
            ? 'Les dépenses que vous avez avancées pour la société et vos trajets en véhicule personnel. Soumettez la note\u00a0: un administrateur ou le comptable la valide, puis elle est remboursée.'
            : 'Les dépenses avancées par les salariés, dirigeants et associés. Validées, elles se comptabilisent au crédit de leur compte (421, 455 ou 467) et se lettrent avec leur remboursement.'
        }
        actions={
          <>
            {!mine && mayManage ? (
              <Button variant="outline" asChild>
                <Link href={`${base}/settings`}>
                  <Settings2 aria-hidden />
                  Bénéficiaires et catégories
                </Link>
              </Button>
            ) : null}
            {maySubmit ? (
              <Button asChild>
                <Link href={`${base}/new`}>
                  <Plus aria-hidden />
                  Nouvelle note de frais
                </Link>
              </Button>
            ) : (
              <Button disabled>
                <Plus aria-hidden />
                Nouvelle note de frais
              </Button>
            )}
          </>
        }
      />
      {!maySubmit ? <AccessNotice>{denied('déposer des notes de frais')}</AccessNotice> : null}

      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-0 flex-1 basis-56">
              <Search aria-hidden className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Numéro, libellé ou bénéficiaire" aria-label="Rechercher une note de frais" className="pl-8" />
            </div>
            <Select value={status} onValueChange={(v) => setStatus(v as ExpenseStatusFilter)}>
              <SelectTrigger size="sm" className="w-44" aria-label="Statut">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(FILTERS) as ExpenseStatusFilter[]).map((value) => (
                  <SelectItem key={value} value={value}>
                    {FILTERS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {list.error ? (
            <div role="alert" className="flex flex-col items-start gap-3">
              <p className="text-sm">{list.error}</p>
              <Button size="sm" variant="outline" onClick={list.reload}>
                Réessayer
              </Button>
            </div>
          ) : !list.loading && list.items.length === 0 && !debounced && status === 'all' ? (
            <EmptyState
              icon={ReceiptText}
              title="Aucune note de frais"
              description={
                mine
                  ? 'Saisissez vos dépenses avec leur justificatif et vos trajets\u00a0: Kledg calcule la TVA récupérable et les indemnités kilométriques.'
                  : 'Les notes de frais déposées par les membres de la société apparaissent ici pour être validées et comptabilisées.'
              }
              action={
                maySubmit ? (
                  <Button size="sm" asChild>
                    <Link href={`${base}/new`}>
                      <Plus aria-hidden />
                      Nouvelle note de frais
                    </Link>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              {/* Phones: one card per report */}
              <ul className="divide-y rounded-md border lg:hidden" aria-busy={list.loading || undefined}>
                {list.items.map((report) => (
                  <li key={report.id}>
                    <Link href={`${base}/${report.id}`} className="hover:bg-muted/50 flex flex-col gap-1 px-3 py-3">
                      <span className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate font-medium">{showClaimant ? report.claimant.name : (report.label ?? report.number)}</span>
                        <Amount value={report.totalInclTaxCents / 100} />
                      </span>
                      <span className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span>
                          {report.number}, du <DateDisplay value={report.periodStart} /> au <DateDisplay value={report.periodEnd} />
                        </span>
                        <StatusBadge tone={EXPENSE_STATUS_TONES[report.status]}>{EXPENSE_STATUS_LABELS[report.status]}</StatusBadge>
                      </span>
                    </Link>
                  </li>
                ))}
                {list.loading ? <li className="text-muted-foreground px-3 py-3 text-sm">Chargement…</li> : null}
                {!list.loading && list.items.length === 0 ? <li className="text-muted-foreground px-3 py-6 text-sm">Aucune note de frais ne correspond.</li> : null}
              </ul>
              <div className="hidden lg:block">
                <Table aria-busy={list.loading || undefined}>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Numéro</TableHead>
                      {showClaimant ? <TableHead>Bénéficiaire</TableHead> : null}
                      <TableHead>Période</TableHead>
                      <TableHead>Libellé</TableHead>
                      <TableHead numeric>TVA récupérable</TableHead>
                      <TableHead numeric>À rembourser</TableHead>
                      <TableHead>Statut</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {list.loading && list.items.length === 0 ? (
                      <TableSkeleton columns={showClaimant ? 7 : 6} />
                    ) : list.items.length === 0 ? (
                      <TableEmpty colSpan={showClaimant ? 7 : 6}>Aucune note de frais ne correspond à ces filtres.</TableEmpty>
                    ) : (
                      list.items.map((report) => (
                        <TableRow key={report.id}>
                          <TableCell>
                            <Link href={`${base}/${report.id}`} className="text-link font-mono text-xs underline-offset-4 hover:underline">
                              {report.number}
                            </Link>
                          </TableCell>
                          {showClaimant ? (
                            <TableCell className="max-w-56 truncate">
                              {report.claimant.name} <span className="text-muted-foreground text-xs">{CLAIMANT_KIND_LABELS[report.claimant.kind]}</span>
                            </TableCell>
                          ) : null}
                          <TableCell>
                            <DateDisplay value={report.periodStart} /> au <DateDisplay value={report.periodEnd} />
                          </TableCell>
                          <TableCell className="max-w-64 truncate">{report.label ?? plural(report.lineCount, 'ligne', 'lignes')}</TableCell>
                          <TableCell numeric>
                            <Amount value={report.recoverableVatCents / 100} />
                          </TableCell>
                          <TableCell numeric>
                            <Amount value={report.totalInclTaxCents / 100} />
                          </TableCell>
                          <TableCell>
                            <StatusBadge tone={EXPENSE_STATUS_TONES[report.status]}>{EXPENSE_STATUS_LABELS[report.status]}</StatusBadge>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
              <LoadMore
                hasMore={list.hasMore}
                loading={list.loadingMore}
                error={list.loadMoreError}
                onLoadMore={list.loadMore}
                summary={list.items.length > 0 ? plural(list.items.length, 'note de frais affichée', 'notes de frais affichées') : undefined}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
