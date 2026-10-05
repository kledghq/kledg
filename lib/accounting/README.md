# lib/accounting

The ledger: accounts, journals, entries and fiscal years, and the rules that
keep them valid (PCG 2026, LPF art. A47 A-1 for the FEC). Routes, the MCP
server, imports and crons call these services; none of them writes an entry
another way. General rules (money in cents, dates as calendar days, errors,
transactions and locks) are in
[docs/conventions.md](../../docs/conventions.md). Each module states its
invariant and its sources in its header comment: read it before changing it.

## Entries

| Module | Role |
|---|---|
| `services/entry-lifecycle.service.ts` | The one creation path (`createEntryInTx`, `createEntry`), draft edits and deletion, validation (`validateEntryInTx`, `validateEntries`) and contre-passation (`reverseEntry`). A validated entry is definitive (PCG art. 1031-3). |
| `services/generate-next-entry-number.service.ts` | Provisional numbers for drafts, definitive numbers in fiscal year sequence at validation, under `lockEntryNumbering`. |
| `services/create-accounting-entry*.service.ts`, `services/update-accounting-entry.service.ts` | Route-facing wrappers of the life cycle (with the PCG warnings that do not block). |
| `services/list-entries.service.ts` | Entries list with cursor pages. |
| `services/calculate-account-balance.service.ts` | Balance of one account over a period. |
| `entry-guards.ts` | `assertEntryWritableInFiscalYear`: the single guard for writing in a fiscal year (open, date inside). |
| `entry-date.ts` | Accounting edges of dates: `toEntryDate`, `dayToDate`, `fecDateOf`, `parisDayOf`. Reading and formatting days is `lib/utils/date.ts`. |
| `validator.ts` | Checks on plain values: balance in cents, account codes, dates, account nature. |
| `database-guard.ts` | Messages of the database triggers that protect validated entries. |

Amounts are integer cents through `lib/utils/money.ts`; there is no tolerance
on balance.

## Fiscal years

| Module | Role |
|---|---|
| `fiscal-year-closure/` | Closing in one transaction: closing entry (result to 120 / 129), next fiscal year, à-nouveaux, lock (`lock.ts`: a closed year never changes, PCG art. 1031-4). `fiscal-year-closure.ts` re-exports it for the routes. |
| `opening-balance/` | Opening balances of a company that existed before Kledg (AN journal). |
| `result-allocation/` | Allocation of the previous year's result voted by the shareholders. |
| `manage-fiscal-years.service.ts` | Fiscal years of a company: list, read, create with the PCG chart, dates of an open year, closing and its simulation with the blocking reasons as typed errors. `ownedFiscalYear` is the company-scoped lookup of the routes and the MCP tools. |
| `delete-fiscal-year.service.ts` | Deletes an open fiscal year without entries. |
| `fiscal-year-utils.ts` | Active fiscal year, fiscal year of a date or an entry. |

## Chart of accounts and journals

| Module | Role |
|---|---|
| `pcg-data.ts`, `pcg-utils.ts` | The PCG 2026 chart and lookups on it. |
| `pcg-compliance-checker.ts` | Checks a company chart against the PCG (minimal chart, structure). |
| `create-account.service.ts` | Subdivision of an existing account (PCG art. 932-1). |
| `manage-accounts.service.ts` | Chart of a fiscal year: list, lookup by number, edit (a PCG account keeps its number), ledger of one account. |
| `delete-accounts.service.ts` | Deletes an account with its sub-accounts, or the non PCG accounts of a chart, never a PCG account nor one holding entries. |
| `pcg-chart.service.ts` | Seeds the PCG accounts in a chart and completes a chart with the missing ones. |
| `create-journal.service.ts`, `manage-journals.service.ts`, `default-journals.ts` | Journals of a company (create, list, edit, delete one without entries) and the standard set every company starts with. |

## Errors

`errors.ts` defines the typed errors (`ValidationError`, `ConflictError`,
`NotFoundError`...) and `handleError`, which the route wrappers use to map
them, Prisma errors and the accounting triggers to HTTP responses.

## Tests

Unit tests are in `__tests__/` next to each area; the rules that need
PostgreSQL (triggers, locks, concurrent closings) are in `*.db.test.ts`
files, run as described in [lib/__tests__/README.md](../__tests__/README.md).
