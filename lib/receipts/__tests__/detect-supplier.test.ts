/**
 * Supplier of a transaction without receipt (lib/receipts/detect-supplier.ts):
 * a known vendor first, with the page of its invoices; else a tiers of the
 * company named in the label as whole words (legal forms left out), the
 * suppliers for a payment and the customers for a receipt; else nothing.
 */

import { describe, expect, it } from 'vitest'
import { detectSupplier, detectTiers, indexTiers, words, type TiersCandidate } from '../detect-supplier'
import { receiptVendorById } from '../vendors'

const TIERS: TiersCandidate[] = [
  { id: 't-martin', name: 'Imprimerie Martin SARL', kind: 'SUPPLIER', auxiliaryAccountNumber: 'FMARTIN' },
  { id: 't-sci', name: 'SCI Les Tilleuls', kind: 'SUPPLIER', auxiliaryAccountNumber: 'F0002' },
  { id: 't-ovh', name: 'OVH SAS', kind: 'SUPPLIER', auxiliaryAccountNumber: 'OVH' },
  { id: 't-nord', name: 'Studio Nord', kind: 'CUSTOMER', auxiliaryAccountNumber: 'C0001' },
  { id: 't-sa', name: 'SA', kind: 'SUPPLIER', auxiliaryAccountNumber: '401' },
  { id: 't-dupont', name: 'Ets Durand', kind: 'SUPPLIER', auxiliaryAccountNumber: 'DUPONT' },
]
const index = indexTiers(TIERS)

const debit = (label: string | null, counterpartyName: string | null = null) => ({ label, counterpartyName, side: 'debit' as const })

describe('detectSupplier', () => {
  it('names a known vendor with the page of its invoices, and the tiers that matches it too', () => {
    const ovh = receiptVendorById('ovhcloud')
    expect(detectSupplier(debit('PRLV SEPA OVH SAS FR123'), index)).toEqual({
      name: 'OVHcloud',
      kind: 'vendor',
      vendorId: 'ovhcloud',
      tiersId: 't-ovh',
      invoicesUrl: ovh?.invoicesUrl ?? null,
    })
  })

  it('falls back on a supplier tiers named in the label or the counterparty', () => {
    expect(detectSupplier(debit('PRLV SEPA IMPRIMERIE MARTIN FACT 2026-09'), index)).toMatchObject({ name: 'Imprimerie Martin SARL', kind: 'SUPPLIER', tiersId: 't-martin', vendorId: null, invoicesUrl: null })
    expect(detectSupplier(debit('VIR SEPA LOYER OCTOBRE', 'SCI LES TILLEULS'), index)).toMatchObject({ tiersId: 't-sci' })
    expect(detectSupplier(debit('VIR SEPA FMARTIN'), index)).toMatchObject({ tiersId: 't-martin' })
    expect(detectSupplier(debit('PRLV DUPONT ATELIER'), index)).toMatchObject({ tiersId: 't-dupont', name: 'Ets Durand' })
  })

  it('looks for customers on a receipt, never suppliers', () => {
    expect(detectSupplier({ label: 'VIR SEPA STUDIO NORD FACTURE F12', counterpartyName: null, side: 'credit' }, index)).toMatchObject({ kind: 'CUSTOMER', tiersId: 't-nord' })
    expect(detectSupplier({ label: 'VIR SEPA IMPRIMERIE MARTIN AVOIR', counterpartyName: null, side: 'credit' }, index)).toBeNull()
  })

  it('recognises nothing in an unrelated label, on parts of words or with a generic tiers name', () => {
    expect(detectSupplier(debit('CB BOULANGERIE DU MARCHE'), index)).toBeNull()
    expect(detectSupplier(debit('CB MARTINEZ TRAITEUR'), index)).toBeNull()
    expect(detectSupplier(debit('PRLV SA ASSURANCES 401'), index)).toBeNull()
    expect(detectSupplier(debit(null, null), index)).toBeNull()
    expect(detectSupplier(debit('CB OVH'), indexTiers([]))).toMatchObject({ vendorId: 'ovhcloud', tiersId: null })
  })
})

describe('detectTiers', () => {
  it('prefers the longest name when several tiers match', () => {
    const both = indexTiers([
      { id: 'a', name: 'Martin', kind: 'SUPPLIER', auxiliaryAccountNumber: 'A1' },
      { id: 'b', name: 'Imprimerie Martin', kind: 'SUPPLIER', auxiliaryAccountNumber: 'B1' },
    ])
    expect(detectTiers(['PRLV IMPRIMERIE MARTIN'], both, 'SUPPLIER')?.id).toBe('b')
  })

  it('compares words without accents, case nor punctuation', () => {
    expect(words("Café de l'Éclair, S.A.S.")).toBe('cafe de l eclair s a s')
    const cafe = indexTiers([{ id: 'c', name: "Café de l'Éclair", kind: 'SUPPLIER', auxiliaryAccountNumber: 'X1' }])
    expect(detectTiers(['CB CAFE DE L ECLAIR 12/09'], cafe, 'SUPPLIER')?.id).toBe('c')
  })
})
