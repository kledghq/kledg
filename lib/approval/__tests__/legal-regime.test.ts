/**
 * Approval regime per legal form (lib/approval/legal-regime.ts): officer
 * title, who decides, decision modes, majority, deadline, filing.
 * Sources: C. com. L223-26, L223-27, L223-29, L223-31 (SARL, EURL),
 * L227-1 and L227-9 (SAS, SASU), L225-98 and L225-100 (SA), L232-22 and
 * L232-23 (filing); C. civ. 1852, 1853 and 1856 (SCI).
 */

import { describe, expect, it } from 'vitest'
import { accountsPreparedBy, approvalRegime, decisionTitle, regimeOf, unsupportedReason } from '../legal-regime'

describe('approval regime per legal form', () => {
  it('SARL: assembly or written consultation of the associés, gérant, more than half of the parts, six months, filing L232-22', () => {
    const r = regimeOf('SARL')
    expect(r.officerTitle.singular).toBe('gérant')
    expect(r.sole).toBe(false)
    expect(r.decisionModes).toEqual(['meeting', 'written'])
    expect(r.majority).toBe('sarl')
    expect(r.sixMonthDeadline).toBe(true)
    expect(r.convocation?.minDays).toBe(15)
    expect(r.filing).toMatchObject({ required: true })
    expect(r.filing.sources.map((s) => s.label)).toEqual(['C. com., art. L232-22'])
    expect(decisionTitle(r, 'meeting')).toBe("Procès-verbal de l'assemblée générale ordinaire annuelle")
    expect(decisionTitle(r, 'written')).toBe('Procès-verbal des décisions des associés prises par consultation écrite')
    expect(accountsPreparedBy(r)).toBe('la gérance')
  })

  it("EURL: the associé unique decides alone, the officer is a gérant, filing by the only gérant is worth approval (L223-31)", () => {
    const r = regimeOf('EURL')
    expect(r.sole).toBe(true)
    expect(r.officerTitle.singular).toBe('gérant')
    expect(r.decisionModes).toEqual(['sole'])
    expect(r.majority).toBe('sole')
    expect(r.convocation).toBeNull()
    expect(r.sixMonthDeadline).toBe(true)
    expect(decisionTitle(r, 'sole')).toBe("Décision de l'associé unique")
    expect(r.filingWorthApproval?.condition).toMatch(/seul gérant/)
    expect(r.register.sources.map((s) => s.label)).toContain('C. com., art. R223-26')
  })

  it('SAS: collective decision per statuts, président, no legal six-month deadline (L227-1 excludes L225-100), filing L232-23', () => {
    const r = regimeOf('SAS')
    expect(r.officerTitle.singular).toBe('président')
    expect(r.majority).toBe('statutes')
    expect(r.sixMonthDeadline).toBe(false)
    expect(r.convocation?.minDays).toBeNull()
    expect(r.filing.sources.map((s) => s.label)).toEqual(['C. com., art. L232-23'])
    expect(decisionTitle(r, 'meeting')).toBe('Procès-verbal des décisions collectives des associés')
    expect(accountsPreparedBy(r)).toBe('le président')
  })

  it('SASU: the associé unique decides, the officer is the président and never a gérant (Ledgerly mixed them up)', () => {
    const r = regimeOf('SASU')
    expect(r.sole).toBe(true)
    expect(r.officerTitle.singular).toBe('président')
    expect(JSON.stringify(r)).not.toMatch(/gérant/)
    expect(r.sixMonthDeadline).toBe(true)
    expect(r.filingWorthApproval?.condition).toMatch(/personne physique, est le président/)
    expect(decisionTitle(r, 'sole')).toBe("Décision de l'associé unique")
  })

  it("SA: ordinary general meeting only, président du conseil d'administration, quorum and majority of L225-98, attendance sheet required", () => {
    const r = regimeOf('SA')
    expect(r.officerTitle.singular).toBe("président du conseil d'administration")
    expect(r.holderWord.plural).toBe('actionnaires')
    expect(r.decisionModes).toEqual(['meeting'])
    expect(r.majority).toBe('sa')
    expect(r.attendanceSheet).toBe('required')
    expect(r.convocation?.sources.map((s) => s.label)).toEqual(['C. com., art. R225-69'])
    expect(accountsPreparedBy(r)).toBe("le conseil d'administration")
  })

  it('SCI: gérant, statuts or unanimity, written report always, no greffe filing, no legal six-month deadline', () => {
    const r = regimeOf('SCI')
    expect(r.officerTitle.singular).toBe('gérant')
    expect(r.majority).toBe('statutes')
    expect(r.managementReport).toBe('always')
    expect(r.filing.required).toBe(false)
    expect(r.sixMonthDeadline).toBe(false)
    expect(r.regulatedAgreements).toBeNull()
    expect(r.sources.map((s) => s.label)).toEqual(['C. civ., art. 1856', 'C. civ., art. 1852', 'C. civ., art. 1853'])
  })

  it('reads SELARL and SELAS as SARL and SAS, and a SARL or SAS with one associé as unipersonnelle', () => {
    expect(approvalRegime('SELARL')?.form).toBe('SARL')
    expect(approvalRegime('SELAS')?.form).toBe('SAS')
    expect(approvalRegime('SARL', 1)?.form).toBe('EURL')
    expect(approvalRegime('SAS', 1)?.form).toBe('SASU')
    expect(approvalRegime('SAS', 1)?.officerTitle.singular).toBe('président')
    expect(approvalRegime('SARL', 2)?.form).toBe('SARL')
    expect(approvalRegime('SA', 1)?.form).toBe('SA')
  })

  it('does not cover SNC, SCS, SCA and EI, and says why in French', () => {
    for (const legalType of ['SNC', 'SCS', 'SCA', 'EI', null]) expect(approvalRegime(legalType)).toBeNull()
    expect(unsupportedReason(null)).toMatch(/pas renseignée/)
    expect(unsupportedReason('EI')).toMatch(/entrepreneur individuel/)
    expect(unsupportedReason('SNC')).toMatch(/SNC/)
    expect(unsupportedReason('SARL')).toBeNull()
  })
})
