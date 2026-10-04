/**
 * Import page: the file type detected from the extension, the column and
 * account mapping a FEC needs first (LPF art. A47 A-1: 18 fixed columns),
 * the multipart request sent to /api/import, and the result: counts, errors
 * and the PCG warnings per entry. fetch is mocked; the mapping screen is a
 * stub (it has its own tests).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('next/navigation', () => ({
  useParams: () => ({ companyId: 'c1' }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/c1/import',
}))
vi.mock('@/components/features/import/column-mapping', () => ({
  ColumnMapping: ({ fileContent, onMappingComplete }: { fileContent: string; onMappingComplete: (m: Record<string, string>, a: Record<string, string | null>) => void }) => (
    <div>
      <p>Correspondance de {fileContent.split('\n')[0].split('\t').length} colonnes</p>
      <button type="button" onClick={() => onMappingComplete({ journalCode: 'JournalCode', accountNumber: 'CompteNum' }, { '411DUPONT': '411000', '999': null })}>
        Valider la correspondance
      </button>
    </div>
  ),
}))

import ImportPage from '../page'

const FEC_HEADER = 'JournalCode\tJournalLib\tEcritureNum\tEcritureDate\tCompteNum\tCompteLib\tCompAuxNum\tCompAuxLib\tPieceRef\tPieceDate\tEcritureLib\tDebit\tCredit\tEcritureLet\tDateLet\tValidDate\tMontantdevise\tIdevise'

let reply: { status: number; body: unknown }
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  reply = { status: 200, body: { success: true, entriesCreated: 42, accountsCreated: 5, journalsCreated: 2, errors: [] } }
  fetchMock = vi.fn(async () => new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement
const sentForm = () => fetchMock.mock.calls[0][1]?.body as FormData

/** The file picker only offers the extensions of the chosen type: pick the type first, as a user does. */
async function chooseType(user: ReturnType<typeof userEvent.setup>, label: RegExp) {
  await user.click(screen.getByRole('combobox', { name: 'Type de fichier' }))
  await user.click(await screen.findByRole('option', { name: label }))
}

describe('import page', () => {
  it('imports a CSV file as CSV and shows what was created', async () => {
    const user = userEvent.setup()
    render(<ImportPage />)
    await chooseType(user, /^CSV$/)
    await user.upload(fileInput(), new File(['date;journal;compte;debit;credit\n'], 'ecritures.csv', { type: 'text/csv' }))
    await user.click(screen.getByRole('button', { name: /Importer/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/import')
    expect(sentForm().get('type')).toBe('csv')
    expect(sentForm().get('companyId')).toBe('c1')
    expect((sentForm().get('file') as File).name).toBe('ecritures.csv')
    expect(sentForm().get('mapping')).toBeNull()
    expect(await screen.findByText('Import réussi')).toBeInTheDocument()
    expect(screen.getByText(/Écritures créées/)).toHaveTextContent('42')
    expect(screen.getByText(/Comptes créés/)).toHaveTextContent('5')
  })

  it('asks for the mapping of a FEC first, then sends it with the file', async () => {
    const user = userEvent.setup()
    render(<ImportPage />)
    await user.upload(fileInput(), new File([`${FEC_HEADER}\nVE\tVentes\t1\t20260105\t411DUPONT\tDupont\t\t\tF1\t20260105\tFacture\t120,00\t0,00\t\t\t20260105\t\t\n`], '123456789FEC20261231.txt'))
    expect(await screen.findByText('Correspondance de 18 colonnes')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Valider la correspondance' }))
    expect(await screen.findByText('Correspondance configurée')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Importer/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(sentForm().get('type')).toBe('fec')
    expect(JSON.parse(String(sentForm().get('mapping')))).toEqual({ journalCode: 'JournalCode', accountNumber: 'CompteNum' })
    expect(JSON.parse(String(sentForm().get('accountMapping')))).toEqual({ '411DUPONT': '411000', '999': null })
  })

  it('says when nothing was imported and lists the errors', async () => {
    reply = { status: 200, body: { success: false, entriesCreated: 0, accountsCreated: 0, journalsCreated: 0, errors: ["Ligne 3 : l'écriture 7 n'est pas équilibrée (débit 120,00, crédit 100,00)"] } }
    const user = userEvent.setup()
    render(<ImportPage />)
    await chooseType(user, /Excel/)
    await user.upload(fileInput(), new File(['x'], 'ecritures.xlsx'))
    await user.click(screen.getByRole('button', { name: /Importer/ }))
    // Text queries match the normalized text: write the no-break space as a space
    expect(await screen.findByText('Import refusé : aucune écriture importée')).toBeInTheDocument()
    expect(screen.getByText("Ligne 3 : l'écriture 7 n'est pas équilibrée (débit 120,00, crédit 100,00)")).toBeInTheDocument()
    expect(sentForm().get('type')).toBe('excel')
  })

  it('shows the PCG warnings by entry, with their article', async () => {
    reply = {
      status: 200,
      body: {
        success: true,
        entriesCreated: 2,
        accountsCreated: 0,
        journalsCreated: 0,
        errors: [],
        pcgWarnings: [{ entryNumber: '7', warnings: [{ code: 'CASH_NEGATIVE', severity: 'error', article: '512-1', message: 'La caisse ne peut pas être créditrice' }] }],
      },
    }
    const user = userEvent.setup()
    render(<ImportPage />)
    await chooseType(user, /^CSV$/)
    await user.upload(fileInput(), new File(['x'], 'ecritures.csv', { type: 'text/csv' }))
    await user.click(screen.getByRole('button', { name: /Importer/ }))
    expect(await screen.findByText('Avertissements PCG')).toBeInTheDocument()
    expect(screen.getByText('1 avertissement détecté')).toBeInTheDocument()
    expect(screen.getByText('CASH_NEGATIVE (Art. 512-1)')).toBeInTheDocument()
    expect(screen.getByText('La caisse ne peut pas être créditrice')).toBeInTheDocument()
  })

  it('shows the refusal of the API', async () => {
    reply = { status: 413, body: { error: 'Le fichier dépasse 10 Mo.' } }
    const user = userEvent.setup()
    render(<ImportPage />)
    await chooseType(user, /^CSV$/)
    await user.upload(fileInput(), new File(['x'], 'ecritures.csv', { type: 'text/csv' }))
    await user.click(screen.getByRole('button', { name: /Importer/ }))
    expect(await screen.findByText('Le fichier dépasse 10 Mo.')).toBeInTheDocument()
  })
})
