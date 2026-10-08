/**
 * Membres page: only an instance administrator adds a member directly,
 * changes a role or removes a member (POST/PATCH/DELETE
 * /api/companies/[id]/members are admin routes); a company administrator
 * (members:manage) invites by email and manages the pending invitations
 * (issue #13); the others see the roles read only. fetch, the session and
 * the user's rights are mocked; the requests the page sends are asserted.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const session = vi.hoisted(() => ({ role: 'user' as string }))
const access = vi.hoisted(() => ({ granted: {} as Record<string, string[]> }))

vi.mock('next/navigation', () => ({
  useParams: () => ({ companyId: 'c1' }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/c1/members',
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/auth-client', () => ({
  authClient: { useSession: () => ({ data: { user: { id: 'u-me', role: session.role } }, isPending: false }) },
}))

vi.mock('@/components/features/companies/company-access', async () => {
  const { grants } = await import('@/lib/rbac/granted-permissions')
  return {
    useCompanyAccess: () => ({ roleLabel: '', can: (request: Record<string, string[]>) => grants(access.granted, request), denied: () => '' }),
    AccessNotice: ({ children }: { children: React.ReactNode }) => <p role="note">{children}</p>,
  }
})

import { toast } from 'sonner'
import { allPermissions, grantedPermissions } from '@/lib/rbac/granted-permissions'
import CompanyMembersPage from '../page'

const MEMBERS = [
  { id: 'm1', userId: 'u1', email: 'alice@atelier.fr', name: 'Alice Martin', roles: ['companyAdmin'], createdAt: '2026-01-01' },
  { id: 'm2', userId: 'u2', email: 'bob@atelier.fr', name: null, roles: ['accountant'], createdAt: '2026-01-02' },
]

let replies: Record<string, { status?: number; body: unknown }>
let fetchMock: ReturnType<typeof vi.fn>

const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const INVITATIONS = [
  { id: 'inv1', email: 'expert@cabinet.fr', role: 'accountant', expiresAt: '2099-01-08T00:00:00Z', expired: false, lastSentAt: '2099-01-01T00:00:00Z', sendCount: 1, invitedBy: { name: 'Alice Martin', email: 'alice@atelier.fr' } },
]

beforeEach(() => {
  session.role = 'user'
  access.granted = grantedPermissions(['viewer'], false)
  replies = {}
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    const key = `${init?.method ?? 'GET'} ${url.pathname}`
    if (replies[key]) return respond(replies[key].status ?? 200, replies[key].body)
    if (key === 'GET /api/companies/c1/members') return respond(200, MEMBERS)
    if (key === 'GET /api/users') return respond(200, [])
    if (key === 'GET /api/companies/c1/invitations') return respond(200, { invitations: [] })
    return respond(404, { error: `unexpected ${key}` })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const sent = (method: string, path: string) =>
  fetchMock.mock.calls.filter(([input, init]) => new URL(String(input), 'http://localhost').pathname === path && (init?.method ?? 'GET') === method)

describe('members page', () => {
  it('shows the roles read only to a member who is not an instance administrator', async () => {
    render(<CompanyMembersPage />)
    expect(await screen.findByText('Alice Martin')).toBeInTheDocument()
    // A member without a name is shown by the local part of the email
    expect(screen.getByText('bob')).toBeInTheDocument()
    expect(screen.getByText('Administrateur')).toBeInTheDocument()
    expect(screen.getByText('Comptable')).toBeInTheDocument()
    expect(screen.getByText(/Seuls les administrateurs de la société peuvent inviter un membre/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Ajouter un membre/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Inviter un membre/ })).not.toBeInTheDocument()
    expect(sent('GET', '/api/companies/c1/invitations')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /Retirer/ })).not.toBeInTheDocument()
    // The user search is an administrator tool: never called for a member
    expect(sent('GET', '/api/users')).toHaveLength(0)
  })

  it('lets a company administrator invite by email, with a role no higher than theirs (issue #13)', async () => {
    access.granted = grantedPermissions(['companyAdmin'], false)
    replies['POST /api/companies/c1/invitations'] = { status: 201, body: { emailSent: true, invitation: INVITATIONS[0] } }
    const user = userEvent.setup()
    render(<CompanyMembersPage />)
    expect(await screen.findByText(/Vous invitez des membres par email/)).toBeInTheDocument()
    // Direct additions, role changes and removals stay with instance administrators
    expect(screen.queryByRole('button', { name: /Ajouter un membre/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: /Rôle de/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Inviter un membre/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Inviter un membre' })
    await user.type(within(dialog).getByLabelText('Email'), 'expert@cabinet.fr')
    await user.click(within(dialog).getByRole('combobox', { name: /Rôle/ }))
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['Administrateur', 'Comptable', 'Lecture seule'])
    await user.click(screen.getByRole('option', { name: 'Comptable' }))
    await user.click(within(dialog).getByRole('button', { name: /Envoyer l.invitation/ }))

    await waitFor(() => expect(sent('POST', '/api/companies/c1/invitations')).toHaveLength(1))
    expect(JSON.parse(String(sent('POST', '/api/companies/c1/invitations')[0][1]?.body))).toEqual({ email: 'expert@cabinet.fr', role: 'accountant' })
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Invitation envoyée à expert@cabinet.fr'))
  })

  it('offers only the roles the inviter holds, and shows the link when no email can carry it', async () => {
    // A custom role managing members with an accountant's rights: it may not make administrators
    access.granted = { ...grantedPermissions(['accountant'], false), members: ['manage'] }
    replies['POST /api/companies/c1/invitations'] = { status: 201, body: { emailSent: false, link: 'https://kledg.example/invitation/abc' } }
    const user = userEvent.setup()
    render(<CompanyMembersPage />)
    await user.click(await screen.findByRole('button', { name: /Inviter un membre/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Inviter un membre' })
    await user.click(within(dialog).getByRole('combobox', { name: /Rôle/ }))
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['Comptable', 'Lecture seule'])
    await user.click(screen.getByRole('option', { name: 'Lecture seule' }))
    await user.type(within(dialog).getByLabelText('Email'), 'salarie@atelier.fr')
    await user.click(within(dialog).getByRole('button', { name: /Envoyer l.invitation/ }))
    expect(await screen.findByText('https://kledg.example/invitation/abc')).toBeInTheDocument()
  })

  it('lists the pending invitations, sends one again and revokes one after confirmation', async () => {
    access.granted = allPermissions()
    replies['GET /api/companies/c1/invitations'] = { body: { invitations: INVITATIONS } }
    replies['POST /api/companies/c1/invitations/inv1/resend'] = { body: { emailSent: true, invitation: INVITATIONS[0] } }
    replies['DELETE /api/companies/c1/invitations/inv1'] = { body: { id: 'inv1', revoked: true } }
    const user = userEvent.setup()
    render(<CompanyMembersPage />)
    expect(await screen.findByText('expert@cabinet.fr')).toBeInTheDocument()
    expect(screen.getByText('Invité·e par Alice Martin')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: "Renvoyer l'invitation de expert@cabinet.fr" }))
    await waitFor(() => expect(sent('POST', '/api/companies/c1/invitations/inv1/resend')).toHaveLength(1))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Invitation renvoyée à expert@cabinet.fr'))

    await user.click(screen.getByRole('button', { name: "Annuler l'invitation de expert@cabinet.fr" }))
    const confirm = await screen.findByRole('alertdialog')
    await user.click(within(confirm).getByRole('button', { name: "Annuler l'invitation" }))
    await waitFor(() => expect(sent('DELETE', '/api/companies/c1/invitations/inv1')).toHaveLength(1))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Invitation annulée'))
  })

  it('lets an administrator change a role', async () => {
    session.role = 'admin'
    access.granted = allPermissions()
    replies['PATCH /api/companies/c1/members/m2'] = { body: { ok: true } }
    const user = userEvent.setup()
    render(<CompanyMembersPage />)
    await user.click(await screen.findByRole('combobox', { name: 'Rôle de bob@atelier.fr' }))
    await user.click(await screen.findByRole('option', { name: 'Lecture seule' }))

    await waitFor(() => expect(sent('PATCH', '/api/companies/c1/members/m2')).toHaveLength(1))
    expect(JSON.parse(String(sent('PATCH', '/api/companies/c1/members/m2')[0][1]?.body))).toEqual({ role: 'viewer' })
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Rôle mis à jour : Lecture seule'))
  })

  it('removes a member only after confirmation', async () => {
    session.role = 'admin'
    access.granted = allPermissions()
    replies['DELETE /api/companies/c1/members/m1'] = { status: 409, body: { error: 'La société doit garder au moins un administrateur.' } }
    const user = userEvent.setup()
    render(<CompanyMembersPage />)
    await user.click(await screen.findByRole('button', { name: 'Retirer Alice Martin' }))
    const confirm = await screen.findByRole('alertdialog')
    expect(within(confirm).getByText('Retirer Alice Martin ?')).toBeInTheDocument()
    await user.click(within(confirm).getByRole('button', { name: 'Annuler' }))
    expect(sent('DELETE', '/api/companies/c1/members/m1')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Retirer Alice Martin' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Retirer' }))
    await waitFor(() => expect(sent('DELETE', '/api/companies/c1/members/m1')).toHaveLength(1))
    // The refusal of the API is shown as it is
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('La société doit garder au moins un administrateur.'))
  })

  it('adds an existing user found by the search, with the role chosen', async () => {
    session.role = 'admin'
    access.granted = allPermissions()
    replies['GET /api/users'] = { body: [{ id: 'u3', email: 'chloe@atelier.fr', name: 'Chloé Durand' }] }
    replies['POST /api/companies/c1/members'] = { status: 201, body: { welcomeEmailSent: true } }
    const user = userEvent.setup()
    render(<CompanyMembersPage />)
    await user.click(await screen.findByRole('button', { name: /Ajouter un membre/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Ajouter un membre' })
    expect(within(dialog).getByRole('button', { name: /Ajouter le membre/ })).toBeDisabled()

    await user.type(within(dialog).getByPlaceholderText('Nom ou adresse email'), 'c')
    // The search excludes the users already in the company
    await waitFor(() => {
      const search = sent('GET', '/api/users').map(([input]) => new URL(String(input)).searchParams)
      expect(search.some((params) => params.get('search') === 'c' && params.get('excludeCompanyId') === 'c1' && params.get('limit') === '20')).toBe(true)
    }, { timeout: 5000 })
    // The suggestion list is portaled next to the dialog
    await user.click(await screen.findByText('Chloé Durand', {}, { timeout: 5000 }))
    await user.click(within(dialog).getByRole('combobox', { name: /Rôle/ }))
    await user.click(await screen.findByRole('option', { name: 'Lecture seule' }))
    await user.click(within(dialog).getByRole('button', { name: /Ajouter le membre/ }))

    await waitFor(() => expect(sent('POST', '/api/companies/c1/members')).toHaveLength(1))
    expect(JSON.parse(String(sent('POST', '/api/companies/c1/members')[0][1]?.body))).toEqual({
      email: 'chloe@atelier.fr',
      name: 'Chloé Durand',
      role: 'viewer',
    })
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("chloe@atelier.fr ajouté·e, un email d'accès a été envoyé"))
  })

  it('tells an instance administrator why a company they opened has no member, and what to do', async () => {
    session.role = 'admin'
    access.granted = allPermissions()
    replies['GET /api/companies/c1/members'] = { body: [] }
    render(<CompanyMembersPage />)
    expect(await screen.findByText(/vous ouvrez cette société sans en être membre/)).toBeInTheDocument()
    expect(screen.getByText(/ajoutez votre expert-comptable ou un associé/)).toBeInTheDocument()
  })
})
