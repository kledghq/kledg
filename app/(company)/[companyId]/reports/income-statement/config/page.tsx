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
import { IncomeStatementNestedConfigEditor } from '@/components/features/reports/income-statement-nested-config-editor'
import { Skeleton } from '@/components/ui/skeleton'
import { ArrowLeft, RotateCcw } from 'lucide-react'
import { EmptyState, Field, PageHeader, useConfirm } from '@/components/shared'
import { logger } from '@/lib/logger'
import { toast } from 'sonner'
import Link from 'next/link'
import type { IncomeStatementLineConfig, IncomeStatementConfig } from '@/lib/reports/income-statement/types'

export default function IncomeStatementConfigPage() {
  const params = useParams()
  const companyId = params?.companyId as string
  const [config, setConfig] = useState<IncomeStatementConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [variant, setVariant] = useState<'complete' | 'simplified'>('complete')
  const { confirm, dialog: confirmDialog } = useConfirm()

  useEffect(() => {
    async function loadConfig() {
      if (!companyId) return

      setLoading(true)
      try {
        const params = new URLSearchParams({ variant })
        const response = await fetch(`/api/companies/${companyId}/income-statement/config?${params}`)
        
        if (response.ok) {
          const data: IncomeStatementConfig = await response.json()
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
  const flattenForSave = (configs: IncomeStatementLineConfig[]): IncomeStatementLineConfig[] => {
    const result: IncomeStatementLineConfig[] = []
    function traverse(list: IncomeStatementLineConfig[]) {
      for (const c of list) {
        result.push(c)
        if (c.children?.length) traverse(c.children)
      }
    }
    traverse(configs)
    return result
  }

  const handleSave = async (configs: IncomeStatementLineConfig[]) => {
    if (!companyId) return

    const toUpdate = flattenForSave(configs)

    try {
      for (const lineConfig of toUpdate) {
        const response = await fetch(
          `/api/companies/${companyId}/income-statement/config/line/${lineConfig.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              parentId: lineConfig.parentId,
              section: lineConfig.section,
              lineLabel: lineConfig.lineLabel,
              formCode: lineConfig.formCode,
              accountCodes: lineConfig.accountCodes ?? [],
              excludedAccountCodes: lineConfig.excludedAccountCodes ?? [],
              filterType: lineConfig.filterType,
              filterValue: lineConfig.filterValue,
              balanceType: lineConfig.balanceType,
              hideLabel: lineConfig.hideLabel,
              order: lineConfig.order,
              notes: lineConfig.notes,
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
      const response = await fetch(`/api/companies/${companyId}/income-statement/config?${params}`)
      if (response.ok) {
        const data: IncomeStatementConfig = await response.json()
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
        `/api/companies/${companyId}/income-statement/config/line/${configId}`,
        {
          method: 'DELETE',
        }
      )

      if (response.ok) {
        toast.success('Ligne supprimée')
        // Reload config
        const params = new URLSearchParams({ variant })
        const reloadResponse = await fetch(`/api/companies/${companyId}/income-statement/config?${params}`)
        if (reloadResponse.ok) {
          const data: IncomeStatementConfig = await reloadResponse.json()
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
      title: 'Réinitialiser la configuration du compte de résultat ?',
      description:
        'Les lignes et les comptes de la variante ' + (variant === 'complete' ? 'complète' : 'simplifiée') + " reviennent au modèle du PCG. Vos personnalisations de cette variante sont perdues.",
      confirmLabel: 'Réinitialiser',
    })
    if (!ok) return

    try {
      const response = await fetch(
        `/api/companies/${companyId}/income-statement/config/default`,
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
        const reloadResponse = await fetch(`/api/companies/${companyId}/income-statement/config?${params}`)
        if (reloadResponse.ok) {
          const data: IncomeStatementConfig = await reloadResponse.json()
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
        description="Veuillez sélectionner une société pour configurer le compte de résultat"
      />
    )
  }

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        title="Configuration du compte de résultat"
        description="Choisissez quels comptes alimentent chaque ligne du compte de résultat. Les libellés officiels du PCG ne changent pas."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href={`/${companyId}/reports/income-statement`}>
                <ArrowLeft aria-hidden />
                Retour au compte de résultat
              </Link>
            </Button>
            <Button variant="outline" onClick={handleResetToDefault}>
              <RotateCcw aria-hidden />
              Réinitialiser
            </Button>
          </>
        }
      >
        <Field label="Variante" htmlFor="is-config-variant" className="max-w-56">
          <Select value={variant} onValueChange={(v) => setVariant(v as 'complete' | 'simplified')}>
            <SelectTrigger id="is-config-variant">
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
        <IncomeStatementNestedConfigEditor
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
          description="La configuration du compte de résultat ne s'est pas chargée. Rechargez la page ou réinitialisez-la au modèle du PCG."
        />
      )}

      {confirmDialog}
    </div>
  )
}
