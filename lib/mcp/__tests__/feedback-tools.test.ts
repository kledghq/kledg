/**
 * MCP tool prepare_feedback: returns the link to the prefilled GitHub issue
 * form with the instance's context, for any signed-in user at any access
 * level, without reading company data (no guard call).
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

const guard = vi.hoisted(() => ({
  require: vi.fn(async () => {}),
  requireFullControl: vi.fn(async () => {}),
  companyWhere: vi.fn(async () => ({})),
}))

vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: vi.fn() }))
vi.mock('@/lib/mcp/company-access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mcp/company-access')>()),
  companyGuard: () => guard,
}))

import { registerKledgTools } from '@/lib/mcp/tools'
import type { ToolResult } from '@/lib/mcp/tool-result'

type Handler = (args: Record<string, unknown>) => Promise<ToolResult>

function prepareFeedback(): Handler {
  const handlers = new Map<string, Handler>()
  registerKledgTools(
    { registerTool: (name: string, _config: unknown, handler: Handler) => handlers.set(name, handler) } as never,
    { user: { id: 'u1', email: 'a@b.c', name: 'Camille', role: 'user' }, canWrite: false, canAdmin: false, caller: { kind: 'apiKey', apiKeyId: 'k1' }, executionMode: 'validation' },
  )
  return handlers.get('prepare_feedback')!
}

const parse = (result: ToolResult) => JSON.parse(result.content[0].text)

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('prepare_feedback', () => {
  it('returns the prefilled issue form, the search and the context, without reading company data', async () => {
    vi.stubEnv('KLEDG_FEEDBACK_REPO', 'acme/kledg-instance')
    const result = parse(await prepareFeedback()({ kind: 'bug', title: 'Export FEC vide', description: 'Le fichier est vide.', details: '1. Exporter' }))
    expect(result.repository).toBe('acme/kledg-instance')
    const issue = new URL(result.issueUrl)
    expect(issue.origin + issue.pathname).toBe('https://github.com/acme/kledg-instance/issues/new')
    expect(issue.searchParams.get('template')).toBe('bug_report.yml')
    expect(issue.searchParams.get('steps')).toBe('1. Exporter')
    expect(result.searchUrl).toContain('https://github.com/acme/kledg-instance/issues?q=')
    expect(result.context[0]).toMatch(/^Version\u00a0: /)
    expect(guard.require).not.toHaveBeenCalled()
  })

  it('prepares an idea', async () => {
    const result = parse(await prepareFeedback()({ kind: 'idea', title: 'Export Excel', description: 'Besoin' }))
    expect(new URL(result.issueUrl).searchParams.get('template')).toBe('feature_request.yml')
  })
})
