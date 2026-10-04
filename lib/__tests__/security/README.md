# lib/__tests__/security

Permanent attack test suite. Each file targets one class of weakness an
attacker probes; together with `lib/api/__tests__/authorization-matrix.test.ts`
(the deep per-actor / per-role / IDOR matrix) it guards the application against
regressions in authorization, injection, SSRF, XSS, redirects, auth/session and
accounting business logic.

Code is English, UI copy is French, no em or en dashes (house style).

## Files

| File | Area | DB |
|---|---|---|
| `route-coverage.test.ts` | Enumerates every `app/**/route.ts` handler; asserts an anonymous caller gets 401, with a reasoned `PUBLIC_ROUTES` allowlist. A new route is caught automatically. | no |
| `sql-injection.test.ts` | Static guard: no `$queryRawUnsafe` / `$executeRawUnsafe` / `Prisma.raw` in production code (all SQL is parameterised tagged templates). | no |
| `ssrf.test.ts` | Qonto file URL allowlist (Qonto domains and `qonto*` S3 buckets only) and the company-logo guard reject loopback / link-local / private / non-https; `fetchQontoFile` never calls fetch for a refused URL and stops reading past 25 MiB; `public-https-fetch` refuses non-public resolved addresses at connect time. | no |
| `parsers-xml-ofx.test.ts` | camt.053 refuses XXE / external entities / billion laughs; deep nesting and huge attributes are bounded; OFX tokenizer is linear and bounds depth and token sizes (seeded pathological corpus under a time budget); OFX numeric references no longer crash. | no |
| `injection-redos.test.ts` | User-controlled rule regex (linear-time matcher, checked at save, step budget, stored bad patterns reported) and FEC `cleanEntryNumber` ReDoS surfaces. | no |
| `export-injection.test.ts` | CSV formula-injection neutralisation (`lib/reports/csv-safe`), xlsx text-cell pinning, FEC field sanitisation. | no |
| `open-redirect.test.ts` | `safeRedirectPath` never returns an off-site or `javascript:` target. | no |
| `parser-fuzz.test.ts` | Seeded CSV/OFX/camt/xlsx fuzzing never hangs or crashes (per-input time budget). `KLEDG_FUZZ=1` for the large corpus. | no |
| `xss-render.test.tsx` | Release-notes renderer and URL/logo guards produce no script sink (jsdom). | no |
| `mcp-authorization.db.test.ts` | MCP tools x access level x company grant; a company outside the grant is refused, including a subsidiary reached by the management fee tools. | yes |
| `mass-assignment.db.test.ts` | Extra body fields (id, entryNumber, status, role, createdById...) are ignored or refused. | yes |
| `nested-idor.db.test.ts` | Foreign-company object ids in a body (accountId, journalId, ruleId, entryId) are refused. | yes |
| `business-logic.db.test.ts` | Closed-year writes, validated-entry immutability, balance/overflow/sub-cent, double reconcile, result-allocation guard; plus pure FEC-tampering. | yes |
| `account-preregistration.db.test.ts` | An unconfirmed account added to a company is reset like a new one (KLEDG-SEC-011). | yes |
| `auth-session.db.test.ts` | API key prefix + hashing at rest, disabled key refused at once. | yes |
| `findings.ts` | Finding registry (new + delegated) with CVSS vectors; `skip(id, reason)` builds the skip tag. | - |
| `helpers/tenants.ts` | Shared two-tenant seed + `call()` for the DB tests. | - |

## Running

Pure tests run anywhere. The `*.db.test.ts` files need the verify database and
are skipped without it unless `KLEDG_REQUIRE_TEST_DB=true`:

```bash
KLEDG_TEST_DATABASE_URL=postgresql://kledg:kledg@localhost:55432/postgres \
KLEDG_TEST_DB_PREFIX=kledg_pentest_b KLEDG_REQUIRE_TEST_DB=true \
pnpm vitest run lib/__tests__/security
```

`xss-render.test.tsx` runs in the jsdom project (`--project dom`); `pnpm test:run`
runs both projects.

## Findings

New findings this suite documents (see `findings.ts` for CVSS vectors and
evidence) are tagged on skipped tests by id, so the test turns into an enabled
regression once the fix lands; a fixed finding has status `fixed`, its commit
in `fixedIn`, and its test enabled under `[id] fixed: <title>`. Fixed:
`KLEDG-SEC-001` (rule regex ReDoS), `KLEDG-SEC-002` (OFX tokenizer),
`KLEDG-SEC-003` (CSV formula injection), `KLEDG-SEC-004` (FEC entry number
regex), `KLEDG-SEC-005` (Qonto file hosts and address check),
`KLEDG-SEC-006` (streamed download budget), `KLEDG-SEC-007` (explicit AI
grants), `KLEDG-SEC-008` (API key default level), and in round 2 `KLEDG-SEC-010`
(concurrent management fee generations), `KLEDG-SEC-011` (account
pre-registration takeover, kledg-cloud KLEDG-CLOUD-004) and `KLEDG-SEC-012`
(company kept when the creation hook fails, kledg-cloud KLEDG-CLOUD-006), plus the
round 2 hardening notes `KLEDG-SEC-013` (SECURITY DEFINER search_path and
EXECUTE), `KLEDG-SEC-014` (read-only check fails closed), `KLEDG-SEC-015`
(amount bounds, French 400), `KLEDG-SEC-016` (self-authenticated paths on
segments) and `KLEDG-SEC-017` (holding lookups narrowed). Expense report
self-validation stays a documented control choice (pentest round 2), not a
finding. Findings from the code
review carry a `KLEDG-DEL-*` id; all of them are fixed and their tests are
enabled. `KLEDG-SEC-009` (password reset timing) is fixed too.
