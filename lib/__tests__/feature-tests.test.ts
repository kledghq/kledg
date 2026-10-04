/**
 * Every feature has a test (docs/conventions.md#testing).
 *
 * A cheap static check over the source tree, so that a new API route,
 * service or MCP tool cannot land without a test that exercises it:
 *
 * - every route file (`app/**\/route.ts`) is imported by a test file other
 *   than the generic guards below (the authorization matrix and the route
 *   coverage guard call every route for its status code only, which says
 *   nothing about what the route does);
 * - every service (`lib/**\/*.service.ts(x)`) is imported by a test file, or
 *   by a route file that such a test imports and does not mock it: routes
 *   are thin (parse, authorize, call one service), so a test of the route
 *   is a test of its service;
 * - every MCP tool (`server.registerTool('name'` in lib/mcp, or
 *   `fullControlTool({ name: 'name'`) is named by a test file.
 *
 * A module only mocked by a test (`vi.mock('@/lib/x')`) does not count.
 * "Imported" means a static import, a side-effect import or a dynamic
 * `import('...')` resolved to the file, through the `@/` alias or a relative
 * path. It does not prove the test asserts the behaviour (review does); it
 * proves nobody forgot.
 *
 * ALLOWLIST: files that legitimately have no test of their own, each with
 * the reason. Keep it minimal; an entry that is tested or no longer exists
 * makes this test fail, so the list never goes stale.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '../..')
const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join('/')

/** Files with no test of their own, relative to the repo root, with the reason. */
const ALLOWLIST: Record<string, string> = {}

/** Test files that call every route generically: they do not count as a test of a route. */
const GENERIC_GUARDS = new Set([
  'lib/api/__tests__/authorization-matrix.test.ts',
  'lib/__tests__/security/route-coverage.test.ts',
  'lib/api/__tests__/routes.test.ts',
])

const SKIPPED_DIRS = new Set(['node_modules', '.next', '.git', 'coverage', '.claude'])

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIPPED_DIRS.has(name)) return []
    const full = path.join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

const FILES = ['app', 'components', 'hooks', 'lib', 'scripts'].flatMap((dir) => walk(path.join(ROOT, dir)))
const TESTS = FILES.filter((file) => /\.test\.tsx?$/.test(file))
const SOURCES = FILES.filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file) && !file.includes(`${path.sep}__tests__${path.sep}`))

const ROUTES = SOURCES.map(rel).filter((file) => /^app\/.*\/route\.ts$/.test(file))
const SERVICES = SOURCES.map(rel).filter((file) => /^lib\/.*\.service\.tsx?$/.test(file))

/** Resolves an import specifier to a repo file (relative path), or null for packages. */
function resolveSpecifier(specifier: string, from: string): string | null {
  let base: string
  if (specifier.startsWith('@/')) base = path.join(ROOT, specifier.slice(2))
  else if (specifier.startsWith('.')) base = path.resolve(path.dirname(from), specifier)
  else return null
  const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]
  const found = candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile())
  return found ? rel(found) : null
}

/** Strips comments so a specifier quoted in a comment is not taken for an import. */
const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** Runtime imports of a module (type-only imports are erased and prove nothing). */
function importsOf(file: string): string[] {
  const source = withoutComments(readFileSync(path.join(ROOT, file), 'utf8'))
  const specifiers = [
    ...[...source.matchAll(/^\s*(import|export)\s+(?!type\s)[^'"]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[2]),
    ...[...source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]),
    ...[...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]),
  ]
  return specifiers.map((specifier) => resolveSpecifier(specifier, path.join(ROOT, file))).filter((f): f is string => f !== null)
}

function mockedBy(file: string): Set<string> {
  const source = withoutComments(readFileSync(path.join(ROOT, file), 'utf8'))
  const specifiers = [...source.matchAll(/\bvi\.(?:do)?mock\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1])
  return new Set(specifiers.map((specifier) => resolveSpecifier(specifier, path.join(ROOT, file))).filter((f): f is string => f !== null))
}

interface TestFile {
  file: string
  imports: Set<string>
  mocked: Set<string>
  source: string
}

const tests: TestFile[] = TESTS.map(rel).map((file) => {
  const mocked = mockedBy(file)
  return {
    file,
    mocked,
    imports: new Set(importsOf(file).filter((imported) => !mocked.has(imported))),
    source: readFileSync(path.join(ROOT, file), 'utf8'),
  }
})
const behaviourTests = tests.filter((test) => !GENERIC_GUARDS.has(test.file))

const testedRoutes = new Set(behaviourTests.flatMap((test) => [...test.imports].filter((file) => ROUTES.includes(file))))

const testedServices = new Set<string>()
for (const test of behaviourTests) {
  for (const imported of test.imports) {
    if (SERVICES.includes(imported)) testedServices.add(imported)
    if (!ROUTES.includes(imported)) continue
    // One hop: the services the tested route calls, unless this test mocks them.
    for (const service of importsOf(imported)) {
      if (SERVICES.includes(service) && !test.mocked.has(service)) testedServices.add(service)
    }
  }
}

/** MCP tools: `server.registerTool('name'` and `fullControlTool({ name: 'name'`. */
function mcpTools(): Array<{ name: string; file: string }> {
  const tools: Array<{ name: string; file: string }> = []
  for (const file of SOURCES.map(rel).filter((f) => f.startsWith('lib/mcp/'))) {
    const source = withoutComments(readFileSync(path.join(ROOT, file), 'utf8'))
    for (const m of source.matchAll(/\bregisterTool\(\s*['"]([a-z0-9_]+)['"]/g)) tools.push({ name: m[1], file })
    for (const m of source.matchAll(/\bfullControlTool\(\{\s*name:\s*['"]([a-z0-9_]+)['"]/g)) tools.push({ name: m[1], file })
  }
  return tools
}
const TOOLS = mcpTools()

/** Whether a test file quotes the tool name (as a string literal, not as part of a longer word). */
const namesTool = (name: string) => behaviourTests.some((test) => new RegExp(`['"\`]${name}['"\`]`).test(test.source))

describe('every feature has a test', () => {
  it('finds the routes, services, MCP tools and tests it checks', () => {
    expect(ROUTES.length).toBeGreaterThan(100)
    expect(SERVICES.length).toBeGreaterThan(80)
    expect(TESTS.length).toBeGreaterThan(200)
    expect(TOOLS.length).toBeGreaterThan(25)
  })

  it('reads every full control tool definition', () => {
    // A tool defined another way would escape the name check below.
    const definitions = SOURCES.map(rel)
      .filter((file) => file.startsWith('lib/mcp/'))
      .reduce((count, file) => count + (readFileSync(path.join(ROOT, file), 'utf8').match(/\bfullControlTool\(\{/g)?.length ?? 0), 0)
    expect(TOOLS.filter((tool) => tool.file.startsWith('lib/mcp/full-control/')).length).toBe(definitions)
  })

  it('imports every API route file in a test', () => {
    const untested = ROUTES.filter((file) => !testedRoutes.has(file) && !(file in ALLOWLIST))
    expect(untested, 'Add a test that imports these routes and asserts what they do (docs/conventions.md#testing)').toEqual([])
  })

  it('imports every service in a test, directly or through the route that calls it', () => {
    const untested = SERVICES.filter((file) => !testedServices.has(file) && !(file in ALLOWLIST))
    expect(untested, 'Add a test that imports these services (or their route) and asserts what they do').toEqual([])
  })

  it('names every MCP tool in a test', () => {
    const untested = TOOLS.filter((tool) => !namesTool(tool.name) && !(tool.name in ALLOWLIST)).map((tool) => `${tool.name} (${tool.file})`)
    expect(untested, 'Add a test that calls these MCP tools').toEqual([])
  })

  it('keeps the allowlist minimal: existing, untested entries with a reason', () => {
    const toolNames = new Set(TOOLS.map((tool) => tool.name))
    const stale = Object.keys(ALLOWLIST).filter((entry) => {
      if (toolNames.has(entry)) return namesTool(entry)
      if (!existsSync(path.join(ROOT, entry))) return true
      return testedRoutes.has(entry) || testedServices.has(entry)
    })
    expect(stale, 'Remove these entries from ALLOWLIST: they are tested or gone').toEqual([])
    expect(Object.entries(ALLOWLIST).filter(([, reason]) => reason.trim().length < 20).map(([entry]) => entry)).toEqual([])
  })
})
