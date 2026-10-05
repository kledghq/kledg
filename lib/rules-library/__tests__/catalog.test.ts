/**
 * Every template of the rules library (lib/rules-library/catalog), checked
 * against its format and the rules the format cannot express:
 * - accounts are standard PCG accounts (lib/accounting/pcg-data.ts);
 * - VAT fields are coherent with the declared treatment, and any special
 *   treatment cites an official source;
 * - each condition compiles on the linear-time matcher and recognises the
 *   template's sample labels, and not the close labels it lists nor a set of
 *   unrelated labels;
 * - the entry the engine books for 120 € balances against the bank, with
 *   the VAT the treatment promises (CGI art. 298, 4, 1° for fuel, art. 283,
 *   2 for self-assessed services).
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())

import { PCG_ACCOUNTS } from '@/lib/accounting/pcg-data'
import { compileRulePattern } from '@/lib/transactions/rule-regex'
import { findMatchingRules } from '@/lib/transactions/rule-matcher'
import { simulateRuleFromData } from '@/lib/transactions/rule-simulator'
import { RULE_TEMPLATES, ruleTemplateById } from '../catalog'
import { sampleTransaction, sideOf } from '../duplicates'
import { templateAsRule } from '../suggestions'
import { RULE_TEMPLATE_CATEGORIES, RuleTemplateSchema, SPECIAL_VAT_TREATMENTS, type RuleTemplate } from '../template'

const PCG_CODES = new Set(PCG_ACCOUNTS.map((a) => a.code))
const OFFICIAL_HOSTS = ['bofip.impots.gouv.fr', 'www.legifrance.gouv.fr', 'www.impots.gouv.fr', 'questions.assemblee-nationale.fr', 'support.stripe.com']

/** Everyday labels no template may recognise, on either side. */
const UNRELATED_LABELS = [
  'VIR SEPA SALAIRE DUPONT',
  'CB CARREFOUR MARKET 12/03',
  'CB BOULANGERIE PAUL',
  'VIR SEPA CLIENT FACTURE 2026-001',
  'RETRAIT DAB 12/03 PARIS',
  'CB DECATHLON',
  'PRLV SEPA NETFLIX',
  'VIR INSTANTANE ENTRE COMPTES',
  'CHEQUE 1234567',
  'CB IKEA PARIS NORD',
]

const matches = (template: RuleTemplate, label: string, side = sideOf(template)) =>
  findMatchingRules([templateAsRule(template)], sampleTransaction(label, side)).length > 0

function allStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(allStrings)
  if (value && typeof value === 'object') return Object.values(value).flatMap(allStrings)
  return []
}

describe('rules library catalog', () => {
  it('holds between 40 and 60 templates with unique ids and names, in every category', () => {
    expect(RULE_TEMPLATES.length).toBeGreaterThanOrEqual(40)
    expect(RULE_TEMPLATES.length).toBeLessThanOrEqual(60)
    expect(new Set(RULE_TEMPLATES.map((t) => t.id)).size).toBe(RULE_TEMPLATES.length)
    expect(new Set(RULE_TEMPLATES.map((t) => t.name)).size).toBe(RULE_TEMPLATES.length)
    for (const category of RULE_TEMPLATE_CATEGORIES) {
      expect(RULE_TEMPLATES.some((t) => t.category === category.id), category.id).toBe(true)
    }
    expect(ruleTemplateById('ovhcloud')?.name).toBe('OVHcloud')
    expect(ruleTemplateById('nope')).toBeUndefined()
  })

  describe.each(RULE_TEMPLATES.map((t) => [t.id, t] as const))('%s', (_id, template) => {
    it('follows the template format', () => {
      expect(RuleTemplateSchema.safeParse(template).error?.issues ?? []).toEqual([])
    })

    it('books standard PCG accounts', () => {
      for (const line of template.lines) {
        expect(PCG_CODES.has(line.accountCode), line.accountCode).toBe(true)
        if (line.vatAccountCode) expect(PCG_CODES.has(line.vatAccountCode), line.vatAccountCode).toBe(true)
        if (line.vatAccount2Code) expect(PCG_CODES.has(line.vatAccount2Code), line.vatAccount2Code).toBe(true)
        expect(line.accountCode.startsWith('51'), 'the engine books the bank line itself').toBe(false)
      }
    })

    it('has VAT fields coherent with its treatment, and a source when the treatment is special', () => {
      const vatLines = template.lines.filter((l) => l.vatType && l.vatType !== 'none')
      for (const line of vatLines) expect(line.vatAccountCode, 'a VAT line names its VAT account').toBeTruthy()
      switch (template.vat.treatment) {
        case 'standard':
          expect(vatLines).toHaveLength(template.lines.length)
          for (const line of vatLines) expect(line).toMatchObject({ vatType: 'deductible', vatRate: 20, vatAccountCode: '44566' })
          break
        case 'reduced':
          expect(vatLines.length).toBeGreaterThan(0)
          for (const line of vatLines) {
            expect(line.vatType).toBe('deductible')
            expect([10, 5.5, 2.1]).toContain(line.vatRate)
          }
          break
        case 'detected':
          expect(vatLines.length).toBeGreaterThan(0)
          for (const line of vatLines) {
            expect(line).toMatchObject({ vatType: 'deductible', vatRateSource: 'transaction' })
            expect(line.vatRate, 'no fallback rate: VAT only when the bank detects it').toBeUndefined()
          }
          break
        case 'self-assessed':
          expect(vatLines).toHaveLength(template.lines.length)
          for (const line of vatLines) {
            expect(['intracom', 'import']).toContain(line.vatType)
            expect(line).toMatchObject({ vatRateSource: 'fixed', vatRate: 20, vatAccountCode: '44566', vatAccount2Code: '4452' })
          }
          break
        case 'partial':
          expect(vatLines).toHaveLength(1)
          expect(vatLines[0]).toMatchObject({ amountType: 'percentage', vatRateSource: 'fixed' })
          expect(template.lines.some((l) => l.amountType === 'remaining' && !l.vatType)).toBe(true)
          break
        case 'not-deductible':
        case 'none':
          expect(vatLines).toEqual([])
          break
      }
      if (SPECIAL_VAT_TREATMENTS.includes(template.vat.treatment)) expect(template.sources.length).toBeGreaterThan(0)
      for (const source of template.sources) expect(OFFICIAL_HOSTS).toContain(new URL(source.url).host)
    })

    it('puts its side condition first and compiles every pattern', () => {
      expect(template.conditions[0].conditionType).toBe('side')
      for (const condition of template.conditions) {
        if (condition.operator !== 'regex') continue
        const compiled = compileRulePattern(condition.value)
        expect(compiled.ok, compiled.ok ? '' : compiled.message).toBe(true)
        expect(condition.display, 'a pattern is described in words on the card').toBeTruthy()
      }
    })

    it('recognises its sample labels and not the close or unrelated ones', () => {
      for (const label of template.samples.match) expect(matches(template, label), label).toBe(true)
      for (const label of template.samples.noMatch ?? []) expect(matches(template, label), label).toBe(false)
      for (const label of UNRELATED_LABELS) {
        expect(matches(template, label, 'debit'), label).toBe(false)
        expect(matches(template, label, 'credit'), label).toBe(false)
      }
      const otherSide = sideOf(template) === 'debit' ? 'credit' : 'debit'
      expect(matches(template, template.samples.match[0], otherSide), 'the side condition holds').toBe(false)
    })

    it('books an entry that balances against the bank for 120 €', async () => {
      const side = sideOf(template) as 'debit' | 'credit'
      const result = await simulateRuleFromData(
        { entryLines: template.lines.map((line, order) => ({ ...line, order })) },
        { amount: 120, side },
      )
      const net = Math.round((result.totalDebit - result.totalCredit) * 100)
      expect(net).toBe(side === 'debit' ? 12000 : -12000)
    })

    it('writes no dash in its texts', () => {
      for (const text of allStrings(template)) expect(text).not.toMatch(/[\u2013\u2014]/)
    })
  })

  it('deducts 80 % of the VAT of fuel for a passenger car (CGI art. 298, 4, 1°)', async () => {
    const template = ruleTemplateById('carburant-voiture-particuliere')!
    const result = await simulateRuleFromData({ entryLines: template.lines.map((line, order) => ({ ...line, order })) }, { amount: 120, side: 'debit' })
    const byAccount = (code: string) => result.entryLines.filter((l) => l.account.code === code).reduce((sum, l) => sum + Math.round(l.debit * 100), 0)
    // 120 TTC holds 20 of VAT at 20 %: 16 deducted (80 %), 104 of cost
    expect(byAccount('44566')).toBe(1600)
    expect(byAccount('6061')).toBe(10400)
  })

  it('self-assesses 20 % on a service of a supplier established outside France (CGI art. 283, 2)', async () => {
    const template = ruleTemplateById('github')!
    const result = await simulateRuleFromData({ entryLines: template.lines.map((line, order) => ({ ...line, order })) }, { amount: 120, side: 'debit' })
    const rows = result.entryLines.map((l) => [l.account.code, Math.round(l.debit * 100), Math.round(l.credit * 100)])
    expect(rows).toEqual([
      ['6511', 12000, 0],
      ['44566', 2400, 0],
      ['4452', 0, 2400],
    ])
  })

  it('keeps non-deductible VAT of passenger transport in the cost (CGI ann. II art. 206, IV, 2°, 5°)', async () => {
    const template = ruleTemplateById('train')!
    const result = await simulateRuleFromData({ entryLines: template.lines.map((line, order) => ({ ...line, order })) }, { amount: 120, side: 'debit' })
    expect(result.entryLines.map((l) => [l.account.code, Math.round(l.debit * 100)])).toEqual([['6251', 12000]])
  })

  it('takes the VAT the bank detected, or none, when the rate depends on the invoice', async () => {
    const template = ruleTemplateById('qonto-frais')!
    const lines = template.lines.map((line, order) => ({ ...line, order }))
    const detected = await simulateRuleFromData({ entryLines: lines }, { amount: 12, side: 'debit', vatAmount: 2 })
    expect(detected.entryLines.map((l) => [l.account.code, Math.round(l.debit * 100)])).toEqual([['627', 1000], ['44566', 200]])
    const none = await simulateRuleFromData({ entryLines: lines }, { amount: 12, side: 'debit' })
    expect(none.entryLines.map((l) => [l.account.code, Math.round(l.debit * 100)])).toEqual([['627', 1200]])
  })
})
