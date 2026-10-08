/**
 * Deletion of accounts. An account goes with its sub-accounts, and only
 * when none of them is a PCG account and none holds an entry line: entries
 * are never left without their account, and the PCG nomenclature of the
 * chart stays complete.
 *
 * The sub-account tree is loaded level by level (one query per depth, not
 * per account) and the entry lines are counted in one query.
 */

import { prisma } from '@/lib/prisma'
import { ConflictError, NotFoundError } from '@/lib/accounting/errors'
import { logger } from '@/lib/logger'
import { ACCOUNT_NOT_FOUND, targetChartFiscalYearId } from '@/lib/accounting/manage-accounts.service'
import { plural, pluralWord } from '@/lib/utils/plural'

type Db = Pick<typeof prisma, 'account' | 'entryLine'>

interface Node {
  id: string
  code: string
  label: string
  isPCG: boolean
  children: string[]
}

/** Accounts deeper than this are not followed: a chart has 8 digit numbers at most. */
const MAX_DEPTH = 32

const NODE_SELECT = { id: true, code: true, label: true, isPCG: true, parentId: true } as const

/**
 * The given accounts of the company and all their sub-accounts, by id, with
 * their children in number order. Ids of other companies are left out.
 */
async function loadTrees(db: Db, companyId: string, rootIds: string[]): Promise<Map<string, Node>> {
  const nodes = new Map<string, Node>()
  const roots = await db.account.findMany({ where: { id: { in: rootIds }, companyId }, select: NODE_SELECT })
  for (const row of roots) nodes.set(row.id, { id: row.id, code: row.code, label: row.label, isPCG: row.isPCG, children: [] })

  let frontier = roots.map((r) => r.id)
  for (let depth = 0; frontier.length > 0 && depth < MAX_DEPTH; depth++) {
    const children = await db.account.findMany({
      where: { companyId, parentId: { in: frontier } },
      select: NODE_SELECT,
      orderBy: { code: 'asc' },
    })
    const next: string[] = []
    for (const child of children) {
      nodes.get(child.parentId!)?.children.push(child.id)
      if (nodes.has(child.id)) continue // already reached (a cycle in the data)
      nodes.set(child.id, { id: child.id, code: child.code, label: child.label, isPCG: child.isPCG, children: [] })
      next.push(child.id)
    }
    frontier = next
  }
  return nodes
}

/** Ids of accounts that have at least one entry line. */
async function accountsWithLines(db: Db, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const groups = await db.entryLine.groupBy({ by: ['accountId'], where: { accountId: { in: ids } }, _count: { _all: true } })
  return new Set(groups.filter((g) => g._count._all > 0).map((g) => g.accountId))
}

/** All ids of a subtree, root first. */
function subtreeIds(nodes: Map<string, Node>, rootId: string, keep: (node: Node) => boolean = () => true): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  const visit = (id: string) => {
    const node = nodes.get(id)
    if (!node || seen.has(id) || !keep(node)) return
    seen.add(id)
    ids.push(id)
    node.children.forEach(visit)
  }
  visit(rootId)
  return ids
}

/** Why an account and its sub-accounts can't be deleted, in French, or null. */
function blockingReason(nodes: Map<string, Node>, withLines: Set<string>, id: string, seen = new Set<string>()): string | null {
  const node = nodes.get(id)
  if (!node) return ACCOUNT_NOT_FOUND
  if (node.isPCG) return 'Impossible de supprimer un compte du PCG'
  if (withLines.has(id)) return 'Le compte contient des écritures'
  seen.add(id)
  for (const childId of node.children) {
    const child = nodes.get(childId)
    if (!child || seen.has(childId)) continue
    if (child.isPCG) {
      logger.warn('Account deletion refused: PCG sub-account', { accountId: id, childId })
      return `Le compte enfant ${child.code} est un compte du PCG et ne peut pas être supprimé`
    }
    const reason = blockingReason(nodes, withLines, childId, seen)
    if (reason) return `Le compte enfant ${child.code} ne peut pas être supprimé : ${reason}`
  }
  return null
}

/**
 * Deletes an account of the company and its sub-accounts. Refused (409)
 * for a PCG account, or when the account or a sub-account is a PCG account
 * or holds entry lines. Returns the deleted account.
 */
export async function deleteAccount(companyId: string, id: string): Promise<{ id: string; code: string; label: string }> {
  return prisma.$transaction(async (tx) => {
    const account = await tx.account.findFirst({ where: { id, companyId }, select: { id: true, code: true, label: true, isPCG: true } })
    if (!account) throw new NotFoundError(ACCOUNT_NOT_FOUND)
    if (account.isPCG) {
      logger.warn('Account deletion refused: PCG account', { accountId: id, code: account.code })
      throw new ConflictError('Impossible de supprimer un compte du PCG')
    }

    const nodes = await loadTrees(tx, companyId, [account.id])
    const ids = subtreeIds(nodes, account.id)
    const reason = blockingReason(nodes, await accountsWithLines(tx, ids), account.id)
    if (reason) throw new ConflictError(reason)

    // One statement: children and parent go together (the parent link is ON DELETE SET NULL)
    await tx.account.deleteMany({ where: { id: { in: ids }, companyId, isPCG: false } })
    return { id: account.id, code: account.code, label: account.label }
  })
}

/**
 * Deletes the accounts of a fiscal year chart (the active one by default)
 * that are not PCG accounts, with their non PCG sub-accounts. Refused (409,
 * `accountsWithEntries` lists them) when one of them, or one of their non
 * PCG sub-accounts, holds entry lines: nothing is deleted then.
 */
export async function deleteNonPcgAccounts(companyId: string, fiscalYearId?: string | null): Promise<{ deletedCount: number; message: string }> {
  const targetFiscalYearId = await targetChartFiscalYearId(companyId, fiscalYearId)

  const accounts = await prisma.account.findMany({
    where: { companyId, fiscalYearId: targetFiscalYearId, isPCG: false },
    select: { id: true, code: true, label: true },
  })
  if (accounts.length === 0) return { deletedCount: 0, message: 'Aucun compte inconnu au PCG à supprimer' }

  const nodes = await loadTrees(prisma, companyId, accounts.map((a) => a.id))
  const nonPcg = (node: Node) => !node.isPCG
  const withLines = await accountsWithLines(prisma, [...nodes.keys()])

  const accountsWithEntries = accounts
    .filter((account) => subtreeIds(nodes, account.id, nonPcg).some((id) => withLines.has(id)))
    .map((account) => `${account.code} - ${account.label}`)
  if (accountsWithEntries.length > 0) {
    throw new ConflictError('Certains comptes contiennent des écritures et ne peuvent pas être supprimés').withDetails({
      accountsWithEntries,
    })
  }

  // Each account with its non PCG sub-accounts; a failure (an account still
  // used by a fixed asset, for instance) skips that account and goes on.
  let deletedCount = 0
  for (const account of accounts) {
    try {
      await prisma.account.deleteMany({ where: { id: { in: subtreeIds(nodes, account.id, nonPcg) }, companyId, isPCG: false } })
      deletedCount++
    } catch (error) {
      logger.warn('Non PCG account not deleted', { accountId: account.id, error })
    }
  }

  return { deletedCount, message: `${plural(deletedCount, 'compte inconnu', 'comptes inconnus')} au PCG ${pluralWord(deletedCount, 'supprimé', 'supprimés')}` }
}
