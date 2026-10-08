/**
 * Configuration page: the administrator sees the secrets still sealed in the
 * legacy encryption format (unreadable by Kledg 0.4) and how to seal them
 * again; nothing once every value is current.
 */

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LegacySecretsRow } from '../legacy-secrets-row'

const none = { total: 0, bankConnections: 0, integrationFields: 0, updateTokens: 0 }

describe('LegacySecretsRow', () => {
  it('shows nothing when every value is in the current format, or when the check failed', () => {
    const { container, rerender } = render(<ul><LegacySecretsRow counts={none} docHref="#doc" /></ul>)
    expect(container.querySelector('li')).toBeNull()
    rerender(<ul><LegacySecretsRow counts={null} docHref="#doc" /></ul>)
    expect(container.querySelector('li')).toBeNull()
  })

  it('warns with the count, the kinds and what to do', () => {
    render(<ul><LegacySecretsRow counts={{ total: 3, bankConnections: 1, integrationFields: 1, updateTokens: 1 }} docHref="#doc" /></ul>)
    expect(screen.getByText('À chiffrer de nouveau')).toBeInTheDocument()
    expect(screen.getByText(/3 valeurs chiffrées restent dans l.ancien format \(accès bancaires et jeton GitHub\), que Kledg 0\.4/)).toBeInTheDocument()
    expect(screen.getByText('pnpm secrets:reencrypt')).toBeInTheDocument()
    expect(screen.getByText(/ou GitHub dans Mises à jour/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Ancien format de chiffrement/ })).toHaveAttribute('href', '#doc')
  })
})
