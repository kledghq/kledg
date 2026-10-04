/**
 * Rules of management fees (frais de gestion) on plain values, without
 * imports: the convention form (client) and the services (server) share
 * them. docs/frais-de-gestion.md explains them to users.
 *
 * Transfer pricing. Fees between companies of a group must be at arm's
 * length: a price that independent companies would agree on. For services
 * a holding renders to its subsidiaries (management, accounting, IT, legal),
 * the usual method is cost plus: the costs of rendering the services plus a
 * mark-up.
 * - OECD Transfer Pricing Guidelines (2022), chapter VII "Special
 *   considerations for intra-group services": a service is chargeable only if
 *   it has economic value for the subsidiary (benefit test, §7.6); shareholder
 *   activities (the holding's own governance, its financing, its reporting as
 *   a parent) are not chargeable (§7.9 to 7.10); the simplified approach for
 *   low value-adding services allows a 5 % mark-up on the pooled costs
 *   (§7.61). The mark-up of genuine management services is commonly between
 *   5 % and 10 %.
 * - BOFiP BOI-BIC-BASE-80 (CGI art. 57, transfers of profits abroad): the
 *   French tax administration applies these principles and may reassess a
 *   price that departs from the arm's length price. Between two French
 *   companies the same reasoning applies through the "acte anormal de
 *   gestion" doctrine (CGI art. 38 and 39, 1): a fee without a real service,
 *   or above its value, is not deductible at the subsidiary; a fee below cost
 *   is an abnormal advantage granted by the holding.
 * Kledg computes and documents the price; it does not judge whether a
 * mark-up is at arm's length: that is the convention's (and the adviser's).
 *
 * Rates are integer basis points (500 = 5 %): no float touches an amount.
 */

export type ManagementFeePricing = 'COST_PLUS' | 'FIXED'
export type ManagementFeeAllocationKey = 'EQUAL' | 'REVENUE' | 'CUSTOM'

export const PRICING_LABELS: Record<ManagementFeePricing, string> = {
  COST_PLUS: 'Coûts majorés d’une marge',
  FIXED: 'Montant forfaitaire',
}

export const ALLOCATION_KEY_LABELS: Record<ManagementFeeAllocationKey, string> = {
  EQUAL: 'Parts égales',
  REVENUE: 'Chiffre d’affaires des filiales',
  CUSTOM: 'Pourcentages fixés',
}

/** Every class 6 account by default. */
export const DEFAULT_COST_PREFIXES: readonly string[] = ['6']

/**
 * Charges left out of the cost pool by default, each with its reason: they
 * are not costs of rendering services to the subsidiaries (PCG 2025 account
 * numbers, lib/accounting/pcg-data.ts).
 */
export const DEFAULT_EXCLUDED_PREFIXES: ReadonlyArray<{ prefix: string; reason: string }> = [
  { prefix: '657', reason: 'Valeur comptable des immobilisations cédées\u00a0: une cession, pas un coût du service' },
  { prefix: '6582', reason: 'Pénalités et amendes fiscales et pénales\u00a0: non déductibles (CGI art. 39, 2)' },
  { prefix: '66', reason: 'Charges financières\u00a0: le financement de la holding relève de son activité d’actionnaire' },
  { prefix: '67', reason: 'Charges exceptionnelles\u00a0: sans lien avec les services courants' },
  { prefix: '686', reason: 'Dotations financières' },
  { prefix: '687', reason: 'Dotations exceptionnelles' },
  { prefix: '695', reason: 'Impôt sur les bénéfices de la holding' },
  { prefix: '696', reason: 'Suppléments d’impôt sur les sociétés' },
  { prefix: '697', reason: 'Imposition forfaitaire annuelle' },
  { prefix: '698', reason: 'Intégration fiscale' },
  { prefix: '699', reason: 'Produits de report en arrière des déficits' },
]

/** Mark-ups outside this range are allowed but flagged in the form (OECD TPG §7.61: 5 % for low value-adding services). */
export const USUAL_MARKUP_RANGE_BP = { min: 500, max: 1000 } as const

export const DEFAULT_REVENUE_ACCOUNT = '706'
export const DEFAULT_EXPENSE_ACCOUNT = '6226'
export const DEFAULT_INVOICE_PREFIX = 'FG'

/** Revenue of a subsidiary for the REVENUE key: its class 70 accounts (chiffre d'affaires, PCG art. 946-70). */
export const REVENUE_PREFIX = '70'

/** Whether an account code is in the cost pool: it matches an included prefix and no excluded one. */
export function isPooledAccount(code: string, included: readonly string[], excluded: readonly string[]): boolean {
  return included.some((p) => code.startsWith(p)) && !excluded.some((p) => code.startsWith(p))
}

/** "5 %", "7,5 %" from basis points (narrow no-break space before %). */
export function formatRateBp(rateBp: number): string {
  const whole = Math.trunc(rateBp / 100)
  const decimals = String(rateBp % 100).padStart(2, '0').replace(/0+$/, '')
  return `${whole}${decimals ? `,${decimals}` : ''} %`
}

/**
 * Basis points of a percentage typed by a user ("5", "7,5", "33.33"), two
 * decimals at most, between 0 and 100; null otherwise.
 */
export function parsePercentBp(input: string): number | null {
  const match = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(input.trim().replace(/[\s  %]/g, ''))
  if (!match) return null
  const bp = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
  return bp <= 10000 ? bp : null
}

/** A percentage in basis points written for an input ("7,5"). */
export function percentInput(bp: number): string {
  return formatRateBp(bp).replace(' %', '')
}
