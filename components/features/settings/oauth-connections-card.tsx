'use client'

import { useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { authClient } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDisplayDate, useConfirm } from '@/components/shared'
import {
  ACCESS_LEVELS,
  accessLevelOf,
  describeLevel,
  scopesForLevel,
  type AccessLevel,
  type ConnectionAccess,
} from '@/lib/ai-access/access'

import type { AssistantConsent } from './use-assistant-connections'
import { AssistantLogo } from './assistant-logos'
import { describeAccess, type PickerCompany } from './company-access-picker'
import { CompanyAccessDialog } from './company-access-dialog'
import { putAccess } from './use-ai-access'

/** Why a higher level can't be chosen from here. */
const RECONNECT_HINT =
  "Pour l'autoriser, reconnectez l'assistant\u00a0: déconnectez Kledg dans ses paramètres, connectez-le de nouveau et choisissez cet accès."

/**
 * Lowers an assistant's access through Better Auth's consent API. The
 * database narrows its refresh tokens to the new scopes, and /api/mcp reads
 * the consent on every call, so tokens already issued lose the scopes too.
 * Raising the level takes a new authorization: tokens can't gain a scope.
 */
async function lowerAccess(consent: AssistantConsent, level: AccessLevel): Promise<void> {
  const { error } = await authClient.$fetch('/oauth2/update-consent', {
    method: 'POST',
    body: { id: consent.id, update: { scopes: scopesForLevel(consent.scopes ?? [], level) } },
  })
  if (error) throw new Error("L'accès n'a pas pu être modifié. Réessayez.")
}

/** The current level, with every higher one disabled and the reconnect hint. */
function levelOf(consent: AssistantConsent): { initial: AccessLevel; unavailable: Partial<Record<AccessLevel, string>> } {
  const initial = accessLevelOf(consent.scopes)
  const above = ACCESS_LEVELS.slice(ACCESS_LEVELS.indexOf(initial) + 1)
  return { initial, unavailable: Object.fromEntries(above.map((level) => [level, RECONNECT_HINT])) }
}

/**
 * Assistants authorized through OAuth (claude.ai, ChatGPT...): what each one
 * may do, how it runs important actions with full control, and on which
 * companies, with editing of the access level, the execution mode and the
 * companies, and revocation (which also deletes its tokens).
 */
export function OAuthConnectionsCard({
  consents,
  loading,
  onChange,
  grants,
  companies,
  companiesLoading,
  onGrantChange,
}: {
  consents: AssistantConsent[]
  loading: boolean
  onChange: () => void
  grants: Map<string, ConnectionAccess>
  companies: PickerCompany[]
  companiesLoading: boolean
  onGrantChange: () => Promise<void>
}) {
  const { confirm, dialog: confirmDialog } = useConfirm()
  const [editing, setEditing] = useState<AssistantConsent | null>(null)

  async function revoke(consent: AssistantConsent) {
    const ok = await confirm({
      title: `Révoquer l'accès de ${consent.name}\u00a0?`,
      description:
        "L'assistant ne pourra plus lire ni écrire dans votre comptabilité, dès sa prochaine requête. Vous pourrez le reconnecter plus tard.",
      confirmLabel: 'Révoquer',
    })
    if (!ok) return
    const { error } = await authClient.$fetch('/oauth2/delete-consent', {
      method: 'POST',
      body: { id: consent.id },
    })
    if (error) {
      toast.error("Impossible de révoquer l'accès")
      return
    }
    toast.success('Accès révoqué')
    onChange()
    await onGrantChange()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Assistants autorisés</CardTitle>
        <CardDescription>
          Applications connectées à votre compte par OAuth (Claude, ChatGPT...), et les sociétés qu&apos;elles peuvent
          consulter.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-muted-foreground text-sm">Chargement...</p>
        ) : consents.length === 0 ? (
          <p className="text-muted-foreground text-sm">Aucun assistant autorisé.</p>
        ) : (
          <ul className="divide-y">
            {consents.map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-3">
                <AssistantLogo kind={c.kind} className="size-5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{c.name}</div>
                  <div className="text-muted-foreground text-xs">
                    {describeLevel(accessLevelOf(c.scopes), grants.get(c.clientId)?.executionMode)}
                    {c.createdAt ? ` · autorisé le ${formatDisplayDate(c.createdAt, 'long')}` : ''}
                  </div>
                  <div className="text-muted-foreground truncate text-xs">
                    <span className="text-foreground">Sociétés&nbsp;:</span> {describeAccess(grants.get(c.clientId), companies)}
                  </div>
                </div>
                <Button size="xs" variant="outline" onClick={() => setEditing(c)} aria-label={`Modifier l'accès de ${c.name}`}>
                  <Pencil aria-hidden />
                  Modifier
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Révoquer l'accès de ${c.name}`}
                  title="Révoquer"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => revoke(c)}
                >
                  <Trash2 aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <CompanyAccessDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing ? `Accès de ${editing.name}` : ''}
        companies={companies}
        companiesLoading={companiesLoading}
        initial={editing ? grants.get(editing.clientId) : undefined}
        level={editing ? levelOf(editing) : undefined}
        executionMode={editing ? (grants.get(editing.clientId)?.executionMode ?? 'automatic') : undefined}
        onSave={async (access, level, executionMode) => {
          if (!editing) return
          if (level && level !== accessLevelOf(editing.scopes)) {
            await lowerAccess(editing, level)
            onChange()
          }
          await putAccess('/api/ai-access/assistants', { clientId: editing.clientId, access, executionMode })
          await onGrantChange()
        }}
      />
      {confirmDialog}
    </Card>
  )
}
