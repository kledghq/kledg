'use client'

import * as React from 'react'
import { Lock } from 'lucide-react'

import { cn } from '@/lib/utils'
import { allPermissions, grants, type GrantedPermissions, type PermissionRequest } from '@/lib/rbac/granted-permissions'

interface CompanyAccess {
  granted: GrantedPermissions
  /** The user's role in the company, as ROLE_LABELS names it ("Comptable"). */
  roleLabel: string
}

// Outside a company layout (tests, isolated components) nothing is restricted:
// the API still refuses what the role cannot do.
const CompanyAccessContext = React.createContext<CompanyAccess>({ granted: allPermissions(), roleLabel: '' })

/** Given by the company layout (app/(company)/[companyId]/layout.tsx) from the user's roles. */
export function CompanyAccessProvider({ value, children }: { value: CompanyAccess; children: React.ReactNode }) {
  return <CompanyAccessContext.Provider value={value}>{children}</CompanyAccessContext.Provider>
}

/**
 * What the user may do in the current company: `can({ banking: ['manage'] })`
 * and the French reason to show next to an action the role cannot use.
 */
export function useCompanyAccess() {
  const access = React.useContext(CompanyAccessContext)
  return React.useMemo(
    () => ({
      roleLabel: access.roleLabel,
      can: (request: PermissionRequest) => grants(access.granted, request),
      /** "Votre rôle (Comptable) ne permet pas de connecter une banque." */
      denied: (what: string) =>
        `Votre rôle${access.roleLabel ? ` (${access.roleLabel})` : ''} ne permet pas de ${what} : demandez-le à un administrateur de la société.`,
    }),
    [access],
  )
}

/**
 * One line above the controls a role cannot use, which stay visible and
 * disabled (docs/design-system.md: an action that is refused says why).
 */
export function AccessNotice({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn('text-muted-foreground flex items-start gap-2 text-sm', className)} role="note">
      <Lock aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  )
}
