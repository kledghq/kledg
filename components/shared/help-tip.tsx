'use client'

import { ArrowUpRight, CircleHelp } from 'lucide-react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

interface HelpTipProps {
  /** The term being explained, e.g. "Exercice". Used for the accessible name. */
  term: string
  /** Short explanation, one or two sentences in plain French. */
  children: React.ReactNode
  /** Documentation page that explains the concept in depth. */
  docsHref?: string
  className?: string
}

/**
 * Inline help for an accounting term: a small "?" next to a label that opens
 * a short explanation and a link to the docs. Opens on click or keyboard
 * (Enter/Space), closes with Escape, so it works without a mouse.
 */
export function HelpTip({ term, children, docsHref, className }: HelpTipProps) {
  return (
    <Popover>
      <PopoverTrigger
        type="button"
        data-touch-target
        aria-label={`Aide\u00a0: ${term}`}
        className={cn(
          'text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 inline-flex size-4 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-[3px]',
          className,
        )}
      >
        <CircleHelp aria-hidden className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-2 text-sm">
        <p className="font-medium">{term}</p>
        <div className="text-muted-foreground">{children}</div>
        {docsHref ? (
          <a
            href={docsHref}
            target="_blank"
            rel="noreferrer"
            className="text-link inline-flex items-center gap-1 underline-offset-4 hover:underline"
          >
            Lire la documentation
            <ArrowUpRight aria-hidden className="size-3.5" />
          </a>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
