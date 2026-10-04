import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { UPDATE_WORKFLOW } from '../workflow-template'

describe('bundled update workflow', () => {
  it('matches .github/workflows/update-from-kledg.yml (run node scripts/sync-update-workflow.mjs)', () => {
    const source = readFileSync(path.resolve(__dirname, '../../../.github/workflows/update-from-kledg.yml'), 'utf8')
    expect(UPDATE_WORKFLOW).toBe(source)
  })

  it('handles copies with unrelated history', () => {
    expect(UPDATE_WORKFLOW).toContain('# BEGIN kledg-merge')
    expect(UPDATE_WORKFLOW).toContain('--allow-unrelated-histories')
  })
})
