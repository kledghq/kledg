/**
 * Markdown rendering of a generated document: plain text the user can edit
 * in any editor (or paste into a word processor) before signing. Pure.
 */

import type { Block, GeneratedDocument } from './model'

/** Escapes the characters Markdown would read as formatting. */
function escape(text: string): string {
  return text.replace(/([\\`*_[\]#|<>])/g, '\\$1').replace(/^(\s*)([-+]|\d+\.)(\s)/, '$1\\$2$3')
}

const cell = (text: string) => escape(text).replace(/\n/g, ' ')

function block(b: Block): string {
  switch (b.kind) {
    case 'heading':
      return `## ${escape(b.text)}`
    case 'paragraph':
      return escape(b.text)
    case 'note':
      return `> ${escape(b.text)}`
    case 'list':
      return b.items.map((i) => `- ${escape(i)}`).join('\n')
    case 'checklist':
      return b.items.map((i) => `- [ ] ${escape(i)}`).join('\n')
    case 'table': {
      const align = b.columns.map((_, i) => (b.numeric?.includes(i) ? '---:' : '---'))
      return [
        `| ${b.columns.map(cell).join(' | ')} |`,
        `| ${align.join(' | ')} |`,
        ...b.rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
      ].join('\n')
    }
    case 'signatures': {
      const lines: string[] = []
      if (b.place || b.date) lines.push(escape(`Fait${b.place ? ` à ${b.place}` : ''}${b.date ? `, le ${b.date}` : ''}`))
      for (const s of b.signers) lines.push(`${escape(s.name)}, ${escape(s.role)}\n\nSignature :\n\n\n`)
      return lines.join('\n\n')
    }
  }
}

export function renderMarkdown(doc: GeneratedDocument): string {
  const parts = [
    doc.header.map((line, i) => (i === 0 ? `**${escape(line)}**` : escape(line))).join('  \n'),
    `# ${escape(doc.title)}`,
    ...(doc.subtitle ? [`*${escape(doc.subtitle)}*`] : []),
    ...doc.blocks.map(block),
  ]
  return `${parts.join('\n\n').trimEnd()}\n`
}
