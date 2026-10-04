'use client'

import * as React from 'react'

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** A question naming the action and its object: "Supprimer le journal BQ ?" */
  title: string
  /** Consequences in plain words: what is lost, what is kept, can it be undone. */
  description?: React.ReactNode
  /** Verb of the action, never "OK" or "Oui": "Supprimer", "Retirer", "Révoquer". */
  confirmLabel?: string
  /** Label while the action runs. Defaults to `${confirmLabel}...`. */
  loadingLabel?: string
  cancelLabel?: string
  /** "destructive" (default) for deletions and irreversible actions. */
  tone?: 'default' | 'destructive'
  /** Disables both buttons and shows the loading label. */
  loading?: boolean
  onConfirm: () => void | Promise<void>
  /** Extra content between the description and the footer (a checkbox, a list). */
  children?: React.ReactNode
}

/**
 * Confirmation for actions that delete data or cannot be undone. The cancel
 * button gets the initial focus, Escape cancels, and the confirm button names
 * the action. Prefer an undo toast over a confirmation when the action is
 * reversible.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirmer',
  loadingLabel,
  cancelLabel = 'Annuler',
  tone = 'destructive',
  loading = false,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !loading && onOpenChange(next)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? (
            <AlertDialogDescription asChild>
              <div>{description}</div>
            </AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>{cancelLabel}</AlertDialogCancel>
          <Button
            variant={tone === 'destructive' ? 'destructive' : 'default'}
            loading={loading}
            onClick={() => void onConfirm()}
          >
            {loading ? (loadingLabel ?? `${confirmLabel}...`) : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

type ConfirmOptions = Omit<ConfirmDialogProps, 'open' | 'onOpenChange' | 'onConfirm' | 'loading' | 'children'>

/**
 * Promise based replacement for `window.confirm()`:
 *
 *   const { confirm, dialog } = useConfirm()
 *   if (!(await confirm({ title: 'Retirer ce membre ?', confirmLabel: 'Retirer' }))) return
 *   ...
 *   return <>{...}{dialog}</>
 */
export function useConfirm() {
  const [state, setState] = React.useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null)

  const confirm = React.useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ ...options, resolve })),
    [],
  )

  const close = (ok: boolean) => {
    state?.resolve(ok)
    setState(null)
  }

  const dialog = (
    <ConfirmDialog
      open={state !== null}
      onOpenChange={(open) => {
        if (!open) close(false)
      }}
      title={state?.title ?? ''}
      description={state?.description}
      confirmLabel={state?.confirmLabel}
      cancelLabel={state?.cancelLabel}
      tone={state?.tone}
      onConfirm={() => close(true)}
    />
  )

  return { confirm, dialog }
}
