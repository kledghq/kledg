/**
 * KLEDG-R3-QUAL-23: saving the taxe sur les salaires inputs computes from
 * the body first, then writes the inputs and their computation in one
 * statement: a concurrent save or a failure never leaves inputs with the
 * computation of other inputs, or without one.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn() }))
vi.mock('../load-payroll-tax.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../load-payroll-tax.service')>()),
  buildPayrollTax: vi.fn(),
}))

import { prisma } from '@/lib/prisma'
import { asPrismaMock } from '@/lib/__tests__/helpers/prisma-mock'
import { buildPayrollTax } from '../load-payroll-tax.service'
import { savePayrollTax } from '../save-payroll-tax.service'

const db = asPrismaMock(prisma)
const body = { year: 2026, data: { employees: [{ id: 'e1', label: 'Formatrice', baseCents: 3_000_000 }], association: false } }

describe('savePayrollTax', () => {
  beforeEach(() => vi.clearAllMocks())

  it('computes from the body, then writes inputs and computation together, once', async () => {
    vi.mocked(buildPayrollTax).mockResolvedValue({
      view: { frequency: 'annual' },
      core: { liability: 'liable', computation: { dueCents: 12_345 } },
    } as never)
    db.payrollTaxYear.upsert.mockResolvedValue({} as never)

    const saved = await savePayrollTax('c1', body, { userId: 'u1' })

    expect(saved.computed).toEqual({ liable: true, frequency: 'annual', dueCents: 12_345 })
    expect(vi.mocked(buildPayrollTax).mock.calls[0][2]).toMatchObject({ data: { employees: body.data.employees } })
    expect(db.payrollTaxYear.upsert).toHaveBeenCalledTimes(1)
    const write = db.payrollTaxYear.upsert.mock.calls[0][0] as unknown as { create: { data: { computed: unknown } }; update: { data: { computed: unknown } } }
    expect(write.create.data.computed).toEqual(saved.computed)
    expect(write.update.data.computed).toEqual(saved.computed)
    expect(db.payrollTaxYear.update).not.toHaveBeenCalled()
  })

  it('writes nothing when the computation fails', async () => {
    vi.mocked(buildPayrollTax).mockRejectedValue(new Error('connection reset'))
    await expect(savePayrollTax('c1', body)).rejects.toThrow('connection reset')
    expect(db.payrollTaxYear.upsert).not.toHaveBeenCalled()
    expect(db.payrollTaxYear.update).not.toHaveBeenCalled()
  })
})
