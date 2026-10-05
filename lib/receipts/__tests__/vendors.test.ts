/**
 * Vendors of lib/receipts/vendors.ts: unique ids, a pattern from the rules
 * library or their own, samples recognised (and close labels refused) by
 * detectVendor in the list order, samples of a narrower vendor also matched
 * by the template that covers it, and a page of invoices only on https with
 * the official help page that gives it.
 */

import { describe, expect, it } from 'vitest'
import { ruleTemplateById } from '@/lib/rules-library/catalog'
import { UBER_RIDES_PATTERN } from '@/lib/rules-library/catalog/label-patterns'
import { compileRulePattern } from '@/lib/transactions/rule-regex'
import { detectVendor, vendorPattern } from '../detect-supplier'
import { RECEIPT_VENDORS, receiptVendorById } from '../vendors'

const templatePattern = (id: string) => ruleTemplateById(id)?.conditions.find((c) => c.conditionType === 'label')?.value ?? ''

describe('receipt vendors', () => {
  it('have unique ids and names, and cover the common suppliers of a small French company', () => {
    expect(new Set(RECEIPT_VENDORS.map((v) => v.id)).size).toBe(RECEIPT_VENDORS.length)
    expect(new Set(RECEIPT_VENDORS.map((v) => v.name)).size).toBe(RECEIPT_VENDORS.length)
    for (const id of ['ovhcloud', 'google-workspace', 'microsoft-365', 'aws', 'free', 'orange', 'edf', 'sncf-connect', 'amazon', 'qonto', 'stripe']) {
      expect(receiptVendorById(id), id).toBeDefined()
    }
    expect(receiptVendorById('inconnu')).toBeUndefined()
    expect(receiptVendorById(null)).toBeUndefined()
  })

  describe.each(RECEIPT_VENDORS.map((v) => [v.id, v] as const))('%s', (_id, vendor) => {
    it('takes its pattern from one template of the catalog or has its own, and compiles it', () => {
      expect(Boolean(vendor.template) !== Boolean(vendor.pattern), 'template or pattern, not both').toBe(true)
      if (vendor.template) expect(vendorPattern(vendor)).toBe(templatePattern(vendor.template))
      expect(compileRulePattern(vendorPattern(vendor)).ok).toBe(true)
    })

    it('is detected on its sample labels, before any other vendor, and not on the close ones', () => {
      for (const label of vendor.samples.match) expect(detectVendor([label])?.id, label).toBe(vendor.id)
      for (const label of vendor.samples.noMatch ?? []) expect(detectVendor([label])?.id, label).not.toBe(vendor.id)
    })

    it('stays within the template that covers it among others', () => {
      if (!vendor.within) return
      const pattern = compileRulePattern(templatePattern(vendor.within))
      expect(pattern.ok).toBe(true)
      if (!pattern.ok) return
      for (const label of vendor.samples.match) expect(pattern.pattern.test(label), label).toBe(true)
    })

    it('links its invoices only on https, with the official help page as source', () => {
      if (!vendor.invoicesUrl) {
        expect(vendor.source).toBeUndefined()
        return
      }
      expect(new URL(vendor.invoicesUrl).protocol).toBe('https:')
      expect(vendor.source, 'a URL needs its source').toBeTruthy()
      expect(new URL(vendor.source ?? '').protocol).toBe('https:')
    })
  })

  it('shares the Uber pattern with the taxi template, which keeps the same pattern string', () => {
    expect(templatePattern('taxi-vtc')).toBe('\\buber\\W*(trip|bv|rides?)\\b|\\b(g7|taxis?|heetch|freenow|free now|lecab)\\b')
    expect(templatePattern('taxi-vtc').startsWith(`${UBER_RIDES_PATTERN}|`)).toBe(true)
  })

  it('recognises real-looking bank labels and leaves the others alone', () => {
    const cases: Array<[string, string | null]> = [
      ['PRLV SEPA OVH SAS FR123', 'ovhcloud'],
      ['CB GOOGLE *GSUITE_ATELIER 01/09', 'google-workspace'],
      ['CB MSFT * E0300ABCD 12/09', 'microsoft-365'],
      ['PRLV SEPA FREE MOBILE 4567', 'free-mobile'],
      ['PRLV SEPA FREE TELECOM FREEBOX', 'free'],
      ['PRLV SEPA EDF CLIENTS PARTICULIERS', 'edf'],
      ['CB SNCF CONNECT 15/09 PARIS', 'sncf-connect'],
      ['CB AMAZON.FR MARKETPLACE', 'amazon'],
      ['CB APPLE.COM/BILL 08/09', 'apple'],
      ['CB AMAZON WEB SERVICES AWS.AMAZON.CO', 'aws'],
      ['VIR SEPA SCI LES TILLEULS LOYER', null],
      ['CB BOULANGERIE DU MARCHE', null],
      ['RETRAIT DAB 12/09', null],
    ]
    for (const [label, id] of cases) expect(detectVendor([label])?.id ?? null, label).toBe(id)
  })

  it('reads the counterparty name too, and nothing from empty texts', () => {
    expect(detectVendor([null, 'Notion Labs Inc'])?.id).toBe('notion')
    expect(detectVendor([null, '', '  '])).toBeNull()
  })
})
