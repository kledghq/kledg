import { ArrowUpRight, type LucideIcon } from 'lucide-react'

/** A link to the documentation or to a host's console, opened in a new tab. */
export function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-link inline-flex items-center gap-1 underline-offset-4 hover:underline pointer-coarse:-my-3 pointer-coarse:py-3">
      {children}
      <ArrowUpRight aria-hidden className="size-3.5" />
    </a>
  )
}

/** One setting of the instance: icon, title, status badge, explanation and steps. */
export function StatusRow({
  icon: Icon,
  title,
  status,
  children,
}: {
  icon: LucideIcon
  title: string
  status: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <li className="flex gap-3 py-4 first:pt-0 last:pb-0">
      <span aria-hidden className="bg-background text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md border">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">{title}</h3>
          {status}
        </div>
        <div className="text-muted-foreground max-w-prose space-y-2 text-sm">{children}</div>
      </div>
    </li>
  )
}

/** Numbered steps inside a status row. */
export function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="list-decimal space-y-1 pl-5 marker:text-xs">{children}</ol>
}
