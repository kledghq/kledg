import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
const notify = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({ useRouter: () => router }))
vi.mock('sonner', () => ({ toast }))
vi.mock('@/lib/auth-client', () => ({ authClient: { $store: { notify } } }))

import { DeleteAccountCard } from '../delete-account-card'
import { EmailCard } from '../email-card'
import { PasswordCard } from '../password-card'
import { ProfileNameCard } from '../profile-name-card'

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  vi.clearAllMocks()
})

function lastRequest() {
  const [url, init] = fetchMock.mock.calls.at(-1)!
  return { url, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined }
}

const company = { id: 'c1', name: 'Alpha SAS', slug: 'alpha', roles: ['companyAdmin', 'accountant'], lastCompanyAdmin: false }

describe('DeleteAccountCard', () => {
  it('lists the companies the user will lose access to, with their roles', () => {
    render(
      <DeleteAccountCard
        email="marie@acme.fr"
        deletion={{ allowed: true, blockers: [], companies: [company, { ...company, id: 'c2', name: 'Beta', roles: ['viewer'] }] }}
      />,
    )
    expect(screen.getByText(/Vous perdrez l.accès à ces sociétés/)).toBeInTheDocument()
    expect(screen.getByText('Alpha SAS').closest('li')).toHaveTextContent('Administrateur, Comptable')
    expect(screen.getByText('Beta').closest('li')).toHaveTextContent('Lecture seule')
  })

  it('disables deletion and says why when the instance refuses it', () => {
    render(
      <DeleteAccountCard
        email="marie@acme.fr"
        deletion={{ allowed: false, message: 'La suppression de compte est désactivée.', blockers: [], companies: [] }}
      />,
    )
    expect(screen.getByText('La suppression de compte est désactivée.')).toBeInTheDocument()
    expect(screen.getByText(/membre d.aucune société/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Supprimer mon compte' })).toBeDisabled()
  })

  it('disables deletion while a blocker remains, such as being the last administrator', () => {
    render(
      <DeleteAccountCard
        email="marie@acme.fr"
        deletion={{ allowed: true, blockers: ['Nommez un autre administrateur pour Alpha SAS.'], companies: [company] }}
      />,
    )
    expect(screen.getByText('Nommez un autre administrateur pour Alpha SAS.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Supprimer mon compte' })).toBeDisabled()
  })

  it('requires the exact email before deleting, then sends DELETE /api/account and leaves for the sign-in page', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    render(<DeleteAccountCard email="Marie@acme.fr" deletion={{ allowed: true, blockers: [], companies: [] }} />)

    await user.click(screen.getByRole('button', { name: 'Supprimer mon compte' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Supprimer votre compte ?')).toBeInTheDocument()
    const confirm = within(dialog).getByRole('button', { name: 'Supprimer mon compte' })
    expect(confirm).toBeDisabled()

    await user.type(within(dialog).getByLabelText(/Saisissez votre adresse email/), 'marie@acme.f')
    expect(confirm).toBeDisabled()
    await user.type(within(dialog).getByLabelText(/Saisissez votre adresse email/), 'r ')
    expect(confirm).toBeEnabled()
    expect(fetchMock).not.toHaveBeenCalled()

    await user.type(within(dialog).getByLabelText(/Mot de passe/), 'secret-password')
    await user.click(confirm)

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'))
    expect(lastRequest()).toEqual({
      url: '/api/account',
      method: 'DELETE',
      body: { email: 'marie@acme.fr', password: 'secret-password' },
    })
    expect(toast.success).toHaveBeenCalledWith('Compte supprimé')
    expect(router.refresh).toHaveBeenCalled()
  })

  it('asks for the password and stays put when the server refuses', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(Response.json({ error: 'Mot de passe incorrect' }, { status: 400 }))
    render(<DeleteAccountCard email="marie@acme.fr" deletion={{ allowed: true, blockers: [], companies: [] }} />)
    await user.click(screen.getByRole('button', { name: 'Supprimer mon compte' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/Saisissez votre adresse email/), 'marie@acme.fr')
    await user.click(within(dialog).getByRole('button', { name: 'Supprimer mon compte' }))
    expect(await within(dialog).findByText('Saisissez votre mot de passe')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()

    await user.type(within(dialog).getByLabelText(/Mot de passe/), 'wrong')
    await user.click(within(dialog).getByRole('button', { name: 'Supprimer mon compte' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Mot de passe incorrect'))
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('clears the typed email when the dialog is cancelled', async () => {
    const user = userEvent.setup()
    render(<DeleteAccountCard email="marie@acme.fr" deletion={{ allowed: true, blockers: [], companies: [] }} />)
    await user.click(screen.getByRole('button', { name: 'Supprimer mon compte' }))
    let dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/Saisissez votre adresse email/), 'marie@acme.fr')
    await user.click(within(dialog).getByRole('button', { name: 'Annuler' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    await user.click(screen.getByRole('button', { name: 'Supprimer mon compte' }))
    dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText(/Saisissez votre adresse email/)).toHaveValue('')
  })
})

describe('EmailCard', () => {
  it('sends a confirmation link and says where it went', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(Response.json({ status: 'verification-sent' }))
    render(<EmailCard email="marie@acme.fr" mode={{ kind: 'verify' }} />)
    expect(screen.getByLabelText('Adresse actuelle')).toHaveValue('marie@acme.fr')

    await user.type(screen.getByLabelText(/Nouvelle adresse/), ' Marie.New@Acme.fr ')
    await user.type(screen.getByLabelText(/Mot de passe/), 'pw')
    await user.click(screen.getByRole('button', { name: 'Envoyer le lien de confirmation' }))

    expect(await screen.findByText('Lien envoyé à marie.new@acme.fr')).toBeInTheDocument()
    expect(lastRequest()).toEqual({
      url: '/api/account/email',
      method: 'POST',
      body: { newEmail: 'marie.new@acme.fr', password: 'pw' },
    })
    expect(screen.getByLabelText(/Nouvelle adresse/)).toHaveValue('')
    expect(router.refresh).not.toHaveBeenCalled()
  })

  it('changes the address at once in direct mode and refreshes the session', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(Response.json({ status: 'updated' }))
    render(<EmailCard email="admin@acme.fr" mode={{ kind: 'direct' }} />)
    expect(screen.getByText(/L'envoi d'emails n'est pas configuré sur cette instance. En tant qu'administrateur/)).toBeInTheDocument()

    await user.type(screen.getByLabelText(/Nouvelle adresse/), 'boss@acme.fr')
    await user.type(screen.getByLabelText(/Mot de passe/), 'pw')
    await user.click(screen.getByRole('button', { name: "Changer l'adresse" }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Adresse email modifiée'))
    expect(notify).toHaveBeenCalledWith('$sessionSignal')
    expect(router.refresh).toHaveBeenCalled()
  })

  it('validates the address before calling the API', async () => {
    const user = userEvent.setup()
    render(<EmailCard email="marie@acme.fr" mode={{ kind: 'verify' }} />)
    await user.type(screen.getByLabelText(/Nouvelle adresse/), 'pas-une-adresse')
    await user.click(screen.getByRole('button', { name: 'Envoyer le lien de confirmation' }))
    expect(await screen.findByText('Adresse email invalide')).toBeInTheDocument()
    expect(screen.getByText('Saisissez votre mot de passe')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows the route error in a toast', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(Response.json({ error: 'Cette adresse est déjà utilisée' }, { status: 409 }))
    render(<EmailCard email="marie@acme.fr" mode={{ kind: 'verify' }} />)
    await user.type(screen.getByLabelText(/Nouvelle adresse/), 'paul@acme.fr')
    await user.type(screen.getByLabelText(/Mot de passe/), 'pw')
    await user.click(screen.getByRole('button', { name: 'Envoyer le lien de confirmation' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Cette adresse est déjà utilisée'))
  })

  it.each([
    ['refused', 'Le changement d’adresse est désactivé.'],
    ['unavailable', 'Demandez à l’administrateur.'],
  ] as const)('disables the form with the reason when the mode is %s', (kind, message) => {
    render(<EmailCard email="marie@acme.fr" mode={{ kind, message }} />)
    expect(screen.getByText(message)).toBeInTheDocument()
    expect(screen.getByLabelText(/Nouvelle adresse/)).toBeDisabled()
    expect(screen.getByLabelText(/Mot de passe/)).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Envoyer le lien de confirmation' })).toBeDisabled()
  })
})

describe('PasswordCard', () => {
  it('checks length and confirmation before calling the API', async () => {
    const user = userEvent.setup()
    render(<PasswordCard state={{ allowed: true }} />)
    expect(screen.getByText('Au moins 10 caractères.')).toBeInTheDocument()
    await user.type(screen.getByLabelText(/Nouveau mot de passe/), 'court')
    await user.type(screen.getByLabelText(/Confirmer le nouveau mot de passe/), 'autre')
    await user.click(screen.getByRole('button', { name: 'Changer le mot de passe' }))
    expect(await screen.findByText('Saisissez votre mot de passe actuel')).toBeInTheDocument()
    expect(screen.getByText('Au moins 10 caractères')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText(/Mot de passe actuel/), 'old-password')
    await user.clear(screen.getByLabelText(/Nouveau mot de passe/))
    await user.type(screen.getByLabelText(/Nouveau mot de passe/), 'new-password-1')
    await user.click(screen.getByRole('button', { name: 'Changer le mot de passe' }))
    expect(await screen.findByText('Les mots de passe ne correspondent pas')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends the passwords without the confirmation and signs out the other sessions by default', async () => {
    const user = userEvent.setup()
    const onRevoked = vi.fn()
    fetchMock.mockResolvedValue(Response.json({ success: true }))
    render(<PasswordCard state={{ allowed: true }} onOtherSessionsRevoked={onRevoked} />)
    expect(screen.getByRole('checkbox', { name: /Déconnecter mes autres sessions/ })).toBeChecked()
    await user.type(screen.getByLabelText(/Mot de passe actuel/), 'old-password')
    await user.type(screen.getByLabelText(/Nouveau mot de passe/), 'new-password-1')
    await user.type(screen.getByLabelText(/Confirmer le nouveau mot de passe/), 'new-password-1')
    await user.click(screen.getByRole('button', { name: 'Changer le mot de passe' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Mot de passe modifié, autres sessions déconnectées'))
    expect(lastRequest()).toEqual({
      url: '/api/account/password',
      method: 'POST',
      body: { currentPassword: 'old-password', newPassword: 'new-password-1', revokeOtherSessions: true },
    })
    expect(onRevoked).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText(/Mot de passe actuel/)).toHaveValue('')
  })

  it('keeps the other sessions when the box is unchecked', async () => {
    const user = userEvent.setup()
    const onRevoked = vi.fn()
    fetchMock.mockResolvedValue(Response.json({ success: true }))
    render(<PasswordCard state={{ allowed: true }} onOtherSessionsRevoked={onRevoked} />)
    await user.click(screen.getByRole('checkbox', { name: /Déconnecter mes autres sessions/ }))
    await user.type(screen.getByLabelText(/Mot de passe actuel/), 'old-password')
    await user.type(screen.getByLabelText(/Nouveau mot de passe/), 'new-password-1')
    await user.type(screen.getByLabelText(/Confirmer le nouveau mot de passe/), 'new-password-1')
    await user.click(screen.getByRole('button', { name: 'Changer le mot de passe' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Mot de passe modifié'))
    expect(lastRequest().body).toMatchObject({ revokeOtherSessions: false })
    expect(onRevoked).not.toHaveBeenCalled()
  })

  it('reports a wrong current password in a toast', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(Response.json({ error: 'Mot de passe actuel incorrect' }, { status: 400 }))
    render(<PasswordCard state={{ allowed: true }} />)
    await user.type(screen.getByLabelText(/Mot de passe actuel/), 'nope')
    await user.type(screen.getByLabelText(/Nouveau mot de passe/), 'new-password-1')
    await user.type(screen.getByLabelText(/Confirmer le nouveau mot de passe/), 'new-password-1')
    await user.click(screen.getByRole('button', { name: 'Changer le mot de passe' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Mot de passe actuel incorrect'))
  })

  it('disables every control with the reason when the instance refuses the change', () => {
    render(<PasswordCard state={{ allowed: false, message: 'Mots de passe gérés par votre administrateur.' }} />)
    expect(screen.getByText('Mots de passe gérés par votre administrateur.')).toBeInTheDocument()
    expect(screen.getByLabelText(/Mot de passe actuel/)).toBeDisabled()
    expect(screen.getByRole('checkbox')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Changer le mot de passe' })).toBeDisabled()
  })
})

describe('ProfileNameCard', () => {
  it('previews the initials and saves the trimmed name', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(Response.json({ name: 'Paul Martin' }))
    render(<ProfileNameCard name="Marie Dupont" email="marie@acme.fr" />)
    expect(screen.getByText('MD')).toBeInTheDocument()
    const save = screen.getByRole('button', { name: 'Enregistrer le nom' })
    expect(save).toBeDisabled()

    await user.clear(screen.getByLabelText(/Nom/))
    await user.type(screen.getByLabelText(/Nom/), '  Paul Martin ')
    expect(screen.getByText('PM')).toBeInTheDocument()
    await user.click(save)

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Nom enregistré'))
    expect(lastRequest()).toEqual({ url: '/api/account/profile', method: 'PATCH', body: { name: 'Paul Martin' } })
    expect(notify).toHaveBeenCalledWith('$sessionSignal')
    expect(router.refresh).toHaveBeenCalled()
    expect(screen.getByLabelText(/Nom/)).toHaveValue('Paul Martin')
    expect(save).toBeDisabled()
  })

  it('falls back to the email initials and refuses an empty name', async () => {
    const user = userEvent.setup()
    render(<ProfileNameCard name="Marie" email="jean.dupont@acme.fr" />)
    await user.clear(screen.getByLabelText(/Nom/))
    expect(screen.getByText('JD')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Enregistrer le nom' }))
    expect(await screen.findByText('Saisissez votre nom')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows the route error in a toast', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(Response.json({ error: 'Trop de tentatives' }, { status: 429 }))
    render(<ProfileNameCard name="Marie" email="marie@acme.fr" />)
    await user.type(screen.getByLabelText(/Nom/), ' D')
    await user.click(screen.getByRole('button', { name: 'Enregistrer le nom' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Trop de tentatives'))
  })
})
