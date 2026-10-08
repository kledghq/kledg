/**
 * Templates of banks, payment providers, taxes, social contributions and
 * insurance. See docs/bibliotheque-de-regles.md to add one.
 */

import { CREDIT, DEBIT, detectedVatLine, labelMatches, noVatLine, type RuleTemplate } from '../template'
import { SOURCES } from './sources'

const BANK_FEES_WHY =
  "Opérations bancaires exonérées (CGI art. 261 C, 1°) sauf option de la banque (CGI art. 260 B) : seule la TVA que la banque détecte sur la facture est déduite."

const INSURANCE_WHY = "Opérations d'assurance exonérées de TVA (CGI art. 261 C, 2°) : la prime est une charge sans TVA."

/** An insurer whose premiums are debited from the bank account (616, no VAT). */
function insurer(id: string, name: string, pattern: string, words: string, match: string[], noMatch: string[] = []): RuleTemplate {
  return {
    id,
    name: `${name} (assurance)`,
    category: 'assurance',
    description: `Primes d'assurance ${name} prélevées sur le compte, en primes d'assurances (616).`,
    conditions: [DEBIT, labelMatches(pattern, words)],
    lines: [noVatLine('616')],
    vat: { treatment: 'none', why: INSURANCE_WHY },
    sources: [SOURCES.insurance],
    samples: { match, noMatch },
  }
}

const DGFIP = labelMatches('\\b(dgfip|imp(o|ô)ts?\\.gouv|finances publiques|tr(e|é)sor public)\\b', 'DGFIP ou IMPOTS.GOUV')

export const FINANCE_TEMPLATES: RuleTemplate[] = [
  {
    id: 'qonto-frais',
    name: 'Abonnement et frais Qonto',
    category: 'frais-bancaires',
    description: "Abonnement et frais de la banque en ligne Qonto, en services bancaires (627).",
    conditions: [DEBIT, labelMatches('\\bqonto\\b', 'QONTO')],
    lines: [detectedVatLine('627')],
    vat: { treatment: 'detected', why: BANK_FEES_WHY },
    sources: [SOURCES.bankFees],
    samples: { match: ['Qonto', 'Frais Qonto - Abonnement Essential', 'QONTO SUBSCRIPTION'], noMatch: ['CB QONTOPIA SHOP'] },
  },
  {
    id: 'shine-frais',
    name: 'Abonnement et frais Shine',
    category: 'frais-bancaires',
    description: 'Abonnement et frais de la banque en ligne Shine, en services bancaires (627).',
    conditions: [DEBIT, labelMatches('\\bshine\\b', 'SHINE')],
    lines: [detectedVatLine('627')],
    vat: { treatment: 'detected', why: BANK_FEES_WHY },
    sources: [SOURCES.bankFees],
    samples: { match: ['SHINE', 'Frais Shine Business', 'Abonnement SHINE PLUS'], noMatch: ['CB SUNSHINE BAKERY'] },
  },
  {
    id: 'frais-tenue-de-compte',
    name: 'Frais de tenue de compte et cotisations carte',
    category: 'frais-bancaires',
    description: "Frais de tenue de compte, cotisations de carte, commissions d'intervention et frais de virement des banques, en services bancaires (627).",
    conditions: [
      DEBIT,
      labelMatches(
        "\\b(frais (de )?tenue de compte|cotisation (carte|offre|forfait)|commissions? d.intervention|frais (bancaires|sur virements?|de virements?)|forfait (de )?compte)\\b",
        'FRAIS TENUE DE COMPTE, COTISATION CARTE, COMMISSION D’INTERVENTION, FRAIS BANCAIRES',
      ),
    ],
    lines: [detectedVatLine('627')],
    vat: { treatment: 'detected', why: BANK_FEES_WHY },
    sources: [SOURCES.bankFees],
    samples: { match: ['FRAIS TENUE DE COMPTE', 'COTISATION CARTE VISA BUSINESS', "COMMISSION D'INTERVENTION 12/03"], noMatch: ['CB FRAISIER PATISSERIE', 'FRAIS DE PORT CLIENT'] },
  },
  {
    id: 'agios',
    name: 'Agios et intérêts débiteurs',
    category: 'frais-bancaires',
    description: 'Agios et intérêts du découvert prélevés par la banque, en intérêts bancaires (6616).',
    conditions: [DEBIT, labelMatches('\\b(agios|int.r.ts d.biteurs)\\b', 'AGIOS, INTERETS DEBITEURS')],
    lines: [noVatLine('6616')],
    vat: { treatment: 'none', why: 'Intérêts : opération bancaire exonérée de TVA (CGI art. 261 C, 1°).' },
    sources: [SOURCES.bankFees],
    samples: { match: ['AGIOS TRIMESTRIELS', 'INTERETS DEBITEURS 3EME TRIM', 'Intérêts débiteurs'], noMatch: ['INTERETS CREDITEURS'] },
  },
  {
    id: 'stripe-virements',
    name: 'Virements Stripe',
    category: 'encaissements',
    description:
      "Virements de Stripe vers le compte : ils soldent ce que Stripe vous doit au titre des ventes encaissées, à suivre sur un sous-compte 467 Stripe.",
    conditions: [CREDIT, labelMatches('\\bstripe\\b', 'STRIPE')],
    lines: [noVatLine('467', 'credit')],
    vat: {
      treatment: 'none',
      why: "Un virement de vos propres fonds n'est pas une opération soumise à la TVA. Stripe facture ses frais sans TVA aux comptes de l'UE hors Irlande et les retient sur le virement : passez-les depuis le relevé Stripe.",
    },
    sources: [SOURCES.scope, SOURCES.stripeFees],
    samples: { match: ['STRIPE', 'VIR SEPA STRIPE PAYMENTS EUROPE', 'Stripe payout STRIPE'], noMatch: ['CB STRIPES CAFE'] },
  },
  {
    id: 'sumup-virements',
    name: 'Virements SumUp',
    category: 'encaissements',
    description: 'Virements de SumUp (paiements par carte encaissés au terminal), à suivre sur un sous-compte 467 SumUp.',
    conditions: [CREDIT, labelMatches('\\bsum\\s?up\\b', 'SUMUP')],
    lines: [noVatLine('467', 'credit')],
    vat: { treatment: 'none', why: "Un virement de vos propres fonds n'est pas une opération soumise à la TVA ; les ventes sont enregistrées par ailleurs." },
    sources: [SOURCES.scope],
    samples: { match: ['SUMUP', 'VIR SEPA SUMUP PAYMENTS LIMITED', 'SumUp payout'], noMatch: ['VIR SUMMUM SAS'] },
  },
  {
    id: 'dgfip-impot-societes',
    name: 'Impôt sur les sociétés (acomptes et solde)',
    category: 'impots',
    description: "Acomptes et solde d'impôt sur les sociétés payés à la DGFIP : ils soldent la dette d'impôt (444).",
    conditions: [DEBIT, DGFIP, labelMatches('\\b(is|imp(o|ô)t sur les soci(e|é)t(e|é)s|2571|2572)\\b', 'IS, 2571 ou 2572')],
    lines: [noVatLine('444')],
    vat: { treatment: 'none', why: "Un impôt n'est la contrepartie d'aucune prestation : il est hors du champ de la TVA." },
    sources: [SOURCES.scope],
    samples: { match: ['PRLV SEPA DGFIP IMPOT IS', 'DGFIP ACOMPTE IS 2026', 'IMPOTS.GOUV 2572 SOLDE'], noMatch: ['PRLV SEPA DGFIP TVA', 'DGFIP CFE 2026'] },
  },
  {
    id: 'dgfip-tva',
    name: 'Paiement de la TVA',
    category: 'impots',
    description: 'TVA payée à la DGFIP après une déclaration CA3 ou CA12 : le paiement solde la TVA à décaisser (44551).',
    conditions: [DEBIT, DGFIP, labelMatches('\\b(tva|3310|ca3|ca12|3517)\\b', 'TVA, CA3 ou CA12')],
    lines: [noVatLine('44551')],
    vat: { treatment: 'none', why: "Le paiement de la TVA due n'est pas une opération soumise à la TVA : il solde le compte 44551." },
    sources: [SOURCES.scope],
    samples: { match: ['PRLV SEPA DGFIP TVA', 'DGFIP TVA 3310CA3 032026', 'IMPOTS.GOUV CA12 2025'], noMatch: ['PRLV SEPA DGFIP IMPOT IS', 'TVA REMBOURSEMENT CLIENT'] },
  },
  {
    id: 'cfe',
    name: 'Cotisation foncière des entreprises (CFE)',
    category: 'impots',
    description: "CFE payée à la DGFIP (acompte de juin et solde de décembre), en contribution économique territoriale (63511).",
    conditions: [DEBIT, labelMatches('\\bcfe\\b|cotisation fonci.re', 'CFE ou COTISATION FONCIERE')],
    lines: [noVatLine('63511')],
    vat: { treatment: 'none', why: "Un impôt n'est la contrepartie d'aucune prestation : il est hors du champ de la TVA." },
    sources: [SOURCES.scope],
    samples: { match: ['DGFIP CFE 2026', 'PRLV SEPA CFE ACOMPTE', 'COTISATION FONCIERE DES ENTREPRISES'], noMatch: ['CB CFEST BOUTIQUE'] },
  },
  {
    id: 'urssaf',
    name: 'URSSAF',
    category: 'social',
    description:
      "Cotisations payées à l'URSSAF : le paiement solde la dette sociale de la paie (431). Sans paie dans Kledg (cotisations du dirigeant non salarié), remplacez le compte par 646.",
    conditions: [DEBIT, labelMatches('\\burssaf\\b', 'URSSAF')],
    lines: [noVatLine('431')],
    vat: { treatment: 'none', why: "Les cotisations sociales ne sont la contrepartie d'aucune prestation : elles sont hors du champ de la TVA." },
    sources: [SOURCES.scope],
    samples: { match: ['PRLV SEPA URSSAF ILE DE FRANCE', 'URSSAF RHONE ALPES', 'Urssaf cotisations'], noMatch: ['VIR SEPA URSULA MARTIN'] },
  },
  {
    id: 'retraite-complementaire',
    name: 'Retraite complémentaire et prévoyance',
    category: 'social',
    description: 'Cotisations payées aux caisses de retraite complémentaire et de prévoyance, en dettes envers les autres organismes sociaux (437).',
    conditions: [DEBIT, labelMatches('\\b(malakoff|ag2r|klesia|humanis|pro btp|agirc|arrco|apicil|audiens|irp auto)\\b', 'MALAKOFF, AG2R, KLESIA, PRO BTP, APICIL, AUDIENS')],
    lines: [noVatLine('437')],
    vat: { treatment: 'none', why: "Les cotisations sociales ne sont la contrepartie d'aucune prestation : elles sont hors du champ de la TVA." },
    sources: [SOURCES.scope],
    samples: { match: ['PRLV SEPA MALAKOFF HUMANIS', 'AG2R LA MONDIALE', 'KLESIA RETRAITE'], noMatch: ['CB KLEBER SPORT'] },
  },
  insurer('axa-assurance', 'AXA', '\\baxa\\b', 'AXA', ['PRLV SEPA AXA FRANCE IARD', 'AXA ASSURANCES'], ['CB PAXAR']),
  insurer('allianz-assurance', 'Allianz', '\\ballianz\\b', 'ALLIANZ', ['PRLV SEPA ALLIANZ IARD', 'ALLIANZ VIE']),
  insurer('hiscox-assurance', 'Hiscox', '\\bhiscox\\b', 'HISCOX', ['PRLV SEPA HISCOX', 'Hiscox Europe Underwriting']),
  insurer('mma-assurance', 'MMA', '\\bmma (iard|entreprises?|assurances?|vie)\\b', 'MMA IARD, MMA ENTREPRISE', ['PRLV SEPA MMA IARD', 'MMA ENTREPRISE CONTRAT 123'], ['CB MMA FACTORY']),
  insurer('generali-assurance', 'Generali', '\\bgenerali\\b', 'GENERALI', ['PRLV SEPA GENERALI IARD', 'GENERALI VIE']),
]
