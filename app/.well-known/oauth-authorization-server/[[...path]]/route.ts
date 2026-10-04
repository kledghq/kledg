import { oauthProviderAuthServerMetadata } from '@better-auth/oauth-provider'
import { auth } from '@/lib/auth'

// RFC 8414 metadata, served at the root and with the /api/auth issuer suffix.
export const GET = oauthProviderAuthServerMetadata(auth)
