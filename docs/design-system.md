# Design system

Kledg should look like a product company made it: monochrome, crisp, dense but
calm, real product UI. The app shares its tokens, type and tone with the
website (www.kledg.com, `kledghq/website`: `app/theme.css`, `DESIGN.md`,
`components/product/*`), so the screenshots on the site and the app read as one
system.

Users are often beginners in accounting. Every screen says what it is for,
explains accounting terms in place, tells what to do next when it is empty,
asks before destroying data and never loses what was typed.

Most rules below are enforced: ESLint (`eslint.config.mjs`, "Design system
guards"), `lib/__tests__/design-system-guards.test.ts` and component tests in
`components/shared/__tests__` and `components/ui/__tests__`.

## Tokens

All colors come from semantic tokens in `app/globals.css`, mirrored from the
website's `theme.css`. Never use raw palette classes (`text-green-600`,
`bg-blue-500`): ESLint rejects them.

| Token | Use |
|---|---|
| `background`, `foreground` | Page and text. |
| `surface` | Subtle alternate background (auth pages, instance banner). |
| `card`, `popover` | Raised surfaces. |
| `muted`, `muted-foreground` | Secondary text, placeholders, table headers, skeletons. |
| `primary`, `primary-foreground` | Ink: primary buttons, selected states. Not green. |
| `border`, `input` | Hairlines and field borders. |
| `ring` | Focus ring (deep green, 3px at 50%). |
| `link` | Inline text links (`text-link`). |
| `highlight` | The one accent for small marks. |
| `success`, `warning`, `destructive`, `info` | Status meaning only: positive result, attention, error or loss, neutral information. |
| `chart-1` to `chart-5` | Palette slots behind the default chart colours: `chart-1` is the green accent, `chart-2` the neutral gray it is compared with. Charts read the series tokens below, not these. |
| `chart-revenue`, `chart-expenses`, `chart-treasury`, `chart-breakdown`, `chart-debit`, `chart-credit`, `chart-balance` | Chart series by meaning (see [Chart colours](#chart-colours)): the user can change them. |
| `brand-50` to `brand-950` | The green scale, for the rare case a token does not fit. |

Color carries meaning, never decoration: no gradients, glows, tinted cards or
colored icon tiles. A negative result is `text-destructive`; a plain amount
in a table stays neutral.

Dark mode uses the same tokens (`.dark`), so a component that only uses tokens
is correct in both themes.

## Chart colours

Every chart colours its series through one token per meaning, never a
palette slot or a fixed value (tested in `lib/appearance/__tests__/palette.test.ts`):

| Token | Series |
|---|---|
| `--chart-revenue`, `--chart-expenses` | Produits and charges (dashboard, monthly bars) |
| `--chart-treasury` | Trésorerie dans le temps (512 balance line) |
| `--chart-breakdown` | Répartition des charges (bars per post) |
| `--chart-debit`, `--chart-credit`, `--chart-balance` | Évolution du solde of an account (bars and cumulative line) |

In a `ChartConfig`, write `color: 'var(--chart-revenue)'`; outside Recharts
use the utilities (`bg-chart-breakdown`). A new chart with a new meaning adds
a series to `CHART_SERIES` (`lib/appearance/palette.ts`), its token to
`app/globals.css` and a colour to every preset.

Users choose the colours on Paramètres, Apparence
(`/settings/appearance`), stored per user (`user_preferences`,
`GET/PUT /api/account/appearance`):

- Presets, each with a light and a dark value: Sobre (the default, unchanged:
  green accent against a neutral gray, ink balance line), Contrasté, Daltonisme
  (Okabe-Ito: blue, vermillion, bluish green, distinct with deuteranopia and
  protanopia) and Pastel (soft but darker than true pastels, so they stay readable).
- Personnalisé: one colour per series and per theme, starting from a preset
  (a colour left alone comes from it). Colours are not derived from one theme
  to the other: a colour readable on white is rarely readable on a dark card.
- The page warns when a colour has less than 3:1 against the card (WCAG 2.2
  non-text contrast). Every preset passes in both themes (Sobre's charges
  and credit gray is base-500 for that reason).

How they apply: `globals.css` sets each series token to
`--chart-<series>-light` (`-dark` under `.dark`) when present, else to the
Sobre default. The root layout renders only those `-light`/`-dark`
variables as an inline style on `<html>` from the session (no style tag, no
flash of default colours, nothing for the CSP), and nothing at all for
Sobre. After saving, the page sets the same variables on `<html>`, so every
chart changes without a reload.

## Typography

- One family: Geist (sans) for everything, Geist Mono for account numbers,
  journal codes, references and keys. Mono is never used for labels.
- Tabular lining figures are on globally (`--font-features`); add `num` on
  elements that show amounts or counts to be explicit.
- Scale:

| Role | Classes |
|---|---|
| Page title (one `h1` per page) | `text-2xl font-semibold tracking-tight` (PageHeader) |
| Page description | `text-sm text-muted-foreground`, one sentence, max `max-w-prose` |
| Card title | `CardTitle` (16px semibold) |
| Body and table text | `text-sm` |
| Table header, hints, meta | `text-xs` (`text-muted-foreground`) |
| KPI value | `text-2xl font-semibold num` (StatCard) |

## Spacing, radius, density

- Page padding `p-4 md:p-6`; sections separated by `space-y-6`.
- Card padding 20px (`px-5 py-5`), `gap-5` between header and content.
- Radius: `--radius` is 0.5rem. `rounded-md` for controls, `rounded-lg` for
  cards, tables and dialogs. No `rounded-xl` or larger in product UI.
- Cards have a hairline border and no shadow. Popovers, dialogs and the sticky
  save bar have a shadow because they float.

## Controls and sizes

Every control in a row has the same height. Buttons are sized with their
`size` prop only: height, padding or text size classes on `<Button>` are an
ESLint error.

| Size | Height | Use |
|---|---|---|
| `lg` | 40px | Rarely: one main action on an empty or standalone page. |
| `default` | 36px | Page header actions, dialog footers, forms. Matches `Input`, `SelectTrigger` and `Autocomplete` (36px). |
| `sm` | 32px | Toolbars, filters, card headers, empty state actions. Matches `SelectTrigger size="sm"`. |
| `xs` | 28px | Inline actions inside table rows. |
| `icon` / `icon-sm` / `icon-xs` / `icon-lg` | 36 / 32 / 28 / 40px | Square icon buttons. Header icons use `icon-sm`, row actions `icon-sm`. |

Variants:

- `default` (ink): the primary action. At most one per area.
- `outline`: secondary actions next to a primary one.
- `ghost`: icon buttons, row actions, low emphasis actions.
- `destructive`: only the confirm button of a destructive dialog. A delete
  entry point is a `ghost` button with `text-destructive` on hover.
- `link`: inline actions inside text.
- `loading` prop: shows a spinner in place of the leading icon and disables
  the button. Keep the label (do not swap it for "Création..." unless the
  wording adds information).

Icons: lucide, 16px (`size-4`) everywhere, 14px (`size-3.5`) inside `xs`
buttons and inline links. Decorative icons get `aria-hidden`. Icon only
buttons always have an `aria-label` (and a `title` or tooltip).

## Page layout

```
PageHeader   title (h1) · description + "Aide" docs link · actions (wrap)
[toolbar]    filters, exercise selector (sm controls)
content      cards, tables
```

- `PageHeader` wraps: actions move under the title instead of overlapping it.
- The breadcrumb in the header shows Société / Section / Page; on phones only
  the page. Tab titles are "Page · Société · Kledg".
- No horizontal page scroll at 375px. Grids collapse (`sm:grid-cols-2`, never
  a bare `grid-cols-2` for form fields); wide content scrolls inside its card.

## Navigation

Defined once in `components/layout/nav-config.ts`, ordered by how often a
small company uses each area: Tableau de bord, Banque, Factures (achats,
ventes, tiers), Saisie, États, Société. One entry is active at a time (longest URL prefix), with
`aria-current="page"`. Each entry has its own icon. The sidebar collapses to
icons (tooltips) and becomes a drawer on phones that closes after navigation.
In simple mode (a display preference of the user, [mode-simple.md](mode-simple.md))
the sidebar shows `simpleNavGroups` instead (Accueil, Dépenses, Recettes,
Factures, Banque, Justificatifs, Mon comptable) and its footer has the
Simple / Expert switch; simple-mode pages take their wording from
`lib/simple/vocabulary.ts` (no account numbers, no accounting jargon).

Pages outside a company (Mes sociétés, account and instance settings) use
the same frame (`components/layout/app-shell.tsx`) with a settings sidebar
(`components/layout/settings-nav-config.ts`): a link back to the last
company opened, then Mes sociétés, Compte (Profil, Apparence, Assistants IA, Clés
API) and, for instance administrators, Instance (État de l'instance, Utilisateurs, Créer un compte, Mises à
jour). Settings are navigated in this sidebar only.

The user menu in the sidebar footer (`components/layout/nav-user.tsx`) stays
short, like Vercel or Linear: the identity, "Paramètres" (the way
into the settings area from company pages), Documentation, "Installer
l'application" when the browser offers it, and "Se déconnecter". It does not
repeat the settings pages, and the theme stays in the header (the Apparence
page offers the same choice, through the same next-themes state).

Settings pages share one layout: `w-full max-w-3xl space-y-6`, a
`PageHeader`, then cards. An action the instance refuses stays visible,
disabled, with the policy's message above its controls.

## Mobile and installed app

- Kledg is installable (`app/manifest.ts`, `public/sw.js`, `components/pwa`).
  Installation is offered, never pushed: "Installer l'application" in the
  user menu when the browser has an install prompt, "Partager puis Sur
  l'écran d'accueil" in the help menu on iOS. No banner, no modal. Both
  disappear once the app runs installed.
- The viewport uses `viewport-fit=cover`: anything fixed or sticky to an
  edge pads itself with `env(safe-area-inset-*)` (the header, the main
  area, the sidebar and its drawer, sheets, toasts).
- Touch screens (`pointer: coarse`): header icon buttons, sidebar entries of
  the drawer, dropdown menu items, buttons (matched on `data-size`), inputs,
  select triggers, tabs and dialog or sheet close buttons are at least 44px
  (`app/globals.css`), without changing their desktop size. Checkboxes,
  radios and switches keep their drawn size with an invisible 44px hit area.
  Other small marks that must stay small (the `HelpTip` "?", the "Aide"
  link, the logo of the sign-in pages) carry `data-touch-target`; a text link
  in a row of content grows its tap area with
  `pointer-coarse:-my-3 pointer-coarse:py-3` without moving the layout. The
  sidebar collapsed to icons on a tablet has 44px entries. Help never opens on hover only: use `HelpTip`
  (a popover, opens on tap), not a hover card.
- Dialogs open as bottom sheets under 640px (full width, anchored to the
  bottom, padded above the home indicator). The on-screen keyboard resizes
  the layout (`interactive-widget=resizes-content`, Chrome on Android) so a
  sheet or the sticky save bar stays above it.
- The header keeps one slot per action on small screens: on phones the bank
  sync moves into the to-do popover; below 1024px the update notice becomes
  one icon with a menu (see the update, hide until the next version).
- The browser bar color (`theme-color`) follows the theme picked with the
  header toggle, not only the system setting (`components/pwa/theme-color-sync.tsx`).
- Fields declare the keyboard and autofill they need: `type="email"` with
  `autoComplete="email"`, `type="tel"` with `autoComplete="tel"`, SIREN and
  SIRET with `inputMode="numeric"` and `autoComplete="off"`, passwords with
  `current-password` or `new-password`.
- Dense tables become stacked lists below 1024px (`useCompactLayout`,
  `hooks/ui/use-media-query.ts`, or `lg:hidden` / `hidden lg:block` for small
  lists), or keep their priority columns. Tables beside the sidebar can stack
  on their own width instead: container queries on the same markup
  (`@container/name` with `@max-[56rem]/name:` classes, amounts named by a
  `data-label`), as in the entries list, the account ledgers
  (`components/features/accounting/ledger-layout.ts`, also used by the
  livre-journal and the grand livre, one card per entry or line) and the
  fixed assets.
  The entry line editor is one card per line on phones. Filters other than the search move
  into a bottom sheet on phones. Long dialogs keep their actions in a sticky
  footer on phones.
- Text fields are 16px under 768px so iOS does not zoom on focus; zoom by
  the user stays allowed (no `maximum-scale`).
- The offline page (`public/offline.html`) is static HTML with the tokens
  copied as values: no script (CSP), a "Réessayer" link to the same
  address.

## Tables

- Use `components/ui/table`. The table scrolls horizontally inside its
  container, never the page.
- Header: muted, `text-xs`, 36px. Rows: hover background, 8px vertical padding.
- Amount columns: `numeric` on `TableHead` and `TableCell` (right aligned,
  tabular figures). Render the value with `<Amount>`.
- Account numbers and journal codes in `font-mono text-xs`.
- Long tables: `stickyHeader` with a max height on `containerClassName`.
- Loading: `TableSkeleton` with the real column count. Empty: `TableEmpty`
  with a sentence that says what to do next.
- Row actions: `icon-sm` ghost buttons with a label, or an `xs` outline button
  when the action needs a word ("Clôturer").
- Lists that grow (entries, transactions) load page by page from the cursor
  API: `useCursorList` (`hooks/use-cursor-list.ts`) with `LoadMore` under the
  table (infinite scroll and a "Charger plus" button, a count of the rows
  shown). Filters are query parameters, never applied to the loaded rows only;
  totals say they cover the rows shown. No client side sorting of a paged list.
- Small lists (fiscal years, journals, members) are never paginated.
- Financial statements (bilan, compte de résultat) use `StatementTable`
  (`components/features/reports/statement-table.tsx`): fixed layout, the
  form code in a narrow column, amount columns of fixed width that never
  wrap, the official label wrapping in the rest. Widths follow the table's
  container, so amounts stay visible without scrolling at any width; Brut
  and Amortissement move under the label on narrow tables. The two sides
  stand next to each other only when each keeps a readable label, and
  "Masquer les lignes à zéro" is on by default (remembered per user).

## Amounts and dates

- `formatAmount()` / `<Amount>` from `@/components/shared`: French locale,
  "1 234,56 €", narrow no-break space thousands, comma decimals, no "-0,00".
  `tone="signed"` colors results and variations only.
- `formatDisplayDate()` / `<DateDisplay>`: `short` 03/10/2026 in tables,
  `long` 3 octobre 2026 in sentences, `month` oct. 2026 on chart axes,
  `datetime` for imports and syncs. Accounting days are rendered in UTC so
  they never shift by one day.
- Periods read "Du 01/01/2026 au 31/12/2026".

## Status

`<StatusBadge tone>`: a hairline pill with a dot. The label carries the
meaning (Ouvert, Clôturé, Brouillon, Validée, Personnalisé), the color only
reinforces it. Tones: `success` (positive or active), `warning` (needs
attention), `danger` (error, loss), `info` (custom or informative), `neutral`
(closed, archived). `Badge` variants `success`, `warning`, `info`, `muted`
exist for counts and tags.

## Empty, loading and error states

- Empty: `<EmptyState>` left aligned and compact: what is missing ("Aucun
  exercice pour cette société"), what to do next (one sentence), the action
  (`sm` button) and, for accounting concepts, a docs link. `bordered` when it
  stands alone on a page. No illustrations, no centered hero.
- Loading: skeletons shaped like the final layout (same card and row heights)
  so nothing jumps. Mark the container `aria-busy`.
- Error: say what failed and what to try, with a retry button. Page level
  crashes show `app/error.tsx` inside the company layout with the error
  reference.

## Forms

- Use `<Field label hint error required optional help>`: it wires `htmlFor`,
  `aria-describedby`, `aria-invalid` and `aria-required` on the control.
- Labels are nouns in sentence case ("Date de début"), placeholders show an
  example ("ex. 512, banque"), never the label again.
- Validation timing: react-hook-form defaults (validate on submit, then on
  change). Never validate on mount or while data loads: reset the form with
  the loaded values first.
- Async checks (code already used) are debounced and shown as a hint, not as
  an error, until submit.
- Never lose input: long forms warn before leaving with unsaved changes
  (`beforeunload`) and show a sticky "Modifications non enregistrées" bar with
  Annuler les modifications and Enregistrer. Programmatic `setValue` calls use
  `shouldDirty: true` so selects and pickers count as edits.
- Two columns only from `sm` up.

## Dialogs, sheets, pages

- Dialog: short, focused tasks (create a journal, add a member) with at most
  about six fields. Header left aligned, footer Annuler (outline) then the
  action named by its verb ("Créer le journal").
- Confirmation: `<ConfirmDialog>` or `useConfirm()`, never `window.confirm`.
  Title is a question that names the object ("Supprimer le journal BQ ?"),
  the description states the consequence, the confirm button repeats the
  verb. Cancel has the initial focus; Escape cancels.
- Sheet: side panels that keep the page context (details of a transaction).
- Page: anything longer, or anything users come back to (company
  informations, entry form).
- Prefer undo over confirmation when an action is reversible: run it, then
  show a toast with an "Annuler" action.

## Toasts

`sonner`, bottom right, with a close button. Success toasts are short
statements of the result ("Société supprimée"), errors say what failed and
what to try. Do not toast what is already visible on screen.

## Inline help and docs

- `<HelpTip term docsHref>` next to a label explains an accounting term in one
  or two sentences and links the docs. It opens on click or keyboard.
- `PageHeader docsHref` adds an "Aide" link to the screen's docs page.
- Docs URLs come from `lib/docs-links.ts` (`docsUrl('fiscalYear')`), built on
  `DOCS_URL` in `lib/config.ts`.

## Wording

- French, vouvoiement, sentence case. No em or en dashes anywhere (tested).
- "société" (never "entreprise"), "règles d'affectation", "exercice" (not
  "exercice fiscal"), "forme juridique", "rapprochement", "écriture".
- Official PCG, bilan and compte de résultat labels are never reworded.
- Buttons are verbs naming the result: "Créer la société", "Retirer",
  "Révoquer", not "OK", "Valider" or "Oui".

## Accessibility checklist

- One `h1` per page, landmarks (`main#contenu`), a skip link.
- Visible focus ring on every interactive element (`focus-visible:ring-[3px]`).
- Icon buttons have names; decorative icons are `aria-hidden`.
- Dialogs trap focus and close with Escape; popovers close with Escape.
- Contrast: `muted-foreground` and the status tokens pass 4.5:1 on their
  backgrounds in both themes.
- Reduced motion is respected globally.
