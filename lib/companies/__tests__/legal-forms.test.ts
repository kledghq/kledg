/**
 * Legal forms: tags, display names and the INSEE legal category mapping
 * (nomenclature des catégories juridiques, niveau III, INSEE, version of
 * September 2022: https://www.insee.fr/fr/information/2028129).
 */

import { describe, expect, it } from 'vitest'
import {
  LEGAL_FORMS,
  LEGAL_TYPES,
  companyInitials,
  displayCompanyName,
  legalFormName,
  legalFormTag,
  legalTypeFromNatureJuridique,
} from '../legal-forms'

describe('legal forms', () => {
  it('describes every enum value once, with a tag and a full name', () => {
    expect(LEGAL_FORMS.map((f) => f.value).sort()).toEqual([...LEGAL_TYPES].sort())
    expect(legalFormTag('SASU')).toBe('SASU')
    expect(legalFormName('SASU')).toBe('Société par actions simplifiée unipersonnelle')
    expect(legalFormTag(null)).toBeNull()
    expect(legalFormTag('HOLDING')).toBeNull()
  })

  it('maps INSEE legal categories to the forms Kledg knows', () => {
    const cases: Array<[string, string | null]> = [
      ['1000', 'EI'], // Entrepreneur individuel
      ['5202', 'SNC'], // Société en nom collectif
      ['5306', 'SCS'], // Société en commandite simple
      ['5308', 'SCA'], // Société en commandite par actions
      ['5485', 'SELARL'], // Société d'exercice libéral à responsabilité limitée
      ['5499', 'SARL'], // SARL (sans autre indication)
      ['5458', 'SARL'], // SARL coopérative de production (SCOP)
      ['5498', 'EURL'], // SARL unipersonnelle (retired in 2020, older records)
      ['5599', 'SA'], // SA à conseil d'administration
      ['5699', 'SA'], // SA à directoire
      ['5710', 'SAS'], // SAS (INSEE does not distinguish SASU)
      ['5785', 'SELAS'], // Société d'exercice libéral par action simplifiée
      ['6540', 'SCI'], // Société civile immobilière
      ['6599', null], // Autre société civile
      ['9220', null], // Association déclarée
      ['abc', null],
    ]
    for (const [code, expected] of cases) expect(legalTypeFromNatureJuridique(code), code).toBe(expected)
  })

  it('removes the company own legal form from the displayed name only', () => {
    expect(displayCompanyName('SCI Les Tilleuls', 'SCI')).toBe('Les Tilleuls')
    expect(displayCompanyName('Atelier Lumen SASU', 'SASU')).toBe('Atelier Lumen')
    expect(displayCompanyName('ATELIER LUMEN SAS', 'SASU')).toBe('ATELIER LUMEN')
    expect(displayCompanyName('S.A.S. MARTIN BOULANGERIE', 'SAS')).toBe('MARTIN BOULANGERIE')
    expect(displayCompanyName('Lumen Holding (SAS)', 'SAS')).toBe('Lumen Holding')
    // Not its own form, a word that merely starts like it, or a name that is only the form
    expect(displayCompanyName('SCI Les Tilleuls', 'SARL')).toBe('SCI Les Tilleuls')
    expect(displayCompanyName('Sa Maison', 'SA')).toBe('Sa Maison')
    expect(displayCompanyName('Scierie du Lac', 'SCI')).toBe('Scierie du Lac')
    expect(displayCompanyName('SAS', 'SAS')).toBe('SAS')
    expect(displayCompanyName('Maison Verdier', null)).toBe('Maison Verdier')
  })

  it('builds initials from the displayed name', () => {
    expect(companyInitials('SCI Les Tilleuls', 'SCI')).toBe('LT')
    expect(companyInitials('Atelier Lumen', 'SASU')).toBe('AL')
    expect(companyInitials('Maison & Fils', null)).toBe('MF')
    expect(companyInitials(null)).toBe('')
  })
})
