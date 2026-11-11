/**
 * Form 2058-C-SD 2026, "Tableau d'affectation du résultat et
 * renseignements divers" (régime réel normal), on plain values (pure,
 * amounts in cents).
 *
 * Affectation du résultat: the form shows the allocation, made during the
 * year declared, of the result of the year before ("Résultat de l'exercice
 * précédant celui pour lequel la déclaration est établie"), read in the
 * validated entries of the year:
 * - origines: report à nouveau at the opening (0C, 11), result of the
 *   previous year at the opening (0D, 12), prélèvements sur les réserves
 *   (0E, debits of 106 during the year); total 0F;
 * - affectations: réserve légale (ZB, credits of 1061), autres réserves
 *   (ZD, credits of the other 106 accounts), dividendes (ZE, credits of
 *   457, Associés - dividendes à payer), autres répartitions (ZF, not in
 *   the books), report à nouveau after the allocation (ZG, 11 at the
 *   closing); total ZH. The form says "le total I doit être égal au total
 *   II": checked, and the dividends and reserves are compared with the
 *   allocation voted at the approval of the previous year's accounts
 *   (lib/approval, lib/accounting/result-allocation, C. com. art. L232-10
 *   and L232-11).
 *
 * Renseignements divers: the detail of "Autres achats et charges externes"
 * (ZJ, line FW of 2052-SD: 604, 605, 606, 608, 609, 61, 62) with
 * sous-traitance (YT, 611), locations et charges locatives (XQ, 613 and
 * 614), personnel extérieur (YU, 621), honoraires (SS, 622 except 6224),
 * rétrocessions (YV, 6224) and the rest (ST); impôts et taxes (YX, line FX,
 * 63) with the contribution économique territoriale (YW, 63511) and the
 * rest (9Z); the VAT collected and deductible of the year (YY, YZ, vat.ts);
 * whether the company holds subsidiaries listed on 2059-G (ZR). Commitments
 * of crédit-bail, effets escomptés, the share of rents of more than six
 * months, salaries of the DSN, the highest interest rate paid to
 * associates, the group regime and the revenu brut social are not in the
 * books.
 *
 * Box codes: form n° 2058-C-SD 2026 (the digit zero printed "Ø" written
 * "0") and notice n° 2032-NOT-SD.
 */

import type { AccountYear } from '@/lib/annexe/build-annexe'
import { formatCentsFr } from '@/lib/utils/money'
import { amount, cell, check, count, field, manual, sumCells, type LiasseCell, type LiasseCheck, type LiasseForm } from './cells'
import type { VatTotals } from './vat'

export interface Form2058CInput {
  accounts: readonly AccountYear[]
  vat: VatTotals
  /** The allocation voted at the approval of the previous year's accounts, when recorded in Kledg. */
  approvedAllocation: { year: number; dividendsCents: number; otherReservesCents: number } | null
  /** Rents still to pay of the crédit-bail commitments answered on the annexe (a hint). */
  leasingCommitmentsCents: number | null
  /** Companies held for 10 % or more (2059-G-SD) and subsidiaries that could not be read. */
  subsidiaries: { listed: number; unreachable: number }
}

const matches = (code: string, prefixes: readonly string[]) => prefixes.some((p) => code.startsWith(p))

export function buildForm2058C(input: Form2058CInput): LiasseForm {
  const euro = formatCentsFr
  const { accounts } = input
  const pick = (prefixes: string[], except: string[] = []) => accounts.filter((a) => matches(a.code, prefixes) && !matches(a.code, except))
  const codes = (list: AccountYear[]) => list.filter((a) => a.openingCents !== 0 || a.debitCents !== 0 || a.creditCents !== 0).map((a) => a.code)
  /** Credit-positive opening balance. */
  const opening = (prefixes: string[]) => pick(prefixes).reduce((s, a) => s - a.openingCents, 0)
  const credits = (prefixes: string[], except: string[] = []) => pick(prefixes, except).reduce((s, a) => s + a.creditCents, 0)
  const debits = (prefixes: string[], except: string[] = []) => pick(prefixes, except).reduce((s, a) => s + a.debitCents, 0)
  /** Debit minus credit over the year (income statement accounts). */
  const charge = (prefixes: string[], except: string[] = []) => pick(prefixes, except).reduce((s, a) => s + a.openingCents + a.debitCents - a.creditCents, 0)
  const books = (box: string, label: string, cents: number, prefixes: string[], except: string[] = []) => cell(box, label, amount(cents), 'books', { accounts: codes(pick(prefixes, except)) })

  // Affectation du résultat
  const retainedOpening = books('0C', "Report à nouveau figurant au bilan de l'exercice antérieur à celui pour lequel la déclaration est établie", opening(['11']), ['11'])
  const previousResult = books('0D', "Résultat de l'exercice précédant celui pour lequel la déclaration est établie", opening(['12']), ['12'])
  const fromReserves = books('0E', 'Prélèvements sur les réserves', debits(['106']), ['106'])
  const totalI = sumCells('0F', 'Total I', [retainedOpening, previousResult, fromReserves])
  const legal = books('ZB', 'Affectations aux réserves : réserves légales', credits(['1061']), ['1061'])
  const otherReserves = books('ZD', 'Affectations aux réserves : autres réserves', credits(['106'], ['1061']), ['106'], ['1061'])
  const dividends = books('ZE', 'Dividendes', credits(['457']), ['457'])
  const otherAllocations = manual('ZF', 'Autres répartitions', 'Tantièmes, parts de bénéfices des associés en industrie... : ne se lisent pas dans les comptes.')
  const retainedClosing = books('ZG', 'Report à nouveau', pick(['11']).reduce((s, a) => s - (a.openingCents + a.debitCents - a.creditCents), 0), ['11'])
  const totalII = sumCells('ZH', 'Total II', [legal, otherReserves, dividends, otherAllocations, retainedClosing])

  // Renseignements divers
  const externalTotal = charge(['604', '605', '606', '608', '609', '61', '62'])
  const subcontracting = charge(['611'])
  const rents = charge(['613', '614'])
  const staff = charge(['621'])
  const fees = charge(['622'], ['6224'])
  const retrocessions = charge(['6224'])
  const taxesTotal = charge(['63'])
  const cet = charge(['63511'])
  const unions = charge(['6281'])
  const salaries = charge(['641'])
  const divers: LiasseCell[] = [
    manual('YQ', 'Engagements de crédit-bail mobilier', "Redevances restant à payer des contrats de crédit-bail mobilier : l'annexe ne distingue pas le mobilier de l'immobilier.", input.leasingCommitmentsCents ? amount(input.leasingCommitmentsCents) : undefined),
    manual('J7', 'Prix de revient des biens pris en crédit-bail', "Prix de revient d'origine des biens du contrat (notice 2032-NOT-SD)."),
    manual('YR', 'Engagements de crédit-bail immobilier', 'Voir la case YQ.'),
    manual('YS', "Effets portés à l'escompte et non échus", 'Kledg ne suit pas les effets escomptés.'),
    books('YT', 'Sous-traitance', subcontracting, ['611']),
    books('XQ', 'Locations, charges locatives et de copropriété', rents, ['613', '614']),
    manual('J8', 'Dont montant des loyers des biens pris en location pour une durée supérieure à 6 mois', 'Kledg ne connaît pas la durée des contrats de location.'),
    books('YU', "Personnel extérieur à l'entreprise", staff, ['621']),
    books('SS', "Rémunérations d'intermédiaires et honoraires (hors rétrocessions)", fees, ['622'], ['6224']),
    books('YV', "Rétrocessions d'honoraires, commissions et courtage", retrocessions, ['6224']),
    cell('ST', 'Autres comptes', amount(externalTotal - subcontracting - rents - staff - fees - retrocessions), 'books', { note: 'Le reste des autres achats et charges externes.' }),
    manual('ES', 'Dont cotisations versées aux organisations syndicales et professionnelles', 'Le compte 6281 peut comprendre d\'autres cotisations.', unions > 0 ? amount(unions) : undefined),
    books('ZJ', 'Total du poste correspondant à la ligne FW du tableau n° 2052-SD', externalTotal, ['604', '605', '606', '608', '609', '61', '62']),
    books('YW', 'CFE et CVAE', cet, ['63511']),
    cell('9Z', 'Autres impôts, taxes et versements assimilés', amount(taxesTotal - cet), 'books'),
    manual('ZS', 'Dont taxe intérieure de consommation sur les produits énergétiques', 'Kledg ne la distingue pas des autres taxes.'),
    books('YX', 'Total du poste correspondant à la ligne FX du tableau n° 2052-SD', taxesTotal, ['63']),
    cell('YY', 'Montant de la TVA collectée', amount(input.vat.collectedCents), 'books', { accounts: input.vat.collectedAccounts, note: input.vat.note }),
    cell('YZ', "Montant de la TVA déductible comptabilisée au cours de l'exercice au titre des biens et services ne constituant pas des immobilisations", amount(input.vat.deductibleCents), 'books', {
      accounts: input.vat.deductibleAccounts,
      note: input.vat.note,
    }),
    manual('0B', 'Montant brut des salaires (cf. la dernière déclaration sociale nominative DSN)', 'Sans les sommes versées aux apprentis sous contrat et aux handicapés (notice 2032-NOT-SD) : la DSN fait foi.', salaries > 0 ? amount(salaries) : undefined),
    manual('0S', "Montant de la plus-value constatée en franchise d'impôt lors de la première option pour le régime simplifié d'imposition", 'Seulement pour les entreprises concernées depuis 1984.'),
    manual('ZK', 'Taux d\'intérêt le plus élevé servi aux associés à raison des sommes mises à la disposition de la société', 'Selon les conventions de comptes courants : Kledg ne connaît pas les taux.'),
    input.subsidiaries.unreachable > 0
      ? manual('ZR', 'Filiales et participations (liste au tableau 2059-G-SD) : 1 si oui, 0 sinon', "Une filiale enregistrée dans Kledg ne vous est pas accessible.", count(input.subsidiaries.listed > 0 ? 1 : 0))
      : cell('ZR', 'Filiales et participations (liste au tableau 2059-G-SD) : 1 si oui, 0 sinon', count(input.subsidiaries.listed > 0 ? 1 : 0), 'record'),
    manual('RG', "Aides perçues ayant donné droit à la réduction d'impôt prévue au 4 de l'article 238 bis du CGI pour l'entreprise donatrice", 'Mécénat reçu.'),
    manual('RH', "Montant de l'investissement reçu qui a donné lieu à amortissement exceptionnel chez l'entreprise investisseur dans le cadre de l'article 217 octies du CGI", "Information détenue par l'investisseur."),
  ]
  const group: LiasseCell[] = [
    manual('JA', 'Régime de groupe : résultat comme si la société n\'avait jamais été membre du groupe, plus-values et imputations (JA, JK, JL, JM, JC)', 'Seulement pour une société membre d\'un groupe fiscal intégré (notice 2058-NOT-SD).'),
    manual('JD', "Régime de groupe : résultat d'ensemble, plus-values et imputations (JD, JN, JO, JP, JF)", 'Seulement pour la société mère.'),
    manual('JH', 'Régime de groupe : 1 si société mère, 2 si société filiale ; SIRET de la société mère (JJ)', 'Seulement pour un groupe fiscal intégré.'),
  ]
  const independents: LiasseCell[] = [
    manual('JQ', 'Sommes à réintégrer pour la détermination du revenu brut social', 'Revenu brut social des travailleurs indépendants (notice 2032-NOT-SD) : Kledg ne le calcule pas.'),
    manual('JR', 'Sommes à déduire pour la détermination du revenu brut social', 'Voir la case JQ.'),
    manual('JS', 'Revenu brut social (si le montant est négatif)', 'Voir la case JQ.'),
    manual('JT', 'Revenu brut social (si le montant est positif)', 'Voir la case JQ.'),
  ]

  const checks: LiasseCheck[] = []
  const t1 = totalI.value?.kind === 'amount' ? totalI.value.cents : 0
  const t2 = totalII.value?.kind === 'amount' ? totalII.value.cents : 0
  checks.push(
    check(
      'allocation-totals',
      'Origines (total I) et affectations (total II) du résultat',
      t1 === t2,
      `Le total des origines (${euro(t1)}) diffère de celui des affectations (${euro(t2)}, sans les autres répartitions) : le résultat de l'exercice précédent n'est pas entièrement affecté dans les écritures, ou une autre répartition reste à indiquer (ZF).`,
    ),
  )
  const a = input.approvedAllocation
  if (a) {
    const zd = otherReserves.value?.kind === 'amount' ? otherReserves.value.cents : 0
    const ze = dividends.value?.kind === 'amount' ? dividends.value.cents : 0
    checks.push(
      check('approved-dividends', `Dividendes (ZE) et affectation votée à l'approbation des comptes ${a.year}`, ze === a.dividendsCents, `Les écritures montrent ${euro(ze)} de dividendes, l'affectation votée ${euro(a.dividendsCents)} : comptabilisez l'affectation telle qu'elle a été votée, ou corrigez la décision enregistrée.`),
      check('approved-reserves', `Autres réserves (ZD) et affectation votée à l'approbation des comptes ${a.year}`, zd === a.otherReservesCents, `Les écritures montrent ${euro(zd)} d'autres réserves, l'affectation votée ${euro(a.otherReservesCents)}.`),
    )
  }
  const warnings: string[] = []
  const previous = previousResult.value?.kind === 'amount' ? previousResult.value.cents : 0
  const leftInResult = pick(['12']).reduce((s, a2) => s - (a2.openingCents + a2.debitCents - a2.creditCents), 0)
  if (previous !== 0 && leftInResult === previous) warnings.push("Le résultat de l'exercice précédent est toujours au compte 12 : affectez-le depuis la page Exercices (affectation du résultat).")
  if (!a && previous !== 0) warnings.push("Aucune affectation votée n'est enregistrée pour l'exercice précédent dans Kledg : le contrôle avec la décision des associés n'est pas fait.")

  return {
    id: '2058-C',
    number: '2058-C-SD',
    title: "Tableau d'affectation du résultat et renseignements divers",
    sections: [
      { id: 'origins', title: 'Affectation du résultat : origines', columns: null, rows: [retainedOpening, previousResult, fromReserves, totalI].map((c, i) => ({ ...field(`origin-${i}`, c), total: c === totalI })) },
      { id: 'allocations', title: 'Affectation du résultat : affectations', columns: null, rows: [legal, otherReserves, dividends, otherAllocations, retainedClosing, totalII].map((c, i) => ({ ...field(`allocation-${i}`, c), total: c === totalII })) },
      { id: 'divers', title: 'Renseignements divers', columns: null, rows: divers.map((c, i) => ({ ...field(`divers-${i}`, c), total: c.box === 'ZJ' || c.box === 'YX' })) },
      { id: 'group', title: 'Régime de groupe', columns: null, rows: group.map((c, i) => field(`group-${i}`, c)) },
      { id: 'independents', title: 'Travailleurs indépendants', columns: null, rows: independents.map((c, i) => field(`independents-${i}`, c)) },
    ],
    checks,
    warnings,
    required: { value: true, reason: null },
  }
}
