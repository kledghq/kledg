import { describe, expect, it } from 'vitest'
import { PCG_ACCOUNTS } from '@/lib/accounting/pcg-data'
import { mapAccountCode, mapLines, mapRuleAccounts, resolvedCode, type ChartAccount } from '../account-mapping'

const PCG = new Map(PCG_ACCOUNTS.map((a) => [a.code, a.label]))
const chart = (...codes: string[]): ChartAccount[] => codes.map((code) => ({ id: `id-${code}`, code, label: PCG.get(code) ?? `Compte ${code}` }))

describe('mapAccountCode', () => {
  it('prefers the subdivision the company made of an expense account', () => {
    expect(mapAccountCode('626', chart('62', '626', '6262'), { pcgLabels: PCG })).toMatchObject({ status: 'subdivision', account: { code: '6262' }, ambiguous: false })
    expect(mapAccountCode('626', chart('62', '626000'), { pcgLabels: PCG })).toMatchObject({ status: 'subdivision', account: { code: '626000' } })
  })

  it('keeps the code itself when its only accounts below are PCG accounts of their own (6271 is not bank fees)', () => {
    expect(mapAccountCode('627', chart('627', '6271', '6272', '6278'), { pcgLabels: PCG })).toMatchObject({ status: 'exact', account: { code: '627' }, ambiguous: false })
  })

  it('flags several subdivisions as ambiguous, padded code first, then the code itself', () => {
    const padded = mapAccountCode('626', chart('626', '626000', '626100', '626200'), { pcgLabels: PCG })
    expect(padded).toMatchObject({ status: 'subdivision', account: { code: '626000' }, ambiguous: true })
    expect(padded.status !== 'missing' && padded.alternatives.map((a) => a.code)).toEqual(['626100', '626200'])
    expect(mapAccountCode('626', chart('626', '626100', '626200'), { pcgLabels: PCG })).toMatchObject({ status: 'exact', account: { code: '626' }, ambiguous: true })
  })

  it('never guesses a VAT subdivision among several: exact, padded, or a single one', () => {
    const vat = { kind: 'exact' as const, pcgLabels: PCG }
    expect(mapAccountCode('44566', chart('44566', '445661', '445662'), vat)).toMatchObject({ status: 'exact', account: { code: '44566' } })
    expect(mapAccountCode('44566', chart('445660', '445662'), vat)).toMatchObject({ status: 'subdivision', account: { code: '445660' } })
    expect(mapAccountCode('44566', chart('445662'), vat)).toMatchObject({ status: 'subdivision', account: { code: '445662' } })
    expect(mapAccountCode('44566', chart('445', '445661', '445662'), vat)).toMatchObject({ status: 'missing', fallback: { code: '445' } })
    expect(mapAccountCode('44566', chart('44566', '445662'), { ...vat, prefer: ['445662'] })).toMatchObject({ status: 'preferred', account: { code: '445662' } })
  })

  it('proposes the account to create under its nearest parent, and the parent of 3 digits or more as fallback', () => {
    expect(mapAccountCode('63511', chart('63', '635', '6351'), { pcgLabels: PCG })).toEqual({
      code: '63511',
      status: 'missing',
      proposal: { code: '63511', label: 'Contribution économique territoriale', parentCode: '6351' },
      fallback: { id: 'id-6351', code: '6351', label: PCG.get('6351') },
    })
    // A class or a two digit account is a parent to create under, never a fallback
    expect(mapAccountCode('444', chart('44'), { pcgLabels: PCG })).toMatchObject({ status: 'missing', proposal: { parentCode: '44' }, fallback: null })
    expect(mapAccountCode('444', chart('512'), { pcgLabels: PCG })).toMatchObject({ status: 'missing', proposal: null, fallback: null })
    // A code without a PCG label is not created (the label would be invented)
    expect(mapAccountCode('626900', chart('626'), { pcgLabels: PCG })).toMatchObject({ status: 'missing', proposal: null, fallback: { code: '626' } })
  })
})

describe('mapRuleAccounts', () => {
  const selfAssessed = [{ accountCode: '651', vatType: 'import', vatAccountCode: '44566', vatAccount2Code: '4452' }]

  it('prefers 445662 for self-assessed VAT, as the rule editor preset does, and lists what is missing', () => {
    const mapping = mapRuleAccounts(selfAssessed, chart('65', '44566', '445662', '4452'), PCG)
    expect(mapping.accounts.map((a) => [a.code, a.status, a.status === 'missing' ? null : a.account.code])).toEqual([
      ['651', 'missing', null],
      ['44566', 'preferred', '445662'],
      ['4452', 'exact', '4452'],
    ])
    expect(mapping.missing).toEqual([{ code: '651', label: PCG.get('651'), parentCode: '65' }])
    expect(mapping.unresolved).toEqual([])
  })

  it('maps lines with created accounts, fallbacks or null', () => {
    const lines = [{ accountCode: '63511' }, { accountCode: '444' }]
    const mapping = mapRuleAccounts(lines, chart('44', '6351'), PCG)
    expect(mapLines(lines, mapping).map((l) => l.accountCode)).toEqual(['6351', null])
    expect(mapLines(lines, mapping, new Set(['63511', '444'])).map((l) => l.accountCode)).toEqual(['63511', '444'])
    expect(resolvedCode(mapping, { code: '999', kind: 'exact' })).toBeNull()
  })

  it('keeps the exact codes of a copied rule', () => {
    const copied = [{ accountCode: '626', vatType: 'intracom', vatAccountCode: '44566', vatAccount2Code: '4452' }]
    const mapping = mapRuleAccounts(copied, chart('626', '6262', '44566', '445662', '4452'), PCG, null, 'copy')
    expect(mapLines(copied, mapping, new Set(), 'copy')[0]).toMatchObject({ accountCode: '626', vatAccountCode: '44566', vatAccount2Code: '4452' })
  })
})
