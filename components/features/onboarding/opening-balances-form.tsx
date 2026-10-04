'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FileUp, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AmountInput } from '@/components/ui/amount-input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AccountCombobox } from '@/components/features/accounting/account-combobox'
import { Amount, EmptyState, formatDisplayDate } from '@/components/shared'
import { checkOpeningLines, OPENING_PRESETS, type OpeningLineInput } from '@/lib/accounting/opening-balance/opening-lines'

interface Account {
  id: string
  code: string
  label: string
}

interface OpeningTarget {
  fiscalYear: { id: string; year: number; startDate: string; endDate: string; isClosed: boolean }
  existingEntry: { id: string; entryNumber: string; status: string } | null
}

interface Row {
  accountCode: string
  label: string
  hint?: string
  debitCents: number | null
  creditCents: number | null
}

/**
 * Guided form for the opening balances (bilan d'ouverture) of a company that
 * existed before Kledg: the usual balance sheet lines are listed with where
 * to find them, other balance sheet accounts can be added, and the totals
 * must balance before the entry is booked (rules in
 * lib/accounting/opening-balance/opening-lines.ts).
 */
export function OpeningBalancesForm({ companyId, canEdit }: { companyId: string; canEdit: boolean }) {
  const router = useRouter()
  const [target, setTarget] = useState<OpeningTarget | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState<string>('')
  const [validate, setValidate] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitErrors, setSubmitErrors] = useState<string[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const targetResponse = await fetch(`/api/companies/${companyId}/opening-balances`)
      if (!targetResponse.ok) throw new Error('target')
      const { target: loaded } = (await targetResponse.json()) as { target: OpeningTarget | null }
      setTarget(loaded)
      if (!loaded) return
      const accountsResponse = await fetch(`/api/accounts?companyId=${companyId}&fiscalYearId=${loaded.fiscalYear.id}`)
      const list = accountsResponse.ok ? ((await accountsResponse.json()) as Account[]) : []
      setAccounts(list)
      const codes = new Set(list.map((a) => a.code))
      setRows(
        OPENING_PRESETS.filter((p) => codes.has(p.accountCode)).map((p) => ({
          accountCode: p.accountCode,
          label: p.label,
          hint: p.hint,
          debitCents: null,
          creditCents: null,
        })),
      )
    } catch {
      setError("Les informations de l'exercice n'ont pas pu être chargées. Réessayez.")
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    void load()
  }, [load])

  const lines: OpeningLineInput[] = useMemo(
    () => rows.map((r) => ({ accountCode: r.accountCode, debitCents: r.debitCents ?? 0, creditCents: r.creditCents ?? 0 })),
    [rows],
  )
  const check = checkOpeningLines(lines)
  const gapCents = check.debitCents - check.creditCents

  const update = (index: number, patch: Partial<Row>) => {
    setSubmitErrors([])
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  const addAccount = (accountId: string) => {
    const account = accounts.find((a) => a.id === accountId)
    setAdding('')
    if (!account || rows.some((r) => r.accountCode === account.code)) return
    setRows((current) => [...current, { accountCode: account.code, label: account.label, debitCents: null, creditCents: null }])
  }

  const submit = async () => {
    if (check.errors.length > 0) {
      setSubmitErrors(check.errors)
      return
    }
    setSubmitting(true)
    try {
      const response = await fetch(`/api/companies/${companyId}/opening-balances`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines: lines.filter((l) => l.debitCents || l.creditCents), validate }),
      })
      const body = (await response.json().catch(() => ({}))) as { id?: string; error?: string }
      if (!response.ok || !body.id) {
        toast.error(body.error || "Les à-nouveaux n'ont pas pu être enregistrés. Réessayez.")
        return
      }
      toast.success(validate ? 'À-nouveaux enregistrés et validés' : 'À-nouveaux enregistrés en brouillon')
      router.push(`/${companyId}/entries/${body.id}`)
    } catch {
      toast.error("Les à-nouveaux n'ont pas pu être enregistrés. Vérifiez votre connexion et réessayez.")
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-96 w-full rounded-lg" />
      </div>
    )
  }

  if (error) {
    return (
      <EmptyState
        bordered
        title="Chargement impossible"
        description={error}
        action={
          <Button size="sm" variant="outline" onClick={() => void load()}>
            Réessayer
          </Button>
        }
      />
    )
  }

  if (!target) {
    return (
      <EmptyState
        bordered
        title="Aucun exercice pour cette société"
        description="Les à-nouveaux se saisissent au premier jour du premier exercice&nbsp;: créez-le d'abord."
        action={
          <Button asChild size="sm">
            <Link href={`/${companyId}/fiscal-years`}>Créer un exercice</Link>
          </Button>
        }
      />
    )
  }

  const { fiscalYear, existingEntry } = target

  if (existingEntry) {
    return (
      <EmptyState
        bordered
        title={`Les à-nouveaux de l'exercice ${fiscalYear.year} sont saisis`}
        description={
          existingEntry.status === 'validated'
            ? `L'écriture n° ${existingEntry.entryNumber} est validée\u00a0: une erreur se corrige par une écriture de contre-passation.`
            : "L'écriture est en brouillon\u00a0: vérifiez-la, corrigez-la si besoin, puis validez-la dans Écritures."
        }
        action={
          <Button asChild size="sm">
            <Link href={`/${companyId}/entries/${existingEntry.id}`}>Voir l&apos;écriture</Link>
          </Button>
        }
      />
    )
  }

  if (fiscalYear.isClosed) {
    return (
      <EmptyState
        bordered
        title={`L'exercice ${fiscalYear.year} est clôturé`}
        description="Ses à-nouveaux ne peuvent plus être saisis."
      />
    )
  }

  return (
    <div className="space-y-6">
      <Alert>
        <AlertTitle className="line-clamp-none">Où trouver les montants</AlertTitle>
        <AlertDescription>
          <p>
            Dans le bilan de clôture de l&apos;exercice précédent (ou sa balance de clôture), remis par votre
            expert-comptable. Le bilan d&apos;ouverture reprend exactement le bilan de clôture, avant l&apos;affectation du
            résultat (Code de commerce, art. L123-19).
          </p>
          <p>
            Ils seront enregistrés dans le journal des à-nouveaux (AN) le {formatDisplayDate(fiscalYear.startDate, 'long')},
            premier jour de l&apos;exercice {fiscalYear.year}.
          </p>
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader className="flex flex-wrap items-start justify-between gap-3 space-y-0">
          <div className="min-w-0 flex-1 basis-64 space-y-1.5">
            <CardTitle>Soldes à reprendre</CardTitle>
            <CardDescription>
              Laissez vides les lignes sans solde. Un compte d&apos;actif (banque, clients) a un solde au débit, un compte de
              passif (capital, fournisseurs, emprunts) au crédit.
            </CardDescription>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href={`/${companyId}/import`}>
              <FileUp aria-hidden />
              Importer un FEC à la place
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table containerClassName="rounded-lg border">
            <TableHeader>
              <TableRow>
                <TableHead>Compte</TableHead>
                <TableHead numeric className="w-32">
                  Débit
                </TableHead>
                <TableHead numeric className="w-32">
                  Crédit
                </TableHead>
                <TableHead className="w-10">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, index) => (
                <TableRow key={row.accountCode}>
                  <TableCell className="min-w-44 whitespace-normal">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-xs">{row.accountCode}</span>
                      <span className="text-sm">{row.label}</span>
                    </div>
                    {row.hint ? <p className="text-muted-foreground text-xs">{row.hint}</p> : null}
                  </TableCell>
                  <TableCell numeric>
                    <AmountInput
                      aria-label={`Débit du compte ${row.accountCode}`}
                      value={row.debitCents}
                      onValueChange={(cents) => update(index, { debitCents: cents })}
                      disabled={!canEdit}
                      className="w-28 text-right"
                    />
                  </TableCell>
                  <TableCell numeric>
                    <AmountInput
                      aria-label={`Crédit du compte ${row.accountCode}`}
                      value={row.creditCents}
                      onValueChange={(cents) => update(index, { creditCents: cents })}
                      disabled={!canEdit}
                      className="w-28 text-right"
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="hover:text-destructive"
                      aria-label={`Retirer le compte ${row.accountCode}`}
                      title="Retirer la ligne"
                      onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                      disabled={!canEdit}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-medium">Total</TableCell>
                <TableCell numeric>
                  <Amount value={check.debitCents / 100} />
                </TableCell>
                <TableCell numeric>
                  <Amount value={check.creditCents / 100} />
                </TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>

          <p className={gapCents === 0 ? 'text-muted-foreground text-sm' : 'text-destructive text-sm'} aria-live="polite">
            {gapCents === 0 ? (
              check.debitCents > 0 ? 'Le bilan d’ouverture est équilibré.' : 'Saisissez les soldes du dernier bilan.'
            ) : (
              <>
                Écart de <Amount value={Math.abs(gapCents) / 100} /> : il manque cette somme au {gapCents > 0 ? 'crédit' : 'débit'}.
              </>
            )}
          </p>

          {canEdit ? (
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="add-account" className="sr-only">
                Ajouter un compte de bilan
              </Label>
              <AccountCombobox
                id="add-account"
                accounts={accounts}
                value={adding}
                onValueChange={addAccount}
                accountClasses={[1, 2, 3, 4, 5]}
                placeholder="Ajouter un compte (classes 1 à 5)"
                className="w-full max-w-sm"
                excludeAccountIds={accounts.filter((a) => rows.some((r) => r.accountCode === a.code)).map((a) => a.id)}
              />
            </div>
          ) : null}
        </CardContent>
      </Card>

      {submitErrors.length > 0 ? (
        <Alert variant="destructive">
          <AlertTitle>À corriger avant d&apos;enregistrer</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-5">
              {submitErrors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {canEdit ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <Checkbox id="validate-opening" checked={validate} onCheckedChange={(checked) => setValidate(checked === true)} />
            <div className="space-y-1">
              <Label htmlFor="validate-opening" className="font-normal">
                Valider l&apos;écriture tout de suite
              </Label>
              <p className="text-muted-foreground text-sm">
                Une écriture validée ne se modifie plus (PCG art. 1031-3). Laissez-la en brouillon pour la vérifier dans
                Écritures, puis validez-la.
              </p>
            </div>
          </div>
          <Button onClick={() => void submit()} loading={submitting} disabled={check.debitCents === 0}>
            Enregistrer les à-nouveaux
          </Button>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">Votre rôle permet de consulter cette page, pas de saisir des écritures.</p>
      )}
    </div>
  )
}
