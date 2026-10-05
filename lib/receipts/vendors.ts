/**
 * Suppliers whose invoices a small French company often has to fetch
 * itself (SaaS, telecoms, energy, travel, banks), recognised from the bank
 * label of a transaction without receipt (docs/lettrage-et-tiers.md,
 * section Justificatifs).
 *
 * A vendor is recognised by the label pattern of a template of the rules
 * library (`template`, lib/rules-library/catalog), or by its own pattern
 * when no template names it alone (`pattern`, run by the same linear-time
 * matcher, lib/transactions/rule-regex.ts). `within` names the template
 * that recognises the vendor among others (SNCF among trains): its samples
 * must match that template too, checked by the tests.
 *
 * `invoicesUrl` is the official page where a customer downloads its
 * invoices (sign in required), only when the vendor's own help page says
 * so; `source` is that help page. Without a verified page the vendor is
 * still recognised, with no link. Never add a URL that the source does not
 * confirm.
 *
 * Pure module (its only import is a pattern string): the "Proposer avec
 * l'IA" request, on the client, reads the pages of invoices from it.
 */

import { UBER_RIDES_PATTERN } from '@/lib/rules-library/catalog/label-patterns'

export interface ReceiptVendor {
  /** Stable id (kebab-case). */
  id: string
  /** Name shown on the page. */
  name: string
  /** Template of the rules library whose label pattern recognises the vendor. */
  template?: string
  /** Own label pattern, when no template names the vendor alone. */
  pattern?: string
  /** Template that recognises the vendor among others: the samples must match it. */
  within?: string
  /** Bank labels that must be recognised, and close ones that must not. */
  samples: { match: string[]; noMatch?: string[] }
  /** Official page of the invoices of the customer (https, sign in required). */
  invoicesUrl?: string
  /** Official help page of the vendor that gives `invoicesUrl`. */
  source?: string
}

/** First match wins: the narrower vendors come before the broader ones of the same company. */
export const RECEIPT_VENDORS: readonly ReceiptVendor[] = [
  // Software, cloud and SaaS
  {
    id: 'ovhcloud',
    name: 'OVHcloud',
    template: 'ovhcloud',
    samples: { match: ['PRLV SEPA OVH SAS', 'OVHCLOUD.COM ROUBAIX'], noMatch: ['CB MOVHOME'] },
    invoicesUrl: 'https://www.ovh.com/manager/',
    source: 'https://docs.ovhcloud.com/en/guides/account-and-service-management/managing-billing-payments-and-services/invoice-management',
  },
  {
    id: 'google-cloud',
    name: 'Google Cloud',
    pattern: '\\bgoogle\\W*cloud\\b|\\bgcp\\b',
    samples: { match: ['GOOGLE *CLOUD 8XKZ12', 'GOOGLE CLOUD FRANCE SARL'], noMatch: ['GOOGLE *GSUITE_MONDOMAINE', 'CB CLOUDY BAR'] },
    invoicesUrl: 'https://console.cloud.google.com/billing',
    source: 'https://docs.cloud.google.com/billing/docs/how-to/get-invoice',
  },
  {
    id: 'google-workspace',
    name: 'Google Workspace',
    template: 'google-workspace',
    samples: { match: ['GOOGLE *GSUITE_MONDOMAINE', 'Google Workspace'], noMatch: ['GOOGLE *ADS1234567'] },
    invoicesUrl: 'https://admin.google.com/ac/billing/accounts',
    source: 'https://knowledge.workspace.google.com/admin/billing/download-or-print-monthly-invoices',
  },
  {
    id: 'azure',
    name: 'Microsoft Azure',
    pattern: '\\bazure\\b',
    within: 'microsoft',
    samples: { match: ['MICROSOFT*AZURE', 'MSFT * AZURE E0200XYZ'], noMatch: ['MICROSOFT*365 BUSINESS', 'CB COTE D AZUR'] },
    invoicesUrl: 'https://portal.azure.com/',
    source: 'https://learn.microsoft.com/en-us/azure/cost-management-billing/understand/download-azure-invoice',
  },
  {
    id: 'microsoft-365',
    name: 'Microsoft 365',
    template: 'microsoft',
    samples: { match: ['MICROSOFT*365 BUSINESS', 'MSFT * E0100ABCD'], noMatch: ['CB MICROSOFTWARE SHOP'] },
    invoicesUrl: 'https://go.microsoft.com/fwlink/p/?linkid=2102895',
    source: 'https://learn.microsoft.com/en-us/microsoft-365/commerce/billing-and-payments/view-your-bill-or-invoice',
  },
  {
    id: 'aws',
    name: 'Amazon Web Services',
    template: 'aws',
    samples: { match: ['AWS EMEA', 'Amazon Web Services EMEA SARL'], noMatch: ['AMAZON EU SARL'] },
    invoicesUrl: 'https://console.aws.amazon.com/costmanagement/',
    source: 'https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/getting-viewing-bill.html',
  },
  {
    id: 'adobe',
    name: 'Adobe',
    template: 'adobe',
    samples: { match: ['ADOBE *CREATIVE CLOUD', 'Adobe Systems Software Ireland'], noMatch: ['CB ADOBO GRILL'] },
    invoicesUrl: 'https://account.adobe.com/orders',
    source: 'https://helpx.adobe.com/account/individual/billing-and-payments/view-billing-and-invoices/view-download-email-adobe-invoice.html',
  },
  {
    id: 'apple',
    name: 'Apple',
    pattern: '\\bapple\\.com\\b|\\bitunes\\.com\\b',
    samples: { match: ['APPLE.COM/BILL', 'CB APPLE.COM/FR'], noMatch: ['CB PINEAPPLE CAFE', 'APPLEBEES'] },
    invoicesUrl: 'https://reportaproblem.apple.com/',
    source: 'https://support.apple.com/fr-fr/118212',
  },
  { id: 'notion', name: 'Notion', template: 'notion', samples: { match: ['NOTION.SO', 'NOTION LABS INC'], noMatch: ['CB NOTIONS DE COUTURE'] } },
  {
    id: 'slack',
    name: 'Slack',
    pattern: '\\bslack\\b',
    samples: { match: ['SLACK T01ABCDEF', 'Slack Technologies Limited'], noMatch: ['CB SLACKLINE SHOP'] },
    invoicesUrl: 'https://my.slack.com/admin/billing',
    source: 'https://slack.com/help/articles/218915087-Manage-your-Slack-plan-and-billing-details',
  },
  {
    id: 'zoom',
    name: 'Zoom',
    pattern: '\\bzoom\\.(us|com)\\b|\\bzoom (video|communications)\\b',
    samples: { match: ['ZOOM.US 888-799-9666', 'Zoom Video Communications'], noMatch: ['CB ZOOM PHOTO STUDIO'] },
    invoicesUrl: 'https://zoom.us/billing',
    source: 'https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0063038',
  },
  {
    id: 'canva',
    name: 'Canva',
    template: 'canva',
    samples: { match: ['CANVA* 04012345', 'Canva Pty Ltd'], noMatch: ['CB CANVAS PEINTURE'] },
    invoicesUrl: 'https://www.canva.com/settings/purchase-history',
    source: 'https://www.canva.com/help/access-invoices/',
  },
  {
    id: 'openai',
    name: 'OpenAI (ChatGPT)',
    template: 'openai',
    samples: { match: ['OPENAI *CHATGPT SUBSCR', 'OpenAI'], noMatch: ['CB OPEN AIR PARIS'] },
    invoicesUrl: 'https://chatgpt.com/#settings/Account',
    source: 'https://help.openai.com/en/articles/12356340-how-can-i-find-my-past-chatgpt-invoices',
  },
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    template: 'anthropic',
    samples: { match: ['ANTHROPIC', 'CLAUDE.AI SUBSCRIPTION'], noMatch: ['VIR SEPA CLAUDE MARTIN'] },
    invoicesUrl: 'https://claude.ai/settings/billing',
    source: 'https://support.claude.com/en/articles/16607638-understanding-your-pro-or-max-plan-invoices',
  },
  {
    id: 'github',
    name: 'GitHub',
    template: 'github',
    samples: { match: ['GITHUB, INC.', 'GITHUB SPONSORS'], noMatch: ['CB GITHOUSE'] },
    invoicesUrl: 'https://github.com/settings/billing',
    source: 'https://docs.github.com/en/billing/get-started/introduction-to-billing',
  },
  {
    id: 'vercel',
    name: 'Vercel',
    pattern: '\\bvercel\\b',
    samples: { match: ['VERCEL INC.', 'CB VERCEL* PRO'], noMatch: ['CB VERCELLI PIZZA'] },
    invoicesUrl: 'https://vercel.com/dashboard',
    source: 'https://vercel.com/docs/pricing/understanding-my-invoice',
  },
  { id: 'netlify', name: 'Netlify', pattern: '\\bnetlify\\b', samples: { match: ['NETLIFY', 'CB NETLIFY INC'], noMatch: ['CB NETFLIX.COM'] } },

  // Telecoms
  {
    id: 'free-mobile',
    name: 'Free Mobile',
    pattern: '\\bfree mobile\\b',
    within: 'free',
    samples: { match: ['PRLV SEPA FREE MOBILE', 'FREE MOBILE 0612345678'], noMatch: ['FREE TELECOM'] },
    invoicesUrl: 'https://mobile.free.fr/account/',
    source: 'https://assistance.free.fr/articles/consulter-mes-factures-forfait-mobile-931',
  },
  {
    id: 'free',
    name: 'Free',
    template: 'free',
    samples: { match: ['FREE TELECOM', 'PRLV SEPA FREEBOX'], noMatch: ['FREENOW PARIS'] },
    invoicesUrl: 'https://moncompte.free.fr/',
    source: 'https://assistance.free.fr/articles/consulter-mes-factures-freebox-298',
  },
  {
    id: 'orange',
    name: 'Orange',
    template: 'orange',
    samples: { match: ['PRLV SEPA ORANGE SA', 'ORANGE PRO'], noMatch: ['CB ORANGINA'] },
    invoicesUrl: 'https://espaceclientpro.orange.fr/',
    source: 'https://assistancepro.orange.fr/facture/consulter_ma_facture/espace_client_pro__consulter_vos_factures_clients_internet_open_pro_fixe_ou_mobile_orange_business-396474',
  },
  {
    id: 'sfr',
    name: 'SFR',
    template: 'sfr',
    samples: { match: ['PRLV SEPA SFR', 'SFR BUSINESS'], noMatch: ['CB SFRANCE'] },
    invoicesUrl: 'https://www.sfrbusiness.fr/espace-client/authentification/',
    source: 'https://www.sfrbusiness.fr/assistance/factures/duplicata-facture.html',
  },
  {
    id: 'bouygues-telecom',
    name: 'Bouygues Telecom',
    template: 'bouygues-telecom',
    samples: { match: ['PRLV SEPA BOUYGUES TELECOM', 'B&YOU'], noMatch: ['BOUYGUES IMMOBILIER'] },
    invoicesUrl: 'https://www.espaceclient.bouyguestelecom-entreprises.fr/auth/login',
    source: 'https://www.bouyguestelecom-entreprises.fr/assistance/espace-client-gestionnaire/facture',
  },

  // Energy
  {
    id: 'edf',
    name: 'EDF',
    template: 'edf',
    samples: { match: ['PRLV SEPA EDF ENTREPRISES', 'EDF PRO'], noMatch: ['CB EDFI'] },
    invoicesUrl: 'https://entreprises-collectivites.edf.fr/',
    source: 'https://www.edf.fr/entreprises/faq/facture/comprendre-gerer/comment-obtenir-un-duplicata-de-votre-facture-edf-entreprises',
  },
  {
    id: 'engie',
    name: 'Engie',
    template: 'engie',
    samples: { match: ['PRLV SEPA ENGIE', 'ENGIE PRO'], noMatch: ['CB ENGIES'] },
    invoicesUrl: 'https://espace-client.pro.engie.fr/user/auth?destination=/mes-factures',
    source: 'https://pro.engie.fr/faq/espace-client/gestion/historique-factures',
  },
  {
    id: 'totalenergies-electricite',
    name: 'TotalEnergies (électricité et gaz)',
    pattern: '\\btotal\\s?energies (electricite|gaz|power)\\b',
    samples: { match: ['PRLV SEPA TOTALENERGIES ELECTRICITE ET GAZ FRANCE', 'TOTAL ENERGIES GAZ'], noMatch: ['TOTALENERGIES RELAIS A6', 'CB TOTAL MKT FR 12/03'] },
    invoicesUrl: 'https://www.totalenergies.fr/clients/connexion',
    source: 'https://www.totalenergies.fr/professionnels/aide-et-contacts/une-facture-un-paiement',
  },

  // Travel
  {
    id: 'sncf-connect',
    name: 'SNCF Connect',
    pattern: '\\bsncf\\b',
    within: 'train',
    samples: { match: ['SNCF CONNECT', 'CB SNCF INTERNET'], noMatch: ['CB OUIGO', 'TRAINLINE.FR'] },
    invoicesUrl: 'https://www.sncf-connect.com/account',
    source: 'https://www.sncf-connect.com/aide/vos-justificatifs-de-voyage',
  },
  {
    id: 'uber',
    name: 'Uber',
    pattern: UBER_RIDES_PATTERN,
    within: 'taxi-vtc',
    samples: { match: ['UBER *TRIP HELP.UBER.COM', 'UBER BV'], noMatch: ['UBER EATS PARIS', 'TAXI G7'] },
    invoicesUrl: 'https://business.uber.com/',
    source: 'https://help.uber.com/en/business/article/t%C3%A9l%C3%A9charger-des-factures?nodeId=909e9a84-6b6d-48ad-af0b-55f2cbc8a4d5',
  },
  { id: 'air-france', name: 'Air France', pattern: '\\bair france\\b', within: 'avion', samples: { match: ['AIR FRANCE 0571234567890', 'CB AIR FRANCE KLM'], noMatch: ['CB EASYJET', 'CB AIR FRANCAIS DECO'] } },
  { id: 'booking', name: 'Booking.com', pattern: '\\bbooking\\.com\\b', within: 'hotel', samples: { match: ['BOOKING.COM AMSTERDAM', 'CB HOTEL AT BOOKING.COM'], noMatch: ['CB IBIS PARIS'] } },

  // Purchases and post
  {
    id: 'amazon',
    name: 'Amazon.fr',
    template: 'amazon',
    samples: { match: ['AMAZON EU SARL', 'AMZN MKTP FR'], noMatch: ['AMAZON WEB SERVICES EMEA'] },
    invoicesUrl: 'https://www.amazon.fr/gp/css/order-history',
    source: 'https://www.amazon.fr/gp/help/customer/display.html?nodeId=GRPUHK7RCNVRBURD',
  },
  {
    id: 'la-poste',
    name: 'La Poste',
    template: 'la-poste',
    samples: { match: ['CB LA POSTE PARIS LOUVRE', 'COLISSIMO'], noMatch: ['CB AFFICHE POSTER'] },
    invoicesUrl: 'https://www.laposte.fr/professionnel/espaceclient/achats',
    source: 'https://aide.laposte.fr/professionnel/contenu/comment-acceder-telecharger-et-imprimer-mes-factures-depuis-mon-espace-client-pro',
  },

  // Banks and payments
  { id: 'qonto', name: 'Qonto (frais bancaires)', template: 'qonto-frais', samples: { match: ['Frais Qonto - Abonnement Essential', 'QONTO SUBSCRIPTION'], noMatch: ['CB QONTOPIA SHOP'] } },
  { id: 'shine', name: 'Shine (frais bancaires)', template: 'shine-frais', samples: { match: ['SHINE', 'Abonnement Shine Basic'], noMatch: ['CB SHINERAY'] } },
  {
    id: 'stripe',
    name: 'Stripe',
    template: 'stripe-virements',
    samples: { match: ['STRIPE', 'VIR SEPA STRIPE PAYMENTS EUROPE'], noMatch: ['CB STRIPES CAFE'] },
    invoicesUrl: 'https://dashboard.stripe.com/settings/plans-and-fees/plans',
    source: 'https://support.stripe.com/questions/download-tax-invoices-for-stripe-fees',
  },
  { id: 'paypal', name: 'PayPal', pattern: '\\bpaypal\\b', samples: { match: ['PAYPAL *MONFOURNISSEUR', 'PayPal Europe S.a.r.l.'], noMatch: ['CB PAYPALACE'] } },
]

const byId = new Map(RECEIPT_VENDORS.map((v) => [v.id, v]))

export function receiptVendorById(id: string | null | undefined): ReceiptVendor | undefined {
  return id ? byId.get(id) : undefined
}
