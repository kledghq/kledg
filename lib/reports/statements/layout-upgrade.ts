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
import { LAYOUT_TRANSACTION_OPTIONS, lockLayout, type LayoutKind } from './layout-lock'

export type { LayoutKind }
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
  'balance-sheet:complete': [
    'aa58fe882a6784e88c4ee811a3736b444c27defc6600cdbf8c40c2829516913d',
    // Before the mapping review of October 2026 (droit au bail, comptes 45 and 426, 2974 to 2976, DM, ED, EK)
    'ac77570680f263e506a77e56d5980d43e43145b4797b642e6754c3d1cf54820c',
    // First version of that review (1062 with the réserves statutaires)
    '29e3c7f28e4d3a3bcc3e25e3c096672b138fd449835139501e76ab15fce18183',
  ],
  'balance-sheet:simplified': [
    'ece058d7363fcc40536afc4271a1d276ffcd6825d8c789c74f3062b6446719e6',
    // Before the October 2026 review: lines without a box on the 2033-A (109, 201, 093, 122, 141, 177)
    '81fefe5b174e449ffd27f2407507231a74c7aa0dafc2db538d1608618be675e4',
    // First version of that review (1062 in autres réserves, 426 in dettes fiscales et sociales)
    '27cc540e40e6e5792453d5e1cfed9e0832813bb4121dbafb8f700dfca235bfe1',
  ],
  'income-statement:complete': [
    'b6e892a28f50f9a7e91f64381ae481cde5cd13c1fdbdbc2cd45ac476a999baf6',
    '6c15742fca73af316c14398e93f6a7c2bbfce6372baf1656b2810fafd42a457e',
    // Before the October 2026 review: études (705) with the goods
    '78dd3de3c627ce391c12afee7ae4b2f4dc958c7497b27cae5b81d52503906afb',
    // First version of that review (704 always with the goods)
    '823bd7ffbba8a990345d164947a179bb3b1e103c41e2a42a27ef91c7e97b6355',
  ],
  'income-statement:simplified': [
    '8f09885cbf64c3b8aee6715f540dc19c7f9d3a6e525087b4b2eb782731852f9b',
    '7da2e7a28e32d5f5f10f49a86f7bb7eae097c1b72dc01a1d2ecf654c7cbb2409',
    // Before the October 2026 review: two lines (209, 234) instead of the 2033-B lines 210 to 262
    'fd1b46c0cd571c806d4fb050b18b6dfa44684d70b9557ffa97a627bd3fc01f75',
    // First version of that review (655, 755, 691 on lines without a 2033-B box; 704 with the goods)
    '5fffbe6aa3f0cd49c786cb3b95b32a7acdb69c9ea10326a1eaa7553b802f26cf',
  ],
}

const currentFingerprints = new Map<string, string>()

/** Fingerprint of the current default layout (works with the goods: the construction variant of the income statement). */
function currentDefaultFingerprint(kind: LayoutKind, variant: Variant, worksAsGoods = false): string {
  const key = `${kind}:${variant}:${worksAsGoods}`
  if (!currentFingerprints.has(key)) {
    const rules = kind === 'balance-sheet' ? defaultBalanceSheetRules(variant) : defaultIncomeStatementRules(variant, worksAsGoods)
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
  if (kind === 'income-statement' && fingerprint === currentDefaultFingerprint(kind, variant, true)) return 'default'
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
      await lockLayout(tx, companyId, kind, variant)
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
    LAYOUT_TRANSACTION_OPTIONS
  )
}
