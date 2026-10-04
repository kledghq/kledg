'use client'

import { useState, useEffect } from 'react'

import { AccountDetails } from '@/components/features/accounting/account-details'
import { Skeleton } from '@/components/ui/skeleton'
import { NoCompanySelected } from '@/components/features/companies/no-company-selected'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { useParams } from 'next/navigation'
import { logger } from '@/lib/logger'
import { AccountCombobox } from '@/components/features/accounting/account-combobox'
import { FiscalYearSelector } from '@/components/features/accounting/fiscal-year-selector'
import { PageHeader } from '@/components/shared'
import { docsUrl } from '@/lib/docs-links'
import type { Prisma } from '@prisma/client'

type Account = Prisma.AccountGetPayload<{}>

export default function AccountsPage() {
  const params = useParams()
  const companyId = params?.companyId as string
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<string>('none')
  const [selectedFiscalYearId, setSelectedFiscalYearId] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (companyId && selectedFiscalYearId) {
      loadAccounts()
    }
  }, [companyId, selectedFiscalYearId])

  const loadAccounts = async () => {
    if (!companyId || !selectedFiscalYearId) return

    setLoading(true)
    try {
      const response = await fetch(`/api/accounts?companyId=${companyId}&fiscalYearId=${selectedFiscalYearId}`)
      if (response.ok) {
        const data = await response.json()
        setAccounts(data)
      }
    } catch (error) {
      logger.error('Error loading accounts:', error)
    } finally {
      setLoading(false)
    }
  }

  if (!companyId) {
    return (
      <NoCompanySelected
        description="Veuillez sélectionner une société pour voir les comptes"
      />
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Comptes"
        description="Choisissez un compte pour voir son solde, son évolution et ses écritures sur l'exercice."
        docsHref={docsUrl('chartOfAccounts')}
      />

      <Card>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
            <FiscalYearSelector
              companyId={companyId}
              value={selectedFiscalYearId}
              onValueChange={setSelectedFiscalYearId}
            />

            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-9 w-full" />
              </div>
            ) : !selectedFiscalYearId ? (
              <p className="text-muted-foreground self-center text-sm">
                Choisissez un exercice pour afficher ses comptes.
              </p>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="account-combobox">Compte</Label>
                  <p className="text-muted-foreground text-xs">
                    <span className="num">{accounts.length}</span> compte{accounts.length > 1 ? 's' : ''}
                  </p>
                </div>
                <AccountCombobox
                  accounts={accounts}
                  value={selectedAccountId || 'none'}
                  onValueChange={(value) => {
                    setSelectedAccountId(value)
                  }}
                  placeholder="Rechercher par numéro ou libellé (ex. 512, banque)"
                  showNoneOption
                  noneOptionLabel="Aucun compte sélectionné"
                  className="w-full"
                  id="account-combobox"
                />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {selectedAccountId && selectedAccountId !== 'none' && (
        <AccountDetails
          accountId={selectedAccountId}
          onAccountDeleted={async () => {
            await loadAccounts()
            setSelectedAccountId('none')
          }}
        />
      )}
    </div>
  )
}
