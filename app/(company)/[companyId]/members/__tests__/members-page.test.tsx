/**
 * Membres page: only an instance administrator manages the members of a
 * company (POST/PATCH/DELETE /api/companies/[id]/members are admin routes);
 * the others see the roles read only. fetch and the session are mocked; the
 * requests the page sends are asserted.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const session = vi.hoisted(() => ({ role: 'user' as string }))

vi.mock('next/navigation', () => ({
  useParams: () => ({ companyId: 'c1' }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/c1/members',
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/auth-client', () => ({
  authClient: { useSession: () => ({ data: { user: { id: 'u-me', role: session.role } }, isPending: false }) },
}))

import { toast } from 'sonner'
import CompanyMembersPage from '../page'

const MEMBERS = [
  { id: 'm1', userId: 'u1', email: 'alice@atelier.fr', name: 'Alice Martin', roles: ['companyAdmin'], createdAt: '2026-01-01' },
  { id: 'm2', userId: 'u2', email: 'bob@atelier.fr', name: null, roles: ['accountant'], createdAt: '2026-01-02' },
]

let replies: Record<string, { status?: number; body: unknown }>
let fetchMock: ReturnType<typeof vi.fn>

const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  session.role = 'user'
  replies = {}
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    const key = `${init?.method ?? 'GET'} ${url.pathname}`
    if (replies[key]) return respond(replies[key].status ?? 200, replies[key].body)
    if (key === 'GET /api/companies/c1/members') return respond(200, MEMBERS)
    if (key === 'GET /api/users') return respond(200, [])
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
    expect(screen.getByText(/Seul un administrateur de l.instance peut ajouter un membre/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Ajouter un membre/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Retirer/ })).not.toBeInTheDocument()
    // The user search is an administrator tool: never called for a member
    expect(sent('GET', '/api/users')).toHaveLength(0)
  })

  it('lets an administrator change a role', async () => {
    session.role = 'admin'
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
    replies['GET /api/companies/c1/members'] = { body: [] }
    render(<CompanyMembersPage />)
    expect(await screen.findByText(/vous ouvrez cette société sans en être membre/)).toBeInTheDocument()
    expect(screen.getByText(/ajoutez votre expert-comptable ou un associé/)).toBeInTheDocument()
  })
})
