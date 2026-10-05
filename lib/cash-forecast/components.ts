/**
 * The flows a cash forecast adds to today's bank balance (docs/prevision-tresorerie.md),
 * each one switchable on the page so the user sees what moves the curve.
 * Pure, no imports: the page, the API and the MCP tool share the names.
 *
 * Known flows (dated, from the books and the deadline calendar) are on by
 * default. The two assumptions (budget, recent pace) are off by default:
 * they overlap the known flows and each other, and the page says so.
 */

export const CASH_FORECAST_COMPONENTS = ['receivables', 'payables', 'taxes', 'recurring', 'budget', 'trend'] as const
export type CashForecastComponent = (typeof CASH_FORECAST_COMPONENTS)[number]

export const DEFAULT_COMPONENTS: readonly CashForecastComponent[] = ['receivables', 'payables', 'taxes', 'recurring']

export interface ComponentInfo {
  /** Expert label (French). */
  label: string
  /** Simple mode label: no account number, no accounting term. */
  simpleLabel: string
  description: string
  simpleDescription: string
  /** An assumption rather than a known flow: shown as such. */
  assumption: boolean
  /** Why it brings nothing, when it does not (expert, then simple words). */
  empty: string
  simpleEmpty: string
}

export const COMPONENT_INFO: Record<CashForecastComponent, ComponentInfo> = {
  receivables: {
    label: 'Factures clients à encaisser',
    simpleLabel: 'Ce que vos clients vont vous payer',
    description:
      'Soldes ouverts des comptes 411 à leur date d’échéance (délais de paiement de la société ou du tiers). Les factures déjà échues sont comptées le premier jour de la prévision.',
    simpleDescription: 'Les factures envoyées à vos clients et pas encore payées, à la date où elles doivent l’être. Celles qui sont en retard sont comptées dès demain.',
    assumption: false,
    empty: 'Aucune facture client ouverte dans les comptes 411.',
    simpleEmpty: 'Aucune facture client en attente de paiement.',
  },
  payables: {
    label: 'Factures fournisseurs à payer',
    simpleLabel: 'Factures de vos fournisseurs à payer',
    description:
      'Soldes ouverts des comptes 401 à leur date d’échéance. Les factures déjà échues sont comptées le premier jour de la prévision.',
    simpleDescription: 'Les factures reçues et pas encore payées, à leur date limite. Celles qui sont en retard sont comptées dès demain.',
    assumption: false,
    empty: 'Aucune facture fournisseur ouverte dans les comptes 401.',
    simpleEmpty: 'Aucune facture fournisseur à payer.',
  },
  taxes: {
    label: 'Impôts et taxes',
    simpleLabel: 'Impôts et taxes à payer',
    description:
      'Échéances du calendrier fiscal dont le montant est connu : prochaine déclaration de TVA, acomptes et solde d’impôt sur les sociétés, CFE, montants saisis dans le suivi des échéances. Une échéance passée non marquée payée, au montant connu, est comptée le premier jour de la prévision ; une échéance à venir sans montant connu est listée sans être comptée.',
    simpleDescription: 'Les impôts dont Kledg connaît déjà le montant (TVA, impôt sur les sociétés, CFE), à leur date limite. Ceux qui sont en retard sont comptés dès demain.',
    assumption: false,
    empty: 'Aucune échéance fiscale à payer dont le montant est connu sur la période.',
    simpleEmpty: 'Aucun impôt au montant connu sur la période.',
  },
  recurring: {
    label: 'Paiements récurrents',
    simpleLabel: 'Abonnements, salaires et prélèvements',
    description:
      'Abonnements et charges récurrentes détectés dans les opérations bancaires (salaires, cotisations, emprunts), au montant actuel et à leur rythme, à partir de la prochaine date attendue. Les séries ignorées ou peut-être arrêtées et les impôts (comptés avec les échéances) sont exclus.',
    simpleDescription: 'Les paiements qui reviennent régulièrement sur votre compte (abonnements, salaires, prêts), au même montant et au même rythme.',
    assumption: false,
    empty: 'Aucun paiement récurrent détecté dans les opérations bancaires.',
    simpleEmpty: 'Aucun paiement régulier repéré sur votre compte.',
  },
  budget: {
    label: 'Budget',
    simpleLabel: 'Votre budget',
    description:
      'Lignes du budget des exercices couverts, mois par mois à partir du mois prochain, hors dotations, reprises et variations de stock. Montants hors taxes. Fait double emploi avec les paiements récurrents ajoutés au budget.',
    simpleDescription: 'Ce que vous avez prévu de vendre et de dépenser chaque mois, à partir du mois prochain, hors TVA.',
    assumption: true,
    empty: 'Aucun budget pour les mois à venir.',
    simpleEmpty: 'Aucun budget pour les mois à venir.',
  },
  trend: {
    label: 'Rythme récent (hypothèse)',
    simpleLabel: 'Si les derniers mois se répètent',
    description:
      'Variation moyenne du solde bancaire sur les trois derniers mois complets, répétée chaque mois à partir du mois prochain. Elle contient déjà les paiements récurrents et les factures réglées : à utiliser seule plutôt qu’en plus du budget ou des paiements récurrents.',
    simpleDescription: 'Ce que votre compte a gagné ou perdu en moyenne chaque mois sur les trois derniers mois, répété pour la suite. C’est une hypothèse.',
    assumption: true,
    empty: 'Pas d’opérations bancaires sur les trois derniers mois.',
    simpleEmpty: 'Pas assez d’historique sur votre compte.',
  },
}

export function isComponent(value: unknown): value is CashForecastComponent {
  return typeof value === 'string' && (CASH_FORECAST_COMPONENTS as readonly string[]).includes(value)
}

/** The components in their canonical order, without duplicates. */
export function normalizeComponents(values: readonly string[]): CashForecastComponent[] {
  const wanted = new Set(values)
  return CASH_FORECAST_COMPONENTS.filter((c) => wanted.has(c))
}

/** The recent pace already contains the recurring payments and what the budget plans: counting both counts twice. */
export function overlapsTrend(components: readonly CashForecastComponent[]): boolean {
  return components.includes('trend') && (components.includes('recurring') || components.includes('budget'))
}
