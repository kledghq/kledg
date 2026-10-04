'use client'

import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Field } from '@/components/shared'
import { responseError } from '@/hooks/use-cursor-list'
import {
  MAX_END_OF_MONTH_DAYS,
  MAX_PAYMENT_DAYS,
  paymentTermsErrors,
  type PaymentTerms,
} from '@/lib/reports/third-parties/payment-terms'

interface PaymentTermsDialogProps {
  companyId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  terms: PaymentTerms
  onSaved: (terms: PaymentTerms) => void
}

/**
 * Payment terms of the company, used by the aged balance for due dates.
 * Code de commerce art. L441-10: 30 days by default, at most 60 days, or
 * 45 days end of month when agreed.
 */
export function PaymentTermsDialog({ companyId, open, onOpenChange, terms, onSaved }: PaymentTermsDialogProps) {
  const [days, setDays] = React.useState(String(terms.days))
  const [endOfMonth, setEndOfMonth] = React.useState(terms.endOfMonth)
  const [submitted, setSubmitted] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setDays(String(terms.days))
      setEndOfMonth(terms.endOfMonth)
      setSubmitted(false)
    }
  }, [open, terms])

  const parsed = /^\d{1,3}$/.test(days.trim()) ? Number(days.trim()) : Number.NaN
  const errors = paymentTermsErrors({ days: parsed, endOfMonth })
  const error = submitted ? errors[0] : undefined

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitted(true)
    if (errors.length > 0) return
    setSaving(true)
    try {
      const response = await fetch(`/api/companies/${companyId}/payment-terms`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: parsed, endOfMonth }),
      })
      if (!response.ok) throw new Error(await responseError(response, "Le délai n'a pas été enregistré. Réessayez."))
      onSaved((await response.json()) as PaymentTerms)
      toast.success('Délai de paiement enregistré')
      onOpenChange(false)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={save} className="space-y-5">
          <DialogHeader>
            <DialogTitle>Délai de paiement</DialogTitle>
            <DialogDescription>
              L&apos;échéance d&apos;une facture est sa date plus ce délai. Sans accord, la loi prévoit 30 jours&nbsp;; un délai convenu ne
              peut dépasser {MAX_PAYMENT_DAYS} jours, ou {MAX_END_OF_MONTH_DAYS} jours fin de mois (Code de commerce, art. L441-10).
            </DialogDescription>
          </DialogHeader>
          <Field label="Nombre de jours" htmlFor="payment-terms-days" error={error} required>
            <Input
              id="payment-terms-days"
              inputMode="numeric"
              autoComplete="off"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className="w-32"
            />
          </Field>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="payment-terms-eom">Fin de mois</Label>
              <p className="text-muted-foreground text-xs">
                L&apos;échéance tombe le dernier jour du mois atteint après ces jours (10 janvier + 45 jours&nbsp;: 28 février).
              </p>
            </div>
            <Switch id="payment-terms-eom" checked={endOfMonth} onCheckedChange={setEndOfMonth} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" loading={saving}>
              Enregistrer le délai
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
