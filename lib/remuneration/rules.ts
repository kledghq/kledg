/**
 * Rates and thresholds of the "Rémunération et dividendes" simulator
 * (docs/remuneration-dividendes.md), for pay and dividends of 2026, dated
 * and cited. Pure data, usable on both sides. Amounts in cents, rates in
 * basis points (10 000 = 100 %), thresholds as shares of the PASS in basis
 * points when the law states them so.
 *
 * Checked on 5 October 2026 against the LFI 2026 (loi n° 2026-103 du
 * 19 février 2026) and the LFSS 2026 (loi n° 2025-1403 du 30 décembre 2025).
 * The income tax scale is the one of LFI 2026 for 2025 incomes (art. 4,
 * indexed by 0,9 %): the scale of 2026 incomes comes with LFI 2027, so the
 * simulator uses the latest one, which the page says.
 *
 * The IS rates are those of lib/corporate-tax/rules.ts (CGI art. 219, I),
 * reused, not repeated.
 */

/** Year of the pay and dividends the rates apply to; saved with each scenario. */
export const RULES_YEAR = 2026

/** Plafond annuel de la sécurité sociale 2026: 48 060 € (arrêté du 22 décembre 2025). */
export const PASS_CENTS = 4_806_000

export interface Bracket {
  fromCents: number
  toCents: number | null
  rateBp: number
}

export const RULES = {
  incomeTax: {
    /** Scale for 2025 incomes, CGI art. 197, I, 1 as amended by LFI 2026 art. 4 (per part). */
    scaleIncomeYear: 2025,
    brackets: [
      { fromCents: 0, toCents: 1_160_000, rateBp: 0 },
      { fromCents: 1_160_000, toCents: 2_957_900, rateBp: 1_100 },
      { fromCents: 2_957_900, toCents: 8_457_700, rateBp: 3_000 },
      { fromCents: 8_457_700, toCents: 18_191_700, rateBp: 4_100 },
      { fromCents: 18_191_700, toCents: null, rateBp: 4_500 },
    ] as readonly Bracket[],
    /** Plafonnement du quotient familial per half part (CGI art. 197, I, 2). */
    quotientCapPerHalfPartCents: 180_700,
    /** Décote (CGI art. 197, I, 4): 897 € (single) or 1 483 € (couple) minus 45,25 % of the tax. */
    decoteSingleCents: 89_700,
    decoteCoupleCents: 148_300,
    decoteBp: 4_525,
    /** 10 % deduction for professional expenses on salaries (CGI art. 83, 3°; BOI-BAREME-000035): 509 € to 14 555 €. */
    deductionBp: 1_000,
    deductionMinCents: 50_900,
    deductionMaxCents: 1_455_500,
  },
  dividends: {
    /** IR part of the prélèvement forfaitaire unique (CGI art. 200 A, 1, A). */
    pfuIncomeTaxBp: 1_280,
    /**
     * Prélèvements sociaux on dividends paid from 1 January 2026: CSG 10,6 %
     * (CSS art. L136-8, I, 2° as amended by LFSS 2026 art. 12), CRDS 0,5 %,
     * prélèvement de solidarité 7,5 %: 18,6 %, so a PFU of 31,4 %.
     */
    socialLeviesBp: 1_860,
    /** CSG deductible from the income of the year of payment when the scale is chosen (CGI art. 154 quinquies, II): 6,8 %. */
    deductibleCsgBp: 680,
    /** Abattement of 40 % with the option for the scale (CGI art. 158, 3, 2°). */
    abatementBp: 4_000,
    /** TNS: dividends above 10 % of capital, premiums and current account are activity income (CSS art. L131-6). */
    tnsThresholdBp: 1_000,
  },
  /**
   * Assimilé salarié (président of SAS or SASU, minority or equal gérant of
   * SARL): contributions of a cadre in 2026 on the gross pay, without
   * unemployment insurance nor AGS (a corporate officer without employment
   * contract is not covered), at full rates (no réduction générale for an
   * officer without contract). Bases: T1 up to 1 PASS, T2 from 1 to 8 PASS.
   * Sources: URSSAF taux de cotisations du secteur privé 2026, Agirc-Arrco
   * 2026, BOSS (assiette, CSG on 98,25 %).
   */
  employee: {
    employer: [
      { id: 'maladie', label: 'Assurance maladie', base: 'total', rateBp: 1_300 },
      { id: 'vieillesse-plafonnee', label: 'Vieillesse plafonnée', base: 't1', rateBp: 855 },
      { id: 'vieillesse-deplafonnee', label: 'Vieillesse déplafonnée', base: 'total', rateBp: 211 },
      { id: 'allocations-familiales', label: 'Allocations familiales', base: 'total', rateBp: 525 },
      { id: 'csa', label: 'Contribution solidarité autonomie', base: 'total', rateBp: 30 },
      { id: 'fnal', label: 'FNAL (moins de 50 salariés)', base: 't1', rateBp: 10 },
      { id: 'at-mp', label: 'Accidents du travail (taux indicatif)', base: 'total', rateBp: 75 },
      { id: 'agirc-arrco-t1', label: 'Retraite complémentaire Agirc-Arrco T1', base: 't1', rateBp: 472 },
      { id: 'agirc-arrco-t2', label: 'Retraite complémentaire Agirc-Arrco T2', base: 't2', rateBp: 1_295 },
      { id: 'ceg-t1', label: 'Contribution d’équilibre général T1', base: 't1', rateBp: 129 },
      { id: 'ceg-t2', label: 'Contribution d’équilibre général T2', base: 't2', rateBp: 162 },
      { id: 'cet', label: 'Contribution d’équilibre technique', base: 'cet', rateBp: 21 },
      { id: 'apec', label: 'APEC (0,036 %, arrondi)', base: 'apec', rateBp: 4 },
      { id: 'prevoyance', label: 'Prévoyance des cadres (1,50 % T1)', base: 't1', rateBp: 150 },
      { id: 'formation', label: 'Formation professionnelle (moins de 11 salariés)', base: 'total', rateBp: 55 },
      { id: 'apprentissage', label: 'Taxe d’apprentissage', base: 'total', rateBp: 68 },
    ],
    employee: [
      { id: 'vieillesse-plafonnee', label: 'Vieillesse plafonnée', base: 't1', rateBp: 690 },
      { id: 'vieillesse-deplafonnee', label: 'Vieillesse déplafonnée', base: 'total', rateBp: 40 },
      { id: 'agirc-arrco-t1', label: 'Retraite complémentaire Agirc-Arrco T1', base: 't1', rateBp: 315 },
      { id: 'agirc-arrco-t2', label: 'Retraite complémentaire Agirc-Arrco T2', base: 't2', rateBp: 864 },
      { id: 'ceg-t1', label: 'Contribution d’équilibre général T1', base: 't1', rateBp: 86 },
      { id: 'ceg-t2', label: 'Contribution d’équilibre général T2', base: 't2', rateBp: 108 },
      { id: 'cet', label: 'Contribution d’équilibre technique', base: 'cet', rateBp: 14 },
      { id: 'apec', label: 'APEC (0,024 %, arrondi)', base: 'apec', rateBp: 2 },
      { id: 'csg-deductible', label: 'CSG déductible', base: 'csg', rateBp: 680 },
      { id: 'csg-crds', label: 'CSG non déductible et CRDS', base: 'csg', rateBp: 290 },
    ],
    /** CSG and CRDS on 98,25 % of the gross pay up to 4 PASS (CSS art. L136-1-2, abattement de 1,75 %), 100 % above. */
    csgAbatementBp: 175,
    csgAbatementCeilingPass: 4,
    /** Part of the CSG and CRDS not deductible from the taxable income (2,4 % + 0,5 %). */
    nonDeductibleCsgCrdsBp: 290,
  },
  /**
   * Travailleur non salarié (majority gérant of SARL, SELARL, associé unique
   * gérant of EURL): the assiette unique of LFSS 2024 art. 18 and décret
   * n° 2024-688 du 5 juillet 2024 (CSS art. L131-6, D136-5), applied to
   * 2025 incomes onwards: income before social contributions, less 26 %
   * (at least 1,76 % and at most 130 % of the PASS), one base for every
   * contribution and the CSG and CRDS. Annual amounts after regularisation;
   * the provisional instalments of the year are not simulated.
   */
  tns: {
    abatementBp: 2_600,
    abatementMinPassBp: 176,
    abatementMaxPassBp: 13_000,
    /** Maladie-maternité (CSS art. D621-1): 8,5 % up to 3 PASS, 6,5 % above; reduced below 3 PASS, linearly between these points (share of PASS, rate on the whole base). */
    sicknessPoints: [
      [0, 0],
      [2_000, 0],
      [4_000, 150],
      [6_000, 400],
      [11_000, 650],
      [20_000, 770],
      [30_000, 850],
    ] as ReadonlyArray<readonly [passBp: number, rateBp: number]>,
    sicknessAboveRateBp: 650,
    sicknessCeilingPass: 3,
    /** Indemnités journalières: 0,5 % up to 5 PASS, base at least 40 % of the PASS. */
    dailyAllowanceBp: 50,
    dailyAllowanceCeilingPass: 5,
    dailyAllowanceMinPassBp: 4_000,
    /** Retraite de base (CSS art. D633-3): 17,15 % up to 1 PASS and 0,72 % on the whole base; minimum base 11,5 % of the PASS. */
    basicPensionT1Bp: 1_715,
    basicPensionTotalBp: 72,
    basicPensionMinPassBp: 1_150,
    /** Retraite complémentaire des indépendants: 8,1 % up to 1 PASS, 9,1 % from 1 to 4 PASS. */
    complementaryT1Bp: 810,
    complementaryT2Bp: 910,
    complementaryCeilingPass: 4,
    /** Invalidité-décès: 1,3 % up to 1 PASS, minimum base 11,5 % of the PASS. */
    disabilityBp: 130,
    disabilityMinPassBp: 1_150,
    /** Allocations familiales (CSS art. D613-1): 0 % up to 110 % of the PASS, rising to 3,1 % at 140 %, rate on the whole base. */
    familyLowPassBp: 11_000,
    familyHighPassBp: 14_000,
    familyRateBp: 310,
    /** CSG and CRDS: 9,7 % on the same base, of which 6,8 % deductible. */
    csgCrdsBp: 970,
    nonDeductibleCsgCrdsBp: 290,
    /** Contribution à la formation professionnelle of a commerçant: 0,25 % of the PASS. */
    trainingPassBp: 25,
  },
} as const

export type ContributionBase = 'total' | 't1' | 't2' | 'cet' | 'apec' | 'csg'
