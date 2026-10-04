/**
 * Journals of a company: list, rename, recode and delete. Codes are unique
 * per company; a journal that holds entries is never deleted (the entries
 * would lose their journal: every entry is recorded in a journal). Creation
 * is create-journal.service.ts, shared with the MCP tools.
 */

import { prisma } from '@/lib/prisma'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { isValidJournalCode, normalizeJournalCode } from '@/lib/shared/helpers'
import { JOURNAL_CODE_MESSAGE } from '@/lib/accounting/create-journal.service'

export const JOURNAL_NOT_FOUND = 'Journal introuvable'

/**
 * Journals of the company by code. Read only: the default journals are
 * created once, with the company (ensureDefaultJournals,
 * lib/accounting/default-journals.ts). The list used to upsert its own,
 * different set (VT, CA) on every read, so a company created by the wizard
 * showed 7 journals instead of 5, VE and VT both named "Ventes".
 */
export async function listJournals(companyId: string) {
  return prisma.journal.findMany({
    where: { companyId },
    select: { id: true, code: true, label: true, companyId: true, createdAt: true, updatedAt: true },
    orderBy: { code: 'asc' },
  })
}

async function ownedJournal(companyId: string, id: string) {
  const journal = await prisma.journal.findFirst({ where: { id, companyId } })
  if (!journal) throw new NotFoundError(JOURNAL_NOT_FOUND)
  return journal
}

export interface UpdateJournalInput {
  code?: string
  label?: string
}

/** Changes the code or the label of a journal of the company. */
export async function updateJournal(companyId: string, id: string, input: UpdateJournalInput) {
  const data: { code?: string; label?: string } = {}
  if (input.code !== undefined) {
    const code = normalizeJournalCode(input.code)
    if (!code) throw new ValidationError('Le code est requis')
    if (!isValidJournalCode(code)) throw new ValidationError(JOURNAL_CODE_MESSAGE)
    data.code = code
  }
  if (input.label !== undefined) {
    const label = input.label.trim()
    if (!label) throw new ValidationError('Le libellé est requis')
    if (label.length > 255) throw new ValidationError('Le libellé ne doit pas dépasser 255 caractères')
    data.label = label
  }

  const journal = await ownedJournal(companyId, id)
  if (data.code && data.code !== journal.code) {
    const existing = await prisma.journal.findUnique({ where: { companyId_code: { companyId, code: data.code } }, select: { id: true } })
    if (existing) throw new ConflictError(`Un journal avec le code ${data.code} existe déjà pour cette société`)
  }
  // Ownership checked above
  return prisma.journal.update({ where: { id: journal.id }, data })
}

/** Deletes a journal of the company that holds no entry (409 otherwise). */
export async function deleteJournal(companyId: string, id: string): Promise<void> {
  const journal = await prisma.journal.findFirst({
    where: { id, companyId },
    select: { id: true, _count: { select: { accountingEntries: true } } },
  })
  if (!journal) throw new NotFoundError(JOURNAL_NOT_FOUND)
  if (journal._count.accountingEntries > 0) {
    throw new ConflictError(
      "Impossible de supprimer ce journal : des écritures comptables y sont liées. Supprimez d'abord les écritures ou réaffectez-les à un autre journal.",
    )
  }
  await prisma.journal.deleteMany({ where: { id: journal.id, companyId } })
}
