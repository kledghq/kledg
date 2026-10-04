import { describe, expect, it } from 'vitest'

import { suggestRuleName } from '../rule-builder'
import { pickRule } from '../rule-matcher'

describe('suggestRuleName', () => {
  it('prefers the counterparty the bank gives', () => {
    expect(suggestRuleName({ counterpartyName: 'SNCF', label: 'CB Billet de train' })).toBe('SNCF')
    expect(suggestRuleName({ counterpartyName: 'PAPETERIE MARTIN', label: 'x' })).toBe('Papeterie Martin')
  })

  it('cleans the bank label: payment prefix, card number, dates and references', () => {
    expect(suggestRuleName({ label: 'CB Billet de train' })).toBe('Billet de train')
    expect(suggestRuleName({ label: 'CB BILLET DE TRAIN 12/03 X4521' })).toBe('Billet de train')
    expect(suggestRuleName({ label: 'PRLV SEPA EDF CLIENTS PARTICULIERS 20260301ABC' })).toBe('EDF clients particuliers')
    expect(suggestRuleName({ label: 'VIR SEPA RECU /DE ATELIER LUMEN' })).toBe('Atelier lumen')
    expect(suggestRuleName({ label: 'VIR INST LOYER BUREAU' })).toBe('Loyer bureau')
  })

  it('falls back to a neutral name', () => {
    expect(suggestRuleName({ label: 'CB 12/03' })).toBe('Nouvelle règle')
    expect(suggestRuleName({ label: null })).toBe('Nouvelle règle')
  })
})

describe('pickRule', () => {
  it('chooses the highest priority, then the most specific rule', () => {
    const a = { ruleId: 'a', confidence: 0.6, priority: 0 }
    const b = { ruleId: 'b', confidence: 0.9, priority: 0 }
    const c = { ruleId: 'c', confidence: 0.6, priority: 3 }
    expect(pickRule([a, b])?.ruleId).toBe('b')
    expect(pickRule([a, b, c])?.ruleId).toBe('c')
    expect(pickRule([a, { ...a, ruleId: 'a2' }])?.ruleId).toBe('a')
    expect(pickRule([])).toBeNull()
  })
})
