'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { DateRange } from 'react-day-picker'
import { ListFilter, Search, X } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { AmountInput } from '@/components/ui/amount-input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DatePickerWithRange, formatDateRange } from '@/components/ui/date-picker'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { useMediaQuery } from '@/hooks/ui/use-media-query'
import { Field, formatAmount } from '@/components/shared'
import { FiscalYearSelector } from '@/components/features/accounting/fiscal-year-selector'
import { bankAccountName } from '@/components/features/banking/format'
import { operationTypeLabel } from '@/lib/banking/operation-type-label'
import { localDateToIso } from '@/lib/utils/date'
import { centsToDecimal } from '@/lib/utils/money'

/**
 * Filters of the bank transactions list. Every filter is sent to the server
 * (GET /api/transactions), which returns the matching transactions page by
 * page; nothing is filtered in the browser.
 */
export interface TransactionFilters {
  bankAccountId: string
  /** Fiscal year: the list covers its dates. */
  fiscalYearId?: string
  /** Optional period, combined with the fiscal year (both apply). */
  dateRange?: DateRange
  reconciled: 'all' | 'reconciled' | 'unreconciled'
  side: 'all' | 'debit' | 'credit'
  hasAttachments: 'all' | 'with' | 'without'
  /** Amount bounds in cents (absolute amount of the transaction). */
  minAmountCents?: number | null
  maxAmountCents?: number | null
  searchText?: string
  cashflowCategory?: string
  cashflowSubcategory?: string
  category?: string
  operationType?: string
}

export const EMPTY_TRANSACTION_FILTERS: TransactionFilters = {
  bankAccountId: 'all',
  reconciled: 'all',
  side: 'all',
  hasAttachments: 'all',
}

/** Query parameters of GET /api/transactions for the filters (without companyId and paging). */
export function transactionFilterParams(filters: TransactionFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.bankAccountId !== 'all') params.set('bankAccountId', filters.bankAccountId)
  if (filters.fiscalYearId) params.set('fiscalYearId', filters.fiscalYearId)
  // Calendar days the user picked (local dates), never instants
  if (filters.dateRange?.from) params.set('startDate', localDateToIso(filters.dateRange.from))
  if (filters.dateRange?.to) params.set('endDate', localDateToIso(filters.dateRange.to))
  if (filters.reconciled !== 'all') params.set('reconciled', filters.reconciled === 'reconciled' ? 'true' : 'false')
  if (filters.side !== 'all') params.set('side', filters.side)
  if (filters.hasAttachments !== 'all') params.set('hasAttachments', filters.hasAttachments)
  if (typeof filters.minAmountCents === 'number') params.set('minAmount', centsToDecimal(filters.minAmountCents))
  if (typeof filters.maxAmountCents === 'number') params.set('maxAmount', centsToDecimal(filters.maxAmountCents))
  if (filters.searchText?.trim()) params.set('searchText', filters.searchText.trim())
  if (filters.cashflowCategory) params.set('cashflowCategory', filters.cashflowCategory)
  if (filters.cashflowSubcategory) params.set('cashflowSubcategory', filters.cashflowSubcategory)
  if (filters.category) params.set('category', filters.category)
  if (filters.operationType) params.set('operationType', filters.operationType)
  return params
}

interface TransactionFiltersProps {
  filters: TransactionFilters
  onFiltersChange: (filters: TransactionFilters) => void
  bankAccounts: Array<{ id: string; name: string; displayName?: string | null; iban?: string | null }>
  availableCategories?: {
    cashflowCategories: string[]
    cashflowSubcategories: string[]
    categories: string[]
    operationTypes: string[]
  }
  companyId?: string
  onReset?: () => void
}

/** Typing in the search waits this long before asking the server. */
const SEARCH_DELAY_MS = 300

const ADVANCED_KEYS = [
  'dateRange',
  'side',
  'hasAttachments',
  'minAmountCents',
  'maxAmountCents',
  'cashflowCategory',
  'cashflowSubcategory',
  'category',
  'operationType',
] as const

export function TransactionFiltersComponent({
  filters,
  onFiltersChange,
  bankAccounts,
  availableCategories,
  companyId,
  onReset,
}: TransactionFiltersProps) {
  const id = useId()
  const [search, setSearch] = useState(filters.searchText ?? '')
  const advancedCount = ADVANCED_KEYS.filter((key) => {
    const value = filters[key]
    if (key === 'dateRange') return Boolean(filters.dateRange?.from)
    return value !== undefined && value !== null && value !== 'all' && value !== ''
  }).length
  const [showAdvanced, setShowAdvanced] = useState(advancedCount > 0)
  const [sheetOpen, setSheetOpen] = useState(false)
  // Phones (below 768px): the filters other than the search move into a sheet.
  const isMobile = useMediaQuery('(max-width: 47.99rem)')

  const latest = useRef({ filters, onFiltersChange })
  useEffect(() => {
    latest.current = { filters, onFiltersChange }
  })

  // Follow outside changes of the search (reset, removed chip)
  const [shownSearch, setShownSearch] = useState(filters.searchText)
  if (filters.searchText !== shownSearch) {
    setShownSearch(filters.searchText)
    setSearch(filters.searchText ?? '')
  }

  useEffect(() => {
    const next = search.trim() || undefined
    if (next === (latest.current.filters.searchText?.trim() || undefined)) return
    const timer = setTimeout(() => {
      latest.current.onFiltersChange({ ...latest.current.filters, searchText: next })
    }, SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [search])

  const update = <K extends keyof TransactionFilters>(key: K, value: TransactionFilters[K]) =>
    onFiltersChange({ ...filters, [key]: value })

  const activeFilters = useMemo(() => {
    const active: Array<{ key: string; label: string; remove: Partial<TransactionFilters> }> = []
    if (filters.bankAccountId !== 'all') {
      const account = bankAccounts.find((a) => a.id === filters.bankAccountId)
      active.push({ key: 'bankAccountId', label: `Compte\u00a0: ${account ? bankAccountName(account) : 'inconnu'}`, remove: { bankAccountId: 'all' } })
    }
    if (filters.dateRange?.from) {
      active.push({ key: 'dateRange', label: formatDateRange(filters.dateRange), remove: { dateRange: undefined } })
    }
    if (filters.reconciled !== 'all') {
      active.push({
        key: 'reconciled',
        label: filters.reconciled === 'reconciled' ? 'Rapprochées' : 'Non rapprochées',
        remove: { reconciled: 'all' },
      })
    }
    if (filters.searchText) {
      active.push({ key: 'searchText', label: `Recherche\u00a0: ${filters.searchText}`, remove: { searchText: undefined } })
    }
    const min = typeof filters.minAmountCents === 'number' ? formatAmount(filters.minAmountCents / 100) : null
    const max = typeof filters.maxAmountCents === 'number' ? formatAmount(filters.maxAmountCents / 100) : null
    if (min || max) {
      const label = min && max ? `Montant\u00a0: de ${min} à ${max}` : min ? `Montant\u00a0: au moins ${min}` : `Montant\u00a0: au plus ${max}`
      active.push({ key: 'amount', label, remove: { minAmountCents: null, maxAmountCents: null } })
    }
    if (filters.hasAttachments !== 'all') {
      active.push({
        key: 'hasAttachments',
        label: filters.hasAttachments === 'with' ? 'Avec justificatif' : 'Sans justificatif',
        remove: { hasAttachments: 'all' },
      })
    }
    if (filters.side !== 'all') {
      active.push({ key: 'side', label: filters.side === 'debit' ? 'Sorties' : 'Entrées', remove: { side: 'all' } })
    }
    if (filters.cashflowCategory) {
      active.push({ key: 'cashflowCategory', label: `Catégorie de flux\u00a0: ${filters.cashflowCategory}`, remove: { cashflowCategory: undefined } })
    }
    if (filters.cashflowSubcategory) {
      active.push({ key: 'cashflowSubcategory', label: `Sous-catégorie\u00a0: ${filters.cashflowSubcategory}`, remove: { cashflowSubcategory: undefined } })
    }
    if (filters.category) {
      active.push({ key: 'category', label: `Catégorie\u00a0: ${filters.category}`, remove: { category: undefined } })
    }
    if (filters.operationType) {
      active.push({ key: 'operationType', label: `Opération\u00a0: ${operationTypeLabel(filters.operationType)}`, remove: { operationType: undefined } })
    }
    return active
  }, [filters, bankAccounts])

  const reset = () => {
    setSearch('')
    // The fiscal year stays: it is the scope of the list, shown in the toolbar
    if (onReset) onReset()
    else onFiltersChange({ ...EMPTY_TRANSACTION_FILTERS, fiscalYearId: filters.fiscalYearId })
  }

  const categorySelect = (
    key: 'cashflowCategory' | 'cashflowSubcategory' | 'category' | 'operationType',
    label: string,
    values: string[],
    allLabel: string,
  ) =>
    values.length > 0 ? (
      <Field label={label} htmlFor={`${id}-${key}`}>
        <Select value={filters[key] || 'all'} onValueChange={(value) => update(key, value === 'all' ? undefined : value)}>
          <SelectTrigger id={`${id}-${key}`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{allLabel}</SelectItem>
            {values.map((value) => (
              <SelectItem key={value} value={value}>
                {key === 'operationType' ? operationTypeLabel(value) : value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    ) : null

  const searchField = (
    <>
          <Field label="Recherche" htmlFor={`${id}-search`} className={isMobile ? 'min-w-0 flex-1' : 'sm:col-span-2 xl:col-span-1'}>
            {/* Own id: the label points to the input inside, not to this wrapper */}
            <div id={`${id}-search-box`} className="relative">
              <Search aria-hidden className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                id={`${id}-search`}
                type="search"
                placeholder="Contrepartie, libellé ou référence"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </Field>
    </>
  )

  const mainFields = (
    <>
          <Field label="Compte" htmlFor={`${id}-account`}>
            <Select value={filters.bankAccountId} onValueChange={(value) => update('bankAccountId', value)}>
              <SelectTrigger id={`${id}-account`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les comptes</SelectItem>
                {bankAccounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {bankAccountName(account)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {companyId ? (
            <Field label="Exercice" htmlFor={`${id}-year`}>
              <FiscalYearSelector
                id={`${id}-year`}
                companyId={companyId}
                value={filters.fiscalYearId}
                onValueChange={(value) => update('fiscalYearId', value)}
                showLabel={false}
                showPeriod={false}
              />
            </Field>
          ) : null}
          <Field label="Statut" htmlFor={`${id}-status`}>
            <Select
              value={filters.reconciled}
              onValueChange={(value) => update('reconciled', value as TransactionFilters['reconciled'])}
            >
              <SelectTrigger id={`${id}-status`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes</SelectItem>
                <SelectItem value="unreconciled">Non rapprochées</SelectItem>
                <SelectItem value="reconciled">Rapprochées</SelectItem>
              </SelectContent>
            </Select>
          </Field>
    </>
  )

  const advancedFields = (
    <>
            <Field label="Période" htmlFor={`${id}-period`} hint={filters.fiscalYearId ? "À l'intérieur de l'exercice choisi." : undefined}>
              <DatePickerWithRange
                id={`${id}-period`}
                date={filters.dateRange}
                onDateChange={(range) => update('dateRange', range?.from ? range : undefined)}
                placeholder="Toute la période"
              />
            </Field>
            <Field label="Sens" htmlFor={`${id}-side`}>
              <Select value={filters.side} onValueChange={(value) => update('side', value as TransactionFilters['side'])}>
                <SelectTrigger id={`${id}-side`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Entrées et sorties</SelectItem>
                  <SelectItem value="credit">Entrées (crédit)</SelectItem>
                  <SelectItem value="debit">Sorties (débit)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Montant minimum" htmlFor={`${id}-min`}>
              <AmountInput
                id={`${id}-min`}
                placeholder="ex. 100,00"
                value={filters.minAmountCents ?? null}
                onValueChange={(cents) => update('minAmountCents', cents)}
              />
            </Field>
            <Field label="Montant maximum" htmlFor={`${id}-max`}>
              <AmountInput
                id={`${id}-max`}
                placeholder="ex. 2 500,00"
                value={filters.maxAmountCents ?? null}
                onValueChange={(cents) => update('maxAmountCents', cents)}
              />
            </Field>
            <Field label="Justificatifs" htmlFor={`${id}-attachments`}>
              <Select
                value={filters.hasAttachments}
                onValueChange={(value) => update('hasAttachments', value as TransactionFilters['hasAttachments'])}
              >
                <SelectTrigger id={`${id}-attachments`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Avec ou sans</SelectItem>
                  <SelectItem value="with">Avec justificatif</SelectItem>
                  <SelectItem value="without">Sans justificatif</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {availableCategories ? (
              <>
                {categorySelect('cashflowCategory', 'Catégorie de flux', availableCategories.cashflowCategories, 'Toutes')}
                {categorySelect('cashflowSubcategory', 'Sous-catégorie de flux', availableCategories.cashflowSubcategories, 'Toutes')}
                {categorySelect('category', 'Catégorie', availableCategories.categories, 'Toutes')}
                {categorySelect('operationType', "Type d'opération", availableCategories.operationTypes, 'Tous')}
              </>
            ) : null}
    </>
  )

  const chips = (
    <>
        {activeFilters.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground text-xs">Filtres actifs</span>
            {activeFilters.map((filter) => (
              <Badge key={filter.key} variant="secondary" className="max-w-full gap-1 pr-0.5">
                <span className="truncate">{filter.label}</span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="rounded-full"
                  aria-label={`Retirer le filtre ${filter.label}`}
                  onClick={() => onFiltersChange({ ...filters, ...filter.remove })}
                >
                  <X aria-hidden />
                </Button>
              </Badge>
            ))}
            <Button variant="ghost" size="sm" onClick={reset}>
              Réinitialiser
            </Button>
          </div>
        ) : null}
    </>
  )

  // Phones: the search stays on the page, every other filter moves into a sheet.
  if (isMobile) {
    const sheetCount = advancedCount + (filters.bankAccountId !== 'all' ? 1 : 0) + (filters.reconciled !== 'all' ? 1 : 0)
    return (
      <Card className="py-4">
        <CardContent className="space-y-4 px-4">
          <div className="flex items-end gap-2">
            {searchField}
            <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" aria-label={sheetCount > 0 ? `Filtres, ${sheetCount} actif${sheetCount > 1 ? 's' : ''}` : 'Filtres'}>
                  <ListFilter aria-hidden />
                  Filtres
                  {sheetCount > 0 ? (
                    <Badge variant="secondary" className="num">
                      {sheetCount}
                    </Badge>
                  ) : null}
                </Button>
              </SheetTrigger>
              <SheetContent side="bottom" className="max-h-[85dvh] gap-0 rounded-t-lg">
                <SheetHeader className="border-b">
                  <SheetTitle>Filtres</SheetTitle>
                  <SheetDescription>La liste se met à jour à chaque choix.</SheetDescription>
                </SheetHeader>
                <div className="grid gap-3 overflow-y-auto p-4">
                  {mainFields}
                  {advancedFields}
                </div>
                <SheetFooter className="flex-row justify-end border-t">
                  <Button variant="outline" onClick={reset}>
                    Réinitialiser
                  </Button>
                  <Button onClick={() => setSheetOpen(false)}>Voir les transactions</Button>
                </SheetFooter>
              </SheetContent>
            </Sheet>
          </div>
          {chips}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="py-4">
      <CardContent className="space-y-4 px-4">
        <div className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto]">
          {searchField}
          {mainFields}
          <Button
            variant="outline"
            aria-expanded={showAdvanced}
            aria-controls={`${id}-advanced`}
            onClick={() => setShowAdvanced((open) => !open)}
          >
            <ListFilter aria-hidden />
            {showAdvanced ? 'Moins de filtres' : 'Plus de filtres'}
            {advancedCount > 0 ? (
              <Badge variant="secondary" className="num">
                {advancedCount}
              </Badge>
            ) : null}
          </Button>
        </div>

        {showAdvanced ? (
          <div id={`${id}-advanced`} className="grid gap-3 border-t pt-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {advancedFields}
          </div>
        ) : null}

        {chips}
      </CardContent>
    </Card>
  )
}
