import { describe, expect, it } from 'vitest'
import { parseInline, parseReleaseNotes, safeHref } from '../release-notes'

describe('release notes', () => {
  it('parses headings, lists and paragraphs', () => {
    const blocks = parseReleaseNotes('### Ajouté\n\n- Import **FEC**\n- Export `CSV`\n  suite\n\nUn paragraphe\nsur deux lignes.')
    expect(blocks).toEqual([
      { type: 'heading', level: 3, inlines: [{ type: 'text', text: 'Ajouté' }] },
      {
        type: 'list',
        items: [
          [{ type: 'text', text: 'Import ' }, { type: 'strong', text: 'FEC' }],
          [{ type: 'text', text: 'Export ' }, { type: 'code', text: 'CSV' }, { type: 'text', text: ' ' }, { type: 'text', text: 'suite' }],
        ],
      },
      { type: 'paragraph', inlines: [{ type: 'text', text: 'Un paragraphe sur deux lignes.' }] },
    ])
  })

  it('drops HTML instead of rendering it', () => {
    const blocks = parseReleaseNotes('<script>alert(1)</script>Texte <img src=x onerror=alert(1)> <!-- caché -->')
    expect(JSON.stringify(blocks)).not.toContain('<')
    expect(blocks).toEqual([{ type: 'paragraph', inlines: [{ type: 'text', text: 'alert(1)Texte' }] }])
  })

  it('keeps only https links', () => {
    expect(parseInline('[ok](https://github.com/kledghq/kledg) [js](javascript:alert(1)) [http](http://x.test)')).toEqual([
      { type: 'link', text: 'ok', href: 'https://github.com/kledghq/kledg' },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'js' },
      { type: 'text', text: ') ' },
      { type: 'text', text: 'http' },
    ])
    expect(safeHref('data:text/html,x')).toBeNull()
  })

  it('returns nothing for empty notes', () => {
    expect(parseReleaseNotes('')).toEqual([])
  })
})
