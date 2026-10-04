'use client'

import { Copy } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** A value to paste elsewhere (certificate, redirect URI), with a copy button. */
export function CopyValue({ value, label, multiline = false }: { value: string; label: string; multiline?: boolean }) {
  return (
    <div className="bg-muted flex items-start gap-2 rounded-md p-2 font-mono text-xs">
      <code className={cn('flex-1 break-all', multiline && 'max-h-40 overflow-auto whitespace-pre-wrap')}>{value}</code>
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label={`Copier ${label}`}
        title="Copier"
        onClick={async () => {
          await navigator.clipboard.writeText(value)
          toast.success('Copié')
        }}
      >
        <Copy aria-hidden />
      </Button>
    </div>
  )
}
