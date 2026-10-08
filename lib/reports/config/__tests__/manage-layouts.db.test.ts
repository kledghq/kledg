/**
 * Operations of the statement layout routes (manage-layouts.service.ts) and
 * the account code check of the layout lines (validate-account-codes),
 * against PostgreSQL: defaults filled in, lines, parents and templates of
 * another company answered as missing (404), French messages. Skipped
 * without the test database server.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('rep_manage_layouts')
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import {
  createBalanceSheetLine,
  createIncomeStatementConfigLine,
  createIncomeStatementLine,
  deleteBalanceSheetLine,
  deleteIncomeStatementLine,
  getBalanceSheetLine,
  getIncomeStatementLine,
  readBalanceSheetLineHistory,
  resetBalanceSheetLayout,
  resetIncomeStatementLayout,
  runBalanceSheetConfigAction,
  runBalanceSheetHistoryAction,
  runBalanceSheetTemplateAction,
  updateBalanceSheetLine,
  updateIncomeStatementLine,
} from '../manage-layouts.service'
import { validateAccountCodes } from '../shared/validate-account-codes.service'
import { SIMPLIFIED_BALANCE_SHEET_CONFIG_2026 } from '../../balance-sheet/config/default-pcg-config-simplified-2026'
import { SIMPLIFIED_INCOME_STATEMENT_CONFIG_2026 } from '../../income-statement/config/default-pcg-config-simplified-2026'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
const ids = {} as Record<string, string>
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

type Entry = { children?: Entry[] }
const countEntries = (entries: Entry[]): number => entries.reduce((n, e) => n + 1 + countEntries(e.children ?? []), 0)

describe.skipIf(!available)('statement layout operations', () => {
  beforeAll(async () => {
    await prepareTestDatabase('rep_manage_layouts')
    ;({ prisma } = await import('@/lib/prisma'))
    const company = await prisma.company.create({ data: { name: 'Atelier', slug: 'atelier', siren: '123456789' } })
    const other = await prisma.company.create({ data: { name: 'Autre', slug: 'autre', siren: '987654321' } })
    const fy = await prisma.fiscalYear.create({ data: { companyId: company.id, year: 2025, startDate: day('2025-01-01'), endDate: day('2025-12-31') } })
    const otherFy = await prisma.fiscalYear.create({ data: { companyId: other.id, year: 2025, startDate: day('2025-01-01'), endDate: day('2025-12-31') } })
    for (const [code, label] of [['512000', 'Banque'], ['512100', 'Banque 2'], ['411000', 'Clients']]) {
      await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code, label } })
    }
    await prisma.account.create({ data: { companyId: other.id, fiscalYearId: otherFy.id, code: '401000', label: 'Fournisseurs' } })
    Object.assign(ids, { company: company.id, other: other.id })
  }, 60_000)

  beforeEach(async () => {
    await prisma.balanceSheetLineConfig.deleteMany({})
    await prisma.incomeStatementLineConfig.deleteMany({})
    await prisma.balanceSheetConfigTemplate.deleteMany({})
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  describe('account codes of a layout line', () => {
    it('accepts exact codes of the company only and names the unknown ones in French', async () => {
      await expect(validateAccountCodes(ids.company, ['512000', '411000'])).resolves.toBeUndefined()
      await expect(validateAccountCodes(ids.company, ['512000', '401000', '6'], 'exact')).rejects.toMatchObject({
        name: 'ValidationError',
        message: 'Comptes inconnus : 401000, 6. Créez-les dans le plan comptable de la société ou corrigez les numéros.',
      })
      // 401000 exists, but in another company's chart.
      await expect(validateAccountCodes(ids.other, ['401000'])).resolves.toBeUndefined()
    })

    it('accepts any prefix with starts_with, and checks prefixes against the chart in strict mode', async () => {
      await expect(validateAccountCodes(ids.company, ['7', '64'], 'starts_with')).resolves.toBeUndefined()
      await expect(validateAccountCodes(ids.company, ['512', '41'], 'starts_with', true)).resolves.toBeUndefined()
      await expect(validateAccountCodes(ids.company, ['512', '40', '6'], 'starts_with', true)).rejects.toThrow(
        'Préfixes de comptes inconnus : 40, 6. Aucun compte de la société ne commence par ces préfixes.',
      )
    })

    it('accepts an empty list and refuses a missing company', async () => {
      await expect(validateAccountCodes(ids.company, [])).resolves.toBeUndefined()
      await expect(validateAccountCodes('missing', [])).rejects.toMatchObject({ name: 'NotFoundError', message: 'Société introuvable' })
    })
  })

  describe('balance sheet lines', () => {
    it('fills the defaults of a new line: starts_with, debit, order 1, sum without codes', async () => {
      const sum = await createBalanceSheetLine(ids.company, { reportVariant: 'simplified', lineLabel: 'Actif circulant' })
      expect(sum).toMatchObject({ lineType: 'sum', filterType: 'starts_with', balanceType: 'debit', displayType: 'net', order: 1, accountCodes: [] })
      const withCodes = await createBalanceSheetLine(ids.company, { reportVariant: 'simplified', lineLabel: 'Disponibilités', parentId: sum.id, accountCodes: ['53'] })
      expect(withCodes).toMatchObject({ lineType: 'line', parentId: sum.id, accountCodes: ['53'], filterType: 'starts_with' })
    })

    it('answers 404 for a line, a parent or a template of another company', async () => {
      const foreign = await prisma.balanceSheetLineConfig.create({
        data: { companyId: ids.other, reportVariant: 'simplified', lineLabel: 'Autre', accountCodes: [], balanceType: 'debit', order: 1 },
      })
      const own = await createBalanceSheetLine(ids.company, { reportVariant: 'simplified', lineLabel: 'Mienne' })
      expect((await getBalanceSheetLine(ids.company, own.id)).lineLabel).toBe('Mienne')
      await expect(getBalanceSheetLine(ids.company, foreign.id)).rejects.toMatchObject({ name: 'NotFoundError', message: 'Configuration introuvable' })
      await expect(updateBalanceSheetLine(ids.company, own.id, { parentId: foreign.id })).rejects.toThrow('Configuration introuvable')
      await expect(updateBalanceSheetLine(ids.company, foreign.id, { lineLabel: 'x' })).rejects.toThrow('Configuration introuvable')
      await expect(deleteBalanceSheetLine(ids.company, foreign.id)).rejects.toThrow('Configuration introuvable')

      const privateTemplate = await prisma.balanceSheetConfigTemplate.create({
        data: { name: 'Privé', reportVariant: 'simplified', companyId: ids.other, configData: {} },
      })
      await expect(
        createBalanceSheetLine(ids.company, { reportVariant: 'simplified', lineLabel: 'x', templateId: privateTemplate.id }),
      ).rejects.toThrow('Modèle introuvable')
      const publicTemplate = await prisma.balanceSheetConfigTemplate.create({
        data: { name: 'Public', reportVariant: 'simplified', isPublic: true, configData: {} },
      })
      const fromPublic = await createBalanceSheetLine(ids.company, { reportVariant: 'simplified', lineLabel: 'x', templateId: publicTemplate.id })
      expect(fromPublic.templateId).toBe(publicTemplate.id)
    })

    it('moves a line under another line of the company and deletes it', async () => {
      const parent = await createBalanceSheetLine(ids.company, { reportVariant: 'simplified', lineLabel: 'Parent' })
      const child = await createBalanceSheetLine(ids.company, { reportVariant: 'simplified', lineLabel: 'Enfant', order: 2 })
      const moved = await updateBalanceSheetLine(ids.company, child.id, { parentId: parent.id })
      expect(moved).toMatchObject({ parentId: parent.id, lineLabel: 'Enfant', version: 2 })
      await deleteBalanceSheetLine(ids.company, moved.id)
      expect(await prisma.balanceSheetLineConfig.count({ where: { id: moved.id } })).toBe(0)
    })

    it('creates the default layout or one line with its section through the config action', async () => {
      const line = await runBalanceSheetConfigAction(ids.company, {
        action: 'create_line',
        reportVariant: 'simplified',
        lineLabel: 'Capital',
        section: 'passif',
        accountCodes: ['101'],
        filterType: 'starts_with',
        balanceType: 'credit',
        hideLabel: true,
      })
      expect(line).toMatchObject({ section: 'passif', lineType: 'line', balanceType: 'credit', hideLabel: true, order: 1 })
      const layout = await runBalanceSheetConfigAction(ids.company, { action: 'create_default', variant: 'simplified' })
      expect(layout.reportVariant).toBe('simplified')
      expect(await prisma.balanceSheetLineConfig.count({ where: { companyId: ids.company } })).toBe(countEntries(SIMPLIFIED_BALANCE_SHEET_CONFIG_2026) + 1)
    })

    it('resets the layout of the variant to the PCG default (notice 2033-A), other variant untouched', async () => {
      await createBalanceSheetLine(ids.company, { reportVariant: 'simplified', lineLabel: 'Personnalisée' })
      const complete = await createBalanceSheetLine(ids.company, { reportVariant: 'complete', lineLabel: 'Complet' })
      const reset = await resetBalanceSheetLayout(ids.company, 'simplified')
      expect(reset.lines.map((l) => l.lineLabel)).toEqual(SIMPLIFIED_BALANCE_SHEET_CONFIG_2026.map((e) => e.lineLabel))
      const simplified = await prisma.balanceSheetLineConfig.findMany({ where: { companyId: ids.company, reportVariant: 'simplified' } })
      expect(simplified).toHaveLength(countEntries(SIMPLIFIED_BALANCE_SHEET_CONFIG_2026))
      expect(simplified.map((l) => l.lineLabel)).not.toContain('Personnalisée')
      expect(await prisma.balanceSheetLineConfig.count({ where: { id: complete.id } })).toBe(1)
    })
  })

  describe('balance sheet history and templates', () => {
    it('snapshots, reads, compares and restores the versions of a line of the company', async () => {
      const line = await createBalanceSheetLine(ids.company, { reportVariant: 'simplified', lineLabel: 'Disponibilités', accountCodes: ['512'] })
      const snapshot = await runBalanceSheetHistoryAction(ids.company, 'user-1', { action: 'create_snapshot', configId: line.id, changeReason: 'Avant essai' })
      expect(snapshot.created).toBe(true)
      expect(snapshot.result).toMatchObject({ configId: line.id, version: 1, changedBy: 'user-1', changeReason: 'Avant essai' })

      await prisma.balanceSheetLineConfig.update({ where: { id: line.id }, data: { version: 2, lineLabel: 'Trésorerie' } })
      await runBalanceSheetHistoryAction(ids.company, 'user-1', { action: 'create_snapshot', configId: line.id })

      expect(await readBalanceSheetLineHistory(ids.company, { configId: line.id })).toHaveLength(2)
      expect(await readBalanceSheetLineHistory(ids.company, { configId: line.id, version: 1 })).toMatchObject({ version: 1, data: { lineLabel: 'Disponibilités' } })
      await expect(readBalanceSheetLineHistory(ids.company, { configId: line.id, version: 3 })).rejects.toThrow('Version introuvable')
      expect(await readBalanceSheetLineHistory(ids.company, { configId: line.id, version1: 1, version2: 2 })).toMatchObject({
        differences: [{ field: 'lineLabel', oldValue: 'Disponibilités', newValue: 'Trésorerie' }],
      })

      await expect(runBalanceSheetHistoryAction(ids.company, 'user-1', { action: 'restore', configId: line.id })).rejects.toMatchObject({
        name: 'ValidationError',
        message: 'Indiquez la version à restaurer',
      })
      const restored = await runBalanceSheetHistoryAction(ids.company, 'user-1', { action: 'restore', configId: line.id, version: 1 })
      expect(restored.created).toBe(false)
      expect(restored.result).toMatchObject({ lineLabel: 'Disponibilités', version: 3 })

      // A line of another company: 404 before any history is read.
      await expect(readBalanceSheetLineHistory(ids.other, { configId: line.id })).rejects.toThrow('Configuration introuvable')
      await expect(runBalanceSheetHistoryAction(ids.other, 'user-2', { action: 'create_snapshot', configId: line.id })).rejects.toThrow('Configuration introuvable')
    })

    it('saves the layout as a template with its author, then applies it', async () => {
      await createBalanceSheetLine(ids.company, { reportVariant: 'simplified', lineLabel: 'Capital', accountCodes: ['101'], balanceType: 'credit' })
      const saved = await runBalanceSheetTemplateAction(ids.company, 'user-1', { action: 'create', name: 'Mon modèle', variant: 'simplified' })
      expect(saved.created).toBe(true)
      expect(saved.result).toMatchObject({ name: 'Mon modèle', createdBy: 'user-1', isPublic: false, companyId: ids.company, description: null })

      const templateId = (saved.result as { id: string }).id
      const applied = await runBalanceSheetTemplateAction(ids.company, 'user-1', { action: 'apply', templateId })
      expect(applied.created).toBe(false)
      expect(applied.result).toMatchObject({ reportVariant: 'simplified', lines: [expect.objectContaining({ lineLabel: 'Capital', templateId })] })
      await expect(runBalanceSheetTemplateAction(ids.other, 'user-2', { action: 'apply', templateId })).rejects.toThrow('Modèle introuvable')
    })
  })

  describe('income statement lines', () => {
    it('fills the defaults of a new line: starts_with, credit, order 1', async () => {
      const line = await createIncomeStatementLine(ids.company, { reportVariant: 'simplified', lineLabel: 'Produits divers', accountCodes: ['758'] })
      expect(line).toMatchObject({ filterType: 'starts_with', balanceType: 'credit', order: 1, section: null, accountCodes: ['758'], hideLabel: false })
      const full = await createIncomeStatementConfigLine(ids.company, {
        reportVariant: 'complete',
        lineLabel: 'Charges diverses',
        section: 'charges',
        accountCodes: ['658'],
        balanceType: 'debit',
        order: 12,
      })
      expect(full).toMatchObject({ reportVariant: 'complete', section: 'charges', balanceType: 'debit', order: 12, parentId: null, excludedAccountCodes: [] })
    })

    it('answers 404 for a line or a new parent of another company, and deactivates its own line', async () => {
      const foreign = await prisma.incomeStatementLineConfig.create({
        data: { companyId: ids.other, reportVariant: 'simplified', lineLabel: 'Autre', accountCodes: [], balanceType: 'credit', order: 1 },
      })
      const own = await createIncomeStatementLine(ids.company, { reportVariant: 'simplified', lineLabel: 'Mienne' })
      expect((await getIncomeStatementLine(ids.company, own.id)).id).toBe(own.id)
      await expect(getIncomeStatementLine(ids.company, foreign.id)).rejects.toThrow('Configuration introuvable')
      await expect(updateIncomeStatementLine(ids.company, own.id, { parentId: foreign.id })).rejects.toThrow('Configuration introuvable')
      await expect(deleteIncomeStatementLine(ids.company, foreign.id)).rejects.toThrow('Configuration introuvable')
      expect((await prisma.incomeStatementLineConfig.findUniqueOrThrow({ where: { id: foreign.id } })).isActive).toBe(true)

      expect(await updateIncomeStatementLine(ids.company, own.id, { lineLabel: 'Renommée' })).toMatchObject({ id: own.id, lineLabel: 'Renommée' })
      await deleteIncomeStatementLine(ids.company, own.id)
      expect((await prisma.incomeStatementLineConfig.findUniqueOrThrow({ where: { id: own.id } })).isActive).toBe(false)
    })

    it('resets the layout of the variant to the PCG default (notice 2033-B)', async () => {
      const custom = await createIncomeStatementLine(ids.company, { reportVariant: 'simplified', lineLabel: 'Personnalisée' })
      const reset = await resetIncomeStatementLayout(ids.company, 'simplified')
      expect(reset.lines).toHaveLength(SIMPLIFIED_INCOME_STATEMENT_CONFIG_2026.length)
      expect(await prisma.incomeStatementLineConfig.count({ where: { id: custom.id } })).toBe(0)
      expect(await prisma.incomeStatementLineConfig.count({ where: { companyId: ids.company } })).toBe(countEntries(SIMPLIFIED_INCOME_STATEMENT_CONFIG_2026))
    })
  })
})
