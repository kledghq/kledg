/**
 * Year-end inventory on plain values (lib/year-end/inventory.ts): the
 * balance carried in, the balance required at the closing, what the linked
 * entry books (read from its lines) and what remains to book, for
 * provisions, impairments and investment grants.
 *
 * Sources: PCG art. 322-1 et seq. (provisions reviewed at each closing),
 * 214-15 et seq. and 214-19 (impairments, goodwill never reversed), 312-1
 * (grants), 1031-3 (validation by the user: movements are proposed as
 * drafts).
 */

import { describe, expect, it } from 'vitest'
import { grantYear, provisionYear, yearNumberOf, type LinkedEntry, type ProvisionInput, type YearRef, type GrantInput } from '../inventory'

const Y2025: YearRef = { id: 'fy25', year: 2025, startDate: '2025-01-01', endDate: '2025-12-31', isClosed: true }
const Y2026: YearRef = { id: 'fy26', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', isClosed: false }
const YEARS = [Y2025, Y2026]

function entry(id: string, fiscalYearId: string, lines: LinkedEntry['lines'], options: Partial<LinkedEntry> = {}): LinkedEntry {
  return { id, entryNumber: id.toUpperCase(), status: 'validated', fiscalYearId, reversed: false, lines, ...options }
}
const dotation = (id: string, fy: string, account: string, cents: number, options: Partial<LinkedEntry> = {}) =>
  entry(id, fy, [{ accountCode: '6815', debitCents: cents, creditCents: 0 }, { accountCode: account, debitCents: 0, creditCents: cents }], options)

const litigation: ProvisionInput = {
  id: 'p1',
  category: 'RISK_CHARGE',
  label: 'Litige prud’homal',
  accountCode: '1511',
  nature: 'OPERATING',
  reversible: true,
  openedOn: '2025-06-10',
  closedOn: null,
  carriedCents: 0,
  assessments: [{ fiscalYearId: 'fy25', amountCents: 1_200_000, currentValueCents: null, basis: null, entry: dotation('e1', 'fy25', '1511', 1_200_000) }],
}

describe('provisionYear', () => {
  it('carries the balance booked in earlier years and asks for this closing', () => {
    const y = provisionYear(litigation, Y2026, YEARS)
    expect(y).toMatchObject({ status: 'to_assess', openingCents: 1_200_000, requiredCents: null, proposedCents: 0, closingCents: 1_200_000 })
    expect(y.accounts.dotation.code).toBe('6815')
  })

  it('proposes a reprise when less is required', () => {
    const assessed = { ...litigation, assessments: [...litigation.assessments, { fiscalYearId: 'fy26', amountCents: 400_000, currentValueCents: null, basis: 'Avocat', entry: null }] }
    expect(provisionYear(assessed, Y2026, YEARS)).toMatchObject({ status: 'to_post', requiredCents: 400_000, proposedCents: -800_000, bookedCents: 0 })
  })

  it('reads the booked movement from the linked entry, draft or validated', () => {
    const reprise = entry('e2', 'fy26', [{ accountCode: '1511', debitCents: 800_000, creditCents: 0 }, { accountCode: '7815', debitCents: 0, creditCents: 800_000 }], { status: 'draft' })
    const drafted = { ...litigation, assessments: [...litigation.assessments, { fiscalYearId: 'fy26', amountCents: 400_000, currentValueCents: null, basis: null, entry: reprise }] }
    expect(provisionYear(drafted, Y2026, YEARS)).toMatchObject({ status: 'draft', bookedCents: -800_000, proposedCents: 0, closingCents: 400_000, entry: { id: 'e2', status: 'draft', cents: -800_000 } })
    const validated = { ...drafted, assessments: [drafted.assessments[0], { ...drafted.assessments[1], entry: { ...reprise, status: 'validated' as const } }] }
    expect(provisionYear(validated, Y2026, YEARS).status).toBe('validated')
  })

  it('flags an entry that no longer matches the assessment, and ignores a reversed one', () => {
    const edited = entry('e2', 'fy26', [{ accountCode: '1511', debitCents: 500_000, creditCents: 0 }, { accountCode: '7815', debitCents: 0, creditCents: 500_000 }], { status: 'draft' })
    const mismatch = { ...litigation, assessments: [...litigation.assessments, { fiscalYearId: 'fy26', amountCents: 400_000, currentValueCents: null, basis: null, entry: edited }] }
    expect(provisionYear(mismatch, Y2026, YEARS)).toMatchObject({ status: 'to_correct', bookedCents: -500_000, proposedCents: -300_000 })
    const reversed = { ...mismatch, assessments: [mismatch.assessments[0], { ...mismatch.assessments[1], entry: { ...edited, status: 'validated' as const, reversed: true } }] }
    expect(provisionYear(reversed, Y2026, YEARS)).toMatchObject({ status: 'to_post', bookedCents: 0, proposedCents: -800_000, entry: null })
  })

  it('takes the whole balance back once the risk ended', () => {
    const ended = { ...litigation, closedOn: '2026-03-31' }
    expect(provisionYear(ended, Y2026, YEARS)).toMatchObject({ status: 'to_post', requiredCents: 0, proposedCents: -1_200_000 })
  })

  it('leaves out a provision opened after the year or ended before it with nothing left', () => {
    expect(provisionYear({ ...litigation, openedOn: '2027-01-05', assessments: [] }, Y2026, YEARS).status).toBe('not_in_year')
    expect(provisionYear({ ...litigation, closedOn: '2025-11-30', assessments: [] }, Y2026, YEARS).status).toBe('not_in_year')
  })

  it('counts the balance carried over from before Kledg', () => {
    const migrated = { ...litigation, carriedCents: 300_000, assessments: [{ fiscalYearId: 'fy26', amountCents: 300_000, currentValueCents: null, basis: null, entry: null }] }
    expect(provisionYear(migrated, Y2026, YEARS)).toMatchObject({ status: 'up_to_date', openingCents: 300_000, proposedCents: 0 })
  })

  it('refuses the reprise of a goodwill impairment (PCG art. 214-19)', () => {
    const goodwill: ProvisionInput = {
      ...litigation,
      id: 'p2',
      category: 'FIXED_ASSET',
      accountCode: '2907',
      reversible: false,
      assessments: [
        { fiscalYearId: 'fy25', amountCents: 500_000, currentValueCents: null, basis: null, entry: dotation('e3', 'fy25', '2907', 500_000) },
        { fiscalYearId: 'fy26', amountCents: 100_000, currentValueCents: null, basis: null, entry: null },
      ],
    }
    expect(provisionYear(goodwill, Y2026, YEARS)).toMatchObject({ status: 'up_to_date', proposedCents: 0, reversalRefused: true, closingCents: 500_000 })
  })
})

describe('grantYear', () => {
  const grant: GrantInput = {
    id: 'g1',
    label: 'Subvention régionale',
    amountCents: 1_000_000,
    spreading: 'TENTHS',
    grantedOn: '2025-04-01',
    durationYears: null,
    transferAccountCode: '139',
    carriedCents: 0,
    transfers: [{ fiscalYearId: 'fy25', entry: entry('t1', 'fy25', [{ accountCode: '139', debitCents: 100_000, creditCents: 0 }, { accountCode: '747', debitCents: 0, creditCents: 100_000 }]) }],
  }

  it('proposes the share of the year after the shares already booked', () => {
    expect(grantYear(grant, Y2026, YEARS, null)).toMatchObject({ status: 'to_post', transferredBeforeCents: 100_000, expectedCumulativeCents: 200_000, proposedCents: 100_000, remainingCents: 800_000 })
  })

  it('shows the share booked by its entry', () => {
    const booked = { ...grant, transfers: [...grant.transfers, { fiscalYearId: 'fy26', entry: entry('t2', 'fy26', [{ accountCode: '139', debitCents: 100_000, creditCents: 0 }, { accountCode: '747', debitCents: 0, creditCents: 100_000 }], { status: 'draft' }) }] }
    expect(grantYear(booked, Y2026, YEARS, null)).toMatchObject({ status: 'draft', bookedCents: 100_000, proposedCents: 0, remainingCents: 800_000 })
    const tooMuch = { ...grant, transfers: [...grant.transfers, { fiscalYearId: 'fy26', entry: entry('t2', 'fy26', [{ accountCode: '139', debitCents: 150_000, creditCents: 0 }, { accountCode: '747', debitCents: 0, creditCents: 150_000 }]) }] }
    expect(grantYear(tooMuch, Y2026, YEARS, null).status).toBe('to_correct')
  })

  it('leaves out a grant awarded later or fully transferred', () => {
    expect(grantYear({ ...grant, grantedOn: '2027-01-10', transfers: [] }, Y2026, YEARS, null).status).toBe('not_in_year')
    expect(grantYear({ ...grant, carriedCents: 1_000_000, transfers: [] }, Y2026, YEARS, null).status).toBe('not_in_year')
  })

  it('follows the financed asset', () => {
    const onAsset = { ...grant, spreading: 'ASSET' as const, transfers: [] }
    const asset = { depreciable: true, baseCents: 4_000_000, depreciatedCents: 800_000, disposed: false }
    expect(grantYear(onAsset, Y2026, YEARS, asset)).toMatchObject({ status: 'to_post', proposedCents: 200_000 })
  })

  it('numbers the grant year by the fiscal year containing it', () => {
    expect(yearNumberOf('2025-04-01', YEARS)).toBe(2025)
    expect(yearNumberOf('2023-04-01', YEARS)).toBe(2023)
  })
})
