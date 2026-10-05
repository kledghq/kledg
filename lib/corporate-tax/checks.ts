/**
 * Checks shown with the impôt sur les sociétés worksheet: what makes the
 * figures incomplete (blocking) and what deserves a look (warning). Pure:
 * the loader gathers the counts and balances.
 *
 * Blocking, the tax result would be wrong:
 * - draft entries of the fiscal year: only validated entries make the
 *   result (validation makes an entry definitive, PCG art. 1031-3);
 * - bank lines of the year not reconciled: their entries, charges or
 *   products, are probably missing.
 * Warnings and information:
 * - the year is not over: the figures are those of the entries so far;
 * - a reduced rate question is not answered (CGI art. 219, I, b);
 * - the deficits carried forward are not known (CGI art. 209, I);
 * - dividends (761) Kledg did not attribute to a subsidiary held for 5 %;
 * - accounts whose deductibility Kledg cannot judge (réceptions 6257,
 *   foreign taxes 6954, intégration fiscale 698);
 * - the acomptes recorded differ from the payments booked on 444.
 */

import { formatCentsFr } from '@/lib/utils/money'

export type CheckSeverity = 'blocking' | 'warning' | 'info' | 'ok'

export interface CorporateTaxCheck {
  id: 'drafts' | 'bank' | 'in-progress' | 'reduced-rate' | 'deficits' | 'dividends' | 'group' | 'receptions' | 'foreign-tax' | 'tax-group' | 'acomptes'
  severity: CheckSeverity
  title: string
  detail: string
  /** Page of the company that fixes it, relative to the company. */
  link?: { label: string; page: string }
  items?: string[]
}

export interface CheckInput {
  drafts: { count: number; numbers: string[] }
  unreconciled: { count: number; totalCents: number }
  yearInProgress: boolean
  unanswered: string[]
  deficitsKnown: boolean
  /** Dividends of 761 not deducted under the parent-subsidiary regime. */
  otherDividendsCents: number
  /** Subsidiaries the user cannot read (their stake and dividends are not known). */
  unreachableSubsidiaries: number
  receptionsCents: number
  foreignTaxCents: number
  taxGroupCents: number
  acomptes: { recordedCents: number; bookedCents: number }
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`
/** "1 790,00 €": formatCentsFr already ends with the euro sign. */
const euros = (cents: number) => formatCentsFr(cents)

export function corporateTaxChecks(input: CheckInput): CorporateTaxCheck[] {
  const checks: CorporateTaxCheck[] = []
  checks.push(
    input.drafts.count > 0
      ? {
          id: 'drafts',
          severity: 'blocking',
          title: `${plural(input.drafts.count, 'écriture', 'écritures')} en brouillon sur l’exercice`,
          detail: 'Seules les écritures validées font le résultat. Validez ou supprimez les brouillons de l’exercice, puis revenez à l’impôt.',
          link: { label: 'Voir les brouillons', page: 'entries?statut=brouillon' },
          items: input.drafts.numbers,
        }
      : { id: 'drafts', severity: 'ok', title: 'Aucune écriture en brouillon sur l’exercice', detail: 'Toutes les écritures de l’exercice sont validées.' },
  )
  checks.push(
    input.unreconciled.count > 0
      ? {
          id: 'bank',
          severity: 'blocking',
          title: `${plural(input.unreconciled.count, 'opération bancaire', 'opérations bancaires')} non ${input.unreconciled.count > 1 ? 'rapprochées' : 'rapprochée'} sur l’exercice`,
          detail: `Pour ${euros(input.unreconciled.totalCents)} : leurs écritures manquent peut-être, et avec elles des charges ou des produits. Rapprochez-les avant de calculer l’impôt.`,
          link: { label: 'Rapprocher', page: 'reconciliation' },
        }
      : { id: 'bank', severity: 'ok', title: 'Opérations bancaires de l’exercice rapprochées', detail: 'Chaque opération bancaire de l’exercice a son écriture.' },
  )
  if (input.yearInProgress) {
    checks.push({
      id: 'in-progress',
      severity: 'info',
      title: 'Exercice en cours',
      detail: 'Le résultat est celui des écritures passées jusqu’à aujourd’hui : l’impôt affiché est une estimation, qui changera d’ici la clôture.',
    })
  }
  if (input.unanswered.length > 0) {
    checks.push({
      id: 'reduced-rate',
      severity: 'warning',
      title: 'Conditions du taux réduit à confirmer',
      detail: 'Tant qu’une condition n’est pas confirmée, Kledg calcule tout le bénéfice au taux normal de 25 % et indique ce que donnerait le taux réduit de 15 %.',
      items: input.unanswered,
    })
  }
  if (!input.deficitsKnown) {
    checks.push({
      id: 'deficits',
      severity: 'warning',
      title: 'Déficits reportables non renseignés',
      detail: 'Indiquez les déficits fiscaux reportables au début de l’exercice (0 s’il n’y en a pas), d’après la dernière déclaration (2033-B ligne 370 ou tableau 2058-B).',
    })
  }
  if (input.otherDividendsCents > 0) {
    checks.push({
      id: 'dividends',
      severity: 'warning',
      title: 'Produits de participations à examiner',
      detail: `${euros(input.otherDividendsCents)} de produits de participations (761) ne viennent pas d’une filiale détenue à 5 % au moins d’après les associés enregistrés : ils restent imposables. Si le régime des sociétés mères s’applique (CGI, art. 145), ajoutez la déduction et la quote-part de 5 % à la main.`,
    })
  }
  if (input.unreachableSubsidiaries > 0) {
    checks.push({
      id: 'group',
      severity: 'info',
      title: `${plural(input.unreachableSubsidiaries, 'filiale', 'filiales')} hors de votre accès`,
      detail: 'Kledg ne lit pas la participation ni les dividendes d’une filiale dont vous n’êtes pas membre : vérifiez à la main le régime des sociétés mères pour elle.',
    })
  }
  if (input.receptionsCents > 0) {
    checks.push({
      id: 'receptions',
      severity: 'info',
      title: 'Réceptions à vérifier',
      detail: `${euros(input.receptionsCents)} au compte 6257 (réceptions). Elles sont déductibles si elles servent l’intérêt de la société ; une dépense somptuaire ou personnelle se réintègre à la main (CGI, art. 39, 4 ; approbation par les associés, art. 223 quater).`,
    })
  }
  if (input.foreignTaxCents !== 0) {
    checks.push({
      id: 'foreign-tax',
      severity: 'info',
      title: 'Impôts dus à l’étranger',
      detail: `${euros(input.foreignTaxCents)} au compte 6954. Selon la convention fiscale, l’impôt étranger ouvre un crédit d’impôt (il n’est alors pas déductible) ou se déduit : ajoutez la ligne à la main.`,
    })
  }
  if (input.taxGroupCents !== 0) {
    checks.push({
      id: 'tax-group',
      severity: 'warning',
      title: 'Intégration fiscale',
      detail: 'Le compte 698 a bougé : dans un groupe intégré, l’impôt est calculé par la société tête de groupe (CGI, art. 223 A). Kledg ne prépare pas cet impôt.',
    })
  }
  const { recordedCents, bookedCents } = input.acomptes
  if ((recordedCents !== 0 || bookedCents !== 0) && recordedCents !== bookedCents) {
    checks.push({
      id: 'acomptes',
      severity: 'warning',
      title: 'Acomptes enregistrés et comptabilisés différents',
      detail: 'Les acomptes versés pour cet exercice, enregistrés ici, ne correspondent pas aux paiements passés au débit du compte 444. Vérifiez les deux.',
      items: [`Acomptes enregistrés : ${euros(recordedCents)}`, `Débits du compte 444 sur l’exercice : ${euros(bookedCents)}`],
    })
  }
  return checks
}

/** The figures can be declared as computed: no blocking check. */
export function isReliable(checks: CorporateTaxCheck[]): boolean {
  return checks.every((c) => c.severity !== 'blocking')
}
