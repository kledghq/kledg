# UI audit (October 2026)

Audit of every screen of the app at 1440px, 1024px and 375px, light and dark,
on seeded data (four fictitious companies).
Method: screenshots of each screen, plus a script run in the browser on every
route and width that measured horizontal page scroll, button and field
heights, unnamed buttons, unlabelled fields, tables wider than their
container, `h1` count and raw palette colors. Keyboard checks: Tab order from
the skip link, Escape on dialogs, popovers and the mobile drawer.

Rules referenced below are in [design-system.md](design-system.md).

Priorities:

- **P1**: broken or confusing (blocks a task, loses data, misleads a beginner,
  page scrolls sideways on a phone, inaccessible control).
- **P2**: inconsistent (sizes, wording, colors, patterns differ from one
  screen to the next).
- **P3**: polish.

Status: **Fait** (fixed in phase 1), **Phase 2** (screen owned by another
workstream, fix after their merge), **Ouvert** (needs a decision, see the end).

## Cross-cutting findings

| # | Pri. | Finding | Change | Status |
|---|---|---|---|---|
| X1 | P2 | Tokens drifted from the website: default shadcn grays, 0.625rem radius, blue sidebar accent in dark mode, chart colors from five hues, no success/warning/info tokens so screens used raw `green-600`, `amber-600`, `blue-500` (about 140 occurrences). | Tokens copied from the website theme (neutral base, ink primary, green accent for focus/links/marks, semantic status tokens, 0.5rem radius scale, tabular figures). ESLint rejects raw palette classes. | Fait: no raw palette class left, `PHASE_2_FILES` is empty and the guards are errors everywhere |
| X2 | P2 | Button heights mixed in one row (36px default next to 32px `sm` next to 40px overrides), icon buttons resized through `className` (`h-8 w-8`, `size-7`), icons with `mr-2` inside buttons that already have a gap (double spacing). | Documented size scale (`xs` 28, `sm` 32, `default` 36, `lg` 40 and icon sizes), `loading` prop, icon margins neutralized in Button. ESLint rejects size classes on Button. | Fait: no size override left; the last 17 raw colors (statement import dialog, account detail and its chart) are gone |
| X3 | P2 | Inconsistent wording: "Exercice fiscal" vs "Exercice", "Actif" vs "Ouvert", "Type juridique" vs "Forme juridique", "Revenus" vs "Produits", "Chiffre d'affaires" for the class 7 total, English left in UI ("Close", "Toggle Sidebar", "Command Palette", "Rows per page", "View", "Provider", "transfer", "card"). | Unified on "Exercice", "ouvert / clôturé", "Forme juridique", "Produits"; French labels in all shared components. | Fait ("Provider" was already gone from the bank screens) |
| X4 | P1 | Native `window.confirm` and `alert` dialogs (members, API keys, establishments, shareholders, tax regimes, company creation, rules, report configs, import) cannot be styled, do not name the action and block the tab. | `ConfirmDialog` and promise based `useConfirm()`; toasts instead of `alert`. Lint error everywhere, test guard without exceptions. | Fait |
| X5 | P2 | Amounts formatted ad hoc (about 40 `Intl.NumberFormat` and `toFixed` calls, some with 0 decimals, some colored green/red by sign), dates with `toLocaleDateString` (25 calls) and one en-US style pattern ("sept. 03, 2026"). | `Amount` / `formatAmount` and `DateDisplay` / `formatDisplayDate` (French, tabular, UTC calendar days). Used on the dashboard, fiscal years, settings. | Fait (components; adopted on every phase 2 screen, the account detail and bank screens included) |
| X6 | P1 | Tables overflowed the page on phones (fiscal years pagination, transactions pagination, informations integrations) and long tables lost their header when scrolling. | Table scrolls inside its own container, `stickyHeader`, `numeric` cells, `TableEmpty`, `TableSkeleton`. Grid overflow guard in base CSS. | Fait (shared, phase 1 and transactions) |
| X7 | P2 | Empty states were centered paragraphs or `Alert` boxes with no next step; the shared EmptyState was a centered hero with a colored circle. | Compact left aligned EmptyState with next step and docs link; `TableEmpty` for tables. | Fait |
| X8 | P1 | Accessibility: icon only buttons without names (journals were fine, members, settings, header refresh and theme, tree toggles were not), labels not tied to selects and comboboxes, no skip link, nested `main` landmarks, no `h1` on the dashboard, import and FEC pages, dialog close labelled "Close", focus ring color barely visible on dark. | Names on every icon button in the shell and phase 1 pages, `Field` wires label/hint/error, skip link, one `main`, page `h1` through PageHeader, French sr-only labels, green focus ring at 3px. | Fait (shell and phase 1), Phase 2 per screen (counts below) |
| X9 | P2 | No document titles: every tab read "Kledg". | "Page · Société · Kledg" on company pages, static titles on account and auth pages. | Fait |
| X10 | P2 | Dialogs touched the screen edges on phones and could not scroll; a caller's `max-w-3xl` was silently capped at 32rem by an `sm:` class (closing dialog). | Dialog width from `calc(100% - 2rem)` with `max-w-lg` default, `max-h` with scroll, left aligned headers. | Fait |
| X11 | P3 | Cards with `shadow-sm`, `rounded-xl` and 24px padding next to 20px headers; gradients on dashboard cards; hover scale animation on company cards. | Hairline cards, `rounded-lg`, 20px padding, no gradients, no hover motion. | Fait |
| X12 | P2 | No 404 or error page: Next.js defaults in English. | French 404, error page inside the company layout with retry and reference, self-contained global error. | Fait |

## Layout shell (header, sidebar, tasks, theme)

| # | Pri. | Finding | Change | Status |
|---|---|---|---|---|
| S1 | P2 | Sidebar order did not follow use: company settings first, daily bank work in the middle, a group "Immobilisations" with one item, "Vue d'ensemble" with one item. Icons reused (Table, BookOpen, ScrollText twice). | Order Tableau de bord, Banque, Saisie (with Immobilisations), États, Société; one icon per entry (tested). | Fait, see open question Q1 |
| S2 | P1 | Active state used exact URL matching: on an account detail or an entry edit page no entry was highlighted; on `/accounts/plan` "Comptes" logic depended on localStorage. | Longest prefix match shared with the breadcrumb, `aria-current="page"`. | Fait |
| S3 | P2 | Mobile drawer stayed open after choosing a page. | Closes on navigation. | Fait |
| S4 | P2 | Header 64px with 36px icon buttons, docs button without accessible name (only `title`), tasks badge in solid red with no label, refresh button and tasks popover worded "refresh". | 56px sticky header, 32px icon buttons with names, neutral count badge, popover lists "Transactions à rapprocher" with a link, French toasts. | Fait |
| S5 | P3 | Theme menu used an emoji for "Système" and did not show the current choice. | Radio menu with Sun / Moon / Monitor icons. | Fait |
| S6 | P2 | Breadcrumb showed "Société" until the name loaded, wrapped on narrow screens. | Placeholder bar, truncation, only the page name on phones. | Fait |
| S7 | P3 | Company switcher: blue Building icon, "Sélectionner", "Ajouter une société" link that only opens the list. | Monogram tiles, "Choisir une société", "Gérer les sociétés". | Fait |
| S8 | P3 | Instance banner in inverted ink across the top, heavier than any content. | Subtle surface banner. | Fait |
| S9 | P3 | User menu avatar was a settings gear. | Initials. | Fait |

## Tableau de bord

| # | Pri. | Finding | Change | Status |
|---|---|---|---|---|
| D1 | P1 | "Chiffre d'affaires" showed the class 7 total (all produits, not only 70x): wrong for a beginner reading the screen. | Labelled "Produits" with a help tip explaining classes 6 and 7 and where the chiffre d'affaires fits. | Fait |
| D2 | P1 | Smoothed area chart overshot below zero between months and used a red/green pair (also unreadable for red/green color blindness). | Monthly bars, green accent against neutral gray, legend, compact axis, French tooltip amounts. | Fait |
| D3 | P2 | No page title; period toggle said "1 an" while the label said "Exercice complet" (it is the year to date). | PageHeader with period controls; "Exercice" and "Depuis le début de l'exercice", "Dernier mois". | Fait |
| D4 | P2 | Variation badges colored green or amber depending on an implicit judgement, without saying what they compare to. | Neutral arrow and "par rapport à la période précédente". | Fait |
| D5 | P1 | No fiscal year: zero cards with no explanation. Error: one grey sentence. | Empty state "Aucun exercice pour cette société" with action and docs; error state with retry. | Fait |
| D6 | P3 | Double fetch on load (before and after the fiscal year list) made the cards flash. | Wait for the fiscal year list. | Fait |
| D7 | P1 | Around 800px the three stat cards sat next to the sidebar and cut their amounts ("97 950,0..."). | Tiles fill as many 15rem columns as fit, StatCard never truncates and sizes its value to the card, amounts from 10 M€ show in compact form with the full amount for screen readers. | Fait |
| D8 | P2 | One fixed dashboard for every role; one request for everything (a slow chart held the numbers back); no chiffre d'affaires, TVA, créances or work waiting (brouillons, à rapprocher). | Widgets per user and company ([tableau-de-bord.md](tableau-de-bord.md)): default per role, "Personnaliser" (catalogue, drag and drop or Monter/Descendre, sizes S/M/L on a container grid, reset), each source loads on its own with its skeleton and retry, one `h2` per widget, changes announced. | Fait |

## Sociétés (liste et création)

| # | Pri. | Finding | Change | Status |
|---|---|---|---|---|
| C1 | P2 | Card grid with hover scale, blue tile, no way to open a company dashboard from its card. | Bordered list: monogram, name linking to the dashboard, forme juridique, SIREN, clôture; Informations and Modifier actions. | Fait |
| C2 | P1 | `alert()` on create and update errors. | Toasts, success toasts. | Fait |
| C3 | P1 | Creation form grids in two columns at 375px. | Columns from `sm`. | Fait |
| C4 | P2 | Forme juridique at the end of the form; EURL labelled "Société unipersonnelle". | Right after the SIREN; legal name "Entreprise unipersonnelle à responsabilité limitée". | Fait |
| C5 | P1 | Forme juridique list has no SASU, SCI or SELARL although they are the target users. | SASU, SCI, SELARL, SELAS and EI added (additive migration 20261008090000); the form shows as a small tag next to the name (switcher, list, header, wizard). | Fait (Q3) |
| C6 | P2 | Deletion confirmation "Êtes-vous sûr ?" without naming the company. | Names it and says what is lost, suggests exporting the FEC first. | Fait |

## Informations

| # | Pri. | Finding | Change | Status |
|---|---|---|---|---|
| I1 | P1 | Long form with the save button only at the top; leaving the page lost changes silently. | `beforeunload` guard, sticky "Modifications non enregistrées" bar with Annuler les modifications and Enregistrer, save disabled when nothing changed, baseline reset after save. | Fait |
| I2 | P1 | Page scrolled sideways at 375px (571px): establishments, shareholders and tax regime headers, integrations block. | Headers wrap; the generic Intégrations card is replaced by a read-only Connexions bancaires summary that links to the banking page. | Fait |
| I3 | P2 | Header buttons forced to 192px (`min-w-48`), "Annuler" went back in history. | Single Enregistrer action in the header. | Fait |
| I4 | P2 | Info icons without accessible names (HoverCard triggers). | Labelled triggers with focus ring. | Fait |
| I5 | P1 | `window.confirm` for establishments, shareholders and tax regimes. | ConfirmDialog with consequences. | Fait |
| I6 | P3 | Card content padding 24px under 20px headers. | Aligned. | Fait |

## Membres

| # | Pri. | Finding | Change | Status |
|---|---|---|---|---|
| M1 | P1 | `window.confirm` to remove a member; trash and copy icon buttons without names. | ConfirmDialog naming the person; labelled buttons. | Fait |
| M2 | P2 | Role select without label association; no feedback after changing a role. | Labels, help tip on the three roles, toast. | Fait |
| M3 | P3 | Em dash placeholder for members without a name; spinner instead of a table skeleton. | Email local part, TableSkeleton, TableEmpty. | Fait |

## Exercices

| # | Pri. | Finding | Change | Status |
|---|---|---|---|---|
| F1 | P1 | Pagination with "Lignes par page" up to 1000 for a handful of rows pushed the page to 467px at 375px. | Plain table, most recent first, no pagination. | Fait |
| F2 | P2 | Status as colored dots (raw yellow and green), lock icon for "Clôturer" with no label. | StatusBadge, "Clôturer" xs button, tooltips on icon actions. | Fait |
| F3 | P2 | No explanation of what an exercice is; empty state was a centered sentence. | Description with docs link, empty state with action. | Fait |
| F4 | P2 | Create dialog date fields side by side at 375px. | Stacked on phones. | Fait |
| F5 | P2 | Closing dialog preview colors balances green or red by sign. | Neutral amounts. Closing logic untouched. | Fait |

## Plan de comptes et Comptes

| # | Pri. | Finding | Change | Status |
|---|---|---|---|---|
| A1 | P1 | Tree toggles were unnamed 20px buttons without `aria-expanded` (64 per screen). | Named `icon-xs` buttons with `aria-expanded`. | Fait |
| A2 | P1 | Card header buttons overflowed at 375px (378px). | Wrap. | Fait |
| A3 | P2 | Exercise selector inside its own card, 40px tall (override), "(Actif)". | Inline selector, 36px, "ouvert / clôturé", period "Du ... au ...". | Fait |
| A4 | P2 | "PCG" button label, destructive cleanup confirmed with a default (ink) button. | "Conformité PCG", destructive confirm. | Fait |
| A5 | P3 | Account numbers in grey pills, class rows in larger text. | Mono column, steady row height, "Personnalisé" status badge. | Fait |
| A6 | P2 | Comptes page: search label in a separate row with an icon, empty text "Veuillez sélectionner un exercice fiscal". | Exercise and account pickers side by side, example placeholder, plain wording. | Fait |
| A7 | P2 | Account detail (`/accounts/[id]/entries`, `account-details.tsx`): raw colors, ad hoc amounts. The balance was colored by sign and labelled "Créancier" when it was debit; "Dernières écritures" showed the oldest ten lines. | PageHeader, exercise selector in the toolbar, StatCards, `Amount` and `DateDisplay`, running balance in cents, "Solde débiteur / créditeur" (PCG), journal code in mono, named row links, ConfirmDialog to delete (custom accounts only), Field in the edit dialog; the summary on Comptes shows the ten most recent lines; the chart uses the chart tokens and an ink balance line. | Fait |

## Journaux

| # | Pri. | Finding | Change | Status |
|---|---|---|---|---|
| J1 | P2 | Description "(BQ, AC, VT, OD, etc.)" without explaining what a journal is; table inside a card inside the page. | Plain explanation with docs link, framed table. | Fait |
| J2 | P3 | Loading spinners inside button labels, generic delete confirmation. | Button `loading`, confirmation names the journal. | Fait |
| J3 | P3 | Seed data has both VE and VT "Ventes" journals. | Not the seed: reading the Journaux page upserted a second default set (VT, CA). The read no longer writes, and the data migration 20261010090000_remove_leftover_journals removes the unused VT "Ventes" and CA "Caisse" left behind; VE stays the sales journal of the canonical set. | Fait (Q6) |

## Authentification, configuration, consentement

| # | Pri. | Finding | Change | Status |
|---|---|---|---|---|
| L1 | P2 | Two different shells (AuthShell and copied markup on signup and change password), no `h1`, no landmark. | One AuthShell with `main`, titles as `h1`, document titles. | Fait |
| L2 | P2 | Missing `autocomplete` on login, signup and password change fields (password managers misfill). | `email username`, `current-password`, `new-password`. | Fait |
| L3 | P3 | Extra login card with sparkle icon and tinted background. | Plain card with a status badge. | Fait |
| L4 | P2 | Change password page linked "Retour à la connexion" for a signed in user. | "Annuler et revenir à Kledg". | Fait |

## Assistants IA et clés API (paramètres utilisateur)

| # | Pri. | Finding | Change | Status |
|---|---|---|---|---|
| U1 | P1 | API key revocation with `window.confirm`, OAuth revocation with no confirmation at all. | ConfirmDialog saying what stops working. | Fait |
| U2 | P2 | Icon buttons sized `sm` with 12px icons, raw `h1` instead of PageHeader. | Icon sizes, PageHeader with docs link, shared date format. | Fait |

## Phase 2 (screens owned by other workstreams)

Measured on the same run. "Unnamed" counts icon buttons without an accessible
name, "unlabelled" counts fields without a label. Shared component changes
(tokens, Button, Table, Dialog, Card, Badge, Toaster) already apply to these
screens.

### Banque: comptes bancaires (`banking/page.tsx`)

Fait (phase 2, October 2026).

- P2: Column header "Provider" in English; balance colored green by sign (raw color); account display name shows the technical slug ("atelier-lumen-compte-principal") when no name is set. **Fait**: "Banque", neutral `Amount`; a slug is never shown, the account reads "Compte •••• 2606" from its IBAN until it is renamed (`bankAccountName`, `components/features/banking/format.ts`), also in the import dialog, the Ponto page, the sync switch and the Informations summary.
- P2: "Période (jours)" number input next to "Synchroniser" in the header is unclear for beginners. **Fait**: gone, "Synchroniser" reads what the banks hold.
- P3: 1 unnamed icon button; use `Amount` for balances and `StatusBadge` for connection state. **Fait**; the rename dialog uses `Field` and says what the empty name falls back to. Bank pages share the page layout (no `container` padding of their own).

### Banque: relevés (`banking/statements/page.tsx`, statement import dialog)

- P1: Period filters default to 01-2024 to 12-2024 in 2026: the list is empty on first visit ("0 relevé(s) trouvé(s)"). Default to the current exercise. **Fait**: January to the current month by default (`lib/banking/statement-period.ts`), months still being typed are ignored.
- P2: Placeholders "MM-YYYY" in English; use a month picker or "mm/aaaa". **Fait**: "Du mois (mm-aaaa)", "ex. 01-2026".
- P2: Select triggers with `h-*` overrides (5), raw colors in the import dialog (10). **Fait**: `size="sm"` triggers wired to their labels by `Field`, neutral amounts with their sign, `StatusBadge` for each preview line (Nouvelle, Déjà importée, Doublon probable), probable duplicates in a hairline section with a warning icon, French plurals in the counts and the toast ("4 opérations importées, 2 doublons ignorés").
- P3: "relevé(s) trouvé(s)" pluralization; empty state should offer "Importer un relevé". **Fait**: "3 relevés sur la période"; without a Qonto connection the page no longer calls Qonto (it showed an error) but an empty state with "Importer un relevé" (opens the import dialog) and "Connecter Qonto". Periods read "oct. 2026", sizes "12,4 Ko", the title matches the navigation ("Relevés").

### Banque: transactions (`transactions/page.tsx`, `components/features/data-table/*`, `transaction-filters.tsx`)

Fait (phase 2, October 2026). The list loads 100 transactions at a time from
the cursor API (infinite scroll and "Charger plus"); every filter is a query
parameter, a period narrows the fiscal year.

- P1: Page scrolls sideways at 375px (467px): the pagination row ("Rows per page", "Page 1 of 1", "Go to first page") is in English and does not wrap. **Fait**: no page pagination any more, the table scrolls inside its card, no sideways scroll at 375px.
- P1: 5 unlabelled fields and 3 unnamed buttons; 130 buttons at 24px (row actions) below the 28px minimum target. **Fait**: 0 unlabelled, 0 unnamed, no button below 28px (row actions `icon-sm`, pièces `xs`).
- P2: Filters card takes the whole first screen above the table; collapse by default with a summary of active filters ("Exercice : 2026"). **Fait**: one toolbar row (recherche, compte, exercice, statut), "Plus de filtres" folds the rest, active filters as removable chips.
- P2: Date range rendered "sept. 03, 2026 - oct. 03, 2026" (en-US order); use `formatDisplayDate`. **Fait**: "Du 03/09/2026 au 03/10/2026" (range picker), `DateDisplay` in cells.
- P2: "View" column menu button in English; "179 transaction(s) chargée(s)"; title "Transactions bancaires" vs nav "Transactions". **Fait**: "Colonnes" with French names, "N transactions affichées", title "Transactions".
- P2: 8 Button size overrides, 9 SelectTrigger height overrides, 10 raw colors. **Fait**: none left; amounts neutral with their sign, statuses as `StatusBadge`, operation types in French ("Virement", "Carte").

### Banque: rapprochement (`reconciliation/page.tsx`, reconciliation dialog, suggestion dialog)

- P1: One large card per transaction (49 cards) makes the page very long and slow to scan; use a dense list or table with the amount, date, counterpart, suggested account and one "Traiter" action, keyboard navigable (j/k or arrows, Enter). **Fait**: `ReconciliationQueue`, one row per transaction with aligned amounts, roving focus, arrows or j/k, Home/End, Enter opens "Traiter la transaction".
- P1: Page scrolls sideways at 375px (376px): the "Débit" badge row does not wrap. 5 unnamed buttons. **Fait**: rows wrap, every icon button is named.
- P2: Amounts in large red text and solid red "Débit" badges: use neutral `Amount` with a sign, `StatusBadge` for the direction. **Fait**.
- P2: Raw English transaction types shown ("transfer", "card"); translate ("Virement", "Carte"). **Fait**: `operationTypeLabel` (`lib/banking/operation-type.ts`).
- P2: "Exécuter le moteur" is jargon: "Appliquer les règles d'affectation". **Fait**: "Appliquer les règles". The legacy rule editor embedded in the page (it saved rules without conditions or lines) is replaced by a summary linking to Règles d'affectation.
- P3: EmptyState "Excellent travail !" should be `bordered` and drop the exclamation. **Fait**.

### Banque: règles d'affectation (`rules/page.tsx`, rule dialog, simulation)

- P1: `window.confirm` to delete a rule (still listed in the guard). **Fait**: ConfirmDialog naming the rule.
- P2: Status shown as solid black "Active" badges; use `StatusBadge` (Active / Inactive). **Fait**.
- P2: Eight form grids in two columns without breakpoint in the rule dialog; 6 raw colors; amounts with `toFixed(2)`. **Fait**: grids from `sm`, simulation with `Amount` and status tokens, "Écriture" and "Statut" instead of "Template" and "Status".
- P3: Three icon actions per row; move duplicate and delete into a row menu. **Fait**: Modifier plus a named row menu.

### Saisie: écritures (`entries/**`, `entry-form.tsx`, `entries-list.tsx`, `entries-filters.tsx`)

Fait (phase 2, October 2026). The list loads 50 entries at a time from the
cursor API; journal, statut, numéro, texte, période and montant filter in the
database.

- P1: New entry form: 3 unlabelled fields (line account, debit, credit cells) and 1 unnamed button (remove line); 10 icon buttons without `aria-label` across the area. **Fait**: every line field has a label ("Débit, ligne 2"), named line and row buttons.
- P2: Exercise selector in a full width card above the list; put it in the toolbar like the plan de comptes. **Fait**.
- P2: Journal column "BQ - Banque" is long; show the code in mono with the label in a tooltip. **Fait** (label in the title and for screen readers).
- P2: 15 ad hoc number formats; use `Amount` with `numeric` cells; three two column grids without breakpoint. **Fait**: `Amount`, `AmountInput` and `DateInput` in the filters and the form, columns from `sm`.
- P3: Pages render their own `h1` in addition to PageHeader on detail and edit pages. **Fait**: one `h1` through PageHeader.
- `entry-form-reconciliation.tsx` (the entry form of the reconciliation dialog) moved out of phase 2 with the reconciliation screen.

### Saisie: import (`import/page.tsx`, `components/features/import/*`)

- P1: No page `h1` (no PageHeader); one `alert()` in `column-mapping.tsx`. **Fait**.
- P2: 32 raw colors (status colors for mapping results), 8 `toLocaleDateString`, 3 SelectTrigger height overrides, 2 Button size overrides. **Fait**: status tokens, `formatDisplayDate`, `size="sm"` triggers, sized icon buttons.

### Immobilisations (`fixed-assets/page.tsx`, form, depreciation dialog)

- P1: Row action label "Amortissement" is cut off in the actions column at 1440px; 4 icon buttons without names. **Fait**: `xs` button, named row menu.
- P2: KPI cards use colored values and colored badges (orange, green) for neutral facts; use StatCard and `Amount`. **Fait**: neutral StatCards, net book value in cents.
- P2: "Active" solid black badge; em dashes as placeholders (5, guard list); 16 ad hoc number formats; six two column grids without breakpoint. **Fait**; the depreciation dialog also asks before deleting a depreciation.

### États (`reports/**`, report config editors)

- P1: Balance sheet configuration scrolls sideways at 1024px (1164px) and 375px (595px). **Fait**: Actif and Passif side by side from `2xl` only, wrapping line headers, narrower nesting on phones.
- P1: `window.confirm` to reset the bilan and compte de résultat configurations. **Fait**: ConfirmDialog saying which variant is reset.
- P2: "Exercice fiscal" label; 2 unlabelled fields and 1 unnamed button on bilan and compte de résultat; 3 unnamed buttons on the balance. **Fait**; the balance radios had the same id as the exercise select.
- P2: Grand livre: 7 raw colors (debit/credit coloring); trial balance: 2. Keep official PCG labels as they are. **Fait**: neutral figures in `numeric` cells.
- P3: FEC page has no `h1`. **Fait**, like the États index ("États") and the configuration pages; pages outside the sidebar have their own tab title and breadcrumb (`findSubPageTitle`), "Connecter une banque" included.

## Open questions for the owner

| # | Question | Recommendation |
|---|---|---|
| Q1 | The sidebar now starts with Banque and ends with Société (settings). The website's product replica still shows the v0.1 order. Keep the new order? | Keep it: daily work first. Update `components/product/*` on the website to match. |
| Q2 | Primary buttons are ink (black/white) like the website; green only marks focus, links and positive results. OK to keep green off buttons? | Yes, it matches DESIGN.md on the website. |
| Q3 | Add SASU, SCI (IS and IR), SELARL and "Autre" to the forme juridique enum (schema migration)? | Done: SASU, SCI, SELARL, SELAS and EI. No "Autre" value: an unknown form stays empty. |
| Q4 | Should the reconciliation screen become a dense keyboard driven list (phase 2)? | Done: `ReconciliationQueue`, one row per transaction (amount, date, counterpart, suggested account, "Traiter"), arrows or j/k, Home/End, Enter opens the transaction. See "Banque: rapprochement". |
| Q5 | Dashboard "Produits" vs "Chiffre d'affaires": add a separate chiffre d'affaires tile (comptes 70 only)? | Done: "Chiffre d'affaires" (comptes 70) and "Produits" (classe 7) are separate widgets (D8). |
| Q6 | The seed has both VE and VT "Ventes" journals. Intended? | Done: no, a leftover of the old journal read. VE is the canonical sales journal (`DEFAULT_JOURNALS`); the unused VT and CA are removed by a data migration (J3). |
| Q7 | Raise lint warnings from phase 2 files to errors once each screen is migrated (remove the file from `PHASE_2_FILES` in `eslint.config.mjs`)? | Yes, as part of each phase 2 pull request. |
