/**
 * PCG utility functions
 * 
 * This module provides utility functions for working with PCG (Plan Comptable Général) accounts.
 */

import { PCG_ACCOUNTS, type PCGAccount } from './pcg-data';

/**
 * Gets an account by its code
 * 
 * @param code - Account code
 * @returns PCG account or undefined if not found
 */
export function getAccountByCode(code: string): PCGAccount | undefined {
  return PCG_ACCOUNTS.find((account) => account.code === code);
}

/**
 * Validates that an account code follows PCG format
 * 
 * @param code - Account code to validate
 * @returns Whether the code is valid (2-8 digits)
 */
export function isValidAccountCode(code: string): boolean {
  // PCG format: 2 to 8 digits
  return /^\d{2,8}$/.test(code);
}

/**
 * Gets the account class (first digit) from an account code
 * 
 * @param code - Account code
 * @returns Account class number (1-8) or null if invalid
 */
export function getAccountClass(code: string): number | null {
  const match = code.match(/^(\d)/);
  return match ? parseInt(match[1], 10) : null;
}
