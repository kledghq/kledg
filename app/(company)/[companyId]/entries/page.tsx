'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Plus, Upload } from 'lucide-react'

import { EntriesList, type EntryListItem } from '@/components/features/accounting/entries-list'
import { EntriesFilters, entriesFilterParams, type EntriesFilters as EntriesFiltersType } from '@/components/features/accounting/entries-filters'
import { Button } from '@/components/ui/button'
import { NoCompanySelected } from '@/components/features/companies/no-company-selected'
import { PageHeader } from '@/components/shared'
import { ImportDialog, type ImportResult } from '@/components/features/import/import-dialog'
import { LastImportSummary } from '@/components/features/import/last-import-summary'
import { responseError, useCursorList } from '@/hooks/use-cursor-list'
import { useDefaultFiscalYear } from '@/hooks/use-default-fiscal-year'
import { docsUrl } from '@/lib/docs-links'
import { logger } from '@/lib/logger'

/** Entries per page: each carries its lines, so pages stay smaller than for transactions. */
const PAGE_SIZE = 50

interface Journal {
  id: string
  code: string
  label: string
}

export default function EntriesPage() {
  const params = useParams()
  const companyId = params?.companyId as string
  const [journals, setJournals] = useState<Journal[]>([])
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  // ?statut=brouillon (link "Voir les brouillons" of the dashboard) opens the list on the drafts.
  const searchParams = useSearchParams()
  const [filters, setFilters] = useState<EntriesFiltersType>(() =>
    searchParams?.get('statut') === 'brouillon' ? { status: 'draft' } : {},
  )
  const fiscalYear = useDefaultFiscalYear(companyId)
  const [lastImportResult, setLastImportResult] = useState<ImportResult | null>(null)

  const lastImportStorageKey = companyId ? `kledg:lastImport:${companyId}` : null

  // The summary of the last import survives a reload of the page (session
  // only). Read after mount: the server render has no sessionStorage.
  useEffect(() => {
    if (!lastImportStorageKey) return
    let stored: ImportResult | null = null
    try {
      const raw = sessionStorage.getItem(lastImportStorageKey)
      stored = raw ? (JSON.parse(raw) as ImportResult) : null
    } catch {
      // ignore corrupted storage entries
    }
    if (stored) queueMicrotask(() => setLastImportResult(stored))
  }, [lastImportStorageKey])

  const query = useMemo(() => {
    const search = entriesFilterParams(filters)
    search.set('companyId', companyId ?? '')
    if (fiscalYear.fiscalYearId) search.set('fiscalYearId', fiscalYear.fiscalYearId)
    search.set('limit', String(PAGE_SIZE))
    return search.toString()
  }, [filters, companyId, fiscalYear.fiscalYearId])

  const fetchPage = useCallback(
    async (cursor: string | null, signal: AbortSignal) => {
      const response = await fetch(`/api/entries?${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { signal })
      if (!response.ok) throw new Error(await responseError(response, 'Les écritures ne se sont pas chargées. Réessayez dans un instant.'))
      return {
        items: (await response.json()) as EntryListItem[],
        nextCursor: response.headers.get('X-Next-Cursor'),
      }
    },
    [query],
  )
  const list = useCursorList(query, fetchPage, fiscalYear.ready)

  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    fetch(`/api/journals?companyId=${companyId}`)
      .then((response) => (response.ok ? response.json() : []))
      .then((data: Journal[]) => {
        if (!cancelled) setJournals(data)
      })
      .catch((error) => logger.error('Error loading journals:', error))
    return () => {
      cancelled = true
    }
  }, [companyId])

  const handleImportResult = (result: ImportResult) => {
    setLastImportResult(result)
    if (lastImportStorageKey) {
      try {
        sessionStorage.setItem(lastImportStorageKey, JSON.stringify(result))
      } catch {
        // storage quota or unavailable, fail silently
      }
    }
    list.reload()
  }

  const dismissLastImportResult = () => {
    setLastImportResult(null)
    if (lastImportStorageKey) {
      try {
        sessionStorage.removeItem(lastImportStorageKey)
      } catch {
        // ignore
      }
    }
  }

  if (!companyId) {
    return <NoCompanySelected description="Choisissez une société pour voir ses écritures." />
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Écritures"
        description="Les écritures comptables de l'exercice, des plus récentes aux plus anciennes."
        docsHref={docsUrl('doubleEntry')}
        actions={
          <>
            <Button variant="outline" onClick={() => setImportDialogOpen(true)}>
              <Upload aria-hidden />
              Importer
            </Button>
            <Button asChild>
              <Link href={`/${companyId}/entries/new`}>
                <Plus aria-hidden />
                Nouvelle écriture
              </Link>
            </Button>
          </>
        }
      />

      {lastImportResult && <LastImportSummary result={lastImportResult} onDismiss={dismissLastImportResult} />}

      <EntriesFilters
        journals={journals}
        filters={filters}
        onFiltersChange={setFilters}
        companyId={companyId}
        fiscalYearId={fiscalYear.fiscalYearId}
        onFiscalYearChange={fiscalYear.setFiscalYearId}
      />

      <EntriesList
        entries={list.items}
        loading={list.loading || !fiscalYear.ready}
        error={list.error}
        onRetry={list.reload}
        hasMore={list.hasMore}
        loadingMore={list.loadingMore}
        loadMoreError={list.loadMoreError}
        onLoadMore={list.loadMore}
        filtered={entriesFilterParams(filters).toString() !== ''}
        onEntryUpdated={list.reload}
        onEntryDeleted={list.reload}
        companyId={companyId}
      />

      <ImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        companyId={companyId}
        onImportSuccess={handleImportResult}
      />
    </div>
  )
}
