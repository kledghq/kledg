import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const nav = vi.hoisted(() => ({ search: new URLSearchParams(), push: vi.fn(), refresh: vi.fn() }))
const auth = vi.hoisted(() => ({ signIn: vi.fn(), resetPassword: vi.fn(), requestPasswordReset: vi.fn() }))
const setup = vi.hoisted(() => ({ createFirstAdmin: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh }),
  useSearchParams: () => nav.search,
}))
vi.mock('@/lib/auth-client', () => ({
  authClient: {
    signIn: { email: auth.signIn },
    resetPassword: auth.resetPassword,
    requestPasswordReset: auth.requestPasswordReset,
  },
}))
vi.mock('../setup/actions', () => ({ createFirstAdmin: setup.createFirstAdmin }))

import { SetupForm } from '../setup/setup-form'
import ResetPasswordPage from '../reset-password/page'
import ForgotPasswordPage from '../forgot-password/page'

beforeEach(() => {
  nav.search = new URLSearchParams()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('SetupForm', () => {
  it('creates the first administrator with the token, signs in and opens the welcome page', async () => {
    const user = userEvent.setup()
    setup.createFirstAdmin.mockResolvedValue({ ok: true })
    auth.signIn.mockResolvedValue({ error: null })
    render(<SetupForm adminEmail={null} initialToken="token-from-url" />)
    // The installation link carries the token: the field is not shown, the token is still sent.
    expect(screen.queryByLabelText("Jeton d'installation")).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Nom'), 'Marie Dupont')
    await user.type(screen.getByLabelText('Email'), 'marie@acme.fr')
    await user.type(screen.getByLabelText('Mot de passe'), 'long-password')
    await user.click(screen.getByRole('button', { name: 'Créer le compte administrateur' }))

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/welcome'))
    expect(setup.createFirstAdmin).toHaveBeenCalledWith({
      name: 'Marie Dupont',
      email: 'marie@acme.fr',
      password: 'long-password',
      token: 'token-from-url',
    })
    expect(auth.signIn).toHaveBeenCalledWith({ email: 'marie@acme.fr', password: 'long-password' })
    expect(nav.refresh).toHaveBeenCalled()
  })

  it('locks the email set by ADMIN_EMAIL', () => {
    render(<SetupForm adminEmail="admin@acme.fr" initialToken="" />)
    expect(screen.getByLabelText('Email')).toHaveValue('admin@acme.fr')
    expect(screen.getByLabelText('Email')).toHaveAttribute('readonly')
    expect(screen.getByText('Défini par ADMIN_EMAIL lors du déploiement.')).toBeInTheDocument()
  })

  it('shows the error of the server action and lets the user try again', async () => {
    const user = userEvent.setup()
    setup.createFirstAdmin.mockResolvedValue({ ok: false, error: "Jeton d'installation invalide." })
    render(<SetupForm adminEmail="admin@acme.fr" initialToken="wrong" />)
    await user.type(screen.getByLabelText('Nom'), 'Admin')
    await user.type(screen.getByLabelText('Mot de passe'), 'long-password')
    await user.click(screen.getByRole('button', { name: 'Créer le compte administrateur' }))
    expect(await screen.findByText("Jeton d'installation invalide.")).toBeInTheDocument()
    expect(auth.signIn).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Créer le compte administrateur' })).toBeEnabled()
  })

  it('sends the new administrator to the sign-in page when the automatic sign-in fails', async () => {
    const user = userEvent.setup()
    setup.createFirstAdmin.mockResolvedValue({ ok: true })
    auth.signIn.mockResolvedValue({ error: { message: 'Session impossible' } })
    render(<SetupForm adminEmail="admin@acme.fr" initialToken="t" />)
    await user.type(screen.getByLabelText('Nom'), 'Admin')
    await user.type(screen.getByLabelText('Mot de passe'), 'long-password')
    await user.click(screen.getByRole('button', { name: 'Créer le compte administrateur' }))
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/login'))
  })
})

describe('ResetPasswordPage', () => {
  it('offers a new link when the token is missing or refused', () => {
    const { unmount } = render(<ResetPasswordPage />)
    expect(screen.getByRole('heading', { name: 'Lien invalide' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Demander un nouveau lien' })).toHaveAttribute('href', '/forgot-password')
    unmount()
    nav.search = new URLSearchParams({ token: 'abc', error: 'INVALID_TOKEN' })
    render(<ResetPasswordPage />)
    expect(screen.getByRole('heading', { name: 'Lien invalide' })).toBeInTheDocument()
  })

  it('checks length and confirmation before resetting, then goes to the sign-in page', async () => {
    const user = userEvent.setup()
    nav.search = new URLSearchParams({ token: 'tok-123' })
    auth.resetPassword.mockResolvedValue({ error: null })
    render(<ResetPasswordPage />)
    expect(screen.getByRole('heading', { name: 'Nouveau mot de passe' })).toBeInTheDocument()

    await user.type(screen.getByLabelText('Mot de passe'), 'court')
    await user.type(screen.getByLabelText('Confirmation'), 'court')
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
    expect(screen.getByText('Le mot de passe doit contenir au moins 10 caractères')).toBeInTheDocument()

    await user.clear(screen.getByLabelText('Mot de passe'))
    await user.type(screen.getByLabelText('Mot de passe'), 'long-password-1')
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
    expect(screen.getByText('Les mots de passe ne correspondent pas')).toBeInTheDocument()
    expect(auth.resetPassword).not.toHaveBeenCalled()

    await user.clear(screen.getByLabelText('Confirmation'))
    await user.type(screen.getByLabelText('Confirmation'), 'long-password-1')
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/login'))
    expect(auth.resetPassword).toHaveBeenCalledWith({ newPassword: 'long-password-1', token: 'tok-123' })
  })

  it('welcomes an invited user and shows an expired link error', async () => {
    const user = userEvent.setup()
    nav.search = new URLSearchParams({ token: 'tok-123', welcome: '1' })
    auth.resetPassword.mockResolvedValue({ error: { message: 'Le lien a expiré' } })
    render(<ResetPasswordPage />)
    expect(screen.getByRole('heading', { name: 'Bienvenue sur Kledg' })).toBeInTheDocument()
    expect(screen.getByText('Choisissez le mot de passe de votre compte.')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Mot de passe'), 'long-password-1')
    await user.type(screen.getByLabelText('Confirmation'), 'long-password-1')
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
    expect(await screen.findByText('Le lien a expiré')).toBeInTheDocument()
    expect(nav.push).not.toHaveBeenCalled()
  })
})

describe('ForgotPasswordPage', () => {
  it('requests a reset link to the reset page and answers the same way whether the account exists or not', async () => {
    const user = userEvent.setup()
    auth.requestPasswordReset.mockResolvedValue({ error: null })
    render(<ForgotPasswordPage />)
    expect(screen.getByRole('link', { name: 'Retour à la connexion' })).toHaveAttribute('href', '/login')
    await user.type(screen.getByLabelText('Email'), 'inconnu@acme.fr')
    await user.click(screen.getByRole('button', { name: 'Envoyer le lien' }))
    expect(await screen.findByText(/Si un compte existe pour inconnu@acme.fr, un email vient de lui être envoyé/)).toBeInTheDocument()
    expect(auth.requestPasswordReset).toHaveBeenCalledWith({ email: 'inconnu@acme.fr', redirectTo: '/reset-password' })
    expect(screen.queryByLabelText('Email')).toBeNull()
  })

  it('shows the error of a refused request', async () => {
    const user = userEvent.setup()
    auth.requestPasswordReset.mockResolvedValue({ error: { message: 'Trop de demandes, réessayez plus tard' } })
    render(<ForgotPasswordPage />)
    await user.type(screen.getByLabelText('Email'), 'marie@acme.fr')
    await user.click(screen.getByRole('button', { name: 'Envoyer le lien' }))
    expect(await screen.findByText('Trop de demandes, réessayez plus tard')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveValue('marie@acme.fr')
  })
})
