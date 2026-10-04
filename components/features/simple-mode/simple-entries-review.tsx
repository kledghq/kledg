'use client'

import * as React from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { CheckCircle2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { Amount, EmptyState, PageHeader, StatusBadge, formatAmount, formatDisplayDate } from '@/components/shared'
import { useCompanyAccess } from '@/components/features/companies/company-access'
import { responseError } from '@/hooks/use-cursor-list'
import type { SimpleModeEntryList, SimpleModeEntryView } from '@/lib/simple/simple-validation.service'
import type { SimpleModeSettings } from '@/lib/simple/simple-mode-settings.service'

type Status = 'to-validate' | 'validated' | 'all'

const STATUS_TABS: Array<{ value: Status; label: string }> = [
  { value: 'to-validate', label: 'À valider' },
  { value: 'validated', label: 'Validées' },
  { value: 'all', label: 'Toutes' },
]

/** The setting "Faire valider les saisies du mode simple par l'expert-comptable". */
function ReviewSetting({ companyId, canUpdate }: { companyId: string; canUpdate: boolean }) {
  const [settings, setSettings] = React.useState<SimpleModeSettings | null>(null)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    fetch(`/api/companies/${encodeURIComponent(companyId)}/simple-mode-settings`)
      .then(async (response) => (response.ok ? ((await response.json()) as SimpleModeSettings) : null))
      .then((value) => !cancelled && setSettings(value))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [companyId])

  const update = async (accountantReview: boolean) => {
    setSaving(true)
    try {
      const response = await fetch(`/api/companies/${encodeURIComponent(companyId)}/simple-mode-settings`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accountantReview }),
      })
      if (!response.ok) throw new Error(await responseError(response, "Le réglage n'a pas été enregistré. Réessayez dans un instant."))
      setSettings((await response.json()) as SimpleModeSettings)
      toast.success(accountantReview ? 'Les saisies du mode simple attendront votre validation' : 'Les saisies du mode simple seront validées directement')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (!settings) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>Validation par l&apos;expert-comptable</CardTitle>
        <CardDescription>
          Activé, ce que la société classe en mode simple reste en brouillon jusqu&apos;à votre validation. Par défaut, activé dès qu&apos;un membre a le
          rôle Comptable{settings.setting === null ? ' (réglage par défaut appliqué)' : ''}.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-3">
        <Switch id="simple-review" checked={settings.accountantReview} disabled={!canUpdate || saving} onCheckedChange={(checked) => update(checked)} />
        <Label htmlFor="simple-review">Faire valider les saisies du mode simple par l&apos;expert-comptable</Label>
      </CardContent>
    </Card>
  )
}

function Lines({ entry }: { entry: SimpleModeEntryView }) {
  return (
    <ul className="space-y-0.5 text-xs">
      {entry.lines.map((line, i) => (
        <li key={i} className="flex gap-2">
          <span className="font-mono">{line.accountCode}</span>
          <span className="text-muted-foreground min-w-0 flex-1 truncate">{line.accountLabel}</span>
          <span className="num">{line.debitCents > 0 ? `D ${formatAmount(line.debitCents / 100)}` : `C ${formatAmount(line.creditCents / 100)}`}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * "Saisies du mode simple à valider" (expert mode): the entries a company
 * classified in simple mode, with their category, the answers and the
 * note, validated one by one or together through the usual validation
 * (POST /api/entries/bulk-validate), or corrected in the entry form.
 */
export function SimpleEntriesReview({ companyId }: { companyId: string }) {
  const { can } = useCompanyAccess()
  const canValidate = can({ entries: ['validate'] })
  const canCorrect = can({ entries: ['update'] })
  const [status, setStatus] = React.useState<Status>('to-validate')
  const [data, setData] = React.useState<SimpleModeEntryList | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [version, setVersion] = React.useState(0)
  const [answered, setAnswered] = React.useState(-1)
  const loading = answered !== version
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [validating, setValidating] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    fetch(`/api/simple/entries?${new URLSearchParams({ companyId, status })}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response, 'Les saisies ne se sont pas chargées. Réessayez dans un instant.'))
        return response.json() as Promise<SimpleModeEntryList>
      })
      .then((list) => {
        if (cancelled) return
        setData(list)
        setError(null)
        setSelected(new Set())
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setAnswered(version))
    return () => {
      cancelled = true
    }
  }, [companyId, status, version])

  const drafts = data?.items.filter((e) => e.status === 'draft') ?? []

  const validate = async (entryIds: string[]) => {
    setValidating(true)
    try {
      const response = await fetch('/api/entries/bulk-validate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ companyId, entryIds, status: 'validated' }),
      })
      if (!response.ok) throw new Error(await responseError(response, "La validation n'a pas abouti. Réessayez dans un instant."))
      const result = (await response.json()) as { validated: number; failed: number; errors: Array<{ error: string }> }
      if (result.validated > 0) toast.success(result.validated > 1 ? `${result.validated} écritures validées` : 'Écriture validée')
      if (result.failed > 0) toast.error(result.errors[0]?.error ?? `${result.failed} écritures n'ont pas été validées.`)
      setVersion((v) => v + 1)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setValidating(false)
    }
  }

  const toggle = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  const summary = data?.summary

  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader
        title="Saisies du mode simple à valider"
        description="Les paiements que la société a classés en mode simple, avec la catégorie choisie, les réponses et la note. Vérifiez-les, corrigez-les si besoin, puis validez-les."
        actions={
          canValidate ? (
            <Button onClick={() => validate([...selected])} loading={validating} disabled={selected.size === 0}>
              Valider la sélection ({selected.size})
            </Button>
          ) : null
        }
      />

      <ReviewSetting companyId={companyId} canUpdate={can({ settings: ['update'] })} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={status} onValueChange={(value) => setStatus(value as Status)}>
          <TabsList>
            {STATUS_TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {summary ? (
          <p className="text-muted-foreground text-sm">
            Ce mois-ci&nbsp;: {summary.classifiedCount} classées, {summary.validatedCount} validées, {summary.toValidateCount} à valider.
          </p>
        ) : null}
      </div>

      {error ? (
        <Card className="px-5 py-5">
          <EmptyState
            title="Les saisies ne se sont pas chargées"
            description={error}
            action={
              <Button size="sm" variant="outline" onClick={() => setVersion((v) => v + 1)}>
                Réessayer
              </Button>
            }
          />
        </Card>
      ) : loading && !data ? (
        <Card className="space-y-3 px-5 py-5" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </Card>
      ) : data && data.items.length === 0 ? (
        <EmptyState
          bordered
          tone="success"
          icon={CheckCircle2}
          title={status === 'to-validate' ? 'Rien à valider' : 'Aucune saisie du mode simple'}
          description="Les paiements classés en mode simple apparaîtront ici."
        />
      ) : data ? (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  {canValidate && drafts.length > 0 ? (
                    <Checkbox
                      aria-label="Tout sélectionner"
                      checked={drafts.length > 0 && drafts.every((e) => selected.has(e.entryId))}
                      onCheckedChange={(checked) => setSelected(checked ? new Set(drafts.map((e) => e.entryId)) : new Set())}
                    />
                  ) : null}
                </TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Paiement et catégorie</TableHead>
                <TableHead>Écriture</TableHead>
                <TableHead numeric>Montant</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((entry) => (
                <TableRow key={entry.entryId}>
                  <TableCell>
                    {canValidate && entry.status === 'draft' ? (
                      <Checkbox aria-label={`Sélectionner ${entry.name}`} checked={selected.has(entry.entryId)} onCheckedChange={(checked) => toggle(entry.entryId, checked === true)} />
                    ) : null}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatDisplayDate(entry.date, 'short')}</TableCell>
                  <TableCell className="min-w-56">
                    <div className="font-medium">{entry.name}</div>
                    <div className="text-muted-foreground text-xs">
                      {entry.categoryLabel ?? 'Règle d’affectation'}
                      {entry.answerLabels.length ? `, ${entry.answerLabels.join(', ')}` : ''}
                    </div>
                    {entry.note ? <div className="text-xs">Note&nbsp;: {entry.note}</div> : null}
                    {!entry.hasReceipt ? <div className="text-warning text-xs">Sans justificatif</div> : null}
                  </TableCell>
                  <TableCell className="min-w-64">
                    <Lines entry={entry} />
                  </TableCell>
                  <TableCell numeric>
                    <Amount value={entry.amountCents / 100} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={entry.status === 'draft' ? 'warning' : 'success'}>{entry.status === 'draft' ? 'À valider' : 'Validée'}</StatusBadge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    {entry.status === 'draft' ? (
                      <div className="flex justify-end gap-2">
                        {canCorrect ? (
                          <Button asChild size="xs" variant="outline">
                            <Link href={`/${companyId}/entries/${entry.entryId}/edit`}>Corriger</Link>
                          </Button>
                        ) : null}
                        {canValidate ? (
                          <Button size="xs" onClick={() => validate([entry.entryId])} disabled={validating}>
                            Valider
                          </Button>
                        ) : null}
                      </div>
                    ) : (
                      <Button asChild size="xs" variant="ghost">
                        <Link href={`/${companyId}/entries/${entry.entryId}`}>Voir</Link>
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : null}
    </div>
  )
}
