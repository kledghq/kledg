# Notes for coding agents

Kledg: open-source French accounting app (PCG 2026), Next.js 16 App Router + Prisma 7 + Better Auth, self-hosted on Vercel + Neon.

- Package manager: pnpm. Verify with `pnpm typecheck && pnpm lint && pnpm test:run`.
- UI copy is French; code, comments and commit messages are English. No em dashes in any text.
- Company-scoped pages live in `app/(company)/[companyId]/`; navigation is defined once in `components/layout/nav-config.ts`.
- API routes are built with `companyRoute`, `authedRoute` or `adminRoute` (`lib/api/route.ts`), which check access (`lib/rbac/authorize.ts`) and map errors (`handleError` in `lib/accounting/errors.ts`).
- Kledg makes no model calls itself: AI assistants work through the MCP server (`lib/mcp`, `app/api/mcp`).
- Emails go through `lib/email`; templates in `lib/email/templates.ts`.
- Schema changes need a migration in `prisma/migrations` (`pnpm db:migrate:dev`).
- Accounting and tax rules need tests and a cited source (PCG article, BOFiP, form notice).
- Documentation is split: user guides live on the website (www.kledg.com/fr/docs, `content/docs/fr` in `kledghq/website`), technical docs live in `docs/` here (code, API, calculation rules, rights). Do not put step-by-step user instructions in `docs/`; link to the guide instead.

## Conventions

Read [docs/conventions.md](docs/conventions.md) before changing code: layers and import boundaries, route wrappers, transactions and locks, money in cents, dates as calendar days, accounting invariants, errors, security, tests. UI rules are in [docs/design-system.md](docs/design-system.md).

- Most rules are enforced by `pnpm lint` (`eslint/conventions.mjs`) and architecture tests (`lib/__tests__/architecture.test.ts`, `lib/api/__tests__/routes.test.ts`).
- Files listed in `KNOWN_VIOLATIONS` (`eslint/conventions.mjs`) or `PHASE_2_FILES` (`eslint.config.mjs`) are debt: remove a file once you fix it, never add one.
