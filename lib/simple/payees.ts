/**
 * Built-in dictionary of common French payees and label keywords, for the
 * simple mode suggestions (docs/categories-simples.md). Pure.
 *
 * A bank line is read as the whole words of its counterparty and label
 * (accents removed, uppercase, letters and digits: `words` of
 * lib/subscriptions/detect.ts, the payee normalization of the subscriptions
 * detection). An entry matches when one of its word sequences appears, and
 * the extra words it requires (`with`) too. Of the entries that match, the
 * one with a `with` condition wins, then the longest sequence ("GOOGLE ADS"
 * before "GOOGLE"), then list order: the result never depends on anything
 * but the text.
 *
 * Each entry gives the category for money out and for money in. Undefined:
 * the entry does not apply to that side (a Stripe payout is a sale, a Stripe
 * debit its fees). Null: the payee is recognised but what was paid is not
 * known (Amazon, PayPal, a tax without detail): no category is invented, the
 * line stays "à classer" with a hint.
 *
 * Social and tax payees are routed by the words that name the contribution
 * or the tax: URSSAF of the self-employed to the director's contributions,
 * URSSAF alone to the employees' charges; DGFIP with TVA to the VAT paid,
 * with IS to the corporate tax, with CFE to the local taxes, with PAS to the
 * withholding tax of employees.
 */

import { counterpartyKey, words } from '@/lib/subscriptions/detect'

type PayeeConfidence = 'high' | 'medium'

export interface PayeeEntry {
  /** Word sequences naming the payee or the keyword (normalized at load). */
  match: string[]
  /** Any of these sequences must appear too. */
  with?: string[]
  /** Name shown in the reason ("Reconnu : SNCF"). */
  name: string
  debit?: string | null
  credit?: string | null
  confidence: PayeeConfidence
  /** Shown when the category is null: what the user should tell. */
  hint?: string
}

const TAX_OFFICE = ['DGFIP', 'IMPOTS', 'IMPOT', 'TRESOR PUBLIC', 'FINANCES PUBLIQUES', 'DIRECTION GENERALE DES FINANCES PUBLIQUES', 'SIE']
const URSSAF = ['URSSAF']

/** Payees: brands and bodies a bank label names. */
export const PAYEES: readonly PayeeEntry[] = [
  // Taxes and social bodies, routed by what the label says
  { match: TAX_OFFICE, with: ['TVA', 'CA3', 'CA12'], name: 'impôts, TVA', debit: 'tva-payee', confidence: 'high' },
  { match: TAX_OFFICE, with: ['IS', 'IMPOT SOCIETES', 'IMPOT SUR LES SOCIETES', 'ACOMPTE IS', 'SOLDE IS'], name: 'impôts, impôt sur les sociétés', debit: 'impot-societes', credit: 'impot-societes', confidence: 'high' },
  { match: TAX_OFFICE, with: ['CFE', 'CVAE', 'TAXE FONCIERE', 'TAXES FONCIERES'], name: 'impôts, taxes locales', debit: 'impots-taxes', confidence: 'high' },
  { match: TAX_OFFICE, with: ['PAS', 'PRELEVEMENT A LA SOURCE', 'RETENUE A LA SOURCE'], name: 'impôts, prélèvement à la source', debit: 'prelevement-source', confidence: 'high' },
  { match: TAX_OFFICE, with: ['TVA', 'CREDIT TVA', 'CREDIT DE TVA', 'REMBOURSEMENT TVA', 'REMBOURSEMENT CREDIT TVA'], name: 'impôts, remboursement de TVA', credit: 'remboursement-tva', confidence: 'high' },
  { match: TAX_OFFICE, name: 'impôts', debit: null, confidence: 'medium', hint: 'Paiement aux impôts : précisez lequel (TVA, impôt sur les sociétés, CFE).' },
  { match: TAX_OFFICE, name: 'impôts', credit: null, confidence: 'medium', hint: 'Versement des impôts : précisez lequel (remboursement de TVA, d’impôt sur les sociétés).' },
  { match: ['ANTAI'], name: 'amende (ANTAI)', debit: 'amendes', confidence: 'high' },
  { match: URSSAF, with: ['INDEPENDANT', 'INDEPENDANTS', 'TI', 'SSI', 'CPSTI', 'TNS', 'AUTO ENTREPRENEUR', 'MICRO ENTREPRENEUR'], name: 'URSSAF des indépendants', debit: 'cotisations-dirigeant', confidence: 'high' },
  { match: URSSAF, name: 'URSSAF', debit: 'charges-sociales', confidence: 'medium' },
  { match: ['CIPAV', 'CARMF', 'CARPIMKO', 'CAVEC', 'CNBF', 'CAVP', 'CARCDSF', 'CAVAMAC', 'CAVOM'], name: 'caisse de retraite des indépendants', debit: 'cotisations-dirigeant', confidence: 'high' },
  { match: ['AGIRC', 'ARRCO', 'AGIRC ARRCO'], name: 'retraite complémentaire', debit: 'retraite-salaries', confidence: 'high' },
  { match: ['ALAN', 'ALAN SA'], name: 'Alan', debit: 'mutuelle', confidence: 'medium' },
  { match: ['MALAKOFF', 'AG2R', 'HARMONIE MUTUELLE', 'MGEN', 'APICIL', 'KLESIA', 'HUMANIS'], name: 'mutuelle et prévoyance', debit: 'mutuelle', confidence: 'medium' },

  // Telecom
  { match: ['FREE', 'FREE PRO', 'FREE MOBILE', 'FREE TELECOM', 'FREEBOX', 'ORANGE', 'SOSH', 'SFR', 'RED BY SFR', 'BOUYGUES TELECOM', 'BOUYGUES TEL', 'B YOU', 'NRJ MOBILE', 'LA POSTE MOBILE', 'PRIXTEL', 'CORIOLIS', 'OVH TELECOM'], name: 'opérateur télécom', debit: 'telephone-internet', confidence: 'high' },

  // Software, hosting, advertising (longer sequences win over the brand alone)
  { match: ['GOOGLE ADS', 'GOOGLE ADWORDS', 'FACEBK', 'FACEBOOK ADS', 'META ADS', 'META PLATFORMS', 'TIKTOK ADS', 'BING ADS', 'MICROSOFT ADS', 'LINKEDIN ADS', 'LINKEDIN MARKETING', 'SNAPCHAT ADS', 'PINTEREST ADS'], name: 'régie publicitaire', debit: 'publicite', confidence: 'high' },
  { match: ['VISTAPRINT', 'HELLOPRINT', 'PRINTOCLOCK', 'EXAPRINT', 'MOO PRINT'], name: 'imprimeur en ligne', debit: 'publicite', confidence: 'high' },
  { match: ['GOOGLE CLOUD', 'AMAZON WEB SERVICES', 'AWS', 'OVH', 'OVHCLOUD', 'SCALEWAY', 'GANDI', 'IONOS', 'O2SWITCH', 'HOSTINGER', 'CLOUDFLARE', 'VERCEL', 'NETLIFY', 'HEROKU', 'DIGITALOCEAN', 'HETZNER', 'NAMECHEAP', 'GODADDY', 'INFOMANIAK', 'PLANETHOSTER'], name: 'hébergeur', debit: 'hebergement-web', confidence: 'high' },
  { match: ['ADOBE', 'MICROSOFT', 'MSFT', 'OFFICE 365', 'GOOGLE WORKSPACE', 'GSUITE', 'NOTION', 'SLACK', 'ZOOM', 'CANVA', 'FIGMA', 'GITHUB', 'ATLASSIAN', 'DROPBOX', 'OPENAI', 'CHATGPT', 'ANTHROPIC', 'CLAUDE AI', 'MISTRAL AI', 'SHOPIFY', 'WIX', 'SQUARESPACE', 'WEBFLOW', 'MAILCHIMP', 'BREVO', 'SENDINBLUE', 'HUBSPOT', 'SALESFORCE', 'PIPEDRIVE', 'DOCUSIGN', 'YOUSIGN', 'INTERCOM', 'AIRTABLE', 'CALENDLY', '1PASSWORD', 'JETBRAINS', 'MIRO', 'LOOM', 'TRELLO', 'MONDAY COM', 'ASANA', 'AXONAUT', 'PENNYLANE', 'SELLSY', 'SWILE', 'PAYFIT', 'LUCCA', 'SPENDESK', 'TYPEFORM', 'ZAPIER', 'MAKE COM', 'DEEPL', 'GRAMMARLY', 'LASTPASS', 'NORDVPN', 'WETRANSFER'], name: 'éditeur de logiciel', debit: 'logiciels', confidence: 'high' },
  { match: ['GOOGLE', 'APPLE COM BILL', 'ITUNES', 'LINKEDIN'], name: 'abonnement en ligne', debit: 'logiciels', confidence: 'medium' },

  // Equipment and supplies
  { match: ['APPLE STORE', 'APPLE RETAIL', 'LDLC', 'MATERIEL NET', 'BACK MARKET', 'BACKMARKET', 'DELL', 'LENOVO', 'GROSBILL', 'TOP ACHAT', 'RUE DU COMMERCE'], name: 'matériel informatique', debit: 'materiel-informatique', confidence: 'high' },
  { match: ['FNAC', 'DARTY', 'BOULANGER'], name: 'électronique', debit: 'materiel-informatique', confidence: 'medium' },
  { match: ['BUREAU VALLEE', 'OFFICE DEPOT', 'JPG', 'LYRECO', 'CLUB BURO', 'MANUTAN'], name: 'fournitures de bureau', debit: 'fournitures', confidence: 'high' },
  { match: ['RAJA'], name: 'emballages', debit: 'emballages', confidence: 'high' },
  { match: ['IKEA'], name: 'IKEA', debit: 'mobilier', confidence: 'medium' },
  { match: ['LEROY MERLIN', 'CASTORAMA', 'BRICOMARCHE', 'BRICO DEPOT', 'MANOMANO', 'WURTH', 'POINT P'], name: 'bricolage', debit: 'outillage', confidence: 'medium' },
  { match: ['AMAZON', 'AMZN', 'CDISCOUNT', 'ALIEXPRESS', 'TEMU'], name: 'vente en ligne', debit: null, confidence: 'medium', hint: 'Achat en ligne : choisissez ce que vous avez acheté.' },

  // Transport and travel
  { match: ['UBER EATS', 'DELIVEROO', 'JUST EAT'], name: 'livraison de repas', debit: 'repas-affaires', confidence: 'medium' },
  { match: ['SNCF', 'SNCF CONNECT', 'OUIGO', 'TGV', 'TGV INOUI', 'TRAINLINE', 'AIR FRANCE', 'EASYJET', 'RYANAIR', 'TRANSAVIA', 'VUELING', 'LUFTHANSA', 'UBER', 'BOLT', 'HEETCH', 'G7', 'BLABLACAR', 'RATP', 'NAVIGO', 'FLIXBUS', 'EUROSTAR', 'MARCEL CAB', 'FREE NOW'], name: 'transport', debit: 'deplacements', confidence: 'high' },
  { match: ['BOOKING COM', 'HOTELS COM', 'IBIS', 'ACCOR', 'ALL ACCOR', 'NOVOTEL', 'MERCURE', 'B B HOTEL', 'CAMPANILE', 'KYRIAD', 'PREMIERE CLASSE', 'HOLIDAY INN', 'BEST WESTERN'], name: 'hôtel', debit: 'hotel', confidence: 'high' },
  { match: ['AIRBNB', 'EXPEDIA'], name: 'réservation de voyage', debit: 'hotel', confidence: 'medium' },
  { match: ['TOTALENERGIES ELECTRICITE', 'TOTALENERGIES ELEC', 'TOTAL DIRECT ENERGIE', 'DIRECT ENERGIE', 'EDF', 'ENGIE', 'EKWATEUR', 'MINT ENERGIE', 'OHM ENERGIE', 'ENERCOOP', 'VATTENFALL', 'PLANETE OUI', 'GRDF', 'VEOLIA', 'SUEZ', 'SAUR', 'EAU DE PARIS'], name: 'fournisseur d’énergie', debit: 'energie', confidence: 'high' },
  { match: ['TOTAL', 'TOTALENERGIES', 'TOTAL ACCESS', 'ESSO', 'SHELL', 'AVIA', 'AGIP', 'AS24', 'DYNEFF', 'STATION SERVICE'], name: 'station-service', debit: 'carburant', confidence: 'high' },
  { match: ['VINCI AUTOROUTES', 'VINCI AUTOROUTE', 'SANEF', 'APRR', 'ASF', 'ESCOTA', 'AREA', 'COFIROUTE', 'BIP GO', 'ULYS', 'INDIGO', 'SAEMES', 'EFFIA', 'ONEPARK', 'ZENPARK', 'Q PARK', 'PAYBYPHONE'], name: 'péage ou parking', debit: 'peages-parking', confidence: 'high' },
  { match: ['NORAUTO', 'MIDAS', 'SPEEDY', 'FEU VERT', 'POINT S', 'EUROMASTER', 'DEKRA', 'AUTOSUR', 'SECURITEST'], name: 'garage', debit: 'entretien-vehicule', confidence: 'high' },
  { match: ['HERTZ', 'AVIS', 'EUROPCAR', 'SIXT', 'ADA', 'UCAR', 'LEASYS', 'ALD AUTOMOTIVE', 'AYVENS', 'ARVAL', 'FREE2MOVE'], name: 'loueur de véhicules', debit: 'location-vehicule', confidence: 'high' },

  // Delivery and post
  { match: ['COLISSIMO', 'CHRONOPOST', 'DHL', 'UPS', 'FEDEX', 'MONDIAL RELAY', 'BOXTAL', 'SENDCLOUD', 'DPD', 'GLS', 'RELAIS COLIS', 'STUART'], name: 'transporteur', debit: 'livraisons', confidence: 'high' },
  { match: ['LA POSTE'], name: 'La Poste', debit: 'courrier', confidence: 'medium' },

  // Insurance
  { match: ['AXA', 'ALLIANZ', 'MAAF', 'MACIF', 'MMA', 'GENERALI', 'HISCOX', 'MAIF', 'GROUPAMA', 'MATMUT', 'SWISSLIFE', 'SWISS LIFE', 'ABEILLE', 'AVIVA', 'MACSF', 'SMABTP', 'STELLO', 'AMV', 'APRIL', 'LEOCARE', 'ORUS', 'ACHEEL'], name: 'assureur', debit: 'assurances', credit: 'indemnites-recues', confidence: 'high' },

  // Banks and payments
  { match: ['QONTO', 'SHINE', 'MANAGER ONE', 'BLANK'], name: 'banque en ligne', debit: 'frais-bancaires', confidence: 'high' },
  { match: ['STRIPE', 'SUMUP', 'PAYPLUG', 'MOLLIE', 'GOCARDLESS', 'ADYEN', 'LYRA', 'ZETTLE', 'SQUARE'], name: 'prestataire de paiement', debit: 'commissions-paiement', credit: 'ventes-prestations', confidence: 'medium' },
  { match: ['PAYPAL'], name: 'PayPal', debit: null, credit: 'ventes-prestations', confidence: 'medium', hint: 'Paiement PayPal : choisissez ce que vous avez acheté.' },
  { match: ['BPIFRANCE', 'BPI FRANCE', 'BPI'], with: ['SUBVENTION', 'AIDE', 'BOURSE FRENCH TECH', 'BFT', 'AIDE INNOVATION'], name: 'Bpifrance, aide', credit: 'subvention', confidence: 'high' },
  { match: ['BPIFRANCE', 'BPI FRANCE', 'BPI'], with: ['PRET', 'DEBLOCAGE', 'PRET AMORCAGE', 'PRET D AMORCAGE', 'PGE'], name: 'Bpifrance, prêt', credit: 'emprunt-recu', confidence: 'high' },
  { match: ['BPIFRANCE', 'BPI FRANCE'], name: 'Bpifrance', debit: 'remboursement-emprunt', credit: null, confidence: 'medium', hint: 'Versement de Bpifrance : précisez s’il s’agit d’un prêt ou d’une subvention.' },

  // Public bodies that pay operating aid: family allowance funds (crèches),
  // the agency paying hiring and apprenticeship aid, the employment agency
  { match: ['CAF', 'CAISSE D ALLOCATIONS FAMILIALES', 'CNAF'], name: 'CAF', credit: 'subvention', confidence: 'medium' },
  { match: ['ASP', 'AGENCE DE SERVICES ET DE PAIEMENT', 'AGENCE SERVICES PAIEMENT'], name: 'Agence de services et de paiement', credit: 'subvention', confidence: 'high' },
  { match: ['FRANCE TRAVAIL', 'POLE EMPLOI', 'AGEFIPH'], name: 'aide à l’emploi', credit: 'subvention', confidence: 'medium' },
  { match: ['CONSEIL REGIONAL', 'REGION'], with: ['SUBVENTION', 'AIDE'], name: 'région', credit: 'subvention', confidence: 'high' },

  // Services
  { match: ['INFOGREFFE', 'GREFFE', 'LEGALSTART', 'LEGALPLACE', 'CAPTAIN CONTRAT', 'INPI', 'ANNONCES LEGALES', 'BODACC', 'JOURNAL OFFICIEL'], name: 'formalités', debit: 'formalites', confidence: 'high' },
  { match: ['WEWORK', 'MORNING', 'KWERK', 'REGUS', 'SPACES', 'SEDOMICILIER', 'KANDBAZ', 'DOMICILIATION'], name: 'espace de travail', debit: 'coworking', confidence: 'medium' },
  { match: ['WELCOME TO THE JUNGLE', 'INDEED', 'HELLOWORK', 'APEC'], name: 'recrutement', debit: 'recrutement', confidence: 'high' },
  { match: ['ADECCO', 'MANPOWER', 'RANDSTAD', 'SYNERGIE', 'START PEOPLE', 'PROMAN', 'CRIT INTERIM'], name: 'agence d’intérim', debit: 'interim', confidence: 'high' },
  { match: ['MALT', 'CREME DE LA CREME', 'COMET', 'UPWORK', 'FIVERR'], name: 'plateforme de freelances', debit: 'sous-traitance', confidence: 'medium' },
]

/** Keywords of bank labels: weaker than a payee, they say what kind of payment it is. */
export const KEYWORDS: readonly PayeeEntry[] = [
  { match: ['AGIOS', 'INTERETS DEBITEURS'], name: 'agios', debit: 'agios', confidence: 'high' },
  { match: ['RETRAIT DAB', 'RETRAIT', 'DAB'], name: 'retrait', debit: 'retrait-especes', confidence: 'high' },
  { match: ['VIR INTERNE', 'VIREMENT INTERNE', 'TRANSFERT INTERNE', 'VERS COMPTE EPARGNE'], name: 'virement interne', debit: 'virement-interne', credit: 'virement-interne', confidence: 'high' },
  { match: ['LIBERATION CAPITAL', 'LIBERATION DU CAPITAL', 'DEPOT DE CAPITAL', 'APPORT CAPITAL', 'APPORT EN CAPITAL'], name: 'capital', credit: 'apport-capital', confidence: 'high' },
  { match: ['DEBLOCAGE PRET', 'DEBLOCAGE'], name: 'déblocage de prêt', credit: 'emprunt-recu', confidence: 'high' },
  { match: ['MEDECINE DU TRAVAIL', 'SANTE AU TRAVAIL', 'SPSTI'], name: 'médecine du travail', debit: 'medecine-travail', confidence: 'high' },
  { match: ['COTISATION CARTE', 'COTIS CARTE', 'FRAIS TENUE', 'FRAIS DE TENUE', 'COMMISSION INTERVENTION', 'COM INTERVENTION', 'FRAIS BANCAIRES', 'FRAIS', 'COMMISSION', 'COMMISSIONS'], name: 'frais', debit: 'frais-bancaires', confidence: 'medium' },
  { match: ['ECHEANCE PRET', 'ECH PRET', 'REMBOURSEMENT PRET', 'PRET'], name: 'prêt', debit: 'remboursement-emprunt', confidence: 'medium' },
  { match: ['LOYER'], name: 'loyer', debit: 'loyer', confidence: 'medium' },
  { match: ['SALAIRE', 'SALAIRES', 'PAIE'], name: 'salaire', debit: 'salaires', confidence: 'medium' },
  { match: ['ASSURANCE', 'ASSUR'], name: 'assurance', debit: 'assurances', confidence: 'medium' },
  { match: ['PEAGE', 'AUTOROUTE', 'PARKING', 'STATIONNEMENT'], name: 'péage ou parking', debit: 'peages-parking', confidence: 'medium' },
  { match: ['CARBURANT', 'ESSENCE', 'GAZOLE', 'CARBU'], name: 'carburant', debit: 'carburant', confidence: 'medium' },
  { match: ['HOTEL'], name: 'hôtel', debit: 'hotel', confidence: 'medium' },
  { match: ['RESTAURANT', 'RESTO', 'BRASSERIE', 'BISTROT', 'BISTRO', 'TRAITEUR', 'PIZZERIA', 'CREPERIE', 'SUSHI', 'BURGER', 'MCDONALDS', 'STARBUCKS'], name: 'restaurant', debit: 'repas-affaires', confidence: 'medium' },
  { match: ['TAXI', 'VTC'], name: 'taxi', debit: 'deplacements', confidence: 'medium' },
  { match: ['FORMATION'], name: 'formation', debit: 'formation', confidence: 'medium' },
  { match: ['HONORAIRES'], name: 'honoraires', debit: 'honoraires', confidence: 'medium' },
  { match: ['DIVIDENDES', 'DIVIDENDE'], name: 'dividendes', debit: 'dividendes', confidence: 'medium' },
  { match: ['COMPTE COURANT', 'APPORT EN COMPTE COURANT', 'APPORT ASSOCIE'], name: 'compte courant', debit: 'compte-courant-associe', credit: 'compte-courant-associe', confidence: 'medium' },
  { match: ['SUBVENTION', 'AIDE A L EMBAUCHE', 'AIDE EMBAUCHE', 'AIDE APPRENTISSAGE', 'AIDE A L APPRENTISSAGE'], name: 'subvention', credit: 'subvention', confidence: 'medium' },
  { match: ['INDEMNITE', 'INDEMNISATION', 'SINISTRE'], name: 'indemnité', credit: 'indemnites-recues', confidence: 'medium' },
  { match: ['INTERETS CREDITEURS', 'INTERETS CREDIT', 'REMUNERATION DU COMPTE', 'INTERETS LIVRET'], name: 'intérêts créditeurs', credit: 'interets-recus', confidence: 'high' },
  { match: ['INTERETS'], name: 'intérêts', credit: 'interets-recus', confidence: 'medium' },
  { match: ['VERSEMENT ESPECES', 'DEPOT ESPECES', 'REMISE ESPECES', 'VERSEMENT D ESPECES', 'DEPOT D ESPECES'], name: 'dépôt d’espèces', credit: 'depot-especes', confidence: 'high' },
  { match: ['DEPOT DE GARANTIE', 'RESTITUTION CAUTION', 'REMBOURSEMENT CAUTION', 'RESTITUTION DEPOT'], name: 'dépôt de garantie', credit: 'depot-garantie-rendu', confidence: 'medium' },
  { match: ['REMISE CHEQUE', 'REMISE DE CHEQUE', 'REMISE CHEQUES', 'REM CHQ', 'REMISE CHQ', 'DEPOT CHEQUE'], name: 'remise de chèque', credit: null, confidence: 'medium', hint: 'Remise de chèque : choisissez ce qu’il paie (une vente, une facture).' },
]

/**
 * Words of a bank label that announce a refund: a supplier gives money back
 * (REMBOURSEMENT SNCF, AVOIR AMAZON, REFUND STRIPE).
 */
const REFUND_WORDS: readonly string[] = ['REMBOURSEMENT', 'REMBT', 'REMB', 'RBT', 'AVOIR', 'REFUND', 'RETOUR', 'ANNULATION']

/** Whether the text of a bank line (bankText) announces a refund. */
export function announcesRefund(text: string): boolean {
  return REFUND_WORDS.some((w) => text.includes(` ${w} `))
}

export interface DictionaryMatch {
  entry: PayeeEntry
  /** The sequence found, as normalized. */
  matched: string
  /** The category for this side, null when recognised without one. */
  categoryId: string | null
}

/**
 * Words of a text for matching, letters and digits split apart: card
 * labels glue references to names ("GOOGLE*ADS1234567"). Patterns go
 * through the same split ("G7" is "G 7" on both sides).
 */
function tokens(text: string): string[] {
  return words(text).flatMap((w) => w.split(/(?<=[A-Z])(?=\d)|(?<=\d)(?=[A-Z])/))
}

/** The text of a bank line as whole words between spaces, for whole-word sequence search. */
export function bankText(counterpartyName: string | null, label: string | null): string {
  return ` ${tokens(`${counterpartyName ?? ''} ${label ?? ''}`).join(' ')} `
}

const normalized = (sequence: string) => tokens(sequence).join(' ')
const contains = (text: string, sequence: string) => {
  const s = normalized(sequence)
  return s.length > 0 && text.includes(` ${s} `)
}

/** The best entry of `entries` for a bank line on a side, or null (see the module header for the order). */
export function matchDictionary(entries: readonly PayeeEntry[], text: string, side: 'debit' | 'credit'): DictionaryMatch | null {
  let best: { match: DictionaryMatch; score: number } | null = null
  for (const entry of entries) {
    const categoryId = side === 'debit' ? entry.debit : entry.credit
    if (categoryId === undefined) continue
    const found = entry.match.filter((m) => contains(text, m)).sort((a, b) => normalized(b).split(' ').length - normalized(a).split(' ').length)[0]
    if (!found) continue
    if (entry.with && !entry.with.some((w) => contains(text, w))) continue
    const score = (entry.with ? 100 : 0) + normalized(found).split(' ').length
    if (!best || score > best.score) best = { match: { entry, matched: normalized(found), categoryId }, score }
  }
  return best?.match ?? null
}

/**
 * Name of the payee shown to the user: the bank's counterparty name, else
 * the counterparty key of the label (lib/subscriptions/detect.ts) in title
 * case ("PRLV SEPA FREE PRO" -> "Free Pro"), else the label.
 */
export function displayNameOf(counterpartyName: string | null, label: string | null): string {
  if (counterpartyName?.trim()) return counterpartyName.trim()
  const key = counterpartyKey(null, label)
  if (!key) return label?.trim() || 'Opération bancaire'
  return key
    .toLowerCase()
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}
