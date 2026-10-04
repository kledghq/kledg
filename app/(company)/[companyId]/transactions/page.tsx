'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { toast } from 'sonner'

import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { NoCompanySelected } from '@/components/features/companies/no-company-selected'
import { TransactionsDataTable, type BankTransaction } from '@/components/features/data-table/transactions-data-table'
import {
  EMPTY_TRANSACTION_FILTERS,
  TransactionFiltersComponent,
  transactionFilterParams,
  type TransactionFilters,
} from '@/components/features/accounting/transaction-filters'
import { PageHeader, SyncButton } from '@/components/shared'
import { responseError, useCursorList, type CursorPage } from '@/hooks/use-cursor-list'
import { useDefaultFiscalYear } from '@/hooks/use-default-fiscal-year'
import { docsUrl } from '@/lib/docs-links'
import { logger } from '@/lib/logger'

/** Transactions per page: enough to fill a screen, small enough to answer fast on years of history. */
const PAGE_SIZE = 100

/** How far back a bank sync goes. */
const SYNC_PERIODS = [
  { days: '30', label: '30 derniers jours' },
  { days: '90', label: '90 derniers jours' },
  { days: '180', label: '6 derniers mois' },
  { days: '365', label: '12 derniers mois' },
]

interface Categories {
  cashflowCategories: string[]
  cashflowSubcategories: string[]
  categories: string[]
  operationTypes: string[]
}

export default function TransactionsPage() {
  const params = useParams()
  const companyId = params?.companyId as string
  const [bankAccounts, setBankAccounts] = useState<Array<{ id: string; name: string; displayName?: string | null }>>([])
  const [categories, setCategories] = useState<Categories | undefined>(undefined)
  const [syncing, setSyncing] = useState(false)
  const [syncDays, setSyncDays] = useState('90')
  const [chosenFilters, setFilters] = useState<TransactionFilters>(EMPTY_TRANSACTION_FILTERS)
  // The list starts on the open fiscal year, known before the first request
  const defaultYear = useDefaultFiscalYear(companyId)
  const filters = useMemo(
    () => ({ ...chosenFilters, fiscalYearId: chosenFilters.fiscalYearId ?? defaultYear.fiscalYearId }),
    [chosenFilters, defaultYear.fiscalYearId],
  )

  const query = useMemo(() => {
    const search = transactionFilterParams(filters)
    search.set('companyId', companyId ?? '')
    search.set('limit', String(PAGE_SIZE))
    return search.toString()
  }, [filters, companyId])

  const fetchPage = useCallback(
    async (cursor: string | null, signal: AbortSignal): Promise<CursorPage<BankTransaction, { balanceBefore?: number }>> => {
      const response = await fetch(`/api/transactions?${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { signal })
      if (!response.ok) throw new Error(await responseError(response, 'Les transactions ne se sont pas chargées. Réessayez dans un instant.'))
      const data = (await response.json()) as { transactions: BankTransaction[]; nextCursor?: string; balanceBefore?: number }
      return {
        items: data.transactions ?? [],
        nextCursor: data.nextCursor ?? null,
        meta: { balanceBefore: typeof data.balanceBefore === 'number' ? data.balanceBefore : undefined },
      }
    },
    [query],
  )
  const list = useCursorList(query, fetchPage, defaultYear.ready)

  // Bank accounts of the filter; reloaded after a sync (new accounts, balances)
  const [accountsVersion, setAccountsVersion] = useState(0)
  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    fetch(`/api/banking/accounts?companyId=${companyId}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data) setBankAccounts(data.accounts ?? [])
      })
      .catch((error) => logger.error('Error loading bank accounts:', error))
    return () => {
      cancelled = true
    }
  }, [companyId, accountsVersion])

  useEffect(() => {
    if (!companyId) return
    // Values offered by the category filters (distinct provider categories)
    fetch(`/api/transactions?${new URLSearchParams({ companyId, categoriesOnly: 'true' })}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data?.categories) setCategories(data.categories)
      })
      .catch((error) => logger.error('Error loading categories:', error))
  }, [companyId])

  const handleSync = async () => {
    if (!companyId) return
    setSyncing(true)
    try {
      const response = await fetch('/api/integrations/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, maxDays: Number(syncDays) }),
      })
      if (!response.ok) {
        toast.error(await responseError(response, 'La synchronisation a échoué. Réessayez dans un instant.'))
        return
      }
      const result = await response.json()
      if (!result.success) {
        const detail = Array.isArray(result.errors) && result.errors.length > 0 ? ` : ${result.errors.join(', ')}` : ''
        toast.error(`La synchronisation a échoué${detail}`)
        return
      }
      // Receipts attached to the bank transactions (best effort)
      await fetch('/api/banking/attachments/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId }),
      }).catch(() => undefined)
      const items = Number(result.totalItemsSynced ?? 0)
      toast.success(`Synchronisation terminée\u00a0: ${items} élément${items > 1 ? 's' : ''} importé${items > 1 ? 's' : ''}`)
      list.reload()
      setAccountsVersion((n) => n + 1)
    } catch (error) {
      logger.error('Error syncing:', error)
      toast.error('Le serveur n\'a pas répondu. Vérifiez votre connexion puis réessayez.')
    } finally {
      setSyncing(false)
    }
  }

  if (!companyId) {
    return <NoCompanySelected />
  }

  const filtered = transactionFilterParams({ ...filters, fiscalYearId: undefined }).toString() !== ''

  return (
    <div className="space-y-6">
      <PageHeader
        title="Transactions"
        description="Les opérations de vos comptes bancaires, à rapprocher avec les écritures."
        docsHref={docsUrl('bankReconciliation')}
        actions={
          <>
            <Label htmlFor="sync-period" className="sr-only">
              Période à synchroniser
            </Label>
            <Select value={syncDays} onValueChange={setSyncDays} disabled={syncing}>
              <SelectTrigger id="sync-period" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SYNC_PERIODS.map((period) => (
                  <SelectItem key={period.days} value={period.days}>
                    {period.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <SyncButton syncing={syncing} onClick={handleSync} />
          </>
        }
      />

      <TransactionFiltersComponent
        filters={filters}
        onFiltersChange={setFilters}
        bankAccounts={bankAccounts}
        availableCategories={categories}
        companyId={companyId}
      />

      <Card className="py-4">
        <CardContent className="px-4">
          <TransactionsDataTable
            data={list.items}
            loading={list.loading || !defaultYear.ready}
            error={list.error}
            onRetry={list.reload}
            hasMore={list.hasMore}
            loadingMore={list.loadingMore}
            loadMoreError={list.loadMoreError}
            onLoadMore={list.loadMore}
            companyId={companyId}
            onRefresh={list.reload}
            balanceBefore={list.meta?.balanceBefore}
            empty={
              filtered
                ? 'Aucune transaction ne correspond aux filtres. Élargissez la période ou retirez un filtre.'
                : "Aucune transaction sur cet exercice. Connectez une banque ou importez un relevé depuis l'espace Banque."
            }
          />
        </CardContent>
      </Card>
    </div>
  )
}
