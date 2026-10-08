#!/usr/bin/env tsx
/**
 * No-break space before ":", ";", "?" and "!" in the French text of the
 * given source files (lib/__tests__/helpers/french-spacing.ts, enforced by
 * lib/__tests__/design-system-guards.test.ts). Prints each change; writes
 * only with --write. Review the diff: test files whose strings are inputs
 * (a document to parse, a library message) must keep their plain spaces,
 * and DOM tests keep them too (Testing Library reads a no-break space as a
 * space).
 *
 * Usage: npx tsx scripts/french-spacing.ts [--write] <file>...
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { applySpacingEdits, frenchSpacingEdits } from '../lib/__tests__/helpers/french-spacing'

const write = process.argv.includes('--write')
const files = process.argv.slice(2).filter((arg) => arg !== '--write')
let total = 0
for (const file of files) {
  const source = readFileSync(file, 'utf8')
  // The file's own style: the   escape when it already writes no-break spaces that way only
  const literal = !(source.includes('\\u00a0') && !source.includes(' '))
  const edits = frenchSpacingEdits(source, file, { literal })
  for (const edit of edits) console.log(`${file}:${edit.line}: ${JSON.stringify(edit.excerpt)}`)
  total += edits.length
  if (write && edits.length > 0) writeFileSync(file, applySpacingEdits(source, edits))
}
console.log(`${total} change${total === 1 ? '' : 's'}${write ? ' written' : ''}`)
