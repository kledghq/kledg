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

  it('explains in French that the address must be confirmed first (instances that require it)', async () => {
    auth.signIn.mockResolvedValue({ data: null, error: { code: 'EMAIL_NOT_VERIFIED', message: 'Email not verified' } })
    render(<LoginForm />)
    await signIn()
    const message = await screen.findByText(/^Confirmez d’abord votre adresse email/)
    expect(message.textContent).toBe('Confirmez d’abord votre adresse email\u00a0: nous venons de vous renvoyer le lien de confirmation.')
    expect(nav.push).not.toHaveBeenCalled()
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

  it('shows the fixed message of a known error code, then removes it from the address', async () => {
    nav.search = new URLSearchParams({ error: 'TOKEN_EXPIRED' })
    render(<LoginForm />)
    expect(await screen.findByText('Ce lien a expiré. Demandez-en un nouveau.')).toBeInTheDocument()
    expect(nav.replace).toHaveBeenCalledWith('/login')
  })

  // KLEDG-R3-AUTH-04: the parameter is a code, never text shown as is.
  it.each(['Votre compte est suspendu. Appelez le 01 23 45 67 89', 'Remise de 100% refusée', 'constructor', '__proto__'])(
    'shows a generic message for free text in the URL (%s)',
    async (error) => {
      nav.search = new URLSearchParams({ error })
      render(<LoginForm />)
      expect(await screen.findByText('La connexion n’a pas abouti. Réessayez.')).toBeInTheDocument()
      expect(screen.queryByText(error, { exact: false })).not.toBeInTheDocument()
    },
  )

  it('keeps the page to go back to when it removes the error (email change link)', async () => {
    const back = '/api/auth/verify-email?token=abc&callbackURL=%2Fsettings%2Fprofile'
    nav.search = new URLSearchParams({ error: 'SIGN_IN_TO_CONFIRM_EMAIL', redirect: back })
    render(<LoginForm />)
    expect(await screen.findByText('Connectez-vous pour confirmer votre nouvelle adresse email.')).toBeInTheDocument()
    expect(nav.replace).toHaveBeenCalledWith(`/login?${new URLSearchParams({ redirect: back })}`)
  })

  it('opens an API path after sign-in with a full navigation', async () => {
    const location = { href: 'http://localhost/login' }
    vi.stubGlobal('location', location)
    nav.search = new URLSearchParams({ redirect: '/api/auth/verify-email?token=abc' })
    render(<LoginForm />)
    await signIn()
    await waitFor(() => expect(location.href).toBe('/api/auth/verify-email?token=abc'))
    expect(nav.push).not.toHaveBeenCalled()
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
