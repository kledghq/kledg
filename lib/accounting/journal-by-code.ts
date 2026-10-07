/**
 * A journal of the company by its code, the same way everywhere
 * (KLEDG-R3-QUAL-25):
 *
 * - the code is compared without case and surrounding spaces ("bq", " BQ"
 *   and "BQ" are the same journal); when the company holds several spellings
 *   (a FEC import can bring "bq" next to "BQ"), the exact spelling wins, then
 *   the upper case one;
 * - a journal Kledg posts to on its own (OD for closing and tax drafts, BQ
 *   for simple mode, VE and AC for invoices, AN, CL) is created when
 *   missing, in upper case with its standard label (`create`, used by
 *   `ensureJournal`); a code typed by a user or an assistant is only looked
 *   up, and the caller refuses with its own French message.
 */

import type { Prisma } from '@prisma/client'

type JournalClient = Pick<Prisma.TransactionClient, 'journal'>

export interface JournalRef {
  id: string
  code: string
  label: string
}

const SELECT = { id: true, code: true, label: true } as const

/** The canonical spelling of a journal code: trimmed, upper case. */
export function normalizeJournalCode(code: string): string {
  return code.trim().toUpperCase()
}

export async function journalByCode(db: JournalClient, companyId: string, code: string): Promise<JournalRef | null>
export async function journalByCode(db: JournalClient, companyId: string, code: string, options: { create: { label: string } }): Promise<JournalRef>
export async function journalByCode(
  db: JournalClient,
  companyId: string,
  code: string,
  options: { create?: { label: string } } = {},
): Promise<JournalRef | null> {
  const wanted = code.trim()
  if (wanted) {
    const rows = await db.journal.findMany({
      where: { companyId, code: { equals: wanted, mode: 'insensitive' } },
      select: SELECT,
      orderBy: { code: 'asc' },
      take: 10,
    })
    const found = rows.find((j) => j.code === wanted) ?? rows.find((j) => j.code === normalizeJournalCode(wanted)) ?? rows[0]
    if (found) return found
  }
  if (!options.create || !wanted) return null
  const canonical = normalizeJournalCode(wanted)
  return db.journal.upsert({
    where: { companyId_code: { companyId, code: canonical } },
    update: {},
    create: { companyId, code: canonical, label: options.create.label },
    select: SELECT,
  })
}
