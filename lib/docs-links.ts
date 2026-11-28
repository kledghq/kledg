import { DOCS_URL } from '@/lib/config'

/**
 * User documentation pages on www.kledg.com (content/docs/fr/<section> in the
 * website repository, address /docs/<section>/<page>). Screens link here from their header ("Aide") and from inline
 * help on accounting terms, so beginners can learn the concept in place.
 */
const DOCS_PAGES = {
  firstSteps: 'demarrer/premiers-pas',
  doubleEntry: 'comprendre/la-partie-double',
  chartOfAccounts: 'comprendre/le-plan-comptable',
  journals: 'comprendre/les-journaux-et-ecritures-types',
  fiscalYear: 'comprendre/l-exercice-et-la-cloture',
  bankReconciliation: 'comprendre/le-rapprochement-bancaire',
  depreciation: 'comprendre/les-amortissements',
  vat: 'comprendre/la-tva-expliquee',
  fec: 'comprendre/le-fec',
  balanceSheet: 'comprendre/lire-son-bilan',
  incomeStatement: 'comprendre/lire-son-compte-de-resultat',
  equity: 'comprendre/capitaux-propres-et-compte-courant',
  calendar: 'comprendre/le-calendrier-d-une-petite-societe',
  aiAssistants: 'assistant-ia/connecter-claude-ou-chatgpt',
  importStatement: 'banque/importer-un-releve-bancaire',
  stripe: 'banque/connecter-stripe',
  install: 'demarrer/installer-kledg',
  hosting: 'auto-hebergement/choisir-son-hebergement',
  docker: 'auto-hebergement/heberger-avec-docker',
  liasseFiscale: 'declarations/la-liasse-fiscale',
} as const

export type DocsPage = keyof typeof DOCS_PAGES

/** Absolute URL of a documentation page. */
export function docsUrl(page: DocsPage): string {
  return `${DOCS_URL}/${DOCS_PAGES[page]}`
}
