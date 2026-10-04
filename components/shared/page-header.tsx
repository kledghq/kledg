import { BookOpen } from 'lucide-react'

import { cn } from '@/lib/utils'

interface PageHeaderProps {
  title: string
  /** One sentence: what this page is for, in plain French. */
  description?: React.ReactNode
  /** Page level actions: default size buttons, primary action last. */
  actions?: React.ReactNode
  /** Link to the documentation page for this screen (shown as "Aide"). */
  docsHref?: string
  children?: React.ReactNode
  className?: string
}

/**
 * Page title row. The title and the actions wrap instead of overlapping when
 * they don't fit side by side; actions keep the default button size.
 */
export function PageHeader({
  title,
  description,
  actions,
  docsHref,
  children,
  className,
}: PageHeaderProps) {
  return (
    <div
      data-slot="page-header"
      className={cn('flex flex-wrap items-start justify-between gap-x-6 gap-y-3', className)}
    >
      <div className="min-w-0 flex-1 basis-72 space-y-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight break-words">{title}</h1>
          {description || docsHref ? (
            <p className="text-muted-foreground max-w-prose text-sm">
              {description}
              {docsHref ? (
                <>
                  {description ? ' ' : null}
                  <a
                    href={docsHref}
                    target="_blank"
                    rel="noreferrer"
                    data-touch-target
                    className="text-link inline-flex items-center gap-1 whitespace-nowrap underline-offset-4 hover:underline"
                  >
                    <BookOpen aria-hidden className="size-3.5" />
                    Aide
                  </a>
                </>
              ) : null}
            </p>
          ) : null}
        </div>
        {children}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}
