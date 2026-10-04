'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { ListFilter, Search, X } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { AmountInput } from '@/components/ui/amount-input'
import { DateInput } from '@/components/ui/date-input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { useMediaQuery } from '@/hooks/ui/use-media-query'
import { Field, formatAmount, formatDisplayDate } from '@/components/shared'
import { FiscalYearSelector } from '@/components/features/accounting/fiscal-year-selector'
import { centsToDecimal } from '@/lib/utils/money'

interface Journal {
  id: string
  code: string
  label: string
}

/**
 * Filters of the entries list, sent to GET /api/entries: the server returns
 * the matching entries page by page.
 */
export interface EntriesFilters {
  journalId?: string
  /** Part of the entry number. */
  entryNumber?: string
  /** Text in the description, the reference or a line label. */
  description?: string
  /** Entry amount bounds in cents (larger of the debit and credit totals). */
  minAmountCents?: number | null
  maxAmountCents?: number | null
  /** Calendar days (yyyy-mm-dd), both included. */
  startDate?: string
  endDate?: string
  status?: 'draft' | 'validated' | 'all'
}

/** Query parameters of GET /api/entries for the filters (without companyId, fiscal year and paging). */
export function entriesFilterParams(filters: EntriesFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.journalId) params.set('journalId', filters.journalId)
  if (filters.status && filters.status !== 'all') params.set('status', filters.status)
  if (filters.entryNumber?.trim()) params.set('number', filters.entryNumber.trim())
  if (filters.description?.trim()) params.set('search', filters.description.trim())
  if (filters.startDate) params.set('startDate', filters.startDate)
  if (filters.endDate) params.set('endDate', filters.endDate)
  if (typeof filters.minAmountCents === 'number') params.set('minAmount', centsToDecimal(filters.minAmountCents))
  if (typeof filters.maxAmountCents === 'number') params.set('maxAmount', centsToDecimal(filters.maxAmountCents))
  return params
}

interface EntriesFiltersProps {
  journals: Journal[]
  filters: EntriesFilters
  onFiltersChange: (filters: EntriesFilters) => void
  companyId: string
  /** Fiscal year of the list, shown first in the toolbar when given. */
  fiscalYearId?: string
  onFiscalYearChange?: (fiscalYearId: string) => void
}

/** Typing in a text filter waits this long before asking the server. */
const TYPING_DELAY_MS = 300

const ADVANCED_KEYS = ['entryNumber', 'startDate', 'endDate', 'minAmountCents', 'maxAmountCents'] as const

const isActive = (value: unknown) => value !== undefined && value !== null && value !== '' && value !== 'all'

export function EntriesFilters({
  journals,
  filters,
  onFiltersChange,
  companyId,
  fiscalYearId,
  onFiscalYearChange,
}: EntriesFiltersProps) {
  const id = useId()
  const advancedCount = ADVANCED_KEYS.filter((key) => isActive(filters[key])).length
  const [showAdvanced, setShowAdvanced] = useState(advancedCount > 0)
  const [sheetOpen, setSheetOpen] = useState(false)
  // Phones (below 768px): the filters other than the search move into a sheet.
  const isMobile = useMediaQuery('(max-width: 47.99rem)')
  // Text filters are typed locally and sent once typing pauses
  const [text, setText] = useState({ description: filters.description ?? '', entryNumber: filters.entryNumber ?? '' })
  const [shownText, setShownText] = useState({ description: filters.description, entryNumber: filters.entryNumber })
  if (filters.description !== shownText.description || filters.entryNumber !== shownText.entryNumber) {
    setShownText({ description: filters.description, entryNumber: filters.entryNumber })
    setText({ description: filters.description ?? '', entryNumber: filters.entryNumber ?? '' })
  }

  const latest = useRef({ filters, onFiltersChange })
  useEffect(() => {
    latest.current = { filters, onFiltersChange }
  })
  useEffect(() => {
    const next = { description: text.description.trim() || undefined, entryNumber: text.entryNumber.trim() || undefined }
    const current = latest.current.filters
    if (next.description === (current.description?.trim() || undefined) && next.entryNumber === (current.entryNumber?.trim() || undefined)) return
    const timer = setTimeout(() => latest.current.onFiltersChange({ ...latest.current.filters, ...next }), TYPING_DELAY_MS)
    return () => clearTimeout(timer)
  }, [text])

  const update = <K extends keyof EntriesFilters>(key: K, value: EntriesFilters[K]) =>
    onFiltersChange({ ...filters, [key]: value === '' || value === null ? undefined : value })

  const chips: Array<{ key: string; label: string; remove: Partial<EntriesFilters> }> = []
  const journal = journals.find((j) => j.id === filters.journalId)
  if (filters.journalId) chips.push({ key: 'journal', label: `Journal\u00a0: ${journal ? journal.code : 'inconnu'}`, remove: { journalId: undefined } })
  if (isActive(filters.status)) {
    chips.push({ key: 'status', label: filters.status === 'draft' ? 'Brouillons' : 'Validées', remove: { status: undefined } })
  }
  if (filters.description) chips.push({ key: 'description', label: `Recherche\u00a0: ${filters.description}`, remove: { description: undefined } })
  if (filters.entryNumber) chips.push({ key: 'entryNumber', label: `Numéro\u00a0: ${filters.entryNumber}`, remove: { entryNumber: undefined } })
  if (filters.startDate || filters.endDate) {
    const from = filters.startDate ? formatDisplayDate(filters.startDate) : null
    const to = filters.endDate ? formatDisplayDate(filters.endDate) : null
    chips.push({
      key: 'period',
      label: from && to ? `Du ${from} au ${to}` : from ? `À partir du ${from}` : `Jusqu'au ${to}`,
      remove: { startDate: undefined, endDate: undefined },
    })
  }
  const min = typeof filters.minAmountCents === 'number' ? formatAmount(filters.minAmountCents / 100) : null
  const max = typeof filters.maxAmountCents === 'number' ? formatAmount(filters.maxAmountCents / 100) : null
  if (min || max) {
    chips.push({
      key: 'amount',
      label: min && max ? `Montant\u00a0: de ${min} à ${max}` : min ? `Montant\u00a0: au moins ${min}` : `Montant\u00a0: au plus ${max}`,
      remove: { minAmountCents: undefined, maxAmountCents: undefined },
    })
  }

  const clearFilters = () => {
    setText({ description: '', entryNumber: '' })
    onFiltersChange({})
  }

  const searchField = (
    <>
          <Field label="Recherche" htmlFor={`${id}-search`} className={isMobile ? 'min-w-0 flex-1' : 'sm:col-span-2 xl:col-span-1'}>
            {/* Own id: the label points to the input inside, not to this wrapper */}
            <div id={`${id}-search-box`} className="relative">
              <Search aria-hidden className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                id={`${id}-search`}
                type="search"
                placeholder="Description, référence ou libellé"
                value={text.description}
                onChange={(e) => setText((t) => ({ ...t, description: e.target.value }))}
                className="pl-9"
              />
            </div>
          </Field>
    </>
  )

  const mainFields = (
    <>
          {onFiscalYearChange ? (
            <Field label="Exercice" htmlFor={`${id}-year`}>
              <FiscalYearSelector
                id={`${id}-year`}
                companyId={companyId}
                value={fiscalYearId}
                onValueChange={onFiscalYearChange}
                showLabel={false}
                showPeriod={false}
              />
            </Field>
          ) : null}
          <Field label="Journal" htmlFor={`${id}-journal`}>
            <Select value={filters.journalId || 'all'} onValueChange={(value) => update('journalId', value === 'all' ? undefined : value)}>
              <SelectTrigger id={`${id}-journal`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les journaux</SelectItem>
                {journals.map((j) => (
                  <SelectItem key={j.id} value={j.id}>
                    <span className="font-mono text-xs">{j.code}</span> {j.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Statut" htmlFor={`${id}-status`}>
            <Select
              value={filters.status || 'all'}
              onValueChange={(value) => update('status', value === 'all' ? undefined : (value as EntriesFilters['status']))}
            >
              <SelectTrigger id={`${id}-status`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les statuts</SelectItem>
                <SelectItem value="draft">Brouillon</SelectItem>
                <SelectItem value="validated">Validée</SelectItem>
              </SelectContent>
            </Select>
          </Field>
    </>
  )

  const advancedFields = (
    <>
            <Field label="Numéro d'écriture" htmlFor={`${id}-number`}>
              <Input
                id={`${id}-number`}
                inputMode="numeric"
                placeholder="ex. 42"
                value={text.entryNumber}
                onChange={(e) => setText((t) => ({ ...t, entryNumber: e.target.value }))}
              />
            </Field>
            <Field label="Date de début" htmlFor={`${id}-start`}>
              <DateInput id={`${id}-start`} value={filters.startDate ?? ''} onValueChange={(iso) => update('startDate', iso)} />
            </Field>
            <Field label="Date de fin" htmlFor={`${id}-end`}>
              <DateInput id={`${id}-end`} value={filters.endDate ?? ''} onValueChange={(iso) => update('endDate', iso)} />
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
    </>
  )

  const activeChips = (
    <>
        {chips.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground text-xs">Filtres actifs</span>
            {chips.map((chip) => (
              <Badge key={chip.key} variant="secondary" className="max-w-full gap-1 pr-0.5">
                <span className="truncate">{chip.label}</span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="rounded-full"
                  aria-label={`Retirer le filtre ${chip.label}`}
                  onClick={() => onFiltersChange({ ...filters, ...chip.remove })}
                >
                  <X aria-hidden />
                </Button>
              </Badge>
            ))}
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Réinitialiser
            </Button>
          </div>
        ) : null}
    </>
  )

  // Phones: the search stays on the page, every other filter moves into a sheet.
  if (isMobile) {
    const sheetCount = advancedCount + (filters.journalId ? 1 : 0) + (isActive(filters.status) ? 1 : 0)
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
                  <Button variant="outline" onClick={clearFilters}>
                    Réinitialiser
                  </Button>
                  <Button onClick={() => setSheetOpen(false)}>Voir les écritures</Button>
                </SheetFooter>
              </SheetContent>
            </Sheet>
          </div>
          {activeChips}
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
          <div id={`${id}-advanced`} className="grid gap-3 border-t pt-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {advancedFields}
          </div>
        ) : null}

        {activeChips}
      </CardContent>
    </Card>
  )
}
