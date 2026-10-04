import { auth } from '@/lib/auth'

// RFC 9728 protected resource metadata for /api/mcp. The mcp plugin answers
// requests on /.well-known/oauth-protected-resource[/api/mcp] directly.
export function GET(request: Request) {
  return auth.handler(request)
}
