/**
 * Suppliers established outside France that bill French businesses without
 * French VAT, as simple mode recognises them: the templates of the rules
 * library whose VAT treatment is "self-assessed" (lib/rules-library/catalog:
 * Microsoft, Adobe, Notion, GitHub, OpenAI, Anthropic, Canva, Google Ads,
 * Meta, LinkedIn). One source for both: the template's label condition
 * recognises the supplier, and simple mode books the same entry as the
 * template (lib/simple/posting.ts, rule "self-assessed").
 *
 * A service bought by a business established in France from a supplier
 * established elsewhere is taxed in France (CGI art. 259, 1°) and the VAT is
 * due by the customer (CGI art. 283, 2): the price paid holds no French VAT,
 * the company self-assesses it and deducts it (BOI-TVA-DECLA-10-10-20).
 * Pure.
 */

import { RULE_TEMPLATES } from '@/lib/rules-library/catalog'
import { sampleTransaction, sideOf } from '@/lib/rules-library/duplicates'
import { templateAsRule } from '@/lib/rules-library/suggestions'
import { findMatchingRules } from '@/lib/transactions/rule-matcher'

export interface ForeignSupplier {
  templateId: string
  name: string
}

const SELF_ASSESSED = RULE_TEMPLATES.filter((t) => t.vat.treatment === 'self-assessed').map((t) => ({ template: t, rule: templateAsRule(t), side: sideOf(t) }))

/** The supplier of a bank line when the rules library knows it bills without French VAT, null otherwise. */
export function foreignSupplierOf(tx: { label: string | null; counterpartyName: string | null }): ForeignSupplier | null {
  const text = [tx.counterpartyName, tx.label].filter(Boolean).join(' ').trim()
  if (!text) return null
  for (const { template, rule, side } of SELF_ASSESSED) {
    // Matched on the template's side: a refund (money in) of the same supplier reverses the same entry
    if (findMatchingRules([rule], { ...sampleTransaction(text, side), counterpartyName: tx.counterpartyName }).length > 0) {
      return { templateId: template.id, name: template.name }
    }
  }
  return null
}

/** The answer to the supplier question (SUPPLIER_VAT) the bank line gives: "foreign" for a supplier the rules library knows, "french" otherwise. */
export function supplierVatAnswerOf(tx: { label: string | null; counterpartyName?: string | null }): 'foreign' | 'french' {
  return foreignSupplierOf({ label: tx.label, counterpartyName: tx.counterpartyName ?? null }) ? 'foreign' : 'french'
}
