'use client'

import { useEffect, useState } from 'react'
import type { LedgerAccountOption } from './types'

/** Bank ledger accounts (class 512) of the active fiscal year, for the mapping selects. */
export function useLedgerBankAccounts(companyId: string | undefined): {
  accounts: LedgerAccountOption[]
  loading: boolean
} {
  const [accounts, setAccounts] = useState<LedgerAccountOption[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    fetch(`/api/accounts?companyId=${encodeURIComponent(companyId)}`)
      .then((response) => (response.ok ? response.json() : []))
      .then((rows: Array<{ id: string; code: string; label: string }>) => {
        if (cancelled) return
        setAccounts(
          (Array.isArray(rows) ? rows : [])
            .filter((row) => row.code.startsWith('512'))
            .map((row) => ({ id: row.id, code: row.code, label: row.label })),
        )
      })
      .catch(() => {
        if (!cancelled) setAccounts([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [companyId])

  return { accounts, loading }
}
