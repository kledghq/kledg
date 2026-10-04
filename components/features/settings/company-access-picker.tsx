'use client'

import { useId } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Skeleton } from '@/components/ui/skeleton'
import type { CompanyAccess } from '@/lib/ai-access/access'

export interface PickerCompany {
  id: string
  name: string
  siren?: string | null
}

/**
 * Which companies an assistant or an API key may reach: every company of the
 * user, including the ones added later, or a chosen list.
 */
export function CompanyAccessPicker({
  companies,
  loading = false,
  value,
  onChange,
  disabled = false,
  error,
  loadFailed = false,
}: {
  companies: PickerCompany[]
  loading?: boolean
  value: CompanyAccess
  onChange: (value: CompanyAccess) => void
  disabled?: boolean
  error?: string
  /** The companies could not be loaded: say so instead of "no company". */
  loadFailed?: boolean
}) {
  const id = useId()
  const chosen = new Set(value.companyIds)
  // Nothing to choose from: only "every company" makes sense (and is what the user gets).
  const noCompany = !loading && !loadFailed && companies.length === 0

  const toggle = (companyId: string, checked: boolean) => {
    const next = new Set(chosen)
    if (checked) next.add(companyId)
    else next.delete(companyId)
    onChange({ allCompanies: false, companyIds: companies.map((c) => c.id).filter((c) => next.has(c)) })
  }

  return (
    <fieldset className="space-y-3" disabled={disabled} aria-describedby={error ? `${id}-error` : undefined}>
      <legend className="mb-2 text-sm font-medium">Sociétés accessibles</legend>
      <RadioGroup
        value={value.allCompanies ? 'all' : 'some'}
        onValueChange={(mode) =>
          onChange(mode === 'all' ? { allCompanies: true, companyIds: [] } : { allCompanies: false, companyIds: value.companyIds })
        }
        className="gap-2"
      >
        <div className="flex items-start gap-2">
          <RadioGroupItem value="all" id={`${id}-all`} className="mt-0.5 pointer-coarse:mt-0" />
          <Label htmlFor={`${id}-all`} className="flex-1 font-normal leading-snug pointer-coarse:min-h-11">
            Toutes mes sociétés, y compris les futures
          </Label>
        </div>
        <div className="flex items-start gap-2">
          <RadioGroupItem value="some" id={`${id}-some`} className="mt-0.5 pointer-coarse:mt-0" disabled={noCompany || loadFailed} />
          <Label htmlFor={`${id}-some`} className="flex-1 flex-col items-start gap-0.5 font-normal leading-snug pointer-coarse:min-h-11 pointer-coarse:justify-center">
            <span>Seulement les sociétés choisies</span>
            {noCompany && (
              <span className="text-muted-foreground text-xs">
                Vous n&apos;avez accès à aucune société pour le moment&nbsp;: il n&apos;y a rien à choisir.
              </span>
            )}
          </Label>
        </div>
      </RadioGroup>
      {loadFailed && (
        <p className="text-destructive text-sm">
          Vos sociétés n&apos;ont pas pu être chargées. Rechargez la page pour les choisir une par une.
        </p>
      )}

      {!value.allCompanies && !loadFailed && (
        <div className="max-h-56 overflow-y-auto rounded-md border" aria-busy={loading}>
          {loading ? (
            <div className="space-y-2 p-3">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-40" />
            </div>
          ) : companies.length === 0 ? (
            <p className="text-muted-foreground p-3 text-sm">Vous n&apos;avez accès à aucune société pour le moment.</p>
          ) : (
            <ul className="divide-y">
              {companies.map((company) => (
                <li key={company.id} className="flex items-center gap-2 px-3 py-2">
                  <Checkbox
                    id={`${id}-${company.id}`}
                    checked={chosen.has(company.id)}
                    onCheckedChange={(checked) => toggle(company.id, checked === true)}
                  />
                  <Label htmlFor={`${id}-${company.id}`} className="min-w-0 flex-1 font-normal pointer-coarse:min-h-11">
                    <span className="truncate">{company.name}</span>
                    {company.siren ? <span className="text-muted-foreground num ml-auto text-xs">{company.siren}</span> : null}
                  </Label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error ? (
        <p id={`${id}-error`} className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </fieldset>
  )
}

/** "Toutes les sociétés", or the names of the chosen companies the user can still see. */
export function describeAccess(access: CompanyAccess | undefined, companies: PickerCompany[]): string {
  if (!access || access.allCompanies) return 'Toutes les sociétés'
  const byId = new Map(companies.map((c) => [c.id, c.name]))
  const names = access.companyIds.map((id) => byId.get(id)).filter((name): name is string => Boolean(name))
  return names.length === 0 ? 'Aucune société' : names.join(', ')
}

/** Validation message of a choice, or null when it can be saved. */
export function accessError(access: CompanyAccess): string | null {
  return !access.allCompanies && access.companyIds.length === 0 ? 'Choisissez au moins une société, ou toutes vos sociétés.' : null
}
