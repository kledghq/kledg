import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { InstanceUser } from '@/lib/users/instance-users.service'
import { InstanceUsersTable } from '../instance-users-table'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const users: InstanceUser[] = [
  {
    id: 'u-admin',
    email: 'admin@acme.fr',
    name: 'Admin',
    role: 'admin',
    banned: false,
    emailVerified: true,
    createdAt: '2026-01-05T10:00:00.000Z',
    lastSessionAt: '2026-10-02T08:30:00.000Z',
  },
  {
    id: 'u-marie',
    email: 'marie@acme.fr',
    name: 'Marie',
    role: 'user',
    banned: true,
    emailVerified: false,
    createdAt: '2026-02-01T10:00:00.000Z',
    lastSessionAt: null,
  },
]

describe('InstanceUsersTable', () => {
  it('lists each account with its role, status, creation date and last session', () => {
    render(<InstanceUsersTable users={users} currentUserId="u-admin" canManage />)
    const marie = screen.getByText('marie@acme.fr').closest('tr')!
    expect(within(marie).getByText('Utilisateur')).toBeTruthy()
    expect(within(marie).getByText('Bloqué')).toBeTruthy()
    expect(within(marie).getByText('01/02/2026')).toBeTruthy()
    expect(within(marie).getByText('Aucune')).toBeTruthy()
    const admin = screen.getByText('admin@acme.fr').closest('tr')!
    expect(within(admin).getByText("Administrateur de l'instance")).toBeTruthy()
    expect(within(admin).getByText('Actif')).toBeTruthy()
  })

  it('offers no action on the signed-in administrator, named actions on the others', () => {
    render(<InstanceUsersTable users={users} currentUserId="u-admin" canManage />)
    expect(screen.getByText('(vous)')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Actions pour admin@acme.fr' })).toBeNull()
    expect((screen.getByRole('button', { name: 'Actions pour marie@acme.fr' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('keeps the actions visible but disabled when the instance refuses user management', () => {
    render(<InstanceUsersTable users={users} currentUserId="u-admin" canManage={false} />)
    expect((screen.getByRole('button', { name: 'Actions pour marie@acme.fr' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
