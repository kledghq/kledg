/**
 * The liasse fiscale of a fiscal year as the page, the exports and the MCP
 * tool read it (pure): every table of the company's regime with where Kledg
 * prepares it, the tables prepared here with their cells, checks and
 * warnings, and the official sources.
 */

import type { CorporateTaxRegime } from '@/lib/corporate-tax/compute'
import { coverageOf, type LiasseForm } from './cells'
import { FILING_NOTE, LIASSE_TABLES, liasseSources, type LiasseSource, type TableStatus } from './tables'

export interface LiasseTable {
  id: string
  number: string
  title: string
  status: TableStatus
  href: string | null
  note: string | null
  /** Tables prepared here: cells computed and cells to fill by hand, checks to look at, whether it is due. */
  coverage: { computed: number; manual: number; checksToReview: number; required: boolean } | null
}

export interface LiasseView {
  /**
   * ready: the liasse of the regime; not-subject: the company is not subject
   * to the impôt sur les sociétés (impôt sur le revenu, micro); missing-regime:
   * its regime is not set.
   */
  status: 'ready' | 'not-subject' | 'missing-regime'
  regime: CorporateTaxRegime | null
  company: { name: string; siren: string }
  fiscalYear: { id: string; year: number; startDate: string; endDate: string; isClosed: boolean }
  tables: LiasseTable[]
  forms: LiasseForm[]
  warnings: string[]
  sources: LiasseSource[]
  filing: string
}

export interface AssembleInput {
  status: LiasseView['status']
  regime: CorporateTaxRegime | null
  company: LiasseView['company']
  fiscalYear: LiasseView['fiscalYear']
  forms: LiasseForm[]
  warnings: string[]
}

export function assembleLiasse(input: AssembleInput): LiasseView {
  const regime = input.status === 'ready' ? input.regime : null
  const tables: LiasseTable[] = regime
    ? LIASSE_TABLES[regime].map((def) => {
        const form = def.status === 'here' ? input.forms.find((f) => f.id === def.id) : undefined
        const coverage = form ? { ...coverageOf(form), checksToReview: form.checks.filter((c) => !c.ok).length, required: form.required.value } : null
        return { ...def, coverage }
      })
    : []
  return {
    status: input.status,
    regime,
    company: input.company,
    fiscalYear: input.fiscalYear,
    tables,
    forms: regime ? input.forms : [],
    warnings: input.warnings,
    sources: regime ? liasseSources(regime) : [],
    filing: FILING_NOTE,
  }
}
