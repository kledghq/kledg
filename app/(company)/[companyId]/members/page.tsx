'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { toast } from 'sonner'
import {
  UserPlus,
  Trash2,
  Copy,
  Loader2,
  Check,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { authClient } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { CommandEmpty, CommandGroup } from '@/components/ui/command'
import { Autocomplete, AutocompleteItem } from '@/components/ui/autocomplete'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableEmpty,
  TableSkeleton,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { HelpTip, PageHeader, useConfirm } from '@/components/shared'
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/lib/permissions'
import { AccessNotice } from '@/components/features/companies/company-access'

type BaseRole = 'companyAdmin' | 'accountant' | 'viewer'

type Member = {
  id: string
  userId: string
  email: string
  name: string | null
  roles: string[]
  createdAt: string | Date
}

type UserOption = {
  id: string
  email: string
  name: string | null
}

// One source of truth for role names (lib/permissions.ts), also used by errors and the account page
const ROLE_LABEL: Record<BaseRole, string> = {
  companyAdmin: ROLE_LABELS.companyAdmin,
  accountant: ROLE_LABELS.accountant,
  viewer: ROLE_LABELS.viewer,
}

function roleLabel(r: string): string {
  return ROLE_LABELS[r] ?? r
}

export default function CompanyMembersPage() {
  const params = useParams()
  const companyId = params?.companyId as string
  const session = authClient.useSession()
  const isAdmin = session.data?.user?.role === 'admin'

  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [addOpen, setAddOpen] = useState(false)

  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<BaseRole>('accountant')

  const [userQuery, setUserQuery] = useState('')
  const [userOptions, setUserOptions] = useState<UserOption[]>([])
  const [userSearchLoading, setUserSearchLoading] = useState(false)
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { confirm, dialog: confirmDialog } = useConfirm()

  const [createdCreds, setCreatedCreds] = useState<{
    email: string
    password: string
  } | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(`/api/companies/${companyId}/members`)
      if (!res.ok) throw new Error((await res.json()).error || 'Erreur')
      setMembers(await res.json())
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erreur de chargement')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (companyId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  useEffect(() => {
    if (!isAdmin) return
    if (searchDebounce.current) clearTimeout(searchDebounce.current)
    searchDebounce.current = setTimeout(async () => {
      setUserSearchLoading(true)
      try {
        const url = new URL('/api/users', window.location.origin)
        if (userQuery.trim()) url.searchParams.set('search', userQuery.trim())
        if (companyId) url.searchParams.set('excludeCompanyId', companyId)
        url.searchParams.set('limit', '20')
        const res = await fetch(url.toString())
        if (!res.ok) throw new Error('Erreur')
        setUserOptions(await res.json())
      } catch {
        setUserOptions([])
      } finally {
        setUserSearchLoading(false)
      }
    }, 200)
    return () => {
      if (searchDebounce.current) clearTimeout(searchDebounce.current)
    }
  }, [userQuery, isAdmin, companyId])

  function handleSelectUser(u: UserOption) {
    setEmail(u.email)
    setName(u.name ?? '')
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!email) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/companies/${companyId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          name: name || undefined,
          role,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur')
      if (data.generatedPassword) {
        setCreatedCreds({ email, password: data.generatedPassword })
      } else if (data.welcomeEmailSent) {
        toast.success(`${email} ajouté·e, un email d'accès a été envoyé`)
      } else {
        toast.success(`${email} ajouté·e`)
      }
      setEmail('')
      setName('')
      setRole('accountant')
      setUserQuery('')
      setAddOpen(false)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erreur')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRemove(member: Member) {
    const ok = await confirm({
      title: `Retirer ${member.name ?? member.email} ?`,
      description:
        "Cette personne n'aura plus accès à la société. Son compte utilisateur est conservé et vous pourrez l'ajouter à nouveau.",
      confirmLabel: 'Retirer',
    })
    if (!ok) return
    const memberId = member.id
    try {
      const res = await fetch(
        `/api/companies/${companyId}/members/${memberId}`,
        { method: 'DELETE' }
      )
      if (!res.ok) throw new Error((await res.json()).error || 'Erreur')
      toast.success('Membre retiré')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erreur')
    }
  }

  async function handleChangeRole(member: Member, nextRole: BaseRole) {
    try {
      const res = await fetch(
        `/api/companies/${companyId}/members/${member.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: nextRole }),
        }
      )
      if (!res.ok) throw new Error((await res.json()).error || 'Erreur')
      toast.success(`Rôle mis à jour\u00a0: ${ROLE_LABEL[nextRole]}`)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erreur')
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Membres"
        description="Les personnes qui ont accès à cette société et ce qu'elles peuvent faire."
        actions={
          isAdmin ? (
            <Button onClick={() => setAddOpen(true)}>
              <UserPlus aria-hidden />
              Ajouter un membre
            </Button>
          ) : null
        }
      />

      {/* Members are managed by instance administrators only (POST /api/companies/[id]/members is an adminRoute) */}
      {!isAdmin && !session.isPending ? (
        <AccessNotice>
          Seul un administrateur de l&apos;instance peut ajouter un membre, changer son rôle ou le retirer.
        </AccessNotice>
      ) : null}

      {isAdmin && (
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Ajouter un membre</DialogTitle>
              <DialogDescription>
                Si l&apos;utilisateur n&apos;existe pas, son compte est créé et il reçoit un email pour choisir son mot
                de passe (sans Resend configuré, un mot de passe temporaire s&apos;affiche après l&apos;ajout).
              </DialogDescription>
            </DialogHeader>
            <form
              onSubmit={handleAdd}
              className="grid gap-4"
            >
              <div className="space-y-2">
                <Label htmlFor="member-user">Utilisateur</Label>
                <Autocomplete
                  id="member-user"
                  inputMode="email"
                  shouldFilter={false}
                  query={userQuery}
                  onQueryChange={setUserQuery}
                  selectedLabel={email || undefined}
                  placeholder="Nom ou adresse email"
                >
                  {userSearchLoading && (
                    <div className="flex items-center justify-center p-3 text-sm text-muted-foreground">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Recherche…
                    </div>
                  )}
                  {!userSearchLoading && userOptions.length === 0 && !userQuery.includes('@') && (
                    <CommandEmpty>Aucun utilisateur existant. Saisissez un email pour en créer un.</CommandEmpty>
                  )}
                  {userOptions.length > 0 && (
                    <CommandGroup heading="Utilisateurs existants">
                      {userOptions.map((u) => (
                        <AutocompleteItem key={u.id} value={u.email} onSelect={() => handleSelectUser(u)}>
                          <Check className={cn('mr-2 h-4 w-4', email === u.email ? 'opacity-100' : 'opacity-0')} />
                          <div className="flex flex-col">
                            <span className="text-sm">{u.name ?? u.email}</span>
                            {u.name && <span className="text-xs text-muted-foreground">{u.email}</span>}
                          </div>
                        </AutocompleteItem>
                      ))}
                    </CommandGroup>
                  )}
                  {userQuery.includes('@') &&
                    !userOptions.some((u) => u.email.toLowerCase() === userQuery.toLowerCase()) && (
                      <CommandGroup heading="Nouvel utilisateur">
                        <AutocompleteItem
                          value={`__new__${userQuery}`}
                          onSelect={() => setEmail(userQuery.trim())}
                        >
                          <UserPlus className="mr-2 h-4 w-4" />
                          Créer « {userQuery.trim()} »
                        </AutocompleteItem>
                      </CommandGroup>
                    )}
                </Autocomplete>
                <p className="text-xs text-muted-foreground">
                  Sélectionnez un utilisateur existant ou saisissez un nouvel email.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="member-name">Nom (optionnel)</Label>
                <Input
                  id="member-name"
                  autoComplete="off"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Prénom Nom"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="member-role" className="gap-1.5">
                  Rôle
                  <HelpTip term="Rôles">
                    {(['companyAdmin', 'accountant', 'viewer'] as const).map((role) => (
                      <span key={role} className="block">
                        {ROLE_LABELS[role]}&nbsp;: {ROLE_DESCRIPTIONS[role]}
                      </span>
                    ))}
                  </HelpTip>
                </Label>
                <Select
                  value={role}
                  onValueChange={(v) => setRole(v as BaseRole)}
                >
                  <SelectTrigger id="member-role" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="companyAdmin">
                      {ROLE_LABEL.companyAdmin}
                    </SelectItem>
                    <SelectItem value="accountant">
                      {ROLE_LABEL.accountant}
                    </SelectItem>
                    <SelectItem value="viewer">{ROLE_LABEL.viewer}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                  Annuler
                </Button>
                <Button type="submit" loading={submitting} disabled={!email}>
                  <UserPlus aria-hidden />
                  Ajouter le membre
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            Membres{' '}
            {!loading && <span className="text-muted-foreground num font-normal">{members.length}</span>}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Utilisateur</TableHead>
                  <TableHead>Rôle</TableHead>
                  <TableHead className="w-14 pr-5">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableSkeleton columns={3} rows={3} />
                ) : members.length === 0 ? (
                  <TableEmpty colSpan={3}>
                    {isAdmin
                      ? 'Aucun membre pour l’instant. Administrateur de l’instance, vous ouvrez cette société sans en être membre\u00a0: ajoutez votre expert-comptable ou un associé avec «\u00a0Ajouter un membre\u00a0».'
                      : 'Aucun membre pour cette société.'}
                  </TableEmpty>
                ) : members.map((m) => {
                  const baseRole =
                    (m.roles.find((r) =>
                      ['companyAdmin', 'accountant', 'viewer'].includes(r)
                    ) as BaseRole) || 'viewer'
                  return (
                    <TableRow key={m.id}>
                      <TableCell className="pl-5">
                        <div className="font-medium">{m.name ?? m.email.split('@')[0]}</div>
                        <div className="text-xs text-muted-foreground">
                          {m.email}
                        </div>
                      </TableCell>
                      <TableCell>
                        {isAdmin ? (
                          <Select
                            value={baseRole}
                            onValueChange={(v) =>
                              handleChangeRole(m, v as BaseRole)
                            }
                          >
                            <SelectTrigger size="sm" className="w-40" aria-label={`Rôle de ${m.name ?? m.email}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="companyAdmin">
                                {ROLE_LABEL.companyAdmin}
                              </SelectItem>
                              <SelectItem value="accountant">
                                {ROLE_LABEL.accountant}
                              </SelectItem>
                              <SelectItem value="viewer">
                                {ROLE_LABEL.viewer}
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge variant="secondary">
                            {roleLabel(baseRole)}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="pr-5 text-right">
                        {isAdmin && (
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => handleRemove(m)}
                            aria-label={`Retirer ${m.name ?? m.email}`}
                            title="Retirer de la société"
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
        </CardContent>
      </Card>

      <Dialog
        open={createdCreds !== null}
        onOpenChange={(open) => {
          if (!open) setCreatedCreds(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Utilisateur créé</DialogTitle>
            <DialogDescription>
              Communiquez ce mot de passe temporaire à l'utilisateur. Il ne
              sera plus affiché.
            </DialogDescription>
          </DialogHeader>
          {createdCreds && (
            <div className="space-y-3">
              <div>
                <Label>Email</Label>
                <div className="bg-muted mt-1.5 rounded-md p-2 font-mono text-sm">
                  {createdCreds.email}
                </div>
              </div>
              <div>
                <Label>Mot de passe temporaire</Label>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="bg-muted flex-1 rounded-md p-2 font-mono text-sm break-all">
                    {createdCreds.password}
                  </div>
                  <Button
                    size="icon"
                    variant="outline"
                    aria-label="Copier le mot de passe"
                    onClick={() => {
                      navigator.clipboard.writeText(createdCreds.password)
                      toast.success('Mot de passe copié')
                    }}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setCreatedCreds(null)}>Fermer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </div>
  )
}
