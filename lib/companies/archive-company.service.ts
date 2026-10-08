/**
 * Deleting and archiving a company. Instance administrators only (routes
 * app/api/companies/[id] and app/api/companies/[id]/archive).
 *
 * The books are kept 10 years (Code de commerce art. L123-22; validated
 * entries and closed years are definitive, PCG art. 1031-3 and 1031-4, as
 * renumbered by règlement ANC n° 2022-06): a company holding a validated entry or
 * a closed fiscal year is never deleted. The database refuses it too
 * (trigger of migration 20261011100000_company_archiving), for every code
 * path. Such a company is archived instead: read-only (every write of a
 * company route or an MCP tool answers 409), hidden from the lists, and
 * restorable by an instance administrator. Only an empty company (drafts
 * at most) can be deleted.
 *
 * Every deletion, archiving and restoration writes an audit entry, inside the
 * transaction of the change for a deletion (the row outlives the company:
 * its id, name and SIREN are in the metadata).
 */

import { prisma } from '@/lib/prisma'
import { COMPANY_HAS_BOOKS_MESSAGE, ConflictError, NotFoundError } from '@/lib/accounting/errors'
import { COMPANY_NOT_FOUND_MESSAGE } from '@/lib/rbac/authorize'
import { writeAuditLog } from '@/lib/audit'
import type { CurrentUser } from '@/lib/session'
import { companyWriteRefusal } from '@/lib/instance'
import { companyReceiptObjects, discardObjects } from '@/lib/receipts/receipt-file-store'

export const ARCHIVED_COMPANY_MESSAGE =
  "Cette société est archivée : elle est en lecture seule. Un administrateur de l'instance peut la restaurer depuis la page Sociétés."

/** Filter of the companies shown in lists: archived ones are left out. */
export const NOT_ARCHIVED = { archivedAt: null } as const

/**
 * Throws a 409 when the company is archived, or when the instance policy
 * makes it read-only (companyWriteRefusal, lib/instance/policy.ts; its link
 * goes in the details). Called on writes of company routes and MCP tools.
 * Fails closed: a company that does not exist or that the context cannot
 * see (row level security) is a 404, never writable.
 */
export async function assertCompanyWritable(companyId: string): Promise<void> {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { archivedAt: true } })
  if (!company) throw new NotFoundError(COMPANY_NOT_FOUND_MESSAGE)
  if (company.archivedAt) throw new ConflictError(ARCHIVED_COMPANY_MESSAGE)
  const refusal = await companyWriteRefusal(companyId)
  if (refusal) throw new ConflictError(refusal.message).withDetails(refusal.link ? { link: refusal.link } : {})
}

/** Whether the company holds books that must be kept: a validated entry or a closed fiscal year. */
export async function companyHasBooks(companyId: string, client: Pick<typeof prisma, 'accountingEntry' | 'fiscalYear'> = prisma): Promise<boolean> {
  const [validated, closed] = await Promise.all([
    client.accountingEntry.count({ where: { companyId, status: 'validated' } }),
    client.fiscalYear.count({ where: { companyId, OR: [{ isClosed: true }, { closedAt: { not: null } }] } }),
  ])
  return validated > 0 || closed > 0
}

const isBooksGuardError = (error: unknown) => error instanceof Error && error.message.includes('KLEDG_COMPANY_HAS_BOOKS')

/**
 * Deletes an empty company and all its data (onDelete: Cascade), then the
 * objects of its receipt files (lib/receipts/receipt-file-store.ts). Refused
 * (409) once the company holds books. Foreign keys to accounts, journals and
 * fiscal years are deferred to the end of the transaction (migration
 * 20261004100000), once the cascades are done.
 */
export async function deleteCompany(id: string, actor: Pick<CurrentUser, 'id' | 'email'>) {
  const company = await prisma.company.findUnique({ where: { id }, select: { id: true, name: true, siren: true } })
  if (!company) throw new NotFoundError(COMPANY_NOT_FOUND_MESSAGE)

  let objects: Awaited<ReturnType<typeof companyReceiptObjects>> = []
  try {
    await prisma.$transaction(async (tx) => {
      // Checked under the transaction; the database trigger closes the race with a concurrent validation.
      if (await companyHasBooks(id, tx)) throw new ConflictError(COMPANY_HAS_BOOKS_MESSAGE)
      // The receipt files go with the company (cascade); their objects in storage are deleted after the commit.
      objects = await companyReceiptObjects(id, tx)
      // createMany: no RETURNING (a row without company is not readable back under RLS).
      await tx.auditLog.createMany({
        data: {
          userId: actor.email || actor.id,
          action: 'COMPANY_DELETED',
          level: 'WARN',
          message: `Société supprimée : ${company.name}`,
          metadata: { companyId: company.id, name: company.name, siren: company.siren, actorId: actor.id },
        },
      })
      await tx.$executeRaw`SET CONSTRAINTS ALL DEFERRED`
      await tx.company.delete({ where: { id } })
    })
  } catch (error) {
    if (isBooksGuardError(error)) throw new ConflictError(COMPANY_HAS_BOOKS_MESSAGE)
    throw error
  }
  await discardObjects(objects)

  return { success: true, message: 'Société supprimée.' }
}

/** Archives a company (idempotent): read-only and hidden from the lists. */
export async function archiveCompany(id: string, actor: Pick<CurrentUser, 'id' | 'email'>) {
  const company = await prisma.company.findUnique({ where: { id }, select: { id: true, name: true, archivedAt: true } })
  if (!company) throw new NotFoundError(COMPANY_NOT_FOUND_MESSAGE)
  if (!company.archivedAt) {
    await prisma.company.update({ where: { id }, data: { archivedAt: new Date(), archivedById: actor.id } })
    await writeAuditLog('warn', `Société archivée : ${company.name}`, {
      action: 'COMPANY_ARCHIVED',
      companyId: id,
      metadata: { companyId: id, actorId: actor.id },
    })
  }
  return { success: true, message: 'Société archivée : elle est en lecture seule.' }
}

/** Restores an archived company (idempotent). */
export async function restoreCompany(id: string, actor: Pick<CurrentUser, 'id' | 'email'>) {
  const company = await prisma.company.findUnique({ where: { id }, select: { id: true, name: true, archivedAt: true } })
  if (!company) throw new NotFoundError(COMPANY_NOT_FOUND_MESSAGE)
  if (company.archivedAt) {
    await prisma.company.update({ where: { id }, data: { archivedAt: null, archivedById: null } })
    await writeAuditLog('info', `Société restaurée : ${company.name}`, {
      action: 'COMPANY_RESTORED',
      companyId: id,
      metadata: { companyId: id, actorId: actor.id, archivedAt: company.archivedAt.toISOString() },
    })
  }
  return { success: true, message: 'Société restaurée.' }
}

/** Archived companies, for the instance administrators' list (to restore them). */
export function listArchivedCompanies() {
  return prisma.company.findMany({
    where: { archivedAt: { not: null } },
    select: { id: true, name: true, slug: true, siren: true, archivedAt: true },
    orderBy: { name: 'asc' },
    take: 200,
  })
}
