import { createAuthClient } from 'better-auth/react'
import { organizationClient, adminClient } from 'better-auth/client/plugins'
import { apiKeyClient } from '@better-auth/api-key/client'
import { oauthProviderClient } from '@better-auth/oauth-provider/client'
import { ac, roles } from './permissions'

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_BETTER_AUTH_URL || undefined,
  plugins: [
    apiKeyClient(),
    oauthProviderClient(),
    organizationClient({ ac, roles }),
    adminClient(),
  ],
})

export const { signIn, signUp, signOut, useSession, getSession } = authClient
