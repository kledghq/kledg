'use client'

import { useCallback, useMemo, useState } from 'react'

import { useSession } from '@/lib/auth-client'

/**
 * "Masquer les lignes à zéro" of the bilan and the compte de résultat: on by
 * default (most lines of the official layout are 0,00 € for a small
 * company), remembered per user in this browser. Storage can be missing or
 * blocked (private windows): the choice then lasts for the page only.
 */
const keyFor = (userId: string) => `kledg:${userId}:reports:hide-zero-lines`

function readPreference(key: string | null): boolean | null {
  if (!key || typeof window === 'undefined') return null
  try {
    const stored = window.localStorage.getItem(key)
    return stored === null ? null : stored === 'true'
  } catch {
    return null
  }
}

export function useHideZeroLines(): [boolean, (value: boolean) => void] {
  const { data } = useSession()
  const userId = data?.user?.id
  const key = userId ? keyFor(userId) : null
  const stored = useMemo(() => readPreference(key), [key])
  // A choice made on this page, for the user it was made for.
  const [choice, setChoice] = useState<{ key: string | null; value: boolean } | null>(null)

  const hideZeroLines = choice && choice.key === key ? choice.value : (stored ?? true)

  const update = useCallback(
    (value: boolean) => {
      setChoice({ key, value })
      if (!key) return
      try {
        window.localStorage.setItem(key, String(value))
      } catch {
        // Storage unavailable: the choice lasts for this page only.
      }
    },
    [key],
  )

  return [hideZeroLines, update]
}
