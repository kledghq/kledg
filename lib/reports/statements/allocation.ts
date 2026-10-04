/**
 * Allocation of account balances to the lines of the annual statements.
 *
 * Every account with a balance goes to exactly one line (and one column),
 * so nothing is counted twice and nothing is silently dropped:
 *
 * - A line takes the accounts whose code starts with one of its account
 *   codes, minus its excluded codes. When several lines match, the most
 *   specific code wins (longest prefix): "4091" beats "409" beats "40".
 * - Balance sheet: a balance goes to a line of its sign first, as the
 *   official models require ("comptes ... (D) / (C)": soldes débiteurs à
 *   l'actif, soldes créditeurs au passif, PCG art. 821-1 and the notices of
 *   forms 2033-A and 2050-2051). A bank account (512) in credit is a bank
 *   overdraft (Emprunts et dettes, "51 (C)"), a supplier (401) in debit is an
 *   "Autres créances". Depreciation accounts (28, 29, 39, 49, 59) go to the
 *   Amortissements column of their asset line.
 * - When no line of the balance's sign matches, the account stays on its
 *   line with a negative amount (a debit Report à nouveau 119 reduces the
 *   capitaux propres, PCG art. 821-1).
 * - Income statement: no sign routing. A charge is debit - credit, a
 *   product credit - debit; a rebate account (609, 709) reduces its line.
 *
 * Accounts that match no line are returned as `unmapped`, ties between two
 * lines as `ambiguous`: both are configuration errors reported to the user.
 *
 * Amounts are integer cents.
 */

export type StatementSection = 'actif' | 'passif' | 'produits' | 'charges'
export type StatementKind = 'balance-sheet' | 'income-statement'
export type AllocationSlot = 'main' | 'amortissement'

export interface StatementLineRule {
  id: string
  parentId?: string | null
  section?: string | null
  lineType?: string | null
  lineLabel?: string
  formCode?: string | null
  accountCodes: string[]
  excludedAccountCodes?: string[] | null
  amortissementAccountCodes?: string[] | null
  filterType?: string | null
  balanceType: string
  displayType?: string | null
  order: number
}

export interface AccountTotals {
  accountId?: string
  code: string
  label?: string
  debitCents: number
  creditCents: number
}

export interface Allocation {
  account: AccountTotals
  lineId: string
  slot: AllocationSlot
  /** The line does not have the sign of the balance: it is shown as a negative amount. */
  againstSign: boolean
}

export interface AllocationResult {
  allocations: Allocation[]
  /** Accounts with a balance that no line takes. */
  unmapped: AccountTotals[]
  /** Accounts that two lines take with the same code length: the first line (by order) gets them. */
  ambiguous: Array<{ code: string; lineIds: string[] }>
}

/** Rules that carry accounts: rules without children that have account codes. */
export function leafRules<T extends StatementLineRule>(rules: T[]): T[] {
  const parents = new Set(rules.map((r) => r.parentId).filter((id): id is string => !!id))
  return rules.filter(
    (r) =>
      !parents.has(r.id) &&
      (r.accountCodes.length > 0 || (r.amortissementAccountCodes?.length ?? 0) > 0)
  )
}

/**
 * Section of a rule: its own, else the first ancestor's. Balance sheet rules
 * without any section fall back on their sign (debit lines are actif),
 * income statement rules likewise (debit lines are charges).
 */
export function sectionOf(
  rule: StatementLineRule,
  byId: Map<string, StatementLineRule>,
  kind: StatementKind
): StatementSection {
  const valid =
    kind === 'balance-sheet' ? ['actif', 'passif'] : ['produits', 'charges']
  let current: StatementLineRule | undefined = rule
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    if (current.section && valid.includes(current.section)) return current.section as StatementSection
    seen.add(current.id)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  if (kind === 'balance-sheet') return rule.balanceType === 'credit' ? 'passif' : 'actif'
  return rule.balanceType === 'debit' ? 'charges' : 'produits'
}

/** Length of the longest code of `codes` that `code` matches, 0 when none (or excluded). */
function matchLength(
  code: string,
  codes: string[],
  excluded: string[],
  exact: boolean
): number {
  if (excluded.some((x) => x && code.startsWith(x))) return 0
  let best = 0
  for (const prefix of codes) {
    if (!prefix) continue
    const hit = exact ? code === prefix : code.startsWith(prefix)
    if (hit && prefix.length > best) best = prefix.length
  }
  return best
}

interface Candidate {
  rule: StatementLineRule
  slot: AllocationSlot
  length: number
}

/** Whether a slot takes a balance of that sign in the balance sheet. */
function takesSign(candidate: Candidate, debitBalance: boolean): boolean {
  if (candidate.slot === 'amortissement') return !debitBalance
  if (candidate.rule.balanceType === 'debit') return debitBalance
  if (candidate.rule.balanceType === 'credit') return !debitBalance
  return true
}

/**
 * Allocates each account with a non-zero balance to one line. `accounts`
 * must already be limited to the classes of the statement (1 to 5 for the
 * balance sheet, 6 and 7 for the income statement).
 */
export function allocateAccounts(
  rules: StatementLineRule[],
  accounts: AccountTotals[],
  kind: StatementKind
): AllocationResult {
  const leaves = leafRules(rules)
  const result: AllocationResult = { allocations: [], unmapped: [], ambiguous: [] }

  for (const account of accounts) {
    const balance = account.debitCents - account.creditCents
    if (balance === 0) continue

    const candidates: Candidate[] = []
    for (const rule of leaves) {
      const exact = rule.filterType === 'exact'
      const excluded = rule.excludedAccountCodes ?? []
      const main = matchLength(account.code, rule.accountCodes, excluded, exact)
      if (main > 0) candidates.push({ rule, slot: 'main', length: main })
      if (kind === 'balance-sheet') {
        const amort = matchLength(account.code, rule.amortissementAccountCodes ?? [], [], exact)
        if (amort > 0) candidates.push({ rule, slot: 'amortissement', length: amort })
      }
    }

    if (candidates.length === 0) {
      result.unmapped.push(account)
      continue
    }

    let pool = candidates
    let againstSign = false
    if (kind === 'balance-sheet') {
      const sameSign = candidates.filter((c) => takesSign(c, balance > 0))
      if (sameSign.length > 0) pool = sameSign
      else againstSign = true
    }

    const longest = Math.max(...pool.map((c) => c.length))
    const best = pool
      .filter((c) => c.length === longest)
      .sort((a, b) => a.rule.order - b.rule.order || a.rule.id.localeCompare(b.rule.id))
    const distinct = new Set(best.map((c) => `${c.rule.id}:${c.slot}`))
    if (distinct.size > 1) {
      result.ambiguous.push({ code: account.code, lineIds: [...new Set(best.map((c) => c.rule.id))] })
    }

    result.allocations.push({
      account,
      lineId: best[0].rule.id,
      slot: best[0].slot,
      againstSign,
    })
  }

  return result
}

/**
 * Signed contribution of an allocation to its line, in cents:
 * actif and charges count debit - credit, passif and produits credit - debit;
 * the Amortissements column counts credit - debit (it is deducted from the
 * gross value).
 */
export function contribution(allocation: Allocation, section: StatementSection): number {
  const { debitCents, creditCents } = allocation.account
  if (allocation.slot === 'amortissement') return creditCents - debitCents
  return section === 'actif' || section === 'charges'
    ? debitCents - creditCents
    : creditCents - debitCents
}
