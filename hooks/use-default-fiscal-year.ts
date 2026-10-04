'use client'

import { useEffect, useState } from 'react'

import { logger } from '@/lib/logger'

interface FiscalYearRow {
  id: string
  year: number
  isClosed: boolean
}

/**
 * The fiscal year a list starts on, chosen like FiscalYearSelector does (the
 * first open year, else the most recent one), before the list loads: the
 * first request already targets that year instead of every year.
 *
 * `ready` turns true once the years are known (also when the company has
 * none, or when they failed to load: the list then loads without a year).
 */
export function useDefaultFiscalYear(companyId: string | undefined) {
  const [fiscalYearId, setFiscalYearId] = useState<string | undefined>(undefined)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)

  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    fetch(`/api/companies/${companyId}/fiscal-years`)
      .then((response) => (response.ok ? (response.json() as Promise<FiscalYearRow[]>) : []))
      .then((years) => {
        if (cancelled) return
        const open = years.find((fy) => !fy.isClosed)
        const recent = [...years].sort((a, b) => b.year - a.year)[0]
        setFiscalYearId((current) => current ?? open?.id ?? recent?.id)
      })
      .catch((error) => logger.error('Error loading fiscal years:', error))
      .finally(() => {
        if (!cancelled) setLoadedFor(companyId)
      })
    return () => {
      cancelled = true
    }
  }, [companyId])

  return { fiscalYearId, setFiscalYearId, ready: Boolean(companyId) && loadedFor === companyId }
}
