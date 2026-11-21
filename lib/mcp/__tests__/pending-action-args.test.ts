/**
 * Arguments of a pending action as stored and listed for the user's
 * decision (lib/mcp/full-control/pending-actions.ts, #138): a file in
 * base64 is summarised by its size, everything else is kept.
 */

import { describe, expect, it } from 'vitest'
import { storedArgs } from '@/lib/mcp/full-control/pending-actions'

describe('storedArgs', () => {
  it('replaces a file in base64 by its size and keeps the other arguments', () => {
    const file = 'A'.repeat(6_000_000)
    const stored = storedArgs({ companyId: 'c1', fileName: 'releve.csv', contentBase64: file, rows: [{ label: 'x' }] }) as Record<string, unknown>
    expect(stored).toEqual({ companyId: 'c1', fileName: 'releve.csv', contentBase64: '(contenu de 4395 Ko, non conservé)', rows: [{ label: 'x' }] })
    expect(JSON.stringify(stored).length).toBeLessThan(200)
  })

  it('keeps short texts, numbers and nested values as they are', () => {
    expect(storedArgs({ note: 'court', amount: 12.5, ok: true, list: ['a', null] })).toEqual({ note: 'court', amount: 12.5, ok: true, list: ['a', null] })
  })
})
