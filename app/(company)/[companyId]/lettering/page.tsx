'use client'

import * as React from 'react'
import { useParams } from 'next/navigation'
import { toast } from 'sonner'
import { Link2, RotateCw, Sparkles, Wand2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Amount, EmptyState, HelpTip, PageHeader, StatusBadge, useConfirm } from '@/components/shared'
import { FiscalYearSelector } from '@/components/features/accounting/fiscal-year-selector'
import { AccessNotice, useCompanyAccess } from '@/components/features/companies/company-access'
import { LetteringPanel, type PanelLine } from '@/components/features/lettering/lettering-panel'
import { responseError } from '@/hooks/use-cursor-list'
import { SUGGESTION_LABELS, type LetteringSuggestion } from '@/lib/lettering/match'
import { plural } from '@/lib/utils/plural'

interface LetterableAccount {
  id: string
  code: string
  label: string
  openCount: number
  openBalanceCents: number
  letteredCount: number
}

interface LinesData {
  account: { id: string; code: string; label: string }
  fiscalYear: { id: string; year: number; isClosed: boolean }
  lines: PanelLine[]
  totals: { debitCents: number; creditCents: number; balanceCents: number }
  truncated: boolean
  draftCount: number
  nextCode: string
}

type Status = 'open' | 'lettered' | 'all'
const ALL_TIERS = '__all__'

const STATUS_LABELS: Record<Status, string> = { open: 'À lettrer', lettered: 'Lettrées', all: 'Toutes' }

async function postJson(url: string, body: unknown, fallback: string) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(await responseError(response, fallback))
  return response.json()
}

export default function LetteringPage() {
  const params = useParams()
  const companyId = params?.companyId as string
  const { can, denied } = useCompanyAccess()
  const mayLetter = can({ entries: ['update'] })
  const { confirm, dialog } = useConfirm()

  const [fiscalYearId, setFiscalYearId] = React.useState<string>('')
  const [accounts, setAccounts] = React.useState<LetterableAccount[] | null>(null)
  const [accountId, setAccountId] = React.useState<string>('')
  const [status, setStatus] = React.useState<Status>('open')
  const [tiers, setTiers] = React.useState<string>(ALL_TIERS)
  const [data, setData] = React.useState<LinesData | null>(null)
  const [suggestions, setSuggestions] = React.useState<LetteringSuggestion[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [version, setVersion] = React.useState(0)
  const reload = () => setVersion((n) => n + 1)

  // Third-party accounts of the fiscal year
  React.useEffect(() => {
    if (!companyId || !fiscalYearId) return
    let cancelled = false
    fetch(`/api/lettering/accounts?${new URLSearchParams({ companyId, fiscalYearId })}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response, 'Les comptes ne se sont pas chargés. Réessayez dans un instant.'))
        return response.json() as Promise<{ accounts: LetterableAccount[] }>
      })
      .then((result) => {
        if (cancelled) return
        setAccounts(result.accounts)
        setAccountId((current) =>
          result.accounts.some((a) => a.id === current) ? current : (result.accounts.find((a) => a.openCount > 0) ?? result.accounts[0])?.id ?? '',
        )
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setAccounts([])
          setError(e.message)
        }
      })
    return () => {
      cancelled = true
    }
  }, [companyId, fiscalYearId, version])

  // Lines and proposals of the account
  React.useEffect(() => {
    if (!companyId || !accountId) {
      setLoading(accounts === null)
      setData(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    const query = new URLSearchParams({ companyId, accountId })
    Promise.all([
      fetch(`/api/lettering?${query}&status=${status}`).then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response, 'Les lignes ne se sont pas chargées. Réessayez dans un instant.'))
        return response.json() as Promise<LinesData>
      }),
      fetch(`/api/lettering/suggestions?${query}`).then((response) =>
        response.ok ? (response.json() as Promise<{ suggestions: LetteringSuggestion[] }>) : { suggestions: [] },
      ),
    ])
      .then(([lines, proposals]) => {
        if (cancelled) return
        setData(lines)
        setSuggestions(proposals.suggestions)
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [companyId, accountId, status, version, accounts])

  const account = accounts?.find((a) => a.id === accountId)
  const closed = data?.fiscalYear.isClosed ?? false
  const canWrite = mayLetter && !closed
  const tiersOptions = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const line of data?.lines ?? []) {
      if (line.auxiliaryAccountNumber) map.set(line.auxiliaryAccountNumber, line.auxiliaryAccountLabel ?? '')
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [data])
  const shownLines = React.useMemo(
    () => (data?.lines ?? []).filter((line) => tiers === ALL_TIERS || line.auxiliaryAccountNumber === tiers || !line.auxiliaryAccountNumber),
    [data, tiers],
  )

  const letter = async (lineIds: string[]) => {
    setBusy(true)
    try {
      const group = (await postJson('/api/lettering', { companyId, accountId, lineIds }, "Le lettrage n'a pas abouti. Réessayez.")) as { code: string }
      toast.success(`Lignes lettrées ${group.code}`)
      reload()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const unletter = async (code: string) => {
    const ok = await confirm({
      title: `Délettrer ${code}\u00a0?`,
      description: 'Les lignes de ce lettrage redeviennent à lettrer. Les écritures ne changent pas.',
      confirmLabel: 'Délettrer',
    })
    if (!ok) return
    setBusy(true)
    try {
      await postJson('/api/lettering/unletter', { companyId, accountId, code }, "Le délettrage n'a pas abouti. Réessayez.")
      toast.success(`Lettrage ${code} retiré`)
      reload()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const autoLetter = async () => {
    setBusy(true)
    try {
      const result = (await postJson('/api/lettering/auto', { companyId, accountId }, "Le lettrage automatique n'a pas abouti. Réessayez.")) as { message: string }
      toast.success(result.message)
      reload()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const lineById = new Map((data?.lines ?? []).map((line) => [line.id, line]))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lettrage"
        description="Rapprochez les factures et les règlements de vos clients et fournisseurs&nbsp;: des lignes dont les débits égalent les crédits reçoivent le même code de lettrage, repris dans le FEC."
        actions={
          <Button variant="outline" onClick={reload} disabled={loading || busy}>
            <RotateCw aria-hidden />
            Actualiser
          </Button>
        }
      />

      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="lettering-fiscal-year">Exercice</Label>
            <FiscalYearSelector
              companyId={companyId}
              value={fiscalYearId}
              onValueChange={(id) => {
                setFiscalYearId(id)
                setTiers(ALL_TIERS)
              }}
              showLabel={false}
              showPeriod={false}
              id="lettering-fiscal-year"
            />
          </div>
          <div className="space-y-2 lg:col-span-2">
            <Label htmlFor="lettering-account" className="flex items-center gap-1.5">
              Compte de tiers
              <HelpTip term="Lettrage">
                Le lettrage relie une facture aux règlements qui la soldent. Seuls les comptes de tiers (clients 41, fournisseurs 40,
                personnel, associés, 467 et attente) se lettrent.
              </HelpTip>
            </Label>
            <Select
              value={accountId}
              onValueChange={(id) => {
                setAccountId(id)
                setTiers(ALL_TIERS)
              }}
              disabled={!accounts || accounts.length === 0}
            >
              <SelectTrigger id="lettering-account" className="w-full">
                <SelectValue placeholder="Choisissez un compte" />
              </SelectTrigger>
              <SelectContent>
                {(accounts ?? []).map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    <span className="font-mono text-xs">{a.code}</span> {a.label} ({plural(a.openCount, 'ligne à lettrer', 'lignes à lettrer')})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="lettering-tiers">Tiers</Label>
            <Select value={tiers} onValueChange={setTiers} disabled={tiersOptions.length === 0}>
              <SelectTrigger id="lettering-tiers" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_TIERS}>Tous les tiers</SelectItem>
                {tiersOptions.map(([number, label]) => (
                  <SelectItem key={number} value={number}>
                    <span className="font-mono text-xs">{number}</span> {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {!mayLetter ? <AccessNotice>{denied('lettrer les comptes')}</AccessNotice> : null}
      {closed && data ? (
        <AccessNotice>
          L&apos;exercice {data.fiscalYear.year} est clôturé&nbsp;: son lettrage ne peut plus changer, pour que son FEC reste celui de la clôture.
        </AccessNotice>
      ) : null}

      {accounts !== null && accounts.length === 0 && !error ? (
        <EmptyState
          bordered
          icon={Link2}
          title="Aucun compte de tiers à lettrer sur cet exercice"
          description="Les comptes clients (411), fournisseurs (401) et les autres comptes de tiers apparaissent ici dès qu'ils portent des écritures validées."
        />
      ) : error && !data ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3" role="alert">
            <p className="text-sm">{error}</p>
            <Button size="sm" variant="outline" onClick={reload}>
              Réessayer
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {canWrite && status !== 'lettered' && suggestions.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles aria-hidden className="text-muted-foreground size-4" />
                  Propositions de lettrage
                </CardTitle>
                <CardDescription>
                  Des lignes de même montant et de même tiers, ou un tiers soldé. Les règlements rapprochés avec la banque viennent en premier.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <ul className="divide-y rounded-md border">
                  {suggestions.slice(0, 10).map((s) => (
                    <li key={s.lineIds.join('-')} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
                      <div className="min-w-0 text-sm">
                        <p className="flex flex-wrap items-center gap-2">
                          <span>{SUGGESTION_LABELS[s.reason]}</span>
                          {s.auxiliaryAccountNumber ? <span className="font-mono text-xs">{s.auxiliaryAccountNumber}</span> : null}
                          {s.fromReconciliation ? <StatusBadge tone="info">Rapprochement bancaire</StatusBadge> : null}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {s.lineIds
                            .map((id) => lineById.get(id))
                            .filter((line): line is PanelLine => Boolean(line))
                            .map((line) => `n° ${line.entryNumber}`)
                            .join(', ')}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <Amount value={s.amountCents / 100} />
                        <Button size="xs" variant="outline" onClick={() => letter(s.lineIds)} disabled={busy}>
                          Lettrer
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
                <Button size="sm" onClick={autoLetter} disabled={busy} loading={busy}>
                  <Wand2 aria-hidden />
                  {suggestions.length > 1 ? `Lettrer les ${suggestions.length} propositions` : 'Lettrer la proposition'}
                </Button>
              </CardContent>
            </Card>
          ) : null}

          <Card aria-busy={loading || undefined}>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1.5">
                  <CardTitle>
                    {account ? (
                      <>
                        <span className="font-mono">{account.code}</span> {account.label}
                      </>
                    ) : (
                      'Lignes'
                    )}
                  </CardTitle>
                  {data ? (
                    <CardDescription>
                      Solde des lignes affichées <Amount value={data.totals.balanceCents / 100} />. Prochain code&nbsp;:{' '}
                      <span className="font-mono">{data.nextCode}</span>.
                      {data.draftCount > 0 ? ` ${plural(data.draftCount, 'ligne en brouillon', 'lignes en brouillon')}\u00a0: validez les écritures pour les lettrer.` : ''}
                    </CardDescription>
                  ) : null}
                </div>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={status}
                  onValueChange={(value) => {
                    if (value) setStatus(value as Status)
                  }}
                  aria-label="Lignes affichées"
                >
                  {(Object.keys(STATUS_LABELS) as Status[]).map((value) => (
                    <ToggleGroupItem key={value} value={value}>
                      {STATUS_LABELS[value]}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {loading && !data ? (
                <div className="space-y-2" aria-hidden>
                  {[1, 2, 3, 4].map((i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : (
                <LetteringPanel
                  lines={shownLines}
                  companyId={companyId}
                  canWrite={canWrite}
                  onLetter={letter}
                  onUnletter={unletter}
                  busy={busy}
                  empty={
                    status === 'open'
                      ? 'Toutes les lignes de ce compte sont lettrées.'
                      : status === 'lettered'
                        ? 'Aucune ligne lettrée sur ce compte.'
                        : 'Aucune ligne validée sur ce compte.'
                  }
                />
              )}
              {data?.truncated ? (
                <p className="text-muted-foreground text-xs">Seules les 2 000 premières lignes sont affichées&nbsp;: lettrez-les pour voir les suivantes.</p>
              ) : null}
            </CardContent>
          </Card>
        </>
      )}
      {dialog}
    </div>
  )
}
