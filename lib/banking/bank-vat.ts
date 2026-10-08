/**
 * The VAT a bank read on the receipt of a transaction (Qonto), one reading
 * and one plausibility rule for every module that uses it: simple mode, the
 * assignment rules and their preview, the reconciliation dialog and its
 * overview. Pure module (the rule editor imports it in the browser).
 *
 * Reading: the stored columns first (vatRate, vatAmount), then the provider
 * payload (vat_rate, vat_amount in euros, vat_amount_cents). A negative or
 * non-finite rate is no rate (Qonto sends -1 for "taux non standard").
 *
 * Trust, against the amount paid (TTC):
 * - an amount above zero is kept when it is below the amount paid and at
 *   most 20 % of the base, the highest French rate (CGI art. 278), with one
 *   cent of rounding; an OCR reading of 150 € on a 100 € payment is not;
 * - zero means "no VAT on the receipt" only when the bank also gives a rate
 *   of 0 % (the receipt was read, or the user set 0 % in the bank); a zero
 *   without a rate is a receipt the bank did not read, and the rate of the
 *   category or of the rule applies;
 * - a rate is kept between 0 % and 20 %.
 * Anything else counts as nothing read: the caller falls back to its own rate.
 */

import { toCents } from '@/lib/utils/money'

/** Highest French rate (CGI art. 278): a VAT read above it is not trusted. */
export const MAX_BANK_VAT_RATE_PERCENT = 20

export interface BankVatSource {
  /** Amount of the transaction (TTC), signed or not: what the VAT is checked against. */
  amount?: { toString(): string } | number | string | null
  vatRate?: { toString(): string } | number | string | null
  vatAmount?: { toString(): string } | number | string | null
  providerData?: unknown
}

export interface BankVatReading {
  /** Rate in percent, null when none was read. */
  ratePercent: number | null
  /** VAT amount in cents, null when none was read. */
  amountCents: number | null
}

function numberOf(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = typeof value === 'number' ? value : Number(String(value))
  return Number.isFinite(n) ? n : null
}

/** What the bank read, before any check: null when it read nothing. */
export function readBankVat(tx: BankVatSource): BankVatReading | null {
  const provider = (tx.providerData ?? null) as { vat_rate?: unknown; vat_amount?: unknown; vat_amount_cents?: unknown } | null
  const rate = numberOf(tx.vatRate) ?? numberOf(provider?.vat_rate)
  const ratePercent = rate != null && rate >= 0 ? rate : null
  const columnAmount = numberOf(tx.vatAmount)
  const providerEuros = numberOf(provider?.vat_amount)
  const providerCents = numberOf(provider?.vat_amount_cents)
  const amountCents =
    columnAmount != null
      ? toCents(columnAmount)
      : providerEuros != null
        ? toCents(providerEuros)
        : providerCents != null && Number.isSafeInteger(providerCents)
          ? providerCents
          : null
  return ratePercent != null || amountCents != null ? { ratePercent, amountCents } : null
}

/** The VAT amount read, when it can be trusted on a payment of `amountCents` (TTC, absolute): null otherwise. */
export function trustedBankVatCents(amountCents: number, reading: BankVatReading | null | undefined): number | null {
  const vat = reading?.amountCents
  if (vat == null || !Number.isSafeInteger(vat) || vat < 0) return null
  if (vat === 0) return reading?.ratePercent === 0 ? 0 : null
  if (vat >= amountCents) return null
  const base = amountCents - vat
  return vat * 100 <= base * MAX_BANK_VAT_RATE_PERCENT + 100 ? vat : null
}

/** The rate read, when it is a rate a French receipt can carry (0 % to 20 %): null otherwise. */
export function trustedBankVatRate(reading: BankVatReading | null | undefined): number | null {
  const rate = reading?.ratePercent
  return rate != null && rate >= 0 && rate <= MAX_BANK_VAT_RATE_PERCENT ? rate : null
}

/**
 * The VAT the bank read on a payment of `amountCents`, with only what can be
 * trusted: null when nothing is left.
 */
export function bankVatOf(tx: BankVatSource, amountCents: number): BankVatReading | null {
  const reading = readBankVat(tx)
  const trusted = { ratePercent: trustedBankVatRate(reading), amountCents: trustedBankVatCents(amountCents, reading) }
  return trusted.ratePercent != null || trusted.amountCents != null ? trusted : null
}

/** The same, in euros, as the rule engine reads it (TransactionVatContext). */
export function bankVatInEuros(tx: BankVatSource, amountCents: number): { vatRate: number | null; vatAmount: number | null } | null {
  const vat = bankVatOf(tx, amountCents)
  return vat ? { vatRate: vat.ratePercent, vatAmount: vat.amountCents != null ? vat.amountCents / 100 : null } : null
}

/** The VAT amount read on the transaction itself, in cents, when it can be trusted (simple mode): 0 is "no VAT on the receipt". */
export function bankVatCentsOf(tx: BankVatSource): number | null {
  return trustedBankVatCents(Math.abs(toCents(tx.amount ?? 0) ?? 0), readBankVat(tx))
}
