'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Copy, KeyRound, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { authClient } from '@/lib/auth-client'
import {
  ALL_COMPANIES,
  API_KEY_EXPIRY_DAYS,
  DEFAULT_API_KEY_EXPIRY_DAYS,
  apiKeyLevelOf,
  type ApiKeyExpiryDays,
  describeLevel,
  type AccessLevel,
  type CompanyAccess,
  type ConnectionAccess,
  type ExecutionMode,
} from '@/lib/ai-access/access'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Field, formatDisplayDate, useConfirm } from '@/components/shared'
import { CompanyAccessPicker, accessError, describeAccess, type PickerCompany } from './company-access-picker'
import { AccessLevelPicker } from './access-level-picker'
import { ExecutionModePicker } from './execution-mode-picker'
import { CompanyAccessDialog } from './company-access-dialog'
import { putAccess } from './use-ai-access'

export type ApiKey = {
  id: string
  name: string | null
  start: string | null
  createdAt: string | Date
  lastRequest: string | Date | null
  expiresAt: string | Date | null
  /** Better Auth key permissions: the key's level (none for keys created before levels). */
  permissions?: Record<string, string[]> | null
}

/** Creation of an API key, with its level, execution mode (full control) and companies. Its secret is shown once. */
export function NewApiKeyCard({
  companies,
  companiesLoading,
  onCreated,
}: {
  companies: PickerCompany[]
  companiesLoading: boolean
  onCreated: () => Promise<void>
}) {
  const [name, setName] = useState('')
  const [access, setAccess] = useState<CompanyAccess>(ALL_COMPANIES)
  // Read and drafts by default, as before levels existed; never full control.
  const [level, setLevel] = useState<AccessLevel>('write')
  // Full control only: automatic by default (owner's choice).
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('automatic')
  // Full control only: the password is typed again (the server checks it).
  const [password, setPassword] = useState('')
  // A key that writes always expires; "no expiry" only for a read-only key (KLEDG-R3-AUTH-01).
  const [expiry, setExpiry] = useState<ApiKeyExpiryDays>(DEFAULT_API_KEY_EXPIRY_DAYS)
  const effectiveExpiry: ApiKeyExpiryDays = expiry === null && level !== 'read' ? DEFAULT_API_KEY_EXPIRY_DAYS : expiry
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null)
  const [accessMessage, setAccessMessage] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newKey, setNewKey] = useState<string | null>(null)

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    const invalid = accessError(access)
    if (invalid) {
      setAccessMessage(invalid)
      return
    }
    if (level === 'admin' && !password) {
      setPasswordMessage('Saisissez votre mot de passe pour créer une clé à contrôle total.')
      return
    }
    setCreating(true)
    try {
      const response = await fetch('/api/ai-access/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || 'Clé MCP',
          access,
          level,
          expiresInDays: effectiveExpiry,
          ...(level === 'admin' && { executionMode, password }),
        }),
      })
      const data = (await response.json().catch(() => ({}))) as { key?: string; error?: string }
      if (!response.ok || !data.key) {
        toast.error(data.error ?? 'La clé n\'a pas pu être créée. Réessayez.')
        return
      }
      setNewKey(data.key)
      setName('')
      setAccess(ALL_COMPANIES)
      setLevel('write')
      setExecutionMode('automatic')
      setPassword('')
      setExpiry(DEFAULT_API_KEY_EXPIRY_DAYS)
      await onCreated()
    } finally {
      setCreating(false)
    }
  }

  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value)
    toast.success('Copié dans le presse-papier')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nouvelle clé API</CardTitle>
        <CardDescription>
          Pour Claude Code, Claude Desktop ou vos scripts. La clé agit avec vos droits, au niveau d&apos;accès et sur
          les sociétés choisis, et n&apos;est affichée qu&apos;une seule fois.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={create} className="space-y-4">
          <Field label="Nom" hint="Pour reconnaître la clé dans la liste.">
            <Input
              placeholder="ex. Claude Code"
              maxLength={32}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={creating}
            />
          </Field>
          <AccessLevelPicker value={level} onChange={setLevel} disabled={creating} />
          {level === 'admin' && <ExecutionModePicker value={executionMode} onChange={setExecutionMode} disabled={creating} />}
          <Field
            label="Validité"
            htmlFor="api-key-expiry"
            hint={level === 'read' ? 'Une clé en lecture seule peut ne pas expirer.' : 'Une clé qui écrit expire toujours.'}
          >
            <Select value={effectiveExpiry === null ? 'never' : String(effectiveExpiry)} onValueChange={(v) => setExpiry(v === 'never' ? null : (Number(v) as ApiKeyExpiryDays))} disabled={creating}>
              <SelectTrigger id="api-key-expiry" className="w-full sm:w-60">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {API_KEY_EXPIRY_DAYS.map((days) => (
                  <SelectItem key={days} value={String(days)}>
                    {days} jours
                  </SelectItem>
                ))}
                {level === 'read' && <SelectItem value="never">Sans expiration</SelectItem>}
              </SelectContent>
            </Select>
          </Field>
          {level === 'admin' && (
            <Field
              label="Votre mot de passe"
              hint="Une clé à contrôle total agit comme vous&nbsp;: confirmez avec votre mot de passe."
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
                disabled={creating}
              />
            </Field>
          )}
          <CompanyAccessPicker
            companies={companies}
            loading={companiesLoading}
            value={access}
            onChange={(next) => {
              setAccess(next)
              setAccessMessage(null)
            }}
            disabled={creating}
            error={accessMessage ?? undefined}
          />
          <Button type="submit" loading={creating}>
            <KeyRound aria-hidden />
            Créer la clé
          </Button>
        </form>

        {newKey && (
          <Alert className="mt-4">
            <AlertDescription className="space-y-2">
              <div className="font-medium">Voici votre nouvelle clé API&nbsp;:</div>
              <div className="bg-muted flex items-center gap-2 rounded-md p-2 font-mono text-xs">
                <code className="flex-1 break-all">{newKey}</code>
                <Button size="icon-sm" variant="ghost" onClick={() => copy(newKey)} aria-label="Copier la clé">
                  <Copy aria-hidden />
                </Button>
              </div>
              <div className="text-muted-foreground text-xs">Stockez-la en sécurité, elle ne sera plus affichée.</div>
              <Button size="sm" variant="outline" onClick={() => setNewKey(null)}>
                J&apos;ai copié la clé
              </Button>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}

/** Active API keys: level, execution mode and companies of each one (mode and companies editable), and revocation. */
export function ApiKeysCard({
  keys,
  loading,
  grants,
  companies,
  companiesLoading,
  onChange,
}: {
  keys: ApiKey[]
  loading: boolean
  grants: Map<string, ConnectionAccess>
  companies: PickerCompany[]
  companiesLoading: boolean
  onChange: () => Promise<void>
}) {
  const { confirm, dialog: confirmDialog } = useConfirm()
  const [editing, setEditing] = useState<ApiKey | null>(null)

  const revoke = async (key: ApiKey) => {
    const ok = await confirm({
      title: `Révoquer la clé « ${key.name ?? 'Sans nom'} » ?`,
      description:
        'Les outils qui utilisent cette clé (Claude, scripts) perdront immédiatement l\'accès. Une clé révoquée ne peut pas être réactivée\u00a0: il faudra en créer une nouvelle.',
      confirmLabel: 'Révoquer',
    })
    if (!ok) return
    const { error } = await authClient.apiKey.delete({ keyId: key.id })
    if (error) {
      toast.error(error.message ?? 'Échec de la révocation')
      return
    }
    toast.success('Clé révoquée')
    await onChange()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Clés actives</CardTitle>
        <CardDescription>
          {loading ? 'Chargement...' : `${keys.length} clé${keys.length > 1 ? 's' : ''}`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!loading && keys.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Aucune clé API. Créez-en une ci-dessus si un outil vous la demande ; pour Claude ou ChatGPT, connectez-les
            depuis la page{' '}
            <Link href="/settings/assistants" className="text-link underline-offset-4 hover:underline">
              Assistants IA
            </Link>
            .
          </p>
        ) : (
          <ul className="divide-y">
            {keys.map((k) => (
              <li key={k.id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{k.name ?? 'Sans nom'}</div>
                  <div className="text-muted-foreground text-xs">
                    <span className="font-mono">{k.start ? `${k.start}••••` : '•••'}</span> · créée le{' '}
                    {formatDisplayDate(k.createdAt, 'long')}
                    {k.lastRequest
                      ? ` · dernière utilisation le ${formatDisplayDate(k.lastRequest, 'long')}`
                      : ' · jamais utilisée'}
                    {k.expiresAt ? ` · expire le ${formatDisplayDate(k.expiresAt, 'long')}` : ' · sans expiration'}
                  </div>
                  <div className="text-muted-foreground truncate text-xs">
                    <span className="text-foreground">Accès&nbsp;:</span> {describeLevel(apiKeyLevelOf(k.permissions), grants.get(k.id)?.executionMode)}
                  </div>
                  <div className="text-muted-foreground truncate text-xs">
                    <span className="text-foreground">Sociétés&nbsp;:</span> {describeAccess(grants.get(k.id), companies)}
                  </div>
                </div>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => setEditing(k)}
                  aria-label={`Modifier l'accès de la clé ${k.name ?? 'sans nom'}`}
                >
                  <Pencil aria-hidden />
                  Modifier
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => revoke(k)}
                  aria-label={`Révoquer la clé ${k.name ?? 'sans nom'}`}
                  title="Révoquer"
                  className="text-muted-foreground hover:text-destructive"
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
        title={editing ? `Accès de la clé « ${editing.name ?? 'Sans nom'} »` : ''}
        companies={companies}
        companiesLoading={companiesLoading}
        initial={editing ? grants.get(editing.id) : undefined}
        executionMode={
          editing && apiKeyLevelOf(editing.permissions) === 'admin' ? (grants.get(editing.id)?.executionMode ?? 'automatic') : undefined
        }
        onSave={async (access, _level, executionMode) => {
          if (!editing) return
          await putAccess(`/api/ai-access/api-keys/${encodeURIComponent(editing.id)}`, { access, executionMode })
          await onChange()
        }}
      />
      {confirmDialog}
    </Card>
  )
}
