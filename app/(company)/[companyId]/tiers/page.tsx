'use client'

import * as React from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { toast } from 'sonner'
import { Contact, Plus, Search, Wand2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow, TableSkeleton } from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { EmptyState, PageHeader, StatusBadge } from '@/components/shared'
import { AccessNotice, useCompanyAccess } from '@/components/features/companies/company-access'
import { responseError } from '@/hooks/use-cursor-list'
import { describePaymentTerms } from '@/lib/reports/third-parties/payment-terms'
import { TIERS_KIND_LABELS } from '@/lib/tiers/rules'
import { plural } from '@/lib/utils/plural'

interface TiersRow {
  id: string
  kind: 'CUSTOMER' | 'SUPPLIER'
  name: string
  siren: string | null
  vatNumber: string | null
  auxiliaryAccountNumber: string
  paymentTermsDays: number | null
  paymentTermsEndOfMonth: boolean | null
  qontoId: string | null
  _count: { invoices: number }
}

type KindFilter = 'ALL' | 'CUSTOMER' | 'SUPPLIER'

export default function TiersPage() {
  const params = useParams()
  const companyId = params.companyId as string
  const { can, denied } = useCompanyAccess()
  const mayCreate = can({ entries: ['create'] })
  const [kind, setKind] = React.useState<KindFilter>('ALL')
  const [search, setSearch] = React.useState('')
  const [debounced, setDebounced] = React.useState('')
  const [data, setData] = React.useState<{ tiers: TiersRow[]; total: number; truncated: boolean } | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [version, setVersion] = React.useState(0)

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 300)
    return () => clearTimeout(timer)
  }, [search])

  React.useEffect(() => {
    let cancelled = false
    const query = new URLSearchParams({ companyId, ...(kind !== 'ALL' ? { kind } : {}), ...(debounced ? { search: debounced } : {}) })
    fetch(`/api/tiers?${query}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response, 'Les tiers ne se sont pas chargés. Réessayez.'))
        return response.json()
      })
      .then((result) => {
        if (cancelled) return
        setData(result)
        setError(null)
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [companyId, kind, debounced, version])

  const attach = async () => {
    setBusy(true)
    try {
      const response = await fetch('/api/tiers/attach-auxiliary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId }),
      })
      if (!response.ok) throw new Error(await responseError(response, 'La création des tiers n’a pas abouti. Réessayez.'))
      const result = (await response.json()) as { created: number; alreadyAttached: number; skipped: Array<{ auxiliaryAccountNumber: string; reason: string }> }
      toast.success(
        `${plural(result.created, 'tiers créé', 'tiers créés')}, ${plural(result.alreadyAttached, 'compte déjà relié', 'comptes déjà reliés')}` +
          (result.skipped.length ? ` ; ${result.skipped[0].auxiliaryAccountNumber} : ${result.skipped[0].reason}` : ''),
      )
      setVersion((v) => v + 1)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tiers"
        description="Vos clients et fournisseurs. Le compte auxiliaire de chacun relie ses factures, son lettrage et sa balance âgée."
        actions={
          <>
            <Button variant="outline" onClick={attach} disabled={!mayCreate} loading={busy}>
              <Wand2 aria-hidden />
              Créer depuis les écritures
            </Button>
            {mayCreate ? (
              <Button asChild>
                <Link href={`/${companyId}/tiers/new`}>
                  <Plus aria-hidden />
                  Nouveau tiers
                </Link>
              </Button>
            ) : (
              <Button disabled>
                <Plus aria-hidden />
                Nouveau tiers
              </Button>
            )}
          </>
        }
      />
      {!mayCreate ? <AccessNotice>{denied('créer des tiers')}</AccessNotice> : null}

      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-0 flex-1 basis-56">
              <Search aria-hidden className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nom, compte auxiliaire, SIREN" aria-label="Rechercher un tiers" className="pl-8" />
            </div>
            <ToggleGroup type="single" variant="outline" size="sm" value={kind} onValueChange={(v) => v && setKind(v as KindFilter)} aria-label="Type de tiers">
              <ToggleGroupItem value="ALL">Tous</ToggleGroupItem>
              <ToggleGroupItem value="CUSTOMER">Clients</ToggleGroupItem>
              <ToggleGroupItem value="SUPPLIER">Fournisseurs</ToggleGroupItem>
            </ToggleGroup>
          </div>

          {error ? (
            <div role="alert" className="flex flex-col items-start gap-3">
              <p className="text-sm">{error}</p>
              <Button size="sm" variant="outline" onClick={() => setVersion((v) => v + 1)}>
                Réessayer
              </Button>
            </div>
          ) : data && data.total === 0 && !debounced && kind === 'ALL' ? (
            <EmptyState
              icon={Contact}
              title="Aucun tiers pour cette société"
              description="Créez vos clients et fournisseurs, ou laissez Kledg les créer à partir des comptes auxiliaires de vos écritures (import FEC par exemple)."
            />
          ) : (
            <>
              <ul className="divide-y rounded-md border lg:hidden">
                {(data?.tiers ?? []).map((t) => (
                  <li key={t.id}>
                    <Link href={`/${companyId}/tiers/${t.id}`} className="hover:bg-muted/50 flex items-center justify-between gap-3 px-3 py-3">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{t.name}</span>
                        <span className="text-muted-foreground font-mono text-xs">{t.auxiliaryAccountNumber}</span>
                      </span>
                      <StatusBadge tone={t.kind === 'CUSTOMER' ? 'info' : 'neutral'}>{TIERS_KIND_LABELS[t.kind]}</StatusBadge>
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="hidden lg:block">
                <Table aria-busy={!data || undefined}>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nom</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Compte auxiliaire</TableHead>
                      <TableHead>SIREN</TableHead>
                      <TableHead>Délai de paiement</TableHead>
                      <TableHead numeric>Factures</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!data ? (
                      <TableSkeleton columns={6} />
                    ) : data.tiers.length === 0 ? (
                      <TableEmpty colSpan={6}>Aucun tiers ne correspond à cette recherche.</TableEmpty>
                    ) : (
                      data.tiers.map((t) => (
                        <TableRow key={t.id}>
                          <TableCell>
                            <Link href={`/${companyId}/tiers/${t.id}`} className="text-link underline-offset-4 hover:underline">
                              {t.name}
                            </Link>
                            {t.qontoId ? <span className="text-muted-foreground ml-2 text-xs">Qonto</span> : null}
                          </TableCell>
                          <TableCell>{TIERS_KIND_LABELS[t.kind]}</TableCell>
                          <TableCell className="font-mono text-xs">{t.auxiliaryAccountNumber}</TableCell>
                          <TableCell className="font-mono text-xs">{t.siren ?? ''}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {t.paymentTermsDays === null ? 'Celui de la société' : describePaymentTerms({ days: t.paymentTermsDays, endOfMonth: t.paymentTermsEndOfMonth ?? false })}
                          </TableCell>
                          <TableCell numeric>{t._count.invoices}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
              {data ? (
                <p className="text-muted-foreground text-sm">
                  {plural(data.total, 'tiers', 'tiers')}
                  {data.truncated ? `, ${data.tiers.length} affichés : affinez la recherche pour voir les autres.` : ''}
                </p>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
