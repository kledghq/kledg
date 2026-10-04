import { prisma } from './prisma'

/**
 * Better Auth's Prisma adapter writes `null` for unset array fields (OAuth
 * scopes, redirect URIs...), but Prisma list columns are never nullable.
 * This client normalizes `null` to `[]` for list fields before writing.
 */
// Array columns of the OAuth provider models (see the end of schema.prisma).
const OAUTH_LIST_FIELDS = new Set([
  'scopes',
  'clientCredentialsScopes',
  'contacts',
  'redirectUris',
  'postLogoutRedirectUris',
  'grantTypes',
  'responseTypes',
  'allowedScopes',
  'resources',
  'requestedUserInfoClaims',
])

function normalize(model: string, data: unknown) {
  if (!model.startsWith('Oauth') || !data || typeof data !== 'object') return
  const record = data as Record<string, unknown>
  for (const field of OAUTH_LIST_FIELDS) {
    if (field in record && record[field] === null) record[field] = []
  }
}

export const authPrisma = prisma.$extends({
  query: {
    $allModels: {
      async create({ model, args, query }) {
        normalize(model, args.data)
        return query(args)
      },
      async update({ model, args, query }) {
        normalize(model, args.data)
        return query(args)
      },
      async updateMany({ model, args, query }) {
        normalize(model, args.data)
        return query(args)
      },
      async upsert({ model, args, query }) {
        normalize(model, args.create)
        normalize(model, args.update)
        return query(args)
      },
    },
  },
})
