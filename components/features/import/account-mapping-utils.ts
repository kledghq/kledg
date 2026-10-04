/**
 * Account mapping utilities for FEC import
 * 
 * This module contains utilities for mapping FEC account codes to Kledg accounts,
 * including account code simplification and parent account resolution.
 */

import { getAccountByCode } from '@/lib/accounting/pcg-utils'

/**
 * Account mapping type: FEC account code -> Kledg account ID (or null to create)
 */
export interface AccountMapping {
  [fileAccountCode: string]: string | null
}

/**
 * Account preview information
 */
export interface AccountPreview {
  code: string
  label: string
  parentCode: string | null
  parentLabel: string | null
  exists: boolean
  mappedToAccountId?: string | null
}

/**
 * Simplifies an account code by removing trailing zeros
 * 
 * @param code - Account code to simplify
 * @returns Simplified account code
 * @example
 * simplifyAccountCode("65110000") // Returns "6511"
 * simplifyAccountCode("41100000") // Returns "411"
 */
export function simplifyAccountCode(code: string): string {
  if (!code) return code
  // Remove trailing zeros
  return code.replace(/0+$/, '') || code
}

/**
 * Determines the parent account code from an account code
 * 
 * @param code - Account code
 * @returns Parent account code or null if no parent
 */
export function getParentAccountCode(code: string): string | null {
  if (!code || code.length <= 2) return null
  
  // First simplify the code
  const simplifiedCode = simplifyAccountCode(code)
  
  // First check in PCG
  const pcgAccount = getAccountByCode(simplifiedCode)
  if (pcgAccount?.parentCode) {
    return pcgAccount.parentCode
  }
  
  // Otherwise, use standard hierarchical logic
  // For an 8-digit code, the parent is 7 digits, then 6, etc.
  for (let i = simplifiedCode.length - 1; i >= 2; i--) {
    const parentCode = simplifiedCode.substring(0, i)
    const parentPcgAccount = getAccountByCode(parentCode)
    if (parentPcgAccount) {
      return parentCode
    }
  }
  
  // If no PCG parent found, return the class code (first 2 digits)
  if (simplifiedCode.length > 2) {
    return simplifiedCode.substring(0, 2)
  }
  
  return null
}

/**
 * Enhances account mapping with simplified code variants
 * 
 * Adds simplified code variants as alternative keys to facilitate lookup.
 * For example, if "65110000" -> accountId, also adds "6511" -> accountId
 * 
 * @param mapping - Base account mapping
 * @returns Enhanced mapping with simplified code variants
 */
export function enhanceAccountMapping(mapping: AccountMapping): AccountMapping {
  const enhanced: AccountMapping = { ...mapping }
  
  Object.entries(mapping).forEach(([fecCode, kledgAccountId]) => {
    if (kledgAccountId) {
      const simplified = simplifyAccountCode(fecCode)
      // Add the simplified code as a key alternative only if different and not already present
      if (simplified !== fecCode && !enhanced[simplified]) {
        enhanced[simplified] = kledgAccountId
      }
    }
  })
  
  return enhanced
}
