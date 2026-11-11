/**
 * The default PCG 2026 income statement layouts of a company.
 *
 * Reading never writes: until the company stores a layout of a variant, the
 * default is built in memory (defaultIncomeStatementConfig), with the same
 * line ids the stored copy gets (defaultIncomeStatementLineId: derived from
 * the company, the variant and the place of the line in the default). The
 * layout is stored only by a write that needs it: a change of a line
 * (ensureIncomeStatementLayout, under the layout lock), the reset to the
 * default, the upgrade of an untouched previous default. A line id read
 * from the in-memory default therefore names the same line once stored.
 */

import { createHash } from 'crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { SIMPLIFIED_INCOME_STATEMENT_CONFIG_2026 } from './default-pcg-config-simplified-2026'
import { COMPLETE_INCOME_STATEMENT_CONFIG_2026, type DefaultIncomeStatementConfigEntry } from './default-pcg-config-complete-2026'
import { buildConfigTree } from '../../config/shared/config-tree'
import type { IncomeStatementConfig, IncomeStatementLineConfig } from '../types'
import { LAYOUT_TRANSACTION_OPTIONS, lockLayout } from '../../statements/layout-lock'
import { withWorksAsGoods, worksSoldAsGoods } from './works-as-goods'

type Variant = 'complete' | 'simplified'
type Client = Pick<Prisma.TransactionClient, 'incomeStatementLineConfig'>

/** Prefix of the ids of default lines, per variant (the variant is read back from an id). */
const DEFAULT_ID_PREFIX: Record<Variant, string> = { complete: 'pcgis_c_', simplified: 'pcgis_s_' }

/** Id of a line of the default layout: the same in memory and once stored. */
export function defaultIncomeStatementLineId(companyId: string, variant: Variant, path: string): string {
  return DEFAULT_ID_PREFIX[variant] + createHash('sha256').update(`${companyId}:${variant}:${path}`).digest('hex').slice(0, 24)
}

/** The variant of a default line id, null for any other id. */
export function variantOfDefaultLineId(lineId: string): Variant | null {
  if (lineId.startsWith(DEFAULT_ID_PREFIX.complete)) return 'complete'
  if (lineId.startsWith(DEFAULT_ID_PREFIX.simplified)) return 'simplified'
  return null
}

type DefaultRow = Omit<IncomeStatementLineConfig, 'children'>

/** The rows of the default layout of the variant, flat, parents first (nothing is written). */
export async function defaultIncomeStatementRows(companyId: string, reportVariant: Variant, now: Date = new Date(0)): Promise<DefaultRow[]> {
  // The 2026 default of the variant; the works (704) go with the goods for a
  // construction company (works-as-goods.ts)
  const base = reportVariant === 'complete' ? COMPLETE_INCOME_STATEMENT_CONFIG_2026 : SIMPLIFIED_INCOME_STATEMENT_CONFIG_2026
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { sector: true } })
  const entries = worksSoldAsGoods(company?.sector) ? withWorksAsGoods(base) : base

  const rows: DefaultRow[] = []
  const visit = (entry: DefaultIncomeStatementConfigEntry, path: string, parentId: string | null, parentSection: 'produits' | 'charges' | null) => {
    // Income statement lines have no stored type: sums are the lines with balanceType 'auto'.
    // The section is the entry's own, or its parent's.
    const section = entry.section || parentSection || null
    const id = defaultIncomeStatementLineId(companyId, reportVariant, path)
    rows.push({
      id,
      companyId,
      reportVariant: entry.reportVariant,
      parentId,
      section,
      lineLabel: entry.lineLabel,
      formCode: entry.formCode || null,
      accountCodes: entry.accountCodes || [],
      excludedAccountCodes: entry.excludedAccountCodes || [],
      filterType: entry.filterType || null,
      filterValue: null,
      balanceType: entry.balanceType || 'credit',
      hideLabel: false,
      order: entry.order,
      notes: entry.notes || null,
      version: 1,
      templateId: null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    entry.children?.forEach((child, i) => visit(child, `${path}.${i}`, id, section))
  }
  entries.forEach((entry, i) => visit(entry, String(i), null, entry.section ?? null))
  return rows
}

/** The default layout of the variant as a tree, built in memory (nothing is written). */
export async function defaultIncomeStatementConfig(companyId: string, reportVariant: Variant = 'complete'): Promise<IncomeStatementConfig> {
  const rows = await defaultIncomeStatementRows(companyId, reportVariant)
  return { companyId, reportVariant, lines: buildConfigTree(rows) as IncomeStatementLineConfig[], isDefault: true }
}

/** Stores the default layout of the variant (the caller deleted the previous one, or there is none). */
export async function createDefaultIncomeStatementConfig(
  companyId: string,
  reportVariant: Variant = 'complete',
  /** Pass a transaction client to create the layout inside a transaction. */
  client: Client = prisma
): Promise<IncomeStatementConfig> {
  const rows = await defaultIncomeStatementRows(companyId, reportVariant)
  // Parents first: each line references a line created before it.
  const created: IncomeStatementLineConfig[] = []
  for (const { createdAt: _createdAt, updatedAt: _updatedAt, ...row } of rows) {
    created.push((await client.incomeStatementLineConfig.create({ data: row })) as IncomeStatementLineConfig)
  }
  return { companyId, reportVariant, lines: buildConfigTree(created) as IncomeStatementLineConfig[] }
}

/**
 * Stores the default layout of the variant when the company has none yet,
 * under the layout lock (two writers store one layout, not one each). Every
 * change of a line calls it first: a line id read from the in-memory default
 * then names the stored line.
 */
export async function ensureIncomeStatementLayout(companyId: string, reportVariant: Variant): Promise<void> {
  const stored = await prisma.incomeStatementLineConfig.count({ where: { companyId, reportVariant, isActive: true } })
  if (stored > 0) return
  await prisma.$transaction(async (tx) => {
    await lockLayout(tx, companyId, 'income-statement', reportVariant)
    const rows = await tx.incomeStatementLineConfig.count({ where: { companyId, reportVariant, isActive: true } })
    if (rows > 0) return
    // Only deleted (inactive) lines remain: the default replaces them, its line ids included.
    await tx.incomeStatementLineConfig.deleteMany({ where: { companyId, reportVariant } })
    await createDefaultIncomeStatementConfig(companyId, reportVariant, tx)
  }, LAYOUT_TRANSACTION_OPTIONS)
}

/**
 * The stored layout of the variant, storing the default first when there is
 * none: a write path only (reports and the layout page read
 * getIncomeStatementConfig, which never writes).
 */
export async function getOrCreateDefaultIncomeStatementConfig(companyId: string, reportVariant: Variant = 'complete'): Promise<IncomeStatementConfig> {
  await ensureIncomeStatementLayout(companyId, reportVariant)
  const rows = await prisma.incomeStatementLineConfig.findMany({
    where: { companyId, reportVariant, isActive: true },
    orderBy: { order: 'asc' },
  })
  return { companyId, reportVariant, lines: buildConfigTree(rows) as IncomeStatementLineConfig[] }
}
