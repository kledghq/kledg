/**
 * The supplier of a bank transaction without receipt, read from its label
 * and counterparty: a known vendor first (lib/receipts/vendors.ts, with the
 * page of its invoices when verified), else a tiers of the company whose
 * name or auxiliary account appears in the label as whole words.
 *
 * Patterns run on the linear-time matcher of the assignment rules
 * (lib/transactions/rule-regex.ts), compiled once. Pure module: the
 * service passes the tiers it loaded, indexed once (indexTiers).
 */

import { ruleTemplateById } from '@/lib/rules-library/catalog'
import { compileRulePattern, type CompiledRulePattern } from '@/lib/transactions/rule-regex'
import { RECEIPT_VENDORS, type ReceiptVendor } from './vendors'

export interface DetectedSupplier {
  /** Vendor name, or the name of the tiers. */
  name: string
  /** vendor: a known vendor (lib/receipts/vendors.ts); SUPPLIER or CUSTOMER: a tiers of the company. */
  kind: 'vendor' | 'SUPPLIER' | 'CUSTOMER'
  vendorId: string | null
  /** The tiers of the company recognised in the label, if any. */
  tiersId: string | null
  /** Official page of the invoices of the vendor, when verified. */
  invoicesUrl: string | null
}

export interface TiersCandidate {
  id: string
  name: string
  kind: 'SUPPLIER' | 'CUSTOMER'
  auxiliaryAccountNumber: string | null
}

/** The label pattern of a vendor: its own, or the label condition of its template. */
export function vendorPattern(vendor: ReceiptVendor): string {
  if (vendor.pattern) return vendor.pattern
  const condition = ruleTemplateById(vendor.template ?? '')?.conditions.find((c) => c.conditionType === 'label' && c.operator === 'regex')
  if (!condition) throw new Error(`Vendor ${vendor.id}: template ${vendor.template ?? '(none)'} has no label pattern`)
  return condition.value
}

let compiled: Array<{ vendor: ReceiptVendor; pattern: CompiledRulePattern }> | null = null

function compiledVendors() {
  compiled ??= RECEIPT_VENDORS.map((vendor) => {
    const result = compileRulePattern(vendorPattern(vendor))
    if (!result.ok) throw new Error(`Vendor ${vendor.id}: ${result.message}`)
    return { vendor, pattern: result.pattern }
  })
  return compiled
}

/** The known vendor named by one of the texts (label, counterparty), first in the list order. */
export function detectVendor(texts: ReadonlyArray<string | null | undefined>): ReceiptVendor | null {
  const values = texts.filter((t): t is string => Boolean(t && t.trim()))
  if (values.length === 0) return null
  for (const { vendor, pattern } of compiledVendors()) {
    if (values.some((text) => pattern.test(text) === true)) return vendor
  }
  return null
}

/** Legal forms left out at the start or end of a tiers name before matching ("OVH SAS" is "ovh"). */
const LEGAL_FORMS = new Set(['sa', 'sas', 'sasu', 'sarl', 'eurl', 'sci', 'snc', 'scop', 'selarl', 'ei', 'eirl', 'ets', 'inc', 'ltd', 'llc', 'gmbh', 'bv', 'srl', 'sl', 'plc'])

/** Lowercase words without accents nor punctuation, space separated. */
export function words(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** The words of a tiers name that identify it, or null when too short or generic to match safely. */
function tiersKey(name: string): string | null {
  const list = words(name).split(' ').filter(Boolean)
  while (list.length > 0 && LEGAL_FORMS.has(list[0])) list.shift()
  while (list.length > 0 && LEGAL_FORMS.has(list[list.length - 1])) list.pop()
  const kept = list.join(' ')
  return kept.replace(/ /g, '').length >= 3 ? kept : null
}

/** An auxiliary account worth looking for in a label: 4 characters or more, with letters ("DUPONT", not "F0001"). */
function auxiliaryKey(aux: string | null): string | null {
  const key = words(aux ?? '')
  return key.length >= 4 && /^[a-z]{3,}/.test(key) && !key.includes(' ') ? key : null
}

/** The tiers of a company with the words to look for, computed once for a list of transactions. */
export interface TiersIndex {
  entries: Array<{ tiers: TiersCandidate; keys: string[] }>
}

export function indexTiers(tiers: readonly TiersCandidate[]): TiersIndex {
  return {
    entries: tiers
      .map((t) => ({ tiers: t, keys: [tiersKey(t.name), auxiliaryKey(t.auxiliaryAccountNumber)].filter((k): k is string => k !== null) }))
      .filter((e) => e.keys.length > 0),
  }
}

/** The tiers of that kind whose name (or auxiliary account) appears as whole words in one of the texts; the longest match wins. */
export function detectTiers(texts: ReadonlyArray<string | null | undefined>, index: TiersIndex, kind: TiersCandidate['kind']): TiersCandidate | null {
  const haystacks = texts.filter((t): t is string => Boolean(t && t.trim())).map((t) => ` ${words(t)} `)
  if (haystacks.length === 0) return null
  let best: { tiers: TiersCandidate; length: number } | null = null
  for (const { tiers, keys } of index.entries) {
    if (tiers.kind !== kind) continue
    for (const key of keys) {
      if (!haystacks.some((h) => h.includes(` ${key} `))) continue
      if (!best || key.length > best.length) best = { tiers, length: key.length }
    }
  }
  return best?.tiers ?? null
}

/**
 * The supplier of a transaction: the known vendor, else the tiers. The
 * tiers looked for are the suppliers for a payment, the customers for a
 * receipt.
 */
export function detectSupplier(
  transaction: { label: string | null; counterpartyName: string | null; side: 'debit' | 'credit' },
  tiers: TiersIndex,
): DetectedSupplier | null {
  const texts = [transaction.counterpartyName, transaction.label]
  const vendor = detectVendor(texts)
  const tiersMatch = detectTiers(texts, tiers, transaction.side === 'debit' ? 'SUPPLIER' : 'CUSTOMER')
  if (vendor) return { name: vendor.name, kind: 'vendor', vendorId: vendor.id, tiersId: tiersMatch?.id ?? null, invoicesUrl: vendor.invoicesUrl ?? null }
  if (tiersMatch) return { name: tiersMatch.name, kind: tiersMatch.kind, vendorId: null, tiersId: tiersMatch.id, invoicesUrl: null }
  return null
}
