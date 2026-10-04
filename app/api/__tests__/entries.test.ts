import { describe, it, expect, beforeEach, vi } from 'vitest'
import { GET, POST } from '../entries/route'
import { NextRequest } from 'next/server'

// Mock dependencies
vi.mock('@/lib/session', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({
    id: 'user-1',
    email: 'test@example.com',
    name: null,
    role: null,
  }),
}))

vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())

vi.mock('@/lib/accounting/services', () => ({
  createEntry: vi.fn(),
}))

vi.mock('@/lib/rbac/authorize', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rbac/authorize')>('@/lib/rbac/authorize')
  return {
    ...actual,
    getUserRolesForCompany: vi.fn().mockResolvedValue(['companyAdmin']),
    isGlobalAdmin: vi.fn().mockReturnValue(false),
  }
})

// Company references resolve to themselves (no slug lookup)
vi.mock('@/lib/companies/slug', () => ({
  resolveCompanyRef: vi.fn(async (ref: string) => ref),
}))

vi.mock('@/lib/audit', () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}))

import { prisma } from '@/lib/prisma'
import { asPrismaMock } from '@/lib/__tests__/helpers/prisma-mock'
import { createEntry } from '@/lib/accounting/services'

const db = asPrismaMock(prisma)

describe('API /api/entries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.accountingEntry.findMany.mockResolvedValue([])
    db.entryLine.findMany.mockResolvedValue([])
    db.entryLine.groupBy.mockResolvedValue([])
    db.account.findMany.mockResolvedValue([])
  })

  describe('GET', () => {
    it('should return entries for a company', async () => {
      const mockEntries = [
        {
          id: 'entry-1',
          entryNumber: '001',
          date: new Date('2026-01-01'),
          description: 'Test entry',
          companyId: 'company-1',
          journal: { id: 'journal-1', code: 'OD', label: 'Opérations diverses' },
          lines: [],
        },
      ]

      db.accountingEntry.findMany.mockResolvedValue(mockEntries)

      const request = new NextRequest('http://localhost/api/entries?companyId=company-1')
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toHaveLength(1)
      expect(data[0].id).toBe('entry-1')
      expect(data[0].entryNumber).toBe('001')
    })

    it('attaches lines and their accounts to the entries', async () => {
      db.accountingEntry.findMany.mockResolvedValue([
        { id: 'entry-1', entryNumber: '1', date: new Date('2026-01-02'), companyId: 'company-1' },
        { id: 'entry-2', entryNumber: '2', date: new Date('2026-01-01'), companyId: 'company-1' },
      ])
      db.entryLine.findMany.mockResolvedValue([
        { id: 'l1', accountingEntryId: 'entry-1', accountId: 'a512', debit: '10.00', credit: '0.00' },
        { id: 'l2', accountingEntryId: 'entry-1', accountId: 'a706', debit: '0.00', credit: '10.00' },
      ])
      db.account.findMany.mockResolvedValue([
        { id: 'a512', code: '512000', label: 'Banque' },
        { id: 'a706', code: '706000', label: 'Prestations' },
      ])

      const response = await GET(new NextRequest('http://localhost/api/entries?companyId=company-1'))
      const data = await response.json()

      expect(data.map((e: { id: string }) => e.id)).toEqual(['entry-1', 'entry-2'])
      expect(data[0].lines.map((l: { account: { code: string } }) => l.account.code)).toEqual(['512000', '706000'])
      expect(data[1].lines).toEqual([])
      expect(response.headers.get('X-Next-Cursor')).toBeNull()
      // Stable order for paging
      expect(db.accountingEntry.findMany.mock.calls[0][0]!.orderBy).toEqual([{ date: 'desc' }, { id: 'desc' }])
    })

    it('pages with limit and returns the next cursor in a header', async () => {
      db.accountingEntry.findMany.mockResolvedValue([
        { id: 'entry-3', date: new Date('2026-01-03') },
        { id: 'entry-2', date: new Date('2026-01-02') },
        { id: 'entry-1', date: new Date('2026-01-01') },
      ])

      const response = await GET(new NextRequest('http://localhost/api/entries?companyId=company-1&limit=2'))
      const data = await response.json()

      expect(db.accountingEntry.findMany.mock.calls[0][0]!.take).toBe(3)
      expect(data.map((e: { id: string }) => e.id)).toEqual(['entry-3', 'entry-2'])
      expect(response.headers.get('X-Next-Cursor')).toBe('entry-2')
    })

    it('continues after the cursor entry of the same company', async () => {
      db.accountingEntry.findFirst.mockResolvedValue({ id: 'entry-2', date: new Date('2026-01-02') })
      db.accountingEntry.findMany.mockResolvedValue([{ id: 'entry-1', date: new Date('2026-01-01') }])

      const response = await GET(new NextRequest('http://localhost/api/entries?companyId=company-1&limit=2&cursor=entry-2'))

      expect(db.accountingEntry.findFirst.mock.calls[0][0]!.where).toMatchObject({ companyId: 'company-1', id: 'entry-2' })
      expect(db.accountingEntry.findMany.mock.calls[0][0]!.where).toEqual({
        AND: [
          { companyId: 'company-1' },
          { OR: [{ date: { lt: new Date('2026-01-02') } }, { date: new Date('2026-01-02'), id: { lt: 'entry-2' } }] },
        ],
      })
      expect(response.headers.get('X-Next-Cursor')).toBeNull()
    })

    it('should return 400 if companyId is missing', async () => {
      const request = new NextRequest('http://localhost/api/entries')
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('companyId est requis')
    })

    it('filters in the database: journal, status, number, text and period', async () => {
      db.accountingEntry.findMany.mockResolvedValue([])

      const query = 'journalId=j-1&status=draft&number=12&search=loyer&startDate=2026-01-01&endDate=2026-01-31'
      const response = await GET(new NextRequest(`http://localhost/api/entries?companyId=company-1&limit=50&${query}`))

      expect(response.status).toBe(200)
      expect(db.accountingEntry.findMany.mock.calls[0][0]!.where).toEqual({
        companyId: 'company-1',
        AND: [
          { journalId: 'j-1' },
          { status: 'draft' },
          { entryNumber: { contains: '12', mode: 'insensitive' } },
          {
            OR: [
              { description: { contains: 'loyer', mode: 'insensitive' } },
              { reference: { contains: 'loyer', mode: 'insensitive' } },
              { lines: { some: { description: { contains: 'loyer', mode: 'insensitive' } } } },
            ],
          },
          // Calendar days at midnight UTC, the end day included
          { date: { gte: new Date('2026-01-01T00:00:00.000Z') } },
          { date: { lt: new Date('2026-02-01T00:00:00.000Z') } },
        ],
      })
    })

    it('status "all" does not filter', async () => {
      db.accountingEntry.findMany.mockResolvedValue([])
      await GET(new NextRequest('http://localhost/api/entries?companyId=company-1&status=all'))
      expect(db.accountingEntry.findMany.mock.calls[0][0]!.where).toEqual({ companyId: 'company-1' })
    })

    it('compares the amount bounds on the line sums in the database (exact decimals)', async () => {
      db.entryLine.groupBy.mockResolvedValue([{ accountingEntryId: 'entry-2' }])
      db.accountingEntry.findMany.mockResolvedValue([{ id: 'entry-2', date: new Date('2026-01-02') }])

      const response = await GET(
        new NextRequest('http://localhost/api/entries?companyId=company-1&limit=20&minAmount=100,5&maxAmount=1000'),
      )
      const data = await response.json()

      expect(data.map((e: { id: string }) => e.id)).toEqual(['entry-2'])
      const groupBy = db.entryLine.groupBy.mock.calls[0][0]!
      expect(groupBy.where).toEqual({ accountingEntry: { companyId: 'company-1' } })
      expect(groupBy.having).toEqual({
        AND: [
          { OR: [{ debit: { _sum: { gte: '100.50' } } }, { credit: { _sum: { gte: '100.50' } } }] },
          { debit: { _sum: { lte: '1000.00' } } },
          { credit: { _sum: { lte: '1000.00' } } },
        ],
      })
      const page = db.accountingEntry.findMany.mock.calls[0][0]!
      expect(page.where).toEqual({ id: { in: ['entry-2'] } })
      expect(page.take).toBe(21)
    })

    it('clamps the page size and ignores empty filters', async () => {
      db.accountingEntry.findMany.mockResolvedValue([])
      const response = await GET(
        new NextRequest('http://localhost/api/entries?companyId=company-1&limit=99999&minAmount=&startDate=&status=&journalId='),
      )
      expect(response.status).toBe(200)
      const page = db.accountingEntry.findMany.mock.calls[0][0]!
      expect(page.where).toEqual({ companyId: 'company-1' })
      expect(page.take).toBe(10_001)
    })

    it.each([
      ['minAmount=12.345', 'Montant invalide'],
      ['maxAmount=abc', 'Montant invalide'],
      ['startDate=31/01/2026', 'Date invalide'],
      ['endDate=2026-02-30', 'Date invalide'],
      ['status=deleted', 'Statut invalide'],
    ])('refuses %s with a 400', async (param, message) => {
      const response = await GET(new NextRequest(`http://localhost/api/entries?companyId=company-1&${param}`))
      expect(response.status).toBe(400)
      expect((await response.json()).error).toContain(message)
    })
  })

  describe('POST', () => {
    it('should create a new accounting entry', async () => {
      const mockEntry = {
        id: 'entry-1',
        entryNumber: '001',
        date: new Date('2026-01-01'),
        description: 'Test entry',
        companyId: 'company-1',
        journalId: 'journal-1',
        status: 'draft',
        lines: [],
      }

      vi.mocked(createEntry).mockResolvedValue(mockEntry as never)

      const request = new NextRequest('http://localhost/api/entries', {
        method: 'POST',
        body: JSON.stringify({
          companyId: 'company-1',
          journalId: 'journal-1',
          date: '2026-01-01',
          description: 'Test entry',
          lines: [
            { accountId: 'acc-1', debit: 1000, credit: 0 },
            { accountId: 'acc-2', debit: 0, credit: 1000 },
          ],
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(201)
      expect(data.id).toBe('entry-1')
      expect(data.entryNumber).toBe('001')
      expect(data.companyId).toBe('company-1')
      // Amounts are passed as sent: the service converts them to exact cents
      expect(createEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: 'company-1',
          date: '2026-01-01',
          lines: [
            expect.objectContaining({ accountId: 'acc-1', debit: 1000, credit: 0 }),
            expect.objectContaining({ accountId: 'acc-2', debit: 0, credit: 1000 }),
          ],
        }),
      )
    })

    it('should return 400 if entry is unbalanced', async () => {
      const { ValidationError } = await import('@/lib/accounting/errors')
      vi.mocked(createEntry).mockRejectedValue(
        new ValidationError("L'écriture n'est pas équilibrée")
      )

      const request = new NextRequest('http://localhost/api/entries', {
        method: 'POST',
        body: JSON.stringify({
          companyId: 'company-1',
          journalId: 'journal-1',
          date: '2026-01-01',
          description: 'Test entry',
          lines: [
            { accountId: 'acc-1', debit: 1000, credit: 0 },
            { accountId: 'acc-2', debit: 0, credit: 500 },
          ],
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain('équilibrée')
    })
  })
})
