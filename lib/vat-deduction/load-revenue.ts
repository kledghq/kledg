/**
 * The revenue of a company between two days, by class 7 account, as the
 * coefficient de taxation reads it (lib/vat-deduction/revenue.ts): the
 * total, the part in entries that collect VAT, and the lines of sales
 * invoices marked exempt. Validated entries only; opening (AN) and closing
 * (CL) entries carry balances, not operations, and are left out.
 *
 * Two bounded queries scoped by the company; amounts in cents.
 */

import { prisma } from '@/lib/prisma'
import { parseCents } from '@/lib/utils/money'
import type { RevenueAccountRow } from './revenue'

/** Invoices with exempt lines read for one period at most. */
const MAX_EXEMPT_INVOICES = 5_000

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const cents = (value: { toString(): string }) => parseCents(value.toString()) ?? 0

/** Collected VAT due or pending (4457, 44574 included), not the taxes assimilées of 44578. */
export const isCollectedVatCode = (code: string) => code.startsWith('4457') && !code.startsWith('44578')

/** The ledger code an invoice line posted to: the first revenue line of the entry under its root (lib/invoices/ledger-accounts.ts). */
function ledgerCodeOf(root: string, entryCodes: readonly string[]): string {
  return entryCodes.find((code) => code.startsWith(root)) ?? root
}

export async function loadRevenueRows(companyId: string, from: string, to: string): Promise<RevenueAccountRow[]> {
  const [totals, invoices] = await Promise.all([
    prisma.$queryRaw<Array<{ code: string; label: string; total: bigint; with_vat: bigint }>>`
      WITH vat_entries AS (
        SELECT DISTINCT l2."accountingEntryId" AS id
        FROM "entry_lines" l2
        JOIN "accounting_entries" e2 ON e2."id" = l2."accountingEntryId"
        JOIN "accounts" a2 ON a2."id" = l2."accountId"
        WHERE e2."companyId" = ${companyId} AND e2."status" = 'validated' AND e2."date" >= ${utc(from)} AND e2."date" <= ${utc(to)}
          AND a2."code" LIKE '4457%' AND a2."code" NOT LIKE '44578%'
      )
      SELECT a."code" AS code, max(a."label") AS label,
        round(sum(l."credit" - l."debit") * 100)::bigint AS total,
        round(sum(CASE WHEN v."id" IS NOT NULL THEN l."credit" - l."debit" ELSE 0 END) * 100)::bigint AS with_vat
      FROM "entry_lines" l
      JOIN "accounting_entries" e ON e."id" = l."accountingEntryId"
      JOIN "journals" j ON j."id" = e."journalId"
      JOIN "accounts" a ON a."id" = l."accountId"
      LEFT JOIN vat_entries v ON v."id" = e."id"
      WHERE e."companyId" = ${companyId} AND e."status" = 'validated' AND e."date" >= ${utc(from)} AND e."date" <= ${utc(to)}
        AND a."code" LIKE '7%' AND j."code" NOT IN ('AN', 'CL') AND coalesce(e."reference", '') NOT LIKE 'CL-%'
      GROUP BY a."code"
      ORDER BY a."code"
    `,
    prisma.invoice.findMany({
      where: {
        companyId,
        direction: 'SALE',
        lines: { some: { vatExemption: { not: null } } },
        entry: { status: 'validated', date: { gte: utc(from), lte: utc(to) } },
      },
      select: {
        typeCode: true,
        lines: { where: { vatExemption: { not: null } }, select: { accountCode: true, nature: true, totalExclTax: true } },
        entry: { select: { lines: { select: { account: { select: { code: true } } } } } },
      },
      take: MAX_EXEMPT_INVOICES,
    }),
  ])

  const exempt = new Map<string, { all: number; inVatEntries: number }>()
  for (const invoice of invoices) {
    const sign = invoice.typeCode === '381' ? -1 : 1
    const entryCodes = (invoice.entry?.lines ?? []).map((l) => l.account.code)
    const withVat = entryCodes.some(isCollectedVatCode)
    const revenueCodes = entryCodes.filter((code) => code.startsWith('7'))
    for (const line of invoice.lines) {
      const root = line.accountCode ?? (line.nature === 'GOODS' ? '707' : '706')
      const code = ledgerCodeOf(root, revenueCodes)
      const current = exempt.get(code) ?? { all: 0, inVatEntries: 0 }
      const amount = sign * cents(line.totalExclTax)
      current.all += amount
      if (withVat) current.inVatEntries += amount
      exempt.set(code, current)
    }
  }

  return totals.map((row) => ({
    code: row.code,
    label: row.label,
    totalCents: Number(row.total),
    withVatCents: Number(row.with_vat),
    exemptInvoiceCents: exempt.get(row.code)?.all ?? 0,
    exemptInVatEntriesCents: exempt.get(row.code)?.inVatEntries ?? 0,
  }))
}
