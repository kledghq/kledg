import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const nav = vi.hoisted(() => ({ search: new URLSearchParams(), push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }))
const auth = vi.hoisted(() => ({
  session: null as { user: { email: string } } | null,
  signIn: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, refresh: nav.refresh }),
  useSearchParams: () => nav.search,
}))
vi.mock('@/lib/auth-client', () => ({
  authClient: { useSession: () => ({ data: auth.session }), signIn: { email: auth.signIn } },
}))

import { LoginForm } from '../login-form'

beforeEach(() => {
  nav.search = new URLSearchParams()
  auth.session = null
  auth.signIn.mockResolvedValue({ data: { redirect: false }, error: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

async function signIn(email = 'marie@acme.fr', password = 'secret-password') {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Email'), email)
  await user.type(screen.getByLabelText('Mot de passe'), password)
  await user.click(screen.getByRole('button', { name: 'Se connecter' }))
}

describe('LoginForm', () => {
  it('signs in and goes to the requested same-origin page', async () => {
    nav.search = new URLSearchParams({ redirect: '/alpha/entries?status=draft' })
    render(<LoginForm extra={<p>Bandeau de l’instance</p>} />)
    expect(screen.getByText('Bandeau de l’instance')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Mot de passe oublié ?' })).toHaveAttribute('href', '/forgot-password')
    await signIn()
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/alpha/entries?status=draft'))
    expect(auth.signIn).toHaveBeenCalledWith({ email: 'marie@acme.fr', password: 'secret-password' })
    expect(nav.refresh).toHaveBeenCalled()
  })

  it.each(['https://evil.example/phish', '//evil.example', '/\\evil.example'])(
    'never redirects to another site (%s)',
    async (redirect) => {
      nav.search = new URLSearchParams({ redirect })
      render(<LoginForm />)
      await signIn()
      await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/'))
    },
  )

  it('shows the sign-in error and stays on the page', async () => {
    auth.signIn.mockResolvedValue({ data: null, error: { message: 'Email ou mot de passe incorrect' } })
    render(<LoginForm />)
    await signIn()
    expect(await screen.findByText('Email ou mot de passe incorrect')).toBeInTheDocument()
    expect(nav.push).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Se connecter' })).toBeEnabled()
  })

  it('continues an OAuth authorization at the URL the server returns', async () => {
    const location = { href: 'http://localhost/login' }
    vi.stubGlobal('location', location)
    auth.signIn.mockResolvedValue({ data: { url: 'http://localhost/consent?client_id=abc', redirect: true }, error: null })
    render(<LoginForm />)
    await signIn()
    await waitFor(() => expect(location.href).toBe('http://localhost/consent?client_id=abc'))
    expect(nav.push).not.toHaveBeenCalled()
  })

  it('shows an error passed in the URL, then removes it from the address', async () => {
    nav.search = new URLSearchParams({ error: 'Lien expiré' })
    render(<LoginForm />)
    expect(await screen.findByText('Lien expiré')).toBeInTheDocument()
    expect(nav.replace).toHaveBeenCalledWith('/login')
  })

  it('shows an error containing a percent sign without crashing', async () => {
    nav.search = new URLSearchParams({ error: 'Remise de 100% refusée' })
    render(<LoginForm />)
    expect(await screen.findByText('Remise de 100% refusée')).toBeInTheDocument()
  })

  it('sends a signed-in user on to the requested page, except during an OAuth authorization', async () => {
    auth.session = { user: { email: 'marie@acme.fr' } }
    nav.search = new URLSearchParams({ redirect: '/settings/profile' })
    const { unmount } = render(<LoginForm />)
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/settings/profile'))
    unmount()
    nav.replace.mockClear()
    nav.search = new URLSearchParams({ client_id: 'abc', redirect: '/settings/profile' })
    render(<LoginForm />)
    expect(screen.getByRole('heading', { name: 'Connexion' })).toBeInTheDocument()
    expect(nav.replace).not.toHaveBeenCalled()
  })
})
