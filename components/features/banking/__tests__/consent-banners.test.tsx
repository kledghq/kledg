import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}))

import { PONTO_DASHBOARD_URL } from '@/lib/banking/links'
import { ConsentBanners } from '../consent-banners'
import { bankAccount } from './bank-account-fixture'

/**
 * PSD2 access to account data must be renewed by the user (Commission
 * Delegated Regulation (EU) 2018/389, art. 10, amended by 2022/2360: 180
 * days); Kledg warns 14 and 3 days before expiry (lib/banking/consent.ts).
 * `now` is injected so the day counts are deterministic.
 */
const NOW = new Date('2026-10-04T12:00:00.000Z')

const revolut = { id: 'conn-r', provider: 'REVOLUT', status: 'active' }

describe('ConsentBanners', () => {
  it('renders nothing while every consent is valid for more than 14 days, absent or superseded', () => {
    const { container } = render(
      <ConsentBanners
        companyId="co-1"
        now={NOW}
        accounts={[
          bankAccount({ consentExpiresAt: '2026-10-19T12:00:00.000Z' }),
          bankAccount({ id: 'ba-2', consentExpiresAt: null }),
          bankAccount({
            id: 'ba-3',
            consentExpiresAt: '2026-10-01T00:00:00.000Z',
            supersededBy: { id: 'ba-9', name: 'Compte courant', provider: 'QONTO' },
          }),
        ]}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('warns 14 days ahead with the date, the days left and the Ponto dashboard', () => {
    render(
      <ConsentBanners
        companyId="co-1"
        now={NOW}
        accounts={[bankAccount({ consentExpiresAt: '2026-10-15T12:00:00.000Z', institution: { name: 'BNP Paribas', logoUrl: null } })]}
      />,
    )
    const alert = screen.getByRole('alert')
    expect(within(alert).getByText("L'accès à BNP Paribas expire le 15 octobre 2026 (dans 11 jours)")).toBeInTheDocument()
    expect(within(alert).getByText(/Renouvelez-le dans Ponto pour que la synchronisation continue/)).toBeInTheDocument()
    const link = within(alert).getByRole('link', { name: 'Renouveler dans Ponto' })
    expect(link).toHaveAttribute('href', PONTO_DASHBOARD_URL)
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('says "1 jour" on the last day and sends Revolut users to the Kledg authorization', () => {
    render(
      <ConsentBanners
        companyId="co-1"
        now={NOW}
        accounts={[bankAccount({ consentExpiresAt: '2026-10-05T06:00:00.000Z', bankConnection: revolut, institution: { name: 'Revolut Ltd', logoUrl: null } })]}
      />,
    )
    // Revolut is always named "Revolut Business", whatever the institution says
    expect(screen.getByText("L'accès à Revolut Business expire le 5 octobre 2026 (dans 1 jour)")).toBeInTheDocument()
    expect(screen.getByText(/Renouvelez-le dans Revolut Business/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Autoriser de nouveau' })).toHaveAttribute('href', '/co-1/banking/connect/revolut')
  })

  it('shows an expired access as stale since the expiry date, with an import fallback', () => {
    render(
      <ConsentBanners
        companyId="co-1"
        now={NOW}
        accounts={[bankAccount({ consentExpiresAt: '2026-10-01T09:00:00.000Z', displayName: 'Compte pro' })]}
      />,
    )
    const alert = screen.getByRole('alert')
    // No institution: the account name stands for the bank
    expect(within(alert).getByText("Compte pro : données à jour jusqu'au 1 octobre 2026")).toBeInTheDocument()
    expect(within(alert).getByText(/les nouvelles opérations n'arrivent plus/)).toBeInTheDocument()
    expect(within(alert).getByText(/En attendant, vous pouvez importer un relevé/)).toBeInTheDocument()
    expect(within(alert).getByRole('link', { name: 'Renouveler dans Ponto' })).toBeInTheDocument()
  })

  it('shows one banner per bank and expiry, not one per account', () => {
    const bnp = { name: 'BNP Paribas', logoUrl: null }
    render(
      <ConsentBanners
        companyId="co-1"
        now={NOW}
        accounts={[
          bankAccount({ id: 'ba-1', consentExpiresAt: '2026-10-10T00:00:00.000Z', institution: bnp }),
          bankAccount({ id: 'ba-2', name: 'Livret', consentExpiresAt: '2026-10-10T00:00:00.000Z', institution: bnp }),
          bankAccount({ id: 'ba-3', consentExpiresAt: '2026-10-02T00:00:00.000Z', bankConnection: revolut }),
        ]}
      />,
    )
    const alerts = screen.getAllByRole('alert')
    expect(alerts).toHaveLength(2)
    expect(within(alerts[0]).getByText("L'accès à BNP Paribas expire le 10 octobre 2026 (dans 6 jours)")).toBeInTheDocument()
    expect(within(alerts[1]).getByText("Revolut Business : données à jour jusqu'au 2 octobre 2026")).toBeInTheDocument()
    expect(within(alerts[1]).getByText(/Renouvelez l'accès dans Revolut Business, puis actualisez/)).toBeInTheDocument()
  })
})
