'use client'

import * as React from 'react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowRight, FileCheck2, RefreshCw, RotateCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AmountInput } from '@/components/ui/amount-input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow, TableSkeleton } from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Amount, DateDisplay, EmptyState, HelpTip, PageHeader, StatusBadge } from '@/components/shared'
import { FiscalYearSelector } from '@/components/features/accounting/fiscal-year-selector'
import { bankAccountName } from '@/components/features/banking/format'
import { useCompanyAccess } from '@/components/features/companies/company-access'
import { responseError } from '@/hooks/use-cursor-list'
import { centsToDecimal } from '@/lib/utils/money'
import { plural } from '@/lib/utils/plural'
import type { MissingReceipts, MissingReceipt } from '@/lib/banking/missing-receipts.service'

type Side = 'debit' | 'credit' | 'all'

/** Direction asked by a link (?side=all from the simple mode home, which counts both), expenses by default. */
function sideFromUrl(params: URLSearchParams | null): Side {
  const side = params?.get('side')
  return side === 'credit' || side === 'all' ? side : 'debit'
}
const ALL_ACCOUNTS = '__all__'
const THRESHOLD_KEY = 'kledg:missingReceipts:threshold'

function readThreshold(): number | null {
  try {
    const value = window.localStorage.getItem(THRESHOLD_KEY)
    return value && /^\d+$/.test(value) ? Number(value) : null
  } catch {
    return null
  }
}

function writeThreshold(cents: number | null) {
  try {
    if (cents === null) window.localStorage.removeItem(THRESHOLD_KEY)
    else window.localStorage.setItem(THRESHOLD_KEY, String(cents))
  } catch {
    // Storage blocked: the threshold is only remembered for this visit.
  }
}

/** The transactions list filtered on one transaction: its account, its day, without receipt, its label. */
function transactionHref(companyId: string, t: MissingReceipt): string {
  const query = new URLSearchParams({ bankAccountId: t.bankAccount.id, startDate: t.date, endDate: t.date, hasAttachments: 'without' })
  const search = t.counterpartyName || t.label
  if (search) query.set('search', search)
  return `/${companyId}/transactions?${query}`
}

export default function MissingReceiptsPage() {
  const params = useParams()
  const companyId = params?.companyId as string
  const { can } = useCompanyAccess()
  const [fiscalYearId, setFiscalYearId] = React.useState('')
  const [bankAccounts, setBankAccounts] = React.useState<Array<{ id: string; name: string; displayName?: string | null; iban?: string | null }>>([])
  const [bankAccountId, setBankAccountId] = React.useState(ALL_ACCOUNTS)
  const [thresholdCents, setThresholdCents] = React.useState<number | null>(null)
  const searchParams = useSearchParams()
  const [side, setSide] = React.useState<Side>(() => sideFromUrl(searchParams))
  const [data, setData] = React.useState<MissingReceipts | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [syncing, setSyncing] = React.useState(false)
  const [version, setVersion] = React.useState(0)

  React.useEffect(() => {
    setThresholdCents(readThreshold())
  }, [])

  React.useEffect(() => {
    if (!companyId) return
    let cancelled = false
    fetch(`/api/banking/accounts?companyId=${companyId}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((result) => {
        if (!cancelled && result) setBankAccounts(result.accounts ?? [])
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [companyId])

  React.useEffect(() => {
    if (!companyId || !fiscalYearId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    const query = new URLSearchParams({ companyId, fiscalYearId, side })
    if (bankAccountId !== ALL_ACCOUNTS) query.set('bankAccountId', bankAccountId)
    if (thresholdCents) query.set('minAmount', centsToDecimal(thresholdCents))
    fetch(`/api/banking/missing-receipts?${query}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response, "La liste ne s'est pas chargée. Réessayez dans un instant."))
        return response.json() as Promise<MissingReceipts>
      })
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [companyId, fiscalYearId, bankAccountId, thresholdCents, side, version])

  const syncReceipts = async () => {
    setSyncing(true)
    try {
      const response = await fetch('/api/banking/attachments/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId }),
      })
      if (!response.ok) throw new Error(await responseError(response, "La synchronisation des justificatifs n'a pas abouti. Réessayez."))
      toast.success('Justificatifs synchronisés')
      setVersion((n) => n + 1)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Justificatifs"
        description="Les opérations bancaires sans pièce justificative. Chaque écriture s'appuie sur une pièce, à conserver dix ans (Code de commerce, art. L123-22)&nbsp;: déposez-la dans votre banque, puis synchronisez."
        actions={
          can({ banking: ['reconcile'] }) ? (
            <Button variant="outline" onClick={syncReceipts} disabled={syncing} loading={syncing}>
              <RefreshCw aria-hidden />
              Synchroniser les justificatifs
            </Button>
          ) : null
        }
      />

      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="receipts-fiscal-year">Exercice</Label>
            <FiscalYearSelector companyId={companyId} value={fiscalYearId} onValueChange={setFiscalYearId} showLabel={false} showPeriod={false} id="receipts-fiscal-year" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="receipts-account">Compte bancaire</Label>
            <Select value={bankAccountId} onValueChange={setBankAccountId}>
              <SelectTrigger id="receipts-account" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_ACCOUNTS}>Tous les comptes</SelectItem>
                {bankAccounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {bankAccountName(account)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="receipts-threshold" className="flex items-center gap-1.5">
              À partir de
              <HelpTip term="Seuil">Les opérations d&apos;un montant inférieur sont masquées. Laissez vide pour tout afficher.</HelpTip>
            </Label>
            <AmountInput
              id="receipts-threshold"
              value={thresholdCents}
              placeholder="ex. 50,00"
              onValueChange={(cents) => {
                setThresholdCents(cents)
                writeThreshold(cents)
              }}
            />
          </div>
          <div className="space-y-2">
            <span className="text-sm leading-none font-medium" id="receipts-side-label">
              Sens
            </span>
            <ToggleGroup
              type="single"
              variant="outline"
              value={side}
              onValueChange={(value) => {
                if (value) setSide(value as Side)
              }}
              aria-labelledby="receipts-side-label"
              className="w-full"
            >
              <ToggleGroupItem value="debit" className="flex-1">
                Dépenses
              </ToggleGroupItem>
              <ToggleGroupItem value="credit" className="flex-1">
                Recettes
              </ToggleGroupItem>
              <ToggleGroupItem value="all" className="flex-1">
                Toutes
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3" role="alert">
            <p className="text-sm">{error}</p>
            <Button size="sm" variant="outline" onClick={() => setVersion((n) => n + 1)}>
              <RotateCw aria-hidden />
              Réessayer
            </Button>
          </CardContent>
        </Card>
      ) : data && data.count === 0 && !loading ? (
        <EmptyState
          bordered
          icon={FileCheck2}
          tone="success"
          title="Aucun justificatif manquant"
          description="Toutes les opérations de la période et du seuil choisis ont leur pièce justificative."
        />
      ) : (
        <Card aria-busy={loading || undefined}>
          <CardHeader>
            <CardTitle>
              {data ? plural(data.count, 'opération sans justificatif', 'opérations sans justificatif') : 'Opérations sans justificatif'}
            </CardTitle>
            {data ? (
              <CardDescription>
                Total <Amount value={data.totalCents / 100} />
                {data.truncated ? `, les ${data.transactions.length} plus récentes affichées` : ''}.
              </CardDescription>
            ) : null}
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-md border lg:hidden" aria-label="Opérations sans justificatif">
              {(data?.transactions ?? []).map((t) => (
                <li key={t.id}>
                  <Link href={transactionHref(companyId, t)} className="hover:bg-muted/60 flex items-start justify-between gap-3 px-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{t.counterpartyName || t.label || 'Opération sans libellé'}</span>
                      <span className="text-muted-foreground block truncate text-xs">
                        <DateDisplay value={t.date} /> · {bankAccountName(t.bankAccount)}
                      </span>
                    </span>
                    <Amount value={t.amountCents / 100} sign="always" className="shrink-0 text-sm" />
                  </Link>
                </li>
              ))}
            </ul>
            <div className="hidden rounded-md border lg:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">Date</TableHead>
                    <TableHead>Opération</TableHead>
                    <TableHead>Compte bancaire</TableHead>
                    <TableHead numeric>Montant</TableHead>
                    <TableHead className="w-28">Rapprochement</TableHead>
                    <TableHead className="w-40">
                      <span className="sr-only">Action</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && !data ? (
                    <TableSkeleton columns={6} />
                  ) : !data || data.transactions.length === 0 ? (
                    <TableEmpty colSpan={6}>Aucune opération.</TableEmpty>
                  ) : (
                    data.transactions.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell>
                          <DateDisplay value={t.date} />
                        </TableCell>
                        <TableCell className="max-w-80">
                          <span className="block truncate">{t.counterpartyName || t.label || 'Opération sans libellé'}</span>
                          {t.counterpartyName && t.label ? <span className="text-muted-foreground block truncate text-xs">{t.label}</span> : null}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{bankAccountName(t.bankAccount)}</TableCell>
                        <TableCell numeric>
                          <Amount value={t.amountCents / 100} sign="always" />
                        </TableCell>
                        <TableCell>
                          {t.reconciled ? <StatusBadge tone="success">Rapprochée</StatusBadge> : <StatusBadge tone="neutral">À rapprocher</StatusBadge>}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button asChild size="xs" variant="outline">
                            <Link href={transactionHref(companyId, t)}>
                              Voir la transaction
                              <ArrowRight aria-hidden />
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
