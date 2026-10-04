/** JSON call to the updates API; throws an Error with the French message returned by the route. */
export async function updatesApi<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const response = await fetch(url, {
    method: init?.method ?? 'GET',
    headers: init?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  })
  let data: unknown = null
  try {
    data = await response.json()
  } catch {
    data = null
  }
  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : 'La requête a échoué. Réessayez.'
    throw new Error(message)
  }
  return data as T
}

export const formatDate = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : null

export const formatDateTime = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null

export const NEON_BRANCHING_URL = 'https://neon.com/docs/introduction/branching'
export const SELF_HOSTING_DOCS_URL = 'https://github.com/kledghq/kledg/blob/main/docs/self-hosting.md#mettre-à-jour'
