/**
 * UN/CEFACT Cross Industry Invoice (CII D16B, the syntax of Factur-X and
 * ZUGFeRD) read into a RawEInvoice. Paths follow the EN 16931-3-3 binding;
 * comments give the business terms.
 */

import { all, attr, child, isoDay, text, textOf, type XmlNode } from './xml'
import { sirenOfFrenchAddress } from './ubl'
import type { RawEInvoice, RawLine, RawParty, RawVat } from './types'

export const CII_ROOT = 'CrossIndustryInvoice'

function party(node: unknown): RawParty {
  const ids = [
    // BT-30 / BT-47 legal registration (scheme 0002 SIREN, 0009 SIRET)
    ...all(child(node, 'SpecifiedLegalOrganization'), 'ID'),
    // BT-29 / BT-46 identifiers
    ...all(node, 'GlobalID'),
    ...all(node, 'ID'),
  ]
    .map((id) => ({ value: textOf(id) ?? '', scheme: attr(id, 'schemeID') }))
    .filter((id) => id.value)
  // BT-34 / BT-49 electronic address: the SIREN of a French address (scheme 0225)
  const uri = child(node, 'URIUniversalCommunication', 'URIID')
  const fromEndpoint = sirenOfFrenchAddress(textOf(uri), attr(uri, 'schemeID'))
  if (fromEndpoint) ids.push(fromEndpoint)
  // BT-31 / BT-48: the registration with scheme VA (FC is the tax number of the seller, BT-32)
  const vat = all(node, 'SpecifiedTaxRegistration')
    .map((reg) => child(reg, 'ID'))
    .find((id) => attr(id, 'schemeID') === 'VA')
  const address = child(node, 'PostalTradeAddress')
  return {
    name: text(node, 'Name'),
    ids,
    vatNumber: textOf(vat),
    address: address
      ? {
          lines: ['LineOne', 'LineTwo', 'LineThree'].map((key) => text(address, key)).filter((l): l is string => !!l),
          postalCode: text(address, 'PostcodeCode'),
          city: text(address, 'CityName'),
          country: text(address, 'CountryID'),
        }
      : null,
  }
}

function line(item: unknown): RawLine {
  const product = child(item, 'SpecifiedTradeProduct')
  const agreement = child(item, 'SpecifiedLineTradeAgreement')
  const price = child(agreement, 'NetPriceProductTradePrice')
  const settlement = child(item, 'SpecifiedLineTradeSettlement')
  const tax = child(settlement, 'ApplicableTradeTax')
  return {
    name: text(product, 'Name') ?? text(product, 'Description'),
    quantity: text(item, 'SpecifiedLineTradeDelivery', 'BilledQuantity'),
    netPrice: text(price, 'ChargeAmount'),
    baseQuantity: text(price, 'BasisQuantity'),
    netAmount: text(settlement, 'SpecifiedTradeSettlementLineMonetarySummation', 'LineTotalAmount'),
    vatCategory: text(tax, 'CategoryCode'),
    vatRate: text(tax, 'RateApplicablePercent'),
  }
}

/** BT-110 in the invoice currency: CII may repeat TaxTotalAmount in the accounting currency (BT-111). */
function taxTotal(summation: unknown, currency: string | null): string | null {
  const amounts = all(summation, 'TaxTotalAmount')
  const inCurrency = amounts.find((a) => !currency || !attr(a, 'currencyID') || attr(a, 'currencyID') === currency)
  return textOf(inCurrency ?? amounts[0])
}

export function readCii(root: XmlNode, format: 'cii' | 'factur-x'): RawEInvoice {
  const document = child(root, 'ExchangedDocument')
  const transaction = child(root, 'SupplyChainTradeTransaction')
  const agreement = child(transaction, 'ApplicableHeaderTradeAgreement')
  const settlement = child(transaction, 'ApplicableHeaderTradeSettlement')
  const summation = child(settlement, 'SpecifiedTradeSettlementHeaderMonetarySummation')
  const currency = text(settlement, 'InvoiceCurrencyCode')
  const vat: RawVat[] = all(settlement, 'ApplicableTradeTax').map((tax) => ({
    category: text(tax, 'CategoryCode'),
    rate: text(tax, 'RateApplicablePercent'),
    base: text(tax, 'BasisAmount'),
    amount: text(tax, 'CalculatedAmount'),
  }))
  const dueDate = all(settlement, 'SpecifiedTradePaymentTerms')
    .map((terms) => isoDay(text(terms, 'DueDateDateTime', 'DateTimeString')))
    .find(Boolean)
  return {
    format,
    specification: text(root, 'ExchangedDocumentContext', 'GuidelineSpecifiedDocumentContextParameter', 'ID'),
    number: text(document, 'ID'),
    typeCode: text(document, 'TypeCode'),
    issueDate: isoDay(text(document, 'IssueDateTime', 'DateTimeString')),
    dueDate: dueDate ?? null,
    currency,
    seller: party(child(agreement, 'SellerTradeParty')),
    buyer: party(child(agreement, 'BuyerTradeParty')),
    lines: all(transaction, 'IncludedSupplyChainTradeLineItem').map(line),
    vat,
    totals: {
      lineTotal: text(summation, 'LineTotalAmount'),
      allowances: text(summation, 'AllowanceTotalAmount'),
      charges: text(summation, 'ChargeTotalAmount'),
      taxBasis: text(summation, 'TaxBasisTotalAmount'),
      taxTotal: taxTotal(summation, currency),
      grandTotal: text(summation, 'GrandTotalAmount'),
      prepaid: text(summation, 'TotalPrepaidAmount'),
    },
  }
}
