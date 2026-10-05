'use client'

import * as React from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Download, FileText, Plus, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow, TableSkeleton } from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Amount, DateDisplay, EmptyState, LoadMore, PageHeader, StatusBadge } from '@/components/shared'
import { AccessNotice, useCompanyAccess } from '@/components/features/companies/company-access'
import { responseError, useCursorList } from '@/hooks/use-cursor-list'
import { INVOICE_STATUS_LABELS, INVOICE_STATUS_TONES, type InvoiceStatus } from '@/lib/invoices/status'
import { invoiceOriginLabel, type InvoiceOriginCode } from '@/lib/invoices/origin'
import { plural } from '@/lib/utils/plural'
import type { InvoiceDirection } from './invoice-form'

interface InvoiceRow {
  id: string
  /** Null: a draft numbered when posted, or waiting for Qonto. */
  number: string | null
  origin: InvoiceOriginCode
  createdInQonto: boolean
  typeCode: string
  issueDate: string
  dueDate: string
  label: string | null
  tiers: { id: string; name: string; auxiliaryAccountNumber: string }
  totalExclTaxCents: number
  totalInclTaxCents: number
  remainingCents: number
  status: InvoiceStatus
  source: 'MANUAL' | 'QONTO'
}

type StatusFilter = 'all' | 'draft' | 'posted'
const STATUS_FILTERS: Record<StatusFilter, string> = { all: 'Toutes', draft: 'Brouillons', posted: 'Comptabilisées' }

interface ImportResult {
  tiers: { created: number }
  invoices: { created: number; updated: number; unchanged: number }
  refused: Array<{ reference: string; reason: string }>
  complete: boolean
  /** Drafts deleted in Qonto, removed from Kledg too. */
  removedDrafts?: number
}

export function InvoiceList({ companyId, direction }: { companyId: string; direction: InvoiceDirection }) {
  const sale = direction === 'SALE'
  const { can, denied } = useCompanyAccess()
  const mayCreate = can({ entries: ['create'] })
  const mayImport = mayCreate && can({ banking: ['read'] })
  const [search, setSearch] = React.useState('')
  const [debounced, setDebounced] = React.useState('')
  const [status, setStatus] = React.useState<StatusFilter>('all')
  const [importing, setImporting] = React.useState(false)

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 300)
    return () => clearTimeout(timer)
  }, [search])

  const query = new URLSearchParams({ companyId, direction, status, ...(debounced ? { search: debounced } : {}) }).toString()
  const list = useCursorList<InvoiceRow>(query, async (cursor, signal) => {
    const response = await fetch(`/api/invoices?${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { signal })
    if (!response.ok) throw new Error(await responseError(response, 'Les factures ne se sont pas chargées. Réessayez dans un instant.'))
    return response.json()
  })

  const importFromQonto = async () => {
    setImporting(true)
    try {
      const response = await fetch('/api/invoices/import-qonto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId }),
      })
      if (!response.ok) throw new Error(await responseError(response, 'L’import depuis Qonto n’a pas abouti. Réessayez.'))
      const result = (await response.json()) as ImportResult
      const imported = result.invoices.created + result.invoices.updated
      toast.success(
        `${plural(imported, 'facture importée', 'factures importées')}, ${plural(result.tiers.created, 'tiers créé', 'tiers créés')}` +
          (result.refused.length ? ` ; ${plural(result.refused.length, 'facture écartée', 'factures écartées')} (${result.refused[0].reference} : ${result.refused[0].reason})` : '') +
          (result.removedDrafts ? ` ; ${plural(result.removedDrafts, 'brouillon supprimé dans Qonto retiré', 'brouillons supprimés dans Qonto retirés')}` : ''),
      )
      list.reload()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setImporting(false)
    }
  }

  const title = sale ? 'Factures de vente' : 'Factures d’achat'
  const base = `/${companyId}/invoices`

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        description={
          sale
            ? 'Les factures émises à vos clients, avec leurs lignes et leur TVA par taux. Comptabilisées, elles passent au journal des ventes et se lettrent avec leurs encaissements.'
            : 'Les factures reçues de vos fournisseurs. Comptabilisées, elles passent au journal des achats et se lettrent avec leurs paiements.'
        }
        actions={
          <>
            <Button variant="outline" onClick={importFromQonto} disabled={!mayImport} loading={importing}>
              <Download aria-hidden />
              Importer de Qonto
            </Button>
            {mayCreate ? (
              <Button asChild>
                <Link href={`${base}/new?direction=${direction}`}>
                  <Plus aria-hidden />
                  Nouvelle facture
                </Link>
              </Button>
            ) : (
              <Button disabled>
                <Plus aria-hidden />
                Nouvelle facture
              </Button>
            )}
          </>
        }
      />
      {!mayCreate ? <AccessNotice>{denied('enregistrer des factures')}</AccessNotice> : null}

      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-0 flex-1 basis-56">
              <Search aria-hidden className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Numéro, libellé ou tiers"
                aria-label="Rechercher une facture"
                className="pl-8"
              />
            </div>
            <ToggleGroup type="single" variant="outline" size="sm" value={status} onValueChange={(v) => v && setStatus(v as StatusFilter)} aria-label="Statut">
              {(Object.keys(STATUS_FILTERS) as StatusFilter[]).map((value) => (
                <ToggleGroupItem key={value} value={value}>
                  {STATUS_FILTERS[value]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
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
              icon={FileText}
              title={sale ? 'Aucune facture de vente' : 'Aucune facture d’achat'}
              description={
                sale
                  ? 'Enregistrez les factures que vous émettez, ou importez celles de Qonto. Une facture s’adresse à un client\u00a0: ajoutez-le d’abord s’il n’existe pas encore.'
                  : 'Enregistrez les factures de vos fournisseurs, ou importez celles déposées dans Qonto.'
              }
              action={
                mayCreate ? (
                  <Button size="sm" asChild>
                    <Link href={`${base}/new?direction=${direction}`}>
                      <Plus aria-hidden />
                      Nouvelle facture
                    </Link>
                  </Button>
                ) : undefined
              }
              secondaryAction={
                sale ? (
                  <Button size="sm" variant="outline" asChild>
                    <Link href={`/${companyId}/tiers/new`}>Ajouter un client</Link>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              {/* Phones: one card per invoice */}
              <ul className="divide-y rounded-md border lg:hidden" aria-busy={list.loading || undefined}>
                {list.items.map((invoice) => (
                  <li key={invoice.id}>
                    <Link href={`${base}/${invoice.id}`} className="hover:bg-muted/50 flex flex-col gap-1 px-3 py-3">
                      <span className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate font-medium">{invoice.tiers.name}</span>
                        <Amount value={invoice.totalInclTaxCents / 100} />
                      </span>
                      <span className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span>
                          {invoice.typeCode === '381' ? 'Avoir ' : ''}
                          {invoice.number ? `n°\u00a0${invoice.number}` : 'numéro à l’émission'}, <DateDisplay value={invoice.issueDate} />
                          {sale && invoiceOriginLabel(invoice.origin, invoice.createdInQonto) ? `, ${invoiceOriginLabel(invoice.origin, invoice.createdInQonto)?.toLowerCase()}` : ''}
                        </span>
                        <StatusBadge tone={INVOICE_STATUS_TONES[invoice.status]}>{INVOICE_STATUS_LABELS[invoice.status]}</StatusBadge>
                      </span>
                    </Link>
                  </li>
                ))}
                {list.loading ? <li className="text-muted-foreground px-3 py-3 text-sm">Chargement…</li> : null}
                {!list.loading && list.items.length === 0 ? <li className="text-muted-foreground px-3 py-6 text-sm">Aucune facture ne correspond.</li> : null}
              </ul>
              <div className="hidden lg:block">
                <Table aria-busy={list.loading || undefined}>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Numéro</TableHead>
                      <TableHead>{sale ? 'Client' : 'Fournisseur'}</TableHead>
                      <TableHead>Échéance</TableHead>
                      <TableHead numeric>Total HT</TableHead>
                      <TableHead numeric>Total TTC</TableHead>
                      <TableHead numeric>Reste dû</TableHead>
                      <TableHead>Statut</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {list.loading && list.items.length === 0 ? (
                      <TableSkeleton columns={8} />
                    ) : list.items.length === 0 ? (
                      <TableEmpty colSpan={8}>Aucune facture ne correspond à ces filtres.</TableEmpty>
                    ) : (
                      list.items.map((invoice) => (
                        <TableRow key={invoice.id}>
                          <TableCell>
                            <DateDisplay value={invoice.issueDate} />
                          </TableCell>
                          <TableCell>
                            <Link href={`${base}/${invoice.id}`} className="text-link underline-offset-4 hover:underline">
                              {invoice.typeCode === '381' ? 'Avoir ' : ''}
                              {invoice.number ?? <span className="text-muted-foreground">À l’émission</span>}
                            </Link>
                            {sale && invoiceOriginLabel(invoice.origin, invoice.createdInQonto) ? (
                              <span className="text-muted-foreground block text-xs">{invoiceOriginLabel(invoice.origin, invoice.createdInQonto)}</span>
                            ) : null}
                          </TableCell>
                          <TableCell className="max-w-64 truncate">
                            {invoice.tiers.name} <span className="text-muted-foreground font-mono text-xs">{invoice.tiers.auxiliaryAccountNumber}</span>
                          </TableCell>
                          <TableCell>
                            <DateDisplay value={invoice.dueDate} />
                          </TableCell>
                          <TableCell numeric>
                            <Amount value={invoice.totalExclTaxCents / 100} />
                          </TableCell>
                          <TableCell numeric>
                            <Amount value={invoice.totalInclTaxCents / 100} />
                          </TableCell>
                          <TableCell numeric>
                            <Amount value={invoice.remainingCents / 100} />
                          </TableCell>
                          <TableCell>
                            <StatusBadge tone={INVOICE_STATUS_TONES[invoice.status]}>{INVOICE_STATUS_LABELS[invoice.status]}</StatusBadge>
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
                summary={list.items.length > 0 ? plural(list.items.length, 'facture affichée', 'factures affichées') : undefined}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
