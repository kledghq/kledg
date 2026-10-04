'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Inbox, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { logger } from '@/lib/logger'

interface TasksCount {
  unreconciledTransactions: number
  totalTasks: number
}

/**
 * Header shortcuts: the to-do count (transactions to reconcile) and a
 * "synchronize bank and apply rules" button. On phones the header has no
 * room for both: the sync action moves into the to-do popover.
 */
export function TasksIndicator() {
  const params = useParams()
  const companyId = params?.companyId as string | undefined
  const [tasksCount, setTasksCount] = useState<TasksCount | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const loadTasksCount = useCallback(async () => {
    if (!companyId) return
    try {
      const response = await fetch(`/api/tasks/count?companyId=${companyId}`)
      if (response.ok) setTasksCount(await response.json())
    } catch (error) {
      logger.error('Error loading tasks count:', error)
    }
  }, [companyId])

  useEffect(() => {
    if (!companyId) return
    loadTasksCount()
    // Refresh every 2 minutes
    const interval = setInterval(loadTasksCount, 120000)
    return () => clearInterval(interval)
  }, [companyId, loadTasksCount])

  const handleRefresh = async () => {
    if (!companyId) return

    setRefreshing(true)
    try {
      const response = await fetch('/api/tasks/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId }),
      })

      if (response.ok) {
        const results = await response.json()

        if (results.bankSync.success) {
          toast.success(results.bankSync.message)
        }
        if (results.rulesExecution.success && results.rulesExecution.transactionsFailed > 0) {
          // Some rule applications failed: say so, with the first reason
          toast.warning(`Règles d'affectation\u00a0: ${results.rulesExecution.message}`, {
            description: results.rulesExecution.failures?.[0]?.error,
            duration: 8000,
          })
        } else if (results.rulesExecution.success) {
          toast.success(results.rulesExecution.message)
        }

        if (!results.bankSync.success && results.bankSync.message) {
          toast.error(`Synchronisation\u00a0: ${results.bankSync.message}`)
        }
        if (!results.rulesExecution.success && results.rulesExecution.message) {
          toast.error(`Règles d'affectation\u00a0: ${results.rulesExecution.message}`)
        }

        await loadTasksCount()
      } else {
        const errorData = await response.json().catch(() => ({}))
        toast.error(errorData.error || "La synchronisation a échoué. Réessayez dans un instant.")
      }
    } catch (error) {
      logger.error('Error refreshing:', error)
      toast.error("La synchronisation a échoué. Réessayez dans un instant.")
    } finally {
      setRefreshing(false)
    }
  }

  if (!companyId) {
    return null
  }

  const totalTasks = tasksCount?.totalTasks || 0
  const toReconcile = tasksCount?.unreconciledTransactions || 0
  const countLabel = totalTasks > 99 ? '99+' : String(totalTasks)

  return (
    <div className="flex items-center gap-1">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="relative"
            aria-label={totalTasks > 0 ? `Tâches à faire\u00a0: ${totalTasks}` : 'Tâches à faire\u00a0: aucune'}
          >
            <Inbox aria-hidden />
            {totalTasks > 0 && (
              <span
                aria-hidden
                className="bg-foreground text-background num absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold"
              >
                {countLabel}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 max-w-[calc(100vw-2rem)] p-0" align="end">
          <div className="border-b px-4 py-3">
            <p className="text-sm font-semibold">Tâches à faire</p>
          </div>
          <div className="p-2">
            <Link
              href={`/${companyId}/reconciliation`}
              className="hover:bg-accent flex items-center justify-between rounded-md px-2 py-2 text-sm pointer-coarse:min-h-11"
            >
              <span>Transactions à rapprocher</span>
              <span className="num text-muted-foreground">{toReconcile}</span>
            </Link>
          </div>
          {totalTasks === 0 && (
            <p className="text-muted-foreground border-t px-4 py-3 text-xs">Rien à traiter pour le moment.</p>
          )}
          <div className="border-t p-2 sm:hidden">
            <Button variant="ghost" className="w-full justify-start" onClick={handleRefresh} loading={refreshing}>
              <RefreshCw aria-hidden />
              Synchroniser la banque
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <Button
        variant="ghost"
        size="icon-sm"
        className="max-sm:hidden"
        onClick={handleRefresh}
        loading={refreshing}
        title="Synchroniser la banque et appliquer les règles d'affectation"
        aria-label="Synchroniser la banque et appliquer les règles d'affectation"
      >
        <RefreshCw aria-hidden />
      </Button>
    </div>
  )
}
