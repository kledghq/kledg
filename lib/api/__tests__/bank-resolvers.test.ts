/**
 * #149: two companies connected to the same Qonto organization hold the
 * same attachment id. The receipt route resolves the company of the query
 * string first, so the second company's members reach their own copy.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/banking/revolut-connection.service', () => ({ companyOfRevolutState: vi.fn(), REVOLUT_STATE_COOKIE: 'state' }))
vi.mock('@/lib/session', () => ({ getCurrentUser: vi.fn() }))
vi.mock('@/lib/companies/slug', () => ({ resolveCompanyRef: vi.fn(async (ref: string) => ref) }))
vi.mock('@/lib/integrations/providers/qonto/read-qonto-attachments.service', () => ({
  companyOfQontoAttachment: vi.fn(async () => ({ companyId: 'first-company' })),
}))

import { fromQontoAttachment } from '../bank-resolvers'
import { companyOfQontoAttachment } from '@/lib/integrations/providers/qonto/read-qonto-attachments.service'

const input = (url: string) => ({
  request: new NextRequest(url),
  params: { attachmentId: 'qa-1' },
  json: async () => null,
  formData: async () => new FormData(),
})

describe('fromQontoAttachment', () => {
  beforeEach(() => vi.mocked(companyOfQontoAttachment).mockClear())

  it('takes the company of the query string, not the first company holding the attachment id', async () => {
    expect(await fromQontoAttachment(input('https://kledg.test/api/banking/attachments/qa-1/proxy?companyId=second-company'))).toBe('second-company')
    expect(companyOfQontoAttachment).not.toHaveBeenCalled()
  })

  it('falls back to the company of the stored attachment without a company in the query', async () => {
    expect(await fromQontoAttachment(input('https://kledg.test/api/banking/attachments/qa-1/proxy'))).toBe('first-company')
  })
})
