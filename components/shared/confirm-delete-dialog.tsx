'use client'

import { ConfirmDialog } from './confirm-dialog'

interface ConfirmDeleteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: React.ReactNode
  /** Idle confirm button label. Defaults to "Supprimer". */
  confirmLabel?: string
  /** Loading confirm button label. Defaults to "Suppression...". */
  loadingLabel?: string
  /** Cancel button label. Defaults to "Annuler". */
  cancelLabel?: string
  /** When true, both buttons disable and confirm shows the loading label. */
  loading?: boolean
  onConfirm: () => void
  /**
   * Optional content rendered between the description and the footer
   * (e.g. an extra checkbox like "supprimer aussi l'écriture associée").
   */
  children?: React.ReactNode
}

/**
 * Deletion confirmation: {@link ConfirmDialog} with the "Supprimer / Annuler"
 * labels and the destructive tone. Kept for existing callers.
 */
export function ConfirmDeleteDialog({
  confirmLabel = 'Supprimer',
  loadingLabel = 'Suppression...',
  ...props
}: ConfirmDeleteDialogProps) {
  return (
    <ConfirmDialog
      tone="destructive"
      confirmLabel={confirmLabel}
      loadingLabel={loadingLabel}
      {...props}
    />
  )
}
