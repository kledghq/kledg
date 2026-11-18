/**
 * OASIS UBL 2.1 Invoice and CreditNote read into a RawEInvoice. Paths
 * follow the EN 16931-3-2 binding; comments give the business terms.
 */

import { all, attr, child, isoDay, text, textOf } from './xml'
import type { RawEInvoice, RawLine, RawParty, RawVat } from './types'

export const UBL_ROOTS = new Set(['Invoice', 'CreditNote'])

/**
 * The SIREN of a French electronic address (scheme 0225, "SIREN_suffix"
 * in the directory of the reform): the nine digits before the suffix.
 */
export function sirenOfFrenchAddress(value: string | null, scheme: string | null): { value: string; scheme: string } | null {
  if (scheme !== '0225' || !value) return null
  const match = /^(\d{9})(?:_|$)/.exec(value.trim())
  return match ? { value: match[1], scheme: '0002' } : null
}

function party(node: unknown): RawParty {
  const legal = child(node, 'PartyLegalEntity')
  const endpoint = child(node, 'EndpointID')
  const ids = [
    // BT-30 / BT-47 legal registration (scheme 0002 SIREN, 0009 SIRET)
    ...all(legal, 'CompanyID'),
    // BT-29 / BT-46 identifiers
    ...all(node, 'PartyIdentification').map((p) => child(p, 'ID')),
  ]
    .map((id) => ({ value: textOf(id) ?? '', scheme: attr(id, 'schemeID') }))
    .filter((id) => id.value)
  const fromEndpoint = sirenOfFrenchAddress(textOf(endpoint), attr(endpoint, 'schemeID'))
  if (fromEndpoint) ids.push(fromEndpoint)
  // BT-31 / BT-48: the tax scheme VAT (LOC or other schemes hold other numbers)
  const vat = all(node, 'PartyTaxScheme').find((scheme) => text(scheme, 'TaxScheme', 'ID')?.toUpperCase() === 'VAT')
  const address = child(node, 'PostalAddress')
  return {
    name: text(legal, 'RegistrationName') ?? text(node, 'PartyName', 'Name'),
    ids,
    vatNumber: text(vat, 'CompanyID'),
    address: address
      ? {
          lines: [text(address, 'StreetName'), text(address, 'AdditionalStreetName'), text(address, 'AddressLine', 'Line')].filter((l): l is string => !!l),
          postalCode: text(address, 'PostalZone'),
          city: text(address, 'CityName'),
          country: text(address, 'Country', 'IdentificationCode'),
        }
      : null,
  }
}

function line(node: unknown, credit: boolean): RawLine {
  const item = child(node, 'Item')
  const tax = child(item, 'ClassifiedTaxCategory')
  const price = child(node, 'Price')
  return {
    name: text(item, 'Name') ?? text(item, 'Description'),
    quantity: text(node, credit ? 'CreditedQuantity' : 'InvoicedQuantity'),
    netPrice: text(price, 'PriceAmount'),
    baseQuantity: text(price, 'BaseQuantity'),
    netAmount: text(node, 'LineExtensionAmount'),
    vatCategory: text(tax, 'ID'),
    vatRate: text(tax, 'Percent'),
  }
}

export function readUbl(name: string, root: unknown): RawEInvoice {
  const credit = name === 'CreditNote'
  const currency = text(root, 'DocumentCurrencyCode')
  // BT-110 and BG-23: the TaxTotal in the invoice currency that carries the subtotals (a second one may give BT-111).
  const taxTotals = all(root, 'TaxTotal')
  const taxTotal = taxTotals.find((t) => !currency || attr(child(t, 'TaxAmount'), 'currencyID') === currency) ?? taxTotals[0]
  const vat: RawVat[] = all(taxTotal, 'TaxSubtotal').map((sub) => ({
    category: text(sub, 'TaxCategory', 'ID'),
    rate: text(sub, 'TaxCategory', 'Percent'),
    base: text(sub, 'TaxableAmount'),
    amount: text(sub, 'TaxAmount'),
  }))
  const totals = child(root, 'LegalMonetaryTotal')
  const dueDate = isoDay(text(root, 'DueDate')) ?? all(root, 'PaymentMeans').map((m) => isoDay(text(m, 'PaymentDueDate'))).find(Boolean) ?? null
  return {
    format: 'ubl',
    specification: text(root, 'CustomizationID'),
    number: text(root, 'ID'),
    typeCode: text(root, credit ? 'CreditNoteTypeCode' : 'InvoiceTypeCode'),
    issueDate: isoDay(text(root, 'IssueDate')),
    dueDate,
    currency,
    seller: party(child(root, 'AccountingSupplierParty', 'Party')),
    buyer: party(child(root, 'AccountingCustomerParty', 'Party')),
    lines: all(root, credit ? 'CreditNoteLine' : 'InvoiceLine').map((l) => line(l, credit)),
    vat,
    totals: {
      lineTotal: text(totals, 'LineExtensionAmount'),
      allowances: text(totals, 'AllowanceTotalAmount'),
      charges: text(totals, 'ChargeTotalAmount'),
      taxBasis: text(totals, 'TaxExclusiveAmount'),
      taxTotal: text(taxTotal, 'TaxAmount'),
      grandTotal: text(totals, 'TaxInclusiveAmount'),
      prepaid: text(totals, 'PrepaidAmount'),
    },
  }
}
