/**
 * Keeps the known violations of the convention rules honest
 * (eslint/conventions.mjs, docs/conventions.md#known-violations): every
 * listed file must exist and still break its rule. A file that was fixed
 * must leave the list, so the rule becomes an error there again.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'
import { KNOWN_VIOLATIONS } from '../../eslint/conventions.mjs'

const ROOT = path.resolve(__dirname, '../..')
/** Minimatch escapes ("app/\\(company\\)/...") back to a path. */
const unescape = (pattern: string) => pattern.replace(/\\(.)/g, '$1')

const entries = Object.entries(KNOWN_VIOLATIONS as Record<string, string[]>).flatMap(([rule, files]) =>
  files.map((file) => ({ rule, file: unescape(file) })),
)

describe('known convention violations', () => {
  it('lists existing files only', () => {
    expect(entries.filter(({ file }) => !existsSync(path.join(ROOT, file))).map(({ file }) => file)).toEqual([])
  })

  it('lists files that still break their rule', { timeout: 60_000 }, async () => {
    const eslint = new ESLint({ cwd: ROOT })
    const files = [...new Set(entries.map(({ file }) => file))]
    const results = await eslint.lintFiles(files)
    const broken = new Set(
      results.flatMap((result) =>
        result.messages.map((message) => `${message.ruleId} ${path.relative(ROOT, result.filePath).split(path.sep).join('/')}`),
      ),
    )
    const clean = entries.filter(({ rule, file }) => !broken.has(`${rule} ${file}`)).map(({ rule, file }) => `${rule}: ${file}`)
    expect(clean, 'Fixed: remove these files from KNOWN_VIOLATIONS in eslint/conventions.mjs').toEqual([])
  })
})
