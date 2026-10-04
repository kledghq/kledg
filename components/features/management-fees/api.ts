import { responseError } from '@/hooks/use-cursor-list'
import type { Convention, SubsidiaryView } from '@/lib/management-fees/manage-conventions.service'

/** A convention as the API returns it, with the names of the subsidiaries the user may read. */
export type ConventionView = Omit<Convention, 'subsidiaries'> & {
  subsidiaries: Array<Convention['subsidiaries'][number] & SubsidiaryView>
}

export interface SubsidiaryCandidate {
  id: string
  name: string
  siren: string
  sharePercentage: string
}

/** JSON of a successful response, or an Error with the French message of the API. */
export async function request<T>(url: string, init: { method?: string; body?: unknown } = {}, fallback = 'La demande n’a pas abouti. Réessayez.'): Promise<T> {
  const response = await fetch(url, {
    method: init.method ?? 'GET',
    headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(await responseError(response, fallback))
  return (response.status === 204 ? null : await response.json()) as T
}
