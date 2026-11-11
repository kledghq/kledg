/**
 * The decision on an early dissolution after a loss of half the capital
 * (issue #52; C. com. L223-42, L225-248): an extraordinary decision, at the
 * majority required to amend the statuts (L223-30 for a SARL, L225-96 for a
 * SA), added to the approval only when the equity is below half the share
 * capital, with its publication in the filing checklist.
 */

import { describe, expect, it } from 'vitest'
import { buildApprovalPack } from '../pack'
import { buildDocument } from '../documents/build'
import { renderMarkdown } from '../documents/markdown'
import { regimeOf } from '../legal-regime'
import { extraordinaryOutcome, type VoteContext } from '../votes'
import { complete, contextFor } from './fixtures'

const context = (over: Partial<VoteContext> = {}): VoteContext => ({ totalVotes: 1000, presentVotes: 1000, secondCall: false, statutoryRule: null, ...over })
const vote = (f: number, against = 0, abstain = 0) => ({ unanimous: false, for: f, against, abstain })

describe('extraordinaryOutcome', () => {
  it('SARL: a quarter of the parts present on first call, a fifth on second, two thirds of the present parts (L223-30)', () => {
    const sarl = regimeOf('SARL')
    expect(extraordinaryOutcome(sarl, context({ presentVotes: 249 }), vote(249))).toMatchObject({ adopted: false, quorumMet: false })
    expect(extraordinaryOutcome(sarl, context({ presentVotes: 200, secondCall: true }), vote(200))).toMatchObject({ adopted: true, quorumMet: true })
    // 600 present: 400 is two thirds, 399 is not; abstentions count against
    expect(extraordinaryOutcome(sarl, context({ presentVotes: 600 }), vote(400, 100, 100)).adopted).toBe(true)
    expect(extraordinaryOutcome(sarl, context({ presentVotes: 600 }), vote(399, 0, 201)).adopted).toBe(false)
  })

  it('SA: two thirds of the votes cast, abstentions left out (L225-96)', () => {
    const sa = regimeOf('SA')
    expect(extraordinaryOutcome(sa, context({ presentVotes: 300 }), vote(200, 100, 0)).adopted).toBe(true)
    expect(extraordinaryOutcome(sa, context({ presentVotes: 300 }), vote(199, 100, 1)).adopted).toBe(false)
    expect(extraordinaryOutcome(sa, context({ presentVotes: 300 }), vote(100, 0, 200)).adopted).toBe(true)
  })

  it('SAS: decided only when unanimous, otherwise left to the statuts; sole partner decides alone', () => {
    const sas = regimeOf('SAS')
    expect(extraordinaryOutcome(sas, context(), vote(1000)).adopted).toBe(true)
    expect(extraordinaryOutcome(sas, context(), vote(900, 100)).adopted).toBeNull()
    expect(extraordinaryOutcome(regimeOf('SASU'), context(), undefined).adopted).toBe(true)
  })
})

describe('approval pack and documents', () => {
  it('adds the resolution, the mixed meeting and the publication only when the equity is below half the capital', () => {
    const below = buildApprovalPack(contextFor('SARL', { equityCents: 300_000 }), complete({ votes: { continuation: { unanimous: true } } }))
    expect(below.resolutions.map((r) => r.id)).toEqual(['approval', 'agreements', 'allocation', 'continuation', 'powers'])
    expect(below.resolutions.find((r) => r.id === 'continuation')?.outcome.adopted).toBe(true)
    expect(below.decisionTitle).toBe("Procès-verbal de l'assemblée générale mixte (ordinaire annuelle et extraordinaire)")
    expect(below.publication.items.some((i) => i.text.startsWith('Décision sur la dissolution anticipée'))).toBe(true)

    const above = buildApprovalPack(contextFor('SARL'), complete())
    expect(above.resolutions.map((r) => r.id)).not.toContain('continuation')
    expect(above.decisionTitle).toBe("Procès-verbal de l'assemblée générale ordinaire annuelle")
  })

  it('words the decision with the equity, the article and the restoration deadline', () => {
    const ctx = contextFor('SARL', { equityCents: 300_000 })
    const d = complete({ votes: { continuation: { unanimous: true } } })
    const md = renderMarkdown(buildDocument('decision', { context: ctx, details: d, pack: buildApprovalPack(ctx, d) }))
    expect(md).toMatch(/dissolution anticipée/)
    expect(md).toMatch(/L\. 223-42/)
    expect(md).toMatch(/31 décembre 2028/)
  })
})
