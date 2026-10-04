'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Field, PageHeader, useConfirm } from '@/components/shared'
import { AccessNotice, useCompanyAccess } from '@/components/features/companies/company-access'
import { responseError } from '@/hooks/use-cursor-list'
import { EXPENSE_CATEGORIES, EXPENSE_LINE_CATEGORIES, type ExpenseCategory } from '@/lib/expense-reports/categories'
import type { CategoryRule } from '@/lib/expense-reports/category-rules'
import { CLAIMANT_KIND_LABELS, DEFAULT_CLAIMANT_ACCOUNT } from '@/lib/expense-reports/status'
import { plural } from '@/lib/utils/plural'

type Kind = 'EMPLOYEE' | 'DIRIGEANT' | 'ASSOCIE'

interface Claimant {
  id: string
  kind: Kind
  name: string
  personId: string | null
  userId: string | null
  accountCode: string | null
  auxiliaryAccountNumber: string
  _count: { reports: number }
}

interface Options {
  persons: Array<{ id: string; name: string }>
  members: Array<{ userId: string; name: string }>
}

async function send(url: string, method: string, body?: unknown) {
  const response = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  if (!response.ok) throw new Error(await responseError(response, 'L’enregistrement n’a pas abouti. Réessayez.'))
  return response.status === 204 ? null : response.json()
}

/** Claimants (who is reimbursed, on which account) and the keyword rules of the categories. */
export function ExpenseSettings({ companyId }: { companyId: string }) {
  const { can, denied } = useCompanyAccess()
  const mayManage = can({ expenses: ['validate'] })
  const { confirm, dialog } = useConfirm()
  const [claimants, setClaimants] = React.useState<Claimant[] | null>(null)
  const [rules, setRules] = React.useState<CategoryRule[] | null>(null)
  const [options, setOptions] = React.useState<Options>({ persons: [], members: [] })
  const [version, setVersion] = React.useState(0)
  const reload = () => setVersion((v) => v + 1)
  const [claimant, setClaimant] = React.useState({ kind: 'EMPLOYEE' as Kind, name: '', link: 'none', accountCode: '' })
  const [rule, setRule] = React.useState({ keyword: '', category: 'TRANSPORT' as ExpenseCategory, accountCode: '' })
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    const query = new URLSearchParams({ companyId }).toString()
    Promise.all([
      fetch(`/api/expense-claimants?${query}`).then((r) => (r.ok ? r.json() : { claimants: [] })),
      fetch(`/api/expense-category-rules?${query}`).then((r) => (r.ok ? r.json() : { rules: [] })),
      mayManage ? fetch(`/api/expense-claimants/options?${query}`).then((r) => (r.ok ? r.json() : { persons: [], members: [] })) : Promise.resolve({ persons: [], members: [] }),
    ]).then(([c, r, o]) => {
      if (cancelled) return
      setClaimants(c.claimants)
      setRules(r.rules)
      setOptions(o)
    })
    return () => {
      cancelled = true
    }
  }, [companyId, mayManage, version])

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true)
    try {
      await action()
      toast.success(success)
      reload()
      return true
    } catch (e) {
      toast.error((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  const addClaimant = async (event: React.FormEvent) => {
    event.preventDefault()
    const [type, id] = claimant.link.split(':')
    const ok = await run(
      () =>
        send('/api/expense-claimants', 'POST', {
          companyId,
          kind: claimant.kind,
          name: claimant.name,
          personId: type === 'person' ? id : null,
          userId: type === 'member' ? id : null,
          accountCode: claimant.accountCode || null,
        }),
      'Bénéficiaire ajouté',
    )
    if (ok) setClaimant({ kind: 'EMPLOYEE', name: '', link: 'none', accountCode: '' })
  }
  const removeClaimant = async (c: Claimant) => {
    if (await confirm({ title: `Supprimer ${c.name}\u00a0?`, description: 'Le bénéficiaire n’a aucune note de frais\u00a0: sa fiche est supprimée.', confirmLabel: 'Supprimer' })) {
      await run(() => send(`/api/expense-claimants/${c.id}`, 'DELETE'), 'Bénéficiaire supprimé')
    }
  }
  const addRule = async (event: React.FormEvent) => {
    event.preventDefault()
    const ok = await run(() => send('/api/expense-category-rules', 'POST', { companyId, keyword: rule.keyword, category: rule.category, accountCode: rule.accountCode || null }), 'Règle ajoutée')
    if (ok) setRule({ keyword: '', category: 'TRANSPORT', accountCode: '' })
  }

  return (
    <div className="space-y-6">
      {dialog}
      <PageHeader
        title="Bénéficiaires et catégories"
        description="Qui la société rembourse, sur quel compte, et les mots-clés qui proposent la catégorie d’une dépense."
      />
      {!mayManage ? <AccessNotice>{denied('gérer les bénéficiaires des notes de frais')}</AccessNotice> : null}

      <Card>
        <CardHeader>
          <CardTitle>Bénéficiaires</CardTitle>
          <CardDescription>
            Un salarié est crédité au compte 421, un associé à son compte courant 455, un dirigeant ni salarié ni associé au compte 467. Un dirigeant assimilé salarié se
            règle sur 421, un dirigeant associé sur 455. Un membre qui dépose sa première note devient salarié par défaut.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {claimants === null ? (
            <Skeleton className="h-24 w-full" />
          ) : claimants.length === 0 ? (
            <p className="text-muted-foreground text-sm">Aucun bénéficiaire pour l’instant.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {claimants.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0">
                    {c.name}
                    <span className="text-muted-foreground block text-xs">
                      {CLAIMANT_KIND_LABELS[c.kind]}, compte <span className="font-mono">{c.accountCode ?? DEFAULT_CLAIMANT_ACCOUNT[c.kind].root}</span>, auxiliaire{' '}
                      <span className="font-mono">{c.auxiliaryAccountNumber}</span>, {plural(c._count.reports, 'note de frais', 'notes de frais')}
                    </span>
                  </span>
                  {mayManage && c._count.reports === 0 ? (
                    <Button variant="ghost" size="icon-sm" aria-label={`Supprimer ${c.name}`} title="Supprimer" onClick={() => removeClaimant(c)} disabled={busy}>
                      <Trash2 aria-hidden />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {mayManage ? (
            <form onSubmit={addClaimant} className="grid gap-3 sm:grid-cols-2">
              <Field label="Nom" htmlFor="claimant-name" required>
                <Input id="claimant-name" value={claimant.name} onChange={(e) => setClaimant({ ...claimant, name: e.target.value })} placeholder="ex. Camille Martin" />
              </Field>
              <Field label="Qualité" htmlFor="claimant-kind">
                <Select value={claimant.kind} onValueChange={(v) => setClaimant({ ...claimant, kind: v as Kind })}>
                  <SelectTrigger id="claimant-kind" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(CLAIMANT_KIND_LABELS) as Kind[]).map((k) => (
                      <SelectItem key={k} value={k}>
                        {CLAIMANT_KIND_LABELS[k]} (compte {DEFAULT_CLAIMANT_ACCOUNT[k].root})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Personne ou membre" htmlFor="claimant-link" optional>
                <Select value={claimant.link} onValueChange={(v) => setClaimant({ ...claimant, link: v })}>
                  <SelectTrigger id="claimant-link" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Aucun lien</SelectItem>
                    {options.members.map((m) => (
                      <SelectItem key={m.userId} value={`member:${m.userId}`}>
                        Membre&nbsp;: {m.name}
                      </SelectItem>
                    ))}
                    {options.persons.map((p) => (
                      <SelectItem key={p.id} value={`person:${p.id}`}>
                        Personne&nbsp;: {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Compte" optional hint="Vide&nbsp;: le compte de sa qualité. Sinon 421, 425, 455 ou 467 et leurs sous-comptes.">
                <Input value={claimant.accountCode} onChange={(e) => setClaimant({ ...claimant, accountCode: e.target.value.trim() })} placeholder="ex. 4551" className="font-mono" />
              </Field>
              <div className="sm:col-span-2">
                <Button type="submit" size="sm" disabled={busy || !claimant.name.trim()}>
                  <Plus aria-hidden />
                  Ajouter le bénéficiaire
                </Button>
              </div>
            </form>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Catégories automatiques</CardTitle>
          <CardDescription>Un mot-clé trouvé dans le fournisseur ou le libellé d’une dépense propose sa catégorie, et son compte s’il est donné.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {rules === null ? (
            <Skeleton className="h-16 w-full" />
          ) : rules.length === 0 ? (
            <p className="text-muted-foreground text-sm">Aucune règle&nbsp;: ajoutez par exemple « sncf » pour Transport.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {rules.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0">
                    « {r.keyword} »&nbsp;: {EXPENSE_CATEGORIES[r.category]?.label ?? r.category}
                    {r.accountCode ? <span className="text-muted-foreground font-mono text-xs"> {r.accountCode}</span> : null}
                  </span>
                  {mayManage ? (
                    <Button variant="ghost" size="icon-sm" aria-label={`Supprimer la règle ${r.keyword}`} title="Supprimer" onClick={() => run(() => send(`/api/expense-category-rules/${r.id}`, 'DELETE'), 'Règle supprimée')} disabled={busy}>
                      <Trash2 aria-hidden />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {mayManage ? (
            <form onSubmit={addRule} className="grid gap-3 sm:grid-cols-3">
              <Field label="Mot-clé" htmlFor="rule-keyword" required>
                <Input id="rule-keyword" value={rule.keyword} onChange={(e) => setRule({ ...rule, keyword: e.target.value })} placeholder="ex. sncf" />
              </Field>
              <Field label="Catégorie" htmlFor="rule-category">
                <Select value={rule.category} onValueChange={(v) => setRule({ ...rule, category: v as ExpenseCategory })}>
                  <SelectTrigger id="rule-category" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPENSE_LINE_CATEGORIES.map((key) => (
                      <SelectItem key={key} value={key}>
                        {EXPENSE_CATEGORIES[key].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Compte" optional>
                <Input value={rule.accountCode} onChange={(e) => setRule({ ...rule, accountCode: e.target.value.trim() })} placeholder="ex. 6251" className="font-mono" />
              </Field>
              <div className="sm:col-span-3">
                <Button type="submit" size="sm" disabled={busy || rule.keyword.trim().length < 2}>
                  <Plus aria-hidden />
                  Ajouter la règle
                </Button>
              </div>
            </form>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
