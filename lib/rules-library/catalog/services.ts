/**
 * Templates of suppliers of services and goods: software and SaaS,
 * telecoms, energy, rent, fees, advertising, supplies, post and press. See
 * docs/bibliotheque-de-regles.md to add one.
 */

import { DEBIT, detectedVatLine, labelMatches, reducedVatLine, selfAssessedLine, standardVatLine, type RuleTemplate, type RuleTemplateCategory } from '../template'
import { SOURCES } from './sources'

const FRENCH_SUPPLIER_WHY = 'Fournisseur établi en France : TVA à 20 % (CGI art. 278) sur la facture, détectée par la banque, 20 % sinon, déductible.'

/**
 * Self-assessment of a service bought from a supplier established outside
 * France (CGI art. 283, 2, BOI-TVA-DECLA-10-10-20 §130): the same entry for
 * a supplier of the European Union or of a third country.
 */
const selfAssessedWhy = (supplier: string) =>
  `${supplier} facture sans TVA une entreprise qui lui a donné son numéro de TVA : la société autoliquide 20 % (CGI art. 283, 2), déductible et due dans la même écriture. Si la facture porte de la TVA française, passez la ligne en TVA déductible.`

/** A French supplier whose invoices carry VAT at 20 %. */
function frenchSupplier(
  id: string,
  name: string,
  category: RuleTemplateCategory,
  accountCode: string,
  description: string,
  pattern: string,
  words: string,
  match: string[],
  noMatch: string[] = [],
): RuleTemplate {
  return {
    id,
    name,
    category,
    description,
    conditions: [DEBIT, labelMatches(pattern, words)],
    lines: [standardVatLine(accountCode)],
    vat: { treatment: 'standard', why: FRENCH_SUPPLIER_WHY },
    sources: [SOURCES.standardRate],
    samples: { match, noMatch },
  }
}

/** A supplier established outside France: VAT self-assessed at 20 %. */
function foreignSupplier(
  id: string,
  name: string,
  category: RuleTemplateCategory,
  accountCode: string,
  vatType: 'intracom' | 'import',
  supplier: string,
  description: string,
  pattern: string,
  words: string,
  match: string[],
  noMatch: string[] = [],
): RuleTemplate {
  return {
    id,
    name,
    category,
    description,
    conditions: [DEBIT, labelMatches(pattern, words)],
    lines: [selfAssessedLine(accountCode, vatType)],
    vat: { treatment: 'self-assessed', why: selfAssessedWhy(supplier) },
    sources: [SOURCES.reverseCharge],
    samples: { match, noMatch },
  }
}

const SOFTWARE = 'Abonnement logiciel, en redevances pour solutions informatiques (6511).'
const HOSTING = 'Hébergement et serveurs, en redevances pour solutions informatiques (6511), comme le mode simple.'

export const SERVICES_TEMPLATES: RuleTemplate[] = [
  frenchSupplier('ovhcloud', 'OVHcloud', 'logiciels', '6511', `OVHcloud : ${HOSTING}`, '\\bovh(cloud)?\\b', 'OVH, OVHCLOUD', ['OVH SAS', 'PRLV SEPA OVHCLOUD', 'ovhcloud.com'], ['CB MOVHOME']),
  frenchSupplier('scaleway', 'Scaleway', 'logiciels', '6511', `Scaleway : ${HOSTING}`, '\\bscaleway\\b', 'SCALEWAY', ['SCALEWAY SAS', 'PRLV SEPA SCALEWAY']),
  frenchSupplier('gandi', 'Gandi', 'logiciels', '6511', `Gandi (noms de domaine, hébergement) : ${HOSTING}`, '\\bgandi\\b', 'GANDI', ['GANDI SAS', 'CB GANDI.NET'], ['CB GANDINI PARIS']),
  frenchSupplier('payfit', 'PayFit', 'logiciels', '6511', `PayFit : ${SOFTWARE}`, '\\bpayfit\\b', 'PAYFIT', ['PRLV SEPA PAYFIT', 'PayFit SAS']),
  foreignSupplier('microsoft', 'Microsoft 365 et Azure', 'logiciels', '6511', 'intracom', 'Microsoft (Irlande)', `Microsoft : ${SOFTWARE}`, '\\b(microsoft|msft)\\b', 'MICROSOFT, MSFT', ['MICROSOFT*365 BUSINESS', 'MSFT * E0100ABCD', 'Microsoft Ireland Operations'], ['CB MICROSOFTWARE SHOP']),
  foreignSupplier('adobe', 'Adobe', 'logiciels', '6511', 'intracom', 'Adobe (Irlande)', `Adobe : ${SOFTWARE}`, '\\badobe\\b', 'ADOBE', ['ADOBE *CREATIVE CLOUD', 'Adobe Systems Software Ireland']),
  {
    id: 'google-workspace',
    name: 'Google Workspace',
    category: 'logiciels',
    description: `Google Workspace : ${SOFTWARE}`,
    conditions: [DEBIT, labelMatches('\\bgoogle\\W*(workspace|g\\s?suite)|\\bgsuite', 'GOOGLE WORKSPACE, GSUITE')],
    lines: [detectedVatLine('6511')],
    vat: {
      treatment: 'detected',
      why: "La TVA dépend de l'entité qui facture : seule la TVA détectée par la banque est déduite. Si la facture mentionne l'autoliquidation, passez la ligne en TVA intracommunautaire (CGI art. 283, 2).",
    },
    sources: [SOURCES.reverseCharge],
    samples: { match: ['GOOGLE *GSUITE_MONDOMAINE', 'Google Workspace', 'GOOGLE GSUITE'], noMatch: ['GOOGLE *ADS1234567', 'GOOGLE PLAY'] },
  },
  {
    id: 'aws',
    name: 'Amazon Web Services',
    category: 'logiciels',
    description: `Amazon Web Services : ${HOSTING}`,
    conditions: [DEBIT, labelMatches('\\b(aws|amazon web services)\\b', 'AWS, AMAZON WEB SERVICES')],
    lines: [detectedVatLine('6511')],
    vat: {
      treatment: 'detected',
      why: "La TVA dépend de l'entité qui facture : seule la TVA détectée par la banque est déduite. Si la facture mentionne l'autoliquidation, passez la ligne en TVA intracommunautaire (CGI art. 283, 2).",
    },
    sources: [SOURCES.reverseCharge],
    samples: { match: ['AWS EMEA', 'Amazon Web Services EMEA SARL', 'AWS EMEA AWS.AMAZON.CO'], noMatch: ['AMAZON EU SARL', 'CB LAWSON'] },
  },
  foreignSupplier('notion', 'Notion', 'logiciels', '6511', 'import', 'Notion (États-Unis)', `Notion : ${SOFTWARE}`, '\\bnotion\\b', 'NOTION', ['NOTION.SO', 'NOTION LABS INC'], ['CB NOTIONS DE COUTURE']),
  foreignSupplier('github', 'GitHub', 'logiciels', '6511', 'import', 'GitHub (États-Unis)', `GitHub : ${SOFTWARE}`, '\\bgithub\\b', 'GITHUB', ['GITHUB, INC.', 'GITHUB SPONSORS'], ['CB GITHOUSE']),
  foreignSupplier('openai', 'OpenAI (ChatGPT)', 'logiciels', '6511', 'import', 'OpenAI, établi hors de France,', `OpenAI : ${SOFTWARE}`, '\\b(openai|chatgpt)\\b', 'OPENAI, CHATGPT', ['OPENAI *CHATGPT SUBSCR', 'OpenAI'], ['CB OPEN AIR PARIS']),
  foreignSupplier('anthropic', 'Anthropic (Claude)', 'logiciels', '6511', 'import', 'Anthropic, établi hors de France,', `Anthropic : ${SOFTWARE}`, '\\b(anthropic|claude\\.ai)\\b', 'ANTHROPIC, CLAUDE.AI', ['ANTHROPIC', 'CLAUDE.AI SUBSCRIPTION'], ['VIR SEPA CLAUDE MARTIN']),
  foreignSupplier('canva', 'Canva', 'logiciels', '6511', 'import', 'Canva (Australie)', `Canva : ${SOFTWARE}`, '\\bcanva\\b', 'CANVA', ['CANVA* 04012345', 'Canva Pty Ltd'], ['CB CANVAS PEINTURE']),

  frenchSupplier('orange', 'Orange (télécom)', 'telecom', '626', 'Abonnements Orange (internet, mobile, fixe), en frais de télécommunications (626).', '\\borange (sa|pro|business|france|telecom|mobile|internet)\\b|^(prlv sepa )?orange$', 'ORANGE SA, ORANGE PRO, ORANGE BUSINESS', ['PRLV SEPA ORANGE SA', 'ORANGE PRO', 'Orange'], ['ORANGE BLEUE MULHOUSE', 'CB ORANGINA']),
  frenchSupplier('sfr', 'SFR (télécom)', 'telecom', '626', 'Abonnements SFR, en frais de télécommunications (626).', '\\bsfr\\b', 'SFR', ['PRLV SEPA SFR', 'SFR BUSINESS', 'SFR FIXE ADSL']),
  frenchSupplier('free', 'Free (télécom)', 'telecom', '626', 'Abonnements Free, Free Mobile et Free Pro, en frais de télécommunications (626).', '\\bfree (mobile|telecom|pro|haut d.bit)\\b|\\bfreebox\\b', 'FREE MOBILE, FREE TELECOM, FREE PRO', ['PRLV SEPA FREE MOBILE', 'FREE TELECOM', 'Free Pro'], ['FREENOW PARIS', 'FREE NOW']),
  frenchSupplier('bouygues-telecom', 'Bouygues Telecom', 'telecom', '626', 'Abonnements Bouygues Telecom et B&You, en frais de télécommunications (626).', '\\bbouygues tel(ecom)?\\b|\\bb&you\\b', 'BOUYGUES TELECOM, B&YOU', ['PRLV SEPA BOUYGUES TELECOM', 'BOUYGUES TEL', 'B&YOU'], ['BOUYGUES IMMOBILIER']),

  {
    ...frenchSupplier('edf', 'EDF (électricité)', 'energie', '6061', 'Électricité EDF, en fournitures non stockables (6061).', '\\bedf\\b', 'EDF', ['PRLV SEPA EDF ENTREPRISES', 'EDF PRO', 'EDF CLIENTS'], ['CB EDFI']),
    vat: { treatment: 'standard', why: "Électricité à 20 %, abonnement compris depuis le 1er août 2025 (loi 2025-127, art. 20) : TVA détectée par la banque, 20 % sinon, déductible." },
    sources: [SOURCES.energy],
  },
  {
    ...frenchSupplier('engie', 'Engie (gaz et électricité)', 'energie', '6061', 'Gaz et électricité Engie, en fournitures non stockables (6061).', '\\bengie\\b', 'ENGIE', ['PRLV SEPA ENGIE', 'ENGIE PRO']),
    vat: { treatment: 'standard', why: "Gaz et électricité à 20 %, abonnement compris depuis le 1er août 2025 (loi 2025-127, art. 20) : TVA détectée par la banque, 20 % sinon, déductible." },
    sources: [SOURCES.energy],
  },

  {
    id: 'loyer-bureaux',
    name: 'Loyer des bureaux',
    category: 'loyers',
    description: 'Loyer des locaux professionnels, en locations immobilières (6132).',
    conditions: [DEBIT, labelMatches('\\bloyers?\\b', 'LOYER')],
    lines: [detectedVatLine('6132')],
    vat: {
      treatment: 'detected',
      why: "Location de locaux nus exonérée (CGI art. 261 D, 2°) sauf option du bailleur pour la TVA (CGI art. 260, 2°) : seule la TVA détectée par la banque est déduite ; le bail ou l'avis d'échéance le dit.",
    },
    sources: [SOURCES.rentExempt, SOURCES.rentOption],
    samples: { match: ['PRLV LOYER BUREAUX MARS', 'VIR SEPA LOYER LOCAL COMMERCIAL', 'Loyer 03/2026'], noMatch: ['VIR SEPA EMPLOYER'] },
  },

  frenchSupplier('expert-comptable', 'Expert-comptable', 'honoraires', '6226', 'Honoraires du cabinet d’expertise comptable, en honoraires (6226).', '\\b(expert.comptable|experts.comptables|cabinet comptable|honoraires comptables)\\b', 'EXPERT-COMPTABLE, CABINET COMPTABLE, HONORAIRES COMPTABLES', ['VIR HONORAIRES COMPTABLES T1', 'PRLV SEPA CABINET COMPTABLE DUPONT', 'Expert-comptable mission annuelle'], ['TRESOR COMPTABLE PUBLIC']),
  frenchSupplier('avocat', 'Avocat', 'honoraires', '6226', "Honoraires d'avocat, en honoraires (6226).", '\\bavocats?\\b', 'AVOCAT', ["VIR CABINET D'AVOCATS MARTIN", 'HONORAIRES AVOCAT', 'SCP DURAND AVOCATS'], ['CB AVOCADO BAR']),

  foreignSupplier('google-ads', 'Google Ads', 'publicite', '6231', 'intracom', 'Google (Irlande)', 'Publicité Google Ads, en annonces et insertions (6231).', '\\bgoogle\\W*(ads|adwords|advertising)', 'GOOGLE ADS, GOOGLE ADWORDS', ['GOOGLE*ADS5612345', 'Google Ads', 'GOOGLE ADWORDS'], ['GOOGLE PLAY', 'GOOGLE *GSUITE_MONDOMAINE']),
  foreignSupplier('meta-ads', 'Meta (Facebook et Instagram Ads)', 'publicite', '6231', 'intracom', 'Meta (Irlande)', 'Publicité Facebook et Instagram, en annonces et insertions (6231).', '\\bfacebk\\b|\\bfacebook ads\\b|\\bmeta (platforms|ads)\\b', 'FACEBK, FACEBOOK ADS, META PLATFORMS', ['FACEBK *2KX7Y9ZAB2', 'Meta Platforms Ireland', 'FACEBOOK ADS'], ['CB METAL BOIS']),
  foreignSupplier('linkedin', 'LinkedIn (publicité et abonnements)', 'publicite', '6231', 'intracom', 'LinkedIn (Irlande)', 'Publicité et abonnements LinkedIn, en annonces et insertions (6231).', '\\blinkedin\\b', 'LINKEDIN', ['LINKEDIN *ADS', 'LinkedIn Premium', 'LINKEDIN IRELAND'], ['VIR LINKED CONSULTING']),

  {
    id: 'amazon',
    name: 'Amazon (achats)',
    category: 'fournitures',
    description: 'Achats sur Amazon, en fournitures administratives (6064) ; changez le compte pour un autre achat.',
    conditions: [DEBIT, labelMatches('\\bamzn\\b|\\bamazon\\s?(\\.fr|eu|payments|marketplace|business|mktp)', 'AMAZON EU, AMAZON.FR, AMZN MKTP')],
    lines: [detectedVatLine('6064')],
    vat: {
      treatment: 'detected',
      why: "Amazon vend pour son compte et pour des vendeurs tiers, parfois établis hors de France : la TVA dépend de chaque facture, seule la TVA détectée par la banque est déduite.",
    },
    sources: [SOURCES.standardRate],
    samples: { match: ['AMAZON EU SARL', 'AMZN MKTP FR', 'Amazon.fr'], noMatch: ['AMAZON WEB SERVICES EMEA'] },
  },
  frenchSupplier('fournitures-bureau', 'Fournitures de bureau', 'fournitures', '6064', 'Bureau Vallée, Lyreco, Office Depot : fournitures administratives (6064).', '\\b(bureau vall.e|lyreco|office depot|viking direct|top office)\\b', 'BUREAU VALLEE, LYRECO, OFFICE DEPOT, TOP OFFICE', ['CB BUREAU VALLEE PARIS 15', 'LYRECO FRANCE', 'OFFICE DEPOT FRANCE']),

  {
    id: 'la-poste',
    name: 'La Poste',
    category: 'poste',
    description: 'Timbres, lettres recommandées et colis de La Poste, en frais postaux (626).',
    conditions: [DEBIT, labelMatches('\\bla poste\\b|\\blaposte\\b|\\bcolissimo\\b', 'LA POSTE, LAPOSTE, COLISSIMO')],
    lines: [detectedVatLine('626')],
    vat: {
      treatment: 'detected',
      why: 'Timbres et service universel postal exonérés (CGI art. 261 C, 3° et art. 261, 4, 11°) ; les autres envois peuvent porter la TVA : seule la TVA détectée par la banque est déduite.',
    },
    sources: [SOURCES.postal],
    samples: { match: ['CB LA POSTE PARIS LOUVRE', 'LAPOSTE.FR BOUTIQUE', 'COLISSIMO'], noMatch: ['CB AFFICHE POSTER'] },
  },
  {
    id: 'presse',
    name: 'Abonnements de presse',
    category: 'presse',
    description: 'Abonnements aux journaux et à la presse en ligne, en documentation générale (6181).',
    conditions: [
      DEBIT,
      labelMatches('\\b(le monde|les echos|le figaro|liberation|l.express|le parisien|mediapart|la tribune|challenges|le point|l.obs)\\b', 'LE MONDE, LES ECHOS, LE FIGARO, MEDIAPART, LE POINT...'),
    ],
    lines: [reducedVatLine('6181', 2.1)],
    vat: {
      treatment: 'reduced',
      why: 'Presse inscrite à la CPPAP, papier ou en ligne, à 2,1 % (CGI art. 298 septies) : TVA détectée par la banque, 2,1 % sinon, déductible.',
    },
    sources: [SOURCES.pressPrinted, SOURCES.pressOnline],
    samples: { match: ['PRLV LE MONDE ABONNEMENT', 'LES ECHOS', 'MEDIAPART'], noMatch: ['CB LE PAIN QUOTIDIEN'] },
  },
]
