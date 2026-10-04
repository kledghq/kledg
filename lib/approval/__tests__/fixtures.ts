/**
 * Contexts and details of the approval pack tests: a company of each legal
 * form with a profit of 50 000 € on the fiscal year 2025, two associés
 * (60 % and 40 %) or one, and details complete enough to generate every
 * document. Fictitious names only.
 */

import type { ApprovalContext } from '../pack'
import { ApprovalDetailsSchema, type ApprovalDetails, type ApprovalDetailsInput } from '../schemas'

export function contextFor(legalType: string | null, overrides: Partial<ApprovalContext> = {}): ApprovalContext {
  const sole = legalType === 'EURL' || legalType === 'SASU'
  return {
    today: '2026-05-04',
    company: {
      name: 'Atelier Lumen',
      siren: '123456789',
      legalType,
      shareCapitalCents: 1_000_000,
      address: '2 rue Neuve, 69001 Lyon',
      isHolding: false,
      corporateTaxRegime: legalType === 'SCI' ? null : 'simplified',
      accountsFiledOnline: false,
    },
    fiscalYear: { id: 'fy25', year: 2025, startDate: '2025-01-01', endDate: '2025-12-31', isClosed: true },
    holders: sole
      ? [{ id: 'h1', name: 'Jeanne Martin', kind: 'PHYSICAL', shares: 1000 }]
      : [
          { id: 'h1', name: 'Jeanne Martin', kind: 'PHYSICAL', shares: 600 },
          { id: 'h2', name: 'Holding Beta', kind: 'LEGAL', shares: 400 },
        ],
    totalShares: 1000,
    balances: { resultCents: 5_000_000, legalReserveCents: 0, capitalCents: 1_000_000, retainedEarningsCents: 0, priorLossesCents: 0 },
    figures: { revenueCents: 30_000_000, totalAssetsCents: 20_000_000, previous: { revenueCents: 25_000_000, totalAssetsCents: 18_000_000 } },
    draftEntries: 0,
    ...overrides,
  }
}

export const COMPLETE: ApprovalDetailsInput = {
  rcsCity: 'Lyon',
  signatureCity: 'Lyon',
  meeting: { date: '2026-06-15', time: '10 h 00', place: 'au siège social', convocationDate: '2026-05-29' },
  chair: { name: 'Jeanne Martin' },
  officers: [{ name: 'Jeanne Martin' }],
  attendance: [
    { shareholderId: 'h1', status: 'present' },
    { shareholderId: 'h2', status: 'represented', proxy: 'Paul Durand' },
  ],
  statutoryRule: { kind: 'majority', base: 'cast', percent: 50, article: '18' },
  votes: { approval: { unanimous: true }, agreements: { unanimous: true }, allocation: { for: 600, against: 400 }, powers: { unanimous: true } },
  allocation: { dividendsCents: 2_000_000 },
  priorDividends: [
    { year: 2024, amountCents: 0 },
    { year: 2023, amountCents: 150_000 },
    { year: 2022, amountCents: 0 },
  ],
  nonDeductibleExpensesCents: 0,
  regulatedAgreements: 'none',
  hasAuditor: false,
  size: { category: 'micro', employees: 3 },
  groupMember: false,
  confidentiality: 'full',
  managementReport: { produce: true, activity: 'Une année de croissance.', outlook: 'Stabilité.', postClosingEvents: 'Aucun.', research: 'Aucune.' },
}

export const details = (input: ApprovalDetailsInput = {}): ApprovalDetails => ApprovalDetailsSchema.parse(input)
export const complete = (patch: ApprovalDetailsInput = {}): ApprovalDetails => ApprovalDetailsSchema.parse({ ...COMPLETE, ...patch })
