/**
 * PCG checks before a fixed asset is created (lib/pcg/services/fixed-assets.ts):
 * acquisition cost (PCG art. 213-1), depreciable amount and depreciation plan
 * (PCG art. 214-1 and 214-7), and the accounts used (class 2 asset account,
 * PCG art. 211-6; 28 depreciation and 681 allowance accounts, art. 214-1).
 * Errors refuse the creation; warnings are returned to the user.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }))

import { prisma } from '@/lib/prisma'
import { asPrismaMock } from '@/lib/__tests__/helpers/prisma-mock'
import {
  createFixedAssetWithPCGValidation,
  validateFixedAssetBeforeCreation,
  type CreateFixedAssetData,
} from '@/lib/pcg/services/fixed-assets'

const db = asPrismaMock(prisma)

const STANDARD_CODES = { 'acc-asset': '218300', 'acc-dep': '281830', 'acc-exp': '681120' }
let codes: Record<string, string> = { ...STANDARD_CODES }

const asset = (over: Partial<CreateFixedAssetData> = {}): CreateFixedAssetData => ({
  companyId: 'company-1',
  label: 'Ordinateur',
  acquisitionDate: new Date('2025-03-01T00:00:00Z'),
  acquisitionValue: 3000,
  depreciationDuration: 3,
  depreciationMethod: 'linear',
  depreciationStartDate: new Date('2025-03-01T00:00:00Z'),
  assetAccountId: 'acc-asset',
  depreciationAccountId: 'acc-dep',
  expenseAccountId: 'acc-exp',
  ...over,
})

describe('PCG checks of a new fixed asset', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    codes = { ...STANDARD_CODES }
    db.account.findUnique.mockImplementation(async (args) => {
      const id = args.where.id
      return id && codes[id] ? { code: codes[id], label: codes[id] } : null
    })
  })

  it('returns no warning for a consistent asset on 2, 28 and 681 accounts', async () => {
    expect(await validateFixedAssetBeforeCreation(asset())).toEqual({ valid: true, warnings: [], errors: [] })
    expect(db.account.findUnique.mock.calls.map((c) => c[0].where.id)).toEqual(['acc-asset', 'acc-dep', 'acc-exp'])
  })

  it('warns about accounts outside 2, 28 and 681 (PCG art. 211-6, 214-1)', async () => {
    codes = { 'acc-asset': '606100', 'acc-dep': '291000', 'acc-exp': '687100' }

    const result = await createFixedAssetWithPCGValidation(asset())

    expect(result.warnings.map((w) => [w.code, w.article, w.severity])).toEqual([
      ['PCG-211-6', '211-6', 'warning'],
      ['PCG-214-1', '214-1', 'warning'],
      ['PCG-214-1', '214-1', 'warning'],
    ])
    expect(result.warnings.map((w) => w.message)).toEqual([
      "Le compte d'actif sélectionné (606100) ne commence pas par 2. Vérifier qu'il s'agit bien d'un compte d'immobilisation (Art. 211-6).",
      "Le compte d'amortissement sélectionné (291000) ne commence pas par 28. Vérifier qu'il s'agit bien d'un compte d'amortissement (Art. 214-1).",
      "Le compte de charge d'amortissement sélectionné (687100) ne commence pas par 681. Vérifier qu'il s'agit bien d'un compte de dotation aux amortissements (Art. 214-1).",
    ])
    expect(result.data.warnings).toBe(result.warnings)
  })

  it('warns about a depreciable amount above the cost, a missing declining coefficient and a start before acquisition', async () => {
    const result = await validateFixedAssetBeforeCreation(
      asset({
        amortizableAmount: 3500,
        depreciationMethod: 'declining',
        depreciationStartDate: new Date('2025-02-01T00:00:00Z'),
      }),
    )
    expect(result.valid).toBe(true)
    expect(result.warnings.map((w) => w.message)).toEqual([
      "Le montant amortissable (3500) est supérieur à la valeur d'acquisition (3000). Vérifier la cohérence (Art. 213-1).",
      "Méthode d'amortissement dégressive sélectionnée mais coefficient dégressif non renseigné. Vérifier la conformité (Art. 214-1).",
      "La date de début d'amortissement est antérieure à la date d'acquisition. Vérifier la cohérence (Art. 214-1).",
    ])
  })

  it('warns about a useful life above 100 years', async () => {
    const result = await validateFixedAssetBeforeCreation(asset({ depreciationDuration: 120 }))
    expect(result.warnings.map((w) => w.message)).toEqual(["La durée d'utilisation semble très longue, vérifier sa pertinence"])
  })

  it('refuses an acquisition value that is not positive (PCG art. 213-1)', async () => {
    expect(await validateFixedAssetBeforeCreation(asset({ acquisitionValue: 0 }))).toEqual({
      valid: false,
      warnings: [],
      errors: ["Validation coût d'acquisition échouée : Le prix d'achat doit être positif pour un actif acquis à titre onéreux"],
    })
    await expect(createFixedAssetWithPCGValidation(asset({ acquisitionValue: -10 }))).rejects.toMatchObject({ statusCode: 400 })
  })

  it('refuses a negative useful life (PCG art. 214-7)', async () => {
    expect(await validateFixedAssetBeforeCreation(asset({ depreciationDuration: -1 }))).toEqual({
      valid: false,
      warnings: [],
      errors: ["Validation plan d'amortissement échouée : La durée d'utilisation doit être positive (Art. 214-7)"],
    })
  })
})
