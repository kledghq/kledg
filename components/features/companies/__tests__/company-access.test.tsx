import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}))

import { grantedPermissions } from '@/lib/rbac/granted-permissions'
import { ConnectBankButton } from '@/components/features/banking/connect-bank-button'
import { ManualAccountDialog } from '@/components/features/banking/manual-account-dialog'
import { CompanyAccessProvider } from '../company-access'

function asRole(role: string, children: React.ReactNode) {
  return (
    <CompanyAccessProvider value={{ granted: grantedPermissions([role], false), roleLabel: role === 'accountant' ? 'Comptable' : 'Administrateur' }}>
      {children}
    </CompanyAccessProvider>
  )
}

describe('bank actions by role', () => {
  it('disables Connecter une banque and Ajouter un compte for an accountant, with the reason', () => {
    render(
      asRole(
        'accountant',
        <>
          <ConnectBankButton companyId="atelier" />
          <ManualAccountDialog companyId="atelier" />
        </>,
      ),
    )
    const connect = screen.getByRole('button', { name: 'Connecter une banque' })
    expect(connect).toHaveProperty('disabled', true)
    expect(connect.getAttribute('title')).toMatch(/^Votre rôle \(Comptable\) ne permet pas de connecter une banque/)
    expect(screen.getByRole('button', { name: /Ajouter un compte bancaire/ })).toHaveProperty('disabled', true)
  })

  it('links to the connection page for a company administrator', () => {
    render(asRole('companyAdmin', <ConnectBankButton companyId="atelier" />))
    expect(screen.getByRole('link', { name: 'Connecter une banque' }).getAttribute('href')).toBe('/atelier/banking/connect')
  })
})
