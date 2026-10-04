/**
 * Registry of the dashboard widgets: what each one shows, who may see it,
 * which data source feeds it, the sizes it supports, and the default layout
 * of each role. Pure (no database, no server import): the page, the API
 * routes and the tests read the same definitions.
 *
 * A widget reads one data source (lib/dashboard/load-widget-data.service.ts).
 * Widgets of the same source share one request: the six indicators of the
 * ledger come from one aggregate of the fiscal year, not six.
 *
 * Adding a widget: add its definition here, its renderer in
 * components/features/dashboard/widgets, and, when it should appear for new
 * users, its place in DEFAULT_LAYOUTS. Saved layouts keep working: unknown
 * ids are ignored (lib/dashboard/layout.ts) and a new widget waits in the
 * catalogue of users who already customized their dashboard.
 */

import type { Permission } from '@/lib/rbac/authorize'
import { DEADLINES_PERMISSION } from '@/lib/deadlines/permissions'

/** S: one column; M: two columns; L: the whole row (columns depend on the width, see the grid). */
export const WIDGET_SIZES = ['S', 'M', 'L'] as const
export type WidgetSize = (typeof WIDGET_SIZES)[number]

export const WIDGET_SIZE_LABELS: Record<WidgetSize, string> = { S: 'Petit', M: 'Moyen', L: 'Large' }

export type WidgetCategory = 'guide' | 'kpi' | 'chart' | 'list'

export const WIDGET_CATEGORY_LABELS: Record<WidgetCategory, string> = {
  guide: 'Guide',
  kpi: 'Indicateurs',
  chart: 'Graphiques',
  list: 'Listes',
}

/**
 * Data sources, each loaded by one request (GET /api/dashboard/widgets?source=).
 * `onboarding` is the "Démarrer" checklist, read from its own route.
 */
export const WIDGET_SOURCES = [
  'ledger',
  'monthly',
  'treasury',
  'reconciliation',
  'drafts',
  'recent-entries',
  'bank-accounts',
  'rules',
  'aged-balance',
  'deadlines',
  'onboarding',
] as const
export type WidgetSource = (typeof WIDGET_SOURCES)[number]

/** What reading a source requires; the API checks it again on every request. */
export const SOURCE_PERMISSIONS: Record<WidgetSource, Permission> = {
  ledger: { reports: ['read'] },
  monthly: { reports: ['read'] },
  treasury: { reports: ['read'] },
  reconciliation: { banking: ['read'] },
  drafts: { entries: ['read'] },
  'recent-entries': { entries: ['read'] },
  'bank-accounts': { banking: ['read'] },
  rules: { banking: ['read'] },
  'aged-balance': { reports: ['read'] },
  // Tax and legal deadlines: reading the accounts, like the page /echeances.
  deadlines: DEADLINES_PERMISSION,
  // The checklist is for the members who keep the books (as before: canManage).
  onboarding: { ledger: ['manage'] },
}

export interface WidgetDefinition {
  id: string
  /** Heading of the widget (French). */
  title: string
  /** One sentence for the catalogue "Ajouter un widget". */
  description: string
  category: WidgetCategory
  source: WidgetSource
  /** Sizes offered in the edit mode. */
  sizes: readonly WidgetSize[]
  defaultSize: WidgetSize
}

const KPI_SIZES = ['S', 'M'] as const
const WIDE_SIZES = ['M', 'L'] as const

export const WIDGETS = [
  {
    id: 'guide-demarrer',
    title: 'Démarrer',
    description: "Les étapes pour que Kledg tienne vos comptes. Disparaît une fois toutes les étapes faites ou le guide masqué.",
    category: 'guide',
    source: 'onboarding',
    sizes: ['L'],
    defaultSize: 'L',
  },
  {
    id: 'kpi-chiffre-affaires',
    title: "Chiffre d'affaires",
    description: "Ventes et prestations de l'exercice (comptes 70), hors taxes.",
    category: 'kpi',
    source: 'ledger',
    sizes: KPI_SIZES,
    defaultSize: 'S',
  },
  {
    id: 'kpi-produits',
    title: 'Produits',
    description: "Tous les produits de l'exercice (classe 7)\u00a0: chiffre d'affaires, subventions, produits financiers.",
    category: 'kpi',
    source: 'ledger',
    sizes: KPI_SIZES,
    defaultSize: 'S',
  },
  {
    id: 'kpi-charges',
    title: 'Charges',
    description: "Toutes les charges de l'exercice (classe 6)\u00a0: achats, services, impôts, salaires, dotations.",
    category: 'kpi',
    source: 'ledger',
    sizes: KPI_SIZES,
    defaultSize: 'S',
  },
  {
    id: 'kpi-resultat',
    title: 'Résultat',
    description: "Produits moins charges de l'exercice, comparé à la même période de l'exercice précédent.",
    category: 'kpi',
    source: 'ledger',
    sizes: KPI_SIZES,
    defaultSize: 'S',
  },
  {
    id: 'kpi-tresorerie',
    title: 'Trésorerie',
    description: 'Solde des comptes 512 en comptabilité, et solde déclaré par vos banques.',
    category: 'kpi',
    source: 'ledger',
    sizes: KPI_SIZES,
    defaultSize: 'S',
  },
  {
    id: 'kpi-a-rapprocher',
    title: 'À rapprocher',
    description: 'Nombre de transactions bancaires qui attendent leur écriture.',
    category: 'kpi',
    source: 'reconciliation',
    sizes: KPI_SIZES,
    defaultSize: 'S',
  },
  {
    id: 'kpi-tva',
    title: 'TVA',
    description: "Estimation de la TVA à payer ou du crédit de TVA, d'après les soldes des comptes 445.",
    category: 'kpi',
    source: 'ledger',
    sizes: KPI_SIZES,
    defaultSize: 'S',
  },
  {
    id: 'kpi-marge',
    title: 'Marge commerciale',
    description: "Ventes de marchandises moins leur coût d'achat, pour les sociétés qui revendent des marchandises.",
    category: 'kpi',
    source: 'ledger',
    sizes: KPI_SIZES,
    defaultSize: 'S',
  },
  {
    id: 'kpi-creances-clients',
    title: 'Créances clients',
    description: 'Ce que vos clients vous doivent encore (solde des comptes 411).',
    category: 'kpi',
    source: 'ledger',
    sizes: KPI_SIZES,
    defaultSize: 'S',
  },
  {
    id: 'kpi-dettes-fournisseurs',
    title: 'Dettes fournisseurs',
    description: 'Ce que vous devez encore à vos fournisseurs (solde des comptes 401).',
    category: 'kpi',
    source: 'ledger',
    sizes: KPI_SIZES,
    defaultSize: 'S',
  },
  {
    id: 'chart-produits-charges',
    title: 'Produits et charges par mois',
    description: "Produits et charges de chaque mois de l'exercice, côte à côte.",
    category: 'chart',
    source: 'monthly',
    sizes: WIDE_SIZES,
    defaultSize: 'M',
  },
  {
    id: 'chart-tresorerie',
    title: 'Trésorerie dans le temps',
    description: "Solde des comptes 512 à la fin de chaque mois de l'exercice.",
    category: 'chart',
    source: 'treasury',
    sizes: WIDE_SIZES,
    defaultSize: 'M',
  },
  {
    id: 'chart-repartition-charges',
    title: 'Répartition des charges',
    description: "Les charges de l'exercice par poste, des comptes 60 aux comptes 65.",
    category: 'chart',
    source: 'ledger',
    sizes: WIDE_SIZES,
    defaultSize: 'M',
  },
  {
    id: 'list-a-rapprocher',
    title: 'Opérations à rapprocher',
    description: 'Les dernières transactions bancaires sans écriture, avec un lien vers le rapprochement.',
    category: 'list',
    source: 'reconciliation',
    sizes: WIDE_SIZES,
    defaultSize: 'M',
  },
  {
    id: 'list-brouillons',
    title: 'Brouillons à valider',
    description: "Les écritures de l'exercice encore en brouillon, à vérifier puis valider.",
    category: 'list',
    source: 'drafts',
    sizes: ['S', 'M', 'L'],
    defaultSize: 'M',
  },
  {
    id: 'list-dernieres-ecritures',
    title: 'Dernières écritures',
    description: "Les cinq écritures les plus récentes de l'exercice.",
    category: 'list',
    source: 'recent-entries',
    sizes: WIDE_SIZES,
    defaultSize: 'M',
  },
  {
    id: 'list-comptes-bancaires',
    title: 'Comptes bancaires',
    description: 'Solde de chaque compte, dernière synchronisation et accès bancaires à renouveler.',
    category: 'list',
    source: 'bank-accounts',
    sizes: WIDE_SIZES,
    defaultSize: 'L',
  },
  {
    id: 'list-creances-dettes-echues',
    title: 'Créances et dettes échues',
    description:
      "Ce que vos clients doivent après l'échéance et ce que vous devez à vos fournisseurs, d'après la balance âgée, avec les tiers les plus en retard.",
    category: 'list',
    source: 'aged-balance',
    sizes: WIDE_SIZES,
    defaultSize: 'M',
  },
  {
    id: 'list-echeances',
    title: 'Échéances',
    description: 'Les déclarations et paiements fiscaux et les obligations juridiques des 60 prochains jours, avec un lien vers le calendrier complet.',
    category: 'list',
    source: 'deadlines',
    sizes: ['S', 'M', 'L'],
    defaultSize: 'M',
  },
  {
    id: 'list-regles',
    title: "Règles d'affectation les plus utilisées",
    description: 'Les règles qui ont comptabilisé le plus de transactions.',
    category: 'list',
    source: 'rules',
    sizes: WIDE_SIZES,
    defaultSize: 'M',
  },
] as const satisfies readonly WidgetDefinition[]

export type WidgetId = (typeof WIDGETS)[number]['id']

const BY_ID = new Map<string, WidgetDefinition>(WIDGETS.map((w) => [w.id, w]))

export function getWidget(id: string): WidgetDefinition | undefined {
  return BY_ID.get(id)
}

export function isWidgetId(id: string): id is WidgetId {
  return BY_ID.has(id)
}

/** What a user needs to see the widget: the permission of its source. */
export function widgetPermission(widget: WidgetDefinition): Permission {
  return SOURCE_PERMISSIONS[widget.source]
}

export type LayoutItem = {
  id: WidgetId
  size: WidgetSize
}

/**
 * Default dashboards, by what the role does in the company:
 * - owner (instance administrators, company administrators): the four
 *   numbers a small company owner checks (chiffre d'affaires, résultat,
 *   trésorerie, à rapprocher), the year by month, then the work waiting
 *   and the coming tax deadlines;
 * - accountant: the work first (brouillons, à rapprocher, TVA, échéances),
 *   then the numbers;
 * - viewer: indicators and charts only, nothing to act on.
 * The "Démarrer" checklist leads while the company is being set up; it
 * disappears by itself once done or hidden.
 */
export type DashboardProfile = 'owner' | 'accountant' | 'viewer'

const item = (id: WidgetId, size?: WidgetSize): LayoutItem => ({ id, size: size ?? (getWidget(id) as WidgetDefinition).defaultSize })

export const DEFAULT_LAYOUTS: Record<DashboardProfile, readonly LayoutItem[]> = {
  owner: [
    item('guide-demarrer'),
    item('kpi-chiffre-affaires'),
    item('kpi-resultat'),
    item('kpi-tresorerie'),
    item('kpi-a-rapprocher'),
    item('chart-produits-charges'),
    item('chart-tresorerie'),
    item('list-a-rapprocher'),
    item('list-echeances'),
    item('list-brouillons'),
    item('list-creances-dettes-echues'),
    item('list-comptes-bancaires'),
  ],
  accountant: [
    item('guide-demarrer'),
    item('list-brouillons'),
    item('list-a-rapprocher'),
    item('kpi-tva'),
    item('list-echeances'),
    item('kpi-resultat'),
    item('kpi-chiffre-affaires'),
    item('kpi-a-rapprocher'),
    item('list-creances-dettes-echues'),
    item('chart-produits-charges'),
    item('list-dernieres-ecritures'),
    item('chart-repartition-charges'),
    item('list-regles'),
  ],
  viewer: [
    item('kpi-chiffre-affaires'),
    item('kpi-charges'),
    item('kpi-resultat'),
    item('kpi-tresorerie'),
    item('chart-produits-charges'),
    item('chart-tresorerie'),
    item('chart-repartition-charges', 'L'),
  ],
}

/**
 * The profile of a user from their roles in the company (a member row may
 * hold several roles: the one with the most rights wins). Instance
 * administrators get ['admin'] from the route wrapper.
 */
export function profileOf(roles: readonly string[]): DashboardProfile {
  if (roles.some((r) => r === 'admin' || r === 'owner' || r === 'companyAdmin')) return 'owner'
  if (roles.includes('accountant')) return 'accountant'
  return 'viewer'
}
