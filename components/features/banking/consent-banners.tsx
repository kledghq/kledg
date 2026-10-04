'use client'

import Link from 'next/link'
import { AlertTriangle, Clock, ExternalLink } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { formatDisplayDate } from '@/components/shared'
import { consentStatus } from '@/lib/banking/consent'
import { PONTO_DASHBOARD_URL } from '@/lib/banking/links'
import { bankAccountName } from './format'
import type { BankAccountRow } from './types'

interface ConsentBannersProps {
  companyId: string
  accounts: BankAccountRow[]
  now?: Date
}

interface Banner {
  key: string
  bank: string
  provider: string
  level: 'soon' | 'urgent' | 'expired'
  date: string
  daysLeft: number | null
}

/**
 * Bank access (PSD2 consent) about to expire or expired: a warning 14 days
 * and 3 days before, then "à jour jusqu'au" once expired, with the place to
 * renew it (Ponto dashboard, or the Revolut authorization in Kledg).
 */
export function ConsentBanners({ companyId, accounts, now }: ConsentBannersProps) {
  const banners = new Map<string, Banner>()
  for (const account of accounts) {
    if (account.supersededBy || !account.consentExpiresAt) continue
    const status = consentStatus(account.consentExpiresAt, now)
    if (status.level !== 'soon' && status.level !== 'urgent' && status.level !== 'expired') continue
    const provider = account.bankConnection.provider
    const bank = provider === 'REVOLUT' ? 'Revolut Business' : account.institution?.name || bankAccountName(account)
    const key = `${provider}:${bank}:${account.consentExpiresAt}`
    if (!banners.has(key)) {
      banners.set(key, { key, bank, provider, level: status.level, date: account.consentExpiresAt, daysLeft: status.daysLeft })
    }
  }
  if (banners.size === 0) return null

  return (
    <div className="space-y-3">
      {[...banners.values()].map((banner) => {
        const renew =
          banner.provider === 'REVOLUT' ? (
            <Button asChild size="sm" variant="outline">
              <Link href={`/${companyId}/banking/connect/revolut`}>Autoriser de nouveau</Link>
            </Button>
          ) : (
            <Button asChild size="sm" variant="outline">
              <a href={PONTO_DASHBOARD_URL} target="_blank" rel="noreferrer">
                Renouveler dans Ponto
                <ExternalLink aria-hidden />
              </a>
            </Button>
          )
        const where = banner.provider === 'REVOLUT' ? 'dans Revolut Business' : 'dans Ponto'
        return banner.level === 'expired' ? (
          <Alert key={banner.key} variant="destructive">
            <AlertTriangle aria-hidden />
            <AlertTitle className="line-clamp-none">
              {banner.bank} : données à jour jusqu&apos;au {formatDisplayDate(banner.date, 'long')}
            </AlertTitle>
            <AlertDescription>
              <p>
                L&apos;accès à votre banque a expiré&nbsp;: les nouvelles opérations n&apos;arrivent plus. Renouvelez
                l&apos;accès {where}, puis actualisez. En attendant, vous pouvez importer un relevé.
              </p>
              <div className="mt-2">{renew}</div>
            </AlertDescription>
          </Alert>
        ) : (
          <Alert key={banner.key}>
            <Clock aria-hidden />
            <AlertTitle className="line-clamp-none">
              L&apos;accès à {banner.bank} expire le {formatDisplayDate(banner.date, 'long')}
              {banner.daysLeft !== null ? ` (dans ${banner.daysLeft} jour${banner.daysLeft > 1 ? 's' : ''})` : ''}
            </AlertTitle>
            <AlertDescription>
              <p>
                La réglementation bancaire (DSP2) demande de renouveler régulièrement l&apos;accès à vos comptes.
                Renouvelez-le {where} pour que la synchronisation continue.
              </p>
              <div className="mt-2">{renew}</div>
            </AlertDescription>
          </Alert>
        )
      })}
    </div>
  )
}
