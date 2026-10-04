/**
 * Comptes bancaires page: the synchronisation status of each account (manual
 * import, covered by a direct connection, expired access, error, paused,
 * synced), the sync of the connected banks, renaming an account, and what a
 * role that may not manage the bank sees. fetch is mocked; the dialogs and
 * panels are stubs (they have their own tests).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const access = vi.hoisted(() => ({ manage: true, reconcile: true }))

vi.mock('next/navigation', () => ({
  useParams: () => ({ companyId: 'c1' }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/c1/banking',
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/features/companies/company-access', () => ({
  useCompanyAccess: () => ({
    roleLabel: access.manage ? 'Administrateur' : 'Comptable',
    can: (request: { banking?: string[] }) => (request.banking?.includes('manage') ? access.manage : access.reconcile),
    denied: (what: string) => `Refusé : ${what}`,
  }),
  AccessNotice: ({ children }: { children: React.ReactNode }) => <p role="note">{children}</p>,
}))
vi.mock('@/components/features/banking/statement-import-dialog', () => ({ StatementImportDialog: () => null }))
vi.mock('@/components/features/banking/manual-account-dialog', () => ({ ManualAccountDialog: () => null }))
vi.mock('@/components/features/banking/connect-bank-button', () => ({ ConnectBankButton: () => null }))
vi.mock('@/components/features/banking/connections-panel', () => ({ ConnectionsPanel: () => null }))
vi.mock('@/components/features/banking/consent-banners', () => ({ ConsentBanners: () => null }))
vi.mock('@/components/features/banking/ledger-account-select', () => ({ LedgerAccountSelect: () => null }))
vi.mock('@/components/features/banking/use-ledger-bank-accounts', () => ({ useLedgerBankAccounts: () => ({ accounts: [] }) }))
vi.mock('@/components/features/banking/account-sync-switch', () => ({ AccountSyncSwitch: () => null, canToggleSync: () => false }))

import { toast } from 'sonner'
import BankingPage from '../page'

const account = (id: string, name: string, overrides: Record<string, unknown>) => ({
  id,
  name,
  displayName: null,
  iban: null,
  balance: 0,
  currency: 'EUR',
  shouldSync: true,
  ledgerAccountCode: '512000',
  consentExpiresAt: null,
  lastSyncedAt: null,
  lastSyncError: null,
  supersededBy: null,
  institution: null,
  bankConnection: { id: `bc-${id}`, provider: 'QONTO', status: 'active' },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
})

const ACCOUNTS = [
  account('a1', 'Compte courant', { balance: 1520.4 }),
  account('a2', 'Livret', { bankConnection: { id: 'bc-m', provider: 'MANUAL', status: 'active' } }),
  account('a3', 'BNP via Ponto', { bankConnection: { id: 'bc-p', provider: 'PONTO', status: 'active' }, supersededBy: { id: 'a1', name: 'Compte courant', provider: 'QONTO' } }),
  account('a4', 'Revolut', { bankConnection: { id: 'bc-r', provider: 'REVOLUT', status: 'active' }, consentExpiresAt: '2026-09-01T00:00:00Z' }),
  account('a5', 'Compte en erreur', { lastSyncError: 'Identifiants refusés par la banque' }),
  account('a6', 'Compte en pause', { shouldSync: false }),
]

let syncReply: { status: number; body: unknown }
let fetchMock: ReturnType<typeof vi.fn>
const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  access.manage = true
  access.reconcile = true
  syncReply = { status: 200, body: { success: true, totalItemsSynced: 3, errors: [] } }
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    const method = init?.method ?? 'GET'
    if (url.pathname === '/api/banking/accounts') return respond(200, { accounts: ACCOUNTS })
    if (url.pathname === '/api/banking/connections') return respond(200, { connections: [{ id: 'bc-a1', provider: 'QONTO', status: 'active', integration: { id: 'i1', provider: 'QONTO', status: 'active', name: 'Qonto' }, bankAccounts: [] }] })
    if (method === 'POST' && url.pathname === '/api/integrations/sync') return respond(syncReply.status, syncReply.body)
    if (method === 'PUT' && url.pathname === '/api/banking/accounts/a1') return respond(200, { ok: true })
    return respond(404, { error: 'unexpected' })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const statusOf = (name: string) => {
  const list = screen.getByRole('list', { name: 'Comptes bancaires' })
  const item = within(list).getByText(name).closest('li') as HTMLElement
  return within(item).getByText(/Import de relevés|Synchronisé|Accès expiré|Erreur|Non synchronisé/)
}

describe('banking page', () => {
  it('gives each account its synchronisation status', async () => {
    render(<BankingPage />)
    await screen.findByRole('list', { name: 'Comptes bancaires' })
    expect(statusOf('Compte courant')).toHaveTextContent('Synchronisé')
    expect(statusOf('Livret')).toHaveTextContent('Import de relevés')
    expect(statusOf('BNP via Ponto')).toHaveTextContent('Synchronisé via Qonto')
    expect(statusOf('BNP via Ponto')).toHaveAttribute('title', 'Une connexion directe couvre déjà ce compte (même IBAN).')
    expect(statusOf('Revolut')).toHaveTextContent('Accès expiré')
    expect(statusOf('Revolut')).toHaveAttribute('title', "Données à jour jusqu'au 01/09/2026")
    expect(statusOf('Compte en erreur')).toHaveAttribute('title', 'Identifiants refusés par la banque')
    expect(statusOf('Compte en pause')).toHaveTextContent('Non synchronisé')
  })

  it('syncs the connected banks and reports the items received', async () => {
    const user = userEvent.setup()
    render(<BankingPage />)
    await user.click(await screen.findByRole('button', { name: /Synchroniser/ }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Synchronisation terminée : 3 éléments reçus'))
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ companyId: 'c1' })
  })

  it('shows the errors of a failed sync on the page', async () => {
    syncReply = { status: 200, body: { success: false, totalItemsSynced: 0, errors: ['Qonto : clé refusée', 'Ponto : accès expiré'] } }
    const user = userEvent.setup()
    render(<BankingPage />)
    await user.click(await screen.findByRole('button', { name: /Synchroniser/ }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Qonto : clé refusée, Ponto : accès expiré'))
    expect(await screen.findByText('Qonto : clé refusée, Ponto : accès expiré')).toBeInTheDocument()
  })

  it('renames an account, an empty name going back to the bank name', async () => {
    const user = userEvent.setup()
    render(<BankingPage />)
    const list = await screen.findByRole('list', { name: 'Comptes bancaires' })
    await user.click(within(list).getByRole('button', { name: 'Renommer Compte courant' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByRole('textbox'), '   ')
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Nom d'affichage mis à jour"))
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({ displayName: null })
  })

  it('lets a role that may not manage the bank consult and sync, not rename', async () => {
    access.manage = false
    render(<BankingPage />)
    const list = await screen.findByRole('list', { name: 'Comptes bancaires' })
    expect(within(list).getByRole('button', { name: 'Renommer Compte courant' })).toBeDisabled()
    expect(screen.getByRole('note')).toHaveTextContent("Votre rôle (Comptable) permet de consulter les comptes, d'importer des relevés et de synchroniser les banques connectées.")
    expect(screen.getByRole('button', { name: /Synchroniser/ })).toBeEnabled()
  })
})
