/**
 * Full control tools on the chart of accounts, journals and fixed assets.
 * Thin wrappers over lib/accounting/create-account.service.ts,
 * lib/accounting/create-journal.service.ts and
 * lib/fixed-assets/create-fixed-asset.service.ts.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ValidationError } from '@/lib/accounting/errors'
import { getActiveFiscalYear } from '@/lib/accounting/fiscal-year-utils'
import { createAccount } from '@/lib/accounting/create-account.service'
import { createJournal } from '@/lib/accounting/create-journal.service'
import { createFixedAsset } from '@/lib/fixed-assets/create-fixed-asset.service'
import { day } from '@/lib/mcp/tool-result'
import { fullControlTool, type RegisterTool } from './define'
import { ACTS_AS_USER } from './descriptions'
import { accountIdsByCode, euros, fiscalYearOfDay, isoDate, ownedFiscalYear } from './resolve'
import { accountCode } from '@/lib/api/zod-fields'

async function targetFiscalYear(companyId: string, fiscalYearId?: string) {
  if (fiscalYearId) return ownedFiscalYear(companyId, fiscalYearId)
  const active = await getActiveFiscalYear(companyId)
  if (!active) throw new ValidationError("Aucun exercice ouvert : créez d'abord l'exercice.")
  return active
}

const createAccountTool = fullControlTool({
  name: 'create_account',
  title: 'Créer un compte',
  description: `Creates an account in the chart of accounts of a fiscal year (plan comptable, accounts are per fiscal year), as a subdivision of an existing account: the code starts with the parent's code (e.g. 401DUPONT is not valid, 4010001 under 401 is). ${ACTS_AS_USER}`,
  input: {
    code: accountCode().describe('Account number: the class digit then 1 to 19 digits or upper case letters, e.g. 6064100.'),
    label: z.string().min(1).max(200),
    parentCode: z
      .string()
      .optional()
      .describe('Existing parent account number. Defaults to the longest existing account whose number starts the new one.'),
    fiscalYearId: z.string().optional().describe('Fiscal year id, from list_fiscal_years. Defaults to the current fiscal year.'),
  },
  permission: { ledger: ['manage'] },
  amounts: 'none',
  never: 'changes a PCG account or an account of a closed fiscal year.',
  confirmation: false,
  async execute({ companyId, code, label, parentCode, fiscalYearId }) {
    const fiscalYear = await targetFiscalYear(companyId, fiscalYearId)
    let parentId: string
    if (parentCode) {
      parentId = (await accountIdsByCode(companyId, fiscalYear.id, [parentCode])).get(parentCode)!
    } else {
      const prefixes = Array.from({ length: code.length - 1 }, (_, i) => code.slice(0, i + 1))
      const candidates = await prisma.account.findMany({
        where: { companyId, fiscalYearId: fiscalYear.id, code: { in: prefixes } },
        select: { id: true, code: true },
      })
      const parent = candidates.sort((a, b) => b.code.length - a.code.length)[0]
      if (!parent) throw new ValidationError(`Aucun compte parent pour ${code} : indiquez parentCode.`)
      parentId = parent.id
    }
    const account = await createAccount(companyId, { code, label, parentId, fiscalYearId: fiscalYear.id })
    return { id: account.id, code: account.code, label: account.label, fiscalYearId: account.fiscalYearId }
  },
  audit: (_args, account) => ({ accountId: account.id, code: account.code, fiscalYearId: account.fiscalYearId }),
})

const createJournalTool = fullControlTool({
  name: 'create_journal',
  title: 'Créer un journal',
  description: `Creates an accounting journal (journal): code of 2 or 3 letters or digits (e.g. BQ2, CA, HA) unique in the company, and its label. ${ACTS_AS_USER}`,
  input: {
    code: z.string().min(2).max(3),
    label: z.string().min(1).max(255),
  },
  permission: { ledger: ['manage'] },
  amounts: 'none',
  never: 'changes or deletes an existing journal.',
  confirmation: false,
  async execute({ companyId, code, label }) {
    const journal = await createJournal(companyId, { code, label })
    return { id: journal.id, code: journal.code, label: journal.label }
  },
  audit: (_args, journal) => ({ journalId: journal.id, code: journal.code }),
})

const createFixedAssetTool = fullControlTool({
  name: 'create_fixed_asset',
  title: 'Créer une immobilisation',
  description: `Creates a fixed asset (immobilisation) with its depreciation plan, checked against the PCG rules (art. 213-1, 214-1 to 214-19). Accounts are given by number (asset 2x, depreciation 28x, expense 6811x). Depreciation entries are then booked per fiscal year by generate_depreciation. ${ACTS_AS_USER}`,
  input: {
    label: z.string().min(1).max(200),
    comment: z.string().max(1000).optional(),
    acquisitionDate: isoDate,
    acquisitionValue: euros.describe('Acquisition cost excluding VAT (HT), in euros.'),
    amortizableAmount: euros.optional().describe('Depreciable amount when different from the acquisition value.'),
    depreciationMethod: z.enum(['linear', 'declining', 'none']).default('linear').describe('none for non-depreciable assets (land, goodwill).'),
    depreciationDuration: z.number().int().min(1).max(100).optional().describe('Years (or give depreciationRate).'),
    depreciationRate: z.number().min(0).max(100).optional().describe('Annual rate in percent.'),
    decliningCoefficient: z.number().min(0).max(10).optional(),
    depreciationStartDate: isoDate.optional().describe('In-service date (mise en service). Defaults to the acquisition date.'),
    assetAccountCode: z.string().min(1).describe('Asset account, e.g. 2183.'),
    depreciationAccountCode: z.string().optional().describe('Depreciation account, e.g. 28183 (required unless method none).'),
    expenseAccountCode: z.string().optional().describe('Expense account, e.g. 6811 (required unless method none).'),
    isFullyPaid: z.boolean().optional(),
  },
  permission: { ledger: ['manage'] },
  amounts: 'euros',
  units: 'Dates as yyyy-mm-dd, durations in years.',
  never: 'books the depreciation entries (generate_depreciation does).',
  confirmation: false,
  async execute({ companyId, assetAccountCode, depreciationAccountCode, expenseAccountCode, ...input }) {
    const fiscalYear = await fiscalYearOfDay(companyId, input.depreciationStartDate ?? input.acquisitionDate).catch(() =>
      targetFiscalYear(companyId),
    )
    const codes = [assetAccountCode, depreciationAccountCode, expenseAccountCode].filter((c): c is string => Boolean(c))
    const byCode = await accountIdsByCode(companyId, fiscalYear.id, codes)
    const { fixedAsset, warnings } = await createFixedAsset(companyId, {
      ...input,
      depreciationStartDate: input.depreciationStartDate ?? input.acquisitionDate,
      assetAccountId: byCode.get(assetAccountCode),
      depreciationAccountId: depreciationAccountCode ? byCode.get(depreciationAccountCode) : null,
      expenseAccountId: expenseAccountCode ? byCode.get(expenseAccountCode) : null,
    })
    return {
      id: fixedAsset.id,
      label: fixedAsset.label,
      acquisitionDate: day(fixedAsset.acquisitionDate),
      acquisitionValue: fixedAsset.acquisitionValue,
      depreciationMethod: fixedAsset.depreciationMethod,
      depreciationDuration: fixedAsset.depreciationDuration,
      depreciationRate: fixedAsset.depreciationRate,
      depreciationStartDate: day(fixedAsset.depreciationStartDate),
      accounts: {
        asset: fixedAsset.assetAccount.code,
        depreciation: fixedAsset.depreciationAccount.code,
        expense: fixedAsset.expenseAccount.code,
      },
      pcgWarnings: warnings,
    }
  },
  audit: (_args, asset) => ({ fixedAssetId: asset.id }),
})

export function registerLedgerTools(register: RegisterTool) {
  register(createAccountTool)
  register(createJournalTool)
  register(createFixedAssetTool)
}
