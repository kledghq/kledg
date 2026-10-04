/**
 * Hot path benchmark: latency (p50, p95) and SQL statements per request of
 * the routes, services and MCP tools a user hits most, on a generated
 * dataset (scripts/bench/dataset.ts).
 *
 *   pnpm vitest run --config scripts/bench/vitest.config.mts
 *
 * Variables:
 * - KLEDG_BENCH_PROFILE: tiny | small | medium | large (default large)
 * - KLEDG_BENCH_DATABASE: reuse an existing generated database instead of
 *   creating (and dropping) kledg_bench_<profile>_<time>
 * - KLEDG_BENCH_ITERATIONS: measured runs per path (default 15, after 2 warmups)
 * - KLEDG_BENCH_ONLY: comma separated path names to run
 * - KLEDG_BENCH_OUT: file to write the results to (JSON)
 * - KLEDG_BENCH_VERBOSE=1: print the statements of the first run of each path
 * - KLEDG_RLS=enforce: measure under row level security (docs/rls.md), as
 *   the role kledg_app_bench (created with the policies switched on)
 *
 * Requests go through the real route handlers, Better Auth session lookup
 * included (the session cookie of a signed-in user, through a mocked
 * next/headers). Statements are counted at the node-postgres client, so
 * BEGIN/COMMIT and the statements of Better Auth count too.
 */

import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, it, vi } from 'vitest'

const bench = vi.hoisted(() => {
  const profile = process.env.KLEDG_BENCH_PROFILE ?? 'large'
  const database = process.env.KLEDG_BENCH_DATABASE ?? `kledg_bench_${profile}_${Date.now()}`
  const base = new URL(process.env.KLEDG_BENCH_BASE_URL ?? 'postgresql://kledg:kledg@localhost:55432/postgres')
  base.pathname = `/${database}`
  process.env.DATABASE_URL = base.toString()
  process.env.BETTER_AUTH_SECRET ??= randomBytesHex(32)
  process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
  process.env.RATE_LIMIT_DISABLED = 'true'
  function randomBytesHex(n: number) {
    // vi.hoisted runs before imports: no node:crypto import available here
    let out = ''
    for (let i = 0; i < n; i++) out += Math.floor(Math.random() * 256).toString(16).padStart(2, '0')
    return out
  }
  const cookie = { value: '' }
  return {
    /** The session cookies of the bench user (shared with the next/headers mock). */
    jar: cookie,
    profile,
    database,
    reuse: Boolean(process.env.KLEDG_BENCH_DATABASE),
    get cookie() {
      return cookie.value
    },
    set cookie(value: string) {
      cookie.value = value
    },
  }
})

// Route handlers read the session from next/headers: hand them the bench cookie.
vi.mock('next/headers', () => {
  const cookies = () => new Map(bench.jar.value.split('; ').filter(Boolean).map((c) => [c.slice(0, c.indexOf('=')), c.slice(c.indexOf('=') + 1)]))
  return {
    headers: async () => new Headers({ cookie: bench.jar.value }),
    cookies: async () => ({
      get: (name: string) => (cookies().has(name) ? { name, value: cookies().get(name)! } : undefined),
      getAll: () => [...cookies()].map(([name, value]) => ({ name, value })),
      has: (name: string) => cookies().has(name),
      set: () => undefined,
      delete: () => undefined,
    }),
  }
})

import { Client } from 'pg'
import { NextRequest } from 'next/server'
import {
  BENCH_USER_EMAIL,
  BENCH_USER_ID,
  FIRST_YEAR,
  MAIN_COMPANY_ID,
  PROFILES,
  createDatabase,
  dropDatabase,
  seedDataset,
} from './dataset'

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>

interface Stat {
  name: string
  runs: number
  p50: number
  p95: number
  queries: number
  bytes: number
  status: number
}

const ITERATIONS = Number(process.env.KLEDG_BENCH_ITERATIONS ?? 15)
const ONLY = process.env.KLEDG_BENCH_ONLY?.split(',').map((s) => s.trim())
const VERBOSE = process.env.KLEDG_BENCH_VERBOSE === '1'
const results: Stat[] = []

// Statement counter at the node-postgres client (Prisma's adapter and Better Auth both go through it).
const counter = { queries: 0, log: [] as string[], recording: false }
const originalQuery = Client.prototype.query
Client.prototype.query = function patchedQuery(this: Client, ...args: unknown[]) {
  counter.queries++
  if (counter.recording) {
    const first = args[0] as string | { text?: string }
    counter.log.push((typeof first === 'string' ? first : first?.text ?? '').replace(/\s+/g, ' ').slice(0, 300))
  }
  return (originalQuery as (...a: unknown[]) => unknown).apply(this, args)
} as typeof Client.prototype.query

function percentile(sorted: number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

/**
 * What a browser does with the cookies of the previous response: in
 * production Better Auth's nextCookies plugin writes the refreshed session
 * cache cookie (lib/auth.ts) on the response of the request that found it
 * expired. Under Vitest the plugin cannot reach next/headers (dependencies are
 * not mocked), so the refresh is replayed here, outside the measured time.
 */
async function refreshSessionCache() {
  const { auth } = await import('@/lib/auth')
  const result = await auth.api.getSession({ headers: new Headers({ cookie: bench.cookie }), returnHeaders: true })
  const jar = new Map(bench.cookie.split('; ').filter(Boolean).map((c) => [c.slice(0, c.indexOf('=')), c.slice(c.indexOf('=') + 1)]))
  for (const cookie of result.headers.getSetCookie()) {
    const pair = cookie.split(';')[0]
    const name = pair.slice(0, pair.indexOf('='))
    const value = pair.slice(pair.indexOf('=') + 1)
    if (value) jar.set(name, value)
    else jar.delete(name)
  }
  bench.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
}

async function measure(name: string, run: () => Promise<{ status: number; bytes: number }>, iterations = ITERATIONS) {
  if (ONLY && !ONLY.includes(name)) return
  // Warmup: module loading, Prisma connection, layout upgrades on the first report.
  let last = await run()
  last = await run()
  const times: number[] = []
  const queries: number[] = []
  for (let i = 0; i < iterations; i++) {
    await refreshSessionCache()
    counter.queries = 0
    counter.recording = VERBOSE && i === 0
    counter.log = []
    const started = performance.now()
    last = await run()
    times.push(performance.now() - started)
    queries.push(counter.queries)
    if (counter.recording) {
      process.stdout.write(`\n--- ${name} (${counter.log.length} statements)\n${counter.log.map((s) => `  ${s}`).join('\n')}\n`)
    }
    counter.recording = false
  }
  times.sort((a, b) => a - b)
  queries.sort((a, b) => a - b)
  const stat: Stat = {
    name,
    runs: iterations,
    p50: Math.round(percentile(times, 50) * 10) / 10,
    p95: Math.round(percentile(times, 95) * 10) / 10,
    queries: percentile(queries, 50),
    bytes: last.bytes,
    status: last.status,
  }
  results.push(stat)
  process.stdout.write(`${name}: p50 ${stat.p50} ms, p95 ${stat.p95} ms, ${stat.queries} statements, ${stat.bytes} bytes, HTTP ${stat.status}\n`)
}

async function call(handler: Handler, url: string, init: RequestInit & { params?: Record<string, string> } = {}) {
  const { params, ...rest } = init
  const request = new NextRequest(new URL(url, 'http://localhost:3000'), {
    ...rest,
    headers: { cookie: bench.cookie, ...(rest.headers as Record<string, string> | undefined) },
  } as ConstructorParameters<typeof NextRequest>[1])
  const response = await handler(request, { params: Promise.resolve(params ?? {}) })
  const body = await response.arrayBuffer()
  // A failing path is measured and reported (status column), not aborted.
  if (!response.ok && VERBOSE) process.stdout.write(`${url}: HTTP ${response.status} ${Buffer.from(body).toString('utf8').slice(0, 300)}\n`)
  return { status: response.status, bytes: body.byteLength }
}

const company = MAIN_COMPANY_ID
let lastYear = FIRST_YEAR
let closedYear = FIRST_YEAR
let apiKey = ''

describe(`hot paths (${bench.profile})`, () => {
  beforeAll(async () => {
    const profile = PROFILES[bench.profile]
    if (!profile) throw new Error(`Unknown profile ${bench.profile}`)
    lastYear = FIRST_YEAR + profile.main.years - 1
    closedYear = lastYear - 1
    if (!bench.reuse) {
      const url = await createDatabase(bench.database)
      const summary = await seedDataset(url, profile)
      process.stdout.write(`dataset ${JSON.stringify(summary)}\n`)
    }
    // KLEDG_RLS=enforce: the application connects as a role subject to the
    // row level security policies (docs/rls.md), created here by the owner.
    const { rlsMode } = await import('@/lib/rls/mode')
    if (rlsMode() === 'enforce') {
      const { appRoleStatements } = await import('@/lib/rls/app-role')
      const owner = new Client({ connectionString: process.env.DATABASE_URL })
      await owner.connect()
      try {
        const exists = await owner.query(`SELECT 1 FROM pg_roles WHERE rolname = 'kledg_app_bench'`)
        const [create, ...grants] = appRoleStatements('kledg_app_bench', 'kledg_app_bench')
        if (exists.rowCount === 0) await owner.query(create)
        for (const statement of grants.filter((s) => !s.startsWith('ALTER ROLE'))) await owner.query(statement)
      } finally {
        await owner.end()
      }
      const app = new URL(process.env.DATABASE_URL!)
      app.username = 'kledg_app_bench'
      app.password = 'kledg_app_bench'
      process.env.DATABASE_URL = app.toString()
    }

    // A password for the bench user, then a real sign-in for the session cookie.
    const { hashPassword } = await import('better-auth/crypto')
    const { prisma } = await import('@/lib/prisma')
    const password = randomBytes(18).toString('base64url')
    await prisma.authAccount.deleteMany({ where: { userId: BENCH_USER_ID } })
    // A reused database holds JWKS encrypted with the secret of a previous run.
    await prisma.jwks.deleteMany()
    await prisma.authAccount.create({
      data: {
        id: 'bench_auth_account',
        accountId: BENCH_USER_ID,
        providerId: 'credential',
        userId: BENCH_USER_ID,
        password: await hashPassword(password),
      },
    })
    const { auth } = await import('@/lib/auth')
    const signIn = await auth.api.signInEmail({ body: { email: BENCH_USER_EMAIL, password }, returnHeaders: true })
    bench.cookie = signIn.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ')
    if (!bench.cookie) throw new Error('Sign-in returned no session cookie')

    const created = await auth.api.createApiKey({ body: { name: 'bench', userId: BENCH_USER_ID } })
    apiKey = created.key
  })

  afterAll(async () => {
    const { prisma } = await import('@/lib/prisma')
    await prisma.$disconnect()
    if (!bench.reuse) await dropDatabase(bench.database)
    const table = [
      '| Path | p50 ms | p95 ms | statements | response bytes | status |',
      '|---|---:|---:|---:|---:|---:|',
      ...results.map((r) => `| ${r.name} | ${r.p50} | ${r.p95} | ${r.queries} | ${r.bytes} | ${r.status} |`),
    ].join('\n')
    process.stdout.write(`\n${table}\n`)
    if (process.env.KLEDG_BENCH_OUT) writeFileSync(process.env.KLEDG_BENCH_OUT, JSON.stringify({ profile: bench.profile, results }, null, 2))
  })

  it('auth: session lookup', async () => {
    const { auth } = await import('@/lib/auth')
    await measure('auth.getSession', async () => {
      const session = await auth.api.getSession({ headers: new Headers({ cookie: bench.cookie }) })
      if (!session) throw new Error('No session')
      return { status: 200, bytes: 0 }
    }, 50)
  })

  it('reports', async () => {
    const fy = (year: number) => `${company}_fy${year}`
    const balanceSheet = (await import('@/app/api/companies/[id]/balance-sheet/route')).GET as Handler
    const incomeStatement = (await import('@/app/api/companies/[id]/income-statement/route')).GET as Handler
    const trialBalance = (await import('@/app/api/reports/trial-balance/route')).GET as Handler
    const grandLivre = (await import('@/app/api/reports/grand-livre/route')).GET as Handler
    const journal = (await import('@/app/api/reports/journal/route')).GET as Handler
    const fec = (await import('@/app/api/fec/route')).GET as Handler

    await measure('balance sheet (closed year)', () =>
      call(balanceSheet, `/api/companies/${company}/balance-sheet?fiscalYearId=${fy(closedYear)}`, { params: { id: company } }))
    await measure('income statement (closed year)', () =>
      call(incomeStatement, `/api/companies/${company}/income-statement?fiscalYearId=${fy(closedYear)}`, { params: { id: company } }))
    await measure('trial balance (open year)', () =>
      call(trialBalance, `/api/reports/trial-balance?companyId=${company}&fiscalYearId=${fy(lastYear)}`))
    await measure('trial balance (H2, opening from H1)', () =>
      call(trialBalance, `/api/reports/trial-balance?companyId=${company}&startDate=${closedYear}-07-01&endDate=${closedYear}-12-31`))
    await measure('grand livre (year)', () =>
      call(grandLivre, `/api/reports/grand-livre?companyId=${company}&fiscalYearId=${fy(closedYear)}`), 5)
    await measure('journal (year, all journals)', () =>
      call(journal, `/api/reports/journal?companyId=${company}&journalId=all&startDate=${closedYear}-01-01T00:00:00.000Z&endDate=${closedYear}-12-31T00:00:00.000Z`), 5)
    await measure('FEC export (closed year)', () =>
      call(fec, `/api/fec?companyId=${company}&fiscalYearId=${fy(closedYear)}`), 5)
  })

  it('lists', async () => {
    const entries = (await import('@/app/api/entries/route')).GET as Handler
    const transactions = (await import('@/app/api/transactions/route')).GET as Handler
    const reconciliation = (await import('@/app/api/banking/reconciliation/route')).GET as Handler
    const companies = (await import('@/app/api/companies/route')).GET as Handler
    const fy = `${company}_fy${lastYear}`

    await measure('entries list (year)', () => call(entries, `/api/entries?companyId=${company}&fiscalYearId=${fy}`), 5)
    await measure('transactions list (all)', () => call(transactions, `/api/transactions?companyId=${company}`), 5)
    await measure('transactions list (year, with rule suggestions)', () =>
      call(transactions, `/api/transactions?companyId=${company}&includeSuggestions=true&startDate=${lastYear}-01-01T00:00:00.000Z&endDate=${lastYear}-12-31T23:59:59.999Z`), 5)
    await measure('transactions categories', () => call(transactions, `/api/transactions?companyId=${company}&includeCategories=true`), 5)
    await measure('reconciliation page data', () => call(reconciliation, `/api/banking/reconciliation?companyId=${company}`), 5)
    // Requests the pages send since the performance pass (parameters that older code ignores)
    await measure('reconciliation page data (includeTransactions=false)', () =>
      call(reconciliation, `/api/banking/reconciliation?companyId=${company}&includeTransactions=false`), 5)
    await measure('transactions categories (categoriesOnly)', () => call(transactions, `/api/transactions?companyId=${company}&categoriesOnly=true`), 5)
    await measure('transactions list (page of 500)', () => call(transactions, `/api/transactions?companyId=${company}&limit=500`))
    await measure('entries list (page of 500)', () => call(entries, `/api/entries?companyId=${company}&fiscalYearId=${fy}&limit=500`))
    await measure('companies list (user with 21 companies)', () => call(companies, '/api/companies'))
  })

  it('rules engine and statement import', async () => {
    const execute = (await import('@/app/api/transaction-rules/execute/route')).POST as Handler
    await measure('rules engine run (dry, open year)', () =>
      call(execute, '/api/transaction-rules/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ companyId: company, autoApply: false }),
      }), 5)

    const { prisma } = await import('@/lib/prisma')
    const existing = await prisma.bankTransaction.findMany({
      where: { bankAccountId: `${company}_ba`, date: { gte: new Date(Date.UTC(lastYear, 2, 1)), lt: new Date(Date.UTC(lastYear, 3, 1)) } },
      select: { date: true, amount: true, side: true, label: true },
      orderBy: { id: 'asc' },
    })
    const fr = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`
    const amount = (value: string) => value.replace('.', ',')
    const rows = ['Date;Date de valeur;Libellé;Référence;Débit;Crédit']
    for (const [i, t] of existing.entries()) {
      rows.push(`${fr(t.date)};${fr(t.date)};${t.label};;${t.side === 'debit' ? amount(t.amount.toFixed(2)) : ''};${t.side === 'credit' ? amount(t.amount.toFixed(2)) : ''}`)
      rows.push(`${fr(t.date)};${fr(t.date)};NOUVELLE OPERATION ${i};;${amount(((i % 97) + 1).toFixed(2))};`)
    }
    const bytes = new TextEncoder().encode(rows.join('\n'))
    const { analyzeStatement } = await import('@/lib/banking/import/import-statement.service')
    await measure(`statement import preview (${rows.length - 1} lines)`, async () => {
      const result = await analyzeStatement({ companyId: company, bankAccountId: `${company}_ba`, bytes, fileName: 'releve.csv' })
      return { status: 200, bytes: JSON.stringify(result).length }
    }, 5)
  })

  it('MCP tools', async () => {
    const mcp = (await import('@/app/api/mcp/route')).POST as Handler
    let id = 0
    const tool = (name: string, args: Record<string, unknown>) => async () => {
      const request = new Request('http://localhost:3000/api/mcp', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }),
      })
      const response = await mcp(request)
      const text = await response.text()
      // Tool errors come back as HTTP 200 with isError: reported as 500.
      return { status: text.includes('"isError":true') ? 500 : response.status, bytes: text.length }
    }
    await measure('MCP list_companies', tool('list_companies', {}))
    await measure('MCP get_trial_balance (year)', tool('get_trial_balance', { companyId: company, startDate: `${closedYear}-01-01`, endDate: `${closedYear}-12-31` }))
    await measure('MCP get_balance_sheet', tool('get_balance_sheet', { companyId: company, fiscalYearId: `${company}_fy${closedYear}` }))
    await measure('MCP list_entries (50)', tool('list_entries', { companyId: company }))
    await measure('MCP list_entries (account 512, 50)', tool('list_entries', { companyId: company, accountCode: '512' }))
  })
})
