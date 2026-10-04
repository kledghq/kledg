import { describe, expect, it } from 'vitest'
import { buildChecklist, cleanLabel, historyApplies, normalizeLabel, suggestRules, type OnboardingFacts } from '../checklist'

const fresh: OnboardingFacts = {
  accounts: 0,
  journals: 0,
  activeBankConnections: 0,
  bankProviders: [],
  bankTransactions: 0,
  foundationDate: '2026-03-14',
  firstFiscalYearStart: '2026-03-14',
  openingEntries: 0,
  earlierYearEntries: 0,
  rules: 0,
  ruleSuggestions: [],
  accountants: 0,
  aiConnections: 0,
}

const ctx = { companySlug: 'atelier-lumen', canManageMembers: true }
const step = (facts: OnboardingFacts, id: string, context = ctx) => buildChecklist(facts, context).steps.find((s) => s.id === id)

describe('buildChecklist', () => {
  it('lists the steps of a new company, none done', () => {
    const list = buildChecklist(fresh, ctx)
    expect(list.steps.map((s) => s.id)).toEqual(['chart', 'bank', 'rule', 'accountant', 'assistant'])
    expect(list.done).toBe(0)
    expect(list.complete).toBe(false)
    for (const s of list.steps) {
      expect(s.why.length).toBeGreaterThan(20)
      expect(`${s.title} ${s.why}`).not.toMatch(/[\u2013\u2014]/u)
    }
  })

  it('detects the chart of accounts from accounts and journals', () => {
    expect(step({ ...fresh, accounts: 412, journals: 5 }, 'chart')).toMatchObject({ done: true, detail: '412 comptes, 5 journaux' })
    expect(step({ ...fresh, accounts: 412 }, 'chart')?.done).toBe(false)
  })

  it('detects the bank from an active connection or imported operations', () => {
    expect(step({ ...fresh, activeBankConnections: 1, bankProviders: ['Qonto'] }, 'bank')).toMatchObject({
      done: true,
      detail: 'Connectée à Qonto',
    })
    expect(step({ ...fresh, bankTransactions: 37 }, 'bank')).toMatchObject({ done: true, detail: '37 opérations reçues' })
    expect(step(fresh, 'bank')?.action?.href).toBe('/atelier-lumen/banking/connect')
  })

  it('asks to take over the history only for a company that existed before its first exercice in Kledg', () => {
    const existing = { ...fresh, foundationDate: '2015-06-01', firstFiscalYearStart: '2026-01-01' }
    expect(step(existing, 'history')).toMatchObject({ done: false, action: { href: '/atelier-lumen/fiscal-years/opening-balances' } })
    expect(step({ ...existing, openingEntries: 1 }, 'history')).toMatchObject({ done: true, detail: 'Écriture d’à-nouveaux saisie' })
    expect(step({ ...existing, earlierYearEntries: 120 }, 'history')?.done).toBe(true)
    // Unknown creation date: better to offer it
    expect(historyApplies({ foundationDate: null, firstFiscalYearStart: '2026-01-01' })).toBe(true)
    expect(historyApplies({ foundationDate: '2026-03-14', firstFiscalYearStart: '2026-03-14' })).toBe(false)
    expect(historyApplies({ foundationDate: '2026-03-14', firstFiscalYearStart: null })).toBe(false)
  })

  it('suggests a first rule from frequent labels until a rule exists', () => {
    const suggestions = [{ label: 'OVH SAS', count: 8, transactionId: 'tx-1' }]
    expect(step({ ...fresh, ruleSuggestions: suggestions }, 'rule')).toMatchObject({
      done: false,
      detail: 'Libellés fréquents : OVH SAS (8 fois)',
      action: { label: 'Créer la règle « OVH SAS »', href: '/atelier-lumen/rules?fromTransaction=tx-1' },
    })
    expect(step({ ...fresh, rules: 2, ruleSuggestions: suggestions }, 'rule')).toMatchObject({ done: true, detail: '2 règles' })
  })

  it('detects the accountant from a member with the Comptable role only', () => {
    expect(step({ ...fresh, accountants: 1 }, 'accountant')).toMatchObject({ done: true, detail: '1 membre avec le rôle Comptable' })
    expect(step({ ...fresh, accountants: 2 }, 'accountant')?.detail).toBe('2 membres avec le rôle Comptable')
    // A second member with another role (viewer, administrator) is not an accountant
    expect(step(fresh, 'accountant')).toMatchObject({ done: false, detail: null })
    // Members are managed by instance administrators: no button for others
    expect(step(fresh, 'accountant', { ...ctx, canManageMembers: false })?.action).toBeNull()
  })

  it('detects an AI assistant and completes the list', () => {
    const all: OnboardingFacts = {
      ...fresh,
      accounts: 10,
      journals: 5,
      bankTransactions: 3,
      rules: 1,
      accountants: 1,
      aiConnections: 1,
    }
    const list = buildChecklist(all, ctx)
    expect(list.done).toBe(list.total)
    expect(list.complete).toBe(true)
  })
})

describe('rule suggestions', () => {
  it('groups labels of the same counterpart, ignoring dates, references and payment words', () => {
    expect(normalizeLabel('PRLV SEPA OVH SAS 12/09/2026 REF 4471')).toBe('ovh sas')
    expect(normalizeLabel('CB URSSAF 03/10')).toBe('urssaf')
    expect(cleanLabel('PRLV SEPA OVH SAS 12/09/2026 REF 4471')).toBe('OVH SAS')
    expect(cleanLabel('Café du Coin')).toBe('Café du Coin')
    // A word that merely contains a payment word is kept
    expect(cleanLabel('Virginie Carpentier')).toBe('Virginie Carpentier')
  })

  it('keeps the counterparts seen at least twice, most frequent first', () => {
    const transactions = [
      { id: 'a', label: 'PRLV SEPA OVH SAS 12/09', counterpartyName: null },
      { id: 'b', label: 'PRLV SEPA OVH SAS 12/08', counterpartyName: null },
      { id: 'c', label: 'PRLV SEPA OVH SAS 12/07', counterpartyName: null },
      { id: 'd', label: 'VIR URSSAF', counterpartyName: 'URSSAF' },
      { id: 'e', label: 'URSSAF cotisations', counterpartyName: 'URSSAF' },
      { id: 'f', label: 'Café du coin', counterpartyName: null },
      { id: 'g', label: '1234', counterpartyName: null },
    ]
    expect(suggestRules(transactions)).toEqual([
      { label: 'OVH SAS', count: 3, transactionId: 'a' },
      { label: 'URSSAF', count: 2, transactionId: 'd' },
    ])
  })
})
