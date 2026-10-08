import { describe, expect, it } from 'vitest'
import { ruleTemplateById } from '../catalog'
import { conditionsKey, duplicateStatus, normalizeName, sampleTransaction, sideOf, type ExistingRule } from '../duplicates'
import { rankTemplateSuggestions, templateAsRule } from '../suggestions'
import type { RuleTemplate } from '../template'

const template = (id: string): RuleTemplate => ruleTemplateById(id)!

const existing = (id: string, name: string, conditions: ExistingRule['conditions']): ExistingRule => ({ id, name, priority: 0, autoCreate: false, conditions })
const contains = (value: string) => ({ conditionType: 'label', operator: 'contains', value, value2: null })

const statusOf = (t: RuleTemplate, rules: ExistingRule[]) =>
  duplicateStatus({ name: t.name, conditions: t.conditions, sampleLabels: t.samples.match, side: sideOf(t) }, rules)

describe('duplicate detection', () => {
  it('compares names without accents, case or punctuation, and conditions as a set', () => {
    expect(normalizeName('  Télécom : ORANGE  ')).toBe('telecom orange')
    expect(conditionsKey([{ conditionType: 'side', operator: 'equals', value: 'debit' }, { conditionType: 'label', operator: 'regex', value: 'X' }])).toBe(
      conditionsKey([{ conditionType: 'label', operator: 'regex', value: 'x' }, { conditionType: 'side', operator: 'equals', value: 'DEBIT ' }]),
    )
  })

  it('marks a template added when a rule has its name or its conditions', () => {
    const orange = template('orange')
    expect(statusOf(orange, [existing('r1', 'orange (TELECOM)', [contains('zzz')])]).installed).toEqual({ ruleId: 'r1', ruleName: 'orange (TELECOM)', reason: 'name' })
    const sameConditions = existing('r2', 'Mon opérateur', orange.conditions.map((c) => ({ ...c, value2: null })))
    expect(statusOf(orange, [sameConditions]).installed).toEqual({ ruleId: 'r2', ruleName: 'Mon opérateur', reason: 'conditions' })
  })

  it('warns about a rule that recognises the sample labels, or has the same name without the part in parentheses', () => {
    const orange = template('orange')
    const status = statusOf(orange, [existing('r1', 'Box internet', [contains('orange sa')]), existing('r2', 'Orange', [contains('zzz')]), existing('r3', 'Loyer', [contains('loyer')])])
    expect(status.installed).toBeNull()
    expect(status.nearDuplicates).toEqual([
      { ruleId: 'r1', ruleName: 'Box internet', reason: 'labels' },
      { ruleId: 'r2', ruleName: 'Orange', reason: 'name' },
    ])
  })

  it('builds sample transactions on the side the template expects', () => {
    expect(sideOf(template('stripe-virements'))).toBe('credit')
    expect(sampleTransaction('STRIPE', 'credit')).toMatchObject({ label: 'STRIPE', side: 'credit', amount: 100 })
  })
})

describe('suggestions', () => {
  const tx = (label: string, side = 'debit') => sampleTransaction(label, side)
  const templates = [template('orange'), template('ovhcloud'), template('qonto-frais'), template('urssaf')]

  it('counts the transactions each template recognises that no rule recognises, most first', () => {
    const run = rankTemplateSuggestions(
      templates,
      [tx('OVH SAS'), tx('PRLV SEPA ORANGE SA'), tx('ORANGE PRO'), tx('QONTO'), tx('VIR ORANGE SA', 'credit'), tx('CB BOULANGERIE')],
      [templateAsRule({ id: 'rule-qonto', name: 'Qonto', conditions: [{ conditionType: 'label', operator: 'contains', value: 'qonto' }] })],
    )
    expect(run).toEqual({
      suggestions: [
        { templateId: 'orange', matchCount: 2, example: 'PRLV SEPA ORANGE SA' },
        { templateId: 'ovhcloud', matchCount: 1, example: 'OVH SAS' },
      ],
      analyzed: 6,
      covered: 1,
    })
  })

  it('leaves out templates already added and keeps the limit', () => {
    const run = rankTemplateSuggestions(templates, [tx('OVH SAS'), tx('ORANGE PRO'), tx('PRLV URSSAF')], [], { exclude: new Set(['orange']), limit: 1 })
    expect(run.suggestions.map((s) => s.templateId)).toEqual(['ovhcloud'])
  })

  it('ranks equal counts by name, the same way every time', () => {
    const run = rankTemplateSuggestions(templates, [tx('URSSAF IDF'), tx('OVH SAS')], [])
    expect(run.suggestions.map((s) => s.templateId)).toEqual(['ovhcloud', 'urssaf'])
  })
})
