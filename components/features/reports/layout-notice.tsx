'use client'

/**
 * Notice about the stored layout of a statement (lib/reports/statements/
 * layout-upgrade.ts): an untouched previous default was just upgraded, or a
 * customized layout can be reset to the current default in one click.
 */

import { useState } from 'react'
import { toast } from 'sonner'
import { Info, Loader2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

interface Props {
  companyId: string
  kind: 'balance-sheet' | 'income-statement'
  variant: 'complete' | 'simplified'
  status: 'default' | 'upgraded' | 'customized' | undefined
  /** Mapping problems in the current layout: the reset is then recommended. */
  hasWarnings: boolean
  onReset: () => void
}

export function LayoutNotice({ companyId, kind, variant, status, hasWarnings, onReset }: Props) {
  const [resetting, setResetting] = useState(false)
  if (status !== 'upgraded' && status !== 'customized') return null
  const name = kind === 'balance-sheet' ? 'du bilan' : 'du compte de résultat'

  if (status === 'upgraded') {
    return (
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Mise en page {name} mise à jour</AlertTitle>
        <AlertDescription>
          La mise en page par défaut a été corrigée&nbsp;: chaque compte du plan comptable est rattaché à une seule ligne.
          Votre mise en page, inchangée depuis sa création, a été remplacée par la nouvelle version.
        </AlertDescription>
      </Alert>
    )
  }

  const reset = async () => {
    setResetting(true)
    try {
      const response = await fetch(`/api/companies/${companyId}/${kind}/config/default`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variant }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        toast.error(data.error || 'Impossible de rétablir la mise en page par défaut')
        return
      }
      toast.success('Mise en page par défaut rétablie')
      onReset()
    } finally {
      setResetting(false)
    }
  }

  return (
    <Alert variant={hasWarnings ? 'destructive' : 'default'}>
      <Info className="h-4 w-4" />
      <AlertTitle>Mise en page {name} personnalisée</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>
          Votre mise en page diffère de la mise en page par défaut, corrigée pour rattacher chaque compte du plan
          comptable à une seule ligne. Vous pouvez la rétablir&nbsp;: vos personnalisations seront perdues.
        </span>
        <Button variant="outline" size="sm" onClick={reset} disabled={resetting}>
          {resetting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Rétablir la mise en page par défaut
        </Button>
      </AlertDescription>
    </Alert>
  )
}
