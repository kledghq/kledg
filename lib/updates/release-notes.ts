/**
 * Release notes are Markdown written on GitHub. They are parsed here into a
 * small tree (headings, lists, paragraphs, bold, code, links) that React
 * renders as text: no HTML from GitHub ever reaches the page, and links are
 * kept only when they point to https URLs.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong'; text: string }
  | { type: 'code'; text: string }
  | { type: 'link'; text: string; href: string }

export type Block =
  | { type: 'heading'; level: 2 | 3 | 4; inlines: Inline[] }
  | { type: 'list'; items: Inline[][] }
  | { type: 'paragraph'; inlines: Inline[] }

const INLINE = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\))/g

export function safeHref(href: string): string | null {
  try {
    const url = new URL(href)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

export function parseInline(source: string): Inline[] {
  const out: Inline[] = []
  let last = 0
  for (const match of source.matchAll(INLINE)) {
    if (match.index > last) out.push({ type: 'text', text: source.slice(last, match.index) })
    if (match[2] !== undefined) out.push({ type: 'strong', text: match[2] })
    else if (match[3] !== undefined) out.push({ type: 'code', text: match[3] })
    else {
      const href = safeHref(match[5])
      out.push(href ? { type: 'link', text: match[4], href } : { type: 'text', text: match[4] })
    }
    last = match.index + match[0].length
  }
  if (last < source.length) out.push({ type: 'text', text: source.slice(last) })
  return out
}

export function parseReleaseNotes(markdown: string): Block[] {
  const blocks: Block[] = []
  let paragraph: string[] = []
  let list: Inline[][] | null = null

  const flush = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', inlines: parseInline(paragraph.join(' ')) })
    paragraph = []
    if (list) blocks.push({ type: 'list', items: list })
    list = null
  }

  // HTML tags and comments are dropped: the notes are shown as text.
  const text = markdown.replace(/<!--[\s\S]*?-->/g, '').replace(/<\/?[A-Za-z][^>]*>/g, '')
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) {
      flush()
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      const level = Math.min(4, Math.max(2, heading[1].length)) as 2 | 3 | 4
      blocks.push({ type: 'heading', level, inlines: parseInline(heading[2]) })
      continue
    }
    const item = /^[-*+]\s+(.*)$/.exec(line)
    if (item) {
      if (paragraph.length) {
        blocks.push({ type: 'paragraph', inlines: parseInline(paragraph.join(' ')) })
        paragraph = []
      }
      list ??= []
      list.push(parseInline(item[1]))
      continue
    }
    if (list) {
      // Continuation of the previous list item.
      const items: Inline[][] = list
      items[items.length - 1] = [...items[items.length - 1], { type: 'text', text: ' ' }, ...parseInline(line)]
      continue
    }
    paragraph.push(line)
  }
  flush()
  return blocks
}
