import { describe, expect, it } from 'vitest'
import { createId } from '../ids'

describe('createId', () => {
  it('is shaped like a Prisma cuid and unique across a burst', () => {
    const ids = Array.from({ length: 5000 }, () => createId())
    for (const id of ids.slice(0, 50)) expect(id).toMatch(/^c[0-9a-z]{24}$/)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
