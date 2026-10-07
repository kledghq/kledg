/**
 * Catalogue of the plain language categories of simple mode
 * (docs/categories-simples.md). Pure module: the "Dépenses à vérifier" page,
 * the suggestion engine, the confirmation service and the MCP tools share it.
 *
 * Each category names what a person who does not know accounting
 * recognises ("Téléphone et internet"), and maps it to:
 * - the PCG 2026 account of the chart Kledg seeds (lib/accounting/pcg-data.ts:
 *   accounts of four digits at most, plus 44562, 44566 and 44571); the entry
 *   uses that account, or the closest one of the company's chart
 *   (lib/simple/accounts.ts);
 * - the default VAT rate of the operation in basis points (2000 = 20 %),
 *   replaced by the VAT the bank read on the receipt when it gives one;
 * - the VAT recovery rule (lib/expense-reports/vat-recovery.ts gives the
 *   sources): standard, passenger transport, staff lodging, fuel 80 %,
 *   gifts, none (no VAT on the operation) and passenger vehicles.
 *
 * Categories that cannot be booked without knowing more ask one question,
 * in plain words, and each answer says which account and VAT rule apply:
 * - durable equipment above the 500 € HT tolerance (BOI-BIC-CHG-20-30-10,
 *   § 1 to 30: small equipment of a unit value of 500 € HT at most may be
 *   expensed; above, a good used more than a year is a fixed asset, PCG art.
 *   212-1 and 213-1, with its VAT on 44562, PCG art. 944-44);
 * - who a business meal was with (6257 réceptions or 6256 missions; the
 *   restaurant VAT is deductible since the exclusion of former CGI ann. II
 *   art. 236 was lifted and the exclusions moved to art. 206, IV, by décret
 *   n° 2007-566 of 16 April 2007);
 * - the kind of vehicle (passenger car or utility vehicle: CGI ann. II art.
 *   206, IV, 2, 6° excludes the VAT on passenger vehicles and on the services
 *   relating to them, rental and repairs included; CGI art. 298, 4, 1°, a
 *   allows 80 % of the VAT on the petrol and diesel of a passenger car);
 * - whether the rent bears VAT (letting of bare commercial premises is
 *   exempt unless the lessor opted, CGI art. 261 D, 2° and 260, 2°).
 *
 * Accounts of the catalogue (PCG art. 932-1, liste des comptes) are cited
 * with each category. VAT rates: CGI art. 278 (20 %), 279 (10 %: restaurants,
 * passenger transport), 278-0 bis (5,5 %: books), exemptions of art. 261 C
 * (banking and insurance operations) and 261, 4, 5° (postal universal service).
 */

import type { VatRule } from '@/lib/expense-reports/categories'

/**
 * Expense (a debit, usually), income (a credit), a movement that is neither
 * (taxes paid, loans, transfers), or the refund of an expense (money in that
 * reduces the charge it refunds, with its VAT).
 */
export type CategoryKind = 'expense' | 'income' | 'other' | 'refund'

/**
 * How the VAT of the operation is recovered: the expense report rules
 * (lib/expense-reports/vat-recovery.ts), plus:
 * - `passenger-vehicle`: rental, leasing, repairs of a passenger car,
 *   nothing recovered (CGI ann. II art. 206, IV, 2, 6°);
 * - `detected`: an exempt operation that may bear VAT on option (banking
 *   services, CGI art. 261 C, 1° and 260 B): the VAT the bank read on the
 *   receipt is deducted, none when it reads nothing (the rules library
 *   template "qonto-frais" books the same);
 * - `self-assessed`: a service of a supplier established outside France
 *   (CGI art. 259, 1° and 283, 2): the amount paid holds no French VAT, the
 *   company self-assesses it at the category's rate on the amount (4452)
 *   and deducts it (44566), as the rules library templates of foreign
 *   suppliers book it (lib/simple/foreign-suppliers.ts).
 */
export type SimpleVatRule = VatRule | 'passenger-vehicle' | 'detected' | 'self-assessed'

/** What an entry needs from a category: the account, the VAT rate and the recovery rule. */
export interface Posting {
  /** PCG account code (four digits at most, or 44562, 44566, 44571). */
  account: string
  /** Default VAT rate in basis points; 0 without VAT. */
  vatRateBp: number
  vatRule: SimpleVatRule
}

export type QuestionId = 'durable' | 'meal-guests' | 'vehicle' | 'rent-vat' | 'sale-vat-rate' | 'owner-money' | 'supplier-vat'

export interface QuestionAnswer {
  id: string
  /** Button label, plain French. */
  label: string
  /** What the answer changes in the category's posting. */
  posting: Partial<Posting>
  /**
   * What the money is once answered, when it differs from the category's
   * kind: money from a partner who buys a service is a sale (income, with
   * collected VAT), not a movement.
   */
  kind?: CategoryKind
  /**
   * Label for a company taxed at the impôt sur le revenu, where the answer
   * changes what is deductible (meals of the exploitant,
   * lib/expense-reports/exploitant-meals.ts).
   */
  incomeTaxLabel?: string
  /** Offered only to a company taxed at the impôt sur le revenu (accepted from any company: same posting). */
  incomeTaxOnly?: boolean
}

export interface Question {
  id: QuestionId
  /** The question, as asked to the user. */
  text: string
  /** One sentence under the answers: why Kledg asks. */
  help: string
  answers: QuestionAnswer[]
  /**
   * Asked only when the amount excluding VAT exceeds this (cents). The
   * durable equipment question: below, the purchase is expensed.
   */
  aboveExclTaxCents?: number
  /** An earlier answer for the same counterparty is reused (a vehicle stays a vehicle; a purchase is new each time). */
  reusable: boolean
  /**
   * Answer taken when the user gives none: the question is then optional
   * (who a business meal was with: with guests by default, the note names them).
   */
  defaultAnswerId?: string
  /** Legal source of the question. */
  source: string
}

export interface SimpleCategory {
  /** Stable identifier, stored with the entry (simple_mode_entries.categoryId). */
  id: string
  /** Plain French label. */
  label: string
  /** Heading of the list in the category picker. */
  group: string
  kind: CategoryKind
  /** One sentence for the user: what goes here. */
  hint: string
  /** Words a user may type to find the category (lowercase, without accents). */
  keywords: string[]
  posting: Posting
  question?: Question
  /** Prompt of the note for the accountant, when the category needs one (guests of a meal). */
  notePrompt?: string
  /** PCG article of the account and tax source of the VAT rule. */
  source: string
  /**
   * Book only to this account or one of its subaccounts, never to a parent:
   * the credit of VAT carried forward (44567) is read by the VAT return on
   * that account, its parent 4456 would hide it.
   */
  exactAccount?: boolean
}

/** Small equipment of a unit value of 500 € HT at most may be expensed (BOI-BIC-CHG-20-30-10). */
export const ASSET_THRESHOLD_EXCL_TAX_CENTS = 50_000

const STANDARD = 2000
const INTERMEDIATE = 1000
const REDUCED = 550

const durable = (assetAccount: string, yes: string, no: string): Question => ({
  id: 'durable',
  text: "Allez-vous l'utiliser plus d'un an ?",
  help: "Au-delà de 500 € HT, le coût d'un bien durable s'étale sur plusieurs années. Kledg l'ajoute à vos équipements et s'en occupe pour vous.",
  answers: [
    { id: 'durable', label: yes, posting: { account: assetAccount } },
    { id: 'consumable', label: no, posting: {} },
  ],
  aboveExclTaxCents: ASSET_THRESHOLD_EXCL_TAX_CENTS,
  reusable: false,
  source: 'BOI-BIC-CHG-20-30-10 (tolérance de 500 € HT); PCG art. 212-1, 213-1 (immobilisation); PCG art. 944-44 (TVA sur immobilisations, 44562)',
})

const vehicle = (account: string): Question => ({
  id: 'vehicle',
  text: "C'est pour quel véhicule ?",
  help: "La TVA n'est pas récupérable sur une voiture de tourisme, sauf 80 % de celle du carburant.",
  answers: [
    { id: 'passenger-car', label: 'Une voiture de tourisme', posting: { account } },
    { id: 'utility', label: 'Un utilitaire', posting: { account, vatRule: 'standard' } },
  ],
  reusable: true,
  source: 'CGI ann. II art. 206, IV, 2, 6° (véhicules de tourisme et services qui s’y rapportent); CGI art. 298, 4, 1°, a (carburant, 80 %); BOI-TVA-DED-30-30-20 et -40',
})

/**
 * Who a meal was with. For a company taxed at the impôt sur le revenu, a meal
 * alone of the exploitant or an associé is deductible only for its frais
 * supplémentaires (BOI-BNC-BASE-40-60-60; lib/expense-reports/exploitant-meals.ts):
 * "alone" then means the exploitant or an associé, and "alone-employee" an
 * employee (employer rules, fully deductible). Both book to 6256.
 */
const MEAL_GUESTS: Question = {
  id: 'meal-guests',
  text: 'Avec qui était ce repas ?',
  help: 'Notez les noms des invités pour votre comptable : ils justifient la dépense.',
  answers: [
    { id: 'guests', label: 'Avec des clients ou partenaires', posting: { account: '6257' } },
    { id: 'alone', label: 'Seul, en déplacement', incomeTaxLabel: 'Vous ou un associé, seul en déplacement', posting: { account: '6256' } },
    { id: 'alone-employee', label: 'Un salarié, seul en déplacement', incomeTaxOnly: true, posting: { account: '6256' } },
  ],
  reusable: false,
  defaultAnswerId: 'guests',
  source: 'PCG art. 932-1 (6256 Missions, 6257 Réceptions); CGI ann. II art. 206, IV (ancien art. 236, abrogé par le décret n° 2007-566 du 16 avril 2007 : TVA des repas d’affaires déductible); BOI-BNC-BASE-40-60-60 (repas seul de l’exploitant à l’IR : frais supplémentaires seulement)',
}

/** The answer a meal alone of the exploitant gives, at a company taxed at the impôt sur le revenu. */
export const EXPLOITANT_MEAL_ANSWER = { questionId: 'meal-guests', answerId: 'alone' } as const

/** The answers of a question offered to a company, with their label for it. */
export function answersFor(question: Question, incomeTax: boolean): Array<QuestionAnswer & { shownLabel: string }> {
  return question.answers
    .filter((a) => incomeTax || !a.incomeTaxOnly)
    .map((a) => ({ ...a, shownLabel: incomeTax && a.incomeTaxLabel ? a.incomeTaxLabel : a.label }))
}

const RENT_VAT: Question = {
  id: 'rent-vat',
  text: 'Votre bail ou votre quittance mentionne-t-il de la TVA ?',
  help: 'La location de locaux nus est sans TVA, sauf si le propriétaire a choisi de la facturer.',
  answers: [
    { id: 'with-vat', label: 'Oui, avec TVA', posting: { vatRateBp: STANDARD, vatRule: 'standard' } },
    { id: 'without-vat', label: 'Non, sans TVA', posting: { vatRateBp: 0, vatRule: 'none' } },
  ],
  reusable: true,
  source: 'CGI art. 261 D, 2° (exonération des locations de locaux nus) et 260, 2° (option du bailleur)',
}

/**
 * Software, hosting and advertising are often bought from suppliers
 * established outside France, who bill a French business without French
 * VAT: the service is taxed in France (CGI art. 259, 1°) and the customer
 * pays the VAT (CGI art. 283, 2), self-assessed and deducted in the same
 * entry (BOI-TVA-DECLA-10-10-20). A supplier the rules library knows
 * (lib/simple/foreign-suppliers.ts) is answered for the user; the answer is
 * kept for the same counterparty.
 */
export const SUPPLIER_VAT: Question = {
  id: 'supplier-vat',
  text: 'Votre facture mentionne-t-elle de la TVA française ?',
  help: 'Un fournisseur établi hors de France (Notion, GitHub, Google Ads, Meta...) facture sans TVA française : vous l’autoliquidez.',
  answers: [
    { id: 'french', label: 'Oui, TVA française', posting: {} },
    { id: 'foreign', label: 'Non, fournisseur hors de France (autoliquidation)', posting: { vatRule: 'self-assessed' } },
  ],
  reusable: true,
  defaultAnswerId: 'french',
  source: 'CGI art. 259, 1° (lieu des services entre assujettis) et 283, 2 (TVA due par le preneur) ; BOI-TVA-DECLA-10-10-20',
}

/**
 * VAT collected on a sale, at the rate of the invoice: 20 % by default (CGI
 * art. 278), 10 % (art. 279: restaurants, works in dwellings, passenger
 * transport), 5,5 % (art. 278-0 bis: food, books, energy works), 2,1 % (art.
 * 281 quater to 298 septies: reimbursed medicines, press), or none (exports
 * and intra-EU supplies, art. 262 ter and 262, I; services taxed in the
 * customer's country, art. 259 and 283, 2; exempt operations, art. 261).
 * The answer is kept for the same customer.
 */
const SALE_VAT_RATE: Question = {
  id: 'sale-vat-rate',
  text: 'Quelle TVA figure sur votre facture ?',
  help: 'Kledg reprend le taux de votre facture. Sans TVA : client à l’étranger ou activité exonérée.',
  answers: [
    { id: 'standard', label: '20 %', posting: { vatRateBp: STANDARD, vatRule: 'standard' } },
    { id: 'intermediate', label: '10 %', posting: { vatRateBp: INTERMEDIATE, vatRule: 'standard' } },
    { id: 'reduced', label: '5,5 %', posting: { vatRateBp: REDUCED, vatRule: 'standard' } },
    { id: 'super-reduced', label: '2,1 %', posting: { vatRateBp: 210, vatRule: 'standard' } },
    { id: 'none', label: 'Sans TVA', posting: { vatRateBp: 0, vatRule: 'none' } },
  ],
  reusable: true,
  defaultAnswerId: 'standard',
  source: 'CGI art. 278 (20 %), 279 (10 %), 278-0 bis (5,5 %), 281 quater à 298 septies (2,1 %), 262 ter et 262, I (exportations et livraisons intracommunautaires), 259 et 283, 2 (services taxés chez le client), 261 (exonérations)',
}

/**
 * Money a partner or the director sends to the company can be a loan to the
 * company (associés, comptes courants 455, repaid later), a contribution to
 * the share capital (1013, only after a decision to increase it, C. com. art.
 * L223-32 and L225-127 to L225-129), or the price of a sale made to them (706,
 * with collected VAT). Nothing tells them apart on the bank line: the user
 * answers each time.
 */
const OWNER_MONEY: Question = {
  id: 'owner-money',
  text: 'Est-ce de l’argent que vous avez prêté à votre société ?',
  help: 'Un prêt vous sera rendu plus tard. Une augmentation de capital ne se rembourse pas. Un achat à votre société est une vente comme une autre.',
  answers: [
    { id: 'loan', label: 'Oui, un prêt à la société', posting: { account: '455' } },
    { id: 'capital', label: 'Non, une augmentation de capital', posting: { account: '1013' } },
    { id: 'sale', label: 'Non, le paiement d’une vente', posting: { account: '706', vatRateBp: STANDARD, vatRule: 'standard' }, kind: 'income' },
  ],
  reusable: false,
  source: 'PCG art. 932-1, comptes 455 Associés, comptes courants, 1013 Capital souscrit, appelé, versé, 706 Prestations de services; C. com. art. L223-32 et L225-127 à L225-129 (augmentation de capital)',
}

const pcg = (account: string, label: string) => `PCG art. 932-1, compte ${account} ${label}`

type Def = Omit<SimpleCategory, 'posting'> & { account: string; vatRateBp: number; vatRule: SimpleVatRule }

const DEFS: Def[] = [
  // Locaux
  { id: 'loyer', label: 'Loyer des locaux', group: 'Locaux', kind: 'expense', account: '6132', vatRateBp: STANDARD, vatRule: 'standard', question: RENT_VAT,
    hint: 'Loyer et charges du bureau, de la boutique ou de l’atelier.', keywords: ['loyer', 'bail', 'bureau', 'local', 'charges locatives'], source: pcg('6132', 'Locations immobilières') },
  { id: 'coworking', label: 'Coworking et domiciliation', group: 'Locaux', kind: 'expense', account: '6132', vatRateBp: STANDARD, vatRule: 'standard',
    hint: 'Poste en espace partagé, adresse du siège.', keywords: ['coworking', 'domiciliation', 'siege', 'espace'], source: pcg('6132', 'Locations immobilières') },
  { id: 'energie', label: 'Électricité, gaz et eau', group: 'Locaux', kind: 'expense', account: '6061', vatRateBp: STANDARD, vatRule: 'standard',
    hint: 'Factures d’énergie et d’eau des locaux.', keywords: ['electricite', 'gaz', 'eau', 'energie', 'edf', 'engie'], source: pcg('6061', 'Fournitures non stockables (eau, énergie)') },
  { id: 'entretien-locaux', label: 'Ménage et entretien des locaux', group: 'Locaux', kind: 'expense', account: '6152', vatRateBp: STANDARD, vatRule: 'standard',
    hint: 'Nettoyage, petits travaux, dépannage des locaux.', keywords: ['menage', 'nettoyage', 'entretien', 'travaux', 'plombier'], source: pcg('6152', 'Entretien et réparation sur biens immobiliers') },
  { id: 'maintenance', label: 'Réparations et maintenance', group: 'Locaux', kind: 'expense', account: '6156', vatRateBp: STANDARD, vatRule: 'standard',
    hint: 'Contrats de maintenance, réparation de matériel.', keywords: ['maintenance', 'reparation', 'sav', 'depannage'], source: pcg('6156', 'Maintenance') },

  // Équipement
  { id: 'materiel-informatique', label: 'Matériel informatique', group: 'Équipement', kind: 'expense', account: '6063', vatRateBp: STANDARD, vatRule: 'standard',
    question: durable('2183', 'Oui, un ordinateur ou un écran', 'Non, un accessoire'),
    hint: 'Ordinateur, écran, téléphone, accessoires.', keywords: ['ordinateur', 'informatique', 'ecran', 'telephone', 'clavier', 'souris', 'apple', 'imprimante'],
    source: `${pcg('6063', 'Fournitures d’entretien et de petit équipement')}; ${pcg('2183', 'Matériel de bureau et matériel informatique')}` },
  { id: 'mobilier', label: 'Mobilier de bureau', group: 'Équipement', kind: 'expense', account: '6063', vatRateBp: STANDARD, vatRule: 'standard',
    question: durable('2184', 'Oui, un meuble durable', 'Non, un petit accessoire'),
    hint: 'Bureau, chaise, rangement.', keywords: ['mobilier', 'meuble', 'chaise', 'bureau', 'ikea'], source: `${pcg('6063', 'Fournitures d’entretien et de petit équipement')}; ${pcg('2184', 'Mobilier')}` },
  { id: 'outillage', label: 'Outils et machines', group: 'Équipement', kind: 'expense', account: '6063', vatRateBp: STANDARD, vatRule: 'standard',
    question: durable('2155', 'Oui, une machine ou un outil durable', 'Non, un consommable'),
    hint: 'Outillage, machines, petit équipement d’atelier.', keywords: ['outil', 'outillage', 'machine', 'bricolage'], source: `${pcg('6063', 'Fournitures d’entretien et de petit équipement')}; ${pcg('2155', 'Outillages industriels')}` },
  { id: 'fournitures', label: 'Fournitures de bureau', group: 'Équipement', kind: 'expense', account: '6064', vatRateBp: STANDARD, vatRule: 'standard',
    hint: 'Papier, cartouches, petites fournitures.', keywords: ['fournitures', 'papeterie', 'papier', 'cartouche', 'stylo'], source: pcg('6064', 'Fournitures administratives') },

  // Achats et sous-traitance
  { id: 'marchandises', label: 'Marchandises à revendre', group: 'Achats et sous-traitance', kind: 'expense', account: '607', vatRateBp: STANDARD, vatRule: 'standard',
    hint: 'Ce que vous achetez pour le revendre tel quel.', keywords: ['marchandises', 'stock', 'revente', 'grossiste'], source: pcg('607', 'Achats de marchandises') },
  { id: 'matieres-premieres', label: 'Matières premières', group: 'Achats et sous-traitance', kind: 'expense', account: '601', vatRateBp: STANDARD, vatRule: 'standard',
    hint: 'Ce que vous transformez pour fabriquer vos produits.', keywords: ['matieres', 'premieres', 'fabrication', 'composants'], source: pcg('601', 'Achats stockés, matières premières et fournitures') },
  { id: 'emballages', label: 'Emballages', group: 'Achats et sous-traitance', kind: 'expense', account: '6026', vatRateBp: STANDARD, vatRule: 'standard',
    hint: 'Cartons, sachets, matériel d’expédition.', keywords: ['emballage', 'carton', 'colis', 'raja'], source: pcg('6026', 'Emballages') },
  { id: 'sous-traitance', label: 'Sous-traitance', group: 'Achats et sous-traitance', kind: 'expense', account: '611', vatRateBp: STANDARD, vatRule: 'standard',
    hint: 'Une partie de votre travail confiée à un autre professionnel.', keywords: ['sous-traitance', 'freelance', 'prestataire', 'sous traitant'], source: pcg('611', 'Sous-traitance générale') },
  { id: 'prestations', label: 'Études et prestations achetées', group: 'Achats et sous-traitance', kind: 'expense', account: '604', vatRateBp: STANDARD, vatRule: 'standard',
    hint: 'Études, prestations intégrées à ce que vous vendez.', keywords: ['etude', 'prestation', 'service'], source: pcg('604', 'Achats d’études et prestations de services') },
  { id: 'livraisons', label: 'Livraisons et transport de marchandises', group: 'Achats et sous-traitance', kind: 'expense', account: '6241', vatRateBp: STANDARD, vatRule: 'standard',
    hint: 'Envoi de colis, transporteur, coursier.', keywords: ['livraison', 'transporteur', 'colissimo', 'chronopost', 'dhl', 'ups', 'coursier'], source: pcg('6241', 'Transports sur achats') },

  // Communication et logiciels
  { id: 'telephone-internet', label: 'Téléphone et internet', group: 'Communication et logiciels', kind: 'expense', account: '626', vatRateBp: STANDARD, vatRule: 'standard',
    hint: 'Forfait mobile, box internet, ligne fixe.', keywords: ['telephone', 'internet', 'mobile', 'box', 'forfait', 'free', 'orange', 'sfr', 'bouygues'], source: pcg('626', 'Frais postaux et de télécommunications') },
  { id: 'logiciels', label: 'Logiciels et abonnements', group: 'Communication et logiciels', kind: 'expense', account: '6511', vatRateBp: STANDARD, vatRule: 'standard', question: SUPPLIER_VAT,
    hint: 'Abonnements en ligne, licences de logiciels.', keywords: ['logiciel', 'abonnement', 'saas', 'licence', 'application', 'adobe', 'microsoft', 'google'],
    source: `${pcg('6511', 'Redevances pour concessions, brevets, licences, solutions informatiques')} (règlement ANC n° 2022-06)` },
  { id: 'hebergement-web', label: 'Hébergement web et noms de domaine', group: 'Communication et logiciels', kind: 'expense', account: '6511', vatRateBp: STANDARD, vatRule: 'standard', question: SUPPLIER_VAT,
    hint: 'Serveurs, site internet, noms de domaine.', keywords: ['hebergement', 'serveur', 'domaine', 'site', 'cloud', 'ovh'], source: pcg('6511', 'Redevances pour solutions informatiques') },
  { id: 'courrier', label: 'Courrier et timbres', group: 'Communication et logiciels', kind: 'expense', account: '626', vatRateBp: 0, vatRule: 'none',
    hint: 'Timbres et lettres recommandées (sans TVA).', keywords: ['courrier', 'timbre', 'poste', 'recommande', 'lettre'],
    source: `${pcg('626', 'Frais postaux et de télécommunications')}; CGI art. 261, 4, 5° (service universel postal exonéré)` },
  { id: 'publicite', label: 'Publicité et marketing', group: 'Communication et logiciels', kind: 'expense', account: '623', vatRateBp: STANDARD, vatRule: 'standard', question: SUPPLIER_VAT,
    hint: 'Annonces en ligne, cartes de visite, flyers, site.', keywords: ['publicite', 'marketing', 'annonce', 'ads', 'flyer', 'cartes de visite', 'communication'], source: pcg('623', 'Publicité, publications, relations publiques') },
  { id: 'salons', label: 'Salons et événements', group: 'Communication et logiciels', kind: 'expense', account: '6233', vatRateBp: STANDARD, vatRule: 'standard',
    hint: 'Stand, inscription à un salon professionnel.', keywords: ['salon', 'foire', 'exposition', 'evenement', 'stand'], source: pcg('6233', 'Foires et expositions') },
  { id: 'cadeaux-clients', label: 'Cadeaux clients', group: 'Communication et logiciels', kind: 'expense', account: '6234', vatRateBp: STANDARD, vatRule: 'gift',
    hint: 'TVA récupérable jusqu’à 73 € TTC par personne et par an.', keywords: ['cadeau', 'cadeaux', 'clients', 'chocolats', 'vin'],
    source: `${pcg('6234', 'Cadeaux à la clientèle')}; CGI ann. II art. 206, IV, 2, 3° et ann. IV art. 28-00 A (73 € TTC)` },

  // Déplacements et repas
  { id: 'deplacements', label: 'Déplacements', group: 'Déplacements et repas', kind: 'expense', account: '6251', vatRateBp: INTERMEDIATE, vatRule: 'passenger-transport',
    hint: 'Train, avion, taxi, VTC (TVA non récupérable).', keywords: ['train', 'avion', 'taxi', 'vtc', 'uber', 'sncf', 'voyage', 'deplacement', 'billet'],
    source: `${pcg('6251', 'Voyages et déplacements')}; CGI ann. II art. 206, IV, 2, 5° (transport de personnes)` },
  { id: 'hotel', label: 'Hôtel en déplacement', group: 'Déplacements et repas', kind: 'expense', account: '6256', vatRateBp: INTERMEDIATE, vatRule: 'staff-lodging',
    hint: 'Nuits d’hôtel lors d’un déplacement (TVA non récupérable).', keywords: ['hotel', 'nuit', 'hebergement', 'airbnb', 'booking'],
    source: `${pcg('6256', 'Missions')}; CGI ann. II art. 206, IV, 2, 2° (logement des dirigeants et du personnel)` },
  { id: 'repas-affaires', label: "Repas d'affaires", group: 'Déplacements et repas', kind: 'expense', account: '6257', vatRateBp: INTERMEDIATE, vatRule: 'standard',
    question: MEAL_GUESTS, notePrompt: 'Avec qui ? Ajoutez une note pour votre comptable',
    hint: 'Restaurant avec des clients, ou repas seul en déplacement.', keywords: ['restaurant', 'repas', 'dejeuner', 'diner', 'resto', 'brasserie'], source: `${pcg('6257', 'Réceptions')}; ${MEAL_GUESTS.source}` },
  { id: 'peages-parking', label: 'Péages et parking', group: 'Déplacements et repas', kind: 'expense', account: '6251', vatRateBp: STANDARD, vatRule: 'standard',
    hint: 'Autoroute, stationnement lors de déplacements professionnels.', keywords: ['peage', 'autoroute', 'parking', 'stationnement'],
    source: `${pcg('6251', 'Voyages et déplacements')}; BOI-TVA-DED-40-40, § 30 (stationnement) et § 330 (péages autoroutiers : TVA déductible par l’usager)` },

  // Véhicule
  { id: 'carburant', label: 'Carburant', group: 'Véhicule', kind: 'expense', account: '6061', vatRateBp: STANDARD, vatRule: 'fuel', question: vehicle('6061'),
    hint: 'Essence, gazole, recharge.', keywords: ['carburant', 'essence', 'gazole', 'diesel', 'station', 'total', 'shell', 'esso'],
    source: `${pcg('6061', 'Fournitures non stockables (eau, énergie)')}; CGI art. 298, 4, 1°, a` },
  { id: 'location-vehicule', label: 'Location ou leasing de véhicule', group: 'Véhicule', kind: 'expense', account: '6135', vatRateBp: STANDARD, vatRule: 'passenger-vehicle', question: vehicle('6135'),
    hint: 'Location courte durée, location longue durée, leasing.', keywords: ['location', 'leasing', 'lld', 'loa', 'voiture', 'vehicule'],
    source: `${pcg('6135', 'Locations mobilières')}; CGI ann. II art. 206, IV, 2, 6°` },
  { id: 'entretien-vehicule', label: 'Entretien et réparation du véhicule', group: 'Véhicule', kind: 'expense', account: '6155', vatRateBp: STANDARD, vatRule: 'passenger-vehicle', question: vehicle('6155'),
    hint: 'Garage, pneus, contrôle technique.', keywords: ['garage', 'pneus', 'vidange', 'controle technique', 'reparation', 'norauto', 'midas'],
    source: `${pcg('6155', 'Entretien et réparation sur biens mobiliers')}; CGI ann. II art. 206, IV, 2, 6°` },

  // Services et honoraires
  { id: 'honoraires', label: 'Honoraires (comptable, avocat, conseil)', group: 'Services et honoraires', kind: 'expense', account: '6226', vatRateBp: STANDARD, vatRule: 'standard',
    hint: 'Expert-comptable, avocat, consultant.', keywords: ['honoraires', 'comptable', 'avocat', 'conseil', 'consultant', 'notaire'], source: pcg('6226', 'Honoraires') },
  { id: 'formalites', label: 'Formalités et frais juridiques', group: 'Services et honoraires', kind: 'expense', account: '6227', vatRateBp: 0, vatRule: 'none',
    hint: 'Greffe, annonces légales, dépôt de marque.', keywords: ['greffe', 'formalites', 'kbis', 'inpi', 'annonce legale', 'juridique'], source: pcg('6227', 'Frais d’actes et de contentieux') },
  { id: 'assurances', label: 'Assurances', group: 'Services et honoraires', kind: 'expense', account: '616', vatRateBp: 0, vatRule: 'none',
    hint: 'Responsabilité civile, multirisque, assurance du local (sans TVA).', keywords: ['assurance', 'rc pro', 'multirisque', 'axa', 'allianz', 'hiscox'],
    source: `${pcg('616', 'Primes d’assurances')}; CGI art. 261 C, 2° (opérations d’assurance exonérées)` },
  { id: 'formation', label: 'Formation', group: 'Services et honoraires', kind: 'expense', account: '6185', vatRateBp: STANDARD, vatRule: 'standard',
    hint: 'Stage, cours, conférence, séminaire.', keywords: ['formation', 'stage', 'cours', 'seminaire', 'conference'], source: pcg('6185', 'Frais de colloques, séminaires, conférences') },
  { id: 'documentation', label: 'Livres, presse et documentation', group: 'Services et honoraires', kind: 'expense', account: '6181', vatRateBp: REDUCED, vatRule: 'standard',
    hint: 'Livres, abonnements de presse professionnelle.', keywords: ['livre', 'presse', 'journal', 'magazine', 'documentation'],
    source: `${pcg('6181', 'Documentation générale')}; CGI art. 278-0 bis, A (livres, 5,5 %)` },
  { id: 'cotisations-pro', label: 'Cotisations professionnelles', group: 'Services et honoraires', kind: 'expense', account: '6281', vatRateBp: 0, vatRule: 'none',
    hint: 'Syndicat, ordre, association professionnelle.', keywords: ['cotisation', 'syndicat', 'ordre', 'association', 'adhesion'], source: pcg('6281', 'Concours divers (cotisations)') },
  { id: 'recrutement', label: 'Recrutement', group: 'Services et honoraires', kind: 'expense', account: '6284', vatRateBp: STANDARD, vatRule: 'standard',
    hint: 'Annonces d’emploi, cabinet de recrutement.', keywords: ['recrutement', 'emploi', 'annonce', 'indeed', 'welcome'], source: pcg('6284', 'Frais de recrutement de personnel') },
  { id: 'interim', label: 'Intérim', group: 'Services et honoraires', kind: 'expense', account: '6211', vatRateBp: STANDARD, vatRule: 'standard',
    hint: 'Personnel mis à disposition par une agence.', keywords: ['interim', 'agence', 'adecco', 'manpower', 'randstad'], source: pcg('6211', 'Personnel intérimaire') },
  { id: 'dons', label: 'Dons et pourboires', group: 'Services et honoraires', kind: 'expense', account: '6238', vatRateBp: 0, vatRule: 'none',
    hint: 'Dons courants à une association, pourboires.', keywords: ['don', 'pourboire', 'association', 'mecenat'], source: pcg('6238', 'Divers (pourboires, dons courants)') },
  { id: 'amendes', label: 'Amendes et pénalités', group: 'Services et honoraires', kind: 'expense', account: '6582', vatRateBp: 0, vatRule: 'none',
    hint: 'Contravention, pénalité de retard (non déductibles du bénéfice).', keywords: ['amende', 'contravention', 'penalite', 'antai', 'majoration'],
    source: `${pcg('6582', 'Pénalités, amendes fiscales et pénales')}; CGI art. 39, 2` },

  // Banque et finances
  { id: 'frais-bancaires', label: 'Frais bancaires', group: 'Banque et finances', kind: 'expense', account: '627', vatRateBp: 0, vatRule: 'detected',
    hint: 'Abonnement du compte, frais de carte, commissions.', keywords: ['frais', 'banque', 'commission', 'carte', 'abonnement bancaire', 'qonto', 'shine'],
    source: `${pcg('627', 'Services bancaires et assimilés')}; CGI art. 261 C, 1° (opérations bancaires exonérées) et 260 B (option de la banque : seule la TVA lue sur la facture est déduite)` },
  { id: 'commissions-paiement', label: 'Commissions de paiement en ligne', group: 'Banque et finances', kind: 'expense', account: '6278', vatRateBp: 0, vatRule: 'detected',
    hint: 'Frais de Stripe, SumUp, PayPal sur vos encaissements.', keywords: ['stripe', 'sumup', 'paypal', 'commission', 'terminal'],
    source: `${pcg('6278', 'Autres frais et commissions sur prestations de services')}; CGI art. 261 C, 1° et 260 B (seule la TVA lue sur la facture est déduite)` },
  { id: 'agios', label: 'Agios et intérêts bancaires', group: 'Banque et finances', kind: 'expense', account: '6616', vatRateBp: 0, vatRule: 'none',
    hint: 'Intérêts de découvert.', keywords: ['agios', 'decouvert', 'interets debiteurs'], source: pcg('6616', 'Intérêts bancaires et sur opérations de financement') },
  { id: 'interets-emprunt', label: "Intérêts d'emprunt", group: 'Banque et finances', kind: 'expense', account: '6611', vatRateBp: 0, vatRule: 'none',
    hint: 'La part d’intérêts d’une échéance de prêt.', keywords: ['interets', 'emprunt', 'pret'], source: pcg('6611', 'Intérêts des emprunts et dettes') },
  { id: 'remboursement-emprunt', label: "Remboursement d'emprunt", group: 'Banque et finances', kind: 'other', account: '164', vatRateBp: 0, vatRule: 'none',
    hint: 'Échéance d’un prêt bancaire : votre comptable isolera les intérêts.', keywords: ['emprunt', 'pret', 'echeance', 'credit', 'remboursement'],
    source: pcg('164', 'Emprunts auprès des établissements de crédit') },

  // Personnel et dirigeant
  { id: 'salaires', label: 'Salaires versés', group: 'Personnel et dirigeant', kind: 'other', account: '421', vatRateBp: 0, vatRule: 'none',
    hint: 'Virement du salaire net à un salarié.', keywords: ['salaire', 'paie', 'remuneration', 'net'], source: pcg('421', 'Personnel, rémunérations dues') },
  { id: 'remuneration-dirigeant', label: 'Rémunération du dirigeant', group: 'Personnel et dirigeant', kind: 'expense', account: '6411', vatRateBp: 0, vatRule: 'none',
    hint: 'Ce que la société verse au gérant ou au président pour son travail.', keywords: ['remuneration', 'gerant', 'president', 'dirigeant'], source: pcg('6411', 'Salaires, appointements') },
  { id: 'charges-sociales', label: 'Charges sociales des salariés', group: 'Personnel et dirigeant', kind: 'other', account: '431', vatRateBp: 0, vatRule: 'none',
    hint: 'Cotisations URSSAF sur les salaires.', keywords: ['urssaf', 'cotisations', 'charges sociales', 'dsn'], source: pcg('431', 'Sécurité sociale') },
  { id: 'retraite-salaries', label: 'Retraite complémentaire des salariés', group: 'Personnel et dirigeant', kind: 'other', account: '437', vatRateBp: 0, vatRule: 'none',
    hint: 'Agirc-Arrco et caisses de retraite des salariés.', keywords: ['retraite', 'agirc', 'arrco', 'complementaire'], source: pcg('437', 'Autres organismes sociaux') },
  { id: 'cotisations-dirigeant', label: 'Cotisations sociales du dirigeant', group: 'Personnel et dirigeant', kind: 'expense', account: '646', vatRateBp: 0, vatRule: 'none',
    hint: 'URSSAF des indépendants, caisse de retraite du gérant.', keywords: ['cotisations', 'urssaf', 'independant', 'cipav', 'retraite', 'gerant', 'tns'], source: pcg('646', 'Cotisations sociales personnelles de l’exploitant') },
  { id: 'mutuelle', label: 'Mutuelle et prévoyance', group: 'Personnel et dirigeant', kind: 'expense', account: '6452', vatRateBp: 0, vatRule: 'none',
    hint: 'Complémentaire santé et prévoyance des salariés (sans TVA).', keywords: ['mutuelle', 'prevoyance', 'sante', 'alan', 'malakoff'],
    source: `${pcg('6452', 'Cotisations aux mutuelles')}; CGI art. 261 C, 2°` },
  { id: 'medecine-travail', label: 'Médecine du travail', group: 'Personnel et dirigeant', kind: 'expense', account: '6475', vatRateBp: 0, vatRule: 'none',
    hint: 'Service de santé au travail.', keywords: ['medecine', 'travail', 'sante au travail'], source: pcg('6475', 'Médecine du travail, pharmacie') },
  { id: 'prelevement-source', label: 'Prélèvement à la source des salariés', group: 'Personnel et dirigeant', kind: 'other', account: '4421', vatRateBp: 0, vatRule: 'none',
    hint: 'Impôt sur le revenu retenu sur les salaires et reversé aux impôts.', keywords: ['prelevement a la source', 'pas', 'impot', 'salaries'], source: pcg('4421', 'Prélèvements à la source (impôt sur le revenu)') },

  // Impôts et taxes
  { id: 'impots-taxes', label: 'Impôts et taxes (CFE, taxe foncière)', group: 'Impôts et taxes', kind: 'expense', account: '6351', vatRateBp: 0, vatRule: 'none',
    hint: 'Cotisation foncière des entreprises, taxes locales.', keywords: ['cfe', 'taxe', 'impots', 'fonciere', 'cvae'], source: pcg('6351', 'Impôts directs (sauf impôts sur les bénéfices)') },
  { id: 'impot-societes', label: 'Impôt sur les sociétés', group: 'Impôts et taxes', kind: 'other', account: '444', vatRateBp: 0, vatRule: 'none',
    hint: 'Acomptes et solde de l’impôt sur les bénéfices.', keywords: ['impot sur les societes', 'is', 'acompte', 'benefices'], source: pcg('444', 'État, impôts sur les bénéfices') },
  { id: 'tva-payee', label: 'TVA payée aux impôts', group: 'Impôts et taxes', kind: 'other', account: '4455', vatRateBp: 0, vatRule: 'none',
    hint: 'Paiement de votre déclaration de TVA.', keywords: ['tva', 'declaration', 'ca3', 'ca12'], source: pcg('4455', 'Taxes sur le chiffre d’affaires à décaisser') },

  // Mouvements d'argent
  { id: 'retrait-especes', label: "Retrait d'espèces", group: "Mouvements d'argent", kind: 'other', account: '53', vatRateBp: 0, vatRule: 'none',
    hint: 'Argent retiré au distributeur pour la caisse de la société.', keywords: ['retrait', 'especes', 'distributeur', 'dab', 'caisse'], source: pcg('53', 'Caisse') },
  { id: 'virement-interne', label: 'Virement entre vos comptes', group: "Mouvements d'argent", kind: 'other', account: '58', vatRateBp: 0, vatRule: 'none',
    hint: 'Argent passé d’un compte de la société à un autre.', keywords: ['virement', 'interne', 'transfert', 'epargne', 'compte'], source: pcg('58', 'Virements internes') },
  { id: 'compte-courant-associe', label: 'Compte courant d’associé', group: "Mouvements d'argent", kind: 'other', account: '455', vatRateBp: 0, vatRule: 'none',
    hint: 'Argent prêté par un associé à la société, ou qui lui est rendu.', keywords: ['associe', 'compte courant', 'apport', 'remboursement'], source: pcg('455', 'Associés, comptes courants') },
  { id: 'dividendes', label: 'Dividendes versés', group: "Mouvements d'argent", kind: 'other', account: '457', vatRateBp: 0, vatRule: 'none',
    hint: 'Bénéfices distribués aux associés.', keywords: ['dividendes', 'distribution', 'associes'], source: pcg('457', 'Associés, dividendes à payer') },

  // Recettes
  { id: 'ventes-prestations', label: 'Ventes de prestations', group: 'Recettes', kind: 'income', account: '706', vatRateBp: STANDARD, vatRule: 'standard', question: SALE_VAT_RATE,
    hint: 'Ce que vos clients vous paient pour un service.', keywords: ['vente', 'prestation', 'client', 'facture', 'mission', 'honoraires'], source: `${pcg('706', 'Prestations de services')}; ${pcg('44571', 'TVA collectée')}` },
  { id: 'ventes-marchandises', label: 'Ventes de marchandises', group: 'Recettes', kind: 'income', account: '707', vatRateBp: STANDARD, vatRule: 'standard', question: SALE_VAT_RATE,
    hint: 'Revente de produits achetés.', keywords: ['vente', 'marchandises', 'boutique', 'commande'], source: `${pcg('707', 'Ventes de marchandises')}; ${pcg('44571', 'TVA collectée')}` },
  { id: 'ventes-produits', label: 'Ventes de produits fabriqués', group: 'Recettes', kind: 'income', account: '701', vatRateBp: STANDARD, vatRule: 'standard', question: SALE_VAT_RATE,
    hint: 'Vente de ce que vous fabriquez.', keywords: ['vente', 'produits', 'fabrication'], source: `${pcg('701', 'Ventes de produits finis')}; ${pcg('44571', 'TVA collectée')}` },
  { id: 'paiement-client', label: 'Paiement d’une facture déjà enregistrée', group: 'Recettes', kind: 'other', account: '411', vatRateBp: 0, vatRule: 'none',
    hint: 'Le client règle une facture que vous avez déjà saisie dans Kledg.', keywords: ['client', 'reglement', 'facture', 'paiement'], source: pcg('411', 'Clients') },
  { id: 'subvention', label: "Subvention d'exploitation", group: 'Recettes', kind: 'income', account: '741', vatRateBp: 0, vatRule: 'none',
    hint: 'Aide publique pour votre activité : région, État, Bpifrance, CAF, aide à l’embauche.', keywords: ['subvention', 'aide', 'region', 'bpi', 'caf', 'asp', 'france travail', 'embauche', 'apprentissage'],
    source: `${pcg('741', 'Subventions d’exploitation')}; CGI art. 256 et BOI-TVA-BASE-10-10-10 (subvention sans contrepartie : hors champ de la TVA)` },
  { id: 'interets-recus', label: 'Intérêts reçus', group: 'Recettes', kind: 'income', account: '768', vatRateBp: 0, vatRule: 'none',
    hint: 'Intérêts d’un compte rémunéré ou d’un placement.', keywords: ['interets', 'livret', 'placement', 'remuneration'], source: `${pcg('768', 'Autres produits financiers')}; CGI art. 261 C, 1° (opérations financières exonérées)` },
  { id: 'indemnites-recues', label: 'Indemnités et remboursements reçus', group: 'Recettes', kind: 'income', account: '758', vatRateBp: 0, vatRule: 'none',
    hint: 'Indemnité d’assurance, dédommagement.', keywords: ['indemnite', 'assurance', 'dedommagement', 'remboursement'], source: pcg('758', 'Indemnités et autres produits') },
  { id: 'versement-associe', label: 'Argent versé par un associé ou le dirigeant', group: 'Recettes', kind: 'other', account: '455', vatRateBp: 0, vatRule: 'none', question: OWNER_MONEY,
    hint: 'Virement de votre compte personnel vers celui de la société.', keywords: ['associe', 'dirigeant', 'gerant', 'president', 'virement', 'personnel', 'apport'], source: `${pcg('455', 'Associés, comptes courants')}; ${OWNER_MONEY.source}` },
  { id: 'apport-capital', label: 'Apport en capital', group: 'Recettes', kind: 'other', account: '1013', vatRateBp: 0, vatRule: 'none',
    hint: 'Argent versé par les associés à la création ou lors d’une augmentation de capital.', keywords: ['capital', 'apport', 'creation', 'augmentation'], source: pcg('1013', 'Capital souscrit, appelé, versé') },
  { id: 'emprunt-recu', label: 'Emprunt reçu', group: 'Recettes', kind: 'other', account: '164', vatRateBp: 0, vatRule: 'none',
    hint: 'Somme prêtée par la banque ou Bpifrance, versée sur votre compte.', keywords: ['emprunt', 'pret', 'deblocage', 'credit'], source: pcg('164', 'Emprunts auprès des établissements de crédit') },
  { id: 'remboursement-tva', label: 'Remboursement de TVA', group: 'Recettes', kind: 'other', account: '44567', vatRateBp: 0, vatRule: 'none', exactAccount: true,
    hint: 'Crédit de TVA remboursé par les impôts.', keywords: ['tva', 'remboursement', 'credit de tva'],
    source: `${pcg('44567', 'Crédit de TVA à reporter')}; PCG art. 944-44; BOI-TVA-DED-50-20-20 (remboursement des crédits de TVA)` },
  { id: 'depot-garantie-rendu', label: 'Dépôt de garantie rendu', group: 'Recettes', kind: 'other', account: '275', vatRateBp: 0, vatRule: 'none',
    hint: 'Caution de vos locaux ou d’une location que l’on vous restitue.', keywords: ['caution', 'depot de garantie', 'restitution', 'garantie'], source: pcg('275', 'Dépôts et cautionnements versés') },
  { id: 'depot-especes', label: "Dépôt d'espèces", group: 'Recettes', kind: 'other', account: '53', vatRateBp: 0, vatRule: 'none',
    hint: 'Argent de la caisse déposé à la banque.', keywords: ['especes', 'versement', 'depot', 'caisse', 'liquide'], source: pcg('53', 'Caisse') },
]

export const SIMPLE_CATEGORIES: readonly SimpleCategory[] = DEFS.map(({ account, vatRateBp, vatRule, ...rest }) => ({ ...rest, posting: { account, vatRateBp, vatRule } }))

/** Prefix of the refund categories: `remboursement:telephone-internet`. */
export const REFUND_PREFIX = 'remboursement:'

/** Group of the refund categories in the picker. */
export const REFUND_GROUP = 'Remboursements de dépenses'

/**
 * Refund of an expense: a supplier gives money back (a credit note, an
 * overpayment, a cancelled order). The money in reduces the charge it
 * refunds, with the same VAT treatment taken back (PCG 2025, règlement ANC
 * n° 2022-06: the transfers of charges of account 79 are removed, a refund is
 * no longer income but a reduction of the charge). Expenses whose
 * accounting depends on the purchase (durable equipment that may be a fixed
 * asset, gifts with a VAT ceiling per person) are left to the accountant.
 */
export const REFUND_CATEGORIES: readonly SimpleCategory[] = SIMPLE_CATEGORIES.filter(
  (c) => c.kind === 'expense' && c.question?.id !== 'durable' && c.posting.vatRule !== 'gift',
).map((c) => ({
  ...c,
  id: `${REFUND_PREFIX}${c.id}`,
  label: `Remboursement : ${c.label}`,
  group: REFUND_GROUP,
  kind: 'refund' as const,
  hint: `Un fournisseur vous rend de l’argent sur une dépense de ce type (${c.label.toLowerCase()}).`,
  keywords: ['remboursement', 'rembourse', 'avoir', ...c.keywords],
  notePrompt: undefined,
  source: `${c.source}; règlement ANC n° 2022-06 (suppression des transferts de charges : le remboursement diminue la charge)`,
}))

/** Every category: the catalogue and the refunds of its expenses. */
export const ALL_CATEGORIES: readonly SimpleCategory[] = [...SIMPLE_CATEGORIES, ...REFUND_CATEGORIES]

const BY_ID = new Map(ALL_CATEGORIES.map((c) => [c.id, c]))

export function findCategory(id: string | null | undefined): SimpleCategory | null {
  return id ? (BY_ID.get(id) ?? null) : null
}

/** The refund category of an expense category, null when it has none. */
export function refundOf(expenseId: string | null | undefined): SimpleCategory | null {
  return expenseId ? findCategory(`${REFUND_PREFIX}${expenseId}`) : null
}

export const CATEGORY_IDS = ALL_CATEGORIES.map((c) => c.id)

/** Groups of the picker, in catalogue order. */
export const CATEGORY_GROUPS: readonly string[] = [...new Set(ALL_CATEGORIES.map((c) => c.group))]

/**
 * Categories offered for a bank side: expenses for money out; income,
 * refunds of expenses and the movements for money in; movements for both.
 */
export function categoriesForSide(side: 'debit' | 'credit'): SimpleCategory[] {
  return ALL_CATEGORIES.filter((c) => c.kind === 'other' || (side === 'debit' ? c.kind === 'expense' : c.kind === 'income' || c.kind === 'refund'))
}

/** Lowercase, without accents: how the picker compares what the user types. */
export function searchText(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/** Categories whose label, group or keywords contain every word typed, in catalogue order. */
export function searchCategories(query: string, among: readonly SimpleCategory[] = SIMPLE_CATEGORIES): SimpleCategory[] {
  const words = searchText(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...among]
  return among.filter((c) => {
    const haystack = searchText([c.label, c.group, c.hint, ...c.keywords].join(' '))
    return words.every((w) => haystack.includes(w))
  })
}

/** Lower case, without accents, words separated by single spaces. */
function plain(text: string): string {
  return ` ${text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `
}

/** Whether `hint` names the category: one of its keywords, or its label, as whole words. */
function hintNames(category: SimpleCategory, hint: string): boolean {
  const words = [...(category.keywords ?? []), category.label].map((w) => plain(w).trim()).filter(Boolean)
  return words.some((w) => hint.includes(` ${w} `))
}

/**
 * Category of an account an entry used (a rule, an expert reconciliation),
 * for the history: the categories of the catalogue whose account, or one of
 * whose answers' accounts, the code starts with, the longest match first
 * (6257 before 625). Several categories can book to the same account (6061:
 * energy and fuel): `hint` (the rule's name, the bank label) then picks the
 * one it names, and without a hint naming one of them the answer is null
 * rather than a guess. Without `hint`, the first of the catalogue.
 */
export function categoryOfAccount(code: string, hint?: string): SimpleCategory | null {
  let length = 0
  let matches: SimpleCategory[] = []
  for (const category of SIMPLE_CATEGORIES) {
    const accounts = [category.posting.account, ...(category.question?.answers.map((a) => a.posting.account).filter((a): a is string => Boolean(a)) ?? [])]
    const best = Math.max(0, ...accounts.filter((account) => code.startsWith(account)).map((account) => account.length))
    if (best === 0 || best < length) continue
    if (best > length) {
      length = best
      matches = []
    }
    if (!matches.includes(category)) matches.push(category)
  }
  if (matches.length <= 1 || hint === undefined) return matches[0] ?? null
  const text = plain(hint)
  const named = matches.filter((category) => hintNames(category, text))
  return named.length === 1 ? named[0] : null
}
