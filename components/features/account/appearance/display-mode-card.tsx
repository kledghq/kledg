'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import type { DisplayMode } from '@/lib/appearance/display-mode'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DisplayModeChoice } from '@/components/features/onboarding/display-mode-choice'
import { accountApi } from '../account-api'

const SAVED: Record<DisplayMode, string> = {
  simple: 'Mode simple activé',
  expert: 'Mode expert activé',
}

/**
 * "Mode d'affichage" on Paramètres, Apparence (docs/mode-simple.md): the
 * same choice as the switch at the bottom of the company sidebar. Saved at
 * once, like the theme.
 */
export function DisplayModeCard({ initial }: { initial: DisplayMode }) {
  const router = useRouter()
  const [mode, setMode] = useState<DisplayMode>(initial)
  const [saving, setSaving] = useState(false)

  async function choose(next: DisplayMode) {
    if (next === mode) return
    const previous = mode
    setMode(next)
    setSaving(true)
    try {
      await accountApi('/api/account/display-mode', { method: 'PUT', body: { mode: next } })
      toast.success(SAVED[next])
      router.refresh()
    } catch (error) {
      setMode(previous)
      toast.error((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mode d&apos;affichage</CardTitle>
        <CardDescription>
          Les comptes restent les mêmes&nbsp;: seul l&apos;affichage change, pour vous seulement. Ce que votre rôle permet de faire ne
          change pas.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DisplayModeChoice value={mode} onChange={(next) => void choose(next)} disabled={saving} idPrefix="settings-mode" />
      </CardContent>
    </Card>
  )
}
