'use client'

/**
 * "Affecter le résultat": allocation of the previous year's result voted by
 * the shareholders (legal reserve, dividends, other reserves, report à
 * nouveau), booked in the open year. The plan comes from the server
 * (lib/accounting/result-allocation), recomputed as the amounts change.
 */

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AmountInput } from '@/components/ui/amount-input'
import { DateInput } from '@/components/ui/date-input'

interface Plan {
  result: number
  legalReserveRequired: boolean
  legalReserve: number
  distributable: number
  dividends: number
  otherReserves: number
  priorLossesCleared: number
  retainedEarnings: number
  lines: Array<{ code: string; debit: number; credit: number }>
  errors: string[]
}

interface Props {
  companyId: string
  fiscalYear: { id: string; year: number; startDate: string; endDate: string } | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => void
}

const euros = (amount: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount)

export function ResultAllocationDialog({ companyId, fiscalYear, open, onOpenChange, onDone }: Props) {
  const [date, setDate] = useState('')
  const [dividends, setDividends] = useState<number | null>(0)
  const [otherReserves, setOtherReserves] = useState<number | null>(0)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open && fiscalYear) setDate(`${fiscalYear.startDate.slice(0, 4)}-06-30`)
  }, [open, fiscalYear])

  useEffect(() => {
    if (!open || !fiscalYear) return
    const controller = new AbortController()
    const params = new URLSearchParams({
      dividends: String((dividends ?? 0) / 100),
      otherReserves: String((otherReserves ?? 0) / 100),
    })
    setLoading(true)
    fetch(`/api/companies/${companyId}/fiscal-years/${fiscalYear.id}/result-allocation?${params}`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data) => setPlan(data.plan ?? null))
      .catch(() => {})
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [open, fiscalYear, companyId, dividends, otherReserves])

  const submit = async () => {
    if (!fiscalYear) return
    setSaving(true)
    try {
      const response = await fetch(`/api/companies/${companyId}/fiscal-years/${fiscalYear.id}/result-allocation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, dividends: (dividends ?? 0) / 100, otherReserves: (otherReserves ?? 0) / 100 }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        toast.error(data.error || "Impossible d'affecter le résultat")
        return
      }
      toast.success(`Résultat affecté\u00a0: écriture n° ${data.entryNumber}`)
      onOpenChange(false)
      onDone()
    } finally {
      setSaving(false)
    }
  }

  const previousYear = fiscalYear ? Number(fiscalYear.startDate.slice(0, 4)) - 1 : null
  const nothing = plan !== null && plan.result === 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Affecter le résultat {previousYear ?? ''}</DialogTitle>
          <DialogDescription>
            Enregistre la décision des associés sur le résultat de l&apos;exercice précédent&nbsp;: réserve légale (5 % du
            bénéfice jusqu&apos;à 10 % du capital pour les SARL, EURL, SA et SAS, Code de commerce art. L. 232-10),
            dividendes (dans la limite du bénéfice distribuable, art. L. 232-11), autres réserves et report à nouveau.
            L&apos;écriture est validée au journal OD et ne peut plus être modifiée.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="allocation-date">Date de l&apos;assemblée</Label>
              <DateInput id="allocation-date" value={date} onValueChange={setDate} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="allocation-dividends">Dividendes</Label>
              <AmountInput id="allocation-dividends" value={dividends} onValueChange={setDividends} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="allocation-reserves">Autres réserves</Label>
              <AmountInput id="allocation-reserves" value={otherReserves} onValueChange={setOtherReserves} />
            </div>
          </div>

          {plan && !nothing && (
            <div className="rounded-md bg-muted p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span>{plan.result >= 0 ? 'Bénéfice à affecter (120)' : 'Perte à reporter (129)'}</span>
                <span className="font-mono">{euros(plan.result)}</span>
              </div>
              {plan.result > 0 && (
                <>
                  <div className="flex justify-between">
                    <span>Réserve légale (1061){plan.legalReserveRequired ? '' : '\u00a0: non obligatoire pour cette forme'}</span>
                    <span className="font-mono">{euros(plan.legalReserve)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Dividendes (457)</span>
                    <span className="font-mono">{euros(plan.dividends)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Autres réserves (1068)</span>
                    <span className="font-mono">{euros(plan.otherReserves)}</span>
                  </div>
                  {plan.priorLossesCleared > 0 && (
                    <div className="flex justify-between">
                      <span>Apurement du report à nouveau débiteur (119)</span>
                      <span className="font-mono">{euros(plan.priorLossesCleared)}</span>
                    </div>
                  )}
                </>
              )}
              <div className="flex justify-between font-medium border-t pt-1">
                <span>Report à nouveau ({plan.retainedEarnings >= 0 ? '110' : '119'})</span>
                <span className="font-mono">{euros(plan.retainedEarnings)}</span>
              </div>
              {plan.result > 0 && (
                <p className="text-xs text-muted-foreground">Bénéfice distribuable&nbsp;: {euros(plan.distributable)}</p>
              )}
            </div>
          )}

          {plan && plan.errors.length > 0 && (
            <Alert variant={nothing ? 'default' : 'destructive'}>
              <AlertDescription>{plan.errors.join(' ')}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Annuler
          </Button>
          <Button
            onClick={submit}
            disabled={saving || loading || !plan || plan.errors.length > 0 || !date || dividends === null || otherReserves === null}
          >
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Affecter le résultat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
