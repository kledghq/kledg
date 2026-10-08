'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { toast } from 'sonner'
import { logger } from '@/lib/logger'

import { Button } from '@/components/ui/button'
import { NoCompanySelected } from '@/components/features/companies/no-company-selected'
import { Amount, ConfirmDeleteDialog, DateDisplay, EmptyState, PageHeader, StatusBadge, formatAmount } from '@/components/shared'
import { Skeleton } from '@/components/ui/skeleton'
import { FixedAssetsStats } from '@/components/features/fixed-assets/fixed-assets-stats'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Plus, Calculator, MoreHorizontal, Package, Pencil, Trash2 } from 'lucide-react'
import { FixedAssetFormDialog, type FixedAssetFormData } from '@/components/features/fixed-assets/fixed-asset-form-dialog'
import { DepreciationDetailDialog } from '@/components/features/fixed-assets/depreciation-detail-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { docsUrl } from '@/lib/docs-links'
import { cn } from '@/lib/utils'
import { fromCents, toCents } from '@/lib/utils/money'
import { plural } from '@/lib/utils/plural'

interface FixedAsset {
  id: string
  label: string
  comment?: string | null
  acquisitionDate: string
  acquisitionValue: number
  amortizableAmount?: number | null
  disposalDate?: string | null
  depreciationRate: number | null
  depreciationDuration: number | null
  depreciationMethod: string
  decliningCoefficient?: number | null
  depreciationStartDate: string
  assetAccountId: string
  depreciationAccountId: string
  expenseAccountId: string
  isActive: boolean
  isFullyPaid?: boolean
  assetAccount?: { code: string; label: string }
  depreciationAccount?: { code: string; label: string }
  expenseAccount?: { code: string; label: string }
}

interface Account {
  id: string
  code: string
  label: string
}


interface DepreciationStats {
  totalAssets: number
  previousDepreciation: number
  currentDepreciation: number
}

interface FyStatus {
  fiscalYearId: string
  year: number
  startDate: string
  endDate: string
  isClosed: boolean
  entriesCount: number
  amount: number
  postedAmount: number
  done: boolean
  lastEntryDate: string | null
}

interface AssetDepreciationStatus {
  done: boolean
  date?: string
  baseAmount: number
  totalPosted: number
  remainingCapacity: number
  fiscalYears?: FyStatus[]
}

const METHODS: Record<string, string> = { linear: 'Linéaire', declining: 'Dégressif' }

/** Net book value of one asset: acquisition value minus posted depreciation, in cents, never below zero. */
function assetNetBookValue(acquisitionValue: number, totalPosted: number): number {
  return fromCents(Math.max(0, (toCents(acquisitionValue) ?? 0) - (toCents(totalPosted) ?? 0)))
}

/** Depreciated fiscal years as "2024, 2025", with the count, entries and amount for the tooltip. */
function depreciatedYears(status: AssetDepreciationStatus | undefined): { label: string; title: string } | null {
  const done = (status?.fiscalYears ?? []).filter((fy) => fy.done)
  if (done.length === 0) return null
  const years = done.map((fy) => fy.year).sort((a, b) => a - b)
  const entries = done.reduce((sum, fy) => sum + fy.entriesCount, 0)
  const amount = fromCents(done.reduce((sum, fy) => sum + (toCents(fy.amount) ?? 0), 0))
  return {
    label: years.join(', '),
    title: `${plural(years.length, 'exercice')}, ${plural(entries, 'écriture')} d'amortissement, ${formatAmount(amount)}`,
  }
}

/**
 * Under 64rem of container width (phones, tablets, small laptops with the
 * sidebar open) each asset becomes a card on the same markup: the label, the
 * acquisition and the method, the three amounts side by side with their
 * names, then the status and the actions. Full class strings so that
 * Tailwind generates them.
 */
const NAMED =
  '@max-[64rem]/assets:before:mr-1.5 @max-[64rem]/assets:before:text-xs @max-[64rem]/assets:before:font-normal @max-[64rem]/assets:before:text-muted-foreground @max-[64rem]/assets:before:content-[attr(data-label)]'
const STACK = {
  table: '@max-[64rem]/assets:block @max-[64rem]/assets:[&>tbody]:block',
  hidden: '@max-[64rem]/assets:hidden',
  row: '@max-[64rem]/assets:flex @max-[64rem]/assets:flex-wrap @max-[64rem]/assets:items-center @max-[64rem]/assets:gap-x-3 @max-[64rem]/assets:gap-y-2 @max-[64rem]/assets:px-3 @max-[64rem]/assets:py-3',
  label: '@max-[64rem]/assets:order-1 @max-[64rem]/assets:w-full @max-[64rem]/assets:max-w-none @max-[64rem]/assets:p-0 @max-[64rem]/assets:whitespace-normal',
  acquisition: `@max-[64rem]/assets:order-2 @max-[64rem]/assets:p-0 ${NAMED}`,
  method: '@max-[64rem]/assets:order-3 @max-[64rem]/assets:p-0 @max-[64rem]/assets:text-muted-foreground',
  years: `@max-[64rem]/assets:order-4 @max-[64rem]/assets:basis-full @max-[64rem]/assets:p-0 ${NAMED}`,
  amount: `@max-[64rem]/assets:order-5 @max-[64rem]/assets:w-[calc((100%-1.5rem)/3)] @max-[64rem]/assets:p-0 @max-[64rem]/assets:text-left @max-[64rem]/assets:before:block ${NAMED}`,
  status: '@max-[64rem]/assets:order-6 @max-[64rem]/assets:p-0',
  actions: '@max-[64rem]/assets:order-7 @max-[64rem]/assets:ml-auto @max-[64rem]/assets:p-0',
} as const

export default function FixedAssetsPage() {
  const params = useParams()
  const companyId = params?.companyId as string
  const [fixedAssets, setFixedAssets] = useState<FixedAsset[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null)
  const [editingAsset, setEditingAsset] = useState<FixedAsset | null>(null)
  const [deletingAssetId, setDeletingAssetId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<DepreciationStats | null>(null)
  const [depreciationStatus, setDepreciationStatus] = useState<
    Record<string, AssetDepreciationStatus>
  >({})
  const [detailAssetId, setDetailAssetId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  const loadDepreciationStatus = useCallback(async () => {
    if (!companyId || fixedAssets.length === 0) return

    try {
      const statusPromises = fixedAssets.map(async (asset) => {
        const response = await fetch(
          `/api/fixed-assets/${asset.id}/depreciation-status?companyId=${companyId}`
        )
        if (response.ok) {
          const data = await response.json()
          return { assetId: asset.id, status: data as AssetDepreciationStatus }
        }
        return {
          assetId: asset.id,
          status: {
            done: false,
            baseAmount: 0,
            totalPosted: 0,
            remainingCapacity: 0,
          } as AssetDepreciationStatus,
        }
      })

      const results = await Promise.all(statusPromises)
      const statusMap: Record<string, AssetDepreciationStatus> = {}
      results.forEach(({ assetId, status }) => {
        statusMap[assetId] = status
      })
      setDepreciationStatus(statusMap)
    } catch (error) {
      logger.error('Error loading depreciation status:', error)
    }
  }, [companyId, fixedAssets])

  useEffect(() => {
    async function loadData() {
      if (!companyId) {
        setLoading(false)
        return
      }

      try {
        const [assetsResponse, accountsResponse, statsResponse] = await Promise.all([
          fetch(`/api/fixed-assets?companyId=${companyId}`),
          fetch(`/api/accounts?companyId=${companyId}`),
          fetch(`/api/fixed-assets/stats?companyId=${companyId}`),
        ])

        if (assetsResponse.ok) {
          const assets = await assetsResponse.json()
          setFixedAssets(assets)
        }

        if (accountsResponse.ok) {
          const accountsData = await accountsResponse.json()
          setAccounts(accountsData)
        }

        if (statsResponse.ok) {
          const statsData = await statsResponse.json()
          setStats(statsData)
        }
      } catch (error) {
        logger.error('Error loading fixed assets:', error)
        toast.error('Les immobilisations ne se sont pas chargées. Rechargez la page.')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [companyId])

  useEffect(() => {
    if (fixedAssets.length > 0) {
      void loadDepreciationStatus()
    }
  }, [fixedAssets, loadDepreciationStatus])

  const reloadStatsAndStatus = useCallback(async () => {
    if (!companyId) return
    const statsResponse = await fetch(`/api/fixed-assets/stats?companyId=${companyId}`)
    if (statsResponse.ok) {
      const statsData = await statsResponse.json()
      setStats(statsData)
    }
    await loadDepreciationStatus()
  }, [companyId, loadDepreciationStatus])

  const loadAssetForEdit = async (assetId: string) => {
    try {
      const response = await fetch(`/api/fixed-assets/${assetId}`)
      if (response.ok) {
        const asset = await response.json()
        setEditingAssetId(assetId)
        setEditingAsset(asset)
        setEditDialogOpen(true)
      }
    } catch (error) {
      logger.error('Error loading asset:', error)
      toast.error('Erreur lors du chargement de l\'immobilisation')
    }
  }

  const handleSubmit = async (data: FixedAssetFormData) => {
    if (!companyId) return

    setSubmitting(true)
    setError(null)

    try {
      if (editingAssetId) {
        const response = await fetch(`/api/fixed-assets/${editingAssetId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...data,
            companyId: companyId,
          }),
        })

        if (response.ok) {
          const updatedAsset = await response.json()
          setFixedAssets(fixedAssets.map(asset =>
            asset.id === editingAssetId ? updatedAsset : asset
          ))
          setEditDialogOpen(false)
          setEditingAssetId(null)
          setEditingAsset(null)
          toast.success('Immobilisation modifiée')
        } else {
          const errorData = await response.json()
          setError(errorData.error || 'Erreur lors de la modification')
        }
      } else {
        const response = await fetch('/api/fixed-assets', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...data,
            companyId: companyId,
          }),
        })

        if (response.ok) {
          const newAsset = await response.json()
          setFixedAssets([...fixedAssets, newAsset])
          setDialogOpen(false)
          toast.success('Immobilisation créée')
        } else {
          const errorData = await response.json()
          setError(errorData.error || 'Erreur lors de la création')
        }
      }
    } catch (error) {
      logger.error('Error creating fixed asset:', error)
      setError('Erreur lors de la création de l\'immobilisation')
    } finally {
      setSubmitting(false)
    }
  }

  const openDepreciationDetail = (assetId: string) => {
    setDetailAssetId(assetId)
    setDetailOpen(true)
  }

  const handleDelete = async () => {
    if (!companyId || !deletingAssetId) return

    setDeleting(true)
    try {
      const response = await fetch(`/api/fixed-assets/${deletingAssetId}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        const result = await response.json()
        setFixedAssets(fixedAssets.filter(asset => asset.id !== deletingAssetId))
        setDeleteDialogOpen(false)
        setDeletingAssetId(null)
        toast.success(
          result.deletedEntries > 0
            ? `Immobilisation supprimée avec ${plural(result.deletedEntries, 'écriture')} d'amortissement`
            : 'Immobilisation supprimée',
        )

        const statsResponse = await fetch(`/api/fixed-assets/stats?companyId=${companyId}`)
        if (statsResponse.ok) {
          const statsData = await statsResponse.json()
          setStats(statsData)
        }
      } else {
        const errorData = await response.json()
        toast.error(errorData.error || 'Erreur lors de la suppression')
      }
    } catch (error) {
      logger.error('Error deleting asset:', error)
      toast.error('Erreur lors de la suppression')
    } finally {
      setDeleting(false)
    }
  }

  if (!companyId) {
    return (
      <NoCompanySelected
        description="Veuillez sélectionner une société"
      />
    )
  }

  if (loading) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Chargement des immobilisations">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-full max-w-96" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-lg" />
      </div>
    )
  }

  const deletingAsset = deletingAssetId ? fixedAssets.find((a) => a.id === deletingAssetId) : undefined

  return (
    <div className="space-y-6">
      <PageHeader
        title="Immobilisations"
        description="Les biens durables de la société (matériel, véhicules, logiciels) et leur amortissement sur plusieurs exercices."
        docsHref={docsUrl('depreciation')}
        actions={
          <>
            <FixedAssetFormDialog
              open={dialogOpen}
              onOpenChange={setDialogOpen}
              editingAsset={null}
              accounts={accounts}
              submitting={submitting}
              error={error}
              onSubmit={handleSubmit}
              onCancel={() => setDialogOpen(false)}
            />
            <Button onClick={() => setDialogOpen(true)}>
              <Plus aria-hidden />
              Ajouter une immobilisation
            </Button>
          </>
        }
      />

      {stats && (
        <FixedAssetsStats
          totalAssets={stats.totalAssets}
          previousDepreciation={stats.previousDepreciation}
          currentDepreciation={stats.currentDepreciation}
        />
      )}

      {fixedAssets.length === 0 ? (
        <EmptyState
          bordered
          icon={Package}
          title="Aucune immobilisation"
          description="Ajoutez les biens achetés pour durer plus d'un an&nbsp;: Kledg calcule leur amortissement et passe les écritures de dotation."
          action={
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Plus aria-hidden />
              Ajouter une immobilisation
            </Button>
          }
          docsHref={docsUrl('depreciation')}
          docsLabel="Les amortissements"
        />
      ) : (
        <div className="@container/assets">
        <Table containerClassName="rounded-lg border" className={STACK.table}>
          <TableHeader className={STACK.hidden}>
            <TableRow>
              <TableHead>Libellé</TableHead>
              <TableHead>Acquisition</TableHead>
              <TableHead numeric>Valeur</TableHead>
              <TableHead numeric>Déjà amorti</TableHead>
              <TableHead numeric>VNC</TableHead>
              <TableHead>Amortissement</TableHead>
              <TableHead>Exercices amortis</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead className="text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {fixedAssets.map((asset) => {
              const status = depreciationStatus[asset.id]
              const depreciable = asset.depreciationMethod !== 'none'
              const totalPosted = status?.totalPosted ?? 0
              const years = depreciable ? depreciatedYears(status) : null
              return (
                <TableRow key={asset.id} className={STACK.row}>
                  <TableCell className={cn('max-w-48 truncate font-medium', STACK.label)} title={asset.label}>
                    {asset.label}
                  </TableCell>
                  <TableCell data-label="Acquisition" className={STACK.acquisition}>
                    <DateDisplay value={asset.acquisitionDate} />
                  </TableCell>
                  <TableCell numeric data-label="Valeur" className={STACK.amount}>
                    <Amount value={asset.acquisitionValue} />
                  </TableCell>
                  <TableCell numeric data-label="Déjà amorti" className={STACK.amount}>
                    {depreciable ? <Amount value={totalPosted} /> : <span className="text-muted-foreground">Non amortie</span>}
                  </TableCell>
                  <TableCell numeric data-label="VNC" className={STACK.amount}>
                    <Amount
                      value={depreciable ? assetNetBookValue(Number(asset.acquisitionValue), totalPosted) : asset.acquisitionValue}
                    />
                  </TableCell>
                  <TableCell className={STACK.method}>
                    {depreciable ? (
                      <span className="num">
                        {[
                          METHODS[asset.depreciationMethod] ?? asset.depreciationMethod,
                          asset.depreciationRate
                            ? `${String(asset.depreciationRate).replace('.', ',')} %`
                            : asset.depreciationDuration
                              ? `${asset.depreciationDuration} ans`
                              : null,
                        ]
                          .filter(Boolean)
                          .join(', ')}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Non amortissable</span>
                    )}
                  </TableCell>
                  <TableCell data-label="Exercices amortis" className={STACK.years}>
                    {years ? (
                      <span className="num" title={years.title}>{years.label}</span>
                    ) : (
                      <span className="text-muted-foreground text-xs">{depreciable ? 'Aucun' : 'Sans objet'}</span>
                    )}
                  </TableCell>
                  <TableCell className={STACK.status}>
                    <StatusBadge tone={asset.isActive ? 'success' : 'neutral'}>
                      {asset.isActive ? 'Active' : 'Inactive'}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className={cn('text-right', STACK.actions)}>
                    <div className="flex items-center justify-end gap-1">
                      {depreciable && (
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => openDepreciationDetail(asset.id)}
                          disabled={!asset.isActive}
                        >
                          <Calculator aria-hidden />
                          Amortissements
                        </Button>
                      )}
                      <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Autres actions sur ${asset.label}`}
                            title="Autres actions"
                          >
                            <MoreHorizontal aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => void loadAssetForEdit(asset.id)}>
                            <Pencil aria-hidden />
                            Modifier
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => {
                              setDeletingAssetId(asset.id)
                              setDeleteDialogOpen(true)
                            }}
                          >
                            <Trash2 aria-hidden />
                            Supprimer
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        </div>
      )}

      <FixedAssetFormDialog
        open={editDialogOpen}
        onOpenChange={(open) => {
          setEditDialogOpen(open)
          if (!open) {
            setEditingAssetId(null)
            setEditingAsset(null)
          }
        }}
        editingAsset={editingAsset ? {
          id: editingAsset.id,
          label: editingAsset.label,
          comment: editingAsset.comment ?? null,
          acquisitionDate: editingAsset.acquisitionDate,
          acquisitionValue: Number(editingAsset.acquisitionValue),
          amortizableAmount:
            editingAsset.amortizableAmount != null
              ? Number(editingAsset.amortizableAmount)
              : null,
          disposalDate: editingAsset.disposalDate ?? null,
          depreciationRate: editingAsset.depreciationRate,
          depreciationDuration: editingAsset.depreciationDuration,
          depreciationMethod: editingAsset.depreciationMethod,
          decliningCoefficient:
            editingAsset.decliningCoefficient != null
              ? Number(editingAsset.decliningCoefficient)
              : null,
          depreciationStartDate: editingAsset.depreciationStartDate,
          assetAccountId: editingAsset.assetAccountId,
          depreciationAccountId: editingAsset.depreciationAccountId,
          expenseAccountId: editingAsset.expenseAccountId,
          isFullyPaid: editingAsset.isFullyPaid ?? false,
        } : null}
        accounts={accounts}
        submitting={submitting}
        error={error}
        onSubmit={handleSubmit}
        onCancel={() => {
          setEditDialogOpen(false)
          setEditingAssetId(null)
          setEditingAsset(null)
        }}
      />

      <ConfirmDeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={deletingAsset ? `Supprimer l'immobilisation « ${deletingAsset.label} » ?` : "Supprimer l'immobilisation ?"}
        description="Ses écritures d'amortissement en brouillon sont supprimées avec elle. Cette action est irréversible."
        confirmLabel="Supprimer l'immobilisation"
        loading={deleting}
        onConfirm={() => handleDelete()}
      />

      <DepreciationDetailDialog
        open={detailOpen}
        onOpenChange={(open) => {
          setDetailOpen(open)
          if (!open) setDetailAssetId(null)
        }}
        assetId={detailAssetId}
        companyId={companyId}
        assetLabel={
          detailAssetId
            ? fixedAssets.find((a) => a.id === detailAssetId)?.label
            : undefined
        }
        onChanged={reloadStatsAndStatus}
      />
    </div>
  )
}
