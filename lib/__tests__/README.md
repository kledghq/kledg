# lib/__tests__

Cross-cutting tests and the shared test helpers. Tests of one module live
next to it, in that module's `__tests__/` folder; the kinds of tests and their
rules are in [docs/conventions.md](../../docs/conventions.md#testing).

## What is here

| File | Checks |
|---|---|
| `architecture.test.ts` | Import boundaries: client code never reaches server modules |
| `feature-tests.test.ts` | Every route, service and MCP tool is imported or named by a test (`ALLOWLIST` with reasons) |
| `conventions-allowlist.test.ts` | `KNOWN_VIOLATIONS` (`eslint/conventions.mjs`) lists only files that still break their rule |
| `design-system-guards.test.ts` | Design system rules that ESLint cannot express |
| `accounting-services.test.ts`, `accounting-validator.test.ts` | Entry numbering, entry services and the validators of `lib/accounting/validator.ts` |
| `reports*.test.ts` | Balance sheet and income statement principles (mocked Prisma) |
| `auth-policy.test.ts`, `session.test.ts`, `safe-redirect.test.ts` | Authentication rules, session reads, redirect targets |
| `prisma-*.test.ts` | Connection retry and pool sizing |
| `setup-race.test.ts`, `list-pagination.db.test.ts` | PostgreSQL: concurrent instance setup, paged lists |
| `test-db-names.test.ts` | Names of the test databases (below) |
| `prisma-mock.test.ts` | The typed Prisma mock of route tests (below) |

## Running

```bash
pnpm test:run                       # everything once
pnpm test                           # watch mode
pnpm vitest run lib/accounting      # one folder
pnpm test:coverage
```

## Database tests

`*.db.test.ts` files (and a few route tests such as
`lib/api/__tests__/authorization-matrix.test.ts`) run against a real
PostgreSQL server through `helpers/test-db.ts`. They are skipped when the
server does not answer, unless `KLEDG_REQUIRE_TEST_DB=true`: then each of
those files fails with the reason. CI sets it, with a PostgreSQL 17 service
(`.github/workflows/ci.yml`, job `check`), so a run never passes without them.
Reproduce the CI run locally:

```bash
KLEDG_TEST_DATABASE_URL=postgresql://kledg:kledg@localhost:55432/postgres \
KLEDG_TEST_DB_PREFIX=kledg_ci_local KLEDG_REQUIRE_TEST_DB=true pnpm test:run
```

- Server: `KLEDG_TEST_DATABASE_URL`, by default
  `postgresql://kledg:kledg@localhost:55432/kledg_test` (the `kledg-verify-db`
  container). Only the host, port and credentials of that URL are used.
- One database per test file, named `<prefix>_<name>`, created and migrated
  from `prisma/migrations` on first use (rebuilt when a migration changes),
  then emptied before the file's tests.
- **Prefix**: `KLEDG_TEST_DB_PREFIX`, `kledg_test` by default. Two runs with
  the same prefix share databases and empty each other's tables, so give
  each parallel run its own prefix (CI job, second checkout, agent):

  ```bash
  KLEDG_TEST_DB_PREFIX=kledg_ci_${GITHUB_JOB} pnpm test:run
  ```

  Lowercase letters, digits and `_`, starting with a letter; the full name
  must fit in 63 bytes. Drop the databases of a finished run with:

  ```bash
  psql "$KLEDG_TEST_DATABASE_URL" -Atc "SELECT datname FROM pg_database WHERE datname LIKE 'kledg_ci_42\_%'" \
    | xargs -I{} psql "$KLEDG_TEST_DATABASE_URL" -c 'DROP DATABASE "{}" WITH (FORCE)'
  ```

A new database test points `DATABASE_URL` at its database before
`lib/prisma` is imported, then prepares it in `beforeAll`:

```ts
await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('my_feature')
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

describe.skipIf(!available)('my feature', () => {
  beforeAll(async () => {
    await prepareTestDatabase('my_feature')
  })
})
```

`PRINCIPES_COMPTABLES_A_TESTER.md` lists accounting principles that still
need a test.

## Mocked Prisma in route tests

Route and unit tests that do not need PostgreSQL mock `@/lib/prisma` with
`helpers/prisma-mock.ts` instead of a hand-written object cast with `as any`:

```ts
vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())

import { prisma } from '@/lib/prisma'
import { asPrismaMock } from '@/lib/__tests__/helpers/prisma-mock'

const db = asPrismaMock(prisma)

db.account.findMany.mockResolvedValue([{ id: 'acc-1', code: '512000' }])
expect(db.account.findMany.mock.calls[0][0]?.where).toEqual({ companyId: 'company-1' })
```

Every model method exists as a `vi.fn()` on first access; model names,
method names and call arguments are typed, resolved values are free (partial
rows). `$transaction` runs its callback with the mock. Other mocked modules
are reached with `vi.mocked(fn)`, never `(fn as any)`.

