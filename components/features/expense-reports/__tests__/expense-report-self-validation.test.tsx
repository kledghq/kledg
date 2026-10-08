/**
 * Expense report detail: a report validated by its own author (the
 * company's only validator) says so, and the author of a submitted report
 * gets no "Valider" button while another member may validate it
 * (lib/expense-reports/self-validation.ts).
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('@/components/features/companies/company-access', () => ({
  useCompanyAccess: () => ({ can: () => true, denied: () => '' }),
  AccessNotice: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}))

import { ExpenseReportDetailView, type ExpenseReportDetailData } from '../expense-report-detail'

function report(over: Partial<ExpenseReportDetailData>): ExpenseReportDetailData {
  return {
    id: 'ndf-1',
    number: 'NDF-0001',
    label: null,
    periodStart: '2026-03-01',
    periodEnd: '2026-03-31',
    status: 'submitted',
    storedStatus: 'SUBMITTED',
    own: true,
    selfValidated: false,
    ownValidation: null,
    returnNote: null,
    vatExempt: false,
    claimant: { id: 'cl-1', name: 'Camille Martin', kind: 'DIRIGEANT', auxiliaryAccountNumber: '467CAMI', accountCode: null },
    totalInclTaxCents: 11_000,
    recoverableVatCents: 1_000,
    totalExpenseCents: 10_000,
    vatByRate: [],
    letteringCode: null,
    entry: null,
    mileageBaselines: {},
    lines: [],
    ...over,
  }
}

function serve(data: ExpenseReportDetailData) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(data))))
}

describe('expense report detail: own validation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('says that a validated report was validated by its own author', async () => {
    serve(report({ status: 'validated', storedStatus: 'VALIDATED', selfValidated: true }))
    render(<ExpenseReportDetailView companyId="c1" reportId="ndf-1" />)
    expect(await screen.findByText(/Validée par son auteur, seul membre de la société autorisé à valider/)).toBeInTheDocument()
  })

  it('offers no "Valider" to the author while another member may validate', async () => {
    serve(report({ ownValidation: 'refused' }))
    render(<ExpenseReportDetailView companyId="c1" reportId="ndf-1" />)
    expect(await screen.findByText(/un autre membre de la société autorisé à valider/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Valider' })).toBeNull()
  })

  it('lets the sole validator validate their own report, telling it will be marked', async () => {
    serve(report({ ownValidation: 'sole-validator' }))
    render(<ExpenseReportDetailView companyId="c1" reportId="ndf-1" />)
    expect(await screen.findByRole('button', { name: 'Valider' })).toBeInTheDocument()
    expect(screen.getByText(/vous êtes le seul membre de la société autorisé à valider/)).toBeInTheDocument()
  })
})
