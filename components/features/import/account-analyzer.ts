/**
 * Account analysis utilities for FEC import
 * 
 * This module contains logic for analyzing FEC accounts and matching them
 * to existing Kledg accounts using various matching strategies.
 */

import { getAccountByCode } from '@/lib/accounting/pcg-utils'
import { simplifyAccountCode, getParentAccountCode, type AccountPreview } from '@/components/features/import/account-mapping-utils'
import { normalizeText, textSimilarity } from '@/components/features/import/column-detector'

/**
 * Existing account type
 */
export interface ExistingAccount {
  id: string
  code: string
  label: string
}

/**
 * Finds a matching account for a FEC account code and label
 * 
 * Uses multiple matching strategies:
 * 1. Exact code match (highest priority)
 * 2. Simplified code match
 * 3. Label similarity match
 * 
 * @param code - FEC account code
 * @param label - FEC account label
 * @param codeToAccountMap - Map of exact codes to accounts
 * @param simplifiedCodeToAccountsMap - Map of simplified codes to account arrays
 * @param allAccounts - All existing accounts (for label matching)
 * @returns Matching account or null
 */
export function findMatchingAccount(
  code: string,
  label: string,
  codeToAccountMap: Map<string, ExistingAccount>,
  simplifiedCodeToAccountsMap: Map<string, ExistingAccount[]>,
  _allAccounts: ExistingAccount[]
): ExistingAccount | null {
  const simplifiedCode = simplifyAccountCode(code)

  // STEP 1: Search by exact code (absolute priority)
  if (codeToAccountMap.has(code)) {
    return codeToAccountMap.get(code)!
  }

  // STEP 2: Search by simplified code (trailing-zero equivalence only)
  const accountsWithSimplifiedCode = simplifiedCodeToAccountsMap.get(simplifiedCode)
  if (accountsWithSimplifiedCode && accountsWithSimplifiedCode.length > 0) {
    // If multiple accounts share the same simplified code, break ties on label.
    if (label && accountsWithSimplifiedCode.length > 1) {
      const normalizedLabel = normalizeText(label)
      let bestMatch: ExistingAccount | null = null
      let bestSimilarity = 0

      for (const acc of accountsWithSimplifiedCode) {
        const similarity = textSimilarity(normalizedLabel, normalizeText(acc.label))
        if (similarity > bestSimilarity) {
          bestSimilarity = similarity
          bestMatch = acc
        }
      }

      if (bestMatch && bestSimilarity > 0.7) {
        return bestMatch
      }
    }

    return accountsWithSimplifiedCode[0]
  }

  // Label-similarity fallback across all accounts was removed: it caused
  // "Banque" (code 512001) to be auto-mapped to PCG root 51, silently collapsing
  // distinct FEC codes onto a single existing account. Unmatched codes now fall
  // through so the import pipeline creates a new account with the original code.
  return null
}

/**
 * Creates account lookup maps for efficient matching
 * 
 * @param accounts - Array of existing accounts
 * @returns Object with codeToAccountMap and simplifiedCodeToAccountsMap
 */
export function createAccountMaps(accounts: ExistingAccount[]): {
  codeToAccountMap: Map<string, ExistingAccount>
  simplifiedCodeToAccountsMap: Map<string, ExistingAccount[]>
} {
  const codeToAccountMap = new Map<string, ExistingAccount>()
  const simplifiedCodeToAccountsMap = new Map<string, ExistingAccount[]>()
  
  accounts.forEach((acc) => {
    // Mapping by exact code
    codeToAccountMap.set(acc.code, acc)
    
    // Mapping by simplified code (all accounts with this simplified code)
    const simplified = simplifyAccountCode(acc.code)
    if (!simplifiedCodeToAccountsMap.has(simplified)) {
      simplifiedCodeToAccountsMap.set(simplified, [])
    }
    simplifiedCodeToAccountsMap.get(simplified)!.push(acc)
  })
  
  return { codeToAccountMap, simplifiedCodeToAccountsMap }
}

/**
 * Analyzes FEC accounts and creates preview information
 * 
 * @param accountsMap - Map of FEC account codes to labels
 * @param existingAccounts - Array of existing Kledg accounts
 * @returns Array of account previews
 */
export function analyzeFECAccounts(
  accountsMap: Map<string, { label: string }>,
  existingAccounts: ExistingAccount[]
): AccountPreview[] {
  const { codeToAccountMap, simplifiedCodeToAccountsMap } = createAccountMaps(existingAccounts)
  
  const preview: AccountPreview[] = Array.from(accountsMap.entries())
    .map(([code, { label }]) => {
      const parentCode = getParentAccountCode(code)
      const parentPcgAccount = parentCode ? getAccountByCode(parentCode) : null
      
      // Find matching account
      const matchedAccount = findMatchingAccount(
        code,
        label,
        codeToAccountMap,
        simplifiedCodeToAccountsMap,
        existingAccounts
      )
      const exists = matchedAccount !== null
      
      return {
        code,
        label: label || code,
        parentCode,
        parentLabel: parentPcgAccount?.label || parentCode || null,
        exists,
        mappedToAccountId: matchedAccount?.id || null,
      }
    })
    .sort((a, b) => a.code.localeCompare(b.code))
  
  return preview
}
