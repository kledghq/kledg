/**
 * Type definitions for company information
 * 
 * This module contains TypeScript interfaces and types for company information.
 */

/**
 * Shareholder interface
 */
export interface Shareholder {
  id: string
  type: 'PHYSICAL' | 'LEGAL'
  name: string | null
  siret: string | null
  sharePercentage: number
  numberOfShares: number | null
  capitalAmount: number | null
  companyShareholderId: string | null
  personId: string | null
  notes?: string | null
}
