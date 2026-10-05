/**
 * Identity of the MCP server (app/api/mcp/route.ts): what clients show for
 * the Kledg connector, with the icons of the instance at absolute URLs.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/mcp/auth', () => ({ withMcpUser: (handler: unknown) => handler }))
vi.mock('@/lib/mcp/tools', () => ({ registerKledgTools: vi.fn() }))
vi.mock('@/lib/mcp/prompts', () => ({ registerKledgPrompts: vi.fn() }))
vi.mock('@/lib/mcp/views', () => ({ registerKledgViews: vi.fn() }))

import pkg from '@/package.json'
import { serverInfoFor } from '../route'

describe('MCP server identity', () => {
  it('names Kledg, its version and website, with the icons of this host', () => {
    const info = serverInfoFor(new Request('https://compta.example.fr/api/mcp'))
    expect(info).toMatchObject({ name: 'kledg', title: 'Kledg', version: pkg.version, websiteUrl: 'https://www.kledg.com' })
    expect(info.icons.map((i) => i.src)).toEqual([
      'https://compta.example.fr/icon.svg',
      'https://compta.example.fr/icons/icon-192.png',
      'https://compta.example.fr/icons/icon-512.png',
    ])
  })
})
