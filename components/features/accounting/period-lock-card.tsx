'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Lock } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { DateInput } from '@/components/ui/date-input'
import { ConfirmDialog, DateDisplay, Field } from '@/components/shared'
import { formatIsoDateFr, toIsoDateUtc } from '@/lib/utils/date'

export interface PeriodLockFiscalYear {
  id: string
  year: number
  isClosed: boolean
  /** Last closed day, stored date (ISO timestamp) or null. */
  periodLockedThrough?: string | null
}

interface PeriodLockCardProps {
  companyId: string
  fiscalYears: PeriodLockFiscalYear[]
  onLocked?: () => void
}

/**
 * Period closing of the open fiscal years (PCG art. 1031-4): POST
 * /api/companies/[id]/fiscal-years/[fiscalYearId]/period-lock. Irreversible,
 * hence the confirmation.
 */
export function PeriodLockCard({ companyId, fiscalYears, onLocked }: PeriodLockCardProps) {
  const open = fiscalYears.filter((fy) => !fy.isClosed)
  if (open.length === 0) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>Clôture des périodes</CardTitle>
        <CardDescription>
          Le plan comptable général impose de figer la chronologie des écritures au plus tard avant la fin de la période
          suivante (PCG art. 1031-4). Une fois une période clôturée, aucune écriture ne peut plus y être créée ni validée&nbsp;:
          une opération oubliée se passe au premier jour ouvert, avec sa date réelle en date de pièce. La clôture est
          définitive.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {open.map((fy) => (
          <PeriodLockRow key={fy.id} companyId={companyId} fiscalYear={fy} onLocked={onLocked} />
        ))}
      </CardContent>
    </Card>
  )
}

function PeriodLockRow({ companyId, fiscalYear, onLocked }: { companyId: string; fiscalYear: PeriodLockFiscalYear; onLocked?: () => void }) {
  const [through, setThrough] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch(`/api/companies/${companyId}/fiscal-years/${fiscalYear.id}/period-lock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ through }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error || 'La clôture de la période a échoué.')
        return
      }
      toast.success(`Période clôturée jusqu'au ${formatIsoDateFr(through)}`)
      setThrough('')
      onLocked?.()
    } catch {
      setError('La clôture de la période a échoué. Réessayez.')
    } finally {
      setSubmitting(false)
      setConfirming(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm">
        <span className="font-medium">Exercice {fiscalYear.year}&nbsp;: </span>
        {fiscalYear.periodLockedThrough ? (
          <>
            périodes clôturées jusqu&apos;au <DateDisplay value={toIsoDateUtc(fiscalYear.periodLockedThrough)} format="long" />
          </>
        ) : (
          'aucune période clôturée'
        )}
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Clôturer jusqu'au" error={error ?? undefined} className="w-56">
          <DateInput value={through} onValueChange={setThrough} disabled={submitting} />
        </Field>
        <Button variant="outline" onClick={() => setConfirming(true)} disabled={!through || submitting}>
          <Lock aria-hidden />
          Clôturer la période
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Clôturer la période jusqu'au ${formatIsoDateFr(through)} ?`}
        description="Aucune écriture datée de cette période ne pourra plus être créée ni validée. Les écritures en brouillon de la période doivent être validées ou supprimées avant. Une période clôturée ne se rouvre pas."
        confirmLabel="Clôturer la période"
        loading={submitting}
        onConfirm={submit}
      />
    </div>
  )
}
