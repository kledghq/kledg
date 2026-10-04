/**
 * Import routes (POST /api/import, POST /api/import/preview-fiscal-years)
 * with a mocked session and Prisma: form and body validation with French
 * 400s, permissions, rate limit, dispatch to the importers, and per entry
 * failures that never carry a database message.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/session', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'user-1', email: 'test@example.com', name: null, role: null }),
}))

vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())

vi.mock('@/lib/rbac/authorize', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rbac/authorize')>('@/lib/rbac/authorize')
  return { ...actual, getUserRolesForCompany: vi.fn().mockResolvedValue(['accountant']) }
})

vi.mock('@/lib/companies/slug', () => ({
  resolveCompanyRef: vi.fn(async (ref: string) => ref),
}))

vi.mock('@/lib/rate-limit', () => ({
  enforceRateLimit: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/import/fec', () => ({
  importFEC: vi.fn(),
  previewFECFiscalYears: vi.fn(),
}))

vi.mock('@/lib/accounting/fiscal-year-utils', () => ({
  getOrCreateActiveFiscalYear: vi.fn().mockResolvedValue({ id: 'fy-1' }),
}))

vi.mock('@/lib/accounting/services', () => ({
  createAccountingEntryWithWarnings: vi.fn(),
}))

import { POST as importRoute } from '../import/route'
import { POST as previewRoute } from '../import/preview-fiscal-years/route'
import { prisma } from '@/lib/prisma'
import { asPrismaMock } from '@/lib/__tests__/helpers/prisma-mock'
import { getUserRolesForCompany } from '@/lib/rbac/authorize'
import { enforceRateLimit } from '@/lib/rate-limit'
import { importFEC, previewFECFiscalYears, type ImportResult } from '@/lib/import/fec'
import { createAccountingEntryWithWarnings } from '@/lib/accounting/services'
import { INTERNAL_ERROR_MESSAGE, RateLimitError } from '@/lib/accounting/errors'

const db = asPrismaMock(prisma)

function upload(fields: Record<string, string | File>): NextRequest {
  const form = new FormData()
  for (const [name, value] of Object.entries(fields)) form.set(name, value)
  return new NextRequest('http://localhost/api/import', { method: 'POST', body: form })
}

function preview(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/import/preview-fiscal-years', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

const errorOf = async (response: Response) => ((await response.json()) as { error: string }).error
const textFile = (content: string, name = 'import.txt') => new File([content], name, { type: 'text/plain' })

const MAPPING = {
  JournalCode: 'Journal',
  JournalLib: 'Libellé journal',
  EcritureNum: 'Numéro',
  EcritureDate: 'Date',
  CompteNum: 'Compte',
  CompteLib: 'Libellé compte',
  Debit: 'Débit',
  Credit: 'Crédit',
}

const IMPORT_RESULT: ImportResult = { success: true, entriesCreated: 2, linesCreated: 4, accountsCreated: 0, journalsCreated: 0, errors: [] }

describe('POST /api/import', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(importFEC).mockResolvedValue(IMPORT_RESULT)
  })

  it('imports a FEC with its parsed mappings', async () => {
    const response = await importRoute(
      upload({
        companyId: 'company-1',
        type: 'fec',
        file: textFile('JournalCode\tJournalLib\n'),
        mapping: JSON.stringify(MAPPING),
        accountMapping: JSON.stringify({ '512': 'acc-1', '401': null }),
        journalMapping: JSON.stringify({ BQ: 'journal-1' }),
        cleanEntryNumbers: 'true',
      }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(IMPORT_RESULT)
    expect(enforceRateLimit).toHaveBeenCalledWith('import', 'user-1')
    const options = vi.mocked(importFEC).mock.calls[0][0]
    expect(options).toMatchObject({
      companyId: 'company-1',
      columnMapping: MAPPING,
      accountMapping: { '512': 'acc-1', '401': null },
      journalMapping: { BQ: 'journal-1' },
      cleanEntryNumbers: true,
    })
    expect(new TextDecoder().decode(options.bytes)).toBe('JournalCode\tJournalLib\n')
  })

  it('answers French 400s for a missing file, an unknown type and invalid mappings', async () => {
    const noFile = await importRoute(upload({ companyId: 'company-1', type: 'fec' }))
    expect(noFile.status).toBe(400)
    expect(await errorOf(noFile)).toBe('file: Choisissez le fichier à importer.')

    const badType = await importRoute(upload({ companyId: 'company-1', type: 'pdf', file: textFile('x') }))
    expect(badType.status).toBe(400)
    expect(await errorOf(badType)).toBe('type: Type de fichier inconnu : fec, csv ou excel')

    const badJson = await importRoute(upload({ companyId: 'company-1', type: 'fec', file: textFile('x'), mapping: '{not json' }))
    expect(await errorOf(badJson)).toBe('mapping: Correspondance des colonnes invalide')

    const badShape = await importRoute(
      upload({ companyId: 'company-1', type: 'fec', file: textFile('x'), accountMapping: JSON.stringify({ '512': 42 }) }),
    )
    expect(await errorOf(badShape)).toBe('accountMapping: Correspondance des comptes invalide')

    expect(importFEC).not.toHaveBeenCalled()
  })

  it('requires the company in the form', async () => {
    const response = await importRoute(upload({ type: 'fec', file: textFile('x') }))
    expect(response.status).toBe(400)
    expect(await errorOf(response)).toBe('companyId est requis')
  })

  it('refuses an Excel file that is not an .xlsx archive', async () => {
    const response = await importRoute(upload({ companyId: 'company-1', type: 'excel', file: textFile('a;b', 'old.xls') }))
    expect(response.status).toBe(400)
    expect(await errorOf(response)).toBe('Fichier Excel invalide : seuls les fichiers .xlsx sont acceptés.')
  })

  it('answers 403 to a viewer and 404 to a non member, before reading the file', async () => {
    vi.mocked(getUserRolesForCompany).mockResolvedValueOnce(['viewer'])
    const viewer = await importRoute(upload({ companyId: 'company-1', type: 'fec', file: textFile('x') }))
    expect(viewer.status).toBe(403)

    vi.mocked(getUserRolesForCompany).mockResolvedValueOnce([])
    const outsider = await importRoute(upload({ companyId: 'company-2', type: 'fec', file: textFile('x') }))
    expect(outsider.status).toBe(404)

    expect(importFEC).not.toHaveBeenCalled()
  })

  it('answers 429 when the import rate limit is reached', async () => {
    vi.mocked(enforceRateLimit).mockRejectedValueOnce(new RateLimitError("Trop d'imports en peu de temps."))
    const response = await importRoute(upload({ companyId: 'company-1', type: 'fec', file: textFile('x') }))
    expect(response.status).toBe(429)
    expect(importFEC).not.toHaveBeenCalled()
  })

  describe('CSV', () => {
    const CSV = 'date,journal,entryNumber,account,debit,credit,description\n2026-03-01,VT,1,411000,100,0,Vente\n2026-03-01,VT,1,706000,0,100,Vente\n'

    beforeEach(() => {
      db.journal.upsert.mockResolvedValue({ id: 'journal-1' })
      db.account.findFirst.mockResolvedValue(null)
      db.account.create.mockImplementation(async (args) => ({ id: `acc-${args.data.code}` }))
      db.accountingEntry.findFirst.mockResolvedValue(null)
    })

    it('records a failed entry with the generic message, never the database error', async () => {
      vi.mocked(createAccountingEntryWithWarnings).mockRejectedValue(
        new Error('insert or update on table "entry_lines" violates foreign key constraint "entry_lines_accountId_fkey"'),
      )

      const response = await importRoute(upload({ companyId: 'company-1', type: 'csv', file: textFile(CSV, 'import.csv') }))

      expect(response.status).toBe(200)
      const result = (await response.json()) as { success: boolean; errors: string[] }
      expect(result.success).toBe(false)
      expect(result.errors).toEqual([`Écriture 1: ${INTERNAL_ERROR_MESSAGE}`])
      expect(JSON.stringify(result)).not.toContain('entry_lines')
    })

    it('reports unreadable lines in French', async () => {
      const response = await importRoute(
        upload({ companyId: 'company-1', type: 'csv', file: textFile('date,journal,account\n2026-03-01,VT\n', 'import.csv') }),
      )
      const result = (await response.json()) as { errors: string[] }
      expect(result.errors).toEqual(['Import interrompu : Fichier CSV illisible, lignes à corriger : 2'])
    })
  })
})

describe('POST /api/import/preview-fiscal-years', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(previewFECFiscalYears).mockResolvedValue([])
  })

  it('previews the fiscal years of the FEC content', async () => {
    const response = await previewRoute(preview({ companyId: 'company-1', content: 'JournalCode\n', mapping: null }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
    expect(enforceRateLimit).toHaveBeenCalledWith('import', 'user-1')
    expect(previewFECFiscalYears).toHaveBeenCalledWith({ companyId: 'company-1', content: 'JournalCode\n', columnMapping: undefined })
  })

  it('passes a column mapping through', async () => {
    await previewRoute(preview({ companyId: 'company-1', content: 'x', mapping: MAPPING }))
    expect(previewFECFiscalYears).toHaveBeenCalledWith({ companyId: 'company-1', content: 'x', columnMapping: MAPPING })
  })

  it('answers French 400s for missing content and an invalid mapping', async () => {
    const empty = await previewRoute(preview({ companyId: 'company-1', content: '' }))
    expect(empty.status).toBe(400)
    expect(await errorOf(empty)).toBe('content: Le contenu du fichier FEC est requis')

    const badMapping = await previewRoute(preview({ companyId: 'company-1', content: 'x', mapping: { JournalCode: 3 } }))
    expect(badMapping.status).toBe(400)
    expect(previewFECFiscalYears).not.toHaveBeenCalled()
  })

  it('answers 404 to a non member', async () => {
    vi.mocked(getUserRolesForCompany).mockResolvedValueOnce([])
    const response = await previewRoute(preview({ companyId: 'company-2', content: 'x' }))
    expect(response.status).toBe(404)
    expect(previewFECFiscalYears).not.toHaveBeenCalled()
  })
})
