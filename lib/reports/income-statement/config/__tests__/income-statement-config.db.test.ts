/**
 * Income statement layout services against PostgreSQL: lines created, read
 * as a tree (the PCG default created on first read), updated in place or as
 * a new version with a history snapshot, deactivated; the history (list, one
 * version, restore) and the PCG default layouts (notice 2033-B for the
 * simplified layout, forms 2052 and 2053 for the complete one). Skipped
 * without the test database server.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('rep_is_config')
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { createIncomeStatementLineConfig, type CreateIncomeStatementLineConfigData } from '../create-income-statement-line-config.service'
import { updateIncomeStatementLineConfig } from '../update-income-statement-line-config.service'
import { deleteIncomeStatementLineConfig } from '../delete-income-statement-line-config.service'
import { getIncomeStatementConfig, getIncomeStatementLineConfigs } from '../get-income-statement-config.service'
import { createConfigHistorySnapshot, getConfigHistory, getConfigVersion, restoreConfigVersion } from '../manage-config-history.service'
import { createDefaultIncomeStatementConfig, getOrCreateDefaultIncomeStatementConfig } from '../create-default-pcg-config.service'
import { COMPLETE_INCOME_STATEMENT_CONFIG_2026 } from '../default-pcg-config-complete-2026'
import { SIMPLIFIED_INCOME_STATEMENT_CONFIG_2026 } from '../default-pcg-config-simplified-2026'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
const ids = {} as Record<string, string>

type Entry = { children?: Entry[] }
const countEntries = (entries: Entry[]): number => entries.reduce((n, e) => n + 1 + countEntries(e.children ?? []), 0)

function line(input: Partial<CreateIncomeStatementLineConfigData> & { lineLabel: string }) {
  return createIncomeStatementLineConfig({
    companyId: ids.company,
    reportVariant: 'simplified',
    accountCodes: [],
    balanceType: 'credit',
    order: 1,
    ...input,
  })
}

describe.skipIf(!available)('income statement layout services', () => {
  beforeAll(async () => {
    await prepareTestDatabase('rep_is_config')
    ;({ prisma } = await import('@/lib/prisma'))
    const company = await prisma.company.create({ data: { name: 'Atelier', slug: 'atelier', siren: '123456789' } })
    const other = await prisma.company.create({ data: { name: 'Autre', slug: 'autre', siren: '987654321' } })
    Object.assign(ids, { company: company.id, other: other.id })
  }, 60_000)

  beforeEach(async () => {
    await prisma.incomeStatementLineConfig.deleteMany({})
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  describe('create', () => {
    it('stores a line with its defaults under a parent of the same company and variant', async () => {
      const parent = await line({ lineLabel: "Produits d'exploitation", section: 'produits', balanceType: 'auto', formCode: '232' })
      expect(parent).toMatchObject({ parentId: null, section: 'produits', balanceType: 'auto', version: 1, isActive: true, hideLabel: false, templateId: null })
      const child = await line({ parentId: parent.id, lineLabel: "Chiffre d'affaires", accountCodes: ['70'], filterType: 'starts_with', formCode: '209', hideLabel: true, order: 2 })
      expect(child).toMatchObject({
        parentId: parent.id,
        section: null,
        accountCodes: ['70'],
        excludedAccountCodes: [],
        filterType: 'starts_with',
        filterValue: null,
        formCode: '209',
        hideLabel: true,
        order: 2,
        notes: null,
      })
    })

    it('refuses a parent of another company (404) or of the other variant (400)', async () => {
      const foreign = await prisma.incomeStatementLineConfig.create({
        data: { companyId: ids.other, reportVariant: 'simplified', lineLabel: 'Autre', accountCodes: [], balanceType: 'credit', order: 1 },
      })
      await expect(line({ lineLabel: 'x', parentId: foreign.id })).rejects.toMatchObject({ name: 'NotFoundError', message: 'Ligne parente introuvable' })
      const complete = await line({ lineLabel: 'Complet', reportVariant: 'complete' })
      await expect(line({ lineLabel: 'x', parentId: complete.id })).rejects.toThrow(
        'La ligne parente doit appartenir à la même variante du compte de résultat (complet ou simplifié)',
      )
    })
  })

  describe('read', () => {
    it('returns the active lines as a tree, and creates the PCG default on first read', async () => {
      const root = await line({ lineLabel: 'Charges', section: 'charges', balanceType: 'auto', order: 2 })
      await line({ lineLabel: 'Produits', section: 'produits', balanceType: 'auto', order: 1 })
      await line({ lineLabel: 'Achats', parentId: root.id, accountCodes: ['60'], balanceType: 'debit', order: 2 })
      const old = await line({ lineLabel: 'Ancienne', parentId: root.id, order: 1 })
      await prisma.incomeStatementLineConfig.update({ where: { id: old.id }, data: { isActive: false } })

      const config = await getIncomeStatementConfig(ids.company, 'simplified')
      expect(config.lines.map((l) => l.lineLabel)).toEqual(['Produits', 'Charges'])
      expect(config.lines[1].children?.map((l) => l.lineLabel)).toEqual(['Achats'])
      const all = await getIncomeStatementLineConfigs(ids.company, 'simplified', true)
      expect(all[1].children?.map((l) => l.lineLabel)).toEqual(['Ancienne', 'Achats'])

      // No layout yet for the other company: the simplified default of form 2033-B is created.
      const created = await getIncomeStatementConfig(ids.other, 'simplified')
      expect(created.lines.map((l) => l.lineLabel)).toEqual(
        [...SIMPLIFIED_INCOME_STATEMENT_CONFIG_2026].sort((a, b) => a.order - b.order).map((e) => e.lineLabel),
      )
      expect(await prisma.incomeStatementLineConfig.count({ where: { companyId: ids.other } })).toBe(countEntries(SIMPLIFIED_INCOME_STATEMENT_CONFIG_2026))
    })
  })

  describe('update', () => {
    it('changes a label in place without a new version', async () => {
      const created = await line({ lineLabel: 'Ventes', accountCodes: ['70'] })
      const updated = await updateIncomeStatementLineConfig(created.id, { lineLabel: 'Chiffre d\'affaires', hideLabel: true, order: 4, notes: 'Hors TVA' })
      expect(updated).toMatchObject({ id: created.id, version: 1, lineLabel: "Chiffre d'affaires", hideLabel: true, order: 4, notes: 'Hors TVA' })
      expect(await prisma.incomeStatementConfigHistory.count()).toBe(0)
    })

    it('creates a new version when the accounts or the sense change: snapshot, old row inactive, children moved', async () => {
      const parent = await line({ lineLabel: 'Achats', section: 'charges', accountCodes: ['60'], balanceType: 'debit', formCode: '234', order: 3 })
      const child = await line({ lineLabel: 'Détail', parentId: parent.id })

      const updated = await updateIncomeStatementLineConfig(parent.id, { accountCodes: ['60', '61', '62'] })
      expect(updated.id).not.toBe(parent.id)
      expect(updated).toMatchObject({ version: 2, isActive: true, section: 'charges', formCode: '234', accountCodes: ['60', '61', '62'], balanceType: 'debit', order: 3 })
      expect((await prisma.incomeStatementLineConfig.findUniqueOrThrow({ where: { id: parent.id } })).isActive).toBe(false)
      expect((await prisma.incomeStatementLineConfig.findUniqueOrThrow({ where: { id: child.id } })).parentId).toBe(updated.id)

      const history = await getConfigHistory(parent.id)
      expect(history.map((h) => [h.version, h.changedBy, h.changeReason])).toEqual([[1, null, 'Configuration updated']])

      const flipped = await updateIncomeStatementLineConfig(updated.id, { balanceType: 'credit' })
      expect(flipped).toMatchObject({ version: 3, balanceType: 'credit', accountCodes: ['60', '61', '62'] })
    })

    it('clears the fields sent as null in a new version (regression: the old values were kept)', async () => {
      const parent = await line({ lineLabel: 'Produits', section: 'produits', balanceType: 'auto' })
      const created = await line({ lineLabel: 'Ventes', parentId: parent.id, section: 'produits', accountCodes: ['70'], formCode: '209', filterValue: 'x', notes: 'Ancienne note' })
      const updated = await updateIncomeStatementLineConfig(created.id, { accountCodes: ['70', '709'], parentId: null, section: null, formCode: null, filterValue: null, notes: null })
      expect(updated).toMatchObject({ version: 2, accountCodes: ['70', '709'], parentId: null, section: null, formCode: null, filterValue: null, notes: null })
    })

    it('answers 404 for a missing line', async () => {
      await expect(updateIncomeStatementLineConfig('missing', { lineLabel: 'x' })).rejects.toThrow('Configuration introuvable')
    })
  })

  describe('delete', () => {
    it('deactivates the line (soft delete)', async () => {
      const created = await line({ lineLabel: 'Ventes' })
      await deleteIncomeStatementLineConfig(created.id)
      expect((await prisma.incomeStatementLineConfig.findUniqueOrThrow({ where: { id: created.id } })).isActive).toBe(false)
      expect((await getIncomeStatementLineConfigs(ids.company, 'simplified')).map((l) => l.id)).not.toContain(created.id)
      await expect(deleteIncomeStatementLineConfig('missing')).rejects.toThrow('Configuration introuvable')
    })
  })

  describe('history', () => {
    it('snapshots a version once, reads it back and restores it in place', async () => {
      const created = await line({ lineLabel: 'Ventes', accountCodes: ['70'], formCode: '209', notes: 'v1', order: 1 })
      await createConfigHistorySnapshot(created.id, 1, { changedBy: 'user-1', changeReason: 'Avant changement' })
      await createConfigHistorySnapshot(created.id, 1, { changedBy: 'user-2', changeReason: 'Ignoré' })
      expect(await getConfigHistory(created.id)).toEqual([
        expect.objectContaining({ version: 1, changedBy: 'user-1', changeReason: 'Avant changement' }),
      ])
      expect(await getConfigVersion(created.id, 1)).toMatchObject({ lineLabel: 'Ventes', accountCodes: ['70'], notes: 'v1' })
      expect(await getConfigVersion(created.id, 2)).toBeNull()

      await prisma.incomeStatementLineConfig.update({
        where: { id: created.id },
        data: { lineLabel: 'Autre', accountCodes: ['75'], balanceType: 'debit', formCode: null, notes: null, order: 9 },
      })
      const restored = await restoreConfigVersion(created.id, 1)
      expect(restored).toMatchObject({ id: created.id, lineLabel: 'Ventes', accountCodes: ['70'], balanceType: 'credit', formCode: '209', notes: 'v1', order: 1 })

      await expect(restoreConfigVersion(created.id, 5)).rejects.toThrow('Version introuvable')
      await expect(createConfigHistorySnapshot('missing', 1, {})).rejects.toThrow('Configuration introuvable')
    })
  })

  describe('PCG default layouts', () => {
    it('creates the complete layout of forms 2052 and 2053 with sections inherited from the roots', async () => {
      const created = await createDefaultIncomeStatementConfig(ids.company)
      expect(created.reportVariant).toBe('complete')
      const rows = await prisma.incomeStatementLineConfig.findMany({ where: { companyId: ids.company, reportVariant: 'complete' } })
      expect(rows).toHaveLength(countEntries(COMPLETE_INCOME_STATEMENT_CONFIG_2026))
      // 2052: FG Production vendue de services (706), FW Autres achats et charges externes.
      expect(rows.find((r) => r.formCode === 'FG')).toMatchObject({ section: 'produits', balanceType: 'credit', accountCodes: ['705', '706', '708', '7095', '7096', '7098', '70'] })
      expect(rows.find((r) => r.formCode === 'FW')).toMatchObject({ section: 'charges', balanceType: 'debit' })
      expect(rows.every((r) => r.version === 1 && r.isActive && r.filterValue === null)).toBe(true)
    })

    it('returns the stored layout as a tree instead of creating a second one', async () => {
      const first = await getOrCreateDefaultIncomeStatementConfig(ids.company, 'simplified')
      const count = await prisma.incomeStatementLineConfig.count()
      expect(count).toBe(countEntries(SIMPLIFIED_INCOME_STATEMENT_CONFIG_2026))
      // 2033-B line 232: Total des produits d'exploitation, with its lines 210 to 230 under it.
      const products = first.lines.find((l) => l.formCode === '232')
      expect(products?.children?.map((c) => c.formCode)).toEqual(['210', '214', '218', '222', '224', '226', '230'])

      const second = await getOrCreateDefaultIncomeStatementConfig(ids.company, 'simplified')
      expect(await prisma.incomeStatementLineConfig.count()).toBe(count)
      expect(second.lines.map((l) => l.id)).toEqual(first.lines.map((l) => l.id))
    })
  })
})
