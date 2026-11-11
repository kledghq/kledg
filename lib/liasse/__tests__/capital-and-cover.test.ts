/**
 * Forms 2033-F-SD, 2033-G-SD (lib/liasse/capital.ts) and 2065-SD
 * (lib/liasse/form-2065.ts), and the liasse assembled (build-liasse.ts,
 * liasse-document.ts). Sources: forms n° 2033-F-SD and 2033-G-SD 2026 and
 * notice 2033-NOT-SD (shareholders and subsidiaries from 10 % of the capital,
 * annexe III au CGI art. 38; not served by an entreprise individuelle);
 * form n° 2065-SD 2026 and its notice (result split by rate, CGI art. 219, I).
 */

import { describe, expect, it } from 'vitest'
import { assembleLiasse } from '../build-liasse'
import { buildCapitalForm, buildSubsidiariesForm, CAPITAL_CODES_2033F, type CompanyIdentity, type HolderIdentity } from '../capital'
import { cellByBox, cellsOf } from '../cells'
import { buildCoverForm } from '../form-2065'
import { liasseCsv, liasseDocument } from '../liasse-document'

const COMPANY: CompanyIdentity = {
  name: 'Atelier Lumen',
  siren: '111111111',
  siret: '11111111100011',
  legalType: 'SARL',
  address: { street: '3 rue des Lilas', postalCode: '69001', city: 'Lyon', country: 'FR' },
  endDate: '2026-12-31',
}

const holder = (h: Partial<HolderIdentity> & Pick<HolderIdentity, 'id' | 'kind' | 'name'>): HolderIdentity => ({
  shares: null,
  percentHundredths: 0,
  siren: null,
  legalForm: null,
  address: null,
  lastName: null,
  firstNames: null,
  usualName: null,
  birthRecorded: false,
  addressRecorded: false,
  ...h,
})

const HOLDERS = [
  holder({ id: 'p1', kind: 'PHYSICAL', name: 'Camille Martin', lastName: 'Martin', firstNames: 'Camille', shares: 600, percentHundredths: 6_000, birthRecorded: true, addressRecorded: true }),
  holder({ id: 'p2', kind: 'PHYSICAL', name: 'Léa Petit', lastName: 'Petit', firstNames: 'Léa', shares: 50, percentHundredths: 500 }),
  holder({ id: 'l1', kind: 'LEGAL', name: 'Holding Lumen', siren: '222222222', legalForm: 'SAS', shares: 350, percentHundredths: 3_500, address: { street: '1 place Bellecour', postalCode: '69002', city: 'Lyon', country: 'FR' } }),
]

const capital = (holders = HOLDERS, company = COMPANY, compositionChecks: string[] = []) =>
  buildCapitalForm({ form: { id: '2033-F', number: '2033-F-SD', title: 'Composition du capital social' }, codes: CAPITAL_CODES_2033F, identifier: 'siren', company, holders, compositionChecks })

describe('form 2033-F-SD, composition du capital', () => {
  it('counts the shareholders and their shares in boxes 901 to 906', () => {
    const form = capital()
    const n = (box: string) => cellByBox(form, box)?.value
    expect([n('901'), n('902'), n('903'), n('904'), n('905'), n('906')]).toEqual([
      { kind: 'count', value: 1 },
      { kind: 'count', value: 350 },
      { kind: 'count', value: 2 },
      { kind: 'count', value: 650 },
      { kind: 'count', value: 3 },
      { kind: 'count', value: 1_000 },
    ])
  })

  it('lists only the shareholders holding 10 % or more, never copying the birth data or address of a person', () => {
    const form = capital()
    const natural = form.sections.find((s) => s.id === 'natural')!
    expect(natural.rows.map((r) => r.label)).toEqual(['Camille Martin'])
    const birth = natural.rows[0].cells.find((c) => c.label.startsWith('Naissance'))!
    expect(birth).toMatchObject({ source: 'manual', value: null })
    expect(birth.note).toContain('Enregistrée sur la fiche')
    expect(form.sections.find((s) => s.id === 'legal')!.rows[0].cells.map((c) => c.value)).toEqual([
      { kind: 'text', value: 'SAS' },
      { kind: 'text', value: 'Holding Lumen' },
      { kind: 'text', value: '222222222' },
      { kind: 'percent', hundredths: 3_500 },
      { kind: 'count', value: 350 },
      { kind: 'text', value: '1 place Bellecour, 69002 Lyon' },
    ])
  })

  it('carries the checks of the capital composition and flags an incomplete identity', () => {
    const form = capital([...HOLDERS.slice(1), holder({ id: 'p3', kind: 'PHYSICAL', name: 'Noé Roux', shares: 600, percentHundredths: 6_000 })], COMPANY, ['Le total des pourcentages est de 101 % au lieu de 100 %.'])
    expect(form.checks.filter((c) => !c.ok).map((c) => c.message)).toEqual([
      'Le total des pourcentages est de 101 % au lieu de 100 %.',
      "La date et le lieu de naissance ou l'adresse de Noé Roux manquent sur sa fiche\u00a0: complétez-la dans Société, Informations.",
    ])
  })

  it('asks for the share counts when one is missing, and is not served by an entreprise individuelle', () => {
    expect(cellByBox(capital([holder({ id: 'p1', kind: 'PHYSICAL', name: 'A', percentHundredths: 10_000 })]), '904')).toMatchObject({ source: 'manual' })
    expect(capital(HOLDERS, { ...COMPANY, legalType: 'EI' }).required.value).toBe(false)
  })
})

describe('form 2033-G-SD, filiales et participations', () => {
  const subsidiaries = (overrides: Partial<Parameters<typeof buildSubsidiariesForm>[0]> = {}) =>
    buildSubsidiariesForm({
      form: { id: '2033-G', number: '2033-G-SD', title: 'Filiales et participations' },
      countBox: '905',
      identifier: 'siren',
      company: COMPANY,
      subsidiaries: [
        { name: 'Lumen Lyon', siren: '333333333', ownershipHundredths: 10_000, legalForm: 'SASU', address: null, from: 'group' },
        { name: 'Coop Achats', siren: null, ownershipHundredths: 500, legalForm: null, address: null, from: 'annexe' },
      ],
      unreachable: 0,
      titresCents: 500_000,
      unattributed: [],
      ...overrides,
    })

  it('lists the companies held for 10 % or more and counts them in box 905', () => {
    const form = subsidiaries()
    expect(cellByBox(form, '905')).toMatchObject({ source: 'record', value: { kind: 'count', value: 1 } })
    expect(form.sections.find((s) => s.id === 'subsidiaries')!.rows.map((r) => r.label)).toEqual(['Lumen Lyon'])
    expect(form.checks.every((c) => c.ok)).toBe(true)
  })

  it('makes the count a figure to check when a subsidiary cannot be read', () => {
    expect(cellByBox(subsidiaries({ unreachable: 1 }), '905')).toMatchObject({ source: 'manual', hint: { kind: 'count', value: 1 } })
  })

  it('flags titres de participation (261) with no subsidiary recorded', () => {
    const form = subsidiaries({ subsidiaries: [] })
    expect(form.checks.find((c) => c.id === 'titres')).toMatchObject({ ok: false })
    expect(form.checks.find((c) => c.id === 'titres')?.message).toContain('5 000,00')
  })
})

describe('form 2065-SD', () => {
  const cover = (corporateTax: Parameters<typeof buildCoverForm>[0]['corporateTax']) =>
    buildCoverForm({
      regime: 'simplified',
      company: { ...COMPANY, email: 'contact@lumen.test', activityCode: '7410Z' },
      fiscalYear: { startDate: '2026-01-01', endDate: '2026-12-31' },
      corporateTax,
      why: "Aucun calcul de l'impôt sur les sociétés pour cet exercice.",
      salariesCents: 9_000_000,
    })

  it('splits the tax result by rate from the worksheet, and fills what Kledg knows of the company', () => {
    const form = cover({ normalBaseCents: 1_000_000, reducedBaseCents: 4_250_000, deficitCents: 0, eligibilityUnknown: false, reliable: true })
    const byLabel = (label: string) => cellsOf(form).find((x) => x.cell.label === label)?.cell
    expect(byLabel('Bénéfice imposable à 15 %')).toMatchObject({ source: 'worksheet', value: { kind: 'amount', cents: 4_250_000 } })
    expect(byLabel('Bénéfice imposable au taux normal')).toMatchObject({ value: { kind: 'amount', cents: 1_000_000 } })
    expect(byLabel("Régime simplifié d'imposition")?.value).toEqual({ kind: 'flag', value: true })
    expect(byLabel('SIRET')?.value).toEqual({ kind: 'text', value: '11111111100011' })
    expect(byLabel('Indication du logiciel utilisé')?.value).toEqual({ kind: 'text', value: 'Kledg' })
    expect(byLabel('Montant brut des salaires (a)')).toMatchObject({ source: 'manual', hint: { kind: 'amount', cents: 9_000_000 } })
    expect(byLabel('PV à long terme imposables à 15 %')).toMatchObject({ source: 'manual' })
    expect(form.checks).toEqual([{ id: 'corporate-tax', label: "Calcul de l'impôt sur les sociétés", ok: true, message: null }])
  })

  it('asks for the result when there is no worksheet', () => {
    const form = cover(null)
    expect(cellsOf(form).find((x) => x.cell.label === 'Déficit')?.cell).toMatchObject({ source: 'manual' })
    expect(form.checks[0]).toMatchObject({ ok: false })
  })
})

describe('the liasse assembled', () => {
  const forms = [capital()]
  const view = assembleLiasse({
    status: 'ready',
    regime: 'simplified',
    company: { name: 'Atelier Lumen', siren: '111111111' },
    fiscalYear: { id: 'fy', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', isClosed: true },
    forms,
    warnings: [],
  })

  it('lists every table of the regime with where it is prepared', () => {
    expect(view.tables.map((t) => t.number)).toEqual(['2065-SD', '2033-A-SD', '2033-B-SD', '2033-B-SD', '2033-C-SD', '2033-D-SD', '2033-E-SD', '2033-F-SD', '2033-G-SD'])
    expect(view.tables.find((t) => t.id === '2033-C')).toMatchObject({ status: 'page', href: '/reports/fixed-asset-movements' })
    expect(view.tables.find((t) => t.id === '2033-F')?.coverage).toMatchObject({ checksToReview: 0, required: true })
    expect(view.filing).toContain('partenaire EDI')
    const normal = assembleLiasse({ ...view, status: 'ready', regime: 'normal', forms: [], warnings: [] })
    expect(normal.tables.find((t) => t.id === '2059-A')).toMatchObject({ status: 'manual' })
  })

  it('has no tables for a company not subject to the impôt sur les sociétés', () => {
    expect(assembleLiasse({ ...view, status: 'not-subject', regime: null, forms, warnings: [] })).toMatchObject({ tables: [], forms: [], sources: [] })
  })

  it('exports one CSV row per box, with the box code, the value and its origin', () => {
    const csv = liasseCsv(view)
    expect(csv).toContain('2033-F-SD;Associés et actionnaires;Nombre total de parts ou d\'actions correspondantes (personnes morales);;902;350;Fiche Kledg;;')
    expect(csv).toContain('À remplir à la main')
    expect(liasseDocument(view).fileName).toBe('Liasse_fiscale_2026')
  })
})
