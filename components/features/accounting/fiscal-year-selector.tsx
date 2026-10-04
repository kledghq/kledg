'use client'

import { useState, useEffect, useRef } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { formatDisplayDate } from '@/components/shared/date-display'
import { Skeleton } from '@/components/ui/skeleton'
import { logger } from '@/lib/logger'

interface FiscalYear {
  id: string
  year: number
  startDate: string
  endDate: string
  isClosed: boolean
}

interface FiscalYearSelectorProps {
  companyId: string
  value?: string // fiscalYearId
  onValueChange: (fiscalYearId: string) => void
  showLabel?: boolean
  className?: string
  disabled?: boolean
  /** Id of the trigger, for an outside label. Defaults to "fiscal-year-select". */
  id?: string
  /** Shows "Du ... au ..." under the select. Off in toolbars, where rows keep one height. */
  showPeriod?: boolean
}

export function FiscalYearSelector({
  companyId,
  value,
  onValueChange,
  showLabel = true,
  className,
  disabled = false,
  id = 'fiscal-year-select',
  showPeriod = true,
}: FiscalYearSelectorProps) {
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([])
  const [loading, setLoading] = useState(true)
  const [activeFiscalYearId, setActiveFiscalYearId] = useState<string | null>(null)
  const valueRef = useRef(value)

  useEffect(() => {
    valueRef.current = value
  }, [value])

  useEffect(() => {
    if (companyId) {
      loadFiscalYears()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  const loadFiscalYears = async () => {
    if (!companyId) return

    setLoading(true)
    try {
      // Load fiscal years
      const response = await fetch(`/api/companies/${companyId}/fiscal-years`)
      if (response.ok) {
        const data = await response.json()
        setFiscalYears(data)

        // Find active fiscal year (not closed, most recent)
        const active = data.find((fy: FiscalYear) => !fy.isClosed)
        if (active) {
          setActiveFiscalYearId(active.id)
          // If no value is set (checked via ref to avoid stale closure during async parent updates), use active fiscal year
          if (!valueRef.current) {
            onValueChange(active.id)
          }
        } else if (data.length > 0 && !valueRef.current) {
          // If no active fiscal year, use the most recent one
          const mostRecent = data.sort((a: FiscalYear, b: FiscalYear) => b.year - a.year)[0]
          setActiveFiscalYearId(mostRecent.id)
          onValueChange(mostRecent.id)
        }
      }
    } catch (error) {
      logger.error('Error loading fiscal years:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className={className}>
        {showLabel && (
          <Label className="mb-2 block">Exercice</Label>
        )}
        <Skeleton className="h-9 w-full" />
      </div>
    )
  }

  if (fiscalYears.length === 0) {
    return (
      <div className={className}>
        {showLabel && (
          <Label className="mb-2 block">Exercice</Label>
        )}
        <p className="text-sm text-muted-foreground mt-2">Aucun exercice. Créez le premier dans Exercices.</p>
      </div>
    )
  }

  // Sort fiscal years by year descending
  const sortedFiscalYears = [...fiscalYears].sort((a, b) => b.year - a.year)

  const selectedFiscalYear = value ? fiscalYears.find((fy) => fy.id === value) : null

  return (
    <div className={className}>
      {showLabel && (
        <Label htmlFor={id} className="mb-2 block">
          Exercice
        </Label>
      )}
      <div className="space-y-2">
        <Select
          value={value || activeFiscalYearId || undefined}
          onValueChange={onValueChange}
          disabled={disabled}
        >
          <SelectTrigger id={id} className="w-full">
            <SelectValue placeholder="Sélectionner un exercice">
              {selectedFiscalYear && (
                <span className="flex items-center gap-2">
                  <span className="font-medium">{selectedFiscalYear.year}</span>
                  <span className="text-muted-foreground text-xs">
                    {selectedFiscalYear.isClosed ? 'clôturé' : 'ouvert'}
                  </span>
                </span>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {sortedFiscalYears.map((fy) => (
              <SelectItem key={fy.id} value={fy.id}>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{fy.year}</span>
                  <span className="text-muted-foreground text-xs">
                    {fy.isClosed ? 'clôturé' : 'ouvert'}
                  </span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {showPeriod && value && selectedFiscalYear && (
          <div className="px-1">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Du {formatDisplayDate(selectedFiscalYear.startDate)} au {formatDisplayDate(selectedFiscalYear.endDate)}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
