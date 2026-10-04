'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, Info } from 'lucide-react'
import { toast } from 'sonner'

import { companyHomePath, type DisplayMode } from '@/lib/appearance/display-mode'
import { accountApi } from '@/components/features/account/account-api'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DisplayModeChoice } from './display-mode-choice'

/**
 * Last step of the company wizard for a user who never chose a display mode
 * (docs/mode-simple.md): "Comment voulez-vous utiliser Kledg ?". The company
 * exists already, so the accountant notice can link to its members page.
 * Saves the user's mode, then opens the company in that mode.
 */
export function DisplayModeStep({ companySlug }: { companySlug: string }) {
  const router = useRouter()
  const [mode, setMode] = useState<DisplayMode>('simple')
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      await accountApi('/api/account/display-mode', { method: 'PUT', body: { mode } })
      router.push(companyHomePath(companySlug, mode))
      router.refresh()
    } catch (error) {
      toast.error((error as Error).message)
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Comment voulez-vous utiliser Kledg&nbsp;?</h2>
          </CardTitle>
          <CardDescription>
            Vous pourrez changer à tout moment dans vos paramètres. Les comptes restent les mêmes&nbsp;: seul l&apos;affichage change.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <DisplayModeChoice value={mode} onChange={setMode} disabled={saving} idPrefix="onboarding-mode" />
          <Alert>
            <Info aria-hidden />
            <AlertDescription>
              <p>
                Vous avez un expert-comptable&nbsp;? Invitez-le dans les membres de la société&nbsp;: vos dépenses classées en mode
                simple lui seront soumises avant d&apos;être définitives.
              </p>
              <Link href={`/${companySlug}/members`} className="text-link underline-offset-4 hover:underline">
                Inviter votre comptable
              </Link>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <Button type="button" onClick={() => void save()} loading={saving}>
          Continuer
          <ArrowRight aria-hidden />
        </Button>
      </div>
    </div>
  )
}
