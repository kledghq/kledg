import pkg from '@/package.json'
import { createMcpHandler } from 'mcp-handler'
import { withMcpUser } from '@/lib/mcp/auth'
import { registerKledgTools } from '@/lib/mcp/tools'
import { registerKledgPrompts } from '@/lib/mcp/prompts'
import { registerKledgViews } from '@/lib/mcp/views'
import { instructionsFor } from '@/lib/mcp/instructions'
import { capRequestBody } from '@/lib/api/request-guards'
import { handleError } from '@/lib/accounting/errors'

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

/**
 * Largest MCP request body: the biggest tool arguments are a file of 5 MB
 * sent in base64 (about 6.7 MB, lib/mcp/full-control/files.ts) with its
 * JSON-RPC envelope. The endpoint is not wrapped by companyRoute, so it caps
 * its own body like guardRequest does (lib/api/request-guards.ts): read
 * once, counted, 413 beyond, before authentication or parsing.
 */
const MAX_MCP_BODY_BYTES = 8 * 1024 * 1024

async function cappedHandler(request: Request): Promise<Response> {
  let capped: Request
  try {
    capped = await capRequestBody(request, MAX_MCP_BODY_BYTES)
  } catch (error) {
    const { message, statusCode } = handleError(error)
    return Response.json({ error: message }, { status: statusCode })
  }
  return handler(capped)
}

export { cappedHandler as GET, cappedHandler as POST, cappedHandler as DELETE }
