/**
 * Types pour le système de conformité PCG 2026
 */

export type PCGRuleType = 'regulatory' | 'infra-regulatory'

export type PCGBook = 'I' | 'II' | 'III' | 'IV' | 'V'

export interface PCGRuleCategory {
  book: PCGBook
  title: string
  chapter: string
  section: string
  subsection?: string
}

export interface ValidationCriteria {
  id: string
  description: string
  required: boolean
  validationFunction?: string // Nom de la fonction de validation
}

export interface PCGExample {
  id: string
  description: string
  code?: string
  expectedResult?: string
}

export interface TestCase {
  id: string
  description: string
  type: 'valid' | 'invalid' | 'edge-case'
  input: unknown
  expectedOutput: unknown
  articleId: string
}

export interface PCGRule {
  id: string // Ex: "211-1", "IR3-211-1"
  articleNumber: string // Ex: "Art. 211-1"
  type: PCGRuleType
  category: PCGRuleCategory
  title: string
  description: string
  fullText: string
  validationCriteria: ValidationCriteria[]
  examples: PCGExample[]
  testCases: TestCase[]
  relatedArticles: string[] // IDs d'articles liés
  pageNumber?: number
  lineNumber?: number
}

export interface PCGRulesCatalog {
  version: string
  extractionDate: Date
  totalRules: number
  regulatoryRules: number
  infraRegulatoryRules: number
  rules: PCGRule[]
  rulesByCategory: Record<string, PCGRule[]>
  rulesByArticle: Record<string, PCGRule>
}

export interface ComplianceStatus {
  ruleId: string
  status: 'compliant' | 'partial' | 'non-compliant' | 'not-implemented'
  implementationFile?: string
  testFile?: string
  notes?: string
  lastChecked: Date
}

export interface ComplianceReport {
  companyId?: string
  generatedAt: Date
  totalRules: number
  compliant: number
  partial: number
  nonCompliant: number
  notImplemented: number
  statuses: ComplianceStatus[]
  byCategory: Record<string, {
    total: number
    compliant: number
    partial: number
    nonCompliant: number
    notImplemented: number
  }>
}
