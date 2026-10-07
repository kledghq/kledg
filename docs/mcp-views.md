# MCP views (MCP Apps)

Some tools of the MCP server (`lib/mcp`, [mcp.md](mcp.md)) return, besides
their JSON text, data that an interactive view renders inside the assistant:
a statement as a table, a chart, a list with buttons, a document, an
organigramme. Assistants that only show text (terminal agents, scripts) keep
getting the same text as before.

## Mechanism

Kledg implements the **MCP Apps** extension of the Model Context Protocol
(extension id `io.modelcontextprotocol/ui`, SEP-1865, stable spec
2026-01-26):

- Specification: <https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx>
- Overview: <https://modelcontextprotocol.io/extensions/apps/overview>
- ChatGPT: <https://developers.openai.com/apps-sdk/mcp-apps-in-chatgpt> (ChatGPT implements the same standard; `openai/outputTemplate` is an alias of `_meta.ui.resourceUri`)

1. **UI resources.** Each template is an MCP resource with a `ui://` URI
   (`ui://kledg/<name>.v<version>.html`), mime type
   `text/html;profile=mcp-app`, whose content is one self-contained HTML5
   document. Registered by `registerKledgViews` (`lib/mcp/views/index.ts`)
   on every server built by `app/api/mcp/route.ts`. The resource `_meta.ui`
   declares an empty CSP (`connectDomains`, `resourceDomains`,
   `frameDomains`, `baseUriDomains` all empty: no network, no external
   resource, no frame) and `prefersBorder: true`.
2. **Tool to template link.** A wired tool declares
   `_meta: viewMeta(name)`: `_meta.ui.resourceUri` (the standard), plus the
   flat `ui/resourceUri` of the earlier drafts and `openai/outputTemplate`
   for older ChatGPT surfaces. A host that supports MCP Apps fetches the
   resource with `resources/read` and renders it in a sandboxed iframe; any
   other client ignores `_meta`.
3. **Data.** The tool returns its unchanged `content` (JSON text) plus
   `structuredContent`, the data of the view (`withView`). The data is
   parsed with the zod schema of the template (`lib/mcp/views/schemas.ts`)
   before it leaves the server; if the builder throws or the data does not
   match, the result goes out without `structuredContent` (logged), never as
   an error. Tools declare no `outputSchema`: the text stays the contract
   for text clients and existing tests.
4. **Bridge.** The view talks to the host with JSON-RPC 2.0 over
   `postMessage` (`lib/mcp/views/html/runtime.ts`, plain ES5, no SDK):
   `ui/initialize` (protocol `2026-01-26`) then
   `ui/notifications/initialized`; it receives
   `ui/notifications/tool-input` and `ui/notifications/tool-result` (the
   `CallToolResult`, whose `structuredContent` it renders) and
   `ui/notifications/host-context-changed` (theme); it sends
   `ui/notifications/size-changed` when its height changes, answers
   `ui/resource-teardown` and `ping`. Messages are accepted only from
   `window.parent` (the host, or the sandbox proxy of a web host).
5. **Actions.** Buttons use the host bridge only: `tools/call` (a tool of
   this server, proxied by the host to `/api/mcp` with the connection's own
   credentials), `ui/message` (a message to the assistant as the user),
   `ui/open-link` (a page of Kledg in the browser) and
   `ui/update-model-context` (tells the assistant what was done).
6. **ChatGPT fallback.** If the host exposes `window.openai` and the
   standard handshake fails, the view reads `window.openai.toolOutput` and
   uses `callTool`, `sendFollowUpMessage`, `openExternal`. ChatGPT supports
   the standard bridge, so this path is only a safety net.

One template set serves both hosts. No helper package is used:
`@modelcontextprotocol/ext-apps` (2.0.3, compatible with the installed
`@modelcontextprotocol/server` 2.3.0 and `mcp-handler` 2.2.0) would only
provide three constants on the server and needs a bundler for the view
side; the raw protocol is a hundred lines.

## Templates

Data-driven, one per shape (`lib/mcp/views/html`):

| Template | Data | Tools |
| --- | --- | --- |
| `statement` | sections, rows (line, subtotal, group, depth, account code), section totals, totals, 1 to 6 amount columns | `get_balance_sheet` (N and N-1), `get_income_statement` (N and N-1, intermediate results), `get_trial_balance` (debit, credit, balance, by PCG class) |
| `chart` | `line` / `area` series over months or days with an optional threshold line; `sankey` nodes in columns and links | `get_group_treasury` (512 cash by month), `get_tiers_flows` (customers, company, suppliers), `get_group_view` (money between the companies of the group) |
| `actions` | columns, items with cells, entry lines, buttons; optional bulk action and refresh | `list_entries` (drafts: validate, delete), `list_bank_transactions` (reconcile with the unique match, else propose an entry or mark reconciled without entry), `list_missing_receipts` |
| `document` | parties, facts, tables, totals, status | `get_invoice`, `get_expense_report` |
| `organigram` | nodes by level, holders, officers, holdings with percentages | `get_group_structure` |

The cash forecast tool (branch `cash-forecast`) is not on `main` yet. When
it lands, wire it with `_meta: viewMeta('chart')` and a builder returning a
`line` chart with `x: 'date'` and a `threshold` (minimum cash); the preview
`prevision-tresorerie` shows that shape.

Builders (`lib/mcp/views/builders.ts`) take what the tool already
computed; the only extra reads are the company's name and, for the
statements, the previous fiscal year's statement (N-1 column), with the
same service as the tool.

Look: Geist then system font stack, monochrome, the colour tokens of
`app/globals.css` copied as constants (`LIGHT_TOKENS`, `DARK_TOKENS`; the
guard test compares the flow colours with the CSS), light and dark through
`prefers-color-scheme` and the host's `theme`. Amounts in French with
non-breaking spaces (`1 234,56 €`), dates `dd/mm/yyyy`. Tables have
`caption` and `th` scopes; charts are `role="img"` with an `aria-label`
summary and a "Voir les données" table; the Sankey is laid out at the view's real width, with the first column's labels on the left of their nodes, the last column's on the right and a middle node's above the flows, one slot per label so labels never overlap the flows or each other, and long names cut with an ellipsis (full text in the tooltip); the organigramme also writes each
holder in words and lists the holdings in a table.

## Rapprocher (unique match)

`list_bank_transactions` computes, server side, the one reconciliation
Kledg can propose for each unreconciled transaction
(`lib/reconciliation/unique-match.ts`), only for a connection with full
control whose user has the right `banking: reconcile` in the company:

1. **Existing entry.** A line of a draft or validated entry on the bank
   ledger account of the transaction's bank account (its 512 mapping, else
   the company default, `lib/banking/ledger-account.ts`), of the same amount
   to the cent on the opposite side, dated within one calendar day
   (`lib/reconciliation/bank-line-match.ts`, the rule of the auto-reconcile
   action), whose entry is not linked to a transaction yet. Unique when
   exactly one line fits the transaction and that line fits no other
   unreconciled transaction. One candidate or more stops step 2 (a rule
   never books a second entry for a booked payment).
2. **Rule.** Else exactly one enabled assignment rule matches and its entry
   can be computed (`ruleSuggestion` in `lib/reconciliation/prefill.ts`,
   the suggestion of the reconciliation dialog). Two matching rules, even of
   different priorities: no match.

The item then carries `match` (kind, `entryId` and `lineId`, or `ruleId`,
label, signed amount, date) and a "Rapprocher" button that calls
`reconcile_transaction` with `entryId`, or with the rule's journal, date and
counterpart lines (the draft entry is created by the tool). The others keep
"Proposer une écriture" (`ui/message`) and "Pointer sans écriture".
`reconcile_transaction` is a direct write (`confirmation: false`), so the
button acts the same in validation and automatic mode: a confirmation click,
then the call, which the server checks again (grant, role, rate limit,
audit log; 409 when the transaction was reconciled meanwhile). The view only
shows what the server returned.

## Security

- Templates display only what the host passes. They hold no secret, token
  or session, never call Kledg (no `fetch`, XHR, WebSocket, storage), and
  contain no URL at all.
- Every string from the data is written with `textContent` or
  `setAttribute` (never `innerHTML` or any HTML parsing); links are opened
  by the host (`ui/open-link`) and only if they are `http(s)` URLs.
- Strict CSP twice: declared on the resource (`_meta.ui.csp`, empty
  lists, which the host enforces) and repeated as a meta tag in the page
  (`default-src 'none'`, inline script and style only, `img-src data:`,
  `connect-src 'none'`, `frame-src 'none'`, `form-action 'none'`,
  `base-uri 'none'`).
- A button never bypasses anything: it is a `tools/call` the server checks
  like a call of the assistant (connection level, company grant, role, rate
  limit, audit log). A high-impact tool always starts with its dry run: in
  validation mode the server records a pending action and returns the
  `approvalUrl`; the view offers "Approuver dans Kledg" (the user approves
  in Kledg, the view cannot) then "Exécuter après approbation", which
  calls again with the `actionId`. In automatic mode the view sends
  `dryRun: true` first and executes only on "Confirmer". A direct write
  (`reconcile_transaction`, "Rapprocher" or "Pointer sans écriture") needs
  a second click, counted only from 600 ms after the question is shown (the
  second half of a double click is ignored) and within 10 seconds (a later
  click asks again); every button is disabled while a call runs.
  Tool buttons appear only when the connection has full control
  (`executionMode` in the data, null otherwise).
- A message button ("Proposer une écriture", "Retrouver la pièce") sends
  its request to the assistant as the user's words (`ui/message`): every
  value read from the books (bank label, counterparty, supplier name) is
  quoted as data with `quote()` of `lib/ai-assist/prompts.ts` (between « »,
  without quotes, line breaks or control characters, 120 characters at
  most) and ids go through its `id()`, so a label sent by a third party
  cannot add an instruction. A test fails if a request interpolates book
  text otherwise.
- The data keeps the tool's access rules: builders read nothing the tool
  could not read (the N-1 statement goes through the same company guard as
  N), hidden subsidiaries stay unnamed.

## Tests and previews

- `lib/mcp/__tests__/views.test.ts`: every template is valid and
  self-contained (no URL, no forbidden API, CSP, scripts parse, no em or en
  dash), colours match `globals.css`, each sample renders in jsdom through
  a simulated host (handshake, tool result, no script error, markup in
  data stays text), the approval flow of the actionable list, the wiring of
  every tool and resource, `withView`.
- `lib/mcp/__tests__/views.db.test.ts`: through `/api/mcp` on PostgreSQL,
  resources listed and read, `_meta.ui.resourceUri` in `tools/list`,
  `structuredContent` of each wired read tool valid against its schema,
  the N-1 column, and a button's call answered by a dry run and an
  approval link in validation mode.
- `pnpm tsx scripts/mcp-views-preview.ts [dir]` writes static previews
  (default `../mcp-views-preview`): each page plays the host around the
  real template, with simulated tool calls. Samples:
  `lib/mcp/__tests__/view-samples.ts`.

## Adding a view to a tool

1. Write a builder returning the data of an existing template (add a
   template only for a new shape).
2. In the tool: `_meta: viewMeta('<template>')` and
   `return withView(json(result), () => builder(...))`.
3. Add the tool to `WIRED` and a sample in `view-samples.ts`.

Changing a template or its data contract in a way an old cached copy would
render wrongly: bump `VIEWS_VERSION` (it is part of the URIs).

## Limits

- Hosts decide how much they support: display modes, height, whether
  `ui/message` or `ui/update-model-context` are accepted (the view shows the
  error when refused).
- The server does not read the client's `io.modelcontextprotocol/ui`
  capability (the endpoint is stateless): templates are always declared,
  and hosts without MCP Apps ignore them.
- Host fonts (`styles.css.fonts`) are not loaded: the CSP blocks external
  fonts; the view uses Geist when installed, else the system font.
