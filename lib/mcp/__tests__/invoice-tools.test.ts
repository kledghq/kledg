/**
 * MCP tools of the purchase and sales ledger: list_tiers, list_invoices and
 * get_invoice (read tools through the company guard with entries:read, so
 * the AI grant of the connection applies; the lists page by page and read
 * the changes since an instant for a sync), and create_draft_invoice (full
 * control, entries:create, following the execution mode: approval in Kledg
 * or automatic, with a dry run of the totals). Services are mocked: they
 * have their own database tests.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const guard = vi.hoisted(() => ({
  require: vi.fn(async () => {}),
  requireFullControl: vi.fn(async () => {}),
  companyWhere: vi.fn(async () => ({})),
}))

vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: vi.fn() }))
vi.mock('@/lib/mcp/company-access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mcp/company-access')>()),
  companyGuard: () => guard,
}))
vi.mock('@/lib/tiers/manage-tiers.service', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/tiers/manage-tiers.service')>()), listTiers: vi.fn() }))
vi.mock('@/lib/invoices/manage-invoices.service', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/invoices/manage-invoices.service')>()), listInvoices: vi.fn(), getInvoice: vi.fn(), createInvoice: vi.fn() }))
vi.mock('@/lib/invoices/post-invoice.service', () => ({ postInvoice: vi.fn() }))
vi.mock('@/lib/invoices/create-in-qonto.service', () => ({ issueInvoice: vi.fn(), qontoFirstActive: vi.fn(async () => false), resumeQontoInvoice: vi.fn() }))
vi.mock('@/lib/invoices/numbering/series', () => ({ loadNumberingSettings: vi.fn(async () => ({ mode: 'AUTO' })), peekNextNumber: vi.fn(async () => 'F2026-0007') }))
vi.mock('@/lib/mcp/full-control/pending-actions', () => ({
  createPendingAction: vi.fn(async () => ({ id: 'action-1', approvalUrl: 'http://kledg.test/ai-actions/action-1', expiresAt: new Date('2026-10-05T00:00:00Z') })),
  claimApprovedAction: vi.fn(),
  finishAction: vi.fn(),
}))

import { registerKledgTools } from '@/lib/mcp/tools'
import { listTiers } from '@/lib/tiers/manage-tiers.service'
import { createInvoice, getInvoice, listInvoices } from '@/lib/invoices/manage-invoices.service'
import { postInvoice } from '@/lib/invoices/post-invoice.service'
import { issueInvoice } from '@/lib/invoices/create-in-qonto.service'
import { createPendingAction } from '@/lib/mcp/full-control/pending-actions'
import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/accounting/errors'
import type { ToolResult } from '@/lib/mcp/tool-result'
import type { ExecutionMode } from '@/lib/ai-access/access'
import { asPrismaMock } from '@/lib/__tests__/helpers/prisma-mock'

type Handler = (args: Record<string, unknown>) => Promise<ToolResult>

function server(options: { canAdmin?: boolean; executionMode?: ExecutionMode } = {}) {
  const handlers = new Map<string, Handler>()
  registerKledgTools(
    { registerTool: (name: string, _config: unknown, handler: Handler) => handlers.set(name, handler) } as never,
    {
      user: { id: 'u1', email: 'a@b.c', name: null, role: 'user' },
      canWrite: true,
      canAdmin: options.canAdmin ?? false,
      caller: { kind: 'apiKey', apiKeyId: 'k1' },
      executionMode: options.executionMode ?? 'validation',
    },
  )
  return handlers
}

const parse = (result: ToolResult) => JSON.parse(result.content[0].text)
const db = asPrismaMock(prisma)

const summary = {
  id: 'inv-1',
  direction: 'SALE',
  number: 'V-1',
  issueDate: '2026-03-02',
  dueDate: '2026-04-01',
  typeCode: '380',
  currency: 'EUR',
  label: null,
  tiers: { id: 't1', name: 'Martin SA', auxiliaryAccountNumber: 'C00001' },
  totalExclTaxCents: 10_000,
  totalVatCents: 2_000,
  totalInclTaxCents: 12_000,
  paidCents: 5_000,
  remainingCents: 7_000,
  status: 'partially_paid',
  lastPaymentDate: '2026-04-02',
  updatedAt: '2026-04-02T09:15:00.000Z',
  lettered: false,
  letteringCode: null,
  source: 'MANUAL',
  externalStatus: null,
  hasAttachment: false,
  entry: { id: 'e1', entryNumber: '12', status: 'validated' },
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('list_tiers', () => {
  it('checks entries:read on the company and returns the auxiliary numbers', async () => {
    vi.mocked(listTiers).mockResolvedValue({
      total: 1,
      truncated: false,
      tiers: [
        {
          id: 't1',
          kind: 'CUSTOMER',
          name: 'Martin SA',
          siren: '732829320',
          siret: null,
          vatNumber: null,
          email: 'compta@martin.example',
          auxiliaryAccountNumber: 'C00001',
          collectiveAccountCode: null,
          defaultAccountCode: '706',
          defaultVatRateBp: 2000,
          paymentTermsDays: 45,
          paymentTermsEndOfMonth: true,
          qontoId: null,
          notes: null,
          updatedAt: new Date('2026-05-04T08:30:00Z'),
          address: { id: 'a1', street: '1 rue des Lilas', street2: null, postalCode: '75011', city: 'Paris', country: 'FR' },
          _count: { invoices: 3 },
        },
      ],
      nextCursor: null,
    })
    const data = parse(await server().get('list_tiers')!({ companyId: 'c1', kind: 'CUSTOMER', limit: 100 }))
    expect(guard.require).toHaveBeenCalledWith('c1', { entries: ['read'] })
    expect(listTiers).toHaveBeenCalledWith('c1', { kind: 'CUSTOMER', search: undefined, limit: 100, cursor: undefined, updatedSince: undefined })
    expect(data).toMatchObject({ total: 1, truncated: false, nextCursor: null })
    expect(data.tiers[0]).toEqual({
      id: 't1',
      kind: 'CUSTOMER',
      name: 'Martin SA',
      auxiliaryAccountNumber: 'C00001',
      siren: '732829320',
      vatNumber: null,
      email: 'compta@martin.example',
      address: { street: '1 rue des Lilas', street2: null, postalCode: '75011', city: 'Paris', country: 'FR' },
      collectiveAccount: null,
      defaultAccount: '706',
      defaultVatRatePercent: 20,
      paymentTerms: { days: 45, endOfMonth: true },
      invoiceCount: 3,
      updatedAt: '2026-05-04T08:30:00.000Z',
    })
  })

  it('reads the tiers changed since an instant, page by page', async () => {
    vi.mocked(listTiers).mockResolvedValue({ total: 3, truncated: true, nextCursor: 'next-page', tiers: [] })
    const data = parse(await server().get('list_tiers')!({ companyId: 'c1', updatedSince: '2026-05-01T10:00:00+02:00', cursor: 'this-page', limit: 2 }))
    expect(listTiers).toHaveBeenCalledWith('c1', { kind: undefined, search: undefined, limit: 2, cursor: 'this-page', updatedSince: new Date('2026-05-01T08:00:00Z') })
    expect(data).toEqual({ total: 3, truncated: true, nextCursor: 'next-page', tiers: [] })
  })

  it('refuses a company outside the grant', async () => {
    guard.require.mockRejectedValueOnce(new NotFoundError('Société introuvable'))
    const result = await server().get('list_tiers')!({ companyId: 'other', limit: 10 })
    expect(result).toEqual({ content: [{ type: 'text', text: 'Société introuvable' }], isError: true })
    expect(listTiers).not.toHaveBeenCalled()
  })
})

describe('list_invoices and get_invoice', () => {
  it('lists invoices in euros with their derived status, tiers id, last payment and last change', async () => {
    vi.mocked(listInvoices).mockResolvedValue({ items: [summary as never], nextCursor: null })
    const data = parse(await server().get('list_invoices')!({ companyId: 'c1', direction: 'SALE', status: 'all', limit: 50 }))
    expect(guard.require).toHaveBeenCalledWith('c1', { entries: ['read'] })
    expect(listInvoices).toHaveBeenCalledWith('c1', expect.objectContaining({ direction: 'SALE', status: 'all', limit: 50, cursor: undefined, updatedSince: undefined }))
    expect(data).toEqual({
      truncated: false,
      nextCursor: null,
      invoices: [
        {
          id: 'inv-1',
          number: 'V-1',
          creditNote: false,
          issueDate: '2026-03-02',
          dueDate: '2026-04-01',
          tiers: 'Martin SA',
          tiersId: 't1',
          tiersAuxiliaryAccount: 'C00001',
          currency: 'EUR',
          totalExclTax: 100,
          totalVat: 20,
          totalInclTax: 120,
          paid: 50,
          remaining: 70,
          status: 'partially_paid',
          lastPaymentDate: '2026-04-02',
          entryNumber: '12',
          source: 'MANUAL',
          updatedAt: '2026-04-02T09:15:00.000Z',
        },
      ],
    })
  })

  it('reads the invoices changed since an instant and hands the next cursor back', async () => {
    vi.mocked(listInvoices).mockResolvedValue({ items: [summary as never], nextCursor: 'next-page' })
    const data = parse(
      await server().get('list_invoices')!({ companyId: 'c1', direction: 'PURCHASE', status: 'all', updatedSince: '2026-04-01T00:00:00Z', cursor: 'this-page', limit: 1 }),
    )
    expect(listInvoices).toHaveBeenCalledWith('c1', expect.objectContaining({ direction: 'PURCHASE', updatedSince: new Date('2026-04-01T00:00:00Z'), cursor: 'this-page', limit: 1 }))
    expect(data).toMatchObject({ truncated: true, nextCursor: 'next-page' })
  })

  it('reads one invoice with its lines and VAT breakdown', async () => {
    vi.mocked(getInvoice).mockResolvedValue({
      ...summary,
      tiers: { id: 't1', name: 'Martin SA', kind: 'CUSTOMER', auxiliaryAccountNumber: 'C00001', defaultAccountCode: null, defaultVatRateBp: null },
      currency: 'EUR',
      parties: { sellerSiren: '900000101', sellerVatNumber: null, buyerSiren: null, buyerVatNumber: null },
      attachmentFileName: null,
      lines: [{ id: 'l1', position: 1, label: 'Conseil', quantity: '2', unitPriceCents: 5_000, vatRateBp: 2000, totalExclTaxCents: 10_000, accountCode: '706', nature: 'SERVICES', fixedAsset: false }],
      vatBreakdown: [{ vatRateBp: 2000, baseCents: 10_000, vatCents: 2_000 }],
      payments: [{ id: 'p1', amountCents: 5_000, entryLineId: 'el1', entry: { id: 'e2', entryNumber: '13', date: '2026-04-02', description: null, status: 'validated' }, vatTransferEntry: null }],
    } as never)
    const data = parse(await server().get('get_invoice')!({ companyId: 'c1', invoiceId: 'inv-1' }))
    expect(getInvoice).toHaveBeenCalledWith('c1', 'inv-1')
    expect(data.lines).toEqual([expect.objectContaining({ unitPrice: 50, vatRatePercent: 20, totalExclTax: 100 })])
    expect(data.vatBreakdown).toEqual([{ ratePercent: 20, base: 100, vat: 20 }])
    expect(data.payments).toEqual([{ amount: 50, entryNumber: '13', date: '2026-04-02' }])
  })

  it('says an invoice was created in Qonto, still a draft there, with its Qonto id', async () => {
    vi.mocked(getInvoice).mockResolvedValue({
      ...summary,
      number: null,
      source: 'QONTO',
      origin: 'QONTO',
      createdInQonto: true,
      qontoDraft: true,
      qontoId: 'q-77',
      tiers: { id: 't1', name: 'Martin SA', kind: 'CUSTOMER', auxiliaryAccountNumber: 'C00001', defaultAccountCode: null, defaultVatRateBp: null },
      currency: 'EUR',
      parties: { sellerSiren: null, sellerVatNumber: null, buyerSiren: null, buyerVatNumber: null },
      attachmentFileName: null,
      lines: [],
      vatBreakdown: [],
      payments: [],
    } as never)
    const data = parse(await server().get('get_invoice')!({ companyId: 'c1', invoiceId: 'inv-1' }))
    expect(data).toMatchObject({ source: 'QONTO', origin: 'QONTO', createdInQonto: true, qontoDraft: true, qontoId: 'q-77' })
  })
})

describe('create_draft_invoice (full control)', () => {
  const args = {
    companyId: 'c1',
    direction: 'SALE',
    tiers: 'C00001',
    number: 'V-9',
    numbering: 'recorded',
    issueDate: '2026-03-02',
    lines: [
      { label: 'Conseil', quantity: 2, unitPrice: 125, vatRate: 20 },
      { label: 'Livre', quantity: 1.5, unitPrice: 19.99, vatRate: 5.5, nature: 'GOODS' },
    ],
  }

  beforeEach(() => {
    db.tiers.findFirst.mockResolvedValue({ id: 't1', name: 'Martin SA', kind: 'CUSTOMER', auxiliaryAccountNumber: 'C00001' } as never)
  })

  it('is absent without full control', () => {
    expect(server().has('create_draft_invoice')).toBe(false)
  })

  it('in validation mode, returns the totals as a dry run and records a pending action, writing nothing', async () => {
    const data = parse(await server({ canAdmin: true }).get('create_draft_invoice')!(args))
    expect(guard.requireFullControl).toHaveBeenCalledWith('c1', { entries: ['create'] })
    expect(data).toMatchObject({
      dryRun: true,
      actionId: 'action-1',
      preview: { totalExclTax: 279.99, totalVat: 51.65, totalInclTax: 331.64, problems: [], vatBreakdown: [{ ratePercent: 20, base: 250, vat: 50 }, { ratePercent: 5.5, base: 29.99, vat: 1.65 }] },
    })
    expect(data.preview.numbering).toBe('Facture déjà émise, enregistrée sous le n° V-9.')
    expect(createPendingAction).toHaveBeenCalled()
    expect(issueInvoice).not.toHaveBeenCalled()
  })

  it('in automatic mode, records the invoice in cents and basis points, and posts it when asked', async () => {
    vi.mocked(issueInvoice).mockResolvedValue({ id: 'inv-9', number: 'V-9', origin: 'RECORDED', totalInclTaxCents: 33_164 } as never)
    vi.mocked(postInvoice).mockResolvedValue({ invoiceId: 'inv-9', entryId: 'e9', entryNumber: 'BR-1', fiscalYear: 2026, number: 'F2026-0001' })
    const data = parse(await server({ canAdmin: true, executionMode: 'automatic' }).get('create_draft_invoice')!({ ...args, post: true }))
    expect(issueInvoice).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({
        direction: 'SALE',
        tiersId: 't1',
        number: 'V-9',
        numbering: 'recorded',
        typeCode: '380',
        lines: [
          expect.objectContaining({ quantity: '2', unitPriceCents: 12_500, vatRateBp: 2000 }),
          expect.objectContaining({ quantity: '1.5', unitPriceCents: 1_999, vatRateBp: 550, nature: 'GOODS' }),
        ],
      }),
      { source: 'mcp' },
    )
    expect(postInvoice).toHaveBeenCalledWith('c1', 'inv-9', { source: 'mcp' })
    expect(data).toMatchObject({ executed: true, result: { invoiceId: 'inv-9', number: 'F2026-0001', origin: 'RECORDED', status: 'posted', entryId: 'e9', totalInclTax: 331.64 } })
  })

  it('follows the company numbering: without a number, the dry run announces the next number of the series', async () => {
    const { number: _number, numbering: _numbering, ...auto } = args
    const data = parse(await server({ canAdmin: true }).get('create_draft_invoice')!(auto))
    expect(data.preview.numbering).toBe('Numéro attribué à la comptabilisation (prochain : F2026-0007).')
    expect(data.preview.problems).toEqual([])
  })

  it('announces a draft in Qonto in the dry run and passes qontoStatus on', async () => {
    const { number: _number, numbering: _numbering, ...rest } = args
    const data = parse(await server({ canAdmin: true }).get('create_draft_invoice')!({ ...rest, qontoStatus: 'draft' }))
    expect(data.preview.numbering).toBe('Créée en brouillon dans Qonto\u00a0: sans numéro jusqu’à sa finalisation dans Qonto.')
    vi.mocked(issueInvoice).mockResolvedValue({ id: 'inv-10', number: null, origin: 'QONTO', totalInclTaxCents: 33_164 } as never)
    await server({ canAdmin: true, executionMode: 'automatic' }).get('create_draft_invoice')!({ ...rest, qontoStatus: 'draft' })
    expect(issueInvoice).toHaveBeenCalledWith('c1', expect.objectContaining({ qontoStatus: 'draft', number: null }), { source: 'mcp' })
  })

  it('reports a typed sales number under automatic numbering as a problem of the dry run', async () => {
    const { numbering: _numbering, ...typed } = args
    const data = parse(await server({ canAdmin: true }).get('create_draft_invoice')!(typed))
    expect(data.preview.problems).toEqual([expect.stringMatching(/numérotation automatique est active/)])
  })

  it('reports a tiers of the wrong kind in the dry run, and an unknown tiers as an error', async () => {
    const preview = parse(await server({ canAdmin: true, executionMode: 'automatic' }).get('create_draft_invoice')!({ ...args, direction: 'PURCHASE', dryRun: true }))
    expect(preview.preview.problems).toEqual(['Une facture d’achat vient d’un fournisseur.'])
    db.tiers.findFirst.mockResolvedValue(null as never)
    const result = await server({ canAdmin: true, executionMode: 'automatic' }).get('create_draft_invoice')!(args)
    expect(result.isError).toBe(true)
    expect(issueInvoice).not.toHaveBeenCalled()
  })
})
