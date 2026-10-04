/**
 * Rules for the entry that reconciles a bank transaction ("Traiter la
 * transaction"). Pure functions shared by the dialog (inline errors) and the
 * API (which never trusts the client and runs them again on database data).
 *
 * The entry is the locked bank line plus the counterpart lines the user
 * types. The bank line is fixed by the transaction: account 512 (PCG art.
 * 932-1, classe 5 "Comptes financiers"), debited when money comes in,
 * credited when it goes out, for the exact transaction amount.
 *
 * All amounts are integer cents: totals are exact, never float sums.
 */

import { formatCentsFr } from '@/lib/utils/money'
import { formatIsoDateFr, isIsoDate } from '@/lib/utils/date'

export type BankSide = 'debit' | 'credit'

export interface ReconciliationLine {
  accountId: string
  /** Account code, for the VAT checks. Lines without a code skip them. */
  accountCode?: string | null
  debitCents: number | null
  creditCents: number | null
  description?: string | null
}

export interface FiscalYearPeriod {
  id: string
  year: number
  /** ISO dates (yyyy-mm-dd), bounds included. */
  startDate: string
  endDate: string
  isClosed: boolean
}

export interface ReconciliationDraft {
  journalId: string
  /** ISO date (yyyy-mm-dd). */
  date: string
  transaction: { amountCents: number; side: BankSide }
  /** Counterpart lines only: the bank line is derived from the transaction. */
  lines: ReconciliationLine[]
}

export interface Issue {
  /** 'journalId', 'date', 'lines', `lines.${i}.account` or `lines.${i}.amount`. */
  path: string
  message: string
}

export interface ReconciliationValidation {
  valid: boolean
  errors: Issue[]
  /** Worth a look, never blocking. */
  warnings: Issue[]
  bankLine: { debitCents: number; creditCents: number }
  totals: { debitCents: number; creditCents: number; differenceCents: number }
  fiscalYear: FiscalYearPeriod | null
}

export const MESSAGES = {
  journal: 'Choisissez un journal.',
  date: 'Date invalide : saisissez-la au format jj/mm/aaaa.',
  noLines: 'Ajoutez au moins une ligne de contrepartie.',
  account: 'Choisissez un compte.',
  amountMissing: 'Saisissez un débit ou un crédit.',
  amountBoth: 'Une ligne ne peut pas avoir à la fois un débit et un crédit.',
  amountNegative: 'Les montants doivent être positifs.',
  vatWithoutBase: 'La TVA doit accompagner au moins une ligne hors TVA (charge, produit ou immobilisation).',
} as const

/**
 * Highest French VAT rate (taux normal, CGI art. 278). VAT on an entry can
 * never exceed 20 % of its tax-free base, whatever the mix of rates.
 */
export const MAX_VAT_RATE_PERCENT = 20

/** Deductible VAT (PCG art. 944-44: 44562 on fixed assets, 44566 on goods and services). */
export const isDeductibleVatAccount = (code: string) => code.startsWith('44562') || code.startsWith('44566')
/** Collected VAT (PCG art. 944-44: 44571). */
export const isCollectedVatAccount = (code: string) => code.startsWith('44571')
/** Any VAT account (4452 autoliquidation, 4455 to pay, 4456 deductible, 4457 collected, 4458 to settle). */
export const isVatAccount = (code: string) => code.startsWith('445')
/** Bank and cash accounts (classe 5, 51 "Banques, établissements financiers et assimilés"). */
export const isBankAccountCode = (code: string) => code.startsWith('51')

/**
 * Splits an amount including VAT (TTC) into base and VAT at `ratePercent`
 * (20, 10, 5.5...): base = TTC / (1 + rate) rounded to the cent, VAT = TTC - base,
 * so the two always add up to the TTC amount.
 */
export function splitInclusiveAmount(ttcCents: number, ratePercent: number): { baseCents: number; vatCents: number } {
  const basisPoints = BigInt(Math.round(ratePercent * 100))
  const TEN_THOUSAND = BigInt(10000)
  const TWO = BigInt(2)
  const ttc = BigInt(ttcCents)
  const denominator = TEN_THOUSAND + basisPoints
  // Round half up: (2 * ttc * 10000 + denominator) / (2 * denominator)
  const base = (TWO * ttc * TEN_THOUSAND + denominator) / (TWO * denominator)
  return { baseCents: Number(base), vatCents: ttcCents - Number(base) }
}

/** VAT due at `ratePercent` on a tax-free amount, rounded to the cent (half up). */
export function vatOnBase(baseCents: number, ratePercent: number): number {
  const basisPoints = BigInt(Math.round(ratePercent * 100))
  const TWO = BigInt(2)
  const TEN_THOUSAND = BigInt(10000)
  return Number((TWO * BigInt(baseCents) * basisPoints + TEN_THOUSAND) / (TWO * TEN_THOUSAND))
}

/** The locked bank line: money in debits the bank account, money out credits it. */
export function bankLineOf(transaction: { amountCents: number; side: BankSide }) {
  const amount = Math.abs(transaction.amountCents)
  return transaction.side === 'credit'
    ? { debitCents: amount, creditCents: 0 }
    : { debitCents: 0, creditCents: amount }
}

/** The fiscal year whose period contains the ISO date (bounds included). */
export function fiscalYearForDate(fiscalYears: FiscalYearPeriod[], date: string): FiscalYearPeriod | null {
  return fiscalYears.find((fy) => fy.startDate <= date && date <= fy.endDate) ?? null
}

/** Checks the date: valid, in a fiscal year, and that year open. Returns the error or the year. */
export function checkEntryDate(
  fiscalYears: FiscalYearPeriod[],
  date: string,
): { error: string; fiscalYear: null } | { error: null; fiscalYear: FiscalYearPeriod } {
  if (!isIsoDate(date)) return { error: MESSAGES.date, fiscalYear: null }
  const fiscalYear = fiscalYearForDate(fiscalYears, date)
  if (!fiscalYear) {
    return {
      error: `Aucun exercice comptable ne couvre le ${formatIsoDateFr(date)} : créez l'exercice avant de rapprocher.`,
      fiscalYear: null,
    }
  }
  if (fiscalYear.isClosed) {
    return {
      error: `L'exercice ${fiscalYear.year} est clôturé : choisissez une date dans un exercice ouvert.`,
      fiscalYear: null,
    }
  }
  return { error: null, fiscalYear }
}

export function validateReconciliation(
  draft: ReconciliationDraft,
  context: {
    fiscalYears: FiscalYearPeriod[]
    /** VAT detected by the bank (Qonto), compared with the entry's VAT as a warning. */
    transactionVatCents?: number | null
  },
): ReconciliationValidation {
  const errors: Issue[] = []
  const warnings: Issue[] = []

  if (!draft.journalId) errors.push({ path: 'journalId', message: MESSAGES.journal })

  const dateCheck = checkEntryDate(context.fiscalYears, draft.date)
  if (dateCheck.error) errors.push({ path: 'date', message: dateCheck.error })

  const bankLine = bankLineOf(draft.transaction)
  let debitCents = bankLine.debitCents
  let creditCents = bankLine.creditCents

  if (draft.lines.length === 0) errors.push({ path: 'lines', message: MESSAGES.noLines })

  draft.lines.forEach((line, i) => {
    if (!line.accountId) errors.push({ path: `lines.${i}.account`, message: MESSAGES.account })
    const debit = line.debitCents ?? 0
    const credit = line.creditCents ?? 0
    if (!Number.isSafeInteger(debit) || !Number.isSafeInteger(credit) || debit < 0 || credit < 0) {
      errors.push({ path: `lines.${i}.amount`, message: MESSAGES.amountNegative })
      return
    }
    if (debit > 0 && credit > 0) errors.push({ path: `lines.${i}.amount`, message: MESSAGES.amountBoth })
    else if (debit === 0 && credit === 0) errors.push({ path: `lines.${i}.amount`, message: MESSAGES.amountMissing })
    debitCents += debit
    creditCents += credit
  })

  const differenceCents = debitCents - creditCents
  if (differenceCents !== 0 && draft.lines.length > 0) {
    errors.push({
      path: 'lines',
      message: `L'écriture n'est pas équilibrée : débit ${formatCentsFr(debitCents)}, crédit ${formatCentsFr(creditCents)} (écart ${formatCentsFr(Math.abs(differenceCents))}).`,
    })
  }

  const vat = checkVat(draft.lines)
  errors.push(...vat.errors)

  const bankVat = context.transactionVatCents
  if (bankVat != null && bankVat > 0 && vat.vatCents > 0 && vat.vatCents !== bankVat) {
    warnings.push({
      path: 'lines',
      message: `La TVA saisie (${formatCentsFr(vat.vatCents)}) diffère de la TVA détectée par la banque (${formatCentsFr(bankVat)}).`,
    })
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    bankLine,
    totals: { debitCents, creditCents, differenceCents },
    fiscalYear: dateCheck.fiscalYear,
  }
}

const net = (line: ReconciliationLine) => (line.debitCents ?? 0) - (line.creditCents ?? 0)

/**
 * VAT consistency of the counterpart lines:
 * - deductible or collected VAT needs a tax-free base line (a VAT line alone
 *   is not an operation, PCG art. 944-44);
 * - that VAT cannot exceed 20 % of the base (CGI art. 278, highest rate),
 *   with one cent of rounding per VAT line.
 * VAT settlements (4455, 44567, 4458...) are not taxed operations and are not checked.
 */
export function checkVat(lines: ReconciliationLine[]): { errors: Issue[]; vatCents: number; baseCents: number } {
  let deductible = 0
  let collected = 0
  let vatLines = 0
  let baseCents = 0
  for (const line of lines) {
    const code = line.accountCode
    if (!code) continue
    if (isDeductibleVatAccount(code)) {
      deductible += net(line)
      vatLines++
    } else if (isCollectedVatAccount(code)) {
      collected -= net(line)
      vatLines++
    } else if (!isVatAccount(code) && !isBankAccountCode(code)) {
      baseCents += Math.abs(net(line))
    }
  }

  const vatCents = Math.max(Math.abs(deductible), Math.abs(collected))
  const errors: Issue[] = []
  if (vatLines > 0 && vatCents > 0) {
    if (baseCents === 0) {
      errors.push({ path: 'lines', message: MESSAGES.vatWithoutBase })
    } else if (vatCents * 100 > baseCents * MAX_VAT_RATE_PERCENT + vatLines * 100) {
      errors.push({
        path: 'lines',
        message: `La TVA (${formatCentsFr(vatCents)}) dépasse ${MAX_VAT_RATE_PERCENT} % de la base hors taxe (${formatCentsFr(baseCents)}) : vérifiez le montant de TVA.`,
      })
    }
  }
  return { errors, vatCents, baseCents }
}
