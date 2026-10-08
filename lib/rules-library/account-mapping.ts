/**
 * Maps the account codes of a template (standard PCG codes) or of a rule
 * copied from another company to the chart of the company that adds it.
 * Pure: plain values in, plain values out; the services load the chart of
 * the active fiscal year.
 *
 * Invariant: an account is never created silently. A code the chart lacks
 * comes back `missing`, with the account to create (its PCG label and the
 * existing account it subdivides, PCG art. 932-1) and, when the chart has
 * one, the parent account to fall back on. The caller creates it only on an
 * explicit request (createMissingAccounts), or uses the fallback, or asks
 * the user.
 *
 * Choice, for a code C:
 * 1. `prefer`: codes of a well-known subdivision used first when they exist
 *    (445662 "TVA déductible intracommunautaire" for self-assessed VAT, as
 *    the rule editor's preset does);
 * 2. expense and income accounts (`kind: 'nature'`): a subdivision the
 *    company made of C (6262 or 626000 for 626) is preferred, because the
 *    company created it for this kind of cost. Only subdivisions whose
 *    nearest PCG account is C count: 6271 "Frais sur titres" is a PCG
 *    account of its own, never a subdivision of 627 to use for bank fees.
 *    Several subdivisions: C padded with zeros (626000), else C itself,
 *    else the first, flagged `ambiguous` with the alternatives;
 * 3. other accounts (VAT, third parties, `kind: 'exact'`): C itself first,
 *    then C padded with zeros (445660), then a single subdivision; a
 *    subdivision is never guessed among several (44566 with 445661 and
 *    445662 picks neither: 445662 may be the intracommunity VAT);
 * 4. otherwise `missing`.
 */

export interface ChartAccount {
  id: string
  code: string
  label: string
}

export type MappingKind = 'nature' | 'exact'

export interface AccountProposal {
  code: string
  label: string
  /** Code of the existing account the new one subdivides. */
  parentCode: string
}

export type AccountMapping =
  | {
      code: string
      status: 'exact' | 'subdivision' | 'preferred'
      account: ChartAccount
      /** Other subdivisions that could fit, when the choice was not obvious. */
      alternatives: ChartAccount[]
      ambiguous: boolean
    }
  | {
      code: string
      status: 'missing'
      /** The account to create, when an existing account can be its parent. */
      proposal: AccountProposal | null
      /** The nearest existing parent account (3 digits at least), used when the user does not create the account. */
      fallback: ChartAccount | null
    }

export interface MappingOptions {
  kind?: MappingKind
  prefer?: readonly string[]
  /** Labels of standard PCG codes (pcg-data.ts), for the account to create. */
  pcgLabels: ReadonlyMap<string, string>
}

const byCode = (a: ChartAccount, b: ChartAccount) => a.code.length - b.code.length || a.code.localeCompare(b.code)

/** The longest standard PCG code that is a prefix of `code` (itself when it is one). */
function nearestPcgCode(code: string, pcgLabels: ReadonlyMap<string, string>): string | null {
  for (let length = code.length; length >= 1; length--) {
    const prefix = code.slice(0, length)
    if (pcgLabels.has(prefix)) return prefix
  }
  return null
}

export function mapAccountCode(code: string, chart: readonly ChartAccount[], options: MappingOptions): AccountMapping {
  const byCodeMap = new Map(chart.map((a) => [a.code, a]))
  for (const preferred of options.prefer ?? []) {
    const account = byCodeMap.get(preferred)
    if (account) return { code, status: 'preferred', account, alternatives: [], ambiguous: false }
  }

  const exact = byCodeMap.get(code) ?? null
  const padded = code.length < 6 ? (byCodeMap.get(code.padEnd(6, '0')) ?? null) : null
  const subdivisions = chart
    .filter((a) => a.code.length > code.length && a.code.startsWith(code))
    .filter((a) => nearestPcgCode(a.code, options.pcgLabels) === nearestPcgCode(code, options.pcgLabels))
    .sort(byCode)

  if ((options.kind ?? 'nature') === 'nature' && subdivisions.length > 0) {
    if (subdivisions.length === 1) return { code, status: 'subdivision', account: subdivisions[0], alternatives: [], ambiguous: false }
    const pick = padded ?? exact ?? subdivisions[0]
    const alternatives = subdivisions.filter((a) => a.id !== pick.id)
    return { code, status: pick === exact ? 'exact' : 'subdivision', account: pick, alternatives, ambiguous: true }
  }

  if (exact) return { code, status: 'exact', account: exact, alternatives: [], ambiguous: false }
  if (padded) return { code, status: 'subdivision', account: padded, alternatives: subdivisions.filter((a) => a.id !== padded.id), ambiguous: false }
  if (subdivisions.length === 1) return { code, status: 'subdivision', account: subdivisions[0], alternatives: [], ambiguous: false }

  // Missing: the nearest existing parent (never a class or a two digit account).
  let fallback: ChartAccount | null = null
  for (let length = code.length - 1; length >= 3 && !fallback; length--) fallback = byCodeMap.get(code.slice(0, length)) ?? null
  let parent: ChartAccount | null = fallback
  for (let length = Math.min(code.length - 1, 2); length >= 1 && !parent; length--) parent = byCodeMap.get(code.slice(0, length)) ?? null
  const label = options.pcgLabels.get(code) ?? null
  return {
    code,
    status: 'missing',
    proposal: parent && label ? { code, label, parentCode: parent.code } : null,
    fallback,
  }
}

/** One account field of a rule line, to map. */
export interface AccountField {
  code: string
  kind: MappingKind
  prefer?: readonly string[]
}

/**
 * How codes are mapped: `template` for the standard PCG codes of a
 * template (expense and income accounts prefer the company's own
 * subdivision, 445662 is preferred for self-assessed VAT); `copy` for a rule
 * copied from another company, whose codes are already the ones that
 * company chose: every field keeps its exact code first.
 */
export type MappingMode = 'template' | 'copy'

/**
 * The account fields of rule lines: the line's account (`nature` for an
 * expense or income account of classes 6 and 7, `exact` otherwise) and its
 * VAT accounts (`exact`, 445662 preferred for self-assessed deductible VAT).
 */
function accountFieldsOf(
  lines: ReadonlyArray<{ accountCode: string; vatType?: string | null; vatAccountCode?: string | null; vatAccount2Code?: string | null }>,
  defaultVatAccountCode?: string | null,
  mode: MappingMode = 'template',
): AccountField[] {
  const template = mode === 'template'
  const fields: AccountField[] = []
  for (const line of lines) {
    if (line.accountCode) fields.push({ code: line.accountCode, kind: template && /^[67]/.test(line.accountCode) ? 'nature' : 'exact' })
    const selfAssessed = line.vatType === 'intracom' || line.vatType === 'import'
    if (line.vatAccountCode) fields.push({ code: line.vatAccountCode, kind: 'exact', prefer: template && selfAssessed && line.vatAccountCode === '44566' ? ['445662'] : undefined })
    if (line.vatAccount2Code) fields.push({ code: line.vatAccount2Code, kind: 'exact' })
  }
  if (defaultVatAccountCode) fields.push({ code: defaultVatAccountCode, kind: 'exact' })
  return fields
}

/** Key of a field in a mapping: the same code may map differently for self-assessed VAT. */
export function fieldKey(field: Pick<AccountField, 'code' | 'prefer'>): string {
  return field.prefer?.length ? `${field.code}>${field.prefer.join(',')}` : field.code
}

export interface MappedLine<L> {
  line: L
  accountCode: string | null
  vatAccountCode: string | null
  vatAccount2Code: string | null
}

export interface RuleMapping {
  /** One entry per distinct account field, in the order of the lines. */
  accounts: Array<AccountMapping & { key: string; kind: MappingKind }>
  /** Accounts the chart lacks and that could be created (the user decides). */
  missing: AccountProposal[]
  /** Codes that have neither an account, nor a parent to fall back on, nor an account to create. */
  unresolved: string[]
}

/** Maps every account field of the lines, once per field. */
export function mapRuleAccounts(
  lines: ReadonlyArray<{ accountCode: string; vatType?: string | null; vatAccountCode?: string | null; vatAccount2Code?: string | null }>,
  chart: readonly ChartAccount[],
  pcgLabels: ReadonlyMap<string, string>,
  defaultVatAccountCode?: string | null,
  mode: MappingMode = 'template',
): RuleMapping {
  const seen = new Set<string>()
  const accounts: RuleMapping['accounts'] = []
  for (const field of accountFieldsOf(lines, defaultVatAccountCode, mode)) {
    const key = fieldKey(field)
    if (seen.has(key)) continue
    seen.add(key)
    accounts.push({ ...mapAccountCode(field.code, chart, { kind: field.kind, prefer: field.prefer, pcgLabels }), key, kind: field.kind })
  }
  const missing = accounts.flatMap((a) => (a.status === 'missing' && a.proposal ? [a.proposal] : []))
  const unresolved = accounts.filter((a) => a.status === 'missing' && !a.proposal && !a.fallback).map((a) => a.code)
  return { accounts, missing: dedupeProposals(missing), unresolved }
}

function dedupeProposals(proposals: AccountProposal[]): AccountProposal[] {
  const byCode = new Map<string, AccountProposal>()
  for (const p of proposals) if (!byCode.has(p.code)) byCode.set(p.code, p)
  return [...byCode.values()]
}

/**
 * The code to write in the rule for each field: the mapped account, else
 * the fallback parent, else null (the user picks the account in the
 * editor). `created` holds codes of accounts created on request.
 */
export function resolvedCode(mapping: RuleMapping, field: AccountField, created: ReadonlySet<string> = new Set()): string | null {
  const entry = mapping.accounts.find((a) => a.key === fieldKey(field))
  if (!entry) return null
  if (entry.status !== 'missing') return entry.account.code
  if (created.has(entry.code)) return entry.code
  return entry.fallback?.code ?? null
}

/** The lines with their account codes mapped to the chart (null where nothing fits). */
export function mapLines<L extends { accountCode: string; vatType?: string | null; vatAccountCode?: string | null; vatAccount2Code?: string | null }>(
  lines: readonly L[],
  mapping: RuleMapping,
  created: ReadonlySet<string> = new Set(),
  mode: MappingMode = 'template',
): Array<MappedLine<L>> {
  return lines.map((line) => {
    const [main, ...vat] = accountFieldsOf([line], null, mode)
    const vatField = line.vatAccountCode ? vat[0] : undefined
    const vat2Field = line.vatAccount2Code ? vat[line.vatAccountCode ? 1 : 0] : undefined
    return {
      line,
      accountCode: main ? resolvedCode(mapping, main, created) : null,
      vatAccountCode: vatField ? resolvedCode(mapping, vatField, created) : null,
      vatAccount2Code: vat2Field ? resolvedCode(mapping, vat2Field, created) : null,
    }
  })
}
