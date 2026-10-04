import { auth } from '@/lib/auth'
import { toNextJsHandler } from 'better-auth/next-js'
import { withResolvedClientIp } from '@/lib/client-ip'

const handlers = toNextJsHandler(auth)

/**
 * Better Auth reads the client IP (rate limits, sessions) only from the
 * header set here from the trusted proxy configuration (lib/client-ip.ts):
 * a value sent by the client is replaced, never trusted.
 */
function withClientIp(handler: (request: Request) => Promise<Response>) {
  return (request: Request) => {
    // Rebuilt from its parts: the request Next passes may come from another
    // fetch implementation than the global Request (no `new Request(request)`).
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
    const init: RequestInit & { duplex?: 'half' } = {
      method: request.method,
      headers: withResolvedClientIp(request.headers),
      ...(hasBody && { body: request.body, duplex: 'half' }),
    }
    return handler(new Request(request.url, init))
  }
}

export const GET = withClientIp(handlers.GET)
export const POST = withClientIp(handlers.POST)
