/**
 * Quorum and majority wording of the approval decisions (lib/approval/votes.ts).
 * Sources: C. com. L223-29 (SARL), L225-98 (SA), L227-9 (SAS), C. civ. 1852
 * (unanimity by default in a société civile), L223-31 and L227-9 (sole).
 */

import { describe, expect, it } from 'vitest'
import { regimeOf } from '../legal-regime'
import { majorityRuleText, quorumMet, voteOutcome, type VoteContext } from '../votes'

const ctx = (patch: Partial<VoteContext> = {}): VoteContext => ({ totalVotes: 1000, presentVotes: 1000, secondCall: false, statutoryRule: null, ...patch })
const vote = (f: number, against = 0, abstain = 0) => ({ unanimous: false, for: f, against, abstain })

describe('SARL (L223-29)', () => {
  const sarl = regimeOf('SARL')
  it('needs more than half of all the parts on a first consultation, whoever attends', () => {
    expect(voteOutcome(sarl, ctx({ presentVotes: 700 }), vote(500, 200)).adopted).toBe(false)
    expect(voteOutcome(sarl, ctx({ presentVotes: 700 }), vote(501, 199)).adopted).toBe(true)
    expect(majorityRuleText(sarl, ctx())).toMatch(/plus de la moitié des parts sociales \(C\. com\. art\. L\. 223-29\)/)
  })
  it('takes the majority of the votes cast on a second consultation', () => {
    const outcome = voteOutcome(sarl, ctx({ presentVotes: 300, secondCall: true }), vote(200, 100))
    expect(outcome.adopted).toBe(true)
    expect(outcome.wording).toBe('Cette résolution, mise aux voix, est adoptée par 200 voix pour, 100 voix contre et 0 abstention.')
    expect(majorityRuleText(sarl, ctx({ secondCall: true }))).toMatch(/majorité des votes émis/)
  })
  it('says a rejected resolution is rejected', () => {
    expect(voteOutcome(sarl, ctx(), vote(400, 600, 2)).wording).toBe('Cette résolution, mise aux voix, est rejetée par 400 voix pour, 600 voix contre et 2 abstentions.')
  })
})

describe('SA (L225-98)', () => {
  const sa = regimeOf('SA')
  it('needs one fifth of the voting shares on first call and nothing on second call', () => {
    expect(quorumMet(sa, ctx({ presentVotes: 199 }))).toBe(false)
    expect(quorumMet(sa, ctx({ presentVotes: 200 }))).toBe(true)
    expect(quorumMet(sa, ctx({ presentVotes: 10, secondCall: true }))).toBe(true)
    const noQuorum = voteOutcome(sa, ctx({ presentVotes: 100 }), vote(100))
    expect(noQuorum).toMatchObject({ adopted: false, quorumMet: false })
    expect(noQuorum.wording).toMatch(/quorum requis n'étant pas atteint/)
    expect(majorityRuleText(sa, ctx())).toMatch(/cinquième des actions ayant le droit de vote/)
  })
  it('counts the votes cast only: abstentions do not count against', () => {
    expect(voteOutcome(sa, ctx({ presentVotes: 400 }), vote(150, 100, 150)).adopted).toBe(true)
    expect(voteOutcome(sa, ctx({ presentVotes: 400 }), vote(100, 100, 200)).adopted).toBe(false)
  })
})

describe('SAS (statuts, L227-9) and SCI (C. civ. 1852)', () => {
  const sas = regimeOf('SAS')
  const sci = regimeOf('SCI')
  it('does not decide a SAS vote without the rule of the statuts', () => {
    expect(voteOutcome(sas, ctx(), vote(600, 400)).adopted).toBeNull()
    expect(majorityRuleText(sas, ctx())).toMatch(/conditions de quorum et de majorité prévues par les statuts \(C\. com\. art\. L\. 227-9\)/)
  })
  it('applies the majority, base and quorum of the statuts', () => {
    const rule = { kind: 'majority' as const, base: 'present' as const, percent: 66, quorumPercent: 50, article: '18' }
    expect(voteOutcome(sas, ctx({ statutoryRule: rule, presentVotes: 600 }), vote(400, 200)).adopted).toBe(true)
    expect(voteOutcome(sas, ctx({ statutoryRule: rule, presentVotes: 600 }), vote(390, 210)).adopted).toBe(false)
    expect(voteOutcome(sas, ctx({ statutoryRule: rule, presentVotes: 400 }), vote(400)).quorumMet).toBe(false)
    expect(majorityRuleText(sas, ctx({ statutoryRule: rule }))).toBe(
      "Les décisions sont prises à plus de 66 % des voix des associés présents ou représentés, avec un quorum de 50 % des voix, conformément à l'article 18 des statuts.",
    )
  })
  it('requires every associé of a société civile when the statuts are silent', () => {
    expect(voteOutcome(sci, ctx({ presentVotes: 1000 }), { unanimous: true, for: 0, against: 0, abstain: 0 }).adopted).toBe(true)
    expect(voteOutcome(sci, ctx({ presentVotes: 600 }), { unanimous: true, for: 0, against: 0, abstain: 0 }).adopted).toBe(false)
    expect(majorityRuleText(sci, ctx())).toMatch(/unanimité des associés à défaut \(C\. civ\. art\. 1852\)/)
  })
  it('reads the unanimity rule of the statuts as every associé of the company', () => {
    const rule = { kind: 'unanimity' as const, base: 'cast' as const, percent: 50, quorumPercent: null, article: null }
    expect(voteOutcome(sas, ctx({ statutoryRule: rule, presentVotes: 900 }), vote(900)).adopted).toBe(false)
    expect(voteOutcome(sas, ctx({ statutoryRule: rule }), vote(1000)).adopted).toBe(true)
  })
})

describe('associé unique (L223-31, L227-9)', () => {
  it('is always a decision of the associé unique, without vote or quorum', () => {
    for (const form of ['EURL', 'SASU'] as const) {
      const outcome = voteOutcome(regimeOf(form), ctx(), undefined)
      expect(outcome).toEqual({ adopted: true, quorumMet: true, wording: "Cette décision est prise par l'associé unique." })
      expect(majorityRuleText(regimeOf(form), ctx())).toMatch(/associé unique exerce/)
    }
  })
})

it('leaves the outcome open until votes are entered', () => {
  expect(voteOutcome(regimeOf('SARL'), ctx(), undefined).adopted).toBeNull()
  expect(voteOutcome(regimeOf('SARL'), ctx(), vote(0)).adopted).toBeNull()
  expect(voteOutcome(regimeOf('SARL'), ctx({ totalVotes: 0 }), vote(10)).adopted).toBeNull()
})
