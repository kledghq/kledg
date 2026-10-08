/**
 * KLEDG-R3-QUAL-11: one rule for the account of a PCG root, shared by
 * invoices and expense reports (accountByRoot), simple mode
 * (pickLedgerAccount / resolveLedgerAccounts, with the parent fallback),
 * VAT settlement and corporate tax (resolveRootCode) and the exploitant
 * meals account. Before, the same chart gave different accounts.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { loadRootAccounts, pickRootAccount } from '@/lib/accounting/root-account'
import { accountByRoot } from '@/lib/invoices/ledger-accounts'
import { pickLedgerAccount, resolveLedgerAccounts } from '@/lib/simple/ledger-accounts'
import { resolveRootCode } from '@/lib/vat-returns/settlement'

type Row = { id: string; code: string; label: string }
const row = (code: string): Row => ({ id: `id-${code}`, code, label: code })
const codes = (...list: string[]) => list.map(row)

/** Fake client answering the two queries of loadRootAccounts like PostgreSQL would. */
function fakeDb(chart: Row[]) {
  const sorted = [...chart].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
  const findMany = vi.fn(async ({ where }: { where: { code: { in: string[] } } }) => sorted.filter((a) => where.code.in.includes(a.code)))
  const findFirst = vi.fn(async ({ where }: { where: { code: { startsWith: string; not: string } } }) =>
    sorted.find((a) => a.code.startsWith(where.code.startsWith) && a.code !== where.code.not) ?? null,
  )
  return { account: { findMany, findFirst } } as unknown as Parameters<typeof accountByRoot>[0] & { account: { findMany: typeof findMany; findFirst: typeof findFirst } }
}

const FY = { id: 'fy', year: 2026 }

describe('pickRootAccount', () => {
  it.each([
    ['exact code first', '401', ['4011', '401', '401000'], '401'],
    ['root padded with zeros before a detailed account (FEC chart)', '401', ['40100000', '4017000'], '40100000'],
    ['padding of any length', '401', ['4011', '40100000'], '40100000'],
    ['the shortest padding', '44566', ['445660', '44566000'], '445660'],
    ['else the lowest code below the root', '401', ['4017000', '4011'], '4011'],
    ['nothing below: null without parent fallback', '6226', ['622'], null],
  ])('%s', (_name, root, chart, expected) => {
    expect(pickRootAccount(root, codes(...chart))?.code ?? null).toBe(expected)
  })

  it('falls back to the closest parent only when asked, never above two digits', () => {
    expect(pickRootAccount('6226', codes('622', '62'), { parentFallback: true })?.code).toBe('622')
    expect(pickRootAccount('6511', codes('65'), { parentFallback: true })?.code).toBe('65')
    expect(pickRootAccount('6511', codes('6'), { parentFallback: true })).toBeNull()
  })
})

describe('every module picks the same account on the same chart', () => {
  it.each([
    [['40100000', '4017000'], '401'],
    [['4011', '40100000'], '401'],
    [['401', '401000'], '401'],
    [['4017000', '4011'], '401'],
  ])('chart %j, root %s', async (chart, root) => {
    const expected = pickRootAccount(root, codes(...chart))!.code
    expect((await accountByRoot(fakeDb(codes(...chart)), 'c', FY, root, 'Fournisseurs')).code).toBe(expected)
    expect(pickLedgerAccount(root, codes(...chart))?.code).toBe(expected)
    expect((await resolveLedgerAccounts('c', 'fy', [root], fakeDb(codes(...chart)))).get(root)?.code).toBe(expected)
    expect(resolveRootCode(root, chart)).toBe(expected)
  })

  it('invoices refuse a missing root in French, simple mode books on the parent', async () => {
    await expect(accountByRoot(fakeDb(codes('622')), 'c', FY, '6226', 'Honoraires')).rejects.toThrow(/Aucun compte 6226/)
    expect((await resolveLedgerAccounts('c', 'fy', ['6226'], fakeDb(codes('622')))).get('6226')?.code).toBe('622')
  })

  it('loads the accounts of several roots in two queries, whatever the chart size', async () => {
    const db = fakeDb(codes('401', '4011', '445660', '6261', '626100', ...Array.from({ length: 300 }, (_, i) => `411${String(i).padStart(4, '0')}`)))
    const found = await loadRootAccounts(db, 'c', 'fy', ['401', '44566', '626', '411'])
    expect([...found].map(([root, account]) => [root, account?.code ?? null])).toEqual([
      ['401', '401'],
      ['44566', '445660'],
      ['626', '6261'],
      ['411', '4110000'],
    ])
    expect(db.account.findMany).toHaveBeenCalledTimes(1)
  })
})
