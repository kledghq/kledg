'use client'

import { useState } from 'react'
import { toast } from 'sonner'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { LedgerAccountOption } from './types'
import { responseError } from './types'
import { useCompanyAccess } from '@/components/features/companies/company-access'
import { cn } from '@/lib/utils'

const NONE = '__none__'

interface LedgerAccountSelectProps {
  bankAccountId: string
  value: string | null
  options: LedgerAccountOption[]
  disabled?: boolean
  onSaved?: (code: string | null) => void
  /** Accessible name, e.g. "Compte comptable de Compte courant". */
  label: string
  /** Trigger width; a fixed 176px column by default. */
  className?: string
}

/** Maps a bank account (IBAN) to its 512 ledger account; saved on change. */
export function LedgerAccountSelect({ bankAccountId, value, options, disabled, onSaved, label, className }: LedgerAccountSelectProps) {
  const [current, setCurrent] = useState(value ?? NONE)
  const [saving, setSaving] = useState(false)
  const { can, denied } = useCompanyAccess()
  const allowed = can({ banking: ['manage'] })

  const save = async (next: string) => {
    const previous = current
    setCurrent(next)
    setSaving(true)
    const code = next === NONE ? null : next
    const response = await fetch(`/api/banking/accounts/${bankAccountId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ledgerAccountCode: code }),
    })
    setSaving(false)
    if (!response.ok) {
      setCurrent(previous)
      toast.error(await responseError(response, "Le compte comptable n'a pas pu être enregistré."))
      return
    }
    toast.success(code ? `Compte ${code} associé` : 'Association retirée')
    onSaved?.(code)
  }

  return (
    <Select value={current} onValueChange={save} disabled={disabled || saving || !allowed}>
      <SelectTrigger size="sm" aria-label={label} className={cn('w-44', className)} title={allowed ? undefined : denied('changer le compte comptable')}>
        <SelectValue placeholder="Choisir un compte 512" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>Non associé</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.id} value={option.code}>
            <span className="font-mono text-xs">{option.code}</span> {option.label}
          </SelectItem>
        ))}
        {value && !options.some((o) => o.code === value) ? (
          <SelectItem value={value}>
            <span className="font-mono text-xs">{value}</span>
          </SelectItem>
        ) : null}
      </SelectContent>
    </Select>
  )
}
