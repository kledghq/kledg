import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { UPDATE_WORKFLOW } from '../workflow-template'
import { WORKFLOW_MARKER } from '../service'

describe('bundled update workflow', () => {
  it('matches .github/workflows/update-from-kledg.yml (run node scripts/sync-update-workflow.mjs)', () => {
    const source = readFileSync(path.resolve(__dirname, '../../../.github/workflows/update-from-kledg.yml'), 'utf8')
    expect(UPDATE_WORKFLOW).toBe(source)
  })

  it('[KLEDG-R3-INPUT-06] carries the current version marker, so older installed files are upgraded', () => {
    expect(UPDATE_WORKFLOW).toContain(WORKFLOW_MARKER)
  })

  it('[KLEDG-R3-INPUT-06] never expands an expression inside a run script', () => {
    const lines = UPDATE_WORKFLOW.split('\n')
    let runIndent = -1
    for (const line of lines) {
      const indent = line.length - line.trimStart().length
      if (runIndent >= 0 && line.trim() && indent <= runIndent) runIndent = -1
      if (runIndent >= 0) expect(line, line).not.toContain('${{')
      if (/^\s+run: [|>]/.test(line)) runIndent = indent
      else if (/^\s+run: /.test(line)) expect(line, line).not.toContain('${{')
    }
    // Third party actions pinned to a commit
    for (const use of UPDATE_WORKFLOW.match(/uses: \S+/g) ?? []) expect(use).toMatch(/@[0-9a-f]{40}$/)
  })

  it('handles copies with unrelated history', () => {
    expect(UPDATE_WORKFLOW).toContain('# BEGIN kledg-merge')
    expect(UPDATE_WORKFLOW).toContain('--allow-unrelated-histories')
  })
})
