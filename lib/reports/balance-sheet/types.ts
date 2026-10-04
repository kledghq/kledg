/**
 * Types and interfaces for balance sheet configuration and generation
 */

import type { AccountBalance } from '../types'

/**
 * Display type for balance sheet lines
 * - 'net': Display only net value (default)
 * - 'brut_amort_net': Display brut, amortissements, and net columns (for assets with depreciation)
 */
export type BalanceSheetDisplayType = 'net' | 'brut_amort_net'

/**
 * Line type for balance sheet configuration
 * - 'group': A visual grouping element (no calculation, just organization)
 * - 'sum': A group that sums its children (no account codes, calculated total)
 * - 'line': A line with account codes
 */
export type BalanceSheetLineType = 'group' | 'sum' | 'line'

/**
 * Balance sheet line configuration
 */
export interface BalanceSheetLineConfig {
  id: string
  companyId: string
  reportVariant: 'complete' | 'simplified'
  parentId?: string | null // Parent line ID for nested structure (null for root lines)
  section?: 'actif' | 'passif' | null // Explicit section for easy sorting
  lineLabel: string
  lineType: BalanceSheetLineType // 'group' (somme des enfants) ou 'line' (avec comptes)
  formCode?: string | null // Form code from official forms (e.g., "010", "120") - for Brut column
  amortissementFormCode?: string | null // Form code for Amortissements column (e.g., "AC", "CQ")
  accountCodes: string[] // Empty for groups, populated for lines (comptes pour la colonne Brut)
  excludedAccountCodes: string[]
  amortissementAccountCodes: string[] // Comptes pour la colonne Amortissement (28xx, 29xx, 39xx, etc.)
  filterType?: string | null // 'starts_with' | 'exact' | 'range' | 'custom'
  filterValue?: string | null
  balanceType: 'debit' | 'credit' | 'auto'
  displayType: BalanceSheetDisplayType // Type d'affichage : net seul ou brut/amortissement/net
  hideLabel: boolean // Hide the label for this line (useful for groups)
  order: number
  notes?: string | null
  version: number
  templateId?: string | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  children?: BalanceSheetLineConfig[] // Nested children (populated when loading with relations)
}

/**
 * Collection of balance sheet line configurations
 */
export interface BalanceSheetConfig {
  companyId: string
  reportVariant: 'complete' | 'simplified'
  lines: BalanceSheetLineConfig[]
}

/**
 * Calculated balance sheet line with values
 */
export interface BalanceSheetLine {
  id: string
  lineLabel: string
  formCode?: string | null
  value: number
  brut?: number // For assets with depreciation
  amortissements?: number // Depreciation/provisions
  net: number
  accounts: AccountBalance[]
  children?: BalanceSheetLine[]
  hideLabel?: boolean // Hide the label for this line (useful for groups)
  order: number
  notes?: string | null
}

/**
 * Balance sheet section (Actif or Passif)
 */
export interface BalanceSheetSection {
  label: string
  lines: BalanceSheetLine[]
  total: number
  brutTotal?: number
  amortissementsTotal?: number
  netTotal: number
}

/**
 * Generated balance sheet data
 */
export interface BalanceSheetData {
  companyId: string
  fiscalYearId: string
  reportVariant: 'complete' | 'simplified'
  actif: BalanceSheetSection
  passif: BalanceSheetSection
  actifTotal: number
  passifTotal: number
  imbalance?: number // Difference if Actif ≠ Passif
  diagnostic?: ImbalanceDiagnostic
  /** Result of the year (classes 6 and 7, closing entries excluded), included in the "Résultat de l'exercice" line */
  netResult?: number
  /** Problems the user must see: unmapped accounts, balances outside the statements */
  warnings?: string[]
  /** Stored layout: current default, just upgraded from a previous default, or customized (see lib/reports/statements/layout-upgrade.ts) */
  layoutStatus?: 'default' | 'upgraded' | 'customized'
  generatedAt: Date
}

/**
 * Imbalance diagnostic information
 */
export interface ImbalanceDiagnostic {
  imbalance: number // Actif - Passif
  severity: 'warning' | 'error'
  causes: {
    unbalancedEntries: Array<{
      entryId: string
      reference: string
      date: Date
      debitTotal: number
      creditTotal: number
      difference: number
      link: string
    }>
    unmappedAccounts: Array<{
      accountId: string
      code: string
      label: string
      balance: number
      suggestion: string
    }>
    configurationIssues: Array<{
      lineId: string
      issue: string
      suggestion: string
    }>
  }
  suggestions: string[]
}

/**
 * Balance sheet comparison data (N vs N-1)
 */
export interface BalanceSheetComparison {
  current: BalanceSheetData
  previous: BalanceSheetData
  variations: {
    actifVariation: number
    actifVariationPercent: number
    passifVariation: number
    passifVariationPercent: number
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
export interface BalanceSheetConfigHistory {
  id: string
  configId: string
  version: number
  data: BalanceSheetLineConfig
  changedBy?: string | null
  changeReason?: string | null
  createdAt: Date
}

/**
 * Configuration template
 */
export interface BalanceSheetConfigTemplate {
  id: string
  name: string
  description?: string | null
  reportVariant: 'complete' | 'simplified'
  isPublic: boolean
  createdBy?: string | null
  companyId?: string | null
  configData: BalanceSheetConfig
  usageCount: number
  createdAt: Date
  updatedAt: Date
}
