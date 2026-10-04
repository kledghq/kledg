'use client'

import { useState } from 'react'
import { toast } from 'sonner'

import { Switch } from '@/components/ui/switch'
import { useCompanyAccess } from '@/components/features/companies/company-access'
import { bankAccountName } from './format'
import { responseError, type BankAccountRow } from './types'

/** Whether the Banque page offers to turn the synchronization of this account on or off. */
export function canToggleSync(account: BankAccountRow): boolean {
  return account.bankConnection.provider !== 'MANUAL' && !account.supersededBy && account.bankConnection.status !== 'inactive'
}

interface AccountSyncSwitchProps {
  account: BankAccountRow
  onChanged: () => void
}

/**
 * Turns the synchronization of one connected bank account on or off
 * (PUT /api/banking/accounts/[id] { shouldSync }). The switch moves at once
 * and comes back when the server refuses.
 */
export function AccountSyncSwitch({ account, onChanged }: AccountSyncSwitchProps) {
  const [checked, setChecked] = useState(account.shouldSync)
  const [pending, setPending] = useState(false)
  const { can, denied } = useCompanyAccess()
  const allowed = can({ banking: ['manage'] })
  const name = bankAccountName(account)
  const id = `sync-${account.id}`

  const toggle = async (next: boolean) => {
    setChecked(next)
    setPending(true)
    try {
      const response = await fetch(`/api/banking/accounts/${account.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shouldSync: next }),
      })
      if (!response.ok) {
        setChecked(!next)
        toast.error(await responseError(response, "La synchronisation n'a pas pu être modifiée. Réessayez."))
        return
      }
      toast.success(next ? `Synchronisation reprise pour ${name}` : `Synchronisation suspendue pour ${name}`)
      onChanged()
    } catch {
      setChecked(!next)
      toast.error("La synchronisation n'a pas pu être modifiée. Réessayez.")
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <span title={allowed ? undefined : denied('suspendre ou reprendre la synchronisation')}>
        <Switch id={id} checked={checked} disabled={pending || !allowed} onCheckedChange={toggle} />
      </span>
      <label htmlFor={id} className="sr-only">
        Synchroniser {name}
      </label>
    </>
  )
}
