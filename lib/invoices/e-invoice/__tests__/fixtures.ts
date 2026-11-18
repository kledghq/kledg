/**
 * E-invoice files for the tests, built from the EN 16931 bindings (CII D16B
 * for Factur-X, UBL 2.1): a seller and a buyer with valid fictitious SIREN
 * and VAT numbers, lines, a VAT breakdown and totals, each overridable to
 * build a broken document. Also a minimal Factur-X PDF: a PDF/A-3 shaped
 * file whose CII XML is an embedded file stream (/Type /EmbeddedFile),
 * compressed or not, encrypted on demand. Fictitious data.
 */

import { deflateSync } from 'node:zlib'

/** Fictitious companies whose SIREN pass the Luhn key. */
export const SELLER = { name: 'Papeterie Durand SARL', siren: '930000104', siret: '93000010400016', vat: 'FR91930000104' }
export const BUYER = { name: 'Atelier Martin SAS', siren: '930000120', vat: 'FR42930000120' }

export interface FixtureLine {
  name: string
  quantity: string
  price: string
  baseQuantity?: string
  net: string
  category?: string
  rate: string
}

export interface FixtureVat {
  category?: string
  rate: string
  base: string
  amount: string
}

export interface FixtureInvoice {
  number: string
  typeCode: string
  issueDate: string
  dueDate: string | null
  currency: string
  seller: { name: string; siren: string | null; siret?: string | null; vat: string | null }
  buyer: { name: string; siren: string | null; vat: string | null }
  lines: FixtureLine[]
  vat: FixtureVat[]
  allowances?: string
  taxBasis: string
  taxTotal: string
  grandTotal: string
  prepaid?: string
  specification?: string
}

/** 2 x 100,00 at 20 % and 1 x 50,00 at 5,5 %: 250,00 HT, 42,75 TVA, 292,75 TTC. */
export function sampleInvoice(overrides: Partial<FixtureInvoice> = {}): FixtureInvoice {
  return {
    number: 'F2026-0042',
    typeCode: '380',
    issueDate: '2026-03-02',
    dueDate: '2026-04-01',
    currency: 'EUR',
    seller: { name: SELLER.name, siren: SELLER.siren, siret: SELLER.siret, vat: SELLER.vat },
    buyer: { name: BUYER.name, siren: BUYER.siren, vat: BUYER.vat },
    lines: [
      { name: 'Ramettes de papier A4', quantity: '2', price: '100.00', net: '200.00', category: 'S', rate: '20.00' },
      { name: 'Livre de comptabilité', quantity: '1', price: '50.00', net: '50.00', category: 'S', rate: '5.50' },
    ],
    vat: [
      { category: 'S', rate: '20.00', base: '200.00', amount: '40.00' },
      { category: 'S', rate: '5.50', base: '50.00', amount: '2.75' },
    ],
    taxBasis: '250.00',
    taxTotal: '42.75',
    grandTotal: '292.75',
    specification: 'urn:cen.eu:en16931:2017',
    ...overrides,
  }
}

const esc = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const ciiDate = (day: string) => day.replace(/-/g, '')

function ciiParty(tag: string, party: FixtureInvoice['seller']) {
  return `<ram:${tag}>
        ${party.siret ? `<ram:GlobalID schemeID="0009">${party.siret}</ram:GlobalID>` : ''}
        <ram:Name>${esc(party.name)}</ram:Name>
        ${party.siren ? `<ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">${party.siren}</ram:ID></ram:SpecifiedLegalOrganization>` : ''}
        <ram:PostalTradeAddress><ram:PostcodeCode>75011</ram:PostcodeCode><ram:LineOne>12 rue des Papetiers</ram:LineOne><ram:CityName>Paris</ram:CityName><ram:CountryID>FR</ram:CountryID></ram:PostalTradeAddress>
        ${party.vat ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${party.vat}</ram:ID></ram:SpecifiedTaxRegistration>` : ''}
      </ram:${tag}>`
}

/** A CII CrossIndustryInvoice (the XML of Factur-X). */
export function ciiXml(invoice: FixtureInvoice = sampleInvoice()): string {
  const lines = invoice.lines
    .map(
      (line, i) => `<ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument><ram:LineID>${i + 1}</ram:LineID></ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct><ram:Name>${esc(line.name)}</ram:Name></ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${line.price}</ram:ChargeAmount>${line.baseQuantity ? `<ram:BasisQuantity unitCode="C62">${line.baseQuantity}</ram:BasisQuantity>` : ''}</ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="C62">${line.quantity}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>${line.category ?? 'S'}</ram:CategoryCode><ram:RateApplicablePercent>${line.rate}</ram:RateApplicablePercent></ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${line.net}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`,
    )
    .join('\n    ')
  const vat = invoice.vat
    .map(
      (row) =>
        `<ram:ApplicableTradeTax><ram:CalculatedAmount>${row.amount}</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode><ram:BasisAmount>${row.base}</ram:BasisAmount><ram:CategoryCode>${row.category ?? 'S'}</ram:CategoryCode><ram:RateApplicablePercent>${row.rate}</ram:RateApplicablePercent></ram:ApplicableTradeTax>`,
    )
    .join('\n      ')
  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext><ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>${invoice.specification ?? 'urn:cen.eu:en16931:2017'}</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${esc(invoice.number)}</ram:ID>
    <ram:TypeCode>${invoice.typeCode}</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">${ciiDate(invoice.issueDate)}</udt:DateTimeString></ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    ${lines}
    <ram:ApplicableHeaderTradeAgreement>
      ${ciiParty('SellerTradeParty', invoice.seller)}
      ${ciiParty('BuyerTradeParty', invoice.buyer)}
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery/>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>${invoice.currency}</ram:InvoiceCurrencyCode>
      ${vat}
      ${invoice.dueDate ? `<ram:SpecifiedTradePaymentTerms><ram:DueDateDateTime><udt:DateTimeString format="102">${ciiDate(invoice.dueDate)}</udt:DateTimeString></ram:DueDateDateTime></ram:SpecifiedTradePaymentTerms>` : ''}
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${invoice.lines.length ? invoice.taxBasis : '0.00'}</ram:LineTotalAmount>
        ${invoice.allowances ? `<ram:AllowanceTotalAmount>${invoice.allowances}</ram:AllowanceTotalAmount>` : ''}
        <ram:TaxBasisTotalAmount>${invoice.taxBasis}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="${invoice.currency}">${invoice.taxTotal}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${invoice.grandTotal}</ram:GrandTotalAmount>
        ${invoice.prepaid ? `<ram:TotalPrepaidAmount>${invoice.prepaid}</ram:TotalPrepaidAmount>` : ''}
        <ram:DuePayableAmount>${invoice.grandTotal}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`
}

function ublParty(tag: string, party: FixtureInvoice['seller'], endpoint: boolean) {
  return `<cac:${tag}><cac:Party>
      ${endpoint && party.siren ? `<cbc:EndpointID schemeID="0225">${party.siren}_achats</cbc:EndpointID>` : ''}
      <cac:PartyName><cbc:Name>${esc(party.name)}</cbc:Name></cac:PartyName>
      <cac:PostalAddress><cbc:StreetName>12 rue des Papetiers</cbc:StreetName><cbc:CityName>Paris</cbc:CityName><cbc:PostalZone>75011</cbc:PostalZone><cac:Country><cbc:IdentificationCode>FR</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
      ${party.vat ? `<cac:PartyTaxScheme><cbc:CompanyID>${party.vat}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : ''}
      <cac:PartyLegalEntity><cbc:RegistrationName>${esc(party.name)}</cbc:RegistrationName>${party.siren && !endpoint ? `<cbc:CompanyID schemeID="0002">${party.siren}</cbc:CompanyID>` : ''}</cac:PartyLegalEntity>
    </cac:Party></cac:${tag}>`
}

/**
 * A UBL Invoice, or CreditNote when the type code is 381. `endpoints`: the
 * SIREN are given only through French electronic addresses (scheme 0225).
 */
export function ublXml(invoice: FixtureInvoice = sampleInvoice(), options: { endpoints?: boolean } = {}): string {
  const credit = invoice.typeCode === '381'
  const root = credit ? 'CreditNote' : 'Invoice'
  const c = invoice.currency
  const lines = invoice.lines
    .map(
      (line, i) => `<cac:${root}Line>
    <cbc:ID>${i + 1}</cbc:ID>
    <cbc:${credit ? 'CreditedQuantity' : 'InvoicedQuantity'} unitCode="C62">${line.quantity}</cbc:${credit ? 'CreditedQuantity' : 'InvoicedQuantity'}>
    <cbc:LineExtensionAmount currencyID="${c}">${line.net}</cbc:LineExtensionAmount>
    <cac:Item><cbc:Name>${esc(line.name)}</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>${line.category ?? 'S'}</cbc:ID><cbc:Percent>${line.rate}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="${c}">${line.price}</cbc:PriceAmount>${line.baseQuantity ? `<cbc:BaseQuantity unitCode="C62">${line.baseQuantity}</cbc:BaseQuantity>` : ''}</cac:Price>
  </cac:${root}Line>`,
    )
    .join('\n  ')
  const subtotals = invoice.vat
    .map(
      (row) =>
        `<cac:TaxSubtotal><cbc:TaxableAmount currencyID="${c}">${row.base}</cbc:TaxableAmount><cbc:TaxAmount currencyID="${c}">${row.amount}</cbc:TaxAmount><cac:TaxCategory><cbc:ID>${row.category ?? 'S'}</cbc:ID><cbc:Percent>${row.rate}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>`,
    )
    .join('\n    ')
  return `<?xml version="1.0" encoding="UTF-8"?>
<${root} xmlns="urn:oasis:names:specification:ubl:schema:xsd:${root}-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>${invoice.specification ?? 'urn:cen.eu:en16931:2017'}</cbc:CustomizationID>
  <cbc:ID>${esc(invoice.number)}</cbc:ID>
  <cbc:IssueDate>${invoice.issueDate}</cbc:IssueDate>
  ${invoice.dueDate && !credit ? `<cbc:DueDate>${invoice.dueDate}</cbc:DueDate>` : ''}
  <cbc:${credit ? 'CreditNoteTypeCode' : 'InvoiceTypeCode'}>${invoice.typeCode}</cbc:${credit ? 'CreditNoteTypeCode' : 'InvoiceTypeCode'}>
  <cbc:DocumentCurrencyCode>${c}</cbc:DocumentCurrencyCode>
  ${ublParty('AccountingSupplierParty', invoice.seller, options.endpoints ?? false)}
  ${ublParty('AccountingCustomerParty', invoice.buyer, options.endpoints ?? false)}
  ${invoice.dueDate && credit ? `<cac:PaymentMeans><cbc:PaymentMeansCode>30</cbc:PaymentMeansCode><cbc:PaymentDueDate>${invoice.dueDate}</cbc:PaymentDueDate></cac:PaymentMeans>` : ''}
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${c}">${invoice.taxTotal}</cbc:TaxAmount>
    ${subtotals}
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${c}">${invoice.taxBasis}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${c}">${invoice.taxBasis}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${c}">${invoice.grandTotal}</cbc:TaxInclusiveAmount>
    ${invoice.allowances ? `<cbc:AllowanceTotalAmount currencyID="${c}">${invoice.allowances}</cbc:AllowanceTotalAmount>` : ''}
    ${invoice.prepaid ? `<cbc:PrepaidAmount currencyID="${c}">${invoice.prepaid}</cbc:PrepaidAmount>` : ''}
    <cbc:PayableAmount currencyID="${c}">${invoice.grandTotal}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  ${lines}
</${root}>`
}

/**
 * A Factur-X shaped PDF: a page, then the XML as an embedded file stream
 * (FlateDecode unless `compress: false`), referenced from the catalog's
 * EmbeddedFiles name tree and AF array like a real PDF/A-3. `encrypted`
 * adds an /Encrypt entry to the trailer. `xml: null` builds a plain PDF.
 */
export function facturXPdf(xml: string | null, options: { compress?: boolean; encrypted?: boolean } = {}): Uint8Array {
  const compress = options.compress ?? true
  const data = xml === null ? null : compress ? deflateSync(Buffer.from(xml, 'utf8')) : Buffer.from(xml, 'utf8')
  const parts: Buffer[] = [Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1')]
  const objects: Array<Buffer> = [
    Buffer.from(`<< /Type /Catalog /Pages 2 0 R${data ? ' /Names << /EmbeddedFiles << /Names [(factur-x.xml) 5 0 R] >> >> /AF [5 0 R]' : ''} >>`),
    Buffer.from('<< /Type /Pages /Count 1 /Kids [3 0 R] >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>'),
    Buffer.concat([Buffer.from(`<< /Length ${deflateSync('BT /F1 12 Tf 72 770 Td (Facture) Tj ET').length} /Filter /FlateDecode >>\nstream\n`), deflateSync('BT /F1 12 Tf 72 770 Td (Facture) Tj ET'), Buffer.from('\nendstream')]),
  ]
  if (data) {
    objects.push(Buffer.from('<< /Type /Filespec /F (factur-x.xml) /UF (factur-x.xml) /AFRelationship /Data /EF << /F 6 0 R /UF 6 0 R >> >>'))
    objects.push(
      Buffer.concat([
        Buffer.from(`<< /Type /EmbeddedFile /Subtype /text#2Fxml /Length ${data.length}${compress ? ' /Filter /FlateDecode' : ''} >>\nstream\n`),
        data,
        Buffer.from('\nendstream'),
      ]),
    )
  }
  const offsets: number[] = []
  let offset = parts[0].length
  objects.forEach((body, i) => {
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from('\nendobj\n')])
    offsets.push(offset)
    offset += chunk.length
    parts.push(chunk)
  })
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${options.encrypted ? ' /Encrypt << /Filter /Standard /V 2 /R 3 >>' : ''} >>\nstartxref\n${offset}\n%%EOF\n`
  parts.push(Buffer.from(xref + trailer))
  return new Uint8Array(Buffer.concat(parts))
}

export const bytes = (text: string) => new Uint8Array(Buffer.from(text, 'utf8'))
