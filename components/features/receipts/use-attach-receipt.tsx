'use client'

/**
 * Attaching a receipt from a transaction row (docs/justificatifs-photo.md):
 * the user picks a file (or takes a photo on a phone) for that transaction,
 * which is dropped like any receipt (POST /api/receipts/staged) and attached
 * to it at once (POST /api/receipts/staged/[id]/attach). The transaction is
 * the one of the row: no search, no guess. A Qonto transaction is confirmed
 * first, since Qonto then holds the file and Kledg cannot remove it there.
 * A file dropped but not attached (a refusal, a lost connection) stays in
 * the receipts dropped on the Justificatifs page.
 */

import * as React from 'react'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/shared'
import { responseError } from '@/hooks/use-cursor-list'
import { RECEIPT_ACCEPT } from '@/lib/receipts/file-type'
import type { StagedReceiptView } from '@/lib/receipts/stage-receipt.service'
import { prepareReceiptFile } from './prepare-receipt-file'

export interface AttachTarget {
  companyId: string
  transactionId: string
  /** The transaction as the user knows it (counterparty or label), for the messages. */
  label: string
  /** Attaching sends the file to Qonto. */
  toQonto: boolean
}

async function attachFile(target: AttachTarget, file: File): Promise<void> {
  const ready = await prepareReceiptFile(file)
  const form = new FormData()
  form.set('companyId', target.companyId)
  form.set('file', ready)
  const staged = await fetch('/api/receipts/staged', { method: 'POST', body: form })
  if (!staged.ok) throw new Error(await responseError(staged, "Le justificatif n'a pas pu être déposé. Réessayez."))
  const { receipt } = (await staged.json()) as { receipt: StagedReceiptView }
  const attached = await fetch(`/api/receipts/staged/${encodeURIComponent(receipt.id)}/attach`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactionId: target.transactionId }),
  })
  if (!attached.ok) {
    const reason = await responseError(attached, "Le justificatif n'a pas pu être rattaché.")
    throw new Error(`${reason} Il reste dans les justificatifs déposés de la page Justificatifs.`)
  }
}

/**
 * `start(target)` opens the file picker for that transaction; `element`
 * (the hidden input and the Qonto confirmation) goes once in the page;
 * `busyId` is the transaction being attached to.
 */
export function useAttachReceipt(onAttached?: (target: AttachTarget) => void) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const targetRef = React.useRef<AttachTarget | null>(null)
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [toConfirm, setToConfirm] = React.useState<{ target: AttachTarget; file: File } | null>(null)

  const run = React.useCallback(
    async (target: AttachTarget, file: File) => {
      setBusyId(target.transactionId)
      try {
        await attachFile(target, file)
        toast.success(target.toQonto ? 'Justificatif envoyé à Qonto' : 'Justificatif rattaché')
        onAttached?.(target)
      } catch (error) {
        toast.error((error as Error).message)
      } finally {
        setBusyId(null)
      }
    },
    [onAttached],
  )

  const start = React.useCallback((target: AttachTarget) => {
    targetRef.current = target
    inputRef.current?.click()
  }, [])

  function picked(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    const target = targetRef.current
    event.target.value = ''
    if (!file || !target) return
    if (target.toQonto) setToConfirm({ target, file })
    else void run(target, file)
  }

  const element = (
    <>
      <input ref={inputRef} type="file" accept={RECEIPT_ACCEPT} className="sr-only" tabIndex={-1} aria-hidden onChange={picked} data-testid="attach-receipt-input" />
      <ConfirmDialog
        open={toConfirm !== null}
        onOpenChange={(open) => !open && setToConfirm(null)}
        title={'Envoyer le justificatif à Qonto ?'}
        description={
          toConfirm
            ? `${toConfirm.file.name} sera joint à la transaction ${toConfirm.target.label} chez Qonto, puis synchronisé dans Kledg. Kledg ne pourra pas le retirer de Qonto.`
            : ''
        }
        confirmLabel="Envoyer"
        tone="default"
        onConfirm={() => {
          const pending = toConfirm
          setToConfirm(null)
          if (pending) void run(pending.target, pending.file)
        }}
      />
    </>
  )

  return { start, element, busyId }
}
