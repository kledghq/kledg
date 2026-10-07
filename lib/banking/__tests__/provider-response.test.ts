/**
 * KLEDG-R3-QUAL-28: bank API responses and stored statement layouts are
 * checked with zod at the edge; a changed or damaged format is a clear
 * French error, never a wrong field further down.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { parseProviderResponse } from '@/lib/banking/provider-response'
import { QontoTransactionsResponseSchema } from '@/lib/integrations/providers/qonto/schemas'
import { parseStatementRules, parseTemplateConfig } from '@/lib/reports/config/shared/config-schema'
import { logger } from '@/lib/logger'

const transaction = { transaction_id: 't1', amount: 12.5, side: 'debit', emitted_at: '2026-09-01T09:00:00Z', label: 'Boulangerie' }

describe('parseProviderResponse', () => {
  it('passes a valid response through with the fields Kledg does not check', () => {
    const body = { transactions: [transaction], meta: { next_page: null, total_pages: 1 } }
    expect(parseProviderResponse('Qonto', 'GET /transactions', QontoTransactionsResponseSchema, body)).toEqual(body)
  })

  it.each([
    ['a line without its side', { transactions: [{ ...transaction, side: undefined }], meta: { next_page: null } }],
    ['an amount sent as text', { transactions: [{ ...transaction, amount: '12.50' }], meta: { next_page: null } }],
    ['no pagination', { transactions: [transaction] }],
  ])('refuses %s with a French 502, the detail in the log', (_name, body) => {
    expect(() => parseProviderResponse('Qonto', 'GET /transactions', QontoTransactionsResponseSchema, body)).toThrow(
      expect.objectContaining({ statusCode: 502, message: expect.stringMatching(/^Réponse inattendue de Qonto/) }),
    )
    expect(logger.error).toHaveBeenCalledWith('[bank] Unexpected provider response', expect.objectContaining({ provider: 'Qonto' }))
  })
})

describe('statement layouts', () => {
  const line = { id: 'l1', lineLabel: 'Disponibilités', accountCodes: ['51'], balanceType: 'debit', order: 1, children: [] }

  it('reads valid lines, children included', () => {
    expect(parseStatementRules([{ ...line, children: [{ ...line, id: 'l2', parentId: 'l1' }] }], 'du bilan')).toHaveLength(1)
  })

  it('refuses a damaged layout or template with a French 409', () => {
    expect(() => parseStatementRules([{ ...line, accountCodes: '51' }], 'du bilan')).toThrow(expect.objectContaining({ statusCode: 409, message: expect.stringMatching(/^La mise en page du bilan est illisible/) }))
    expect(() => parseStatementRules([{ ...line, children: [{ id: 'x' }] }], 'du bilan')).toThrow(expect.objectContaining({ statusCode: 409 }))
    expect(() => parseTemplateConfig({})).toThrow(expect.objectContaining({ statusCode: 409 }))
    expect(parseTemplateConfig({ reportVariant: 'simplified', lines: [line] })).toMatchObject({ reportVariant: 'simplified' })
  })
})
