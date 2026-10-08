import { DOCS_URL } from '@/lib/config'

/**
 * User documentation pages on www.kledg.com (content/docs/fr in the website
 * repository). Screens link here from their header ("Aide") and from inline
 * help on accounting terms, so beginners can learn the concept in place.
 */
const DOCS_PAGES = {
  firstSteps: 'premiers-pas',
  doubleEntry: 'la-partie-double',
  chartOfAccounts: 'le-plan-comptable',
  journals: 'les-journaux-et-ecritures-types',
  fiscalYear: 'l-exercice-et-la-cloture',
  bankReconciliation: 'le-rapprochement-bancaire',
  depreciation: 'les-amortissements',
  vat: 'la-tva-expliquee',
  fec: 'le-fec',
  balanceSheet: 'lire-son-bilan',
  incomeStatement: 'lire-son-compte-de-resultat',
  equity: 'capitaux-propres-et-compte-courant',
  calendar: 'le-calendrier-d-une-petite-societe',
  aiAssistants: 'connecter-claude-ou-chatgpt',
  importStatement: 'importer-un-releve-bancaire',
  install: 'installer-kledg',
  hosting: 'choisir-son-hebergement',
  docker: 'heberger-avec-docker',
} as const

export type DocsPage = keyof typeof DOCS_PAGES

/** Absolute URL of a documentation page. */
export function docsUrl(page: DocsPage): string {
  return `${DOCS_URL}/${DOCS_PAGES[page]}`
}
