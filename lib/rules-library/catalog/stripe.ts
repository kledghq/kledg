/**
 * Templates of the Stripe connection (lib/banking/providers/stripe): the
 * lines of a Stripe account carry an operation type (stripe.charge,
 * stripe.fee, stripe.payout...) that these rules match on, never a bank
 * label. Kledg adds them to the company when Stripe is connected
 * (lib/banking/stripe-setup.service.ts); they stay ordinary rules the user
 * edits.
 *
 * - Payments and refunds: a sale at 20 % on 706, VAT collected on the
 *   amount received (CGI art. 278). A company selling goods (707), at
 *   another rate or abroad changes the rule.
 * - Fees on payments: commissions on payment services, exempt (CGI art.
 *   261 C, 1°), which Stripe bills without VAT to French accounts. This is
 *   the treatment of the "Commissions de paiement en ligne" category of the
 *   simple mode.
 * - Stripe's software fees (Billing, Radar, Stripe Tax): a service of a
 *   supplier established in Ireland, billed without VAT, self-assessed at
 *   20 % (CGI art. 283, 2).
 * - Payouts: an internal transfer (PCG art. 1215-58, compte 58), debited
 *   on the Stripe side and credited on the bank side, so the 58 account
 *   nets to zero once both lines are posted.
 */

import { CREDIT, DEBIT, collectedVatLine, labelMatches, noVatLine, operationTypeMatches, selfAssessedLine, type RuleTemplate } from '../template'
import { SOURCES } from './sources'

const SALE_WHY =
  "Vente au taux normal de 20 % (CGI art. 278), TVA prise sur le montant payé par le client. Vous vendez des biens (707), à un autre taux ou hors de France : changez le compte ou le taux de la règle."

const TRANSFER_WHY = "Un virement entre deux comptes de la société n'est pas une opération soumise à la TVA : il passe par le compte 58 « Virements internes »."

export const STRIPE_TEMPLATES: RuleTemplate[] = [
  {
    id: 'stripe-paiements',
    name: 'Paiements reçus sur Stripe',
    category: 'stripe',
    description: 'Paiements de vos clients sur le compte Stripe, au montant payé (frais à part), en ventes de prestations de services (706).',
    conditions: [CREDIT, operationTypeMatches('^stripe\\.(charge|payment)$', 'Paiement reçu sur le compte Stripe')],
    lines: [collectedVatLine('706')],
    vat: { treatment: 'collected', why: SALE_WHY },
    sources: [SOURCES.standardRate],
    samples: { match: ['Paiement', 'Paiement : Subscription creation'], operationType: 'stripe.charge' },
  },
  {
    id: 'stripe-remboursements',
    name: 'Remboursements Stripe',
    category: 'stripe',
    description: 'Remboursements à vos clients depuis le compte Stripe : ils annulent la vente et sa TVA (706).',
    conditions: [DEBIT, operationTypeMatches('^stripe\\.(refund|payment_refund)$', 'Remboursement depuis le compte Stripe')],
    lines: [collectedVatLine('706', 'debit')],
    vat: { treatment: 'collected', why: `${SALE_WHY} Le remboursement réduit la TVA collectée.` },
    sources: [SOURCES.standardRate],
    samples: { match: ['Remboursement', 'Remboursement : REFUND FOR CHARGE'], operationType: 'stripe.refund' },
  },
  {
    id: 'stripe-commissions',
    name: 'Commissions Stripe',
    category: 'stripe',
    description: 'Commissions que Stripe prend sur chaque paiement, remboursement ou conversion, en frais et commissions (6278).',
    conditions: [DEBIT, operationTypeMatches('^stripe\\.fee$', 'Frais Stripe sur une opération')],
    lines: [noVatLine('6278')],
    vat: {
      treatment: 'none',
      why: "Commissions sur des services de paiement, exonérées (CGI art. 261 C, 1°) : Stripe les facture sans TVA aux comptes français. Si sa facture mensuelle mentionne l'autoliquidation, passez la ligne en TVA intracommunautaire.",
    },
    sources: [SOURCES.bankFees, SOURCES.stripeFees],
    samples: { match: ['Frais Stripe : paiement ch_3QxYz', 'Frais Stripe : remboursement re_3QxYz'], operationType: 'stripe.fee' },
  },
  {
    id: 'stripe-frais-logiciels',
    name: 'Frais des logiciels Stripe',
    category: 'stripe',
    description: 'Frais de Stripe Billing, Radar ou Stripe Tax, prélevés sur le solde Stripe, en frais et commissions (6278).',
    conditions: [DEBIT, operationTypeMatches('^stripe\\.service_fee$', 'Frais des logiciels Stripe')],
    lines: [selfAssessedLine('6278', 'intracom')],
    vat: {
      treatment: 'self-assessed',
      why: "Stripe facture ces services depuis l'Irlande, sans TVA, à une entreprise qui lui a donné son numéro de TVA : la société autoliquide 20 % (CGI art. 283, 2), déductible et due dans la même écriture.",
    },
    sources: [SOURCES.reverseCharge, SOURCES.stripeFees],
    samples: { match: ['Frais Stripe', 'Frais Stripe Tax'], operationType: 'stripe.service_fee' },
  },
  {
    id: 'stripe-virements-sortants',
    name: 'Virements du compte Stripe vers la banque',
    category: 'stripe',
    description: 'Virements du solde Stripe vers votre compte bancaire, côté Stripe : en virements internes (58), soldés par le virement reçu en banque.',
    conditions: [DEBIT, operationTypeMatches('^stripe\\.payout$', 'Virement du compte Stripe vers la banque')],
    lines: [noVatLine('58')],
    vat: { treatment: 'none', why: TRANSFER_WHY },
    sources: [SOURCES.scope],
    samples: { match: ['Virement vers votre banque', 'Virement vers votre banque : STRIPE PAYOUT'], operationType: 'stripe.payout' },
  },
  {
    id: 'stripe-virements-recus',
    name: 'Virements Stripe reçus (compte Stripe connecté)',
    category: 'stripe',
    description:
      'Virements de Stripe reçus sur votre compte bancaire quand le compte Stripe est connecté à Kledg : en virements internes (58), comme le virement côté Stripe.',
    conditions: [CREDIT, labelMatches('\\bstripe\\b', 'STRIPE')],
    lines: [noVatLine('58', 'credit')],
    vat: { treatment: 'none', why: TRANSFER_WHY },
    sources: [SOURCES.scope],
    samples: { match: ['STRIPE', 'VIR SEPA STRIPE PAYMENTS EUROPE'], noMatch: ['CB STRIPES CAFE'] },
  },
]
