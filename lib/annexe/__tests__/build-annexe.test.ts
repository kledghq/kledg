/**
 * Content of the annexe per size category (règlement ANC 2014-03, PCG
 * version of 1 January 2026): micro-entreprise (C. com. L123-16-1, PCG art.
 * 811-7), small company under the régime simplifié (C. com. L123-25, PCG
 * art. 811-8), small company (C. com. L123-16, PCG art. 811-9), medium and
 * large (every article of chapter III). Nothing is invented: what only the
 * user knows is listed as missing until answered.
 */

import { describe, expect, it } from 'vitest'
import type { SizeCategory } from '@/lib/approval/size'
import { annexeListOf, buildAnnexe, type AccountYear, type AnnexeData } from '../build-annexe'
import { buildFixedAssetReport } from '../fixed-asset-report'
import { AnnexeDetailsSchema, emptyAnnexeDetails, type AnnexeDetails } from '../schemas'
import { annexeDocument } from '../annexe-document'
import { renderMarkdown } from '@/lib/approval/documents/markdown'

const acc = (code: string, label: string, openingCents: number, debitCents: number, creditCents: number): AccountYear => ({ code, label, openingCents, debitCents, creditCents })

// A small company: capital 10 000 €, a loan, a vehicle, a provision, sales and charges.
const ACCOUNTS: AccountYear[] = [
  acc('101000', 'Capital', -1_000_000, 0, 0),
  acc('106100', 'Réserve légale', -50_000, 0, 50_000),
  acc('120000', "Résultat de l'exercice (bénéfice)", -500_000, 500_000, 0),
  acc('110000', 'Report à nouveau', 0, 0, 450_000),
  acc('151100', 'Provisions pour litiges', 0, 0, 200_000),
  acc('164000', 'Emprunts', -1_200_000, 300_000, 0),
  acc('218200', 'Matériel de transport', 2_000_000, 0, 0),
  acc('281820', 'Amortissement du matériel de transport', -400_000, 0, 400_000),
  acc('401000', 'Fournisseurs', 0, 100_000, 350_000),
  acc('411000', 'Clients', 0, 900_000, 600_000),
  acc('408000', 'Fournisseurs, factures non parvenues', 0, 0, 40_000),
  acc('512000', 'Banque', 1_150_000, 600_000, 400_000),
  acc('706000', 'Prestations de services', 0, 0, 900_000),
  acc('681100', 'Dotations aux amortissements', 0, 400_000, 0),
  acc('681500', 'Dotations aux provisions', 0, 200_000, 0),
  acc('678000', 'Autres charges exceptionnelles', 0, 10_000, 0),
]

const fixedAssets = buildFixedAssetReport({
  fiscalYear: { id: 'fy', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31' },
  lines: [
    { entryId: 'an', reversalOfId: null, opening: true, code: '218200', debitCents: 2_000_000, creditCents: 0 },
    { entryId: 'an', reversalOfId: null, opening: true, code: '281820', debitCents: 0, creditCents: 400_000 },
    { entryId: 'dot', reversalOfId: null, opening: false, code: '281820', debitCents: 0, creditCents: 400_000 },
  ],
  impairmentCents: 0,
  balanceSheet: { grossCents: 2_000_000, depreciationCents: 800_000 },
  register: [],
  draftEntries: 0,
})

function data(category: SizeCategory, patch: Partial<AnnexeData> = {}): AnnexeData {
  return {
    company: { name: 'Atelier Lumen', siren: '111111111', totalShares: 1000, nominalCents: 1000, shareCapitalCents: 1_000_000, corporateTaxRegime: 'normal' },
    fiscalYear: { id: 'fy', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', isClosed: true },
    size: { category, confirmed: true },
    groupMember: false,
    approvalEmployees: null,
    accounts: ACCOUNTS,
    resultCents: 290_000,
    fixedAssets,
    register: [{ rubrique: 'tangible', methods: ['linéaire'], minYears: 5, maxYears: 5, assets: 1 }],
    methods: [{ id: 'm1', topic: 'depreciation', label: 'Linéaire', description: "Sur la durée d'utilisation", adoptedOn: null, referenceMethod: false }],
    changes: [],
    participations: { rows: [], unattributedCents: 0 },
    ...patch,
  }
}

const answered = (patch: Partial<AnnexeDetails> = {}): AnnexeDetails =>
  AnnexeDetailsSchema.parse({
    derogations: { none: true },
    postClosingEvents: { none: true },
    relatedParties: { none: true },
    commitments: { none: false, items: [{ kind: 'leasing', description: 'Crédit-bail du véhicule', amountCents: 1_200_000, residualCents: 100_000 }] },
    directorAdvances: { none: true },
    directorRemuneration: { omitted: true },
    employees: 4,
    taxCredits: { none: true },
    receivableMaturities: { overOneYearCents: 0 },
    debtMaturities: { overOneYearCents: 600_000, overFiveYearsCents: 0 },
    ...patch,
  })

const ids = (a: ReturnType<typeof buildAnnexe>) => a.notes.map((n) => n.id)

describe('list of articles per category', () => {
  it('micro: art. 811-7; small at the régime simplifié: 811-8; small: 811-9; medium and large: all', () => {
    expect(annexeListOf('micro', 'simplified')).toBe('micro')
    expect(annexeListOf('small', 'simplified')).toBe('simplified')
    expect(annexeListOf('small', 'normal')).toBe('small')
    expect(annexeListOf('medium', 'normal')).toBe('full')
    expect(annexeListOf('large', null)).toBe('full')
  })
})

describe('micro-entreprise (C. com. L123-16-1, PCG art. 811-7)', () => {
  it('no annexe required: only the information after the balance sheet, commitments and advances asked', () => {
    const annexe = buildAnnexe(data('micro'), emptyAnnexeDetails())
    expect(annexe.required).toBe(false)
    expect(ids(annexe)).toEqual(['micro'])
    expect(annexe.missing.map((m) => m.id)).toEqual(['commitments', 'directorAdvances'])
    const done = buildAnnexe(data('micro'), answered())
    expect(done.missing).toEqual([])
    const md = renderMarkdown(annexeDocument(done, { name: 'Atelier Lumen', siren: '111111111' }, { year: 2026, startDate: '2026-01-01', endDate: '2026-12-31' }))
    expect(md).toContain('# Informations à la suite du bilan')
    expect(md).toContain('règlement ANC n° 2014-03')
    expect(md).toContain('Crédit-bail du véhicule')
  })
})

describe('small company at the régime simplifié (PCG art. 811-8)', () => {
  it('rules, fixed assets, provisions, maturities and commitments; no equity table, headcount or tax credits', () => {
    const annexe = buildAnnexe(data('small', { company: { ...data('small').company, corporateTaxRegime: 'simplified' } }), answered())
    expect(annexe.list).toBe('simplified')
    expect(ids(annexe)).toEqual(['rules', 'changes', 'fixed-assets', 'depreciation', 'provisions', 'receivables', 'debts', 'related-parties', 'commitments', 'other'])
    expect(annexe.missing).toEqual([])
  })
})

describe('small company (PCG art. 811-9)', () => {
  const annexe = buildAnnexe(data('small'), answered())

  it('adds equity, accruals, exceptional result, tax credits, officers and headcount', () => {
    expect(ids(annexe)).toEqual([
      'rules', 'changes', 'fixed-assets', 'depreciation', 'provisions', 'receivables', 'equity', 'debts', 'accruals', 'exceptional',
      'tax-credits', 'related-parties', 'officers', 'commitments', 'headcount', 'other',
    ])
    expect(annexe.missing).toEqual([])
  })

  it('reads its figures in the books', () => {
    const text = (id: string) => JSON.stringify(annexe.notes.find((n) => n.id === id)?.blocks)
    expect(text('fixed-assets')).toMatch(/20\s000,00\s€/)
    expect(text('depreciation')).toMatch(/4\s000,00\s€.*4\s000,00\s€.*8\s000,00\s€/)
    expect(text('provisions')).toContain('Provisions pour risques et charges')
    expect(text('receivables')).toMatch(/3\s000,00\s€/) // clients 9 000 - 6 000
    expect(text('debts')).toContain('Échéance à un an au plus')
    expect(text('equity')).toMatch(/Report à nouveau/)
    expect(text('accruals')).toMatch(/400,00\s€/) // 408
    expect(text('exceptional')).toContain('678000')
    expect(text('headcount')).toMatch(/\s: 4\./)
    // Not asked of a small company: director remuneration (PCG art. 835-2)
    expect(text('officers')).not.toMatch(/Rémunérations/)
  })

  it('asks every answer it needs, never fills one', () => {
    const empty = buildAnnexe(data('small'), emptyAnnexeDetails())
    expect(empty.missing.map((m) => m.id).sort()).toEqual(
      ['commitments', 'debtMaturities', 'derogations', 'directorAdvances', 'employees', 'postClosingEvents', 'receivableMaturities', 'relatedParties', 'taxCredits'].sort(),
    )
    expect(empty.missing.find((m) => m.id === 'debtMaturities')?.source).toBe('PCG art. 832-15')
    // The headcount of the approval page is the user's answer too
    expect(buildAnnexe(data('small', { approvalEmployees: 3 }), emptyAnnexeDetails()).missing.map((m) => m.id)).not.toContain('employees')
  })
})

describe('medium company (all articles)', () => {
  it('asks the remuneration of the officers and the consolidating entity of a group member', () => {
    const annexe = buildAnnexe(data('medium', { groupMember: true }), answered({ directorRemuneration: null }))
    expect(annexe.missing.map((m) => m.id)).toEqual(['directorRemuneration', 'consolidatingEntity'])
    const done = buildAnnexe(data('medium', { groupMember: true }), answered({ directorRemuneration: { omitted: false, amountCents: 9_000_000 }, consolidatingEntity: { name: 'Groupe Lumen', seat: 'Lyon', siren: '333333333', copiesAt: null } }))
    expect(done.missing).toEqual([])
    expect(JSON.stringify(done.notes.find((n) => n.id === 'officers'))).toMatch(/90\s000,00\s€/)
    expect(ids(done)).toContain('consolidating-entity')
  })

  it('lists the changes of the year with their treatment and warns of an entry not prepared', () => {
    const change = { id: 'c1', fiscalYearId: 'fy', fiscalYear: 2026, kind: 'METHOD_CHANGE' as const, treatment: 'EQUITY' as const, method: null, label: 'Stocks au CMUP', description: 'Meilleure information', impactCents: 1_000_000, taxEffectCents: 250_000, netImpactCents: 750_000, accountCode: '310000', entryDate: null, entry: null, entryExpected: true }
    const annexe = buildAnnexe(data('medium', { changes: [change] }), answered())
    const text = JSON.stringify(annexe.notes.find((n) => n.id === 'changes'))
    expect(text).toContain('Changement de méthode comptable')
    expect(text).toMatch(/impact après impôt 7\s500,00\s€/)
    expect(annexe.warnings.join(' ')).toMatch(/Stocks au CMUP.*pas préparée/)
  })

  it('asks the figures of companies held outside Kledg, shows those followed in Kledg', () => {
    const held = { rows: [{ name: 'Filiale', siren: '444444444', ownershipBp: 8_000, capitalCents: 500_000, equityCents: 900_000, bookValueGrossCents: 400_000, bookValueNetCents: 400_000, loansCents: 0, revenueCents: 2_000_000, resultCents: 100_000, dividendsCents: 0 }], unattributedCents: 50_000 }
    const annexe = buildAnnexe(data('medium', { participations: held }), answered())
    expect(annexe.missing.map((m) => m.id)).toEqual(['externalParticipations'])
    expect(JSON.stringify(annexe.notes.find((n) => n.id === 'participations'))).toContain('80 %')
  })
})
