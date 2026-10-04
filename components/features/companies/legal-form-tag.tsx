import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { displayCompanyName, legalFormName, legalFormTag } from '@/lib/companies/legal-forms'

/**
 * The legal form of a company as a small neutral tag ("SASU"), with the full
 * name for screen readers and on hover. Renders nothing when the form is
 * unknown.
 */
export function LegalFormTag({ legalType, className }: { legalType: string | null | undefined; className?: string }) {
  const tag = legalFormTag(legalType)
  if (!tag) return null
  const name = legalFormName(legalType)
  return (
    <Badge variant="outline" title={name ?? undefined} className={cn('text-muted-foreground px-1 py-0 text-[10px] leading-4 font-medium', className)}>
      <span aria-hidden>{tag}</span>
      <span className="sr-only">{name}</span>
    </Badge>
  )
}

/** A company name without its legal form, followed by the legal form tag. */
export function CompanyNameWithForm({
  name,
  legalType,
  className,
  nameClassName,
}: {
  name: string
  legalType: string | null | undefined
  className?: string
  nameClassName?: string
}) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <span className={cn('truncate', nameClassName)}>{displayCompanyName(name, legalType)}</span>
      <LegalFormTag legalType={legalType} />
    </span>
  )
}
