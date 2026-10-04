'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { OnboardingStep } from '@/lib/onboarding/checklist'

/** GET /api/companies/[id]/onboarding (lib/onboarding/load-onboarding.service.ts). */
export interface CompanyOnboardingView {
  enabled: boolean
  dismissed: boolean
  canManage: boolean
  steps: OnboardingStep[]
  done: number
  total: number
  complete: boolean
  counts: { entries: number; bankTransactions: number }
}

/**
 * The "Démarrer" checklist of a company, as the dashboard and the empty
 * states read it. `data` stays null while loading or when it failed: the
 * pages then show their plain empty state, never an error for a hint.
 */
export function useCompanyOnboarding(companyId: string | undefined) {
  const [data, setData] = useState<CompanyOnboardingView | null>(null)
  const [loading, setLoading] = useState(true)
  // Only the latest request may set the state: a slow read started before a
  // change (hide, show again) must not bring the old state back.
  const latest = useRef(0)

  const load = useCallback(async () => {
    if (!companyId) return
    const request = ++latest.current
    try {
      const response = await fetch(`/api/companies/${companyId}/onboarding`)
      const next = response.ok ? ((await response.json()) as CompanyOnboardingView) : null
      if (request === latest.current) setData(next)
    } catch {
      if (request === latest.current) setData(null)
    } finally {
      if (request === latest.current) setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    void load()
  }, [load])

  /** Hides ("dismiss") or shows again ("reopen") the checklist for the company. */
  const setDismissed = useCallback(
    async (dismissed: boolean): Promise<boolean> => {
      if (!companyId) return false
      latest.current++ // reads in flight are now stale
      setData((current) => (current ? { ...current, dismissed } : current))
      const response = await fetch(`/api/companies/${companyId}/onboarding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: dismissed ? 'dismiss' : 'reopen' }),
      }).catch(() => null)
      if (!response?.ok) {
        void load()
        return false
      }
      return true
    },
    [companyId, load],
  )

  /** The first step left to do, if the checklist applies. */
  const nextStep = data?.enabled ? (data.steps.find((s) => !s.done && s.action) ?? null) : null

  return { data, loading, reload: load, setDismissed, nextStep }
}
