import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getAuditContext, writeAuditLog } from '../audit'

vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())

vi.mock('@/lib/session', () => ({
  getCurrentUser: vi.fn(),
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(),
}))

import { prisma } from '@/lib/prisma'
import { asPrismaMock } from '@/lib/__tests__/helpers/prisma-mock'
import { getCurrentUser } from '@/lib/session'
import { headers } from 'next/headers'

const db = asPrismaMock(prisma)

describe('Audit Logging', () => {
  beforeEach(() => {
    delete process.env.TRUST_PROXY_HOPS
    vi.clearAllMocks()
  })

  describe('getAuditContext', () => {
    it('records only a client IP vouched for by the proxy configuration', async () => {
      vi.mocked(getCurrentUser).mockResolvedValue(null)
      vi.mocked(headers).mockResolvedValue(new Headers({ 'x-forwarded-for': '6.6.6.6', 'x-real-ip': '6.6.6.6' }) as never)
      delete process.env.TRUST_PROXY_HOPS
      expect((await getAuditContext()).ipAddress).toBeNull()
    })

    it('should return user context when authenticated', async () => {
      process.env.TRUST_PROXY_HOPS = '1'
      const mockHeaders = new Map([
        ['x-forwarded-for', '192.168.1.1'],
        ['user-agent', 'Mozilla/5.0'],
      ])

      vi.mocked(getCurrentUser).mockResolvedValue({
        id: 'user-123',
        email: 'test@example.com',
        name: null,
        role: null,
      })
      vi.mocked(headers).mockResolvedValue(mockHeaders as never)

      const context = await getAuditContext()

      expect(context.userId).toBe('test@example.com')
      expect(context.ipAddress).toBe('192.168.1.1')
      expect(context.userAgent).toBe('Mozilla/5.0')
      delete process.env.TRUST_PROXY_HOPS
    })

    it('should return empty context when not authenticated', async () => {
      const mockHeaders = new Map()

      vi.mocked(getCurrentUser).mockResolvedValue(null)
      vi.mocked(headers).mockResolvedValue(mockHeaders as never)

      const context = await getAuditContext()

      expect(context.userId).toBeNull()
      expect(context.ipAddress).toBeNull()
      expect(context.userAgent).toBeNull()
    })

    it('should handle errors gracefully', async () => {
      vi.mocked(getCurrentUser).mockRejectedValue(new Error('Auth error'))
      vi.mocked(headers).mockRejectedValue(new Error('Headers error'))

      const context = await getAuditContext()

      expect(context.userId).toBeNull()
      expect(context.ipAddress).toBeNull()
      expect(context.userAgent).toBeNull()
    })
  })

  describe('writeAuditLog', () => {
    it('should write audit log to database', async () => {
      process.env.TRUST_PROXY_HOPS = '1'
      const mockHeaders = new Map([
        ['x-forwarded-for', '192.168.1.1'],
        ['user-agent', 'Mozilla/5.0'],
      ])

      vi.mocked(getCurrentUser).mockResolvedValue({
        id: 'user-123',
        email: 'test@example.com',
        name: null,
        role: null,
      })
      vi.mocked(headers).mockResolvedValue(mockHeaders as never)
      db.auditLog.createMany.mockResolvedValue({
        id: 'log-123',
        userId: 'test@example.com',
        action: 'CREATE_ACCOUNT',
        level: 'INFO',
        message: 'Account created',
        metadata: { accountId: 'acc-123' },
        companyId: 'company-123',
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        createdAt: new Date(),
      })

      await writeAuditLog('info', 'Account created', {
        action: 'CREATE_ACCOUNT',
        companyId: 'company-123',
        metadata: { accountId: 'acc-123' },
      })

      expect(db.auditLog.createMany).toHaveBeenCalledWith({
        data: {
          userId: 'test@example.com',
          action: 'CREATE_ACCOUNT',
          level: 'INFO',
          message: 'Account created',
          metadata: { accountId: 'acc-123' },
          companyId: 'company-123',
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
        },
      })
    })

    it('should use provided context instead of fetching', async () => {
      db.auditLog.createMany.mockResolvedValue({
        id: 'log-123',
        userId: 'custom-user',
        action: 'UPDATE_ACCOUNT',
        level: 'INFO',
        message: 'Account updated',
        metadata: null,
        companyId: 'company-123',
        ipAddress: '10.0.0.1',
        userAgent: 'Custom Agent',
        createdAt: new Date(),
      })

      await writeAuditLog('info', 'Account updated', {
        action: 'UPDATE_ACCOUNT',
        companyId: 'company-123',
        context: {
          userId: 'custom-user',
          ipAddress: '10.0.0.1',
          userAgent: 'Custom Agent',
        },
      })

      expect(db.auditLog.createMany).toHaveBeenCalledWith({
        data: {
          userId: 'custom-user',
          action: 'UPDATE_ACCOUNT',
          level: 'INFO',
          message: 'Account updated',
          metadata: undefined,
          companyId: 'company-123',
          ipAddress: '10.0.0.1',
          userAgent: 'Custom Agent',
        },
      })

      expect(getCurrentUser).not.toHaveBeenCalled()
      expect(headers).not.toHaveBeenCalled()
    })

    it('should map log levels correctly', async () => {
      db.auditLog.createMany.mockResolvedValue({})

      const levels = ['debug', 'info', 'warn', 'error'] as const
      const expectedLevels = ['DEBUG', 'INFO', 'WARN', 'ERROR']

      for (let i = 0; i < levels.length; i++) {
        vi.clearAllMocks()
        await writeAuditLog(levels[i], 'Test message', {
          context: { userId: 'test' },
        })

        expect(db.auditLog.createMany).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              level: expectedLevels[i],
            }),
          })
        )
      }
    })

    it('should handle database errors gracefully', async () => {
      db.auditLog.createMany.mockRejectedValue(
        new Error('Database error')
      )

      await expect(
        writeAuditLog('error', 'Test error', {
          context: { userId: 'test' },
        })
      ).resolves.not.toThrow()
    })

    it('should handle null values correctly', async () => {
      db.auditLog.createMany.mockResolvedValue({})

      await writeAuditLog('info', 'Test message', {
        context: {
          userId: null,
          ipAddress: null,
          userAgent: null,
        },
      })

      expect(db.auditLog.createMany).toHaveBeenCalledWith({
        data: {
          userId: null,
          action: null,
          level: 'INFO',
          message: 'Test message',
          metadata: undefined,
          companyId: null,
          ipAddress: null,
          userAgent: null,
        },
      })
    })
  })
})
