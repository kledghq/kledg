'use client'

import * as React from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowRight } from 'lucide-react'

import { AmountInput } from '@/components/ui/amount-input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DateInput } from '@/components/ui/date-input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { DateDisplay, Field } from '@/components/shared'
import { sendJson } from '@/components/features/year-end/shared'
import type { TrackedDeadline } from '@/lib/declarations/status'

const SAVE_ERROR = 'L’échéance n’a pas été enregistrée. Réessayez dans un instant.'
const NO_RECEIPT = 'none'

interface ReceiptOption {
  id: string
  fileName: string
  transaction: { date: string; label: string } | null
}

/** Receipts already in Kledg (Qonto attachments) the record can point to; empty without the rights to list them. */
function useReceipts(companyId: string, enabled: boolean) {
  const [receipts, setReceipts] = React.useState<ReceiptOption[]>([])
  React.useEffect(() => {
    if (!enabled) return
    let cancelled = false
    fetch(`/api/expense-reports/receipts?companyId=${encodeURIComponent(companyId)}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ receipts: ReceiptOption[] }>) : { receipts: [] }))
      .then((data) => !cancelled && setReceipts(Array.isArray(data?.receipts) ? data.receipts : []))
      .catch(() => !cancelled && setReceipts([]))
    return () => {
      cancelled = true
    }
  }, [companyId, enabled])
  return receipts
}

/**
 * Marks a deadline filed, paid or not due (docs/echeances.md): the dates the
 * deadline asks for, the amount, a receipt already in Kledg or its
 * reference, a note. A field another page owns (VAT return, IS filing and
 * acomptes, approval of the accounts) is shown with a link to that page
 * instead of an input, so it is never entered twice.
 */
export function MarkDeclarationDialog({
  companyId,
  deadline,
  open,
  onOpenChange,
  onSaved,
  canListReceipts,
}: {
  companyId: string
  deadline: TrackedDeadline
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (updated: TrackedDeadline) => void
  canListReceipts: boolean
}) {
  const status = deadline.status
  const record = status.record
  const asksFiling = status.kind !== 'pay'
  const asksPayment = status.kind !== 'file'
  const filedLocked = status.locked.includes('filedOn')
  const paidLocked = status.locked.includes('paidOn')
  const [filedOn, setFiledOn] = React.useState(record?.filedOn ?? '')
  const [paidOn, setPaidOn] = React.useState(record?.paidOn ?? '')
  const [amount, setAmount] = React.useState<number | null>(record?.amountCents ?? null)
  const [notDue, setNotDue] = React.useState(record?.notDue ?? false)
  const [attachmentId, setAttachmentId] = React.useState(record?.attachmentId ?? NO_RECEIPT)
  const [reference, setReference] = React.useState(record?.attachmentReference ?? '')
  const [note, setNote] = React.useState(record?.note ?? '')
  const [saving, setSaving] = React.useState(false)
  const receipts = useReceipts(companyId, open && canListReceipts)
  const url = `/api/companies/${encodeURIComponent(companyId)}/declarations/status`

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        deadlineId: deadline.id,
        notDue,
        amountCents: amount,
        attachmentId: attachmentId === NO_RECEIPT ? null : attachmentId,
        attachmentReference: reference,
        note,
      }
      if (asksFiling && !filedLocked) body.filedOn = notDue ? null : filedOn || null
      if (asksPayment && !paidLocked) body.paidOn = notDue ? null : paidOn || null
      const updated = await sendJson<TrackedDeadline>(url, 'PUT', body, SAVE_ERROR)
      if (updated) onSaved(updated)
      toast.success('Échéance enregistrée')
      onOpenChange(false)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const clear = async () => {
    setSaving(true)
    try {
      const updated = await sendJson<TrackedDeadline>(`${url}?deadlineId=${encodeURIComponent(deadline.id)}`, 'DELETE', undefined, SAVE_ERROR)
      if (updated) onSaved(updated)
      toast.success('Enregistrement retiré')
      onOpenChange(false)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const sourceLink = status.sourcePage ? (
    <Link href={`/${companyId}/${status.sourcePage.page}`} className="text-link inline-flex items-center gap-1 underline-offset-4 hover:underline">
      {status.sourcePage.label}
      <ArrowRight aria-hidden className="size-3.5" />
    </Link>
  ) : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{deadline.label}</DialogTitle>
            <DialogDescription>
              Échéance du <DateDisplay value={deadline.date} format="long" />. Enregistrez ce que vous avez déposé ou payé sur impots.gouv.fr&nbsp;: Kledg ne dépose et ne paie rien.
            </DialogDescription>
          </DialogHeader>

          {deadline.condition ? (
            <div className="flex items-start gap-2">
              <Checkbox id="declaration-not-due" checked={notDue} onCheckedChange={(v) => setNotDue(v === true)} disabled={status.locked.includes('notDue')} />
              <Label htmlFor="declaration-not-due" className="text-sm leading-snug font-normal">
                Non due cette fois ({deadline.condition.replace(/\.$/, '').toLowerCase()})
              </Label>
            </div>
          ) : null}

          {asksFiling ? (
            filedLocked ? (
              <p className="text-muted-foreground text-sm">
                {status.filedOn ? (
                  <>
                    Déposée le <DateDisplay value={status.filedOn} />, d’après la page{' '}
                  </>
                ) : (
                  <>Le dépôt s’enregistre sur la page </>
                )}
                {sourceLink}.
              </p>
            ) : (
              <Field label="Déposée le" htmlFor="declaration-filed-on" hint={notDue ? 'Sans objet pour une échéance non due.' : undefined}>
                <DateInput id="declaration-filed-on" value={filedOn} onValueChange={setFiledOn} disabled={notDue} />
              </Field>
            )
          ) : null}

          {asksPayment ? (
            paidLocked ? (
              <p className="text-muted-foreground text-sm">
                {status.paidOn ? (
                  <>
                    Payée le <DateDisplay value={status.paidOn} />, d’après la page{' '}
                  </>
                ) : (
                  <>Le paiement s’enregistre sur la page </>
                )}
                {sourceLink}.
              </p>
            ) : (
              <Field label="Payée le" htmlFor="declaration-paid-on">
                <DateInput id="declaration-paid-on" value={paidOn} onValueChange={setPaidOn} disabled={notDue} />
              </Field>
            )
          ) : null}

          <Field label="Montant" htmlFor="declaration-amount" optional>
            <AmountInput id="declaration-amount" value={amount} onValueChange={setAmount} disabled={notDue} />
          </Field>

          {canListReceipts && receipts.length > 0 ? (
            <Field label="Pièce justificative" htmlFor="declaration-receipt" optional hint="Une pièce déjà dans Kledg, par exemple jointe à l’opération bancaire du paiement.">
              <Select value={attachmentId} onValueChange={setAttachmentId}>
                <SelectTrigger id="declaration-receipt" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_RECEIPT}>Aucune</SelectItem>
                  {receipts.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.fileName}
                      {r.transaction ? `, ${r.transaction.label}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          <Field label="Référence de la pièce" htmlFor="declaration-reference" optional hint="Numéro d’accusé de réception, référence de l’avis ou du paiement.">
            <Input id="declaration-reference" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={200} placeholder="ex. accusé de réception n° 1234" />
          </Field>

          <Field label="Note" htmlFor="declaration-note" optional>
            <Textarea id="declaration-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={2} />
          </Field>

          <DialogFooter className="gap-2 sm:justify-between">
            {record ? (
              <Button type="button" variant="ghost" onClick={clear} disabled={saving}>
                Retirer l’enregistrement
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                Annuler
              </Button>
              <Button type="submit" loading={saving}>
                Enregistrer
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
