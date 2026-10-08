/**
 * KLEDG-R3-QUAL-25: one journal lookup by code. Case and spaces never
 * matter, the exact spelling wins when a FEC import brought several, and
 * only Kledg's own postings create a missing standard journal.
 */

import { describe, expect, it, vi } from 'vitest'
import { journalByCode, normalizeJournalCode } from '@/lib/accounting/journal-by-code'

type Row = { id: string; code: string; label: string }

function fakeDb(journals: Row[]) {
  const findMany = vi.fn(async ({ where }: { where: { code: { equals: string } } }) =>
    journals.filter((j) => j.code.toLowerCase() === where.code.equals.toLowerCase()).sort((a, b) => (a.code < b.code ? -1 : 1)),
  )
  const upsert = vi.fn(async ({ create }: { create: { code: string; label: string } }) => ({ id: `new-${create.code}`, code: create.code, label: create.label }))
  return { journal: { findMany, upsert } } as unknown as Parameters<typeof journalByCode>[0] & { journal: { findMany: typeof findMany; upsert: typeof upsert } }
}

describe('journalByCode', () => {
  it('ignores case and spaces', async () => {
    const db = fakeDb([{ id: 'bq', code: 'BQ', label: 'Banque' }])
    for (const code of ['BQ', 'bq', ' Bq ']) expect((await journalByCode(db, 'c', code))?.id).toBe('bq')
    expect(normalizeJournalCode(' od ')).toBe('OD')
  })

  it('prefers the exact spelling, then the upper case one', async () => {
    const db = fakeDb([
      { id: 'lower', code: 'bq', label: 'Banque importée' },
      { id: 'upper', code: 'BQ', label: 'Banque' },
    ])
    expect((await journalByCode(db, 'c', 'bq'))?.id).toBe('lower')
    expect((await journalByCode(db, 'c', 'Bq'))?.id).toBe('upper')
  })

  it('only creates when asked, in upper case with the given label', async () => {
    const db = fakeDb([])
    expect(await journalByCode(db, 'c', 'od')).toBeNull()
    expect(db.journal.upsert).not.toHaveBeenCalled()
    expect(await journalByCode(db, 'c', 'od', { create: { label: 'Opérations diverses' } })).toEqual({ id: 'new-OD', code: 'OD', label: 'Opérations diverses' })
  })

  it('never matches an empty code', async () => {
    const db = fakeDb([{ id: 'x', code: '', label: '' }])
    expect(await journalByCode(db, 'c', '  ')).toBeNull()
  })
})
