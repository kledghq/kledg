/**
 * KLEDG-R3-MCP-01: every high-impact full control tool names the rows its
 * approval covers (`targetState`), so its execution checks them again inside
 * the transaction that writes, under a lock (lib/approved-state). A new
 * high-impact tool without targets fails here. create_company, the only
 * instance tool, locks its user inside the creation transaction.
 */

import { readFileSync, readdirSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const DIR = path.join(process.cwd(), 'lib/mcp/full-control')

function confirmedTools(): Array<{ file: string; name: string; body: string }> {
  const tools: Array<{ file: string; name: string; body: string }> = []
  for (const file of readdirSync(DIR).filter((f) => f.endsWith('.ts'))) {
    const source = readFileSync(path.join(DIR, file), 'utf8')
    const starts = [...source.matchAll(/fullControlTool\(\{/g)].map((m) => m.index ?? 0)
    starts.forEach((start, i) => {
      const body = source.slice(start, starts[i + 1] ?? source.length)
      const name = /name: '([a-z_]+)'/.exec(body)?.[1]
      if (name && /confirmation: true/.test(body)) tools.push({ file, name, body })
    })
  }
  return tools
}

describe('targets of the approved actions', () => {
  it('every high-impact tool declares the rows its approval covers', () => {
    const tools = confirmedTools()
    expect(tools.length).toBeGreaterThan(40)
    const missing = tools.filter((t) => !/targetState:/.test(t.body)).map((t) => `${t.file}: ${t.name}`)
    expect(missing).toEqual([])
  })

  it('create_company locks its user inside the creation transaction', () => {
    const define = readFileSync(path.join(DIR, 'define.ts'), 'utf8')
    expect(define).toMatch(/targetState: \(\) => \[\{ kind: 'lock', table: 'user', companyId: null, id: access\.user\.id \}\],\s+atomic: false/)
    const creation = readFileSync(path.join(process.cwd(), 'lib/companies/create-company.service.ts'), 'utf8')
    expect(creation).toMatch(/prisma\.\$transaction\(async \(tx\) => \{\s+\/\/[^\n]*\n\s+await checkApprovedTargets\(tx\)/)
  })
})
