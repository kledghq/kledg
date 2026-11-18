/**
 * An e-invoice as written (RawEInvoice) turned into Kledg's amounts, or
 * refused with a French reason. Pure: the same checks for CII, Factur-X and
 * UBL, tested without a database.
 *
 * The document's amounts are kept, never recomputed: an e-invoice is the
 * original of the invoice (CGI art. 289 bis), and its VAT per rate (BG-23)
 * is the legal amount (CGI ann. II art. 242 nonies A, I, 11°). They are
 * checked instead, with the rules of EN 16931-1 that a valid document
 * already meets:
 * - BR-CO-13: total without VAT (BT-109) = sum of the bases (BT-116);
 * - BR-CO-14: total VAT (BT-110) = sum of the VAT per rate (BT-117);
 * - BR-CO-15: total with VAT (BT-112) = BT-109 + BT-110.
 * An invoice that breaks one is refused, never guessed.
 *
 * Lines: Kledg's lines carry no discount and no negative amount
 * (invoice_lines_values_check). The document's lines are kept when, rate by
 * rate, their net amounts (BT-131) add up to the base of that rate; a line
 * whose quantity and price do not give back its amount at Kledg's precision
 * (3 decimals, cents) is kept as one unit at its amount. Otherwise (document
 * level allowances or charges, BG-20 and BG-21; negative lines; no lines in
 * the BASIC WL and MINIMUM profiles; more than 200 lines), Kledg records one
 * line per rate at the base of the breakdown, like a Qonto supplier invoice,
 * and says so.
 */

import { computeInvoiceTotals, formatVatRate, isFrenchVatRate, lineTotalCents, parseQuantity, rateToBasisPoints, totalsOfBreakdown, type VatBreakdownRow } from '../amounts'
import { isValidSiren, isValidSiret, isValidVatNumber, normalizeIdentifier, normalizeVatNumber } from '@/lib/tiers/identifiers'
import { fitsAmountColumn, formatCentsFr, parseCents } from '@/lib/utils/money'
import type { EInvoiceLine, EInvoiceParseResult, EInvoiceParty, RawEInvoice, RawParty } from './types'

/** Lines of an invoice, as in the invoice form (manage-invoices.service.ts). */
const MAX_LINES = 200

/**
 * UNTDID 1001 codes Kledg records: 380 commercial invoice and 393 factored
 * invoice (an invoice paid to a factor) as invoices, 381 credit note and 396
 * factored credit note as credit notes. Corrective (384), prepayment (386)
 * and self-billed (389, 261) documents are refused: each needs a treatment
 * Kledg does not do on its own.
 */
const TYPE_CODES: Record<string, '380' | '381'> = { '380': '380', '393': '380', '381': '381', '396': '381' }

/** VAT categories (UNCL 5305) whose rate is 0 when the document omits it. */
const ZERO_RATE_CATEGORIES = new Set(['Z', 'E', 'AE', 'K', 'G', 'O'])

const refuse = (reason: string): EInvoiceParseResult => ({ kind: 'refused', reason })

/** Text of the document on one line (names and labels may hold line breaks and indentation). */
const oneLine = (value: string | null | undefined): string => (value ?? '').replace(/\s+/g, ' ').trim()

/**
 * Cents of an amount of the document; null when absent or unreadable. EN
 * 16931 amounts have two decimals at most (BR-DEC); trailing zeros beyond
 * them ("100.000") are accepted.
 */
export function amountCents(value: string | null | undefined): number | null {
  const text = value?.trim()
  if (!text) return null
  return parseCents(text.replace(/^([+-]?\d+\.\d{2})0+$/, '$1'))
}

function rateBp(rate: string | null, category: string | null): number | null {
  if (rate === null || rate.trim() === '') return category && ZERO_RATE_CATEGORIES.has(category.toUpperCase()) ? 0 : null
  return rateToBasisPoints(rate.trim(), 'percent')
}

function partyOf(raw: RawParty, fallbackName: string): EInvoiceParty {
  let siren: string | null = null
  let siret: string | null = null
  for (const id of raw.ids) {
    const digits = normalizeIdentifier(id.value)
    if (!digits) continue
    // SIRET (scheme 0009) or SIREN (scheme 0002); an id without scheme counts when its Luhn key is right.
    if ((id.scheme === '0009' || id.scheme === null) && !siret && isValidSiret(digits)) siret = digits
    else if ((id.scheme === '0002' || id.scheme === null) && !siren && isValidSiren(digits)) siren = digits
  }
  if (siret && !siren) siren = siret.slice(0, 9)
  if (siret && siren && !siret.startsWith(siren)) siret = null
  const vat = normalizeVatNumber(raw.vatNumber)
  const vatNumber = vat && isValidVatNumber(vat) && (!vat.startsWith('FR') || !siren || vat.endsWith(siren)) ? vat : null
  const a = raw.address
  const street = oneLine(a?.lines[0])
  const country = a?.country?.trim().toUpperCase() ?? ''
  const address =
    a && street && a.postalCode?.trim() && a.city?.trim() && /^[A-Z]{2}$/.test(country)
      ? {
          street: street.slice(0, 200),
          street2: a.lines.slice(1).map(oneLine).filter(Boolean).join(', ').slice(0, 200) || null,
          postalCode: a.postalCode.trim().slice(0, 20),
          city: oneLine(a.city).slice(0, 100),
          country,
        }
      : null
  return { name: (oneLine(raw.name) || fallbackName).slice(0, 200), siren, siret, vatNumber, address }
}

/** The breakdown per rate, merged by rate (two categories at 0 % make one row, invoice_vat_breakdowns is unique per rate). */
function breakdownOf(raw: RawEInvoice): { rows: VatBreakdownRow[]; categories: Set<string> } | string {
  const byRate = new Map<number, VatBreakdownRow>()
  const categories = new Set<string>()
  for (const vat of raw.vat) {
    const rate = rateBp(vat.rate, vat.category)
    const base = amountCents(vat.base)
    const amount = amountCents(vat.amount) ?? (rate === 0 ? 0 : null)
    if (rate === null) return 'taux de TVA illisible dans le détail par taux'
    if (base === null || amount === null) return `base ou montant de TVA illisible au taux de ${formatVatRate(rate)}`
    if (base < 0 || amount < 0) return 'montants négatifs dans le détail de la TVA : Kledg importe un avoir (type 381) en montants positifs'
    if (vat.category) categories.add(vat.category.toUpperCase())
    const row = byRate.get(rate) ?? { vatRateBp: rate, baseCents: 0, vatCents: 0 }
    row.baseCents += base
    row.vatCents += amount
    byRate.set(rate, row)
  }
  return { rows: [...byRate.values()].sort((a, b) => b.vatRateBp - a.vatRateBp), categories }
}

/** The document's lines when they add up to the breakdown, rate by rate (see the module header); null otherwise. */
function documentLines(raw: RawEInvoice, rows: VatBreakdownRow[]): EInvoiceLine[] | null {
  if (raw.lines.length === 0 || raw.lines.length > MAX_LINES) return null
  const lines: EInvoiceLine[] = []
  for (const [index, line] of raw.lines.entries()) {
    const net = amountCents(line.netAmount)
    const rate = rateBp(line.vatRate, line.vatCategory)
    if (net === null || net < 0 || rate === null) return null
    const label = (oneLine(line.name) || `Ligne ${index + 1}`).slice(0, 500)
    const quantity = parseQuantity(line.quantity?.trim().replace(/^(\d+\.\d{3})0+$/, '$1'))
    const baseQuantity = line.baseQuantity?.trim() ? parseQuantity(line.baseQuantity.trim()) : 1000
    const price = baseQuantity === 1000 ? amountCents(line.netPrice) : null
    const exact = quantity !== null && quantity > 0 && price !== null && price >= 0 && lineTotalCents(quantity, price) === net
    lines.push(
      exact
        ? { label, quantityThousandths: quantity, unitPriceCents: price, vatRateBp: rate, totalExclTaxCents: net }
        : { label, quantityThousandths: 1000, unitPriceCents: net, vatRateBp: rate, totalExclTaxCents: net },
    )
  }
  const bases = computeInvoiceTotals(lines).breakdown
  const same = bases.length === rows.length && rows.every((row) => bases.some((b) => b.vatRateBp === row.vatRateBp && b.baseCents === row.baseCents))
  return same ? lines : null
}

export function normalizeEInvoice(raw: RawEInvoice): EInvoiceParseResult {
  const number = raw.number?.trim()
  if (!number) return refuse('numéro de facture absent (BT-1)')
  if (number.length > 60) return refuse('numéro de facture de plus de 60 caractères')
  const code = raw.typeCode?.trim() ?? ''
  const typeCode = TYPE_CODES[code]
  if (!typeCode) return refuse(`document de type ${code || 'inconnu'} : Kledg importe les factures (380) et les avoirs (381)`)
  if (!raw.issueDate) return refuse('date de facture absente ou illisible (BT-2)')
  const currency = raw.currency?.trim().toUpperCase()
  if (currency !== 'EUR') return refuse(`facture en ${currency || 'devise inconnue'} : Kledg importe les factures en euros`)

  const breakdown = breakdownOf(raw)
  if (typeof breakdown === 'string') return refuse(breakdown)
  const taxBasis = amountCents(raw.totals.taxBasis)
  const taxTotal = amountCents(raw.totals.taxTotal)
  const grandTotal = amountCents(raw.totals.grandTotal)
  if (grandTotal === null) return refuse('total TTC absent ou illisible (BT-112)')
  if (grandTotal < 0) return refuse('total négatif : Kledg importe un avoir (type 381) en montants positifs')
  let rows = breakdown.rows
  if (rows.length === 0) {
    // MINIMUM profile without breakdown: acceptable only without VAT.
    if ((taxTotal ?? 0) !== 0 || taxBasis === null) return refuse('détail de la TVA par taux absent (profil MINIMUM) : saisissez la facture dans Kledg')
    rows = [{ vatRateBp: 0, baseCents: taxBasis, vatCents: 0 }]
  }
  const sumBase = rows.reduce((sum, row) => sum + row.baseCents, 0)
  const sumVat = rows.reduce((sum, row) => sum + row.vatCents, 0)
  if (taxBasis !== null && taxBasis !== sumBase) return refuse('le total hors taxe ne correspond pas à la somme des bases par taux (règle BR-CO-13)')
  if (taxTotal !== null && taxTotal !== sumVat) return refuse('le total de TVA ne correspond pas au détail par taux (règle BR-CO-14)')
  if (sumBase + sumVat !== grandTotal) return refuse('le total TTC ne correspond pas au total hors taxe plus la TVA (règle BR-CO-15)')

  const seller = partyOf(raw.seller, '')
  if (!seller.name) return refuse('nom du vendeur absent (BT-27)')
  const buyer = partyOf(raw.buyer, '')

  const warnings: string[] = []
  let lines = documentLines(raw, rows)
  if (!lines) {
    const allowances = (amountCents(raw.totals.allowances) ?? 0) !== 0 || (amountCents(raw.totals.charges) ?? 0) !== 0
    const negative = raw.lines.some((line) => (amountCents(line.netAmount) ?? 0) < 0)
    warnings.push(
      raw.lines.length === 0
        ? 'La facture ne détaille pas ses lignes : Kledg enregistre une ligne par taux de TVA.'
        : raw.lines.length > MAX_LINES
          ? `La facture a ${raw.lines.length} lignes (${MAX_LINES} au plus dans Kledg) : Kledg enregistre une ligne par taux de TVA.`
          : allowances
            ? 'La facture porte des remises ou des frais sur son total : Kledg enregistre une ligne par taux de TVA, au montant de la base.'
            : negative
              ? 'La facture a des lignes négatives (remise, retour) : Kledg enregistre une ligne par taux de TVA, au montant de la base.'
              : 'Les lignes de la facture ne correspondent pas à son détail de TVA : Kledg enregistre une ligne par taux de TVA, au montant de la base.',
    )
    const shown = rows.filter((row) => row.baseCents > 0 || rows.length === 1)
    lines = shown.map((row) => ({
      label: `Facture ${number} ${seller.name}${shown.length > 1 ? `, base au taux de ${formatVatRate(row.vatRateBp)}` : ''}`.slice(0, 500),
      quantityThousandths: 1000,
      unitPriceCents: row.baseCents,
      vatRateBp: row.vatRateBp,
      totalExclTaxCents: row.baseCents,
    }))
  }

  if (breakdown.categories.has('AE')) {
    warnings.push('Autoliquidation (catégorie AE) : la TVA due par l’acheteur n’est pas sur la facture, Kledg ne la comptabilise pas. Passez-la dans une écriture (CGI art. 283).')
  }
  if (breakdown.categories.has('K')) {
    warnings.push('Acquisition intracommunautaire (catégorie K) : la TVA due par l’acheteur n’est pas sur la facture, Kledg ne la comptabilise pas. Passez-la dans une écriture (CGI art. 256 bis).')
  }
  for (const row of rows) {
    if (row.vatRateBp > 0 && !isFrenchVatRate(row.vatRateBp)) warnings.push(`Taux de ${formatVatRate(row.vatRateBp)} : ce n’est pas un taux de TVA français, Kledg ne comptabilisera pas cette facture : saisissez la TVA étrangère à la main.`)
  }
  const prepaidCents = Math.max(0, amountCents(raw.totals.prepaid) ?? 0)
  if (prepaidCents > 0) {
    warnings.push(`Acompte de ${formatCentsFr(prepaidCents)} déjà versé selon la facture : le reste à payer est de ${formatCentsFr(grandTotal - prepaidCents)}.`)
  }

  const totals = totalsOfBreakdown(
    lines.map((line) => line.totalExclTaxCents),
    rows,
  )
  const amounts = [...lines.flatMap((l) => [l.unitPriceCents, l.totalExclTaxCents]), ...rows.flatMap((r) => [r.baseCents, r.vatCents]), totals.totalInclTaxCents]
  if (!amounts.every(fitsAmountColumn)) return refuse('montant trop élevé')

  const dueDate = raw.dueDate && raw.dueDate >= raw.issueDate ? raw.dueDate : null
  return {
    kind: 'ok',
    invoice: { format: raw.format, specification: raw.specification, number, typeCode, issueDate: raw.issueDate, dueDate, seller, buyer, lines, totals, prepaidCents, warnings },
  }
}
