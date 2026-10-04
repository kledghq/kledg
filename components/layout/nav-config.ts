import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  BookMarked,
  BookOpen,
  BookText,
  BookUser,
  Building2,
  FileInput,
  FileOutput,
  Calendar,
  Contact,
  CalendarClock,
  ClipboardCheck,
  FileCode,
  FileText,
  FolderSearch,
  Gauge,
  HandCoins,
  Hourglass,
  House,
  Info,
  Landmark,
  LayoutDashboard,
  LineChart,
  Link2,
  ListChecks,
  ListTree,
  Network,
  Package,
  PieChart,
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
  Upload,
  UserRound,
  Users,
  Wallet,
  Workflow,
  type LucideIcon,
} from "lucide-react"
import type { DisplayMode } from "@/lib/appearance/display-mode"

export interface NavItem {
  title: string
  url: string
  icon: LucideIcon
  /** Shown only in a holding: a company recorded as shareholder of another company (lib/management-fees/holding.ts): Frais de gestion, Vue groupe. */
  holdingOnly?: boolean
  /** A count shown next to the entry (simple mode, NavCounts of nav-main.tsx). */
  count?: NavCountKey
}

/** Counts the simple navigation shows next to an entry. */
export type NavCountKey = "expensesToCheck"

export interface NavGroup {
  /** Group heading. Omitted for the top group (dashboard). */
  label?: string
  items: NavItem[]
}

// URLs are relative to the current company (/[companyId]/...).
// Order follows how often a small company uses each area: daily bank work
// first, then bookkeeping, statements, and the company settings last.
export const navGroups: NavGroup[] = [
  {
    items: [{ title: "Tableau de bord", url: "/", icon: LayoutDashboard }],
  },
  {
    label: "Banque",
    items: [
      { title: "Comptes bancaires", url: "/banking", icon: Landmark },
      { title: "Relevés", url: "/banking/statements", icon: ScrollText },
      { title: "Transactions", url: "/transactions", icon: ArrowLeftRight },
      { title: "Rapprochement", url: "/reconciliation", icon: ListChecks },
      { title: "Justificatifs manquants", url: "/banking/missing-receipts", icon: Receipt },
      { title: "Abonnements", url: "/subscriptions", icon: Repeat },
      { title: "Règles d'affectation", url: "/rules", icon: Workflow },
    ],
  },
  {
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
    label: "Saisie",
    items: [
      { title: "Écritures", url: "/entries", icon: FileText },
      { title: "Comptes", url: "/accounts", icon: FolderSearch },
      { title: "Lettrage", url: "/lettering", icon: Link2 },
      { title: "Immobilisations", url: "/fixed-assets", icon: Package },
      { title: "Provisions et dépréciations", url: "/provisions", icon: ShieldAlert },
      { title: "Subventions d'investissement", url: "/investment-grants", icon: HandCoins },
      { title: "Travaux de clôture", url: "/year-end", icon: ClipboardCheck },
      { title: "Approbation des comptes", url: "/approval", icon: Signature },
      { title: "Import", url: "/import", icon: Upload },
    ],
  },
  {
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
      { title: "FEC", url: "/reports/fec", icon: FileCode },
      { title: "Échéances", url: "/echeances", icon: CalendarClock },
    ],
  },
  {
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
 * - Accueil, Dépenses: the simple pages (app/(company)/[companyId]/simple).
 * - Recettes: the sales invoices (what customers owe and paid).
 * - Factures: the purchase invoices (the bills received).
 * - Banque: the bank accounts; Justificatifs: the missing receipts.
 * - Mon comptable: the members of the company, where the accountant is.
 */
export const simpleNavGroups: NavGroup[] = [
  {
    items: [
      { title: "Accueil", url: "/simple", icon: House },
      { title: "Dépenses", url: "/simple/depenses", icon: ArrowUpRight, count: "expensesToCheck" },
      { title: "Recettes", url: "/invoices/sales", icon: ArrowDownLeft },
      { title: "Factures", url: "/invoices/purchases", icon: FileInput },
      { title: "Banque", url: "/banking", icon: Landmark },
      { title: "Justificatifs", url: "/banking/missing-receipts", icon: Receipt },
      { title: "Mon comptable", url: "/members", icon: UserRound },
    ],
  },
]

/** The navigation of a display mode. */
export function navGroupsFor(mode: DisplayMode): NavGroup[] {
  return mode === "simple" ? simpleNavGroups : navGroups
}

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
  { path: "/entries/[id]", title: "Écriture" },
  { path: "/fiscal-years/opening-balances", title: "Bilan d'ouverture" },
  { path: "/invoices/new", title: "Nouvelle facture" },
  { path: "/invoices/[id]/edit", title: "Modifier la facture" },
  { path: "/invoices/[id]", title: "Facture" },
  { path: "/tiers/new", title: "Nouveau tiers" },
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
