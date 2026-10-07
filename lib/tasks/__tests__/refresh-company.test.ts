/**
 * Manual refresh (POST /api/tasks/refresh): the rules step counts failed rule
 * applications as failed, never as processed, and reports why; no step
 * returns the raw message of an unexpected or third-party error.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findMatchingRules: vi.fn(),
  applyRule: vi.fn(),
  encryptionKey: 'key' as string | null,
}))

vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())
vi.mock('@/lib/crypto/encryption-key', () => ({ getEncryptionKey: () => mocks.encryptionKey }))
vi.mock('@/lib/accounting/fiscal-year-utils', () => ({ getActiveFiscalYear: vi.fn() }))
vi.mock('@/lib/transactions/rule-service', () => ({
  loadRuleMatcher: async () => (t: { id: string }) => mocks.findMatchingRules(t),
}))
vi.mock('@/lib/transactions/rule-executor', () => ({ applyRule: mocks.applyRule }))

import { prisma } from '@/lib/prisma'
import { asPrismaMock } from '@/lib/__tests__/helpers/prisma-mock'
import { getActiveFiscalYear } from '@/lib/accounting/fiscal-year-utils'
import { BankAuthorizationError, UNEXPECTED_BANK_ERROR_MESSAGE } from '@/lib/banking/errors'
import { refreshCompany, rulesExecutionMessage } from '../refresh-company'

const db = asPrismaMock(prisma)

/** What a database or a provider library may put in an error message: it must never reach the client. */
const RAW_DETAIL = 'connect ECONNREFUSED 10.0.0.5:5432 password=hunter2'

const tx = (id: string) => ({ id, bankAccount: { name: 'Compte', iban: null } })

function resetSteps() {
  vi.clearAllMocks()
  mocks.encryptionKey = 'key'
  db.integration.findMany.mockResolvedValue([])
  db.bankTransaction.findMany.mockResolvedValue([])
  vi.mocked(getActiveFiscalYear).mockResolvedValue(null)
}

describe('refreshCompany error messages', () => {
  beforeEach(resetSteps)

  it('reports an unexpected bank sync failure in French, without its detail', async () => {
    db.integration.findMany.mockRejectedValue(new Error(RAW_DETAIL))
    const { bankSync } = await refreshCompany('company-1')
    expect(bankSync).toEqual({
      success: false,
      message: `Erreur lors de la synchronisation : ${UNEXPECTED_BANK_ERROR_MESSAGE}`,
      accountsSynced: 0,
    })
  })

  it('keeps the French advice of a bank provider error', async () => {
    db.integration.findMany.mockRejectedValue(new BankAuthorizationError("Qonto refuse l'accès : vérifiez la clé."))
    const { bankSync } = await refreshCompany('company-1')
    expect(bankSync.message).toBe("Erreur lors de la synchronisation : Qonto refuse l'accès : vérifiez la clé.")
  })

  it('reports a missing encryption key without its English detail', async () => {
    mocks.encryptionKey = null
    const { bankSync } = await refreshCompany('company-1')
    expect(bankSync.success).toBe(false)
    expect(bankSync.message).not.toMatch(/Encryption key/)
  })

  it('reports a failed rules run in French', async () => {
    vi.mocked(getActiveFiscalYear).mockRejectedValue(new Error(RAW_DETAIL))
    const result = await refreshCompany('company-1')
    expect(result.rulesExecution).toMatchObject({ success: false, transactionsProcessed: 0 })
    expect(result.rulesExecution.message).toMatch(/^Erreur lors de l'exécution des règles : /)
    expect(JSON.stringify(result)).not.toContain('ECONNREFUSED')
  })
})

describe('refreshCompany rules step', () => {
  beforeEach(() => {
    resetSteps()
    db.bankTransaction.findMany.mockResolvedValue([tx('ok'), tx('fails'), tx('throws'), tx('taken'), tx('no-rule'), tx('suggestion-only')])
    mocks.findMatchingRules.mockImplementation((t: { id: string }) =>
      t.id === 'no-rule'
        ? []
        : t.id === 'suggestion-only'
          ? [{ ruleId: 'r2', ruleName: 'Suggestion', matched: true, confidence: 0.9, autoCreate: false }]
          : [{ ruleId: 'r1', ruleName: 'Règle', matched: true, confidence: 0.6, autoCreate: true }],
    )
    mocks.applyRule.mockImplementation(async (_ruleId: string, transactionId: string) => {
      switch (transactionId) {
        case 'ok':
          return { success: true, entryId: 'e1' }
        case 'fails':
          return { success: false, error: "Certains comptes de la règle n'existent pas dans l'exercice 2026 : 606100", status: 400 }
        case 'taken':
          return { success: false, error: 'Cette transaction est déjà rapprochée.', status: 409 }
        default:
          throw new Error(RAW_DETAIL)
      }
    })
  })

  it('counts applied, failed and skipped transactions separately', async () => {
    const { rulesExecution } = await refreshCompany('company-1')
    expect(rulesExecution).toMatchObject({
      success: true,
      transactionsProcessed: 1,
      transactionsFailed: 2,
      transactionsSkipped: 1,
      message: '1 transaction traitée, 2 en échec',
    })
    // An unexpected error is reported in French, never with its own message
    expect(rulesExecution.failures).toEqual([
      { transactionId: 'fails', error: "Certains comptes de la règle n'existent pas dans l'exercice 2026 : 606100" },
      { transactionId: 'throws', error: "Impossible d'appliquer la règle : une erreur inattendue est survenue." },
    ])
    // A rule without "Créer automatiquement l'écriture" stays a suggestion
    expect(mocks.applyRule).not.toHaveBeenCalledWith('r2', expect.anything(), expect.anything())
    // Only unreconciled transactions are considered
    expect(db.bankTransaction.findMany.mock.calls[0][0]?.where?.reconciled).toBe(false)
    expect(JSON.stringify(rulesExecution)).not.toContain('ECONNREFUSED')
  })

  it('keeps the plain message when nothing fails', async () => {
    db.bankTransaction.findMany.mockResolvedValue([tx('ok')])
    const { rulesExecution } = await refreshCompany('company-1')
    expect(rulesExecution).toMatchObject({ transactionsProcessed: 1, transactionsFailed: 0, failures: [] })
    expect(rulesExecution.message).toBe('1 transaction traitée')
  })

  it('caps the reported failures', async () => {
    db.bankTransaction.findMany.mockResolvedValue(Array.from({ length: 15 }, (_, i) => tx(`fails-${i}`)))
    mocks.applyRule.mockResolvedValue({ success: false, error: 'Règle invalide', status: 400 })
    const { rulesExecution } = await refreshCompany('company-1')
    expect(rulesExecution.transactionsFailed).toBe(15)
    expect(rulesExecution.failures).toHaveLength(10)
  })

  it('writes the summary in French', () => {
    expect(rulesExecutionMessage(0, 0)).toBe('0 transaction traitée')
    expect(rulesExecutionMessage(3, 1)).toBe('3 transactions traitées, 1 en échec')
  })
})
