'use client'

import * as React from 'react'
import Link from 'next/link'
import { Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DateDisplay, EmptyState, PageHeader, StatusBadge } from '@/components/shared'
import { AccessNotice, useCompanyAccess } from '@/components/features/companies/company-access'
import { ALLOCATION_KEY_LABELS, formatRateBp } from '@/lib/management-fees/rules'
import { formatCentsFr } from '@/lib/utils/money'
import { plural } from '@/lib/utils/plural'
import { request, type ConventionView } from './api'
import { ConventionForm } from './convention-form'
import { ConventionDetail } from './convention-detail'

function pricingSummary(c: ConventionView): string {
  return c.pricing === 'FIXED' ? `Forfait de ${formatCentsFr(c.fixedAmountCents ?? 0)} € HT par période` : `Coûts majorés de ${formatRateBp(c.markupBp)}`
}

/** Loads a JSON resource with the three states of a client fetch. */
function useResource<T>(url: string) {
  const [data, setData] = React.useState<T | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [version, setVersion] = React.useState(0)
  React.useEffect(() => {
    let cancelled = false
    request<T>(url, {}, 'Le chargement n’a pas abouti. Réessayez.')
      .then((d) => !cancelled && setData(d))
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [url, version])
  const reload = () => {
    setError(null)
    setVersion((v) => v + 1)
  }
  return { data, error, reload }
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card>
      <CardContent role="alert" className="flex flex-col items-start gap-3">
        <p className="text-sm">{message}</p>
        <Button size="sm" variant="outline" onClick={onRetry}>
          Réessayer
        </Button>
      </CardContent>
    </Card>
  )
}

/** /management-fees: the conventions of the holding. */
export function ManagementFeesPage({ companyId }: { companyId: string }) {
  const { can, denied } = useCompanyAccess()
  const mayWrite = can({ entries: ['create'] })
  const { data, error, reload } = useResource<ConventionView[]>(`/api/management-fees/conventions?companyId=${encodeURIComponent(companyId)}`)
  const newButton = mayWrite ? (
    <Button size="sm" asChild>
      <Link href={`/${companyId}/management-fees/new`}>
        <Plus aria-hidden />
        Nouvelle convention
      </Link>
    </Button>
  ) : null

  return (
    <div className="space-y-6">
      <PageHeader
        title="Frais de gestion"
        description="Les services que la holding rend à ses filiales (direction, comptabilité, informatique) et leur refacturation&nbsp;: une convention, un prix de pleine concurrence, une facture par filiale et par période."
        actions={newButton}
      />
      {!mayWrite ? <AccessNotice>{denied('créer une convention ou des factures')}</AccessNotice> : null}
      {error ? (
        <LoadError message={error} onRetry={reload} />
      ) : data === null ? (
        <Card aria-busy>
          <CardContent className="space-y-3">
            <Skeleton className="h-5 w-64" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
          </CardContent>
        </Card>
      ) : data.length === 0 ? (
        <EmptyState
          bordered
          title="Aucune convention de frais de gestion"
          description="Créez la convention qui lie la holding à ses filiales&nbsp;: la méthode de prix, la marge, la clé de répartition. Kledg calcule ensuite le montant de chaque filiale et prépare les factures."
          action={newButton}
        />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Convention</TableHead>
                <TableHead className="hidden md:table-cell">Prix</TableHead>
                <TableHead className="hidden lg:table-cell">Répartition</TableHead>
                <TableHead>Filiales</TableHead>
                <TableHead className="hidden sm:table-cell">Période</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="whitespace-normal">
                    <Link href={`/${companyId}/management-fees/${c.id}`} className="text-link font-medium hover:underline pointer-coarse:-my-3 pointer-coarse:py-3">
                      {c.label}
                    </Link>
                    <span className="text-muted-foreground block text-xs">{c.billingCount > 0 ? plural(c.billingCount, 'facturation', 'facturations') : 'Jamais facturée'}</span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{pricingSummary(c)}</TableCell>
                  <TableCell className="hidden lg:table-cell">{ALLOCATION_KEY_LABELS[c.allocationKey]}</TableCell>
                  <TableCell className="whitespace-normal">{c.subsidiaries.map((s) => s.name ?? 'Société non accessible').join(', ')}</TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {c.endDate ? (
                      <StatusBadge tone="neutral">
                        Jusqu’au <DateDisplay value={c.endDate} />
                      </StatusBadge>
                    ) : (
                      <span>
                        Depuis le <DateDisplay value={c.startDate} />
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  )
}

export function NewConventionPage({ companyId }: { companyId: string }) {
  return (
    <div className="space-y-6">
      <PageHeader title="Nouvelle convention" description="Les filiales, la méthode de prix et la clé de répartition des frais de gestion." />
      <ConventionForm companyId={companyId} />
    </div>
  )
}

export function EditConventionPage({ companyId, conventionId }: { companyId: string; conventionId: string }) {
  const { data, error, reload } = useResource<ConventionView>(`/api/management-fees/conventions/${conventionId}`)
  if (error) return <LoadError message={error} onRetry={reload} />
  if (!data) {
    return (
      <div className="space-y-4" aria-busy>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  return (
    <div className="space-y-6">
      <PageHeader title={`Modifier la convention`} description="Les factures déjà établies gardent leurs montants." />
      <ConventionForm companyId={companyId} convention={data} />
    </div>
  )
}

export function ConventionPage({ companyId, conventionId }: { companyId: string; conventionId: string }) {
  const { data, error, reload } = useResource<ConventionView>(`/api/management-fees/conventions/${conventionId}`)
  if (error) return <LoadError message={error} onRetry={reload} />
  if (!data) {
    return (
      <div className="space-y-4" aria-busy>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  return <ConventionDetail companyId={companyId} convention={data} onChanged={reload} />
}
