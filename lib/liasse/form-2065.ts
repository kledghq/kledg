/**
 * Form 2065-SD 2026, déclaration de résultat de l'impôt sur les sociétés
 * (CGI art. 223), and its annexe 2065 bis-SD, on plain values (pure): the
 * fields Kledg holds (identification of the company, exercice, regime, the
 * tax result of the impôt sur les sociétés worksheet, the software keeping
 * the books) and every other field listed as to fill by hand.
 *
 * The paper form prints no box codes: fields are named by their frame
 * (cadre A to K) and their label as printed. The tax result is split by
 * rate, as the notice of the form asks ("Le résultat fiscal doit être
 * ventilé en fonction des différents taux applicables à l'entreprise"):
 * the profit taxed at the reduced rate of 15 % (CGI art. 219, I-b) and the
 * profit taxed at the normal rate, or the deficit.
 */

import type { CorporateTaxRegime } from '@/lib/corporate-tax/compute'
import { addressLine, type CompanyIdentity } from './capital'
import { amount, cell, check, field, flag, manual, text, type LiasseCell, type LiasseCheck, type LiasseForm, type LiasseSection } from './cells'

export interface CoverInput {
  regime: CorporateTaxRegime
  company: CompanyIdentity & { email: string | null; activityCode: string | null }
  fiscalYear: { startDate: string; endDate: string }
  /** The impôt sur les sociétés worksheet of the year; null when there is none (`why` says why). */
  corporateTax: {
    normalBaseCents: number
    reducedBaseCents: number
    deficitCents: number
    /** The reduced rate is not applied because a question of eligibility is unanswered. */
    eligibilityUnknown: boolean
    reliable: boolean
  } | null
  why: string
  /** Debit balance of 641 (rémunérations du personnel), a hint for cadre J. */
  salariesCents: number
}

const frDay = (iso: string) => iso.split('-').reverse().join('/')
const sections = (list: Array<[string, string, LiasseCell[]]>): LiasseSection[] =>
  list.map(([id, title, cells]) => ({ id, title, columns: null, rows: cells.map((c, i) => field(`${id}-${i}`, c)) }))

export function buildCoverForm(input: CoverInput): LiasseForm {
  const { company, corporateTax: is } = input
  const fromWorksheet = 'Calcul de la page Impôt sur les sociétés.'
  const result: LiasseCell[] = is
    ? [
        cell(null, 'Bénéfice imposable au taux normal', amount(is.normalBaseCents), 'worksheet', {
          note: is.eligibilityUnknown ? `${fromWorksheet} Le taux réduit n'est pas appliqué tant que ses conditions ne sont pas confirmées.` : fromWorksheet,
        }),
        cell(null, 'Bénéfice imposable à 15 %', amount(is.reducedBaseCents), 'worksheet', { note: fromWorksheet }),
        cell(null, 'Déficit', amount(is.deficitCents), 'worksheet', { note: fromWorksheet }),
      ]
    : [manual(null, 'Bénéfice imposable au taux normal', input.why), manual(null, 'Bénéfice imposable à 15 %', input.why), manual(null, 'Déficit', input.why)]
  result.push(
    manual(
      null,
      'Résultat net de cession, de concession ou de sous-concession des brevets et droits de propriété industrielle assimilés imposable au taux de 10 %',
      "Seulement en cas d'option pour le régime de l'article 238 du CGI.",
    ),
  )
  const capitalGains = ['PV à long terme imposables à 15 %', 'PV à long terme imposables à 19 %', 'PV exonérées (art. 238 quindecies)', 'Autres PV imposables à 19 %', 'PV à long terme imposables à 0 %'].map((label) =>
    manual(null, label, 'Les plus-values de cession ne sont pas calculées par Kledg (tableaux 2033-C cadre III, 2059-A à 2059-D).'),
  )
  const exemptions = manual(null, 'Abattements sur le bénéfice et exonérations (jeunes entreprises innovantes, entreprises nouvelles, zones...)', "Kledg n'applique aucun régime d'exonération : à remplir si la société en relève.")
  const where = "Renseignez l'adresse du siège dans Société, Informations."
  const isSimplified = input.regime === 'simplified'

  const list: Array<[string, string, LiasseCell[]]> = [
    [
      'header',
      'Exercice et régime',
      [
        cell(null, 'Exercice ouvert le', text(frDay(input.fiscalYear.startDate)), 'record'),
        cell(null, 'Et clos le', text(frDay(input.fiscalYear.endDate)), 'record'),
        cell(null, "Régime simplifié d'imposition", flag(isSimplified), 'record', { note: "Régime d'impôt sur les sociétés de la société à la clôture." }),
        cell(null, 'Régime réel normal', flag(!isSimplified), 'record'),
        manual(null, "Déclaration souscrite pour le résultat d'ensemble du groupe", 'Seulement pour la société mère d\'un groupe fiscal intégré.'),
        manual(null, 'PME innovantes', 'Case à cocher si la société en relève.'),
        manual(null, 'Option pour le régime de taxation au tonnage (art. 209-0 B)', 'Entreprises de transport maritime seulement.'),
      ],
    ],
    [
      'identification',
      "A. Identification de l'entreprise",
      [
        cell(null, 'Désignation de la société', text(company.name), 'record'),
        company.address ? cell(null, 'Adresse du siège social', text(addressLine(company.address)), 'record') : manual(null, 'Adresse du siège social', where),
        company.siret ? cell(null, 'SIRET', text(company.siret), 'record', { note: 'Établissement du siège.' }) : manual(null, 'SIRET', 'Ajoutez l\'établissement du siège avec son SIRET dans Société, Informations.'),
        company.email ? cell(null, 'Mél', text(company.email), 'record') : manual(null, 'Mél', "Aucune adresse e-mail dans les informations de la société."),
        manual(null, 'Adresse du principal établissement', 'Si elle diffère du siège.'),
        manual(null, 'Ancienne adresse en cas de changement', 'Seulement en cas de changement.'),
        manual(null, 'Régime fiscal des groupes : date d\'entrée et société mère', 'Seulement pour une société membre d\'un groupe fiscal intégré (art. 223 A à U du CGI).'),
      ],
    ],
    [
      'activity',
      'B. Activité',
      [
        manual(null, 'Activités exercées', 'Décrivez l\'activité réellement exercée.', company.activityCode ? text(`Code APE ${company.activityCode}`) : undefined),
        manual(null, "Changement d'activité (case à cocher)", "Seulement si l'activité a changé."),
      ],
    ],
    ['result', 'C. Récapitulation des éléments d\'imposition : 1. Résultat fiscal', result],
    ['gains', 'C. 2. Plus-values', capitalGains],
    ['exemptions', 'C. 3. Abattements sur le bénéfice et exonérations ; 4. Crédit d\'impôt outre-mer', [exemptions, manual(null, "Option pour le crédit d'impôt outre-mer (art. 244 quater W du CGI)", 'Case à cocher, secteur productif outre-mer.')]],
    [
      'contributions',
      'Contributions exceptionnelles (CES, CTM)',
      [
        manual(null, 'Contribution exceptionnelle sur les bénéfices des grandes entreprises : base, chiffre d\'affaires, taux', "Seulement pour un chiffre d'affaires supérieur à 1 milliard d'euros (notice 2065-SD)."),
        manual(null, 'Contribution exceptionnelle des grandes entreprises de transport maritime : base, taux', 'Seulement pour les entreprises de transport maritime au régime de la taxation au tonnage.'),
      ],
    ],
    [
      'imputations',
      'D. Imputations ; E. Contribution annuelle sur les revenus locatifs',
      [
        manual(null, "Imputations au titre des revenus mobiliers (certificats de crédits d'impôt)", 'Selon les certificats reçus.'),
        manual(null, "Imputations au titre des revenus étrangers ouvrant droit à un crédit d'impôt conventionnel", 'Selon les conventions fiscales.'),
        manual(null, 'Recettes nettes soumises à la contribution de 2,5 %', 'Seulement pour les revenus locatifs concernés.'),
      ],
    ],
    [
      'software',
      'F. Comptabilité informatisée',
      [
        cell(null, "L'entreprise dispose-t-elle d'une comptabilité informatisée ?", flag(true), 'record', { note: 'La comptabilité est tenue dans Kledg.' }),
        cell(null, 'Indication du logiciel utilisé', text('Kledg'), 'record'),
      ],
    ],
    [
      'signatories',
      'Professionnels, conformité et signature',
      [
        manual(null, "Nom et adresse du professionnel de l'expertise comptable", "S'il y en a un."),
        manual(null, 'Nom et adresse du conseil', "S'il y en a un."),
        manual(null, 'Examen de conformité fiscale (prestataire)', "S'il y en a un."),
        manual(null, 'Identité du déclarant, qualité et nom du signataire', 'Le représentant légal qui dépose la déclaration.'),
      ],
    ],
    [
      'distributions',
      '2065 bis-SD, G. Répartition des produits des actions et parts sociales et revenus distribués',
      [
        manual(null, 'Montant global brut des distributions', "Distributions mises en paiement au cours de la période : selon les décisions des associés et l'IFU (2561)."),
        manual(null, 'Distributions dont la société ne désigne pas les bénéficiaires', "Rémunérations ou avantages occultes."),
        manual(null, 'Prêts, avances ou acomptes consentis aux associés', "Le solde débiteur des comptes courants d'associés en fait partie."),
        manual(null, 'Revenus distribués éligibles et non éligibles à l\'abattement de 40 %', "Selon la qualité des bénéficiaires."),
      ],
    ],
    [
      'remunerations',
      '2065 bis-SD, H. Rémunérations nettes versées aux membres de certaines sociétés',
      [manual(null, 'Sommes versées à chaque associé (SARL, EURL, SCA, sociétés de personnes ayant opté pour l\'IS)', 'Traitements, indemnités, frais et parts détenues par associé.')],
    ],
    [
      'misc',
      '2065 bis-SD, I. Divers',
      [manual(null, 'Nom et adresse du propriétaire du fonds (en cas de gérance libre)', 'Seulement en cas de location-gérance.'), manual(null, 'Adresses des autres établissements', 'Établissements autres que le siège.')],
    ],
  ]
  if (isSimplified) {
    list.push([
      'simplified',
      '2065 bis-SD, J. Cadre ne concernant que les entreprises placées sous le régime simplifié d\'imposition',
      [
        manual(
          null,
          'Montant brut des salaires (a)',
          "Bases brutes fiscales des DSN, sans les sommes versées aux apprentis sous contrat et aux handicapés (notice 2065-SD) : la DSN fait foi.",
          input.salariesCents > 0 ? amount(input.salariesCents) : undefined,
        ),
        manual(null, "Rétrocessions d'honoraires, de commissions et de courtages (b)", 'Kledg ne les distingue pas des honoraires.'),
        manual(null, 'Moins-values à long terme (MVLT) à 0 %, 15 % et 19 %', 'Kledg ne suit pas les moins-values à long terme.'),
      ],
    ])
  }
  list.push(['donations', '2065 bis-SD, K. Organismes bénéficiaires de dons (article 222 bis du CGI)', [manual(null, 'Montant cumulé des dons et nombre de reçus délivrés', 'Seulement pour les organismes bénéficiaires de dons.')]])

  const checks: LiasseCheck[] = is
    ? [check('corporate-tax', "Calcul de l'impôt sur les sociétés", is.reliable, "Le calcul de l'impôt sur les sociétés signale des points à régler (écritures en brouillon, questions sans réponse, déficits inconnus...) : voyez la page Impôt sur les sociétés.")]
    : [check('corporate-tax', "Calcul de l'impôt sur les sociétés", false, input.why)]
  return {
    id: '2065',
    number: '2065-SD',
    title: 'Impôt sur les sociétés : déclaration de résultat',
    sections: sections(list),
    checks,
    warnings: [],
    required: { value: true, reason: null },
  }
}
