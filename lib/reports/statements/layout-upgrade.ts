/**
 * Keeps companies on the current default statement layouts.
 *
 * Layouts are stored per company when first used. When the default layouts
 * change (as when every PCG account got a line), a company whose stored
 * layout is a previous default, untouched, is moved to the current default
 * automatically; a company that changed its layout keeps it and is offered a
 * one-click reset (POST .../config/default).
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createDefaultBalanceSheetConfig } from '../balance-sheet/config/create-default-pcg-config.service'
import { createDefaultIncomeStatementConfig } from '../income-statement/config/create-default-pcg-config.service'
import { defaultBalanceSheetRules, defaultIncomeStatementRules } from './default-rules'
import { layoutFingerprint, type LayoutRow } from './layout-fingerprint'

export type LayoutKind = 'balance-sheet' | 'income-statement'
type Variant = 'complete' | 'simplified'

/**
 * - default: the current default layout;
 * - upgraded: was a previous default, replaced by the current one now;
 * - customized: changed by the user, differs from the current default;
 * - empty: no layout stored yet.
 */
export type LayoutStatus = 'default' | 'upgraded' | 'customized' | 'empty'

/**
 * Fingerprints of the default layouts shipped before, as stored by
 * createDefault*Config (computed from the layout files of commit 95563d8,
 * and with 646 added to "Cotisations sociales" as an earlier seed script did).
 */
export const PREVIOUS_DEFAULT_FINGERPRINTS: Record<`${LayoutKind}:${Variant}`, string[]> = {
  'balance-sheet:complete': ['aa58fe882a6784e88c4ee811a3736b444c27defc6600cdbf8c40c2829516913d'],
  'balance-sheet:simplified': ['ece058d7363fcc40536afc4271a1d276ffcd6825d8c789c74f3062b6446719e6'],
  'income-statement:complete': [
    'b6e892a28f50f9a7e91f64381ae481cde5cd13c1fdbdbc2cd45ac476a999baf6',
    '6c15742fca73af316c14398e93f6a7c2bbfce6372baf1656b2810fafd42a457e',
  ],
  'income-statement:simplified': [
    '8f09885cbf64c3b8aee6715f540dc19c7f9d3a6e525087b4b2eb782731852f9b',
    '7da2e7a28e32d5f5f10f49a86f7bb7eae097c1b72dc01a1d2ecf654c7cbb2409',
  ],
}

const currentFingerprints = new Map<string, string>()

/** Fingerprint of the current default layout. */
export function currentDefaultFingerprint(kind: LayoutKind, variant: Variant): string {
  const key = `${kind}:${variant}`
  if (!currentFingerprints.has(key)) {
    const rules = kind === 'balance-sheet' ? defaultBalanceSheetRules(variant) : defaultIncomeStatementRules(variant)
    currentFingerprints.set(key, layoutFingerprint(rules))
  }
  return currentFingerprints.get(key)!
}

type Db = Prisma.TransactionClient | typeof prisma

async function storedRows(db: Db, kind: LayoutKind, companyId: string, variant: Variant): Promise<LayoutRow[]> {
  const where = { companyId, reportVariant: variant, isActive: true }
  return kind === 'balance-sheet'
    ? db.balanceSheetLineConfig.findMany({ where })
    : db.incomeStatementLineConfig.findMany({ where })
}

export function classifyLayout(
  kind: LayoutKind,
  variant: Variant,
  rows: LayoutRow[]
): 'default' | 'previous-default' | 'customized' | 'empty' {
  if (rows.length === 0) return 'empty'
  const fingerprint = layoutFingerprint(rows)
  if (fingerprint === currentDefaultFingerprint(kind, variant)) return 'default'
  if (PREVIOUS_DEFAULT_FINGERPRINTS[`${kind}:${variant}`].includes(fingerprint)) return 'previous-default'
  return 'customized'
}

/**
 * Moves an untouched previous default layout to the current default, in one
 * transaction serialized per company and layout. Returns the layout status.
 */
export async function upgradeLayoutIfUntouched(
  companyId: string,
  kind: LayoutKind,
  variant: Variant
): Promise<LayoutStatus> {
  const status = classifyLayout(kind, variant, await storedRows(prisma, kind, companyId, variant))
  if (status !== 'previous-default') return status
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`kledg:layout:${companyId}:${kind}:${variant}`}))`
      const again = classifyLayout(kind, variant, await storedRows(tx, kind, companyId, variant))
      // Another request upgraded it meanwhile.
      if (again !== 'previous-default') return again === 'default' ? 'upgraded' : again
      if (kind === 'balance-sheet') {
        await tx.balanceSheetLineConfig.deleteMany({ where: { companyId, reportVariant: variant } })
        await createDefaultBalanceSheetConfig(companyId, variant, tx)
      } else {
        await tx.incomeStatementLineConfig.deleteMany({ where: { companyId, reportVariant: variant } })
        await createDefaultIncomeStatementConfig(companyId, variant, tx)
      }
      return 'upgraded'
    },
    { maxWait: 10_000, timeout: 60_000 }
  )
}
