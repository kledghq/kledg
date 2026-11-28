'use client'

import { useEffect, useState } from 'react'
import type { LedgerAccountOption } from './types'

/**
 * Ledger accounts of the active fiscal year for the mapping selects: the
 * bank accounts (512), and in `stripeAccounts` those a Stripe balance may
 * also use (517, 467; lib/banking/stripe-setup.service.ts).
 */
export function useLedgerBankAccounts(companyId: string | undefined): {
  accounts: LedgerAccountOption[]
  stripeAccounts: LedgerAccountOption[]
  loading: boolean
} {
  const [accounts, setAccounts] = useState<LedgerAccountOption[]>([])
  const [stripeAccounts, setStripeAccounts] = useState<LedgerAccountOption[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    fetch(`/api/accounts?companyId=${encodeURIComponent(companyId)}`)
      .then((response) => (response.ok ? response.json() : []))
      .then((rows: Array<{ id: string; code: string; label: string }>) => {
        if (cancelled) return
        const options = (Array.isArray(rows) ? rows : []).map((row) => ({ id: row.id, code: row.code, label: row.label }))
        setAccounts(options.filter((row) => row.code.startsWith('512')))
        // Detailed accounts only: the parents 517 and 467 hold no entry
        setStripeAccounts(options.filter((row) => /^(512|517|467)/.test(row.code) && (row.code.startsWith('512') || row.code.length > 3)))
      })
      .catch(() => {
        if (!cancelled) {
          setAccounts([])
          setStripeAccounts([])
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [companyId])

  return { accounts, stripeAccounts, loading }
}
