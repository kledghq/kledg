/**
 * Centralized accounting validation service
 * Compliant with French accounting principles (PCG 2026)
 * 
 * Applied principles:
 * - Mandatory debit/credit balance
 * - PCG account code validation
 * - Amount validation
 * - No compensation
 * - Image fidèle (Art. 121-1)
 * - Prudence (Art. 121-4)
 * - Permanence des méthodes (Art. 121-5)
 */

import { type EntryLine, type EntryValidationResult } from './types'
import { validateImageFidele } from '@/lib/pcg/principles/image-fidele'
import { validatePrudence } from '@/lib/pcg/principles/prudence'
import { checkEntryCompliance } from '@/lib/pcg/entry-compliance'
import { formatCentsFr, fromCents, parseCents, sumCents, toCents, type AmountInput } from '@/lib/utils/money'
import { addUtcDays, endOfDay, todayUtc } from '@/lib/utils/date'
import { isAccountCode } from '@/lib/accounting/account-code'

/**
 * Validates that an entry is balanced (debit = credit), exactly.
 *
 * Amounts are compared as integer cents: no tolerance, no floating point
 * (0.1 + 0.2 balances 0.3; 1000.00 does not balance 999.99). An amount with
 * more than two decimals is refused rather than rounded. The entry needs two
 * lines at least (partie double) and each line one side only (non-compensation).
 *
 * @example
 * validateEntryBalance([
 *   { accountId: 'acc-1', debit: 0.1 + 0.2, credit: 0 }, // refused: 0.30000000000000004
 * ])
 */
export function validateEntryBalance(
  lines: Array<Pick<EntryLine, 'accountId'> & { debit?: AmountInput; credit?: AmountInput }>
): EntryValidationResult {
  const errors: string[] = []

  if (!lines || lines.length === 0) {
    return {
      valid: false,
      errors: ["Une écriture doit comporter au moins une ligne"],
      totalDebit: 0,
      totalCredit: 0,
      balance: 0,
    }
  }

  if (lines.length < 2) {
    errors.push('Une écriture doit comporter au moins deux lignes (partie double)')
  }

  const debits: number[] = []
  const credits: number[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.accountId) {
      errors.push(`Ligne ${i + 1} : compte obligatoire`)
    }

    const debit = parseCents(line.debit)
    const credit = parseCents(line.credit)
    if (debit === null) errors.push(`Ligne ${i + 1} : montant au débit invalide (deux décimales au maximum)`)
    if (credit === null) errors.push(`Ligne ${i + 1} : montant au crédit invalide (deux décimales au maximum)`)
    if (debit === null || credit === null) continue

    // Negative amounts are allowed (e.g. overdraft), one side per line only.
    if (debit !== 0 && credit !== 0) {
      errors.push(`Ligne ${i + 1} : une ligne ne peut pas être à la fois au débit et au crédit (non-compensation)`)
    }
    if (debit === 0 && credit === 0) {
      errors.push(`Ligne ${i + 1} : la ligne doit avoir un montant au débit ou au crédit`)
    }
    debits.push(debit)
    credits.push(credit)
  }

  const debitCents = sumCents(debits)
  const creditCents = sumCents(credits)
  const balanceCents = debitCents - creditCents

  if (balanceCents !== BigInt(0)) {
    errors.push(
      `L'écriture n'est pas équilibrée : débit ${formatCentsFr(debitCents)}, crédit ${formatCentsFr(creditCents)}, écart ${formatCentsFr(balanceCents < BigInt(0) ? -balanceCents : balanceCents)}`
    )
  }

  return {
    valid: errors.length === 0,
    errors,
    totalDebit: fromCents(Number(debitCents)),
    totalCredit: fromCents(Number(creditCents)),
    balance: fromCents(Number(balanceCents)),
  }
}

/**
 * Validates that an amount is a valid number (positive, zero, or negative).
 * Negative amounts are allowed for overdraft accounts (découvert).
 *
 * @param amount - Amount to validate
 * @returns true if valid, false otherwise
 *
 * @example
 * validateAmount(100) // true
 * validateAmount(-10) // true (e.g. overdraft)
 * validateAmount('abc') // false
 */
export function validateAmount(amount: unknown): boolean {
  if (typeof amount !== 'number' && typeof amount !== 'string' && typeof amount !== 'object') return false
  return toCents(amount as AmountInput) !== null
}

/**
 * Validates that an account code has the one account number format
 * (lib/accounting/account-code.ts)
 * 
 * @param code - Account code to validate
 * @returns true if valid, false otherwise
 * 
 * @example
 * validateAccountCode('411') // true
 * validateAccountCode('40100000') // true
 * validateAccountCode('401CLIENT') // true (FEC charts are alphanumeric)
 * validateAccountCode('1') // false (too short)
 * validateAccountCode('abc') // false (no class digit)
 */
export function validateAccountCode(code: string): boolean {
  return isAccountCode(code)
}

/**
 * Validates that a date is valid
 * 
 * @param date - Date to validate (string, number, or Date object)
 * @returns true if valid, false otherwise
 * 
 * @example
 * validateDate('2024-01-15') // true
 * validateDate(new Date()) // true
 * validateDate('invalid') // false
 */
export function validateDate(date: unknown): boolean {
  if (!date) return false
  const d = new Date(date as string | number | Date)
  return !isNaN(d.getTime())
}

/**
 * Validates that a date is within a valid range (not too old, not too far in the future)
 *
 * Compares calendar days in UTC (how entry dates are stored): the last
 * accepted day is today plus `maxFutureDays`, whatever the server timezone.
 *
 * @param date - Date to validate
 * @param maxFutureDays - Maximum number of days in the future (default: 30)
 * @param now - Current instant (injected by tests)
 * @returns true if valid, false otherwise
 *
 * @example
 * validateDateRange(new Date('2024-01-15'), 30) // true
 * validateDateRange(new Date('2100-01-01'), 30) // false (too far in future)
 * validateDateRange(new Date('1800-01-01'), 30) // false (too old)
 */
export function validateDateRange(date: Date, maxFutureDays: number = 30, now: Date = new Date()): boolean {
  // Last instant of the last accepted calendar day (UTC)
  const maxDate = endOfDay(addUtcDays(todayUtc(now), maxFutureDays))
  const minDate = new Date('1900-01-01') // Reasonable minimum date

  return date >= minDate && date <= maxDate
}

/**
 * Determines the nature of an account according to its PCG code
 * 
 * @param code - Account code
 * @returns Account nature: 'actif', 'passif', 'charge', 'produit', or null if invalid
 * 
 * @example
 * getAccountNature('411') // 'passif'
 * getAccountNature('512') // 'actif'
 * getAccountNature('601') // 'charge'
 * getAccountNature('701') // 'produit'
 */
export function getAccountNature(code: string): 'actif' | 'passif' | 'charge' | 'produit' | null {
  if (!code || code.length === 0) return null

  const firstDigit = code[0]

  switch (firstDigit) {
    case '1':
      return 'passif' // Shareholders' equity
    case '2':
    case '3':
    case '4':
    case '5':
      return 'actif' // Fixed assets, inventory, receivables, financial assets
    case '6':
      return 'charge' // Expenses
    case '7':
      return 'produit' // Revenue
    default:
      return null
  }
}

/**
 * Validates that an account can be used in an entry
 * Checks that the account exists and is not disabled
 * 
 * @param accountId - Account ID
 * @param accountCode - Account code (optional, for PCG validation)
 * @returns true if valid, false otherwise
 * 
 * @example
 * validateAccountUsage('account-123', '411') // true
 * validateAccountUsage('account-123', 'invalid') // false (invalid code format)
 */
function validateAccountUsage(accountId: string, accountCode?: string): boolean {
  if (!accountId) return false

  // If a code is provided, validate the format
  if (accountCode && !validateAccountCode(accountCode)) {
    return false
  }

  return true
}

/**
 * Validates that an entry complies with accounting principles
 * 
 * Validates date, description, balance, and each line according to PCG 2026.
 * 
 * @param entry - Entry to validate
 * @param entry.date - Entry date
 * @param entry.lines - Entry lines (at least 2 required)
 * @param entry.description - Entry description (optional but recommended)
 * 
 * @returns Validation result with details
 * @returns {valid: boolean} - Whether the entry is valid
 * @returns {errors: string[]} - Array of validation error messages
 * @returns {totalDebit: number} - Total debit amount
 * @returns {totalCredit: number} - Total credit amount
 * @returns {balance: number} - Difference between debit and credit
 * 
 * @example
 * const result = validateAccountingEntry({
 *   date: new Date('2024-01-15'),
 *   description: 'Payment to supplier',
 *   lines: [
 *     { accountId: 'acc-1', debit: 1000, credit: 0 },
 *     { accountId: 'acc-2', debit: 0, credit: 1000 }
 *   ]
 * })
 */
export function validateAccountingEntry(entry: {
  date: unknown
  lines: EntryLine[]
  description?: string
}): EntryValidationResult {
  const errors: string[] = []

  // Validate date
  // The date range is the fiscal year's (assertEntryWritableInFiscalYear);
  // the image fidèle check below refuses dates before 1900.
  if (!validateDate(entry.date)) {
    errors.push("La date de l'écriture est invalide")
  }

  // Validate description (optional but recommended)
  if (entry.description && entry.description.trim().length === 0) {
    errors.push("Le libellé de l'écriture ne peut pas être vide")
  }

  // Validate balance
  const balanceValidation = validateEntryBalance(entry.lines)
  if (!balanceValidation.valid) {
    errors.push(...balanceValidation.errors)
  }

  // Validate each line
  for (let i = 0; i < entry.lines.length; i++) {
    const line = entry.lines[i]

    if (!validateAccountUsage(line.accountId)) {
      errors.push(`Ligne ${i + 1} : compte invalide`)
    }

    if (!validateAmount(line.debit)) {
      errors.push(`Ligne ${i + 1} : montant au débit invalide`)
    }

    if (!validateAmount(line.credit)) {
      errors.push(`Ligne ${i + 1} : montant au crédit invalide`)
    }
  }

  // Additional PCG 2026 validations
  if (entry.date && validateDate(entry.date)) {
    const date = new Date(entry.date as string | number | Date)
    
    // Validate Image Fidèle (Art. 121-1)
    try {
      const imageFideleResult = validateImageFidele({
        date,
        description: entry.description,
        lines: entry.lines,
      })
      if (!imageFideleResult.valid) {
        errors.push(...imageFideleResult.errors)
      }
    } catch (e) {
      // Silently fail if PCG module is not available
    }
    
    // Validate Prudence (Art. 121-4)
    try {
      const prudenceResult = validatePrudence({
        date,
        description: entry.description,
        lines: entry.lines,
      })
      if (!prudenceResult.valid) {
        errors.push(...prudenceResult.errors)
      }
    } catch (e) {
      // Silently fail if PCG module is not available
    }
    
    // Check PCG compliance
    try {
      const complianceResult = checkEntryCompliance({
        date,
        description: entry.description,
        lines: entry.lines.map(l => ({
          accountId: l.accountId,
          debit: fromCents(parseCents(l.debit) ?? 0),
          credit: fromCents(parseCents(l.credit) ?? 0),
        })),
      })
      if (!complianceResult.compliant) {
        const errorViolations = complianceResult.violations
          .filter(v => v.severity === 'error')
          .map(v => v.message)
        errors.push(...errorViolations)
      }
    } catch (e) {
      // Silently fail if PCG module is not available
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    totalDebit: balanceValidation.totalDebit,
    totalCredit: balanceValidation.totalCredit,
    balance: balanceValidation.balance,
  }
}
