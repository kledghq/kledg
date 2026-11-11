#!/usr/bin/env node
/**
 * CI test groups: the test files split by kind, one CI job each
 * (.github/workflows/ci.yml). The first group whose rule matches a file gets
 * it, and the last one takes every file left, so no test is ever skipped.
 *
 *   node scripts/test-groups.mjs list            files per group
 *   node scripts/test-groups.mjs check           every file in exactly one group, no group empty
 *   node scripts/test-groups.mjs run <group>     vitest run on the files of <group>
 *
 * Group ids stay short: the CI database prefix is kledg_ci_<id>, and the test
 * database names must fit in PostgreSQL's 63 characters.
 *
 * The file list comes from Vitest itself (vitest list --filesOnly), so it
 * follows the include and exclude rules of vitest.config.ts.
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const DATABASE = /\.db\.test\.ts$/

/** In order: a file goes to the first group that matches it. */
export const GROUPS = [
  { id: 'sec', label: 'security & authorization', match: (f) => f.startsWith('lib/__tests__/security/') || f.startsWith('lib/api/__tests__/authorization-matrix') },
  { id: 'routes', label: 'API routes', match: (f) => f.startsWith('app/') },
  { id: 'mcp', label: 'assistants (MCP)', match: (f) => /^lib\/(mcp|ai-access)\//.test(f) },
  { id: 'books', label: 'bookkeeping & banking (database)', match: (f) => /^lib\/(accounting|banking|simple|invoices|reports)\//.test(f) && DATABASE.test(f) },
  { id: 'mods', label: 'other modules (database)', match: (f) => DATABASE.test(f) },
  { id: 'unit', label: 'unit & UI', match: () => true },
]

function vitestFiles() {
  const dir = mkdtempSync(path.join(tmpdir(), 'kledg-test-groups-'))
  try {
    const out = path.join(dir, 'files.json')
    const result = spawnSync('pnpm', ['exec', 'vitest', 'list', '--filesOnly', `--json=${out}`], { stdio: ['ignore', 'ignore', 'inherit'] })
    if (result.status !== 0) throw new Error('vitest list failed')
    const files = JSON.parse(readFileSync(out, 'utf8')).map((entry) => path.relative(process.cwd(), typeof entry === 'string' ? entry : entry.file).split(path.sep).join('/'))
    return [...new Set(files)].sort()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export function groupFiles(files) {
  const byGroup = new Map(GROUPS.map((g) => [g.id, []]))
  for (const file of files) byGroup.get(GROUPS.find((g) => g.match(file)).id).push(file)
  return byGroup
}

function main([command, groupId]) {
  const files = vitestFiles()
  const byGroup = groupFiles(files)
  if (command === 'list' || command === 'check') {
    for (const g of GROUPS) console.log(`${g.id} (${g.label}): ${byGroup.get(g.id).length} files`)
    if (command === 'list') for (const g of GROUPS) for (const f of byGroup.get(g.id)) console.log(`${g.id}\t${f}`)
    const assigned = [...byGroup.values()].flat()
    const empty = GROUPS.filter((g) => byGroup.get(g.id).length === 0).map((g) => g.id)
    if (assigned.length !== files.length || new Set(assigned).size !== files.length) throw new Error('A test file is in no group or in two groups')
    if (empty.length) throw new Error(`Empty test groups: ${empty.join(', ')} (update scripts/test-groups.mjs)`)
    console.log(`${files.length} test files, each in one group`)
    return 0
  }
  if (command === 'run') {
    const group = GROUPS.find((g) => g.id === groupId)
    if (!group) throw new Error(`Unknown group "${groupId}": ${GROUPS.map((g) => g.id).join(', ')}`)
    const list = byGroup.get(group.id)
    console.log(`${group.label}: ${list.length} test files`)
    return spawnSync('pnpm', ['exec', 'vitest', 'run', ...list], { stdio: 'inherit' }).status ?? 1
  }
  throw new Error('Usage: node scripts/test-groups.mjs list | check | run <group>')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = main(process.argv.slice(2))
