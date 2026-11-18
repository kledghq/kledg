import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'

describe('sharedAsyncLocalStorage', () => {
  it('gives two copies of a module the same RLS context (issue #98)', async () => {
    // A production build may evaluate lib/rls/context.ts once per route graph:
    // the Prisma pool reads the copy it was created with, a route enters its own.
    const poolCopy = await import('@/lib/rls/context')
    vi.resetModules()
    const routeCopy = await import('@/lib/rls/context')
    expect(routeCopy).not.toBe(poolCopy)

    const seen = await routeCopy.withUserContext('user-1', async () => poolCopy.currentRlsContext(), {
      companyIds: ['company-1'],
    })
    expect(seen).toEqual({ access: 'user', userId: 'user-1', companyIds: ['company-1'] })
  })

  it('keeps concurrent contexts apart', async () => {
    const { withUserContext, currentRlsContext } = await import('@/lib/rls/context')
    const read = (userId: string) =>
      withUserContext(userId, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        return currentRlsContext()
      })
    const [a, b] = await Promise.all([read('user-a'), read('user-b')])
    expect(a).toMatchObject({ userId: 'user-a' })
    expect(b).toMatchObject({ userId: 'user-b' })
    expect(currentRlsContext()).toBeUndefined()
  })

  it('is the only place that creates an AsyncLocalStorage', () => {
    const files = execSync("git grep --untracked -l 'new AsyncLocalStorage' -- '*.ts' '*.tsx'", { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .filter((file) => !file.includes('__tests__'))
    expect(files).toEqual(['lib/shared-async-storage.ts'])
    expect(readFileSync('lib/shared-async-storage.ts', 'utf8')).toContain('Symbol.for')
  })
})
