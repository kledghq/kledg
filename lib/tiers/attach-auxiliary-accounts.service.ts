/**
 * Migration helper: creates the tiers of the auxiliary account numbers the
 * books already use (FEC CompAuxNum on 40 and 41 lines, imported from a FEC
 * or typed in entries), so that lettering, the auxiliary balance and the
 * aged balance show tiers names.
 *
 * Invariant: posted lines are never changed. A tiers is attached to lines by
 * its auxiliary account number alone, so a number already used by a tiers is
 * attached as it is, and a new tiers takes the number and the label found on
 * the lines. Idempotent: running it again creates nothing for numbers that
 * already have a tiers. A number found on both customer (41) and supplier
 * (40) lines is reported, never guessed.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { writeAuditLog } from '@/lib/audit'
import { auxiliaryNumberError, normalizeAuxiliaryNumber } from './rules'

export interface AttachResult {
  created: number
  alreadyAttached: number
  /** Numbers that cannot become a tiers, with the French reason. */
  skipped: Array<{ auxiliaryAccountNumber: string; reason: string }>
}

const MAX_NUMBERS = 5000

export async function attachAuxiliaryAccounts(companyId: string): Promise<AttachResult> {
  const result = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`kledg:tiers:${companyId}`}))`
      const rows = await tx.$queryRaw<Array<{ aux: string; label: string | null; customer: boolean; supplier: boolean }>>`
        SELECT l."auxiliaryAccountNumber" AS aux,
               MAX(l."auxiliaryAccountLabel") AS label,
               BOOL_OR(a."code" LIKE '41%') AS customer,
               BOOL_OR(a."code" LIKE '40%') AS supplier
        FROM "entry_lines" l
        JOIN "accounts" a ON a."id" = l."accountId"
        JOIN "accounting_entries" e ON e."id" = l."accountingEntryId"
        WHERE e."companyId" = ${companyId}
          AND l."auxiliaryAccountNumber" IS NOT NULL
          AND btrim(l."auxiliaryAccountNumber") <> ''
          AND (a."code" LIKE '40%' OR a."code" LIKE '41%')
        GROUP BY l."auxiliaryAccountNumber"
        ORDER BY l."auxiliaryAccountNumber"
        LIMIT ${MAX_NUMBERS}`
      const existing = await tx.tiers.findMany({ where: { companyId }, select: { auxiliaryAccountNumber: true } })
      const known = new Set(existing.map((t) => t.auxiliaryAccountNumber))
      const skipped: AttachResult['skipped'] = []
      const toCreate: Prisma.TiersCreateManyInput[] = []
      let alreadyAttached = 0
      for (const row of rows) {
        const aux = normalizeAuxiliaryNumber(row.aux)
        if (known.has(aux)) {
          alreadyAttached += 1
          continue
        }
        if (aux !== row.aux.trim()) {
          skipped.push({ auxiliaryAccountNumber: row.aux, reason: 'Le numéro est en minuscules sur les écritures : créez le tiers à la main avec le même numéro.' })
          continue
        }
        const invalid = auxiliaryNumberError(aux)
        if (invalid) {
          skipped.push({ auxiliaryAccountNumber: row.aux, reason: invalid })
          continue
        }
        if (row.customer && row.supplier) {
          skipped.push({
            auxiliaryAccountNumber: aux,
            reason: 'Ce numéro figure à la fois sur des comptes clients (41) et fournisseurs (40) : créez le tiers à la main.',
          })
          continue
        }
        known.add(aux)
        toCreate.push({
          companyId,
          kind: row.customer ? 'CUSTOMER' : 'SUPPLIER',
          name: row.label?.trim() || aux,
          auxiliaryAccountNumber: aux,
        })
      }
      if (toCreate.length > 0) await tx.tiers.createMany({ data: toCreate })
      return { created: toCreate.length, alreadyAttached, skipped }
    },
    { maxWait: 10_000, timeout: 60_000 },
  )
  if (result.created > 0) {
    await writeAuditLog('info', `Tiers created from auxiliary accounts: ${result.created}`, {
      action: 'ATTACH_AUXILIARY_ACCOUNTS',
      companyId,
      metadata: { created: result.created, alreadyAttached: result.alreadyAttached, skipped: result.skipped.length },
    })
  }
  return result
}
