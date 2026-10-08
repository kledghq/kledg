import { cn } from '@/lib/utils/cn'

/**
 * Kledg mark, shared with kledg.com: a "K" whose stem is a double rule (the
 * debit | credit split of a T-account). Monochrome like the website: an ink
 * tile with the K cut out in the page color, inverting with the theme.
 */
const MARK_PATHS = [
  'M7.4 8h3v16h-3z',
  'M11.5 8h3v16h-3z',
  'M14.5 14.4 20.9 8h3.6l-8 8 8 8h-3.6l-6.4-6.4z',
]

function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn('size-6 shrink-0', className)}>
      <rect width="32" height="32" rx="7" className="fill-foreground" />
      {MARK_PATHS.map((d) => (
        <path key={d} d={d} className="fill-background" />
      ))}
    </svg>
  )
}

export function Logo({
  className,
  wordmarkClassName,
}: {
  className?: string
  /** Classes for the "Kledg" text, e.g. `max-sm:sr-only` to keep only the mark on phones. */
  wordmarkClassName?: string
}) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-semibold tracking-tight', className)}>
      <LogoMark />
      <span className={wordmarkClassName}>Kledg</span>
    </span>
  )
}
