/**
 * Lettering (lettrage) rules on plain values. Pure module without imports:
 * the lettering screen and the server share it (docs/conventions.md, client
 * and server boundary).
 *
 * Lettering pairs the lines of a third-party account that settle each other
 * (an invoice and its payments, a credit note and the invoice it cancels):
 * they get the same code (FEC EcritureLet) and the day they were lettered
 * (FEC DateLet), LPF art. A47 A-1. A group is lettered only when its debits
 * equal its credits to the cent: Kledg has no partial lettering (see
 * docs/lettrage.md), an unbalanced selection is refused with the gap.
 *
 * Which accounts can be lettered (PCG art. 944-40 and 944-46, comptes de
 * tiers): customers 41 (411, 413, 416, 4181 factures à établir, 419 avances
 * reçues), suppliers 40 (401, 403, 404, 4081 factures non parvenues, 409
 * avances versées), personnel 42 (421 rémunérations dues, 425 avances),
 * associates 455 (comptes courants), 467 (autres comptes débiteurs ou
 * créditeurs) and 471 to 475 (comptes d'attente). Accounts that hold a
 * running balance rather than items to settle (VAT 445, social security 43,
 * banks 5) are not offered.
 */

/** Account number prefixes whose lines can be lettered. */
export const LETTERABLE_PREFIXES = ['40', '41', '421', '425', '455', '467', '471', '472', '473', '474', '475'] as const

/** Whether lines of this account can be lettered. */
export function isLetterableAccount(code: string): boolean {
  return LETTERABLE_PREFIXES.some((prefix) => code.startsWith(prefix))
}

/** A line as the selection check needs it: amounts in integer cents. */
export interface SelectableLine {
  id: string
  debitCents: number
  creditCents: number
  auxiliaryAccountNumber?: string | null
  letteringCode?: string | null
}

export interface SelectionCheck {
  debitCents: number
  creditCents: number
  /** debit - credit; 0 when the selection can be lettered. */
  balanceCents: number
  /** French reasons the selection cannot be lettered; empty when it can. */
  errors: string[]
}

/** French amount for messages ("1 234,56 €"), without Intl so it runs the same everywhere. */
export function formatEuros(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const euros = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return `${sign}${euros},${String(abs % 100).padStart(2, '0')} €`
}

/**
 * Whether these lines can be lettered together: at least two lines, none
 * already lettered, at most one auxiliary account (lines without one may
 * join: a bank payment often has none), and debits equal to credits.
 */
export function checkSelection(lines: readonly SelectableLine[]): SelectionCheck {
  let debitCents = 0
  let creditCents = 0
  for (const line of lines) {
    debitCents += line.debitCents
    creditCents += line.creditCents
  }
  const balanceCents = debitCents - creditCents
  const errors: string[] = []
  if (lines.length < 2) errors.push('Sélectionnez au moins deux lignes\u00a0: une facture et son règlement, par exemple.')
  const lettered = lines.filter((line) => line.letteringCode)
  if (lettered.length > 0) {
    const codes = [...new Set(lettered.map((line) => line.letteringCode))].join(', ')
    errors.push(`Des lignes sont déjà lettrées (${codes})\u00a0: délettrez-les d'abord.`)
  }
  const auxiliaries = [...new Set(lines.map((line) => line.auxiliaryAccountNumber?.trim()).filter((aux): aux is string => Boolean(aux)))]
  if (auxiliaries.length > 1) {
    errors.push(`Les lignes portent plusieurs comptes auxiliaires (${auxiliaries.join(', ')})\u00a0: lettrez les lignes d'un seul tiers à la fois.`)
  }
  if (lines.length >= 2 && balanceCents !== 0) {
    errors.push(
      `Le total des débits (${formatEuros(debitCents)}) doit égaler le total des crédits (${formatEuros(creditCents)})\u00a0: il reste un écart de ${formatEuros(Math.abs(balanceCents))}. Kledg ne lettre pas partiellement\u00a0: ajoutez les lignes qui soldent le tiers.`,
    )
  }
  return { debitCents, creditCents, balanceCents, errors }
}

/*
 * Lettering codes: AA, AB, ... AZ, BA, ... ZZ, then AAA, AAB... (letters
 * only, uppercase), one sequence per account. FEC EcritureLet is free text;
 * codes imported from another software that do not follow this pattern
 * (lowercase partial codes, digits) are kept as they are and ignored by
 * the sequence.
 */

const CODE = /^[A-Z]{2,}$/

/** Whether a code belongs to Kledg's sequence. */
export function isSequenceCode(code: string): boolean {
  return CODE.test(code)
}

/** Order of the sequence: shorter first, then alphabetical (AZ < BA < ZZ < AAA). */
export function compareCodes(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)
}

/** The code after `code` in the sequence (ZZ -> AAA). */
export function successorCode(code: string): string {
  const letters = code.split('')
  for (let i = letters.length - 1; i >= 0; i--) {
    if (letters[i] !== 'Z') {
      letters[i] = String.fromCharCode(letters[i].charCodeAt(0) + 1)
      return letters.join('')
    }
    letters[i] = 'A'
  }
  return 'A'.repeat(code.length + 1)
}

/**
 * The next code of an account: after the greatest code of the sequence
 * already used on it (lettered lines, including codes freed by an
 * unlettering are not reused once a later code exists), AA for the first.
 */
export function nextLetteringCode(usedCodes: Iterable<string | null | undefined>): string {
  let greatest: string | null = null
  for (const code of usedCodes) {
    if (!code || !isSequenceCode(code)) continue
    if (greatest === null || compareCodes(code, greatest) > 0) greatest = code
  }
  return greatest === null ? 'AA' : successorCode(greatest)
}
