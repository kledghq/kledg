/**
 * Balance sheet layout services against PostgreSQL: lines created, read as a
 * tree, updated in place or as a new version (with a history snapshot),
 * deleted; the history (snapshot, list, one version, comparison, restore),
 * the templates and the PCG default layouts (notice 2033-A for the
 * simplified layout, forms 2050 and 2051 for the complete one). Skipped
 * without the test database server.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('rep_bs_config')
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { createBalanceSheetLineConfig, type CreateBalanceSheetLineConfigInput } from '../create-balance-sheet-line-config.service'
import { updateBalanceSheetLineConfig } from '../update-balance-sheet-line-config.service'
import { deleteBalanceSheetLineConfig } from '../delete-balance-sheet-line-config.service'
import { getBalanceSheetConfig, getBalanceSheetLineConfigs } from '../get-balance-sheet-config.service'
import {
  compareConfigVersions,
  createConfigHistorySnapshot,
  getConfigHistory,
  getConfigVersion,
  restoreConfigVersion,
} from '../manage-config-history.service'
import { applyBalanceSheetTemplate, createBalanceSheetTemplate, listBalanceSheetTemplates } from '../manage-templates.service'
import { createDefaultBalanceSheetConfig, getOrCreateDefaultBalanceSheetConfig } from '../create-default-pcg-config.service'
import { COMPLETE_BALANCE_SHEET_CONFIG_2026 } from '../default-pcg-config-complete-2026'
import { SIMPLIFIED_BALANCE_SHEET_CONFIG_2026 } from '../default-pcg-config-simplified-2026'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
const ids = {} as Record<string, string>
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

type Entry = { children?: Entry[] }
const countEntries = (entries: Entry[]): number => entries.reduce((n, e) => n + 1 + countEntries(e.children ?? []), 0)

function line(input: Partial<CreateBalanceSheetLineConfigInput> & { lineLabel: string }) {
  return createBalanceSheetLineConfig({
    companyId: ids.company,
    reportVariant: 'simplified',
    accountCodes: [],
    balanceType: 'debit',
    order: 1,
    ...input,
  })
}

describe.skipIf(!available)('balance sheet layout services', () => {
  beforeAll(async () => {
    await prepareTestDatabase('rep_bs_config')
    ;({ prisma } = await import('@/lib/prisma'))
    const company = await prisma.company.create({ data: { name: 'Atelier', slug: 'atelier', siren: '123456789' } })
    const other = await prisma.company.create({ data: { name: 'Autre', slug: 'autre', siren: '987654321' } })
    const fy = await prisma.fiscalYear.create({ data: { companyId: company.id, year: 2025, startDate: day('2025-01-01'), endDate: day('2025-12-31') } })
    for (const [code, label] of [['512000', 'Banque'], ['411000', 'Clients'], ['401000', 'Fournisseurs']]) {
      await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code, label } })
    }
    Object.assign(ids, { company: company.id, other: other.id })
  }, 60_000)

  beforeEach(async () => {
    await prisma.balanceSheetLineConfig.deleteMany({})
    await prisma.balanceSheetConfigTemplate.deleteMany({})
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  describe('create', () => {
    it('stores a line with its defaults and inherits the section of its parent', async () => {
      const parent = await line({ lineLabel: 'Actif circulant', section: 'actif', balanceType: 'auto' })
      expect(parent).toMatchObject({ lineType: 'sum', section: 'actif', version: 1, isActive: true, displayType: 'net', hideLabel: false })

      const child = await line({ lineLabel: 'Disponibilités', parentId: parent.id, formCode: '084', accountCodes: ['512000'], filterType: 'exact', order: 3 })
      expect(child).toMatchObject({
        parentId: parent.id,
        section: 'actif',
        lineType: 'line',
        formCode: '084',
        accountCodes: ['512000'],
        excludedAccountCodes: [],
        amortissementAccountCodes: [],
        filterType: 'exact',
        filterValue: null,
        order: 3,
        notes: null,
        templateId: null,
      })
    })

    it('accepts prefixes that match no account yet with starts_with, refuses unknown exact codes', async () => {
      const prefixes = await line({ lineLabel: 'Comptes financiers', accountCodes: ['53', '54'], filterType: 'starts_with' })
      expect(prefixes.accountCodes).toEqual(['53', '54'])

      await expect(line({ lineLabel: 'Inconnu', accountCodes: ['512000', '530000'], filterType: 'exact' })).rejects.toThrow(
        'Comptes inconnus : 530000. Créez-les dans le plan comptable de la société ou corrigez les numéros.',
      )
      // Excluded codes are checked with the same filter type.
      await expect(line({ lineLabel: 'Exclusions', accountCodes: ['512000'], excludedAccountCodes: ['999999'], filterType: 'exact' })).rejects.toThrow(
        'Comptes inconnus : 999999',
      )
    })

    it('refuses a parent of another company (404) or of the other variant (400)', async () => {
      const foreign = await prisma.balanceSheetLineConfig.create({
        data: { companyId: ids.other, reportVariant: 'simplified', lineLabel: 'Autre', accountCodes: [], balanceType: 'debit', order: 1 },
      })
      await expect(line({ lineLabel: 'x', parentId: foreign.id })).rejects.toMatchObject({ name: 'NotFoundError', message: 'Ligne parente introuvable' })
      await expect(line({ lineLabel: 'x', parentId: 'missing' })).rejects.toThrow('Ligne parente introuvable')

      const complete = await line({ lineLabel: 'Bilan complet', reportVariant: 'complete' })
      await expect(line({ lineLabel: 'x', parentId: complete.id })).rejects.toThrow(
        'La ligne parente doit appartenir à la même variante du bilan (complet ou simplifié)',
      )
    })

    it('refuses a missing company', async () => {
      await expect(line({ lineLabel: 'x', companyId: 'missing' })).rejects.toThrow('Société introuvable')
    })
  })

  describe('read', () => {
    it('returns the active lines of the variant as a tree ordered by order', async () => {
      const root = await line({ lineLabel: 'Actif circulant', section: 'actif', order: 2 })
      await line({ lineLabel: 'Actif immobilisé', section: 'actif', order: 1 })
      await line({ lineLabel: 'Disponibilités', parentId: root.id, order: 2 })
      await line({ lineLabel: 'Créances', parentId: root.id, order: 1 })
      const hidden = await line({ lineLabel: 'Ancienne ligne', parentId: root.id, order: 3 })
      await prisma.balanceSheetLineConfig.update({ where: { id: hidden.id }, data: { isActive: false } })
      await line({ lineLabel: 'Bilan complet', reportVariant: 'complete' })

      const config = await getBalanceSheetConfig(ids.company, 'simplified')
      expect(config.companyId).toBe(ids.company)
      expect(config.reportVariant).toBe('simplified')
      expect(config.lines.map((l) => l.lineLabel)).toEqual(['Actif immobilisé', 'Actif circulant'])
      expect(config.lines[1].children?.map((l) => l.lineLabel)).toEqual(['Créances', 'Disponibilités'])

      const all = await getBalanceSheetLineConfigs(ids.company, 'simplified', true)
      expect(all[1].children?.map((l) => l.lineLabel)).toEqual(['Créances', 'Disponibilités', 'Ancienne ligne'])
      expect((await getBalanceSheetConfig(ids.other)).lines).toEqual([])
    })
  })

  describe('update', () => {
    it('renames in place without a new version', async () => {
      const created = await line({ lineLabel: 'Disponibilités', accountCodes: ['512000'], filterType: 'exact' })
      const updated = await updateBalanceSheetLineConfig(created.id, ids.company, { lineLabel: 'Trésorerie', notes: 'Banque seule', hideLabel: true })
      expect(updated).toMatchObject({ id: created.id, version: 1, lineLabel: 'Trésorerie', notes: 'Banque seule', hideLabel: true })
      expect(await prisma.balanceSheetConfigHistory.count()).toBe(0)
    })

    it('creates a new version when the accounts change: snapshot, old row inactive, children moved', async () => {
      const parent = await line({ lineLabel: 'Créances', section: 'actif', accountCodes: ['411000'], filterType: 'exact', order: 4 })
      const child = await line({ lineLabel: 'Détail', parentId: parent.id })

      const updated = await updateBalanceSheetLineConfig(parent.id, ids.company, { accountCodes: ['411000', '401000'], lineLabel: 'Créances et fournisseurs débiteurs' })
      expect(updated.id).not.toBe(parent.id)
      expect(updated).toMatchObject({
        version: 2,
        isActive: true,
        section: 'actif',
        lineLabel: 'Créances et fournisseurs débiteurs',
        accountCodes: ['411000', '401000'],
        filterType: 'exact',
        order: 4,
      })
      expect((await prisma.balanceSheetLineConfig.findUniqueOrThrow({ where: { id: parent.id } })).isActive).toBe(false)
      expect((await prisma.balanceSheetLineConfig.findUniqueOrThrow({ where: { id: child.id } })).parentId).toBe(updated.id)

      const history = await prisma.balanceSheetConfigHistory.findMany({ where: { configId: parent.id } })
      expect(history).toHaveLength(1)
      expect(history[0]).toMatchObject({ version: 1, changeReason: 'Configuration updated', changedBy: null })
      expect(history[0].data).toMatchObject({ lineLabel: 'Créances', accountCodes: ['411000'] })
    })

    it('checks new codes with the stored filter type when none is given', async () => {
      const created = await line({ lineLabel: 'Disponibilités', accountCodes: ['512000'], filterType: 'exact' })
      await expect(updateBalanceSheetLineConfig(created.id, ids.company, { accountCodes: ['530000'] })).rejects.toThrow('Comptes inconnus : 530000')
      await expect(updateBalanceSheetLineConfig(created.id, ids.company, { excludedAccountCodes: ['999999'] })).rejects.toThrow('Comptes inconnus : 999999')
      // starts_with given with the codes: a prefix is accepted.
      const prefixed = await updateBalanceSheetLineConfig(created.id, ids.company, { accountCodes: ['53'], filterType: 'starts_with' })
      expect(prefixed).toMatchObject({ accountCodes: ['53'], filterType: 'starts_with', version: 2 })
    })

    it('answers 404 with a French hint for a line of another company or a missing one', async () => {
      const created = await line({ lineLabel: 'x' })
      const message = 'Configuration introuvable : elle a peut-être été supprimée. Rechargez la page de configuration.'
      await expect(updateBalanceSheetLineConfig(created.id, ids.other, { lineLabel: 'y' })).rejects.toThrow(message)
      await expect(updateBalanceSheetLineConfig('missing', ids.company, { lineLabel: 'y' })).rejects.toThrow(message)
    })
  })

  describe('delete', () => {
    it('deletes the line with its history and children; another company gets a 404', async () => {
      const parent = await line({ lineLabel: 'Créances' })
      await line({ lineLabel: 'Détail', parentId: parent.id })
      await createConfigHistorySnapshot(parent.id, 'user-1', 'Avant suppression')

      await expect(deleteBalanceSheetLineConfig(parent.id, ids.other)).rejects.toThrow('Configuration introuvable')
      await deleteBalanceSheetLineConfig(parent.id, ids.company)
      expect(await prisma.balanceSheetLineConfig.count({ where: { companyId: ids.company } })).toBe(0)
      expect(await prisma.balanceSheetConfigHistory.count()).toBe(0)
      await expect(deleteBalanceSheetLineConfig(parent.id, ids.company)).rejects.toThrow('Configuration introuvable')
    })
  })

  describe('history', () => {
    it('snapshots each version once, lists them newest first, reads one and compares two', async () => {
      const created = await line({ lineLabel: 'Disponibilités', accountCodes: ['512000'], filterType: 'exact', notes: 'v1' })
      const first = await createConfigHistorySnapshot(created.id, 'user-1', 'Version initiale')
      expect(first).toMatchObject({ configId: created.id, version: 1, changedBy: 'user-1', changeReason: 'Version initiale', data: { lineLabel: 'Disponibilités' } })
      // Same version again: the stored snapshot is returned, nothing is written.
      const again = await createConfigHistorySnapshot(created.id, 'user-2', 'Autre raison')
      expect(again).toMatchObject({ id: first.id, changedBy: 'user-1', changeReason: 'Version initiale' })

      // Version 2 of the same row, then its snapshot.
      await prisma.balanceSheetLineConfig.update({
        where: { id: created.id },
        data: { version: 2, lineLabel: 'Trésorerie', accountCodes: ['512000', '411000'], notes: null },
      })
      await createConfigHistorySnapshot(created.id)

      const history = await getConfigHistory(created.id)
      expect(history.map((h) => [h.version, h.changedBy, h.changeReason])).toEqual([[2, null, null], [1, 'user-1', 'Version initiale']])
      expect((await getConfigVersion(created.id, 1))?.data).toMatchObject({ lineLabel: 'Disponibilités', notes: 'v1' })
      expect(await getConfigVersion(created.id, 9)).toBeNull()

      const compared = await compareConfigVersions(created.id, 1, 2)
      expect(compared.differences).toEqual([
        { field: 'accountCodes', oldValue: ['512000'], newValue: ['512000', '411000'] },
        { field: 'lineLabel', oldValue: 'Disponibilités', newValue: 'Trésorerie' },
        { field: 'notes', oldValue: 'v1', newValue: null },
      ])
      await expect(compareConfigVersions(created.id, 1, 9)).rejects.toThrow('Version introuvable')
      await expect(createConfigHistorySnapshot('missing')).rejects.toThrow('Configuration introuvable')
    })

    it('restores a version as a new active row and deactivates the current one', async () => {
      const created = await line({ lineLabel: 'Disponibilités', formCode: '084', accountCodes: ['512000'], filterType: 'exact', order: 7 })
      await createConfigHistorySnapshot(created.id)
      await prisma.balanceSheetLineConfig.update({ where: { id: created.id }, data: { version: 2, lineLabel: 'Renommée', accountCodes: ['411000'] } })

      const restored = await restoreConfigVersion(created.id, 1)
      expect(restored).toMatchObject({
        version: 3,
        isActive: true,
        lineLabel: 'Disponibilités',
        formCode: '084',
        accountCodes: ['512000'],
        filterType: 'exact',
        order: 7,
      })
      expect((await prisma.balanceSheetLineConfig.findUniqueOrThrow({ where: { id: created.id } })).isActive).toBe(false)
      // The current version was snapshotted before the restore.
      expect((await getConfigVersion(created.id, 2))?.changeReason).toBe('Restored to version 1')

      await expect(restoreConfigVersion(created.id, 9)).rejects.toThrow('Version introuvable')
    })
  })

  it('restores the whole line and keeps its children under it (regression: type, section, columns and children were lost)', async () => {
    // 2033-A line 028: Immobilisations corporelles, brut / amortissements / net on the actif.
    const fixed = await line({
      lineLabel: 'Immobilisations corporelles',
      section: 'actif',
      formCode: '028',
      lineType: 'sum',
      balanceType: 'auto',
      displayType: 'brut_amort_net',
      amortissementAccountCodes: ['281'],
      hideLabel: true,
      order: 3,
    })
    const child = await line({ lineLabel: 'Matériel', parentId: fixed.id, accountCodes: ['2154'], filterType: 'starts_with' })
    await createConfigHistorySnapshot(fixed.id)
    await prisma.balanceSheetLineConfig.update({ where: { id: fixed.id }, data: { version: 2, lineLabel: 'Corporelles' } })

    const restored = await restoreConfigVersion(fixed.id, 1)
    expect(restored).toMatchObject({
      lineLabel: 'Immobilisations corporelles',
      section: 'actif',
      lineType: 'sum',
      displayType: 'brut_amort_net',
      amortissementAccountCodes: ['281'],
      hideLabel: true,
    })
    expect((await prisma.balanceSheetLineConfig.findUniqueOrThrow({ where: { id: child.id } })).parentId).toBe(restored.id)
    const config = await getBalanceSheetConfig(ids.company, 'simplified')
    expect(config.lines.map((l) => [l.id, l.children?.map((c) => c.lineLabel)])).toEqual([[restored.id, ['Matériel']]])
  })

  describe('templates', () => {
    it('saves the layout as a template of the company and lists its own and Kledg\'s shared ones (KLEDG-R3-AUTHZ-01)', async () => {
      const root = await line({ lineLabel: 'Actif circulant', section: 'actif' })
      await line({ lineLabel: 'Disponibilités', parentId: root.id, accountCodes: ['51'], filterType: 'starts_with' })

      const own = await createBalanceSheetTemplate(ids.company, 'Mon modèle', 'Bilan maison', 'simplified', 'user-1')
      expect(own).toMatchObject({ name: 'Mon modèle', description: 'Bilan maison', reportVariant: 'simplified', isPublic: false, companyId: ids.company, createdBy: 'user-1', usageCount: 0 })
      expect(own.configData.lines.map((l) => l.lineLabel)).toEqual(['Actif circulant'])
      expect(own.configData.lines[0].children?.map((l) => l.lineLabel)).toEqual(['Disponibilités'])

      // A template provided by Kledg (no company, written by a migration or an operator).
      await prisma.balanceSheetConfigTemplate.create({ data: { name: 'Modèle public', reportVariant: 'simplified', isPublic: true, configData: { reportVariant: 'simplified', lines: [] } } })
      // A row without company that is not public (a company's template hidden by migration 20261121090000).
      await prisma.balanceSheetConfigTemplate.create({ data: { name: 'Masqué', reportVariant: 'simplified', createdBy: 'user-2', configData: { reportVariant: 'simplified', lines: [] } } })
      await prisma.balanceSheetConfigTemplate.create({ data: { name: 'Privé autre', reportVariant: 'simplified', companyId: ids.other, createdBy: 'user-2', configData: { reportVariant: 'simplified', lines: [] } } })
      // KLEDG-R3-QUAL-28: a damaged template (no lines) is left out of the list, the others stay
      await prisma.balanceSheetConfigTemplate.create({ data: { name: 'Abîmé', reportVariant: 'simplified', companyId: ids.other, configData: {} } })
      await prisma.balanceSheetConfigTemplate.create({ data: { name: 'Complet', reportVariant: 'complete', companyId: ids.company, configData: {} } })

      // Public templates first, then the company's own.
      expect((await listBalanceSheetTemplates(ids.company, 'simplified')).map((t) => t.name)).toEqual(['Modèle public', 'Mon modèle'])
      const otherList = await listBalanceSheetTemplates(ids.other, 'simplified')
      expect(otherList.map((t) => t.name)).toEqual(['Modèle public', 'Privé autre'])
      expect(otherList.map((t) => t.createdBy)).toEqual([null, 'user-2'])
    })

    it('applies a template: replaces the layout of the variant and counts the use', async () => {
      await line({ lineLabel: 'Disponibilités', section: 'actif', formCode: '084', accountCodes: ['51'], filterType: 'starts_with', order: 2 })
      await line({ lineLabel: 'Capital', section: 'passif', formCode: '120', accountCodes: ['101'], filterType: 'starts_with', balanceType: 'credit', order: 1 })
      const template = await createBalanceSheetTemplate(ids.company, 'Modèle', null, 'simplified')
      await prisma.balanceSheetLineConfig.deleteMany({})
      await prisma.balanceSheetLineConfig.create({
        data: { companyId: ids.company, reportVariant: 'simplified', lineLabel: 'Ligne à remplacer', accountCodes: [], balanceType: 'debit', order: 1 },
      })

      // Another company never applies it (KLEDG-R3-AUTHZ-01).
      await expect(applyBalanceSheetTemplate(template.id, ids.other)).rejects.toThrow('Modèle introuvable')
      const applied = await applyBalanceSheetTemplate(template.id, ids.company)
      expect(applied.reportVariant).toBe('simplified')
      expect(applied.lines.map((l) => [l.lineLabel, l.templateId, l.version])).toEqual([
        ['Capital', template.id, 1],
        ['Disponibilités', template.id, 1],
      ])
      const config = await getBalanceSheetConfig(ids.company, 'simplified')
      expect(config.lines.map((l) => [l.lineLabel, l.formCode, l.accountCodes, l.balanceType])).toEqual([
        ['Capital', '120', ['101'], 'credit'],
        ['Disponibilités', '084', ['51'], 'debit'],
      ])
      expect((await prisma.balanceSheetConfigTemplate.findUniqueOrThrow({ where: { id: template.id } })).usageCount).toBe(1)
    })

    it('applies the nested lines of a template with their sections (regression: only the roots were created)', async () => {
      // Notice 2033-A: 142 Capitaux propres > 120 Capital on the passif, 096 Actif circulant > 084 Disponibilités.
      const assets = await line({ lineLabel: 'Actif circulant', section: 'actif', formCode: '096', lineType: 'sum', balanceType: 'auto', order: 1 })
      await line({ lineLabel: 'Disponibilités', parentId: assets.id, formCode: '084', accountCodes: ['51'], filterType: 'starts_with' })
      const equity = await line({ lineLabel: 'Capitaux propres', section: 'passif', formCode: '142', lineType: 'sum', balanceType: 'auto', order: 2, hideLabel: true })
      await line({ lineLabel: 'Capital', parentId: equity.id, formCode: '120', accountCodes: ['101'], filterType: 'starts_with', balanceType: 'credit' })
      const saved = await createBalanceSheetTemplate(ids.company, 'Modèle imbriqué', null, 'simplified')
      // Shared the way Kledg provides one (no company, public), so another company applies it.
      const template = await prisma.balanceSheetConfigTemplate.update({ where: { id: saved.id }, data: { companyId: null, isPublic: true } })

      const applied = await applyBalanceSheetTemplate(template.id, ids.other)
      // Kledg's shared templates are not written by a company (row level security): no use counted.
      expect((await prisma.balanceSheetConfigTemplate.findUniqueOrThrow({ where: { id: template.id } })).usageCount).toBe(0)
      expect(applied.lines.map((l) => [l.lineLabel, l.children?.map((c) => c.lineLabel)])).toEqual([
        ['Actif circulant', ['Disponibilités']],
        ['Capitaux propres', ['Capital']],
      ])
      const rows = await prisma.balanceSheetLineConfig.findMany({ where: { companyId: ids.other }, orderBy: { order: 'asc' } })
      expect(rows).toHaveLength(4)
      const byCode = (formCode: string) => rows.find((r) => r.formCode === formCode)!
      expect(byCode('096')).toMatchObject({ section: 'actif', parentId: null, lineType: 'sum' })
      expect(byCode('084')).toMatchObject({ parentId: byCode('096').id, accountCodes: ['51'] })
      expect(byCode('142')).toMatchObject({ section: 'passif', parentId: null, hideLabel: true })
      expect(byCode('120')).toMatchObject({ parentId: byCode('142').id, balanceType: 'credit' })
    })

    it('answers 404 for a private template of another company or a missing one', async () => {
      const foreign = await prisma.balanceSheetConfigTemplate.create({
        data: { name: 'Privé', reportVariant: 'simplified', companyId: ids.other, configData: { companyId: ids.other, reportVariant: 'simplified', lines: [] } },
      })
      await expect(applyBalanceSheetTemplate(foreign.id, ids.company)).rejects.toMatchObject({ name: 'NotFoundError', message: 'Modèle introuvable' })
      await expect(applyBalanceSheetTemplate('missing', ids.company)).rejects.toThrow('Modèle introuvable')
    })
  })

  describe('PCG default layouts', () => {
    it('creates the simplified layout of form 2033-A: every entry, sections inherited, columns of the actif', async () => {
      const created = await createDefaultBalanceSheetConfig(ids.company, 'simplified')
      expect(created.lines.map((l) => l.lineLabel)).toEqual(SIMPLIFIED_BALANCE_SHEET_CONFIG_2026.map((e) => e.lineLabel))
      const rows = await prisma.balanceSheetLineConfig.findMany({ where: { companyId: ids.company, reportVariant: 'simplified' } })
      expect(rows).toHaveLength(countEntries(SIMPLIFIED_BALANCE_SHEET_CONFIG_2026))
      const byCode = (formCode: string) => rows.find((r) => r.formCode === formCode)
      // 2033-A: 084 Disponibilités (actif, net only), 028 Immobilisations corporelles (brut, amortissements, net), 120 Capital (passif).
      expect(byCode('084')).toMatchObject({ section: 'actif', lineType: 'line', displayType: 'net', accountCodes: ['51', '53', '54'] })
      expect(byCode('028')).toMatchObject({ section: 'actif', displayType: 'brut_amort_net', amortissementAccountCodes: ['281', '282', '291', '292', '293', '28', '29'] })
      expect(byCode('120')).toMatchObject({ section: 'passif', balanceType: 'credit', accountCodes: ['101', '104', '108', '10'] })
      expect(byCode('142')).toMatchObject({ section: 'passif', parentId: null })
      expect(rows.every((r) => r.version === 1 && r.isActive && r.templateId === null)).toBe(true)
    })

    it('creates the complete layout of forms 2050 and 2051', async () => {
      await createDefaultBalanceSheetConfig(ids.company)
      const rows = await prisma.balanceSheetLineConfig.findMany({ where: { companyId: ids.company, reportVariant: 'complete' } })
      expect(rows).toHaveLength(countEntries(COMPLETE_BALANCE_SHEET_CONFIG_2026))
      // 2050: CF/CG Disponibilités; 2051: DA Capital, DI Résultat de l'exercice.
      expect(rows.find((r) => r.formCode === 'CF')).toMatchObject({ section: 'actif', amortissementFormCode: 'CG' })
      expect(rows.find((r) => r.formCode === 'DA')).toMatchObject({ section: 'passif', accountCodes: ['101', '108', '10'] })
      expect(rows.find((r) => r.formCode === 'DI')).toMatchObject({ section: 'passif', accountCodes: ['12'] })
    })

    it('returns the stored layout instead of creating a second one', async () => {
      const first = await getOrCreateDefaultBalanceSheetConfig(ids.company, 'simplified')
      const count = await prisma.balanceSheetLineConfig.count()
      expect(count).toBe(countEntries(SIMPLIFIED_BALANCE_SHEET_CONFIG_2026))
      const second = await getOrCreateDefaultBalanceSheetConfig(ids.company, 'simplified')
      expect(await prisma.balanceSheetLineConfig.count()).toBe(count)
      expect(second.lines.map((l) => l.id)).toEqual(first.lines.map((l) => l.id))
      expect(second.lines.every((l) => !l.parentId)).toBe(true)
    })
  })
})
