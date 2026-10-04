'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, CheckCircle2, History } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { formatDisplayDate } from '@/components/shared'
import { historyApplies } from '@/lib/onboarding/checklist'
import { calendarDayOf } from '@/lib/utils/date'
import { logger } from '@/lib/logger'

interface OpeningTarget {
  fiscalYear: { id: string; year: number; startDate: string; isClosed: boolean }
  existingEntry: { id: string; status: string } | null
}

interface OpeningBalanceNoticeProps {
  companyId: string
  /** Date the company was created (ISO), null when unknown. */
  foundationDate: string | null
  /** Start of the company's first fiscal year in Kledg (ISO). */
  firstFiscalYearStart: string | null
}

/**
 * On the Exercices page: when the company existed before its first fiscal
 * year in Kledg (lib/onboarding/checklist.ts, historyApplies), the way to
 * its opening balance sheet (à-nouveaux of the first year), which was only
 * reachable from the Démarrer checklist.
 */
export function OpeningBalanceNotice({ companyId, foundationDate, firstFiscalYearStart }: OpeningBalanceNoticeProps) {
  const applies = historyApplies({
    foundationDate: foundationDate ? calendarDayOf(foundationDate) : null,
    firstFiscalYearStart: firstFiscalYearStart ? calendarDayOf(firstFiscalYearStart) : null,
  })
  const [target, setTarget] = useState<OpeningTarget | null>(null)

  useEffect(() => {
    if (!applies) return
    let cancelled = false
    fetch(`/api/companies/${companyId}/opening-balances`)
      .then(async (response) => {
        if (!response.ok) return
        const data = (await response.json()) as { target: OpeningTarget | null }
        if (!cancelled) setTarget(data.target)
      })
      .catch((error) => logger.error('Error loading the opening balance target:', error))
    return () => {
      cancelled = true
    }
  }, [applies, companyId])

  if (!applies || !target || target.fiscalYear.isClosed) return null
  const href = `/${companyId}/fiscal-years/opening-balances`

  if (target.existingEntry) {
    return (
      <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <CheckCircle2 aria-hidden className="text-success size-4" />
        Bilan d&apos;ouverture de l&apos;exercice {target.fiscalYear.year} saisi
        {target.existingEntry.status === 'draft' ? ' (brouillon)' : ''}.
        <Link href={href} className="text-link underline-offset-4 hover:underline">
          Voir le bilan d&apos;ouverture
        </Link>
      </p>
    )
  }

  return (
    <Alert>
      <History aria-hidden />
      <AlertTitle>Reprendre le bilan d&apos;ouverture</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          La société existait avant son premier exercice dans Kledg, qui commence le{' '}
          {formatDisplayDate(target.fiscalYear.startDate, 'long')}. Saisissez les soldes de fin de l&apos;exercice précédent
          (à-nouveaux) pour que le bilan parte des bons chiffres.
        </p>
        <Button asChild size="sm" variant="outline">
          <Link href={href}>
            Saisir le bilan d&apos;ouverture
            <ArrowRight aria-hidden />
          </Link>
        </Button>
      </AlertDescription>
    </Alert>
  )
}
