/**
 * The facts other modules hold about a deadline of the calendar, so the
 * tracker never asks for them twice (lib/declarations/status.ts). Pure:
 * the service loads the rows, this maps them to deadlines.
 *
 * | Deadline | Module | Fact | Locked in the tracker |
 * | --- | --- | --- | --- |
 * | CA3, CA12 (tva-ca3, tva-ca12) | VAT filing record (lib/vat-returns) | filed on the day recorded, paid the same day when an amount is due (CGI art. 1692: the VAT is paid with the return) | filed, paid |
 * | Liasse (2065) | Corporate tax filing (lib/corporate-tax) | filed | filed |
 * | IS acompte n | Acomptes paid of the exercice (lib/corporate-tax) | paid, amount | paid |
 * | Approval, filing of the accounts | Approval pack (lib/approval) | approved, filed with the greffe | filed |
 * | CFE, CFE acompte | Avis entered (lib/local-taxes) | not due when the avis says zero | nothing |
 */

import type { Deadline } from '@/lib/deadlines/types'
import type { SourceFacts } from './status'

export interface VatFilingFact {
  filedOn: string
  amountDueCents: number
}

export interface CorporateTaxFact {
  fiscalYearId: string
  filedOn: string | null
  acomptesPaid: Array<{ number: number; paidOn: string; amountCents: number }>
}

export interface ApprovalFact {
  fiscalYearId: string
  approvedOn: string | null
  filedOn: string | null
}

export interface LocalTaxFact {
  cfeTotalCents: number | null
  cfeAcompteCents: number | null
}

export interface SourceData {
  /** By period key (2026-09, 2026-T3, 2026). */
  vatFilings: ReadonlyMap<string, VatFilingFact>
  /** By end of the fiscal year (yyyy-mm-dd), for the fiscal years in Kledg. */
  corporateTax: ReadonlyMap<string, CorporateTaxFact>
  /** By end of the fiscal year, for the fiscal years in Kledg (with or without an approval row). */
  approvals: ReadonlyMap<string, ApprovalFact>
  /** By calendar year. */
  localTaxes: ReadonlyMap<number, LocalTaxFact>
}

const keyOf = (id: string) => id.slice(id.indexOf(':') + 1)

export function sourceFactsOf(deadline: Pick<Deadline, 'id' | 'ruleId'>, data: SourceData): SourceFacts | null {
  const key = keyOf(deadline.id)
  switch (deadline.ruleId) {
    case 'tva-ca3':
    case 'tva-ca12': {
      const filing = data.vatFilings.get(key)
      return {
        source: 'vat-return',
        filedOn: filing?.filedOn ?? null,
        paidOn: filing && filing.amountDueCents > 0 ? filing.filedOn : null,
        amountCents: filing ? filing.amountDueCents : null,
        locked: ['filedOn', 'paidOn'],
        page: `declarations-tva?periode=${key}`,
        pageLabel: 'Déclarations de TVA',
      }
    }
    case 'liasse': {
      const row = data.corporateTax.get(key)
      if (!row) return null
      return { source: 'corporate-tax', filedOn: row.filedOn, locked: ['filedOn'], page: `impot-societes?exercice=${row.fiscalYearId}`, pageLabel: 'Impôt sur les sociétés' }
    }
    case 'is-acompte': {
      const [end, n] = key.split(':')
      const row = data.corporateTax.get(end)
      if (!row) return null
      const paid = row.acomptesPaid.find((a) => a.number === Number(n))
      return {
        source: 'corporate-tax',
        paidOn: paid?.paidOn ?? null,
        amountCents: paid?.amountCents ?? null,
        locked: ['paidOn'],
        page: `impot-societes?exercice=${row.fiscalYearId}`,
        pageLabel: 'Impôt sur les sociétés',
      }
    }
    case 'approbation':
    case 'depot-comptes': {
      const row = data.approvals.get(key)
      if (!row) return null
      return {
        source: 'approval',
        filedOn: deadline.ruleId === 'approbation' ? row.approvedOn : row.filedOn,
        locked: ['filedOn'],
        page: 'approval',
        pageLabel: 'Approbation des comptes',
      }
    }
    case 'cfe':
    case 'cfe-acompte': {
      const row = data.localTaxes.get(Number(key))
      const amount = deadline.ruleId === 'cfe' ? row?.cfeTotalCents : row?.cfeAcompteCents
      if (amount !== 0) return null
      // An avis of zero (exemption, or an acompte the avis does not ask): nothing to pay.
      return { source: 'local-taxes', notDue: true, amountCents: 0, locked: [], page: `impots-locaux?annee=${key}`, pageLabel: 'Impôts locaux' }
    }
    default:
      return null
  }
}
