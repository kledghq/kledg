/**
 * A test file that mounts Better Auth's session store and ends within a
 * second: the store's delayed unmount must not run after jsdom is torn down
 * ("window is not defined", vitest.setup.ts).
 */
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { authClient } from '@/lib/auth-client'

function SessionReader() {
  const { data } = authClient.useSession()
  return <p>{data ? 'connecté' : 'anonyme'}</p>
}

describe('auth client in a short test file', () => {
  it('mounts the session store and leaves right away', () => {
    const { unmount, getByText } = render(<SessionReader />)
    expect(getByText('anonyme')).toBeInTheDocument()
    unmount()
  })
})
