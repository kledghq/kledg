/**
 * Rules of accounting methods, changes of method or estimate and
 * corrections of errors (pure module, amounts in cents). Règlement ANC
 * 2014-03 (PCG), version of 1 January 2026:
 *
 * - art. 121-5: an entity applies its methods consistently; the reference
 *   methods (pensions, development costs, set-up costs in expenses,
 *   acquisition costs in the asset) are irreversible once adopted;
 * - art. 122-1: a change of method comes from a change of regulation or is
 *   the entity's own choice;
 * - art. 122-2: the entity's own change needs a choice between admitted
 *   methods and a better financial information, justified;
 * - art. 122-3: the effect is computed retrospectively; the impact at the
 *   opening, after tax, goes to "report à nouveau" from the opening of the
 *   year, unless tax rules make the entity book it in the result, then out
 *   of the current result (exceptional, art. 821-2); when the effect at the
 *   opening cannot be computed objectively, the change is prospective;
 * - art. 122-5: a change of estimate only affects the current and future
 *   years (prospective); when a modification cannot clearly be called a
 *   change of method, it is a change of estimate;
 * - art. 122-6: a correction of error goes to the result of the year it is
 *   found in, out of the current result, unless it corrects an entry booked
 *   directly in equity (then on a separate line of report à nouveau);
 * - art. 831-2: the annexe mentions and justifies each of them with its impact.
 *
 * Accounts (PCG chart, art. 932-1): 110 report à nouveau (solde créditeur),
 * 119 (solde débiteur); 678 autres charges exceptionnelles, 778 autres
 * produits exceptionnels; 444 État, impôts sur les bénéfices.
 */

export const METHOD_TOPICS = [
  'inventory_valuation',
  'depreciation',
  'revenue_recognition',
  'long_term_contracts',
  'development_costs',
  'set_up_costs',
  'acquisition_costs',
  'borrowing_costs',
  'pension_commitments',
  'grants',
  'foreign_currency',
  'other',
] as const
export type MethodTopic = (typeof METHOD_TOPICS)[number]

export const METHOD_TOPIC_LABELS: Record<MethodTopic, string> = {
  inventory_valuation: 'Évaluation des stocks',
  depreciation: 'Amortissement des immobilisations',
  revenue_recognition: 'Comptabilisation du chiffre d’affaires',
  long_term_contracts: 'Contrats à long terme',
  development_costs: 'Frais de développement',
  set_up_costs: "Frais d'établissement",
  acquisition_costs: "Frais d'acquisition des immobilisations",
  borrowing_costs: "Coûts d'emprunt",
  pension_commitments: 'Engagements de retraite',
  grants: "Subventions d'investissement",
  foreign_currency: 'Opérations en devises',
  other: 'Autre méthode',
}

/** Usual choices per topic, offered in the form (the user may write another). */
export const METHOD_SUGGESTIONS: Partial<Record<MethodTopic, string[]>> = {
  inventory_valuation: ['Coût moyen unitaire pondéré', 'Premier entré, premier sorti (PEPS)'],
  depreciation: ['Linéaire sur la durée d’utilisation', 'Dégressif fiscal', 'Par composants'],
  revenue_recognition: ['À la livraison du bien', "À l'achèvement de la prestation", "À l'avancement"],
  long_term_contracts: ["Méthode à l'avancement (méthode de référence)", "Méthode à l'achèvement"],
  development_costs: ["Inscription à l'actif (méthode de référence)", 'Comptabilisation en charges'],
  set_up_costs: ['Comptabilisation en charges (méthode de référence)', "Inscription à l'actif"],
  acquisition_costs: ['Incorporés au coût d’acquisition (méthode de référence)', 'Comptabilisés en charges'],
  borrowing_costs: ['Comptabilisés en charges', 'Incorporés au coût des actifs éligibles'],
  pension_commitments: ['Provisionnés (méthode de référence)', "Mentionnés en engagements hors bilan dans l'annexe"],
}

export const CHANGE_KINDS = ['REGULATION_CHANGE', 'METHOD_CHANGE', 'ESTIMATE_CHANGE', 'ERROR_CORRECTION'] as const
export type ChangeKind = (typeof CHANGE_KINDS)[number]
export const CHANGE_TREATMENTS = ['EQUITY', 'RESULT', 'PROSPECTIVE'] as const
export type ChangeTreatment = (typeof CHANGE_TREATMENTS)[number]

export const CHANGE_KIND_LABELS: Record<ChangeKind, string> = {
  REGULATION_CHANGE: 'Changement de réglementation comptable',
  METHOD_CHANGE: 'Changement de méthode comptable',
  ESTIMATE_CHANGE: "Changement d'estimation",
  ERROR_CORRECTION: "Correction d'erreur",
}

export const TREATMENT_LABELS: Record<ChangeTreatment, string> = {
  EQUITY: 'Report à nouveau, à l’ouverture',
  RESULT: "Résultat exceptionnel de l'exercice",
  PROSPECTIVE: "Prospectif : sans écriture de rattrapage",
}

/** PCG articles behind each kind, quoted in the annexe and the UI. */
export const CHANGE_SOURCES: Record<ChangeKind, string> = {
  REGULATION_CHANGE: 'PCG art. 122-1, 122-3 et 831-2',
  METHOD_CHANGE: 'PCG art. 122-2, 122-3 et 831-2',
  ESTIMATE_CHANGE: 'PCG art. 122-5 et 831-2',
  ERROR_CORRECTION: 'PCG art. 122-6 et 831-2',
}

/** Treatments a kind admits, the first being the default. */
export function allowedTreatments(kind: ChangeKind): readonly ChangeTreatment[] {
  switch (kind) {
    case 'REGULATION_CHANGE':
    case 'METHOD_CHANGE':
      return ['EQUITY', 'RESULT', 'PROSPECTIVE']
    case 'ESTIMATE_CHANGE':
      return ['PROSPECTIVE']
    case 'ERROR_CORRECTION':
      return ['RESULT', 'EQUITY']
  }
}

export function defaultTreatment(kind: ChangeKind): ChangeTreatment {
  return allowedTreatments(kind)[0]
}

/** Why a treatment is refused for a kind, in French; null when allowed. */
export function treatmentError(kind: ChangeKind, treatment: ChangeTreatment): string | null {
  if (allowedTreatments(kind).includes(treatment)) return null
  if (kind === 'ESTIMATE_CHANGE') return "Un changement d'estimation est prospectif : il n'affecte que l'exercice en cours et les suivants (PCG art. 122-5)."
  return "Une correction d'erreur passe en résultat, ou en report à nouveau quand elle corrige une écriture imputée directement sur les capitaux propres (PCG art. 122-6)."
}

/** Whether the counterpart of a catch-up entry may be `code`: a balance sheet account (classes 1 to 5), not the result nor report à nouveau. */
export function counterpartError(code: string): string | null {
  if (!/^[1-5]\d{2,9}$/.test(code)) return 'Le compte ajusté est un compte de bilan (classes 1 à 5) : stocks, provisions, immobilisations, dettes...'
  if (code.startsWith('11') || code.startsWith('12')) return 'Le compte ajusté ne peut pas être le report à nouveau ni le résultat : indiquez le poste du bilan que le changement modifie.'
  return null
}

export interface ChangeEntryInput {
  kind: ChangeKind
  treatment: ChangeTreatment
  label: string
  /** Impact before tax, signed: positive increases equity or the result. */
  impactCents: number
  /** Tax on that impact, positive (EQUITY only: in the result, the tax of the year carries it). */
  taxCents: number
  accountCode: string | null
}

export interface ChangeEntryLine {
  code: string
  label: string
  debitCents: number
  creditCents: number
}

export const ACCOUNT_LABELS: Record<string, string> = {
  '110': 'Report à nouveau - solde créditeur',
  '119': 'Report à nouveau - solde débiteur',
  '678': 'Autres charges exceptionnelles',
  '778': 'Autres produits exceptionnels',
  '444': 'État - Impôts sur les bénéfices',
}

/** The impact after tax, in the direction of the impact (PCG art. 122-3). */
export function netImpactCents(impactCents: number, taxCents: number): number {
  return impactCents >= 0 ? impactCents - taxCents : impactCents + taxCents
}

/**
 * Lines of the catch-up entry of a change, or null when there is none
 * (prospective, or no impact). Balanced by construction:
 * - positive impact G: debit the adjusted account G; credit 444 the tax T
 *   (equity only); credit 110 (equity) or 778 (result) the rest;
 * - negative impact: the mirror (credit the account, debit 444 and 119 or 678).
 */
export function changeEntryLines(input: ChangeEntryInput, accountLabel: string): ChangeEntryLine[] | null {
  if (input.treatment === 'PROSPECTIVE' || input.impactCents === 0 || !input.accountCode) return null
  const gross = Math.abs(input.impactCents)
  const tax = input.treatment === 'EQUITY' ? Math.min(input.taxCents, gross) : 0
  const net = gross - tax
  const up = input.impactCents > 0
  const equityCode = up ? '110' : '119'
  const resultCode = up ? '778' : '678'
  const target = input.treatment === 'EQUITY' ? equityCode : resultCode
  const lines: ChangeEntryLine[] = [{ code: input.accountCode, label: accountLabel, debitCents: up ? gross : 0, creditCents: up ? 0 : gross }]
  if (tax > 0) lines.push({ code: '444', label: ACCOUNT_LABELS['444'], debitCents: up ? 0 : tax, creditCents: up ? tax : 0 })
  if (net > 0) lines.push({ code: target, label: ACCOUNT_LABELS[target], debitCents: up ? 0 : net, creditCents: up ? net : 0 })
  return lines
}

/** Description of the catch-up entry ("Changement de méthode : stocks au CMUP"). */
export function changeEntryDescription(kind: ChangeKind, label: string): string {
  return `${CHANGE_KIND_LABELS[kind]} : ${label}`.slice(0, 200)
}
