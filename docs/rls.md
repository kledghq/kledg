# Row level security (tenant isolation in PostgreSQL)

Kledg isolates companies in the application: every route resolves a company
through a resolver, checks the user's role (`lib/rbac/authorize.ts`) and
scopes every query by `companyId` ([conventions.md](conventions.md#api-routes)).
Row level security (RLS) repeats that guarantee in PostgreSQL, as defence in
depth for a hosted, multi-tenant Kledg: **a request acting for one user can
never read or write the rows of a company that user cannot reach, even if a
query forgets its `companyId` filter.**

RLS is rolled out behind `KLEDG_RLS`, while the policies always exist:

| `KLEDG_RLS` | Effect |
|---|---|
| `off` (default) | No context is sent, no overhead. The policies are in the database but let every role through until they are switched on (`pnpm db:rls-role`), and never apply to the table owner: existing installs, single-role or not, keep working unchanged. |
| `enforce` | The application connects as a role that is not the owner and has no `BYPASSRLS` (`kledg_app`). Every statement runs in a transaction that first sets the request's context; the policies filter every row. A role that would bypass the policies, or policies not switched on, are refused at the first query. |

Any other value stops the server at the first query: a typo must not
silently turn the protection off.

## Threat model

What RLS protects against: application code that forgets a company filter
(`findUnique({ where: { id } })` on an id from the request, a report query
without `companyId`, a nested include reaching another company), raw SQL
written without a tenant predicate, a new route or tool that skips the
resolver. With `enforce`, such a query returns no row of another company and
cannot insert, update or delete one.

What it does not protect against:

- **SQL injection that runs arbitrary statements.** The context lives in
  transaction settings that the application role sets itself; injected SQL
  could set them too. Kledg has no string-built SQL (`sql-injection.test.ts`
  guards it); RLS is not a substitute.
- **The identity itself.** The database trusts the user id the application
  took from the session. A forged session is an authentication bug, not a
  tenant bug.
- **Instance administrators.** They reach every company by design
  (`isGlobalAdmin`); the database reads that status from `user.role`, never
  from the context.
- **Existence through unique constraints.** A unique index (company SIREN or
  slug, organization slug) still refuses a value another tenant holds. The
  value is not readable, only its existence. The SIREN and slug checks go
  through `kledg_company_identifier_taken`, which answers that boolean and
  nothing else (`lib/companies/identifiers.ts`).
- **Subsidiaries of a holding.** The shareholder rows that make a company a
  subsidiary belong to the subsidiary. `kledg_group_subsidiary_ids` answers
  their company ids, and nothing else, for a holding the context reaches,
  so the group view can say that a subsidiary exists without reading it
  (`lib/management-fees/holding.ts`, [vue-groupe.md](vue-groupe.md)). A
  member of the holding learns the ids of its subsidiaries; the
  application checks access to each one and never returns an id it cannot
  reach.

## Tenancy model

The tenant is the **company**. A user reaches a company through a membership
(`member` row of the company's `organization`); an instance administrator
(`user.role = 'admin'`, not banned) reaches every company. This is the same
rule as `requireCompanyAccess`, evaluated in the database.

### Context

Each transaction carries these settings, set with
`set_config(name, value, true)` (transaction scoped):

| Setting | Values | Meaning |
|---|---|---|
| `kledg.access` | `user`, `system`, `anonymous` | Who acts. `user`: a signed-in user, an API key or an OAuth assistant acting for a user. `system`: a server job with no user (the bank sync cron, tests). `anonymous`: a request without a session (sign-in, password reset, setup). Empty: no context. |
| `kledg.user_id` | user id | The acting user (`user` only). |
| `kledg.company_scope` | PostgreSQL text array literal, or empty | Narrows the reachable companies, never widens them: the company grant of an AI assistant or API key, the company of a system job. Empty: no narrowing. `{}`: no company. |
| `kledg.reason` | text | The system job (`cron:bank-sync`...), for debugging only. |

The database computes what a context reaches with two functions, `STABLE`,
`PARALLEL SAFE` and `SECURITY DEFINER` (they read `user`, `member` and
`organization` as the owner, whatever the policies on those tables):

- `kledg_rls_unrestricted()`: true while the policies are switched off, for
  `system` without scope, and for an active instance administrator without
  scope.
- `kledg_rls_company_ids()`: the reachable company ids otherwise: the scope
  for `system` and administrators; for a user, the companies of their
  memberships intersected with the scope; nothing for `anonymous`, a banned
  or unknown user, or no context.

A company table's policy is

```sql
(SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])
```

The scalar subqueries make each function an *InitPlan*: evaluated once per
statement, not once per row, and `= ANY(array)` can use the `companyId`
indexes and parallel plans. Nothing is cached across statements: a
membership removed or a role changed applies to the next statement. A
malformed scope raises an error (fails closed).

### Why the database derives access from the user id

The other option was for the application to compute the allowed company ids
per request and pass them in a setting. It is cheaper (no membership lookup),
but the database would then trust a list that application code builds: a
bug there widens access silently. Deriving the companies in the database
from the user id means the application only asserts *who* acts; *what* that
user reaches is decided by the membership rows, the same ones the
application checks. The cost is one indexed lookup on `member(userId)` per
statement (tens of microseconds). The company scope keeps the narrowing
that only the application knows (an assistant's grant), and it can only
remove companies.

### The switch

`kledg_rls_enforced()` is an `IMMUTABLE` SQL function that returns `false`
after the migration: the policies then let every role through, so an
install whose application role is not the owner keeps working on upgrade.
`pnpm db:rls-role` replaces it with `SELECT true` (only the owner can).
Being immutable, it is folded into each plan and costs nothing.

## Policies

Every table of the `public` schema is in exactly one class below. The guard
test `lib/rls/__tests__/policy-coverage.db.test.ts` lists the tables of a
migrated database and fails on a table that has neither RLS with the four
policies nor an entry in the exemption list of `lib/rls/tables.ts`.

Each covered table has RLS enabled and four policies, `kledg_rls_select`,
`kledg_rls_insert`, `kledg_rls_update`, `kledg_rls_delete`: `USING` for reads,
updates and deletes, `WITH CHECK` for inserts and updates, so a row can be
neither read, created nor moved into a company outside the context.

| Class | Tables | Rule |
|---|---|---|
| Company | `companies` (by `id`) | the company is reachable |
| Company scoped | `addresses`, `establishments`, `shareholders`, `fiscal_years`, `accounts`, `journals`, `accounting_entries`, `bank_connections`, `transaction_rules`, `integrations`, `import_jobs`, `fixed_assets`, `fixed_asset_depreciations`, `tax_regime_history`, `attachments`, `balance_sheet_line_configs`, `income_statement_line_configs`, `company_onboarding`, `tiers`, `invoices`, `expense_claimants`, `expense_reports`, `expense_category_rules`, `budgets`, `management_fee_conventions`, `management_fee_billings`, `subscription_decisions`, `provisions`, `provision_assessments`, `investment_grants`, `investment_grant_transfers`, `accounts_approvals`, `accounting_methods`, `accounting_changes`, `annexe_notes`, `simple_mode_entries`, `vat_return_filings`, `corporate_tax_returns`, `remuneration_scenarios`, `local_taxes`, `declaration_statuses` | `companyId` is reachable |
| Company scoped, denormalized | `entry_lines`, `bank_transactions` | `companyId` is reachable; the column is set by a trigger from the parent row (below) |
| Through the parent | `bank_accounts` (connection), `bank_transaction_matches` (bank account), `transaction_rule_conditions`, `transaction_rule_entry_lines` (rule), `transaction_mappings` (connection), `integration_features`, `integration_resources`, `integration_sync_logs` (integration), `import_mappings` (import job), `balance_sheet_config_history`, `income_statement_config_history` (line config), `invoice_lines`, `invoice_vat_breakdowns`, `invoice_payments` (invoice), `expense_lines` (report), `budget_lines` (budget), `budget_line_amounts`, `budget_recurring_items` (line), `management_fee_subsidiaries` (convention) | `EXISTS` on the parent, which applies the parent's own policy |
| Company and user | `dashboard_layouts`, `sidebar_preferences`, `mcp_confirmations`, `mcp_pending_actions` | the company is reachable and the row is the user's (or the context is unrestricted); a pending action without company (`create_company`, migration `20261111090000_mcp_actions_without_company`) is its user's only |
| User | `ai_access_grants`, `user_preferences` | `userId` is the acting user, or the context is unrestricted |
| Grant companies | `ai_access_grant_companies` | read and delete when the grant is visible (the user's own); insert and update also need the company reachable, so a user cannot grant an assistant a company they do not belong to |
| Membership | `organization` (company reachable), `member` (own membership, or organization visible), `invitation` (organization visible) | reads as stated; writes only for an unrestricted context (instance administrators, system), except that a user may delete their own membership |
| Optional company | `audit_logs` (company reachable; rows without company are instance events: any context writes them, only unrestricted contexts read them), `persons` (company reachable, or no company and a shareholder of a reachable company), `balance_sheet_config_templates`, `income_statement_config_templates` (company reachable, or public template) | as stated |
| Exempt | `user`, `session`, `auth_account`, `verification`, `apikey`, `jwks`, `oauthClient`, `oauthResource`, `oauthClientResource`, `oauthRefreshToken`, `oauthAccessToken`, `oauthConsent`, `oauthClientAssertion`, `rateLimit`, `update_connection`, `_prisma_migrations` | no tenant data; see below |

An `INSERT ... RETURNING` must also pass the select policy: audit rows
without company are therefore written with `createMany` (no `RETURNING`).

### Child tables: `EXISTS` or a denormalized `companyId`

A child row without `companyId` is reachable when its parent is: the policy
is `EXISTS (SELECT 1 FROM parent WHERE parent.id = child."parentId")`, and the
parent's own policy applies inside the subquery. It needs no schema change
and cannot drift.

PostgreSQL does not turn a sublink of a policy into a join: it runs as a
correlated subplan, once per row the query reads. Measured on the benchmark
dataset (`scripts/bench`, large profile, 316 608 entry lines), the trial
balance query of the largest company went from 38 ms without RLS to 167 ms
with an `EXISTS` policy on `entry_lines` (one primary key probe per line,
41 142 times, and no parallel plan), and to 47 ms with a `companyId` column
on the line. So the two large tables read by reports and lists,
`entry_lines` and `bank_transactions`, carry a `companyId` maintained by the
database:

- `kledg_rls_entry_line_company` (`BEFORE INSERT OR UPDATE OF
  "accountingEntryId", "companyId"` on `entry_lines`) copies the entry's
  company;
- `kledg_rls_bank_transaction_company` (same on `bank_transactions`, with
  `"bankAccountId"`) copies the company of the account's connection;
- moving a parent to another company (`accounting_entries."companyId"`,
  `bank_accounts."bankConnectionId"`, `bank_connections."companyId"`)
  recomputes the children in the same statement.

The application never writes the column (`@ignore` in the Prisma schema); a
value sent anyway is overwritten. The other children are small or read a
few rows at a time, where the per row subplan costs microseconds, and keep
`EXISTS`.

### Exempt tables

Better Auth's tables are read before any identity exists: sign-in looks a
user up by email, a session by its token, an API key by its hash, an OAuth
token by its value. A policy there would need a context that Better Auth
itself establishes, and protects nothing that the secret in the lookup does
not already protect. They hold no accounting data. `rateLimit` holds
counters keyed by IP or user, `update_connection` the instance's GitHub
connection (instance administrators only, checked by the route).
`_prisma_migrations` belongs to the migration tool (the application role
gets no right on it).

### Triggers and integrity functions

Triggers run as the role of the statement, so with RLS they would only see
the rows of the context: the closed fiscal year lock, the validated entry
guard and the company deletion guard would read nothing for a row they
cannot see, and let the change through. The migration makes them
`SECURITY DEFINER` with a fixed `search_path`, so integrity checks see every
row whatever the context. Foreign key checks and cascades already run as the
table owner. Later integrity triggers are created `SECURITY DEFINER` in their
own migration (`kledg_lock_closed_year_adjustments`, which keeps the
provision assessments and grant transfers of a closed year unchanged), and
listed in `DEFINER_TRIGGER_FUNCTIONS` (`lib/rls/tables.ts`).

### `ENABLE` without `FORCE`

`FORCE ROW LEVEL SECURITY` would apply the policies to the table owner too.
The owner runs the migrations: every future data migration (backfills,
`UPDATE` of existing rows) would then see no row and silently do nothing,
and every single-role install would lose its data at once. So the policies
apply to every role except the owner (and superusers), and `enforce`
requires the application to connect as another role: at the first query it
checks that the role is not a superuser, has no `BYPASSRLS`, does not own
the tables and that the policies are switched on, and refuses every query
otherwise.

## Roles

| Role | Used by | Rights |
|---|---|---|
| Owner (the role of `DATABASE_MIGRATION_URL`, else `DATABASE_URL_UNPOOLED`) | `prisma migrate deploy`, `pnpm db:rls-role` | owns the schema |
| `kledg_app` (or the name given to `pnpm db:rls-role -- --role`) | the application with `KLEDG_RLS=enforce` (`KLEDG_DATABASE_URL`, else `DATABASE_URL`) | `SELECT, INSERT, UPDATE, DELETE` on the tables, sequences and functions; no DDL, no `BYPASSRLS`, nothing on `_prisma_migrations`, no `EXECUTE` on the owner-only `SECURITY DEFINER` functions (`kledg_purge_audit_logs`, `kledg_assert_fiscal_year_open`) |

`pnpm db:rls-role` (`scripts/rls-role.ts`) creates the role if needed, grants
it the rights above on the existing tables and, through `ALTER DEFAULT
PRIVILEGES`, on the tables future migrations create, then switches the
policies on. It is idempotent; `--off` switches the policies off again.
Setup per host: [self-hosting.md](self-hosting.md#isolation-des-sociétés-dans-la-base-rls).

## Context propagation

The context is held per request in an `AsyncLocalStorage`
(`lib/rls/context.ts`). The database layer (`lib/rls/pool.ts`) applies it to
the PostgreSQL connection, so every query of the request carries it: Prisma
model calls, `$queryRaw` and `$executeRaw`, interactive and batch
transactions, and Better Auth (which goes through the same Prisma client).

| Entry point | Context |
|---|---|
| `companyRoute`, `authedRoute`, `adminRoute` (`lib/api/route.ts`) | the signed-in user, from the company resolver to the handler; the session lookup itself runs as `anonymous` |
| Server components and server actions | derived from the session cookie of the request on the first statement without a context, once per request (`lib/rls/request-context.ts`) |
| MCP (`lib/mcp/auth.ts`) | the user of the API key or OAuth token, then narrowed to the connection's company grant for the tools |
| Crons (`lib/banking/sync-banks.service.ts`) | `system`, reason `cron:bank-sync`, after the `CRON_SECRET` check: the integrations are listed unscoped, then each company's sync runs narrowed to that company and writes an audit row in it |
| Automatic period closing (`lib/accounting/period-lock/auto-lock.service.ts`) | `system`, reason `cron:period-lock`, after the `CRON_SECRET` check: the companies are listed unscoped, then each company in monthly mode is locked narrowed to that company |
| Secret rotation (`lib/crypto/reencrypt.ts`, at server start) | `system`, reason `secret-rotation`, only while an older auth secret is configured: the sealed credentials of every company (bank connections, integrations, GitHub token) are read and sealed again with the current key, under an advisory lock |
| Company creation by a user (`lib/companies/create-company.service.ts`) | `system`, reason `company-creation`, only when the instance policy lets a user who is not an instance administrator create a company (`companyCreationRefusal`, [extension-points.md](extension-points.md#company-creation)): the company has no member yet, and its organization and the creator's membership are writes that only an unrestricted context may do. Kledg's default policy never takes this path |
| Better Auth (`/api/auth/*`) | derived from the session cookie when there is one, else `anonymous`; its own tables are exempt |
| Setup (`/setup`) | `anonymous` (only Better Auth tables are written) |
| Scripts and seeds | `system` with reason `script` (`withSystemContext`) |
| Instance extensions (forks, the demo) | `withSystemContext('instance-extension', fn, { companyIds })` or `withUserContext(userId, fn)`, from `lib/rls/context.ts` ([extension-points.md](extension-points.md#row-level-security)) |

`withUserContext`, `withSystemContext`, `withAnonymousContext` and
`runWithRlsContext` start a returned Prisma promise inside the context:
Prisma's promises are lazy, and awaiting one outside the callback would run
its query without the context.

System contexts are listed: `SystemReason` (`lib/rls/context.ts`) is a closed
union, every use is logged at `info` with its reason, and
`lib/rls/__tests__/system-context-usage.test.ts` fails when a file outside the
documented list calls `withSystemContext`.

### Deriving a context from the request

The derivation reads the session row by its token itself, with one query on
the exempt `session` table: it never calls Better Auth, whose adapter state
(a transaction it is opening) may belong to the very statement being
derived. The token is the secret Better Auth checks too; the cookie's
signature only saves Better Auth a lookup for forged values, which find no
row here. Banned users are refused by the database (`kledg_rls_company_ids`).
Statements on exempt tables only (the session lookup of every request) run
without deriving anything.

### Applying the context to a connection

Neon's pooled URL goes through PgBouncer in transaction mode: a session
setting (`SET`, `set_config(..., false)`) would stay on a server connection
that the next transaction, of another tenant, may get. Only a setting local
to a transaction is safe, so with `enforce` **every statement runs inside a
transaction that starts by setting the context**:

- a statement outside a transaction (most Prisma reads) becomes
  `BEGIN; SELECT set_config(...)` (one round trip), the statement, `COMMIT`:
  two round trips more than without RLS. A statement on exempt tables only
  runs as it is;
- a transaction (`$transaction`, Prisma's own for nested writes) holds its
  `BEGIN` back and sends `BEGIN; SELECT set_config(...)` in front of its first
  statement: no round trip more. A first statement
  `SET TRANSACTION ISOLATION LEVEL ...` becomes `BEGIN ISOLATION LEVEL ...`;
  an empty transaction sends nothing.

The context is read when the statement or the connection is requested, in
the caller's async context, never later from a pool callback that may run
for another request. The context of a transaction is the one active when it
starts; a context entered inside a transaction callback applies to the next
transaction only.

Prisma merges the `findUnique` calls of the same shape issued in the same
tick into one query, dispatched from the context of the first call: two
concurrent requests could share it. With `enforce`, `lib/rls/batching.ts`
turns that batching off outside transactions, so each lookup runs in its own
caller's context (the isolation test reproduces the leak without it).

### Missing context

With `enforce`, a statement outside any context (no request, no
`withSystemContext`) runs with empty settings: the policies return no row,
and the database layer refuses writes (`INSERT`, `UPDATE`, `DELETE`, `MERGE`,
`TRUNCATE`, `COPY`, or a CTE containing one) with an error before they are
sent. Inside a request, a missing session is the `anonymous` context, which
reaches no company.

## Performance

See the benchmark table in the CHANGELOG entry and in the pull request:
`scripts/bench` (large profile: 21 companies, 115 048 entries, 316 608 lines,
160 000 bank transactions; local PostgreSQL 17) with `KLEDG_RLS=off` and
`enforce`. Report and list queries keep their plans (the company filter is
an InitPlan on an indexed column). Each statement outside a transaction
costs two more round trips, which matters more on a remote database (about
a millisecond each from Vercel to Neon in the same region) than locally.

## Tests

| Test | Checks |
|---|---|
| `lib/rls/__tests__/policy-coverage.db.test.ts` | every table has RLS and its four policies, or is exempt with a reason; no `FORCE`; the integrity functions are `SECURITY DEFINER`; every `SECURITY DEFINER` function has `search_path = public, pg_temp`, and only the ones the application calls are executable by its role and `PUBLIC`; the policies call the access functions as InitPlans |
| `lib/rls/__tests__/tenant-isolation.db.test.ts` | with user A's context, raw SQL and Prisma cannot read, insert, update, delete or move rows of company B in every covered table; no context and the anonymous context read nothing; writes without context are refused; scopes narrow and never widen; administrators and system contexts reach everything; banned and unknown users nothing; the denormalized `companyId` cannot be forged; concurrent lookups of two users are never batched together; switched off, every role passes |
| `lib/rls/__tests__/pool.db.test.ts` | context per statement and per transaction, captured at call time, deferred `BEGIN`, isolation levels, empty transactions, refusal of writes without context, refusal of a bypassing role |
| `lib/rls/__tests__/sql.test.ts` | settings, escaping, statement classification, `KLEDG_RLS` parsing |
| `lib/rls/__tests__/system-context-usage.test.ts` | `withSystemContext` only in the documented places |
| The whole suite with `KLEDG_RLS=enforce` | `lib/__tests__/helpers/test-db.ts` creates the `kledg_app_test` role, switches the policies on and connects the application as that role; rows that tests write or read directly, outside a request, go through the `system` context; requests go through their real context; migration tests replay their SQL as the owner (`queryAsOwner`), as `prisma migrate deploy` does |

Run the suite under RLS:

```bash
KLEDG_RLS=enforce KLEDG_REQUIRE_TEST_DB=1 KLEDG_TEST_DB_PREFIX=kledg_rls \
KLEDG_TEST_DATABASE_URL=postgresql://kledg:kledg@localhost:55432/kledg_test pnpm test:run
```

Route tests that mock the signed-in user must give it its membership in the
database too (`seedMembership`, `lib/__tests__/helpers/membership.ts`): the
database, not the mock, decides what the user reaches.

## Enabling it on an existing instance

1. Upgrade: the migration adds the functions, the policies and the
   denormalized columns. Nothing changes while `KLEDG_RLS` is `off`.
2. Create the application role and switch the policies on, with the owner's
   connection: `DATABASE_MIGRATION_URL=<owner url> pnpm db:rls-role -- --password <secret>`.
3. Give the application that role: `KLEDG_DATABASE_URL` (it comes before
   `DATABASE_URL`, which a host integration such as Neon on Vercel may
   manage and which then keeps the owner's URL), or `DATABASE_URL` itself
   with the owner in `DATABASE_MIGRATION_URL` for migrations. Set
   `KLEDG_RLS=enforce`, redeploy.
4. To go back: `KLEDG_RLS=off` and remove `KLEDG_DATABASE_URL` (the owner is
   never subject to the policies), or `pnpm db:rls-role -- --off`.
