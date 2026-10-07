# Engineering conventions

How Kledg code is written. Each rule says what to do, shows the pattern the
best code already follows, and names the anti-pattern. Rules marked
**enforced** fail `pnpm lint` or `pnpm test:run`; the others are reviewed.
Existing code that breaks an enforced rule is listed under
[Known violations](#known-violations): the rule only warns there, so the
debt stays visible until it is burned down.

Related docs: [architecture.md](architecture.md) (folders, principles),
[design-system.md](design-system.md) (UI), [configuration.md](configuration.md)
(environment), [self-hosting.md](self-hosting.md#migrations-de-la-base)
(migrations), `lib/accounting/fiscal-year-closure/lock.ts` and
`lib/accounting/services/entry-lifecycle.service.ts` (accounting invariants).

| Enforcement | Where |
|---|---|
| Lint rules of this document | `eslint/conventions.mjs` (allowlists in `KNOWN_VIOLATIONS`) |
| Design system rules | `eslint.config.mjs` (`PHASE_2_FILES`), `lib/__tests__/design-system-guards.test.ts` |
| Every route handler wrapped | `lib/api/__tests__/routes.test.ts` |
| Client code never reaches server modules | `lib/__tests__/architecture.test.ts` |
| Allowlists stay honest | `lib/__tests__/conventions-allowlist.test.ts` |
| Migrations immutable and additive | `scripts/check-migrations.mjs` (CI) |
| Authorization of every route and role, no secret in responses | `lib/api/__tests__/authorization-matrix.test.ts` |
| Every route, service and MCP tool has a test | `lib/__tests__/feature-tests.test.ts` |

## Architecture

```
app/(...)/page.tsx       pages: server components load, client components render
app/api/**/route.ts      HTTP handlers: parse, authorize, call lib, map errors
lib/<domain>/            business rules and data access (accounting, reports, fec,
                         fixed-assets, banking/import, reconciliation, integrations,
                         updates, mcp, rbac, email, instance...)
lib/api/                 route wrappers, resolvers, ownership checks, upload limits
lib/utils/               pure helpers usable on both sides (dates, amounts, cn)
components/ui            shadcn primitives          components/shared  Kledg building blocks
components/features/<x>  feature components         components/layout  shell and navigation
hooks/                   client hooks
```

- **Business rules live in `lib/`**, in a service named after what it does
  (`close-fiscal-year.service.ts`, `entry-lifecycle.service.ts`). A route, a
  page, the MCP server (`lib/mcp/tools.ts`) and a cron call the same service,
  so a rule is written once.
- **Route handlers are thin**: parse the input, authorize, call one service,
  return its result. Good: `app/api/entries/route.ts` POST (calls
  `createEntry`, the service checks journal, accounts, fiscal year, balance).
  Also good: the fixed asset, report and FEC routes (`app/api/fixed-assets/**`,
  `app/api/reports/**`, `app/api/fec`): a zod `body` or `query` schema and
  one service call each. Anti-pattern: validation, float parsing and the
  database write inline in the handler.
- **Import boundaries** (enforced):
  - `lib/` never imports `app/`, `components/` or `hooks/`.
  - `components/` and `hooks/` never import `@/lib/prisma`, `@/lib/auth`,
    `@/lib/session`, `@/lib/audit`, `@/lib/email` or `pg`, and import
    `@prisma/client` with `import type` only.
  - A `'use client'` module never reaches a server-only module through any
    chain of runtime imports (database, server auth, mail, `next/headers`,
    `fs`). Share types with `import type`; share logic through pure modules
    without imports (`lib/utils/money.ts` is one on purpose).
- A module is server-only when it imports the database or secrets; keep pure
  helpers (parsing, formatting, rules on plain values) in separate files so
  the client can use them.

## API routes

- **Use a route wrapper** (enforced): `companyRoute`, `authedRoute` or
  `adminRoute` from `lib/api/route.ts`. They authenticate, authorize, parse
  the body and the query string and map every thrown error. A hand-written handler needs an entry
  in the allowlist of `lib/api/__tests__/routes.test.ts` with the reason it
  is public or authenticates itself (health, cron with `CRON_SECRET`, Better
  Auth, MCP bearer tokens, `.well-known` metadata). Routes of a customised
  instance that authenticate themselves are declared with their reason in
  `SELF_AUTHENTICATED_API_ROUTES` (`lib/instance/policy.ts`,
  [extension-points.md](extension-points.md)).

  ```ts
  // app/api/journals/[id]/route.ts: the service scopes the lookup by company and throws typed errors
  export const PATCH = companyRoute(
    { company: fromResource(companyOfJournal), permission: { ledger: ['manage'] }, body: UpdateJournalBody },
    async ({ params, companyId, body }) => NextResponse.json(await updateJournal(companyId, params.id as string, body)),
  )
  ```

- **Resolve the company with a resolver**, never from an unchecked field:
  `fromParam`, `fromQuery`, `fromBody`, `fromForm`, `fromQueryOrBody`,
  `fromResource(companyOfX)`. Resolvers accept a slug or an id and hand the
  handler the real id.
- **Scope every lookup by company**: `findOwned(prisma.x.findFirst({ where:
  { id, companyId } }))` for one row, `assertAllOwned(ids, count)` for ids
  coming from the body (accounts of an entry, transactions to reconcile).
  Anti-pattern: `findUnique({ where: { id } })` on an id from the request.
- **Permissions**: the wrapper checks the route's base permission
  (`{ entries: ['read'] }`); payload dependent rights use `authorize()` in
  the handler (`if (status === 'validated') authorize({ entries: ['validate'] })`).
  Roles and statements are defined once in `lib/permissions.ts`.
- **Validate input with zod** through the wrapper's `body` option (the JSON
  body) and `query` option (the query string, each parameter a string): a
  400 with the issues, `path: message`, after authorization (a viewer gets
  403 and never the details of a 400) and before the handler runs. Default
  zod messages are reported in French; give a schema its own message where
  the default would not tell the user what to fix
  (`z.string({ error: 'Le journal est requis' })`). An empty query
  parameter counts as absent; an empty body reads as `undefined`, which a
  schema ending in `.optional()` (or `.optional().default(...)`) accepts and
  any other schema answers with 400. Schemas live next to the service they
  feed (`UpdateCompanySchema`, `RuleInputSchema`, `ListTransactionsQuerySchema`,
  `lib/reports/report-query.ts`); shared fields are in `lib/api/zod-fields.ts`
  (`calendarDay`, `optionalCalendarDay`, `optionalText`, `idList`,
  `byPresenceOf` for bodies with two shapes). Bound numbers
  (`z.coerce.number().int().min(1).max(...)`, `limit` clamped). Semantic
  checks (dates, amounts, ownership) stay in the service. Good:
  `app/api/entries/bulk-validate/route.ts` (`EntryIdsBody.extend({ status })`),
  `app/api/companies/[id]/fiscal-years/[fiscalYearId]/result-allocation/route.ts`
  (amounts to cents in the query and body schemas). Anti-pattern:
  destructuring `await request.json()` or `searchParams.get()` and checking
  fields by hand.
- **Throw typed errors, never build error responses**: `ValidationError`
  (400), `UnauthorizedError` (401), `ForbiddenError` (403), `NotFoundError`
  (404, also for resources of another company), `ConflictError` (409: state
  conflicts, closed fiscal years, duplicates), `RateLimitError` (429),
  `ExternalServiceError` (502, bank or GitHub refused). `handleError` maps
  them; Prisma `P2002`/`P2003`/`P2025` and the accounting triggers are mapped
  too. When the client needs more than the message, attach user-facing data
  with `withDetails` (`throw new ValidationError("Impossible de clôturer
  l'exercice").withDetails({ details: reasons })` answers `{ error, details }`).
  403 is for roles only: a state that forbids the action (a PCG account, a
  journal holding entries) is a 409. Anti-pattern: `return NextResponse.json({ error: 'Missing required
  fields' }, { status: 400 })` or a `try/catch` in the handler.
- **Messages shown to users are French** and say what to do
  ("L'exercice 2025 est clôturé : ... Passez la correction sur l'exercice
  ouvert."). Log messages and code are English.
- **Never leak internals**: unexpected errors become the generic 500 message
  (`INTERNAL_ERROR_MESSAGE`), the detail goes to the server log. Do not
  return `error.message` of a third-party or database error to the client.
  Bank provider failures go through `providerError` and `errorReason`
  (`lib/banking/errors.ts`): French advice for the user, the provider's
  detail in the log.
- **Retried writes are idempotent**: a sync, an import or a reconciliation
  run twice creates nothing twice. Use a natural key or an external id with
  a unique constraint (`lib/banking/import/dedupe.ts`), re-check the state
  under a lock (`lib/reconciliation/service.ts` skips what was reconciled
  meanwhile, `lib/banking/store-synced-transactions.service.ts` writes a
  bank account's synced lines under an advisory lock) and pass idempotency
  keys to providers that accept them. The same operation from two sources
  (a statement file and the bank API, Ponto then a direct connection) is
  recognised by `lib/banking/probable-duplicates.ts`.
- **State-changing admin actions that act outside the instance** (GitHub
  updates), account and user management and sign out call
  `assertSameOrigin(request)` (`lib/api/same-origin.ts`). No GET changes
  state: sign out is `POST /auth/signout`, a GET only asks to confirm.
- **Status codes**: 200 read or update, 201 created, 204 deleted without
  body; errors as above. Responses are JSON `{ error }` on failure.
- Routes calling a third party or doing expensive work are rate limited
  with `enforceRateLimit(name, subject)` (`lib/rate-limit.ts`, see
  [Security](#security)).

## Data access

- **Inside `prisma.$transaction(async (tx) => ...)`, every query uses `tx`**
  (enforced for direct uses). Services that may run in a transaction take the
  client as a parameter (`createEntryInTx(db, input)`,
  `assertFiscalYearOpen(id, client = prisma)`); always pass `tx` down.
  Anti-pattern: calling a helper that defaults to `prisma` from inside a
  transaction (its query runs outside, sees stale data and holds no lock).
- **Serialize what must not race**:
  - entry numbering: `lockEntryNumbering(tx, fiscalYearId)` (advisory
    transaction lock, same key as reconciliation);
  - closing and depreciation postings of a year: `lockFiscalYearRow(tx, id)`
    (`SELECT ... FOR UPDATE`);
  - one-time setup or per-company upgrades: `pg_advisory_xact_lock(hashtext('kledg:<scope>:<id>'))`.
  Lock first, then read the state you are about to change.
- **No N+1**: no `await prisma.x` inside a loop over rows. Load with `in:`
  filters, `include`/`select`, `groupBy` or `createMany`, then join in memory.
- **Select what you return**: `select` the columns a response needs; never
  return rows with secrets (`tokenEncrypted`, API keys) or other companies'
  relations. Shared shapes are constants (`ENTRY_INCLUDE`). The
  authorization matrix seeds secrets (bank credentials, password hash,
  session token, API key hash, GitHub token) and fails when a read returns
  one of their values or a key such as `credentials`, `password`, `token`
  or `key`: add a route that returns connections, accounts or users to its
  `SECRET_READS`.
- **Bound every list**: `take` with a clamped limit, or cursor pagination
  for tables that grow (entries, transactions, audit logs). Filters of a
  paged list run in the database (`listEntries`, `listTransactions`), so a
  page holds only matching rows.
- **Migrations**: every schema change ships a migration in
  `prisma/migrations` (`pnpm db:migrate:dev`). Released migrations are never
  edited; new ones are additive. A destructive step (drop, rename, type
  change) is the contract step of an expand/contract change and carries
  `-- kledg:allow-destructive <reason>` (checked by
  `scripts/check-migrations.mjs` in CI). Invariants that must hold for every
  code path are database triggers in a migration, not only service checks.

## Money

- **Amounts are integer cents** in code. Stored as `Decimal(15, 2)`, sent
  as decimal strings or numbers, converted at the edge. Every conversion goes
  through **`lib/utils/money.ts`** (pure, no imports, usable on both sides);
  do not write a local `toCents` or euro formatter:

  | Need | Helper (`lib/utils/money.ts` unless noted) |
  |---|---|
  | Entry line amount from JSON, string or Decimal, refuse a third decimal | `parseCents` |
  | Amount typed by a user (French "1 234,56") | `parseAmount`, back to the input with `formatAmountInput` |
  | External decimal to round to the cent (bank feeds, computed rates, report balances) | `toCents` |
  | Exact sum | `sumCents` (BigInt) |
  | Bound an amount to its `Decimal(15, 2)` column (input fields, computed totals before a write), French 400 "Montant trop élevé" | `centsField` (`lib/api/zod-fields.ts`), `fitsAmountColumn`, `MAX_AMOUNT_CENTS`, `amountTooLargeMessage` |
  | Cents to Prisma Decimal or JSON, FEC, message, euros as a number | `centsToDecimal`, `centsToFecAmount`, `formatCentsFr`, `fromCents` |
  | Amount in a bank statement file (parentheses, trailing sign, forced separator) | `parseAmountCents` (`lib/banking/import/amount.ts`) |
  | Report euros added, subtracted or rounded again (subtotals, variations, spreadsheet cells) | `addEuros`, `subtractEuros`, `roundEuros` (`lib/reports/amounts.ts`) |
  | Display in the UI | `<Amount>` / `formatAmount` (`components/shared`); cents: `formatAmount(cents / 100)` |
  | Display in a PDF (negative in parentheses) | `formatAmount` (`lib/pdf/utils.ts`) |

- Compare and sum cents, not euros: `debitCents === creditCents`, never
  `Math.abs(debit - credit) < 0.01`.
- `parseFloat` is banned in server code (enforced); `Number(decimal)`,
  `toFixed` and `Math.round(x * 100)` on amounts are reviewed as bugs.
- Allocation of an amount (depreciation, prorata, result allocation) works in
  cents and gives the rounding remainder to a defined line (last period or
  largest line), so the parts sum to the total.

## Dates

- **An accounting date is a calendar day**, not an instant. It travels as
  `yyyy-mm-dd`, is stored at midnight UTC and never depends on the server
  timezone (Vercel runs in UTC, a self-hosted server may not).
- Canonical helpers, one way to do each thing:
  - `lib/utils/date.ts` (pure, both sides): `calendarDayOf` (the one way to
    read a date value), `todayUtc`, `utcDate`, `addUtcDays`,
    `utcDaysInclusive`, `lastDayOfMonth`, `startOfDay`/`endOfDay` (UTC
    bounds for period filters), `toUtcDateOnly` (UTC day of a provider
    timestamp); ISO days: `isIsoDate`, `isoDateToUtc`, `toIsoDateUtc`,
    `addIsoDays`, `parseFrenchDate`, `formatIsoDateFr`.
  - `lib/accounting/entry-date.ts` (accounting edges, French errors):
    `toEntryDate`, `dayToDate`, `requireDay`, `isDayWithin`, `fecDateOf`,
    `parisDayOf` (validation day in France), `todayParis`.
  - Bank statement files: `parseCalendarDate` (`lib/banking/import/date.ts`).

  Do not write a local `addDay`, `nextDay`, `utcDay` or `frDay`.
- **"Today" is the calendar day in France**: a business rule that depends
  on the current day (deadlines and their status, cash forecast, simple mode
  summary, the current fiscal year) reads `todayParis(now)`, with the `now`
  the service received so tests control the clock. Between midnight and 1 or
  2 am in Paris the UTC day is still the day before, so `todayUtc` is only
  for technical timestamps. Compare it with stored days as strings, or as
  `isoDateToUtc(todayParis(now))` against columns at midnight UTC; never
  compare a column holding a day with the current instant.
- **Server code never uses local-time Date APIs** (enforced in `lib/` and
  `app/api/`): no `getFullYear`/`getMonth`/`getDate`/`setDate`..., no
  `new Date(y, m, d)`. Use `getUTC*`/`setUTC*` or the helpers. The few
  deliberate local reads (date pickers) carry a disable comment that says why.
- Client date pickers work in local time: convert with `isoDateToLocal` and
  `localDateToIso`, never by `toISOString().slice(0, 10)`.
- Display with `<DateDisplay>` / `formatDisplayDate` (UTC calendar days).
- Tests of date logic run under several `TZ` values
  (`lib/utils/__tests__/date-timezone.test.ts` pattern: Pacific/Kiritimati,
  America/Los_Angeles, UTC).

## Accounting invariants

Each invariant is checked by the service (precise French message) and, when
it must hold for every code path, by the database (trigger in a migration).

| Invariant | Service | Database |
|---|---|---|
| An entry balances (debits = credits, in cents) | `assertValidEntry`, `validateEntryInTx` | |
| Validated entries are definitive (PCG art. 1031-3): corrected by contre-passation (`reverseEntry`) | `entry-lifecycle.service.ts` | `kledg_guard_accounting_entry`, `kledg_guard_entry_line` |
| Definitive number given at validation, in fiscal year sequence | `validateEntryInTx` under `lockEntryNumbering` | |
| A closed fiscal year never changes (PCG art. 1031-4) | `assertFiscalYearOpen`, `assertDateInOpenFiscalYear` | `kledg_lock_closed_year_*`, `kledg_lock_closed_fiscal_years` |
| Entries are created through one path | `createEntryInTx` (drafts) and `validateEntryInTx` | |
| Lettering groups balance, one code sequence per account, never in a closed year (`docs/lettrage-et-tiers.md`) | `lib/lettering/lettering.service.ts` under an advisory lock per account | the triggers leave `letteringCode` and `letteringDate` free on validated lines |
| An invoice posts once, to the fiscal year containing its date only, with accounts of that year's chart; its amounts come from its lines in cents (`docs/factures-et-tiers.md`) | `lib/invoices/post-invoice.service.ts` under the invoice row lock, `lib/invoices/amounts.ts` | check constraints on `invoices` (TTC = HT + TVA), `invoice_payments.entryLineId` unique |

- Create entries only through `createEntryInTx` / `createEntry`; never
  `prisma.accountingEntry.create` elsewhere.
- Every accounting or tax rule has a test and cites its source in a comment
  (PCG article, BOFiP, LPF, form notice).

## Errors and logging

- Throw the typed errors of `lib/accounting/errors.ts`; let the route
  wrapper map them. Services never return `{ error }` objects for failures.
- Catch only to add context, to translate a third-party error into a typed
  one (`ExternalServiceError` with a French reason), or to continue a batch
  (record the failure per item and keep going).
- **Log with `logger`** (`lib/logger.ts`), never `console` (enforced).
  `logger.error` for unexpected failures with the error object, `warn` for
  degraded paths, `debug` for development traces (silent in production).
- **Audit business operations** with `writeAuditLog` (`lib/audit`) from the
  route or service: action code, company, ids. Never log secrets, tokens,
  full bank payloads or personal data beyond ids.

## Security

- Authorization everywhere: every route through a wrapper, every row
  scoped by company (see API routes). A non-member gets 404, like a missing
  company, so ids of other companies are never confirmed.
- **Row level security** repeats the company scoping in PostgreSQL
  (`KLEDG_RLS=enforce`, [rls.md](rls.md)). A new table gets its
  `kledg_rls_*` policies in its migration, or an exemption with its reason in
  `lib/rls/tables.ts` (enforced by `lib/rls/__tests__/policy-coverage.db.test.ts`).
  Code outside a request (a job, a script) runs inside `withSystemContext`
  with a documented reason, or `withUserContext`; never as the system on
  behalf of a user. Cross-company checks (SIREN or slug uniqueness) go
  through a `SECURITY DEFINER` function that answers a boolean only.
- Secrets at rest are encrypted with `encrypt`/`decrypt`
  (`lib/integrations/encryption.ts`) and the instance key
  (`lib/crypto/encryption-key.ts`); they are never returned by an API.
- Outbound HTTP goes to fixed hosts built from configuration, with
  `redirect: 'error'` (or a checked redirect), a timeout and an injectable
  `fetch` for tests: `lib/updates/github.ts` is the model. Never fetch a URL
  taken from user input or a provider payload without checking its host
  (`lib/integrations/providers/qonto/files.ts` for the files Qonto links to),
  connecting through `publicFetch` (`lib/integrations/public-https-fetch.ts`:
  public addresses only, checked when the socket connects) and reading the
  body with a byte budget, never `arrayBuffer()` before the size check.
- User-written patterns never reach `new RegExp`: rule conditions run on the
  linear-time matcher of `lib/transactions/rule-regex.ts`.
- Redirect targets from the URL go through `safeRedirectPath`.
- No unsanitized HTML: no `dangerouslySetInnerHTML` outside
  `components/ui/chart.tsx` (static CSS).
- Uploads: `assertRequestSize` before reading, `assertFileSize`,
  `assertSafeZip` for `.xlsx` (`lib/api/files.ts`).
- **Rate limits** (tested by `lib/__tests__/rate-limit.test.ts`): every
  limit of Kledg's own code is a named rule of `RATE_LIMITS` in
  `lib/rate-limit.ts` (window, maximum, French message), applied with
  `enforceRateLimit(name, subject)`; never call `consumeRateLimit` or read
  `RATE_LIMIT_DISABLED` elsewhere. Counters live in the `rateLimit` table,
  shared across serverless instances. What is limited:

  | What | Rule | Per |
  |---|---|---|
  | Sign-in, password reset, account creation, OAuth registration and tokens | `authRateLimit` (`lib/auth-policy.ts`) | client IP |
  | API keys (MCP), 300 calls per minute | `mcp-api-key` (`lib/mcp/api-key.ts`: Better Auth verifies a key on first use and once a minute, so its row is not written on every call) | key |
  | First-run setup | `setup` | client IP |
  | Email, password change, account deletion, chart colours and display mode | `account-*` | user |
  | Instance user management (role, ban, email, deletion) | `instance-users` | administrator |
  | Bank API calls (connect, refresh, sync, verify, Qonto) | `bank-api` through `limitBankCalls` / `guardBankConnect` | company |
  | GitHub (updates) | `updates-read`, `updates-write` | administrator |
  | SIREN directory | `siren-lookup` | administrator |
  | Uploads parsed on the server (FEC, CSV, Excel, statements) | `import` | user |
  | Generated documents (FEC, PDF, Excel) | `export` | user |
  | MCP full control | `mcp-full-control` | user |
  | Approval of an action prepared by an assistant | `ai-action-approval` | user |
  | Saving or resetting one's dashboard layout | `dashboard-layout` | user |

  A new route that calls a third party, parses an upload, generates a
  document or changes accounts adds its guard and its line to
  `LIMITED_ROUTES` of the test.

## Frontend

- Follow [design-system.md](design-system.md): tokens, sizes, `PageHeader`,
  `EmptyState`, `Field`, `ConfirmDialog`, `Amount`, `DateDisplay`,
  `StatusBadge`. Its rules are linted.
- **Data loading**: server components load what the page needs to render
  (company layout); client components call the API routes. A client fetch
  handles the three states: loading (skeleton, `aria-busy`), error (message
  with what to try, retry), empty (`EmptyState`). Read `{ error }` from a
  failed response and show it in a toast or inline.
- **Forms**: react-hook-form with a zod schema (`zodResolver`); the same
  schema validates the API body when possible. Validate on submit, then on
  change; never on mount. Amounts through `AmountInput` (cents), dates
  through `DateInput`/`DatePicker` (ISO days).
- **Accessibility**: one `h1`, named icon buttons, labels wired by `Field`,
  focus visible, Escape closes overlays.
- **French copy glossary**: société (never entreprise), exercice, écriture,
  journal, compte, règles d'affectation, rapprochement, relevé, pièce
  justificative, contre-passation, clôture, à-nouveaux, bilan, compte de
  résultat, grand livre, balance. Vouvoiement, sentence case. **No em or en
  dashes** in any text (tested).

## Testing

| Kind | Name | Runs against | Use for |
|---|---|---|---|
| Unit | `*.test.ts` next to the code in `__tests__/` | nothing (mocks) | rules on plain values: money, dates, validators, report math |
| Route | `app/api/__tests__/*.test.ts`, `lib/**/__tests__/*-route.test.ts` | mocked session and Prisma (`lib/__tests__/helpers/prisma-mock.ts`, typed, no `as any`) | status codes, authorization, input validation |
| Database | `*.db.test.ts` | PostgreSQL (`lib/__tests__/helpers/test-db.ts`, `KLEDG_TEST_DATABASE_URL`, `KLEDG_TEST_DB_PREFIX`) | triggers, locks, concurrency, transactions |
| Component | `*.test.tsx` | jsdom | shared components, a11y contracts |
| Architecture | `lib/__tests__/architecture.test.ts`, `routes.test.ts`... | the source tree | the rules of this document |

- **Every feature has a test** (enforced by `lib/__tests__/feature-tests.test.ts`):
  - every route file (`app/**/route.ts`) is imported by a test other than the
    generic guards (authorization matrix, route coverage), which only check
    status codes;
  - every service (`lib/**/*.service.ts`) is imported by a test, or by a
    route that a test imports without mocking the service (routes are thin,
    so testing the route tests its service);
  - every MCP tool (`registerTool('name'`, `fullControlTool({ name: 'name'`)
    is named by a test.

  A `vi.mock` of a module does not count. Files that legitimately have no
  test of their own go in the `ALLOWLIST` of that test with the reason
  (types-only module, pure re-export); it is empty today. An entry that gets
  a test or disappears fails the test until it is removed, so the list stays
  minimal. The check proves nobody forgot a test, not that the test is good:
  assert behaviour with concrete values (figures, French messages, rows
  written, status codes), never a snapshot alone or a bare import.
- Measure with `pnpm test:coverage` (v8, report in `coverage/`), with the
  database tests enabled (`KLEDG_REQUIRE_TEST_DB=1`): without them the
  services they cover read as untested.
- Deterministic: inject `now` (`todayUtc(now)`) instead of reading the
  clock; set `TZ` explicitly in date tests; no network.
- Every accounting or tax rule has a test naming its source, and a
  regression test comes with each bug fix.
- Database tests are skipped when the server is unreachable; run them
  locally before touching triggers, locks or migrations. CI runs them
  against a PostgreSQL service with `KLEDG_REQUIRE_TEST_DB=true`, which
  fails a database test file instead of skipping it when the server is
  missing.
- Each database test file has its own database, `<prefix>_<name>`, set with
  `useTestDatabase(name)` in `vi.hoisted` and prepared with
  `prepareTestDatabase(name)` (`lib/__tests__/helpers/test-db.ts`). The
  prefix is `KLEDG_TEST_DB_PREFIX` (default `kledg_test`): give every
  parallel run (CI job, second checkout, agent) its own prefix, otherwise
  the runs empty each other's tables. Never build a test database URL by
  hand. Details in [lib/__tests__/README.md](../lib/__tests__/README.md).

## Naming, files, comments

- Files and folders in kebab-case; services `verb-noun.service.ts`
  (`close-fiscal-year.service.ts`); React components in PascalCase inside
  kebab-case files; tests in `__tests__/`.
- Domain code lives in `lib/<domain>/`, not in a generic `lib/services/`.
- Code, identifiers, comments, logs and commits in English; UI copy and
  user-facing error messages in French.
- Comments explain why (the rule, its source, the race it prevents), not
  what the next line does. Module headers state the invariant the module
  owns, like `lib/accounting/fiscal-year-closure/lock.ts`.
- No `any` (enforced): use `unknown` and narrow, Prisma generated types
  (`Prisma.XGetPayload`), or zod inferred types.
- Delete code nothing calls instead of keeping it "for later": check with
  `pnpm dlx knip --include exports,types,files` (no dependency to install)
  and grep the tests before removing an export.

## Dependencies

- Prefer the platform and what is installed (zod, date-fns, react-hook-form,
  Radix, sonner) over a new package. A new runtime dependency needs a reason
  in the pull request: what it replaces, its size, maintenance and license
  (AGPL compatible).
- Pin exact versions for packages tied to the framework (`next`,
  `better-auth` plugins); security overrides live in `package.json`
  (`pnpm.overrides`).
- No dependency for one function; no client bundle growth for server needs.

## Known violations

Measured on 2026-10-03 when the rules were added, again after the
robustness pass and again after its follow-up (counts before the follow-up
in parentheses). Lint allowlists are in
`eslint/conventions.mjs` (`KNOWN_VIOLATIONS`); remove a file once it is
clean (the allowlist test fails until you do), never add one.

### Enforced rules (allowlisted files only warn)

| Rule | Count | Files | Top files |
|---|---|---|---|
| `@typescript-eslint/no-explicit-any` | 9 (11) | 5 (5) | `app/(company)/[companyId]/fiscal-years/page.tsx` (2), `components/ui/address-form.tsx` (4), `components/features/companies/establishments-management.tsx` (1), `components/features/companies/shareholders-management.tsx` (1), `lib/services/transactions/transaction-processing-service.ts` (1) |
| `kledg/no-local-time-date` | 0 | 0 | fixed (UTC calendar days through `lib/utils/date.ts`) |
| `kledg/no-parse-float` | 0 | 0 | fixed (amounts through `lib/utils/money.ts`) |
| `no-console` | 0 | 0 | fixed when the rule was added |
| `kledg/no-prisma-in-transaction` | 0 | 0 | |
| Import boundaries, client and server boundary | 0 | 0 | |
| Unwrapped route handlers | 0 | 0 | 9 allowlisted public or self-authenticated routes |
| Design system rules in `PHASE_2_FILES` | 0 (17 raw colors) | 0 (4 files, 5 entries) | fixed: `PHASE_2_FILES` is empty, the design system rules are errors everywhere |

### Reviewed rules (measured, not enforced yet)

| Rule | Count | Top files |
|---|---|---|
| Route handlers querying Prisma directly instead of a lib service | 0 of 148 `app/api` route files import `@/lib/prisma` (20) | fixed: integrations, banking, Qonto, addresses, onboarding, tasks and health call services (the health probe is `lib/health/check-database.service.ts`) |
| Input parsed by hand (`request.json()`/`text()`, `searchParams.get`) instead of the `body`/`query` zod options | 0 files read the body or `searchParams` by hand (10 and 8); 107 use `body` or `query` (92); uploads read the form through `fromForm` and validate its fields with zod in the service | fixed |
| Error responses built by hand (`NextResponse.json({ error })`) | 0 (4 in 3 files) | fixed: typed French errors |
| `try/catch` inside route handlers | 0 files (10 counting health): the answers that must not throw (credential checks answering `{ valid: false }`, the health check, the Revolut callback redirect) catch inside their service | fixed |
| `error.message` of a third party returned to the client | 0 (5 sites in `lib/tasks/refresh-company.ts` and `lib/mcp/tools.ts`): bank providers go through `errorReason` (`lib/banking/errors.ts`), other failures keep only the French message of a typed error, the detail goes to the log | fixed |
| Float arithmetic on amounts (`Number(amount)`, `toFixed`, `Math.round(x * 100)`) | about 76, 45 and 5 sites (105, 63 and 16); `lib/reports/**`, `lib/accounting/validator.ts` and `lib/fixed-assets/**` work in cents | `components/features/fixed-assets/fixed-asset-form-dialog.tsx`, `components/features/accounting/entry-preview-dialog.tsx`, `app/(company)/[companyId]/reports/depreciation/page.tsx`, `lib/transactions/rule-executor.ts` |
| Local-time Date APIs in UI code | about 61 sites (about 55, measured more widely) | `components/features/fixed-assets/fixed-asset-form-dialog.tsx` (23), `app/(company)/[companyId]/fiscal-years/page.tsx` (23) |
| Ad hoc formatting instead of `Amount`/`DateDisplay` | 10 `Intl.NumberFormat` (3 inside `Amount` itself), 12 `toLocaleDateString` in UI code (14 and 14) | `app/(company)/[companyId]/fiscal-years/page.tsx` (9), `components/features/accounting/dashboard-stats.tsx` |
| Duplicated helpers | 0: money in `lib/utils/money.ts`, dates in `lib/utils/date.ts` (accounting edges in `lib/accounting/entry-date.ts`) | Bank statement parsing (`lib/banking/import/amount.ts`, `date.ts`) and PDF amounts (`lib/pdf/utils.ts`) keep their own formats on purpose |
| Generic `lib/services/` and `*-service.ts` names | 4 files (5) | `lib/services/**` (3), `lib/transactions/rule-service.ts`; addresses moved to `lib/addresses` |
| `any` in tests (warning only) | 0 (67 by the previous count, 69 by `pnpm lint`) | fixed: route and service tests mock Prisma with `lib/__tests__/helpers/prisma-mock.ts` and other modules with `vi.mocked` |
| Client data fetching without a shared helper | 74 UI files call `fetch` directly (75); paged lists use `useCursorList` (`hooks/use-cursor-list.ts`) | pages under `app/(company)/[companyId]/` |
| Sign out through `GET /auth/signout` (cross-site logout) | 0 (1): sign out is a same-origin POST, a GET shows a confirmation page | `app/auth/signout/route.ts` |
| Dead code | Unused functions and modules removed; about 100 exported constants and types are only used inside their own module, plus unused shadcn primitives | `pnpm dlx knip --include exports,types,files` lists them |
