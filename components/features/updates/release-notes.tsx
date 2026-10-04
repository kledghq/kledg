import { parseReleaseNotes, type Inline } from '@/lib/updates/release-notes'

function Inlines({ items }: { items: Inline[] }) {
  return (
    <>
      {items.map((item, i) => {
        switch (item.type) {
          case 'strong':
            return <strong key={i}>{item.text}</strong>
          case 'code':
            return (
              <code key={i} className="bg-muted rounded px-1 py-0.5 font-mono text-xs">
                {item.text}
              </code>
            )
          case 'link':
            return (
              <a key={i} href={item.href} target="_blank" rel="noreferrer noopener" className="underline underline-offset-4">
                {item.text}
              </a>
            )
          default:
            return <span key={i}>{item.text}</span>
        }
      })}
    </>
  )
}

/** Release notes rendered as text elements: no HTML from GitHub reaches the page. */
export function ReleaseNotes({ markdown }: { markdown: string }) {
  const blocks = parseReleaseNotes(markdown)
  if (blocks.length === 0) {
    return <p className="text-muted-foreground text-sm">Pas de notes pour cette version.</p>
  }
  return (
    <div className="space-y-2 text-sm">
      {blocks.map((block, i) => {
        if (block.type === 'heading') {
          return (
            <p key={i} className={block.level === 2 ? 'pt-1 font-semibold' : 'pt-1 font-medium'}>
              <Inlines items={block.inlines} />
            </p>
          )
        }
        if (block.type === 'list') {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {block.items.map((item, j) => (
                <li key={j}>
                  <Inlines items={item} />
                </li>
              ))}
            </ul>
          )
        }
        return (
          <p key={i}>
            <Inlines items={block.inlines} />
          </p>
        )
      })}
    </div>
  )
}
