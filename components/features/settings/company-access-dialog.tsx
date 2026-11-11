'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/shared'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ALL_COMPANIES, type AccessLevel, type CompanyAccess, type ExecutionMode } from '@/lib/ai-access/access'
import { AccessLevelPicker } from './access-level-picker'
import { ExecutionModePicker } from './execution-mode-picker'
import { CompanyAccessPicker, accessError, type PickerCompany } from './company-access-picker'

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  companies: PickerCompany[]
  companiesLoading: boolean
  initial: CompanyAccess | undefined
  /** Assistants only: their access level, edited with the companies. */
  level?: { initial: AccessLevel; unavailable?: Partial<Record<AccessLevel, string>> }
  /**
   * Execution mode of a full control connection: shown for an assistant
   * while Contrôle total is chosen, for an API key when given (keys of that
   * level only).
   */
  executionMode?: ExecutionMode
  /** The password typed again, when leaving validation mode (the server checks it). */
  onSave: (access: CompanyAccess, level?: AccessLevel, executionMode?: ExecutionMode, password?: string) => Promise<void>
}

/**
 * Edits which companies one assistant or API key may reach, for an
 * assistant its access level, and for full control its execution mode. The
 * change applies to the next request of the assistant, without reconnecting it.
 */
export function CompanyAccessDialog(props: DialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {/* Mounted while open only: each opening starts from the saved access. */}
      {props.open ? <AccessForm {...props} /> : null}
    </Dialog>
  )
}

function AccessForm({ onOpenChange, title, companies, companiesLoading, initial, level, executionMode, onSave }: DialogProps) {
  const [value, setValue] = useState<CompanyAccess>(initial ?? ALL_COMPANIES)
  const [chosenLevel, setChosenLevel] = useState<AccessLevel | undefined>(level?.initial)
  const [mode, setMode] = useState<ExecutionMode | undefined>(executionMode)
  const showMode = mode !== undefined && (!level || chosenLevel === 'admin')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Leaving validation mode turns the approvals off: the password, typed again
  const needsPassword = showMode && executionMode === 'validation' && mode === 'automatic'
  const [password, setPassword] = useState('')
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null)

  const save = async () => {
    if (needsPassword && !password) {
      setPasswordMessage('Saisissez votre mot de passe.')
      return
    }
    const invalid = accessError(value)
    if (invalid) {
      setError(invalid)
      return
    }
    setSaving(true)
    try {
      const chosen = { allCompanies: value.allCompanies, companyIds: value.companyIds }
      if (needsPassword) await onSave(chosen, chosenLevel, mode, password)
      else await onSave(chosen, chosenLevel, showMode ? mode : undefined)
      toast.success('Accès mis à jour')
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "L'accès n'a pas pu être enregistré. Réessayez.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {level
            ? "Choisissez ce que cet assistant peut faire et les sociétés qu'il peut consulter."
            : executionMode
              ? "Choisissez les sociétés que cette clé peut consulter et comment elle exécute les actions importantes."
              : 'Choisissez les sociétés que cette connexion peut consulter.'}{' '}
          Le changement s&apos;applique dès sa prochaine requête.
        </DialogDescription>
      </DialogHeader>
      {level && chosenLevel && (
        <AccessLevelPicker
          value={chosenLevel}
          onChange={setChosenLevel}
          disabled={saving}
          unavailable={level.unavailable}
        />
      )}
      {showMode && mode && <ExecutionModePicker value={mode} onChange={setMode} disabled={saving} />}
      {needsPassword && (
        <Field
          label="Votre mot de passe"
          hint="En exécution automatique, les actions importantes ne vous seront plus soumises&nbsp;: confirmez avec votre mot de passe."
          error={passwordMessage ?? undefined}
          required
        >
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              setPasswordMessage(null)
            }}
            disabled={saving}
          />
        </Field>
      )}
      <CompanyAccessPicker
        companies={companies}
        loading={companiesLoading}
        value={value}
        onChange={(next) => {
          setValue(next)
          setError(null)
        }}
        disabled={saving}
        error={error ?? undefined}
      />
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
          Annuler
        </Button>
        <Button onClick={save} loading={saving}>
          Enregistrer l&apos;accès
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
