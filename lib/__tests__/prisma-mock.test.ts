import { describe, expect, it, vi } from 'vitest'
import { createPrismaMock, resetPrismaMock } from './helpers/prisma-mock'

describe('createPrismaMock', () => {
  it('creates each model method once, as a mock the test configures', async () => {
    const db = createPrismaMock()
    db.account.findMany.mockResolvedValue([{ id: 'acc-1' }])

    await expect(db.account.findMany({ where: { companyId: 'c1' } })).resolves.toEqual([{ id: 'acc-1' }])
    expect(db.account.findMany).toBe(db.account.findMany)
    expect(db.account.findMany).toHaveBeenCalledWith({ where: { companyId: 'c1' } })
    expect(db.journal.findMany).not.toHaveBeenCalled()
    expect(db.account.findMany.mock.calls[0][0]?.where).toEqual({ companyId: 'c1' })
  })

  it('runs an interactive transaction with the mock and awaits a batch', async () => {
    const db = createPrismaMock()
    db.journal.create.mockResolvedValue({ id: 'j1' })

    const result = await db.$transaction(async (tx: typeof db) => tx.journal.create({ data: { companyId: 'c1', code: 'BQ', label: 'Banque' } }))
    expect(result).toEqual({ id: 'j1' })
    await expect(db.$transaction([Promise.resolve(1), Promise.resolve(2)])).resolves.toEqual([1, 2])
  })

  it('keeps the transaction behaviour after clearAllMocks and restores it after resetAllMocks', async () => {
    const db = createPrismaMock()
    vi.clearAllMocks()
    await expect(db.$transaction([Promise.resolve('a')])).resolves.toEqual(['a'])

    vi.resetAllMocks()
    resetPrismaMock(db)
    await expect(db.$transaction([Promise.resolve('b')])).resolves.toEqual(['b'])
  })

  it('is not a thenable, so it can be returned from a module factory', async () => {
    const db = createPrismaMock()
    expect((db as unknown as { then?: unknown }).then).toBeUndefined()
    expect(await Promise.resolve(db)).toBe(db)
  })
})
