'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ChevronLeft, ChevronRight, Download, ExternalLink, FileText, RefreshCw, Upload } from 'lucide-react'

import { logger } from '@/lib/logger'
import { currentStatementPeriod, isStatementMonth } from '@/lib/banking/statement-period'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow, TableSkeleton } from '@/components/ui/table'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { NoCompanySelected } from '@/components/features/companies/no-company-selected'
import { EmptyState, Field, formatDisplayDate, PageHeader } from '@/components/shared'
import { StatementImportDialog } from '@/components/features/banking/statement-import-dialog'
import { ConnectBankButton } from '@/components/features/banking/connect-bank-button'
import { useCompanyAccess } from '@/components/features/companies/company-access'
import { bankAccountName, formatFileSize, ibanTail, plural, statementMonth } from '@/components/features/banking/format'
import { responseError, type BankAccountRow, type BankConnectionRow } from '@/components/features/banking/types'
import { docsUrl } from '@/lib/docs-links'
import type { QontoAccount, QontoStatement } from '@/lib/integrations/providers/qonto/types'

interface StatementsResponse {
  statements: QontoStatement[]
  meta: {
    current_page: number
    next_page: number | null
    prev_page: number | null
    total_pages: number
    total_count: number
    per_page: number
  }
}

const PER_PAGE = 20
const ALL = 'all'

/** "oct. 2026" for a Qonto period "10-2026" (the raw period when malformed). */
function periodLabel(period: string): string {
  const month = statementMonth(period)
  return month ? formatDisplayDate(month, 'month') : period
}

export default function StatementsPage() {
  const params = useParams()
  const companyId = params?.companyId as string
  const { can, denied } = useCompanyAccess()
  const canImport = can({ banking: ['reconcile'] })
  // null until the bank connections are known: Qonto statements need a Qonto connection
  const [qontoConnected, setQontoConnected] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [statements, setStatements] = useState<QontoStatement[]>([])
  const [meta, setMeta] = useState<StatementsResponse['meta'] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedStatement, setSelectedStatement] = useState<QontoStatement | null>(null)
  const [qontoAccounts, setQontoAccounts] = useState<QontoAccount[]>([])
  // Read by the statements query without refetching when the list arrives (Qonto calls are rate limited)
  const qontoAccountsRef = useRef<QontoAccount[]>([])
  useEffect(() => {
    qontoAccountsRef.current = qontoAccounts
  }, [qontoAccounts])
  const [bankAccounts, setBankAccounts] = useState<BankAccountRow[]>([])
  const [selectedIban, setSelectedIban] = useState<string>(ALL)
  // Default to the current year so the list is not empty on a first visit.
  const [periodFrom, setPeriodFrom] = useState<string>(() => currentStatementPeriod().from)
  const [periodTo, setPeriodTo] = useState<string>(() => currentStatementPeriod().to)
  const [currentPage, setCurrentPage] = useState(1)
  const [importOpen, setImportOpen] = useState(false)

  const loadAccounts = useCallback(async () => {
    if (!companyId) return
    try {
      const [accountsResponse, connectionsResponse] = await Promise.all([
        fetch(`/api/banking/accounts?companyId=${companyId}`),
        fetch(`/api/banking/connections?companyId=${companyId}`),
      ])
      if (accountsResponse.ok) {
        setBankAccounts(((await accountsResponse.json()) as { accounts?: BankAccountRow[] }).accounts ?? [])
      }
      const connections = connectionsResponse.ok
        ? (((await connectionsResponse.json()) as { connections?: BankConnectionRow[] }).connections ?? [])
        : []
      const connected = connections.some((c) => c.provider === 'QONTO' && c.integration?.status === 'active')
      setQontoConnected(connected)
      if (connected) {
        const response = await fetch(`/api/qonto/accounts?companyId=${companyId}`)
        if (response.ok) setQontoAccounts(((await response.json()) as { accounts?: QontoAccount[] }).accounts ?? [])
      } else {
        setLoading(false)
      }
    } catch (err) {
      logger.error('Error loading bank accounts:', err)
      setQontoConnected(false)
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    void loadAccounts()
  }, [loadAccounts])

  const loadStatements = useCallback(async () => {
    if (!companyId || !qontoConnected) return
    setLoading(true)
    setError(null)
    try {
      const query = new URLSearchParams()
      query.append('companyId', companyId)
      query.append('page', currentPage.toString())
      query.append('perPage', PER_PAGE.toString())
      query.append('sortBy', 'period:desc')
      if (selectedIban !== ALL) {
        const account = qontoAccountsRef.current.find((acc) => acc.iban === selectedIban)
        // Qonto filters by bank account id (its slug), not by IBAN
        if (account) query.append('bank_account_ids[]', account.slug)
      }
      // Months still being typed ("03-20") are ignored until complete.
      if (isStatementMonth(periodFrom)) query.append('period_from', periodFrom.trim())
      if (isStatementMonth(periodTo)) query.append('period_to', periodTo.trim())

      const response = await fetch(`/api/qonto/statements?${query.toString()}`)
      if (!response.ok) {
        setError(await responseError(response, "Les relevés Qonto n'ont pas pu être chargés. Réessayez."))
        return
      }
      const data = (await response.json()) as StatementsResponse
      setStatements(data.statements ?? [])
      setMeta(data.meta ?? null)
    } catch (err) {
      logger.error('Error loading statements:', err)
      setError("Les relevés Qonto n'ont pas pu être chargés. Vérifiez votre connexion puis réessayez.")
    } finally {
      setLoading(false)
    }
  }, [companyId, qontoConnected, currentPage, selectedIban, periodFrom, periodTo])

  useEffect(() => {
    void loadStatements()
  }, [loadStatements])

  const download = (statement: QontoStatement) => {
    if (statement.file?.file_url) window.open(statement.file.file_url, '_blank', 'noopener')
  }

  /** Kledg name of the account a statement belongs to (statements carry Qonto's account slug). */
  const accountNameOfSlug = (slug: string) => {
    const qontoAccount = qontoAccounts.find((acc) => acc.slug === slug)
    if (!qontoAccount) return bankAccountName({ name: slug, displayName: null, iban: null })
    return accountNameOfIban(qontoAccount.iban, slug)
  }

  const accountNameOfIban = (iban: string, slug: string) => {
    const bankAccount = bankAccounts.find((acc) => acc.iban === iban)
    return bankAccountName(bankAccount ?? { name: slug, displayName: null, iban })
  }

  if (!companyId) {
    return <NoCompanySelected />
  }

  const importDialog = (
    <StatementImportDialog
      companyId={companyId}
      accounts={bankAccounts}
      open={importOpen}
      onOpenChange={setImportOpen}
    />
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Relevés"
        description="Importez le relevé exporté depuis l'espace en ligne de votre banque (CSV, Excel, OFX ou camt.053)&nbsp;: ses opérations rejoignent les transactions du compte. Les relevés mensuels des banques connectées qui les fournissent se consultent ici."
        docsHref={docsUrl('importStatement')}
        actions={
          <>
            {qontoConnected ? (
              <Button onClick={() => void loadStatements()} loading={loading} variant="outline">
                <RefreshCw aria-hidden />
                Actualiser
              </Button>
            ) : null}
            {importDialog}
          </>
        }
      />

      {qontoConnected === false ? (
        <EmptyState
          bordered
          icon={FileText}
          title="Aucun relevé de banque connectée"
          description="Les relevés mensuels (PDF) apparaissent ici quand une banque connectée les fournit (Qonto aujourd'hui). Pour toute banque, exportez le relevé depuis son espace en ligne (CSV, Excel, OFX ou camt.053) et importez-le&nbsp;: ses opérations rejoignent les transactions du compte."
          action={
            <Button
              size="sm"
              onClick={() => setImportOpen(true)}
              disabled={!canImport}
              title={canImport ? undefined : denied('importer un relevé')}
            >
              <Upload aria-hidden />
              Importer un relevé
            </Button>
          }
          secondaryAction={
            <ConnectBankButton companyId={companyId} size="sm" variant="outline" />
          }
          docsHref={docsUrl('importStatement')}
          docsLabel="Formats acceptés"
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Compte bancaire" htmlFor="statements-account">
              <Select
                value={selectedIban}
                onValueChange={(value) => {
                  setSelectedIban(value)
                  setCurrentPage(1)
                }}
              >
                <SelectTrigger id="statements-account" className="w-full min-w-0">
                  <SelectValue placeholder="Tous les comptes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Tous les comptes</SelectItem>
                  {qontoAccounts.map((account) => {
                    const name = accountNameOfIban(account.iban, account.slug)
                    return (
                      <SelectItem key={account.iban} value={account.iban}>
                        {name}
                        {!name.endsWith(ibanTail(account.iban)) ? (
                          <span className="text-muted-foreground font-mono text-xs">{ibanTail(account.iban)}</span>
                        ) : null}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Du mois (mm-aaaa)">
              <Input
                inputMode="numeric"
                placeholder="ex. 01-2026"
                value={periodFrom}
                onChange={(e) => {
                  setPeriodFrom(e.target.value)
                  setCurrentPage(1)
                }}
              />
            </Field>
            <Field label="Au mois (mm-aaaa)">
              <Input
                inputMode="numeric"
                placeholder="ex. 12-2026"
                value={periodTo}
                onChange={(e) => {
                  setPeriodTo(e.target.value)
                  setCurrentPage(1)
                }}
              />
            </Field>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Relevés Qonto</CardTitle>
              <CardDescription aria-live="polite">
                {loading || !meta ? 'Chargement des relevés' : `${plural(meta.total_count, 'relevé')} sur la période`}
              </CardDescription>
            </CardHeader>
            <CardContent aria-busy={loading || undefined} className="space-y-4">
              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>
                    <p>{error}</p>
                    <Button size="sm" variant="outline" onClick={() => void loadStatements()}>
                      Réessayer
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : null}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Période</TableHead>
                    <TableHead>Compte bancaire</TableHead>
                    <TableHead>Fichier</TableHead>
                    <TableHead numeric>Taille</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading || qontoConnected === null ? (
                    <TableSkeleton columns={5} rows={4} />
                  ) : statements.length === 0 ? (
                    <TableEmpty colSpan={5}>
                      Aucun relevé sur cette période. Élargissez la période, ou importez un relevé d&apos;une autre banque.
                    </TableEmpty>
                  ) : (
                    statements.map((statement) => (
                      <TableRow key={statement.id}>
                        <TableCell className="num font-medium whitespace-nowrap">{periodLabel(statement.period)}</TableCell>
                        <TableCell>{accountNameOfSlug(statement.bank_account_id)}</TableCell>
                        <TableCell className="max-w-xs truncate" title={statement.file.file_name}>
                          {statement.file.file_name}
                        </TableCell>
                        <TableCell numeric className="text-muted-foreground">
                          {formatFileSize(Number.parseInt(statement.file.file_size, 10))}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="outline" size="xs" onClick={() => setSelectedStatement(statement)}>
                              Voir
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Télécharger le relevé de ${periodLabel(statement.period)}`}
                              title="Télécharger"
                              onClick={() => download(statement)}
                            >
                              <Download aria-hidden />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>

              {meta && meta.total_pages > 1 && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-muted-foreground text-sm">
                    Page <span className="num">{meta.current_page}</span> sur <span className="num">{meta.total_pages}</span>
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={!meta.prev_page || loading}
                    >
                      <ChevronLeft aria-hidden />
                      Précédent
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage((p) => p + 1)}
                      disabled={!meta.next_page || loading}
                    >
                      Suivant
                      <ChevronRight aria-hidden />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={selectedStatement !== null} onOpenChange={(open) => !open && setSelectedStatement(null)}>
        {selectedStatement ? (
          <DialogContent className="sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle>Relevé de {periodLabel(selectedStatement.period)}</DialogTitle>
              <DialogDescription>
                {accountNameOfSlug(selectedStatement.bank_account_id)}, fichier {selectedStatement.file.file_name}
              </DialogDescription>
            </DialogHeader>
            {selectedStatement.file.file_content_type?.includes('pdf') ? (
              <div className="bg-muted h-[60vh] w-full overflow-hidden rounded-md border">
                <iframe
                  src={`/api/qonto/statements/${selectedStatement.id}/proxy?companyId=${companyId}#toolbar=1&navpanes=1&scrollbar=1`}
                  className="h-full w-full border-0"
                  title={`Relevé de ${periodLabel(selectedStatement.period)}`}
                />
              </div>
            ) : (
              <EmptyState
                icon={FileText}
                title="Aperçu indisponible pour ce type de fichier"
                description="Téléchargez le fichier pour l'ouvrir avec l'application adaptée."
              />
            )}
            <DialogFooter>
              {selectedStatement.file.file_content_type?.includes('pdf') ? (
                <Button
                  variant="outline"
                  onClick={() =>
                    window.open(`/api/qonto/statements/${selectedStatement.id}/proxy?companyId=${companyId}`, '_blank', 'noopener')
                  }
                >
                  <ExternalLink aria-hidden />
                  Ouvrir dans un nouvel onglet
                </Button>
              ) : null}
              <Button onClick={() => download(selectedStatement)}>
                <Download aria-hidden />
                Télécharger
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  )
}
