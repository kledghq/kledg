import {
  ArrowDownLeft,
  BookCheck,
  Boxes,
  FileSpreadsheet,
  ArrowLeftRight,
  ArrowUpRight,
  BadgeCheck,
  BookMarked,
  BookOpen,
  BookText,
  BookUser,
  Building2,
  MapPinned,
  FileInput,
  FileOutput,
  Calendar,
  ChartColumnDecreasing,
  Contact,
  CalendarClock,
  ClipboardCheck,
  FileCode,
  FileText,
  FolderSearch,
  Gauge,
  GraduationCap,
  Banknote,
  Divide,
  HandCoins,
  Hourglass,
  House,
  Info,
  Landmark,
  Calculator,
  LayoutDashboard,
  Library,
  LineChart,
  Link2,
  ListChecks,
  ListTree,
  Network,
  Package,
  Percent,
  PieChart,
  PiggyBank,
  Receipt,
  ReceiptText,
  Repeat,
  Scale,
  ScrollText,
  ShieldAlert,
  Signature,
  Table,
  Target,
  TrendingDown,
  TrendingUp,
  Upload,
  UserRound,
  Users,
  Wallet,
  Workflow,
  type LucideIcon,
} from "lucide-react"
import { vocabularyOf, type DisplayMode } from "@/lib/appearance/display-mode"
import type { NavFeature } from "@/lib/companies/nav-features"

export interface NavItem {
  title: string
  url: string
  icon: LucideIcon
  /** Shown only in a holding: a company recorded as shareholder of another company (lib/management-fees/holding.ts): Frais de gestion, Vue groupe. */
  holdingOnly?: boolean
  /**
   * Shown only to companies that have this feature (lib/companies/nav-features.ts):
   * training (an establishment is an organisme de formation), vatCoefficient
   * (VAT deducted by a coefficient). The page stays reachable by URL.
   */
  feature?: NavFeature
  /** A count shown next to the entry (simple mode, NavCounts of nav-main.tsx). */
  count?: NavCountKey
}

/** Counts the simple navigation shows next to an entry. */
export type NavCountKey = "expensesToCheck" | "incomeToCheck"

export interface NavGroup {
  /**
   * Stable id of the group, stored when a user hides it from their menu
   * (lib/navigation/sidebar-preferences.ts). Never a label: labels may be
   * reworded, a stored id must keep its meaning.
   */
  id: string
  /** Group heading. Omitted for the top group (dashboard). */
  label?: string
  items: NavItem[]
}

// URLs are relative to the current company (/[companyId]/...).
// Order follows how often a small company uses each area: daily bank work
// first, then bookkeeping, statements, and the company settings last.
export const navGroups: NavGroup[] = [
  {
    id: "accueil",
    items: [{ title: "Tableau de bord", url: "/", icon: LayoutDashboard }],
  },
  {
    id: "banque",
    label: "Banque",
    items: [
      { title: "Comptes bancaires", url: "/banking", icon: Landmark },
      { title: "Relevés", url: "/banking/statements", icon: ScrollText },
      { title: "Transactions", url: "/transactions", icon: ArrowLeftRight },
      { title: "Rapprochement", url: "/reconciliation", icon: ListChecks },
      { title: "Justificatifs", url: "/banking/missing-receipts", icon: Receipt },
      { title: "Abonnements", url: "/subscriptions", icon: Repeat },
      { title: "Prévision de trésorerie", url: "/prevision-tresorerie", icon: TrendingUp },
      { title: "Règles d'affectation", url: "/rules", icon: Workflow },
      { title: "Bibliothèque de règles", url: "/rules/library", icon: Library },
    ],
  },
  {
    id: "factures",
    label: "Factures",
    items: [
      { title: "Factures d'achat", url: "/invoices/purchases", icon: FileInput },
      { title: "Factures de vente", url: "/invoices/sales", icon: FileOutput },
      { title: "Tiers", url: "/tiers", icon: BookUser },
      { title: "Notes de frais", url: "/expense-reports", icon: ReceiptText },
      { title: "Mes notes de frais", url: "/expense-reports/mine", icon: Wallet },
      { title: "Frais de gestion", url: "/management-fees", icon: Network, holdingOnly: true },
    ],
  },
  {
    id: "saisie",
    label: "Saisie",
    items: [
      { title: "Écritures", url: "/entries", icon: FileText },
      { title: "Saisies du mode simple", url: "/entries/simple-mode", icon: BadgeCheck },
      { title: "Comptes", url: "/accounts", icon: FolderSearch },
      { title: "Lettrage", url: "/lettering", icon: Link2 },
      { title: "Immobilisations", url: "/fixed-assets", icon: Package },
      { title: "Risques et charges", url: "/provisions", icon: ShieldAlert },
      { title: "Dépréciations", url: "/provisions/impairments", icon: ChartColumnDecreasing },
      { title: "Subventions d'investissement", url: "/investment-grants", icon: HandCoins },
      { title: "Travaux de clôture", url: "/year-end", icon: ClipboardCheck },
      { title: "Méthodes comptables", url: "/accounting-methods", icon: BookCheck },
      { title: "Approbation des comptes", url: "/approval", icon: Signature },
      { title: "Import", url: "/import", icon: Upload },
    ],
  },
  {
    id: "etats",
    label: "États",
    items: [
      { title: "Bilan", url: "/reports/balance-sheet", icon: Scale },
      { title: "Compte de résultat", url: "/reports/income-statement", icon: LineChart },
      { title: "SIG et ratios", url: "/reports/sig", icon: Gauge },
      { title: "Vue groupe", url: "/group", icon: Building2, holdingOnly: true },
      { title: "Budget", url: "/budget", icon: Target },
      { title: "Balance", url: "/reports/trial-balance", icon: Table },
      { title: "Grand livre", url: "/reports/grand-livre", icon: BookOpen },
      { title: "Balance auxiliaire", url: "/reports/auxiliary-balance", icon: Contact },
      { title: "Balance âgée", url: "/reports/aged-balance", icon: Hourglass },
      { title: "Journal", url: "/reports/journal", icon: BookText },
      { title: "Amortissements", url: "/reports/depreciation", icon: TrendingDown },
      { title: "Composition du capital", url: "/reports/capital-composition", icon: PieChart },
      { title: "Immobilisations (2054, 2055)", url: "/reports/fixed-asset-movements", icon: Boxes },
      { title: "Annexe", url: "/reports/annexe", icon: FileSpreadsheet },
      { title: "FEC", url: "/reports/fec", icon: FileCode },
      { title: "Échéances", url: "/echeances", icon: CalendarClock },
      { title: "Déclarations de TVA", url: "/declarations-tva", icon: Percent },
      { title: "Coefficient de déduction de TVA", url: "/coefficient-tva", icon: Divide, feature: "vatCoefficient" },
      { title: "Impôt sur les sociétés", url: "/impot-societes", icon: Calculator },
      { title: "Rémunération et dividendes", url: "/remuneration", icon: PiggyBank },
      { title: "Impôts locaux (CFE, CVAE)", url: "/impots-locaux", icon: MapPinned },
      { title: "Taxe sur les salaires", url: "/taxe-sur-les-salaires", icon: Banknote, feature: "vatCoefficient" },
      { title: "Bilan pédagogique et financier", url: "/bilan-pedagogique-financier", icon: GraduationCap, feature: "training" },
    ],
  },
  {
    id: "societe",
    label: "Société",
    items: [
      { title: "Informations", url: "/informations", icon: Info },
      { title: "Membres", url: "/members", icon: Users },
      { title: "Exercices", url: "/fiscal-years", icon: Calendar },
      { title: "Plan de comptes", url: "/accounts/plan", icon: ListTree },
      { title: "Journaux", url: "/journals", icon: BookMarked },
    ],
  },
]

/**
 * Navigation of the simple mode (docs/mode-simple.md): the words of someone
 * who does not keep books. Entries open the existing pages where they fit;
 * expert pages stay reachable by URL (the mode changes no permission), they
 * are only not listed here.
 * - Accueil, Dépenses, Recettes: the simple pages (app/(company)/[companyId]/simple);
 *   Recettes links to the sales invoices (what customers owe and paid).
 * - Factures: the purchase invoices (the bills received).
 * - Banque: the bank accounts; Justificatifs: the missing receipts.
 * - Mon comptable: the members of the company, where the accountant is.
 */
export const simpleNavGroups: NavGroup[] = [
  {
    id: "simple",
    items: [
      { title: "Accueil", url: "/simple", icon: House },
      { title: "Dépenses", url: "/simple/depenses", icon: ArrowUpRight, count: "expensesToCheck" },
      { title: "Recettes", url: "/simple/recettes", icon: ArrowDownLeft, count: "incomeToCheck" },
      { title: "Factures", url: "/invoices/purchases", icon: FileInput },
      { title: "Banque", url: "/banking", icon: Landmark },
      { title: "Justificatifs", url: "/banking/missing-receipts", icon: Receipt },
      { title: "Mon comptable", url: "/members", icon: UserRound },
    ],
  },
]

/**
 * Pages the Standard mode lists (docs/modes-et-menu.md): the day-to-day
 * pages of the expert navigation, by URL. The Standard sidebar keeps the
 * expert entries whose URL is here, in the expert order, so a page added to
 * the expert navigation stays out of Standard until it is added here. The
 * other pages are only not listed: their URL, the links to them and their
 * breadcrumb title stay (the breadcrumb looks titles up in the expert nav).
 * "Mes notes de frais" follows the expert nav (shown to every member there).
 */
export const STANDARD_NAV_URLS: ReadonlySet<string> = new Set([
  "/",
  "/banking",
  "/transactions",
  "/reconciliation",
  "/banking/missing-receipts",
  "/invoices/purchases",
  "/invoices/sales",
  "/tiers",
  "/expense-reports",
  "/expense-reports/mine",
  "/entries",
  "/reports/balance-sheet",
  "/reports/income-statement",
  "/echeances",
  "/declarations-tva",
  "/impot-societes",
  "/informations",
  "/members",
])

/** The Standard navigation: the expert groups reduced to STANDARD_NAV_URLS, empty groups left out. */
export const standardNavGroups: NavGroup[] = navGroups
  .map((group) => ({ ...group, items: group.items.filter((item) => STANDARD_NAV_URLS.has(item.url)) }))
  .filter((group) => group.items.length > 0)

/** The sidebar of a display mode. */
export function navGroupsFor(mode: DisplayMode): NavGroup[] {
  if (mode === "simple") return simpleNavGroups
  return mode === "standard" ? standardNavGroups : navGroups
}

/**
 * The navigation that names the pages of a mode (breadcrumb, tab title,
 * which entry a page belongs to): the expert one for Standard too, so a page
 * Standard does not list keeps its title and section.
 */
export function titleNavGroupsFor(mode: DisplayMode): NavGroup[] {
  return vocabularyOf(mode) === "simple" ? simpleNavGroups : navGroups
}

/** Company-relative URL of the home entry of each vocabulary: never hidden from the menu. */
export const HOME_URLS: ReadonlySet<string> = new Set(["/", "/simple"])

/**
 * Pages reached from another page rather than from the sidebar. Without a
 * title here they would borrow the title of their nav entry ("Comptes
 * bancaires" on "Connecter une banque") and the breadcrumb would say
 * "Détail". `[id]` matches one path segment.
 */
const subPages: Array<{ path: string; title: string }> = [
  { path: "/reports", title: "États" },
  { path: "/banking/connect", title: "Connecter une banque" },
  { path: "/banking/connect/ponto", title: "Connecter une banque" },
  { path: "/banking/connect/revolut", title: "Connecter Revolut Business" },
  { path: "/reports/balance-sheet/config", title: "Configuration du bilan" },
  { path: "/reports/income-statement/config", title: "Configuration du compte de résultat" },
  { path: "/entries/new", title: "Nouvelle écriture" },
  { path: "/entries/[id]/edit", title: "Modifier l'écriture" },
  { path: "/simple/depenses", title: "Dépenses à vérifier" },
  { path: "/simple/recettes", title: "Recettes à vérifier" },
  // Simple mode: reached from the cash alert of the home (a sidebar entry in expert mode, whose title wins there)
  { path: "/prevision-tresorerie", title: "Votre argent à venir" },
  { path: "/entries/[id]", title: "Écriture" },
  { path: "/fiscal-years/opening-balances", title: "Bilan d'ouverture" },
  { path: "/invoices/new", title: "Nouvelle facture" },
  { path: "/invoices/[id]/edit", title: "Modifier la facture" },
  { path: "/invoices/[id]", title: "Facture" },
  { path: "/tiers/new", title: "Nouveau tiers" },
  { path: "/rules/new", title: "Nouvelle règle" },
  { path: "/rules/[id]", title: "Règle" },
  { path: "/expense-reports/new", title: "Nouvelle note de frais" },
  { path: "/expense-reports/settings", title: "Bénéficiaires et catégories" },
  { path: "/expense-reports/[id]/edit", title: "Modifier la note de frais" },
  { path: "/expense-reports/[id]", title: "Note de frais" },
  { path: "/tiers/[id]", title: "Tiers" },
  { path: "/management-fees/new", title: "Nouvelle convention" },
  { path: "/management-fees/[id]/edit", title: "Modifier la convention" },
  { path: "/management-fees/[id]", title: "Convention de frais de gestion" },
]

function matchesPattern(pattern: string, relativePath: string): boolean {
  const expected = pattern.split("/")
  const actual = relativePath.replace(/\/+$/, "").split("/")
  return expected.length === actual.length && expected.every((part, i) => part === "[id]" ? actual[i] !== "" : part === actual[i])
}

/**
 * Title of a company page that is not a sidebar entry itself ("Connecter une
 * banque"), or null for sidebar pages and unknown paths.
 */
export function findSubPageTitle(relativePath: string): { title: string } | null {
  const page = subPages.find((p) => matchesPattern(p.path, relativePath))
  return page ? { title: page.title } : null
}

/** Finds the nav entry matching a company-relative path (longest prefix wins), in the navigation given (expert by default). */
export function findNavEntry(relativePath: string, groups: readonly NavGroup[] = navGroups) {
  let best: { group: string; title: string; url: string } | null = null
  for (const group of groups) {
    for (const item of group.items) {
      const match =
        item.url === '/'
          ? relativePath === '/'
          : relativePath === item.url || relativePath.startsWith(item.url + '/')
      if (match && (!best || item.url.length > best.url.length)) {
        best = { group: group.label ?? '', title: item.title, url: item.url }
      }
    }
  }
  return best
}
