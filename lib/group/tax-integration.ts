/**
 * Simulation of the intégration fiscale of a group (régime des groupes de
 * sociétés, CGI art. 223 A to 223 U; BOI-IS-GPE): which companies could
 * form the group, its result (résultat d'ensemble), its impôt sur les
 * sociétés, compared with the sum of the companies' own IS. Pure, amounts in
 * cents, percentages in basis points: the service gathers what each
 * company's IS worksheet computes (lib/corporate-tax), the tests feed plain
 * values. An indicative simulation for one fiscal year, to review with an
 * accountant: Kledg never opts, files nor pays anything.
 *
 * Rules applied (each one names its source in INTEGRATION_SOURCES):
 * 1. Perimeter (art. 223 A; BOI-IS-GPE-10-20-10): the parent company, liable
 *    to IS and not itself held at 95 % or more by another company liable to
 *    IS, and each company it holds at 95 % at least, directly or indirectly
 *    through companies of the group: indirect holdings multiply the
 *    successive percentages and only chains through members count. Every
 *    member is liable to IS and closes on the same dates, twelve-month
 *    exercices (BOI-IS-GPE-10-30). French tax residence and the option
 *    (notified by the parent at the latest when the result return of the
 *    preceding exercice is due, for five exercices) are listed for the user
 *    to confirm.
 * 2. Résultat d'ensemble (art. 223 B): the sum of the members' tax results,
 *    each as its own worksheet computes it (before deficits), then:
 *    - dividends between members eligible to the régime mère-fille: the
 *      quote-part de frais et charges is 1 % instead of 5 % (art. 216, I;
 *      BOI-IS-GPE-20-20-20-20), so 4 % of them come off; dividends between
 *      members outside that régime are deducted at 99 % (art. 223 B);
 *    - management fees between members are a produit of one and a charge of
 *      the other: neutral in the sum, nothing to adjust (shown with the gap
 *      when the two books disagree);
 *    - what the books cannot tell (provisions on another member, sales of
 *      fixed assets between members, abandons de créances and subventions,
 *      the financial charges rule of art. 223 B bis) is listed and only
 *      counted when the user types an amount.
 * 3. Deficits: the deficits of a member from before the group only offset
 *    that member's own profit (art. 223 I, 4), within the limit of art. 209,
 *    I applied to the résultat d'ensemble (simplification: the limit is
 *    applied once to the total); a loss of the group carries forward at the
 *    group level (art. 223 C).
 * 4. IS of the group (art. 219, I, b): the reduced rate of 15 % applies once,
 *    on 42 500 € of the résultat d'ensemble, when the sum of the members'
 *    chiffres d'affaires is 10 000 000 € at most and the parent's capital
 *    meets the conditions (paid up, 75 % held by natural persons); the
 *    contribution sociale (art. 235 ter ZC) once, on the IS above 763 000 €.
 *    Conseil d'État, 13 March 2025, n° 481538: the chiffre d'affaires of a
 *    company of a group is the whole group's, integrated or not; the
 *    separate figures of each company come from its own answers and may
 *    have to be reviewed in that light.
 */

import {
  applyRate,
  deficitCap,
  PARENT_QUOTE_PART_BP,
  REDUCED_RATE_PROFIT_CEILING_CENTS,
  REDUCED_RATE_TURNOVER_CEILING_CENTS,
  roundToEuro,
  SOCIAL_CONTRIBUTION_ALLOWANCE_CENTS,
  SOCIAL_CONTRIBUTION_RATE_BP,
  SOCIAL_CONTRIBUTION_TURNOVER_CENTS,
  taxAtRates,
} from '@/lib/corporate-tax/rules'
import { formatCentsFr } from '@/lib/utils/money'

export const INTEGRATION_SOURCES = {
  cgi223A: { label: 'CGI, art. 223 A (société mère, détention de 95 % au moins, exercices, option pour cinq exercices)', url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000042340402/' },
  cgi223: { label: 'CGI, art. 223 A à 223 U (régime des groupes de sociétés\u00a0: résultat d’ensemble, art. 223 B ; déficits, art. 223 C et 223 I ; cessions entre sociétés du groupe, art. 223 F)', url: 'https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006069577/LEGISCTA000006162535/' },
  cgi216: { label: 'CGI, art. 216, I (quote-part de frais et charges de 1 % pour les dividendes entre sociétés d’un groupe)', url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000048831340' },
  cgi209: { label: 'CGI, art. 209, I (imputation des déficits\u00a0: 1 000 000 € majorés de 50 %)', url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000042909650/' },
  cgi219: { label: 'CGI, art. 219, I, b (taux réduit de 15 %\u00a0: chiffre d’affaires du groupe, conditions appréciées chez la société mère)', url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000046868562' },
  cgi235terZC: { label: 'CGI, art. 235 ter ZC (contribution sociale de 3,3 %, due par la société mère pour le groupe)', url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000031011715' },
  bofipDetention: { label: 'BOI-IS-GPE-10-20-10 (détention de 95 %, directe ou indirecte par des sociétés du groupe)', url: 'https://bofip.impots.gouv.fr/bofip/5049-PGP.html/identifiant=BOI-IS-GPE-10-20-10-20210324' },
  bofipExercices: { label: 'BOI-IS-GPE-10-30 (formation du groupe, exercices de douze mois aux mêmes dates)', url: 'https://bofip.impots.gouv.fr/bofip/10058-PGP.html/identifiant=BOI-IS-GPE-10-30-50-20200415' },
  bofipDividendes: { label: 'BOI-IS-GPE-20-20-20-20 (quote-part de frais et charges des dividendes entre sociétés du groupe)', url: 'https://bofip.impots.gouv.fr/bofip/8531-PGP.html/identifiant=BOI-IS-GPE-20-20-20-20-20161005' },
  ce2025: { label: 'Conseil d’État, 13 mars 2025, n° 481538 (chiffre d’affaires du groupe pour le taux réduit)', url: 'https://www.impots.gouv.fr/actualite/taux-reduit-dimpot-sur-les-societes-le-critere-du-chiffre-daffaires-revu-pour-les' },
} as const

export type IntegrationSourceKey = keyof typeof INTEGRATION_SOURCES

export const INTEGRATION_NOTICE =
  'Simulation indicative de l’intégration fiscale pour un exercice, à faire vérifier par votre expert-comptable\u00a0: Kledg n’exerce pas l’option et ne dépose rien. Les retraitements que les livres ne montrent pas sont listés et ne comptent que si vous saisissez leur montant.'

/** Quote-part de frais et charges on dividends between members of an integrated group (art. 216, I). */
export const GROUP_QUOTE_PART_BP = 100
/** Dividends between members outside the régime mère-fille: deducted at 99 % (art. 223 B). */
export const NON_PARENT_DEDUCTION_BP = 9_900
/** Holding giving access to the group (art. 223 A). */
export const INTEGRATION_MIN_BP = 9_500

export interface IntegrationCompanyInput {
  id: string
  name: string
  role: 'holding' | 'subsidiary'
  /**
   * The company's IS worksheet: ready, or why there is none (not liable to
   * IS, regime not set, no fiscal year on the period).
   */
  status: 'ready' | 'not-subject' | 'missing-regime' | 'no-fiscal-year'
  fiscalYear: { startDate: string; endDate: string; months: number | null } | null
  /** Tax result before deficits, rounded to the euro (its worksheet). */
  resultBeforeDeficitsCents: number
  /** Deficits carried forward at the start of the year; null when not known (counted as none). */
  deficitsOpeningCents: number | null
  turnoverCents: number
  /** IS and contribution sociale of the company taxed on its own. */
  separateTaxCents: number
  separateSocialCents: number
  /** Answers of the reduced rate (they matter for the parent). */
  capitalPaidUp: boolean | null
  naturalPersons75: boolean | null
}

export interface IntegrationInput {
  holdingId: string
  companies: IntegrationCompanyInput[]
  /** Direct holdings between the companies read (basis points). */
  holdings: Array<{ holderId: string; companyId: string; bp: number }>
  /** Whether a company liable to IS holds 95 % or more of the parent: true, false, or null (not known). */
  parentHeldByCompany: boolean | null
  /** Dividends a company received from another company of the group, and whether its worksheet applied the régime mère-fille. */
  dividends: Array<{ receiverId: string; payerId: string; cents: number; parentRegime: boolean }>
  /** Management fees between companies of the group: the seller's produit, the buyer's charge. */
  managementFees: Array<{ sellerId: string; buyerId: string; revenueCents: number; chargeCents: number }>
  /** Amounts typed by the user for the retraitements the books cannot show (signed: positive adds to the result). */
  manual: Partial<Record<ManualNeutralisationId, number>>
  /** Subsidiaries not read: not in the simulation, which says so. */
  unreachable: number
}

export type CheckStatus = 'ok' | 'ko' | 'check'

export interface IntegrationCheck {
  id: string
  label: string
  status: CheckStatus
  detail: string
  source: IntegrationSourceKey
}

export interface IntegrationMembership {
  companyId: string
  name: string
  role: 'holding' | 'subsidiary'
  /** The parent's holding through the members, in basis points (null for the parent). */
  interestBp: number | null
  member: boolean
  checks: IntegrationCheck[]
}

export type ManualNeutralisationId = 'provisions' | 'asset_sales' | 'waivers' | 'financial_charges' | 'other'

export const MANUAL_NEUTRALISATIONS: Array<{ id: ManualNeutralisationId; label: string; hint: string; source: IntegrationSourceKey }> = [
  { id: 'provisions', label: 'Provisions sur une autre société du groupe', hint: 'Dotations sur les titres, prêts ou créances d’un membre\u00a0: réintégrées (montant positif), reprises déduites (négatif).', source: 'cgi223' },
  { id: 'asset_sales', label: 'Cessions d’immobilisations entre sociétés du groupe', hint: 'La plus-value est déduite (montant négatif), la moins-value réintégrée (positif), jusqu’à la sortie du bien du groupe (art. 223 F).', source: 'cgi223' },
  { id: 'waivers', label: 'Abandons de créances et subventions entre sociétés du groupe', hint: 'Neutralisés\u00a0: la charge de l’une et le produit de l’autre ; saisissez l’écart éventuel.', source: 'cgi223' },
  { id: 'financial_charges', label: 'Limitation des charges financières au niveau du groupe', hint: 'Plafond des charges financières nettes apprécié pour le groupe (art. 223 B bis)\u00a0: réintégration éventuelle.', source: 'cgi223' },
  { id: 'other', label: 'Autres retraitements', hint: 'Tout autre retraitement que votre expert-comptable retient.', source: 'cgi223' },
]

export interface IntegrationAdjustment {
  id: string
  label: string
  /** Signed: positive adds to the résultat d'ensemble. */
  amountCents: number
  /** Computed from the books, typed by the user, or listed only (not counted). */
  origin: 'books' | 'manual' | 'info'
  detail: string
  source: IntegrationSourceKey
}

export interface IntegrationTax {
  taxableProfitCents: number
  reducedRate: { applied: boolean; eligible: boolean | null; baseCents: number; taxCents: number }
  normalRate: { baseCents: number; taxCents: number }
  corporateTaxCents: number
  /** The IS if the reduced rate applied, when a condition is not answered. */
  ifEligibleCents: number | null
  socialContribution: { exempt: boolean; cents: number }
  totalCents: number
}

export interface IntegrationSimulation {
  /** False when no subsidiary meets the conditions or the parent cannot head a group. */
  possible: boolean
  checks: IntegrationCheck[]
  members: IntegrationMembership[]
  /** Results of the members as they stand, before the group adjustments. */
  results: Array<{ companyId: string; name: string; resultBeforeDeficitsCents: number }>
  sumOfResultsCents: number
  adjustments: IntegrationAdjustment[]
  resultBeforeDeficitsCents: number
  deficits: { openingCents: number; usableCents: number; imputedCents: number; groupDeficitCents: number; byCompany: Array<{ companyId: string; openingCents: number | null; usableCents: number }> }
  turnoverCents: number
  group: IntegrationTax | null
  /** Sum of the members' own IS and contribution sociale. */
  separateTotalCents: number
  /** Separate minus group: positive is a saving, negative a cost. */
  savingCents: number
  warnings: string[]
  notice: string
  sources: Array<{ id: IntegrationSourceKey; label: string; url: string }>
}

/**
 * The parent's holding in each company through the members only (art. 223
 * A): the members are the companies held at 95 % at least that way, so the
 * two are found together, step after step until nothing changes. Exact
 * fractions, rounded to the basis point for the threshold.
 */
export function integrationInterests(parentId: string, companyIds: readonly string[], holdings: ReadonlyArray<{ holderId: string; companyId: string; bp: number }>): Map<string, number> {
  const direct = new Map<string, Map<string, number>>()
  for (const h of holdings) {
    if (h.bp <= 0 || h.holderId === h.companyId) continue
    const row = direct.get(h.companyId) ?? new Map<string, number>()
    row.set(h.holderId, (row.get(h.holderId) ?? 0) + h.bp / 10_000)
    direct.set(h.companyId, row)
  }
  let members = new Set<string>([parentId])
  let interest = new Map<string, number>([[parentId, 1]])
  for (let step = 0; step < 20; step++) {
    const next = new Map<string, number>([[parentId, 1]])
    for (const id of companyIds) {
      if (id === parentId) continue
      let total = 0
      for (const [holder, fraction] of direct.get(id) ?? []) if (members.has(holder)) total += fraction * (interest.get(holder) ?? 0)
      next.set(id, Math.min(total, 1))
    }
    const nextMembers = new Set([parentId, ...companyIds.filter((id) => id !== parentId && Math.round((next.get(id) ?? 0) * 10_000) >= INTEGRATION_MIN_BP)])
    const stable = nextMembers.size === members.size && [...nextMembers].every((id) => members.has(id)) && [...next].every(([id, v]) => Math.abs((interest.get(id) ?? 0) - v) < 1e-9)
    members = nextMembers
    interest = next
    if (stable) break
  }
  const result = new Map<string, number>()
  for (const [id, v] of interest) if (id !== parentId) result.set(id, Math.round(v * 10_000))
  return result
}

const formatBp = (bp: number) => `${(bp / 100).toFixed(2).replace(/\.?0+$/, '').replace('.', ',')}\u00a0%`
const STATUS_REASON: Record<Exclude<IntegrationCompanyInput['status'], 'ready'>, string> = {
  'not-subject': 'Société à l’impôt sur le revenu\u00a0: elle ne peut pas être membre.',
  'missing-regime': 'Régime d’imposition des bénéfices non renseigné sur la page Informations de la société.',
  'no-fiscal-year': 'Aucun exercice sur la période de la holding.',
}

function taxOfGroup(taxableProfitCents: number, turnoverCents: number, parent: IntegrationCompanyInput): IntegrationTax {
  const turnoverOk = turnoverCents <= REDUCED_RATE_TURNOVER_CEILING_CENTS
  const answers = [parent.capitalPaidUp, parent.naturalPersons75]
  const eligible = !turnoverOk || answers.includes(false) ? false : answers.includes(null) ? null : true
  const tax = taxAtRates(taxableProfitCents, eligible === true, REDUCED_RATE_PROFIT_CEILING_CENTS)
  const ifEligibleCents = eligible === null ? taxAtRates(taxableProfitCents, true, REDUCED_RATE_PROFIT_CEILING_CENTS).taxCents : null
  const exempt = turnoverCents < SOCIAL_CONTRIBUTION_TURNOVER_CENTS && parent.capitalPaidUp === true && parent.naturalPersons75 === true
  const socialCents = exempt ? 0 : applyRate(Math.max(tax.taxCents - SOCIAL_CONTRIBUTION_ALLOWANCE_CENTS, 0), SOCIAL_CONTRIBUTION_RATE_BP)
  return {
    taxableProfitCents,
    reducedRate: { applied: eligible === true, eligible, baseCents: tax.reducedBaseCents, taxCents: tax.reducedTaxCents },
    normalRate: { baseCents: tax.normalBaseCents, taxCents: tax.normalTaxCents },
    corporateTaxCents: tax.taxCents,
    ifEligibleCents,
    socialContribution: { exempt, cents: socialCents },
    totalCents: tax.taxCents + socialCents,
  }
}

export function simulateTaxIntegration(input: IntegrationInput): IntegrationSimulation {
  const parent = input.companies.find((c) => c.id === input.holdingId)
  if (!parent) throw new Error('simulateTaxIntegration: the parent company is missing')
  const parentYear = parent.fiscalYear

  // 1. The parent can head a group.
  const parentChecks: IntegrationCheck[] = [
    {
      id: 'parent-is',
      label: 'La holding est soumise à l’impôt sur les sociétés',
      status: parent.status === 'ready' ? 'ok' : 'ko',
      detail: parent.status === 'ready' ? 'Régime d’impôt sur les sociétés renseigné.' : STATUS_REASON[parent.status],
      source: 'cgi223A',
    },
    {
      id: 'parent-not-held',
      label: 'La holding n’est pas elle-même détenue à 95 % ou plus par une société soumise à l’impôt sur les sociétés',
      status: input.parentHeldByCompany === null ? 'check' : input.parentHeldByCompany ? 'ko' : 'ok',
      detail:
        input.parentHeldByCompany === null
          ? 'Les associés de la holding ne sont pas tous connus\u00a0: à vérifier.'
          : input.parentHeldByCompany
            ? 'Une société détient 95 % ou plus de la holding\u00a0: c’est elle qui pourrait être la tête du groupe.'
            : 'Aucune société ne détient 95 % ou plus de la holding.',
      source: 'bofipDetention',
    },
    {
      id: 'parent-year',
      label: 'Exercice de douze mois',
      status: parentYear?.months === 12 ? 'ok' : 'ko',
      detail: parentYear ? (parentYear.months === 12 ? 'L’exercice de la holding dure douze mois.' : 'L’exercice de la holding ne dure pas douze mois.') : 'Aucun exercice.',
      source: 'bofipExercices',
    },
    {
      id: 'residence',
      label: 'Sociétés établies en France',
      status: 'check',
      detail: 'Kledg tient des sociétés françaises (SIREN)\u00a0: à confirmer pour chaque société.',
      source: 'cgi223A',
    },
    {
      id: 'option',
      label: 'Option notifiée par la holding avec l’accord de chaque filiale',
      status: 'check',
      detail: 'Au plus tard à la date limite de dépôt de la déclaration de résultat de l’exercice qui précède le premier exercice du groupe ; l’option vaut pour cinq exercices.',
      source: 'cgi223A',
    },
  ]
  const parentOk = parentChecks.every((c) => c.status !== 'ko')

  // 2. The members: 95 % through the members, liable to IS, same twelve-month dates.
  const interests = integrationInterests(
    input.holdingId,
    input.companies.map((c) => c.id),
    input.holdings,
  )
  const memberships: IntegrationMembership[] = input.companies.map((c) => {
    if (c.id === input.holdingId) return { companyId: c.id, name: c.name, role: c.role, interestBp: null, member: parentOk, checks: parentChecks }
    const bp = interests.get(c.id) ?? 0
    const sameDates = !!c.fiscalYear && !!parentYear && c.fiscalYear.startDate === parentYear.startDate && c.fiscalYear.endDate === parentYear.endDate
    const checks: IntegrationCheck[] = [
      {
        id: 'detention',
        label: 'Détenue à 95 % au moins par la holding, directement ou par des sociétés du groupe',
        status: bp >= INTEGRATION_MIN_BP ? 'ok' : 'ko',
        detail: `Détention par la holding et les membres du groupe\u00a0: ${formatBp(bp)}.`,
        source: 'bofipDetention',
      },
      {
        id: 'is',
        label: 'Soumise à l’impôt sur les sociétés',
        status: c.status === 'ready' ? 'ok' : 'ko',
        detail: c.status === 'ready' ? 'Régime d’impôt sur les sociétés renseigné.' : STATUS_REASON[c.status],
        source: 'cgi223A',
      },
      {
        id: 'dates',
        label: 'Exercice de douze mois aux mêmes dates que la holding',
        status: sameDates && c.fiscalYear?.months === 12 ? 'ok' : 'ko',
        detail: sameDates ? (c.fiscalYear?.months === 12 ? 'Mêmes dates que la holding.' : 'L’exercice ne dure pas douze mois.') : 'L’exercice n’a pas les dates de celui de la holding.',
        source: 'bofipExercices',
      },
    ]
    return { companyId: c.id, name: c.name, role: c.role, interestBp: bp, member: parentOk && checks.every((x) => x.status === 'ok'), checks }
  })
  const memberIds = new Set(memberships.filter((m) => m.member).map((m) => m.companyId))
  const possible = parentOk && memberIds.size >= 2
  const members = input.companies.filter((c) => memberIds.has(c.id))
  const nameOf = (id: string) => input.companies.find((c) => c.id === id)?.name ?? 'Société du groupe'

  const warnings: string[] = []
  if (input.unreachable > 0) {
    warnings.push(
      input.unreachable === 1
        ? 'Une filiale n’est pas lue, faute d’accès\u00a0: elle n’est pas dans la simulation, même si elle pourrait être membre du groupe.'
        : `${input.unreachable} filiales ne sont pas lues, faute d’accès\u00a0: elles ne sont pas dans la simulation, même si elles pourraient être membres du groupe.`,
    )
  }

  // 3. Résultat d'ensemble.
  const adjustments: IntegrationAdjustment[] = []
  for (const d of input.dividends) {
    if (!memberIds.has(d.receiverId) || !memberIds.has(d.payerId) || d.cents <= 0) continue
    if (d.parentRegime) {
      const cents = -(applyRate(d.cents, PARENT_QUOTE_PART_BP) - applyRate(d.cents, GROUP_QUOTE_PART_BP))
      adjustments.push({
        id: `dividends-${d.receiverId}-${d.payerId}`,
        label: `Dividendes de ${nameOf(d.payerId)} à ${nameOf(d.receiverId)}\u00a0: quote-part de 1 % au lieu de 5 %`,
        amountCents: cents,
        origin: 'books',
        detail: `Sur ${formatCentsFr(d.cents)} de dividendes, la quote-part de frais et charges passe de 5 % à 1 %.`,
        source: 'bofipDividendes',
      })
    } else {
      adjustments.push({
        id: `dividends-${d.receiverId}-${d.payerId}`,
        label: `Dividendes de ${nameOf(d.payerId)} à ${nameOf(d.receiverId)} hors régime mère-fille\u00a0: déduits à 99 %`,
        amountCents: -applyRate(d.cents, NON_PARENT_DEDUCTION_BP),
        origin: 'books',
        detail: 'Dividendes entre sociétés du groupe imposés dans le résultat de la société qui les reçoit\u00a0: 99 % en sont déduits.',
        source: 'cgi223',
      })
    }
  }
  for (const f of input.managementFees) {
    if (!memberIds.has(f.sellerId) || !memberIds.has(f.buyerId)) continue
    const gap = f.revenueCents - f.chargeCents
    adjustments.push({
      id: `fees-${f.sellerId}-${f.buyerId}`,
      label: `Frais de gestion de ${nameOf(f.sellerId)} à ${nameOf(f.buyerId)}\u00a0: neutres dans le résultat d’ensemble`,
      amountCents: 0,
      origin: 'info',
      detail:
        gap === 0
          ? `Produit chez ${nameOf(f.sellerId)} et charge chez ${nameOf(f.buyerId)} pour le même montant\u00a0: ils s’annulent dans la somme, sans retraitement.`
          : `Les deux livres ne concordent pas (écart de ${formatCentsFr(gap)})\u00a0: à régulariser avant de conclure.`,
      source: 'cgi223',
    })
  }
  for (const m of MANUAL_NEUTRALISATIONS) {
    const typed = input.manual[m.id]
    adjustments.push({
      id: `manual-${m.id}`,
      label: m.label,
      amountCents: typed ?? 0,
      origin: typed === undefined ? 'info' : 'manual',
      detail: typed === undefined ? `Non calculé. ${m.hint}` : m.hint,
      source: m.source,
    })
  }

  const results = members.map((c) => ({ companyId: c.id, name: c.name, resultBeforeDeficitsCents: c.resultBeforeDeficitsCents }))
  const sumOfResultsCents = results.reduce((s, r) => s + r.resultBeforeDeficitsCents, 0)
  const resultBeforeDeficitsCents = roundToEuro(sumOfResultsCents + adjustments.reduce((s, a) => s + (a.origin === 'info' ? 0 : a.amountCents), 0))

  // 4. Deficits from before the group: each on its own profit, within art. 209, I on the total.
  const byCompany = members.map((c) => {
    const opening = c.deficitsOpeningCents
    return { companyId: c.id, openingCents: opening, usableCents: Math.min(Math.max(opening ?? 0, 0), Math.max(c.resultBeforeDeficitsCents, 0)) }
  })
  const openingCents = byCompany.reduce((s, b) => s + Math.max(b.openingCents ?? 0, 0), 0)
  const usableCents = byCompany.reduce((s, b) => s + b.usableCents, 0)
  const imputedCents = roundToEuro(Math.min(usableCents, deficitCap(resultBeforeDeficitsCents)))
  const groupDeficitCents = resultBeforeDeficitsCents < 0 ? -resultBeforeDeficitsCents : 0
  if (members.some((c) => c.deficitsOpeningCents === null)) {
    warnings.push('Les déficits antérieurs d’une société ne sont pas connus (sa page Impôt sur les sociétés)\u00a0: comptés à zéro.')
  }

  // 5. IS of the group, once.
  const turnoverCents = members.reduce((s, c) => s + Math.max(c.turnoverCents, 0), 0)
  const taxableProfitCents = Math.max(resultBeforeDeficitsCents - imputedCents, 0)
  const group = possible ? taxOfGroup(taxableProfitCents, turnoverCents, parent) : null
  const separateTotalCents = members.reduce((s, c) => s + c.separateTaxCents + c.separateSocialCents, 0)
  if (possible && group?.reducedRate.eligible === null) {
    warnings.push('Les conditions de capital de la holding pour le taux réduit ne sont pas renseignées (sa page Impôt sur les sociétés)\u00a0: l’impôt du groupe est calculé au taux normal.')
  }
  if (!possible) {
    warnings.push(parentOk ? 'Aucune filiale lue ne remplit les conditions\u00a0: pas de groupe à simuler.' : 'La holding ne peut pas être tête de groupe\u00a0: voyez les conditions.')
  }

  const used = new Set<IntegrationSourceKey>(['cgi223A', 'cgi223', 'bofipDetention', 'bofipExercices', 'cgi216', 'bofipDividendes', 'cgi209', 'cgi219', 'cgi235terZC', 'ce2025'])
  return {
    possible,
    checks: parentChecks,
    members: memberships,
    results,
    sumOfResultsCents,
    adjustments,
    resultBeforeDeficitsCents,
    deficits: { openingCents, usableCents, imputedCents, groupDeficitCents, byCompany },
    turnoverCents,
    group,
    separateTotalCents: possible ? separateTotalCents : 0,
    savingCents: possible && group ? separateTotalCents - group.totalCents : 0,
    warnings,
    notice: INTEGRATION_NOTICE,
    sources: [...used].map((id) => ({ id, ...INTEGRATION_SOURCES[id] })),
  }
}
