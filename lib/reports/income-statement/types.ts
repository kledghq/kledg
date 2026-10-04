/**
 * Types and interfaces for income statement configuration and generation
 */

import type { AccountBalance } from '../types'

/**
 * Income statement line configuration
 */
export interface IncomeStatementLineConfig {
  id: string
  companyId: string
  reportVariant: 'complete' | 'simplified'
  parentId?: string | null // Parent line ID for nested structure (null for root lines)
  section?: 'produits' | 'charges' | null // Explicit section for easy sorting
  lineLabel: string
  formCode?: string | null // Form code from official forms
  accountCodes: string[] // Account codes to include (classes 6 and 7)
  excludedAccountCodes: string[]
  filterType?: string | null // 'starts_with' | 'exact' | 'range' | 'custom'
  filterValue?: string | null
  balanceType: 'debit' | 'credit' | 'auto' // For charges vs products
  hideLabel: boolean // Hide the label for this line (useful for groups)
  order: number
  notes?: string | null
  version: number
  templateId?: string | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  children?: IncomeStatementLineConfig[] // Nested children (populated when loading with relations)
}

/**
 * Collection of income statement line configurations
 */
export interface IncomeStatementConfig {
  companyId: string
  reportVariant: 'complete' | 'simplified'
  lines: IncomeStatementLineConfig[]
}

/**
 * Calculated income statement line with values
 */
export interface IncomeStatementLine {
  id: string
  lineLabel: string
  formCode?: string | null
  value: number
  accounts: AccountBalance[]
  children?: IncomeStatementLine[]
  hideLabel?: boolean // Hide the label for this line (useful for groups)
  order: number
  notes?: string | null
}

/**
 * Income statement section (Produits or Charges)
 */
export interface IncomeStatementSection {
  label: string
  lines: IncomeStatementLine[]
  total: number
  subsections?: {
    exploitation?: IncomeStatementSection
    financiers?: IncomeStatementSection
    exceptionnels?: IncomeStatementSection
  }
}

/**
 * Generated income statement data
 */
export interface IncomeStatementData {
  companyId: string
  fiscalYearId: string
  reportVariant: 'complete' | 'simplified'
  produits: IncomeStatementSection
  charges: IncomeStatementSection
  totalProduits: number
  totalCharges: number
  netResult: number // Total Produits - Total Charges
  intermediateResults?: {
    resultatExploitation?: number
    resultatFinancier?: number
    resultatCourant?: number
    resultatExceptionnel?: number
  }
  validation?: {
    balanceSheetResult?: number // Result from balance sheet (account 12)
    matches: boolean
    difference?: number
  }
  /** Problems the user must see: unmapped or ambiguous accounts */
  warnings?: string[]
  /** Stored layout: current default, just upgraded from a previous default, or customized */
  layoutStatus?: 'default' | 'upgraded' | 'customized'
  /** Class 6 and 7 accounts with a balance that no line takes */
  unmappedAccounts?: AccountBalance[]
  generatedAt: Date
}

/**
 * Income statement comparison data (N vs N-1)
 */
export interface IncomeStatementComparison {
  current: IncomeStatementData
  previous: IncomeStatementData
  variations: {
    produitsVariation: number
    produitsVariationPercent: number
    chargesVariation: number
    chargesVariationPercent: number
    resultVariation: number
    resultVariationPercent: number
    lineVariations: Map<string, { // Map key is line ID
      absolute: number
      percent: number
      isSignificant: boolean
    }>
  }
}

/**
 * Configuration history entry
 */
export interface IncomeStatementConfigHistory {
  id: string
  configId: string
  version: number
  data: IncomeStatementLineConfig
  changedBy?: string | null
  changeReason?: string | null
  createdAt: Date
}

/**
 * Configuration template
 */
export interface IncomeStatementConfigTemplate {
  id: string
  name: string
  description?: string | null
  reportVariant: 'complete' | 'simplified'
  isPublic: boolean
  createdBy?: string | null
  companyId?: string | null
  configData: IncomeStatementConfig
  usageCount: number
  createdAt: Date
  updatedAt: Date
}
