/**
 * Capital composition (lib/reports/capital-composition/compute.ts):
 * shares, percentages from the shares, nominal amounts, the 10 % threshold
 * of forms 2033-F and 2059-F and the checks. Fictitious shareholders.
 *
 * Sources: notices of forms 2033-F-SD and 2059-F-SD (holders of at least
 * 10 % of the capital); Code de commerce art. L223-2 and L228-1 (capital =
 * shares x nominal value).
 */

import { describe, expect, it } from 'vitest'
import { buildCapitalComposition, shareKind, shareWord, sharePercentHundredths, type ShareholderInput } from '../compute'

const holder = (id: string, name: string, shares: number | null, percentHundredths: number, kind: 'PHYSICAL' | 'LEGAL' = 'PHYSICAL'): ShareholderInput => ({
  id,
  kind,
  name,
  siren: kind === 'LEGAL' ? '123456789' : null,
  shares,
  percentHundredths,
  capitalCents: null,
})

describe('buildCapitalComposition', () => {
  // SAS with 10 000 € of capital: 1 000 actions of 10 €
  const company = { legalType: 'SAS', shareCapitalCents: 1_000_000, totalShares: 1_000, nominalCents: 1_000 }

  it('computes percentages and nominal amounts from the shares, largest holder first', () => {
    const result = buildCapitalComposition(company, [
      holder('a', 'Camille Martin', 300, 3_000),
      holder('b', 'Holding Exemple', 650, 6_500, 'LEGAL'),
      holder('c', 'Louis Bernard', 50, 500),
    ])
    expect(result.rows.map((r) => [r.name, r.sharesPercentHundredths, r.nominalAmountCents, r.declared, r.majority])).toEqual([
      ['Holding Exemple', 6_500, 650_000, true, true],
      ['Camille Martin', 3_000, 300_000, true, false],
      ['Louis Bernard', 500, 50_000, false, false],
    ])
    expect(result.totals).toEqual({
      holders: 3,
      physical: { holders: 2, shares: 350 },
      legal: { holders: 1, shares: 650 },
      shares: 1_000,
      percentHundredths: 10_000,
      nominalAmountCents: 1_000_000,
    })
    expect(result.capital.sharesTimesNominalCents).toBe(1_000_000)
    expect(result.checks).toEqual([])
    expect(result.shareKind).toBe('actions')
  })

  it('lists the inconsistencies', () => {
    const result = buildCapitalComposition({ ...company, shareCapitalCents: 1_500_000 }, [holder('a', 'Camille Martin', 300, 3_500), holder('b', 'Louis Bernard', 600, 6_000)])
    expect(result.checks).toEqual([
      "Le capital social (15 000,00 €) ne correspond pas au nombre d'actions multiplié par la valeur nominale (1\u00a0000 x 10,00 € = 10 000,00 €).",
      'Les actionnaires détiennent 900 actions sur 1\u00a0000\u00a0: complétez la répartition.',
      'Le total des pourcentages est de 95 % au lieu de 100 %.',
      'Camille Martin\u00a0: 35 % enregistrés, mais 300 actions sur 1\u00a0000 font 30 %.',
    ])
  })

  it('applies the 10 % threshold of forms 2033-F and 2059-F to the stored percentage without share counts', () => {
    const result = buildCapitalComposition({ legalType: 'SARL', shareCapitalCents: 100_000, totalShares: null, nominalCents: null }, [
      holder('a', 'Camille Martin', null, 9_050),
      holder('b', 'Louis Bernard', null, 950),
    ])
    expect(result.rows.map((r) => [r.name, r.declared])).toEqual([
      ['Camille Martin', true],
      ['Louis Bernard', false],
    ])
    expect(result.totals.nominalAmountCents).toBeNull()
    expect(result.checks).toEqual(['Le nombre de parts sociales manque pour certains actionnaires.'])
  })

  it('asks for shareholders and for the capital when missing', () => {
    expect(buildCapitalComposition({ legalType: null, shareCapitalCents: null, totalShares: null, nominalCents: null }, []).checks).toEqual([
      "Aucun actionnaire n'est enregistré\u00a0: ajoutez-les dans Société, Informations.",
      "Le capital social n'est pas renseigné dans les informations de la société.",
    ])
  })
})

describe('shares', () => {
  it('names the shares by legal form', () => {
    expect(shareKind('SARL')).toBe('parts')
    expect(shareKind('SASU')).toBe('actions')
    expect(shareWord('EURL', 1)).toBe('part sociale')
    expect(shareWord('SA', 3)).toBe('actions')
  })

  it('rounds percentages from shares to the hundredth', () => {
    expect(sharePercentHundredths(1, 3)).toBe(3_333)
    expect(sharePercentHundredths(2, 3)).toBe(6_667)
    expect(sharePercentHundredths(5, 0)).toBe(0)
  })
})
