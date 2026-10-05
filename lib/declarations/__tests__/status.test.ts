/**
 * Status of a deadline (lib/declarations/status.ts, sources.ts): à faire,
 * déposée, payée, en retard, non due, from the tracker and from the facts
 * other modules hold, never entered twice. The VAT of a CA3 or CA12 is paid
 * with the return (CGI art. 1692); a liasse filed online has 15 more days
 * (the extendedDate of the calendar).
 */

import { describe, expect, it } from 'vitest'
import type { Deadline } from '@/lib/deadlines/types'
import { deriveStatus, declarationKindOf, statusLabel, type TrackerRecord } from '../status'
import { sourceFactsOf, type SourceData } from '../sources'

const deadline = (over: Partial<Deadline>): Deadline => ({
  id: 'cfe:2026',
  date: '2026-12-15',
  legalDate: '2026-12-15',
  label: 'Paiement de la CFE 2026',
  form: 'CFE',
  category: 'cfe',
  ruleId: 'cfe',
  estimated: false,
  projected: false,
  ...over,
})

const record = (over: Partial<TrackerRecord>): TrackerRecord => ({
  filedOn: null,
  paidOn: null,
  amountCents: null,
  notDue: false,
  attachmentId: null,
  attachmentName: null,
  attachmentReference: null,
  note: null,
  updatedAt: null,
  ...over,
})

const EMPTY: SourceData = { vatFilings: new Map(), corporateTax: new Map(), approvals: new Map(), localTaxes: new Map() }

describe('deriveStatus', () => {
  it('a payment: à faire, then en retard after the day, payée once paid', () => {
    const cfe = deadline({})
    expect(deriveStatus(cfe, null, null, '2026-12-10')).toMatchObject({ status: 'todo', label: 'À faire', kind: 'pay', settled: false })
    expect(deriveStatus(cfe, null, null, '2026-12-16')).toMatchObject({ status: 'overdue', label: 'En retard', settled: false })
    expect(deriveStatus(cfe, null, record({ paidOn: '2026-12-14', amountCents: 123_400 }), '2026-12-16')).toMatchObject({
      status: 'paid',
      label: 'Payée',
      settled: true,
      paidOn: '2026-12-14',
      paidFrom: 'tracker',
      amountCents: 123_400,
    })
  })

  it('a return filed online is late only after the extension', () => {
    const liasse = deadline({ id: 'liasse:2025-12-31', ruleId: 'liasse', category: 'liasse', date: '2026-05-05', extendedDate: '2026-05-20' })
    expect(deriveStatus(liasse, null, null, '2026-05-10')).toMatchObject({ status: 'todo', lateAfter: '2026-05-20' })
    expect(deriveStatus(liasse, null, null, '2026-05-21').status).toBe('overdue')
    expect(deriveStatus(liasse, null, record({ filedOn: '2026-05-12' }), '2026-06-01')).toMatchObject({ status: 'filed', label: 'Déposée', settled: true })
  })

  it('a return with a payment: déposée until paid, payée once both, settled when nothing is due', () => {
    const solde = deadline({ id: 'cvae-solde:2025', ruleId: 'cvae-solde', category: 'cvae', date: '2026-05-05' })
    expect(declarationKindOf('cvae-solde')).toBe('file-and-pay')
    expect(deriveStatus(solde, null, record({ filedOn: '2026-05-04', amountCents: 50_000 }), '2026-05-04')).toMatchObject({ status: 'filed', settled: false })
    expect(deriveStatus(solde, null, record({ filedOn: '2026-05-04', amountCents: 50_000 }), '2026-05-06').status).toBe('overdue')
    expect(deriveStatus(solde, null, record({ filedOn: '2026-05-04', paidOn: '2026-05-04' }), '2026-05-06')).toMatchObject({ status: 'paid', settled: true })
    expect(deriveStatus(solde, null, record({ filedOn: '2026-05-04', amountCents: 0 }), '2026-05-06')).toMatchObject({ status: 'filed', settled: true })
  })

  it('not due when the user says so (a conditional acompte)', () => {
    const acompte = deadline({ id: 'is-acompte:2026-12-31:1', ruleId: 'is-acompte', category: 'is', date: '2026-03-16' })
    expect(deriveStatus(acompte, null, record({ notDue: true }), '2026-10-01')).toMatchObject({ status: 'not-due', label: 'Non due', settled: true })
  })

  it('reads the facts of other modules first and ignores the tracker for the fields they own', () => {
    const ca3 = deadline({ id: 'tva-ca3:2026-09', ruleId: 'tva-ca3', category: 'tva', date: '2026-10-19' })
    const facts = sourceFactsOf(ca3, { ...EMPTY, vatFilings: new Map([['2026-09', { filedOn: '2026-10-15', amountDueCents: 120_000 }]]) })
    const status = deriveStatus(ca3, facts, record({ filedOn: '2026-10-01', note: 'Payé par prélèvement' }), '2026-10-20')
    expect(status).toMatchObject({ status: 'paid', filedOn: '2026-10-15', paidOn: '2026-10-15', filedFrom: 'vat-return', amountCents: 120_000, locked: ['filedOn', 'paidOn'] })
    expect(status.sourcePage).toEqual({ page: 'declarations-tva?periode=2026-09', label: 'Déclarations de TVA' })
    // A credit: filed, nothing to pay
    const credit = sourceFactsOf(ca3, { ...EMPTY, vatFilings: new Map([['2026-09', { filedOn: '2026-10-15', amountDueCents: 0 }]]) })
    expect(deriveStatus(ca3, credit, null, '2026-10-20')).toMatchObject({ status: 'filed', settled: true, paidOn: null })
    // Not recorded on the VAT page: the tracker cannot fill it in
    const none = sourceFactsOf(ca3, EMPTY)
    expect(deriveStatus(ca3, none, record({ filedOn: '2026-10-01' }), '2026-10-20')).toMatchObject({ status: 'overdue', filedOn: null })
  })

  it('words the approval of the accounts', () => {
    expect(statusLabel('filed', 'approbation')).toBe('Approuvés')
    expect(statusLabel('filed', 'depot-comptes')).toBe('Déposés')
    expect(statusLabel('filed', 'liasse')).toBe('Déposée')
  })
})

describe('sourceFactsOf', () => {
  const data: SourceData = {
    ...EMPTY,
    corporateTax: new Map([['2026-12-31', { fiscalYearId: 'fy26', filedOn: '2027-05-04', acomptesPaid: [{ number: 2, paidOn: '2026-06-12', amountCents: 75_000 }] }]]),
    approvals: new Map([['2026-12-31', { fiscalYearId: 'fy26', approvedOn: '2027-06-20', filedOn: null }]]),
    localTaxes: new Map([[2026, { cfeTotalCents: 0, cfeAcompteCents: null }], [2027, { cfeTotalCents: 400_000, cfeAcompteCents: 0 }]]),
  }

  it('maps the IS filing, the acomptes paid and the approval to their deadlines', () => {
    expect(sourceFactsOf(deadline({ id: 'liasse:2026-12-31', ruleId: 'liasse' }), data)).toMatchObject({ source: 'corporate-tax', filedOn: '2027-05-04', locked: ['filedOn'], page: 'impot-societes?exercice=fy26' })
    expect(sourceFactsOf(deadline({ id: 'is-acompte:2026-12-31:2', ruleId: 'is-acompte' }), data)).toMatchObject({ paidOn: '2026-06-12', amountCents: 75_000, locked: ['paidOn'] })
    expect(sourceFactsOf(deadline({ id: 'is-acompte:2026-12-31:3', ruleId: 'is-acompte' }), data)).toMatchObject({ paidOn: null, locked: ['paidOn'] })
    expect(sourceFactsOf(deadline({ id: 'approbation:2026-12-31', ruleId: 'approbation' }), data)).toMatchObject({ source: 'approval', filedOn: '2027-06-20', page: 'approval' })
    expect(sourceFactsOf(deadline({ id: 'depot-comptes:2026-12-31', ruleId: 'depot-comptes' }), data)).toMatchObject({ filedOn: null, locked: ['filedOn'] })
    // A projected fiscal year (not in Kledg yet): nothing locked
    expect(sourceFactsOf(deadline({ id: 'liasse:2027-12-31', ruleId: 'liasse' }), data)).toBeNull()
  })

  it('says a CFE of zero (or an acompte the avis does not ask) is not due', () => {
    expect(sourceFactsOf(deadline({ id: 'cfe:2026' }), data)).toMatchObject({ source: 'local-taxes', notDue: true, locked: [] })
    expect(sourceFactsOf(deadline({ id: 'cfe:2027' }), data)).toBeNull()
    expect(sourceFactsOf(deadline({ id: 'cfe-acompte:2027', ruleId: 'cfe-acompte' }), data)).toMatchObject({ notDue: true })
    expect(deriveStatus(deadline({ id: 'cfe:2026' }), sourceFactsOf(deadline({ id: 'cfe:2026' }), data), null, '2027-01-10')).toMatchObject({ status: 'not-due', settled: true })
    expect(sourceFactsOf(deadline({ id: 'das2:2026', ruleId: 'das2' }), data)).toBeNull()
  })
})
