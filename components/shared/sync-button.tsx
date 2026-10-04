'use client'

import { RefreshCw, type LucideIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'

type ButtonProps = React.ComponentProps<typeof Button>

interface SyncButtonProps extends Omit<ButtonProps, 'children'> {
  /** Whether a sync is currently in progress: shows the spinner and disables the button. */
  syncing: boolean
  /** Label, kept while syncing (design system: the spinner says it is running). Defaults to "Synchroniser". */
  label?: string
  /** Icon to display. Defaults to {@link RefreshCw}. */
  icon?: LucideIcon
}

/**
 * Standardized sync/refresh button: the Button `loading` state (spinner in
 * place of the icon, disabled) while `syncing`. Forwards all other Button
 * props (variant, size, onClick, etc.).
 */
export function SyncButton({
  syncing,
  label = 'Synchroniser',
  icon: Icon = RefreshCw,
  variant = 'outline',
  disabled,
  ...props
}: SyncButtonProps) {
  return (
    <Button variant={variant} disabled={disabled} loading={syncing} {...props}>
      <Icon aria-hidden />
      {label}
    </Button>
  )
}
