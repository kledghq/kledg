'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { NoCompanySelected } from '@/components/features/companies/no-company-selected'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { BalanceSheetNestedConfigEditor } from '@/components/features/reports/balance-sheet-nested-config-editor'
import { Skeleton } from '@/components/ui/skeleton'
import { ArrowLeft, RotateCcw } from 'lucide-react'
import { EmptyState, Field, PageHeader, useConfirm } from '@/components/shared'
import { logger } from '@/lib/logger'
import { toast } from 'sonner'
import Link from 'next/link'
import type { BalanceSheetLineConfig, BalanceSheetConfig } from '@/lib/reports/balance-sheet/types'

export default function BalanceSheetConfigPage() {
  const params = useParams()
  const companyId = params?.companyId as string
  const [config, setConfig] = useState<BalanceSheetConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [variant, setVariant] = useState<'complete' | 'simplified'>('complete')
  const { confirm, dialog: confirmDialog } = useConfirm()

  useEffect(() => {
    async function loadConfig() {
      if (!companyId) return

      setLoading(true)
      try {
        const params = new URLSearchParams({ variant })
        const response = await fetch(`/api/companies/${companyId}/balance-sheet/config?${params}`)
        
        if (response.ok) {
          const data: BalanceSheetConfig = await response.json()
          setConfig(data)
        } else {
          const error = await response.json()
          logger.error('Error loading config:', error)
          toast.error('La configuration ne s’est pas chargée. Rechargez la page.')
        }
      } catch (error) {
        logger.error('Error loading config:', error)
        toast.error('La configuration ne s’est pas chargée. Rechargez la page.')
      } finally {
        setLoading(false)
      }
    }

    loadConfig()
  }, [companyId, variant])

  /** Flatten nested config tree so every line (including children) is updated */
  const flattenForSave = (configs: BalanceSheetLineConfig[]): BalanceSheetLineConfig[] => {
    const result: BalanceSheetLineConfig[] = []
    function traverse(list: BalanceSheetLineConfig[]) {
      for (const c of list) {
        result.push(c)
        if (c.children?.length) traverse(c.children)
      }
    }
    traverse(configs)
    return result
  }

  const handleSave = async (configs: BalanceSheetLineConfig[]) => {
    if (!companyId) return

    const toUpdate = flattenForSave(configs)

    try {
      for (const lineConfig of toUpdate) {
        const response = await fetch(
          `/api/companies/${companyId}/balance-sheet/config/line/${lineConfig.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              section: lineConfig.section,
              lineLabel: lineConfig.lineLabel,
              lineType: lineConfig.lineType,
              formCode: lineConfig.formCode,
              amortissementFormCode: lineConfig.amortissementFormCode ?? null,
              accountCodes: lineConfig.accountCodes ?? [],
              excludedAccountCodes: lineConfig.excludedAccountCodes ?? [],
              amortissementAccountCodes: lineConfig.amortissementAccountCodes ?? [],
              filterType: lineConfig.filterType,
              filterValue: lineConfig.filterValue,
              balanceType: lineConfig.balanceType,
              displayType: lineConfig.displayType,
              hideLabel: lineConfig.hideLabel,
              order: lineConfig.order,
              notes: lineConfig.notes,
              reportVariant: lineConfig.reportVariant,
            }),
          }
        )

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error || 'Erreur lors de la sauvegarde')
        }
      }

      toast.success('Configuration enregistrée')
      
      // Reload config
      const params = new URLSearchParams({ variant })
      const response = await fetch(`/api/companies/${companyId}/balance-sheet/config?${params}`)
      if (response.ok) {
        const data: BalanceSheetConfig = await response.json()
        setConfig(data)
      }
    } catch (error) {
      logger.error('Error saving config:', error)
      toast.error(error instanceof Error ? error.message : "La configuration n'a pas été enregistrée. Réessayez.")
    }
  }

  const handleDelete = async (configId: string) => {
    if (!companyId) return

    try {
      const response = await fetch(
        `/api/companies/${companyId}/balance-sheet/config/line/${configId}`,
        {
          method: 'DELETE',
        }
      )

      if (response.ok) {
        toast.success('Ligne supprimée')
        // Reload config
        const params = new URLSearchParams({ variant })
        const reloadResponse = await fetch(`/api/companies/${companyId}/balance-sheet/config?${params}`)
        if (reloadResponse.ok) {
          const data: BalanceSheetConfig = await reloadResponse.json()
          setConfig(data)
        }
      } else {
        const error = await response.json()
        throw new Error(error.error || 'Erreur lors de la suppression')
      }
    } catch (error) {
      logger.error('Error deleting config:', error)
      toast.error(error instanceof Error ? error.message : "La ligne n'a pas été supprimée. Réessayez.")
    }
  }

  const handleResetToDefault = async () => {
    if (!companyId) return

    const ok = await confirm({
      title: 'Réinitialiser la configuration du bilan ?',
      description:
        'Les lignes et les comptes de la variante ' + (variant === 'complete' ? 'complète' : 'simplifiée') + " reviennent au modèle du PCG. Vos personnalisations de cette variante sont perdues.",
      confirmLabel: 'Réinitialiser',
    })
    if (!ok) return

    try {
      const response = await fetch(
        `/api/companies/${companyId}/balance-sheet/config/default`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ variant }),
        }
      )

      if (response.ok) {
        toast.success('Configuration réinitialisée')
        // Reload config
        const params = new URLSearchParams({ variant })
        const reloadResponse = await fetch(`/api/companies/${companyId}/balance-sheet/config?${params}`)
        if (reloadResponse.ok) {
          const data: BalanceSheetConfig = await reloadResponse.json()
          setConfig(data)
        }
      } else {
        const error = await response.json()
        throw new Error(error.error || 'Erreur lors de la réinitialisation')
      }
    } catch (error) {
      logger.error('Error resetting config:', error)
      toast.error(error instanceof Error ? error.message : "La configuration n'a pas été réinitialisée. Réessayez.")
    }
  }

  if (!companyId) {
    return (
      <NoCompanySelected 
        description="Veuillez sélectionner une société pour configurer le bilan"
      />
    )
  }

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        title="Configuration du bilan"
        description="Choisissez quels comptes alimentent chaque ligne du bilan. Les libellés officiels du PCG ne changent pas."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href={`/${companyId}/reports/balance-sheet`}>
                <ArrowLeft aria-hidden />
                Retour au bilan
              </Link>
            </Button>
            <Button variant="outline" onClick={handleResetToDefault}>
              <RotateCcw aria-hidden />
              Réinitialiser
            </Button>
          </>
        }
      >
        <Field label="Variante" htmlFor="bs-config-variant" className="max-w-56">
          <Select value={variant} onValueChange={(v) => setVariant(v as 'complete' | 'simplified')}>
            <SelectTrigger id="bs-config-variant">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="complete">Complète</SelectItem>
              <SelectItem value="simplified">Simplifiée</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </PageHeader>

      {/* Configuration editor */}
      {loading ? (
        <Card>
          <CardContent className="pt-6">
            <Skeleton className="h-96" />
          </CardContent>
        </Card>
      ) : config ? (
        <BalanceSheetNestedConfigEditor
          configs={config.lines}
          companyId={companyId}
          reportVariant={variant}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      ) : (
        <EmptyState
          bordered
          title="Configuration indisponible"
          description="La configuration du bilan ne s'est pas chargée. Rechargez la page ou réinitialisez-la au modèle du PCG."
        />
      )}

      {confirmDialog}
    </div>
  )
}
