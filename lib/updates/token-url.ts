/**
 * GitHub's prefilled fine-grained token creation link (documented in
 * "Managing your personal access tokens", section on pre-filling token
 * details with URL parameters): name, description, expiry, resource owner
 * and permissions. The repository itself cannot be preselected: the user
 * picks it under "Repository access".
 */

export const TOKEN_PERMISSIONS = {
  contents: 'write',
  pull_requests: 'write',
  actions: 'write',
  variables: 'write',
  workflows: 'write',
  deployments: 'read',
  metadata: 'read',
} as const

export const TOKEN_EXPIRY_DAYS = 90

export function tokenCreationUrl(owner?: string | null): string {
  const params = new URLSearchParams({
    name: 'Kledg updates',
    description: "Mises à jour de mon instance Kledg (page Mises à jour). Limité au dépôt de l'instance.",
    expires_in: String(TOKEN_EXPIRY_DAYS),
  })
  if (owner && /^[A-Za-z0-9-]{1,39}$/.test(owner)) params.set('target_name', owner)
  for (const [permission, level] of Object.entries(TOKEN_PERMISSIONS)) params.set(permission, level)
  return `https://github.com/settings/personal-access-tokens/new?${params.toString()}`
}
