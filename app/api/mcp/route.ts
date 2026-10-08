import pkg from '@/package.json'
import { createMcpHandler } from 'mcp-handler'
import { withMcpUser } from '@/lib/mcp/auth'
import { registerKledgTools } from '@/lib/mcp/tools'
import { registerKledgPrompts } from '@/lib/mcp/prompts'
import { registerKledgViews } from '@/lib/mcp/views'
import { instructionsFor } from '@/lib/mcp/instructions'

export const maxDuration = 60

/**
 * Identity shown by MCP clients: name, title, website and the instance's own
 * icons (MCP Implementation.icons, spec 2025-11-25), absolute on this host.
 * Claude.ai shows the favicon of the connector's host for now, served by
 * app/favicon.ico. mcp-handler types serverInfo as name and version only but
 * passes it to the SDK as is, which accepts these fields.
 */
export function serverInfoFor(request: Request) {
  const origin = new URL(request.url).origin
  return {
    name: 'kledg',
    title: 'Kledg',
    version: pkg.version,
    websiteUrl: 'https://www.kledg.com',
    icons: [
      { src: `${origin}/icon.svg`, mimeType: 'image/svg+xml', sizes: ['any'] },
      { src: `${origin}/icons/icon-192.png`, mimeType: 'image/png', sizes: ['192x192'] },
      { src: `${origin}/icons/icon-512.png`, mimeType: 'image/png', sizes: ['512x512'] },
    ],
  }
}

/**
 * MCP endpoint of this Kledg instance. Stateless: a server is built per
 * request for the authenticated user, so it scales on serverless functions.
 */
const handler = withMcpUser((request, access) => {
  const mcp = createMcpHandler(
    (server) => {
      registerKledgTools(server, access)
      registerKledgPrompts(server, access)
      registerKledgViews(server)
    },
    {
      serverInfo: serverInfoFor(request) as { name: string; version: string },
      instructions: instructionsFor(access),
    },
  )
  return Promise.resolve(mcp(request))
})

export { handler as GET, handler as POST, handler as DELETE }
