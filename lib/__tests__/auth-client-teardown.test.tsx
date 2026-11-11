/**
 * Better Auth's session store stays mounted for a second after its last
 * listener leaves; unmountAuthClientStores (run by vitest.setup.ts after each
 * file) unmounts it at once, before jsdom is torn down.
 */
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { authClient } from '@/lib/auth-client'
import { authClientSessionStore, unmountAuthClientStores } from './helpers/auth-client-stores'

function SessionReader() {
  const { data } = authClient.useSession()
  return <p>{data ? 'connecté' : 'anonyme'}</p>
}

describe('auth client stores in tests', () => {
  it('finds the session store of the auth client', () => {
    expect(authClientSessionStore()).toBe(authClient.$store.atoms.session)
  })

  it('unmounts the session store at once instead of a second after its last listener', () => {
    const { unmount, getByText } = render(<SessionReader />)
    expect(getByText('anonyme')).toBeInTheDocument()
    unmount()
    // Still mounted: nanostores waits a second before unmounting it
    expect(authClientSessionStore()?.active).toBe(true)
    unmountAuthClientStores()
    expect(authClientSessionStore()?.active).toBe(false)
  })
})
