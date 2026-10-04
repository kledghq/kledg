/**
 * Serializes the writes that replace or create a whole statement layout of a
 * company and variant: the first report creating the default layout, the
 * automatic upgrade of an untouched previous default and the reset to the
 * default. Without it two reports computed at once (a N vs N-1 comparison,
 * two users) both find no layout and both create one, and every line exists
 * twice.
 */

import type { Prisma } from '@prisma/client'

export type LayoutKind = 'balance-sheet' | 'income-statement'

/** Transaction options of the layout writes: the complete layouts are created row by row. */
export const LAYOUT_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 60_000 } as const

/** Takes the lock of a layout until the end of the transaction. Lock first, then read the layout. */
export async function lockLayout(
  tx: Prisma.TransactionClient,
  companyId: string,
  kind: LayoutKind,
  variant: 'complete' | 'simplified'
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`kledg:layout:${companyId}:${kind}:${variant}`}))`
}
