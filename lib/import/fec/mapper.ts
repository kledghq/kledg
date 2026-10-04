/**
 * Account mapping utilities for FEC import
 * 
 * This module handles account code simplification and parent account resolution
 * according to PCG (Plan Comptable Général) standards.
 */

import { getAccountByCode } from '@/lib/accounting/pcg-utils';

/**
 * Simplifies an account code by removing trailing zeros
 * 
 * @param code - Account code to simplify
 * @returns Simplified account code
 * @example
 * simplifyAccountCode("65110000") // returns "6511"
 * simplifyAccountCode("41100000") // returns "411"
 */
export function simplifyAccountCode(code: string): string {
  if (!code) return code;
  // Remove trailing zeros
  return code.replace(/0+$/, '') || code;
}

/**
 * Determines the parent account code from an account code according to PCG
 * 
 * @param code - Account code to find parent for
 * @returns Parent account code or null if not found
 */
export function getParentAccountCode(code: string): string | null {
  if (!code || code.length <= 2) return null;

  // First simplify the code
  const simplifiedCode = simplifyAccountCode(code);

  // Check in PCG
  const pcgAccount = getAccountByCode(simplifiedCode);
  if (pcgAccount?.parentCode) {
    return pcgAccount.parentCode;
  }

  // Otherwise, use standard hierarchical logic
  // For an 8-digit code, the parent is 7 digits, then 6, etc.
  for (let i = simplifiedCode.length - 1; i >= 2; i--) {
    const parentCode = simplifiedCode.substring(0, i);
    const parentPcgAccount = getAccountByCode(parentCode);
    if (parentPcgAccount) {
      return parentCode;
    }
  }

  return null;
}
