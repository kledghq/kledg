/**
 * Architecture guards that ESLint cannot express (docs/conventions.md).
 *
 * Client modules ('use client' files and everything they import) end up in
 * the browser bundle: they must never reach the database, the server auth,
 * mail or Node APIs, even through a chain of imports. Type-only imports are
 * erased at build time and are fine.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '../..')
const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join('/')

/** Modules that only run on the server, by path (relative to the root) or package name. */
const SERVER_ONLY_FILES = new Set([
  'lib/prisma.ts',
  'lib/auth.ts',
  'lib/auth-prisma.ts',
  'lib/session.ts',
  'lib/email/index.ts',
  'lib/audit/audit.ts',
])
const SERVER_ONLY_PACKAGES = new Set([
  '@prisma/client',
  '@prisma/adapter-pg',
  'pg',
  'resend',
  'next/headers',
  'fs',
  'node:fs',
  'child_process',
  'node:child_process',
])

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__' || name.startsWith('.')) continue
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(full)
  }
  return out
}

const FILES = ['app', 'components', 'hooks', 'lib'].flatMap((dir) => sourceFiles(path.join(ROOT, dir)))
const sources = new Map(FILES.map((file) => [file, readFileSync(file, 'utf8')]))

function directive(source: string, name: 'use client' | 'use server'): boolean {
  // The directive is the first statement: only comments may precede it.
  const head = source.replace(/^(\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/, '')
  return head.startsWith(`'${name}'`) || head.startsWith(`"${name}"`)
}

/** Specifiers of the runtime (non type-only) static imports and re-exports of a module. */
function runtimeImports(source: string): string[] {
  const specifiers: string[] = []
  const statement = /(^|\n)\s*(import|export)\s+(type\s+)?([^'";]*?)\s*from\s*['"]([^'"]+)['"]|(^|\n)\s*import\s*['"]([^'"]+)['"]/g
  for (const match of source.matchAll(statement)) {
    if (match[7]) {
      specifiers.push(match[7])
      continue
    }
    if (match[3]) continue // import type / export type
    const clause = match[4].trim()
    // `import { type A, type B } from`: erased like `import type`
    const named = /^\{([\s\S]*)\}$/.exec(clause)
    if (named && named[1].split(',').every((part) => !part.trim() || /^type\s/.test(part.trim()))) continue
    specifiers.push(match[5])
  }
  return specifiers
}

function resolve(from: string, specifier: string): string | null {
  let base: string
  if (specifier.startsWith('@/')) base = path.join(ROOT, specifier.slice(2))
  else if (specifier.startsWith('.')) base = path.resolve(path.dirname(from), specifier)
  else return null
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

/** First chain of imports from `start` to a server-only module, or null. */
function serverChain(start: string): string[] | null {
  const seen = new Set<string>()
  const visit = (file: string, chain: string[]): string[] | null => {
    if (seen.has(file)) return null
    seen.add(file)
    const source = sources.get(file) ?? readFileSync(file, 'utf8')
    for (const specifier of runtimeImports(source)) {
      if (SERVER_ONLY_PACKAGES.has(specifier)) return [...chain, specifier]
      const target = resolve(file, specifier)
      if (!target) continue
      if (SERVER_ONLY_FILES.has(rel(target))) return [...chain, rel(target)]
      // Server actions are called over the network from client code.
      if (directive(sources.get(target) ?? readFileSync(target, 'utf8'), 'use server')) continue
      const found = visit(target, [...chain, rel(target)])
      if (found) return found
    }
    return null
  }
  return visit(start, [rel(start)])
}

const clientFiles = FILES.filter((file) => directive(sources.get(file)!, 'use client'))

describe('client and server boundary', () => {
  it('finds the client components', () => {
    expect(clientFiles.length).toBeGreaterThan(50)
  })

  it('never imports a server-only module into client code, even indirectly', () => {
    const offenders = clientFiles
      .map((file) => serverChain(file))
      .filter((chain): chain is string[] => chain !== null)
      .map((chain) => chain.join(' -> '))
    expect(offenders).toEqual([])
  })
})

describe('import scanner', () => {
  it('ignores type-only imports and keeps runtime ones', () => {
    const source = [
      "import type { A } from '@/lib/prisma'",
      "import { type B, type C } from '@/lib/session'",
      "export type { D } from '@/lib/auth'",
      "import { E, type F } from '@/lib/a'",
      "import G from '@/lib/b'",
      "export { H } from '@/lib/c'",
      "import '@/lib/d'",
    ].join('\n')
    expect(runtimeImports(source)).toEqual(['@/lib/a', '@/lib/b', '@/lib/c', '@/lib/d'])
  })
})
