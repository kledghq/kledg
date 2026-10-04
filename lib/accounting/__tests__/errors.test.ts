import { describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import { z } from 'zod'

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))

import { logger } from '@/lib/logger'
import {
  ConflictError,
  ForbiddenError,
  handleError,
  INTERNAL_ERROR_MESSAGE,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../errors'

const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError(`Invalid \`prisma.company.create()\` invocation: secret detail ${code}`, {
    code,
    clientVersion: '7.0.0',
    meta: { target: ['siren'] },
  })

describe('handleError', () => {
  it('keeps the status and message of application errors', () => {
    expect(handleError(new ValidationError('Montant invalide'))).toEqual({ message: 'Montant invalide', statusCode: 400 })
    expect(handleError(new UnauthorizedError())).toMatchObject({ statusCode: 401 })
    expect(handleError(new ForbiddenError('Non'))).toEqual({ message: 'Non', statusCode: 403 })
    expect(handleError(new NotFoundError('Entry'))).toEqual({ message: 'Entry not found', statusCode: 404 })
    expect(handleError(new NotFoundError('Société introuvable'))).toEqual({ message: 'Société introuvable', statusCode: 404 })
    expect(handleError(new ConflictError('Doublon'))).toEqual({ message: 'Doublon', statusCode: 409 })
  })

  it('maps known Prisma errors by code, without leaking their message', () => {
    expect(handleError(prismaError('P2002'))).toMatchObject({ statusCode: 409 })
    expect(handleError(prismaError('P2003'))).toMatchObject({ statusCode: 400 })
    expect(handleError(prismaError('P2025'))).toMatchObject({ statusCode: 404 })
    for (const code of ['P2002', 'P2003', 'P2025']) {
      expect(handleError(prismaError(code)).message).not.toMatch(/prisma|secret/i)
    }
  })

  it('maps zod errors to 400', () => {
    const result = z.object({ amount: z.number() }).safeParse({ amount: 'x' })
    expect(result.success).toBe(false)
    if (!result.success) expect(handleError(result.error)).toMatchObject({ statusCode: 400 })
  })

  it('hides unexpected errors behind a generic 500 and logs them', () => {
    vi.mocked(logger.error).mockClear()
    const error = new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2')
    expect(handleError(error)).toEqual({ message: INTERNAL_ERROR_MESSAGE, statusCode: 500 })
    expect(handleError('boom')).toEqual({ message: INTERNAL_ERROR_MESSAGE, statusCode: 500 })
    expect(handleError(prismaError('P2034'))).toEqual({ message: INTERNAL_ERROR_MESSAGE, statusCode: 500 })
    expect(logger.error).toHaveBeenCalledWith(expect.any(String), error)
  })

  it('no longer trusts message sniffing', () => {
    expect(handleError(new Error('Unique constraint failed on the fields: (`siren`)'))).toMatchObject({ statusCode: 500 })
    expect(handleError(new Error('Validation failed: SELECT * FROM users'))).toMatchObject({ statusCode: 500 })
  })
})
