/**
 * Who approves the annual accounts, how, and by when, for each legal form
 * Kledg supports. Pure: no database, no clock. Every rule cites its text
 * (sources.ts); the docs page docs/approbation-des-comptes.md repeats them.
 *
 * - SARL (and SELARL): ordinary assembly of the associés within six months
 *   of the closing (C. com. L223-26), or a written consultation when the
 *   statuts allow it (L223-27); the gérant chairs. Majority: associés
 *   holding more than half of the parts; on a second consultation, the
 *   majority of the votes cast, unless the statuts say otherwise (L223-29).
 * - EURL: the associé unique decides alone within six months and records
 *   the decision in a register (L223-31, R223-26). When the associé unique
 *   is the only gérant, filing the signed inventory and accounts at the RCS
 *   within the six months is worth approval (L223-31).
 * - SAS (and SELAS): the associés decide collectively on the accounts in
 *   the forms, quorum and majority of the statuts (L227-9). The Code sets
 *   no six-month deadline for a multi-partner SAS: L227-1 excludes L225-100
 *   from the SA rules that apply to it; the statuts usually do.
 * - SASU: the associé unique approves within six months, in a register;
 *   when it is a natural person who is also the président, filing the signed
 *   accounts within the deadline is worth approval (L227-9). The officer of
 *   a SASU is its président, never a gérant (the gérant is the officer of
 *   SARL, EURL and sociétés civiles).
 * - SA (conseil d'administration): ordinary general meeting within six
 *   months (L225-100), quorum one fifth of the voting shares on first call,
 *   none on second call, majority of the votes cast (L225-98).
 * - SCI: the gérants account for their management at least once a year
 *   with a written report, the associés decide in the statuts' conditions,
 *   unanimously when the statuts are silent (C. civ. 1852, 1853, 1856). No
 *   legal six-month deadline and no filing with the greffe.
 *
 * Other forms (SNC, SCS, SCA, EI) are not covered: the pack says so instead
 * of guessing.
 */

import { SOURCES, type LegalSource } from './sources'

export const APPROVAL_FORMS = ['SARL', 'EURL', 'SAS', 'SASU', 'SA', 'SCI'] as const
export type ApprovalForm = (typeof APPROVAL_FORMS)[number]

/** How the decision is taken: an assembly, a written consultation (when the statuts allow it), or the associé unique alone. */
export type DecisionMode = 'meeting' | 'written' | 'sole'

/** How resolutions are adopted. */
export type MajorityRule = 'sarl' | 'sa' | 'statutes' | 'sole'

export interface ApprovalRegime {
  form: ApprovalForm
  /** The legal type stored on the company (SELARL reads as SARL). */
  legalType: string
  /** Full name of the form, for the documents' heading. */
  formLabel: string
  sole: boolean
  /** Title of the officers: gérant (SARL, EURL, SCI), président (SAS, SASU), président du conseil d'administration (SA). */
  officerTitle: { singular: string; plural: string }
  /** What the holders are called: associé or actionnaire. */
  holderWord: { singular: string; plural: string }
  /** Who decides, as written in the documents. */
  decidingBody: string
  /** Decision modes the law allows (the statuts may narrow them). */
  decisionModes: DecisionMode[]
  majority: MajorityRule
  /** Approval within six months of the closing (null: per statuts). */
  sixMonthDeadline: boolean
  /** Convocation rule (null: none, the associé unique decides). */
  convocation: { minDays: number | null; how: string; sources: LegalSource[] } | null
  /** The register the minutes or decisions go to. */
  register: { text: string; sources: LegalSource[] }
  /** Whether a management report is always required (SCI) or only when the size exemption does not apply. */
  managementReport: 'always' | 'unless_small'
  /** Filed with the greffe after approval (L232-22, L232-23); never for a société civile. */
  filing: { required: boolean; sources: LegalSource[] }
  /** Filing the signed accounts within the deadline is worth approval, under this condition. */
  filingWorthApproval: { condition: string; sources: LegalSource[] } | null
  /** Attendance sheet: required (SA), useful in an assembly, none for a sole partner. */
  attendanceSheet: 'required' | 'meeting_only' | 'none'
  /** Agreements between the company and its officers or associés, and the text that governs them. */
  regulatedAgreements: { article: string; sources: LegalSource[] } | null
  /** Main sources of the approval itself. */
  sources: LegalSource[]
}

const SARL_HOLDERS = { singular: 'associé', plural: 'associés' }
const SA_HOLDERS = { singular: 'actionnaire', plural: 'actionnaires' }

const REGIMES: Record<ApprovalForm, Omit<ApprovalRegime, 'legalType'>> = {
  SARL: {
    form: 'SARL',
    formLabel: 'Société à responsabilité limitée',
    sole: false,
    officerTitle: { singular: 'gérant', plural: 'cogérants' },
    holderWord: SARL_HOLDERS,
    decidingBody: "l'assemblée générale ordinaire des associés",
    decisionModes: ['meeting', 'written'],
    majority: 'sarl',
    sixMonthDeadline: true,
    convocation: {
      minDays: 15,
      how: "Lettre recommandée au moins quinze jours avant l'assemblée, avec l'ordre du jour (ou voie électronique si l'associé l'a accepté). Les comptes, le rapport de gestion et le texte des résolutions sont adressés aux associés quinze jours au moins avant l'assemblée.",
      sources: [SOURCES.R223_20, SOURCES.R223_18, SOURCES.L223_26],
    },
    register: { text: 'Registre des procès-verbaux des décisions des associés, coté et paraphé, tenu au siège.', sources: [SOURCES.R223_24, SOURCES.R221_3] },
    managementReport: 'unless_small',
    filing: { required: true, sources: [SOURCES.L232_22] },
    filingWorthApproval: null,
    attendanceSheet: 'meeting_only',
    regulatedAgreements: { article: 'L. 223-19', sources: [SOURCES.L223_19] },
    sources: [SOURCES.L223_26, SOURCES.L223_27, SOURCES.L223_29],
  },
  EURL: {
    form: 'EURL',
    formLabel: 'Société à responsabilité limitée à associé unique',
    sole: true,
    officerTitle: { singular: 'gérant', plural: 'cogérants' },
    holderWord: SARL_HOLDERS,
    decidingBody: "l'associé unique",
    decisionModes: ['sole'],
    majority: 'sole',
    sixMonthDeadline: true,
    convocation: null,
    register: { text: "Registre des décisions de l'associé unique, coté et paraphé, tenu au siège.", sources: [SOURCES.L223_31, SOURCES.R223_26] },
    managementReport: 'unless_small',
    filing: { required: true, sources: [SOURCES.L232_22] },
    filingWorthApproval: {
      condition:
        "Quand l'associé unique est le seul gérant, le dépôt au greffe de l'inventaire et des comptes annuels signés dans les six mois vaut approbation, sans inscrire le récépissé au registre. La décision d'affectation du résultat reste à déposer.",
      sources: [SOURCES.L223_31, SOURCES.L232_22],
    },
    attendanceSheet: 'none',
    regulatedAgreements: { article: 'L. 223-19', sources: [SOURCES.L223_19] },
    sources: [SOURCES.L223_31],
  },
  SAS: {
    form: 'SAS',
    formLabel: 'Société par actions simplifiée',
    sole: false,
    officerTitle: { singular: 'président', plural: 'présidents' },
    holderWord: SARL_HOLDERS,
    decidingBody: 'la collectivité des associés',
    decisionModes: ['meeting', 'written'],
    majority: 'statutes',
    sixMonthDeadline: false,
    convocation: {
      minDays: null,
      how: 'Dans les formes et délais prévus par les statuts.',
      sources: [SOURCES.L227_9],
    },
    register: { text: 'Registre des décisions collectives prévu par les statuts.', sources: [SOURCES.L227_9] },
    managementReport: 'unless_small',
    filing: { required: true, sources: [SOURCES.L232_23] },
    filingWorthApproval: null,
    attendanceSheet: 'meeting_only',
    regulatedAgreements: { article: 'L. 227-10', sources: [SOURCES.L227_10] },
    sources: [SOURCES.L227_9, SOURCES.L227_1],
  },
  SASU: {
    form: 'SASU',
    formLabel: 'Société par actions simplifiée unipersonnelle',
    sole: true,
    officerTitle: { singular: 'président', plural: 'présidents' },
    holderWord: SARL_HOLDERS,
    decidingBody: "l'associé unique",
    decisionModes: ['sole'],
    majority: 'sole',
    sixMonthDeadline: true,
    convocation: null,
    register: { text: "Registre des décisions de l'associé unique.", sources: [SOURCES.L227_9] },
    managementReport: 'unless_small',
    filing: { required: true, sources: [SOURCES.L232_23] },
    filingWorthApproval: {
      condition:
        "Quand l'associé unique, personne physique, est le président, le dépôt au greffe de l'inventaire et des comptes annuels signés dans les six mois vaut approbation, sans inscrire le récépissé au registre. La décision d'affectation du résultat reste à déposer.",
      sources: [SOURCES.L227_9, SOURCES.L232_23],
    },
    attendanceSheet: 'none',
    regulatedAgreements: { article: 'L. 227-10', sources: [SOURCES.L227_10] },
    sources: [SOURCES.L227_9],
  },
  SA: {
    form: 'SA',
    formLabel: 'Société anonyme',
    sole: false,
    officerTitle: { singular: "président du conseil d'administration", plural: "présidents du conseil d'administration" },
    holderWord: SA_HOLDERS,
    decidingBody: "l'assemblée générale ordinaire des actionnaires",
    decisionModes: ['meeting'],
    majority: 'sa',
    sixMonthDeadline: true,
    convocation: {
      minDays: 15,
      how: "Avis dans un journal d'annonces légales, ou lettre simple, recommandée ou courrier électronique quand toutes les actions sont nominatives, au moins quinze jours avant l'assemblée sur première convocation (dix jours sur convocation suivante).",
      sources: [SOURCES.R225_69],
    },
    register: { text: 'Registre spécial des procès-verbaux des assemblées, tenu au siège.', sources: [SOURCES.R225_106] },
    managementReport: 'unless_small',
    filing: { required: true, sources: [SOURCES.L232_23] },
    filingWorthApproval: null,
    attendanceSheet: 'required',
    regulatedAgreements: { article: 'L. 225-38', sources: [SOURCES.L225_38] },
    sources: [SOURCES.L225_100, SOURCES.L225_98],
  },
  SCI: {
    form: 'SCI',
    formLabel: 'Société civile immobilière',
    sole: false,
    officerTitle: { singular: 'gérant', plural: 'cogérants' },
    holderWord: SARL_HOLDERS,
    decidingBody: "l'assemblée des associés",
    decisionModes: ['meeting', 'written'],
    majority: 'statutes',
    sixMonthDeadline: false,
    convocation: {
      minDays: 15,
      how: "Lettre recommandée au moins quinze jours avant l'assemblée, avec l'ordre du jour ; le texte des résolutions et les documents sont adressés dans le même délai.",
      sources: [SOURCES.D78_704],
    },
    register: { text: 'Registre des procès-verbaux des décisions des associés.', sources: [SOURCES.D78_704] },
    managementReport: 'always',
    filing: { required: false, sources: [] },
    filingWorthApproval: null,
    attendanceSheet: 'meeting_only',
    regulatedAgreements: null,
    sources: [SOURCES.CIV_1856, SOURCES.CIV_1852, SOURCES.CIV_1853],
  },
}

const FORM_OF: Record<string, ApprovalForm> = {
  SARL: 'SARL',
  SELARL: 'SARL',
  EURL: 'EURL',
  SAS: 'SAS',
  SELAS: 'SAS',
  SASU: 'SASU',
  SA: 'SA',
  SCI: 'SCI',
}

/** Why a legal type has no approval pack, in French. */
export function unsupportedReason(legalType: string | null | undefined): string | null {
  if (!legalType) return "La forme juridique de la société n'est pas renseignée : indiquez-la dans les informations de la société."
  if (FORM_OF[legalType]) return null
  if (legalType === 'EI') return "Un entrepreneur individuel n'a pas d'associés : il n'y a pas d'approbation des comptes."
  return `La forme juridique ${legalType} n'est pas encore prise en charge (SNC, SCS et SCA ont des règles propres) : faites préparer ces documents par votre conseil.`
}

/**
 * The approval regime of a company. A SARL or SAS recorded with a single
 * associé is treated as unipersonnelle (EURL, SASU): the law then applies
 * the sole partner rules (L223-31, L227-9), whatever the type selected.
 */
export function approvalRegime(legalType: string | null | undefined, holderCount?: number): ApprovalRegime | null {
  const base = legalType ? FORM_OF[legalType] : undefined
  if (!base) return null
  let form = base
  if (holderCount === 1 && form === 'SARL') form = 'EURL'
  if (holderCount === 1 && form === 'SAS') form = 'SASU'
  return { ...REGIMES[form], legalType: legalType as string }
}

/** The regime of a form, for tests and documentation tables. */
export function regimeOf(form: ApprovalForm): ApprovalRegime {
  return { ...REGIMES[form], legalType: form }
}

/** The title of the document that records the decision. */
export function decisionTitle(regime: ApprovalRegime, mode: DecisionMode): string {
  if (regime.sole) return "Décision de l'associé unique"
  if (mode === 'written') return 'Procès-verbal des décisions des associés prises par consultation écrite'
  if (regime.form === 'SA') return "Procès-verbal de l'assemblée générale ordinaire annuelle"
  if (regime.form === 'SAS') return 'Procès-verbal des décisions collectives des associés'
  return "Procès-verbal de l'assemblée générale ordinaire annuelle"
}

/** The default decision mode of a regime. */
export function defaultDecisionMode(regime: ApprovalRegime): DecisionMode {
  return regime.decisionModes[0]
}

/**
 * What the officers do with the accounts before the decision: the gérance
 * or the président "arrête" the accounts (L232-1), in an SA the conseil
 * d'administration.
 */
export function accountsPreparedBy(regime: ApprovalRegime): string {
  if (regime.form === 'SA') return "le conseil d'administration"
  if (regime.form === 'SAS' || regime.form === 'SASU') return 'le président'
  return 'la gérance'
}
