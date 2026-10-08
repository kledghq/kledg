#!/usr/bin/env tsx
/**
 * Moves the receipt files that are not on the configured storage driver
 * (typically the database bytes kept before object storage existed) to it,
 * checking each file's SHA-256 before and after the move
 * (lib/receipts/migrate-receipt-storage.service.ts,
 * docs/configuration.md#stockage-des-justificatifs).
 *
 *   pnpm receipts:migrate-storage            move everything
 *   pnpm receipts:migrate-storage --dry-run  count what would move
 *   pnpm receipts:migrate-storage --company <id> --limit 100
 *   pnpm receipts:migrate-storage --qonto    also hand the receipts of
 *     validated expense reports to Qonto (KLEDG_QONTO_EXPENSE_RECEIPTS=
 *     supplier_invoices, companies connected to Qonto; docs/justificatifs-photo.md)
 *
 * Uses the instance's own environment: DATABASE_URL (the owner role, or the
 * application role with KLEDG_RLS=enforce) and the storage variables
 * (BLOB_READ_WRITE_TOKEN, KLEDG_S3_*, KLEDG_STORAGE_DIR or
 * KLEDG_STORAGE_DRIVER). Idempotent and resumable: run it again after an
 * interruption. Exit code 1 when files were left in place (unreadable,
 * not matching their SHA-256, or a storage error), 0 otherwise.
 */

import 'dotenv/config'
import { migrateReceiptStorage, offloadAllExpenseReceiptsToQonto } from '@/lib/receipts/migrate-receipt-storage.service'
import { prisma } from '@/lib/prisma'

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const limit = option('limit')
  const result = await migrateReceiptStorage({
    dryRun,
    companyId: option('company'),
    limit: limit ? Number.parseInt(limit, 10) : undefined,
    onProgress: (line) => console.log(line),
  })
  if (dryRun) {
    console.log(`Target storage: ${result.target}. Files to move: ${result.pending}.`)
    return 0
  }
  console.log(`Target storage: ${result.target}. Moved: ${result.moved} of ${result.pending}.`)
  if (result.invalid.length) console.error(`Unreadable or not matching their SHA-256 (left in place): ${result.invalid.join(', ')}`)
  if (result.failed.length) console.error(`Not moved because of a storage error (run again): ${result.failed.join(', ')}`)
  if (process.argv.includes('--qonto')) {
    const qonto = await offloadAllExpenseReceiptsToQonto()
    if (!qonto.enabled) console.error('KLEDG_QONTO_EXPENSE_RECEIPTS is not supplier_invoices: no receipt handed to Qonto.')
    else console.log(`Qonto: ${qonto.sent} expense receipts stored at Qonto, ${qonto.kept} kept by Kledg (refused, not readable yet, or a different file served).`)
  }
  return result.invalid.length || result.failed.length ? 1 : 0
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
