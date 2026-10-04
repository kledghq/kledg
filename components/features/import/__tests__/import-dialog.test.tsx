import { useState } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))

import type { FECColumnMapping } from '@/lib/import/types'

const COLUMNS: FECColumnMapping = {
  JournalCode: 'JournalCode',
  JournalLib: 'JournalLib',
  EcritureNum: 'EcritureNum',
  EcritureDate: 'EcritureDate',
  CompteNum: 'CompteNum',
  CompteLib: 'CompteLib',
  Debit: 'Debit',
  Credit: 'Credit',
}

// The two mapping steps have their own tests: stubs that complete or cancel them.
vi.mock('@/components/features/import/column-mapping', () => ({
  ColumnMapping: ({
    fileContent,
    onMappingComplete,
    onCancel,
  }: {
    fileContent: string
    onMappingComplete: (m: FECColumnMapping) => void
    onCancel: () => void
  }) => (
    <div data-testid="column-mapping">
      <p>{`${fileContent.split('\n').length} lignes lues`}</p>
      <button type="button" onClick={() => onMappingComplete(COLUMNS)}>
        Valider les colonnes
      </button>
      <button type="button" onClick={onCancel}>
        Abandonner les colonnes
      </button>
    </div>
  ),
}))

vi.mock('@/components/features/import/account-mapping', () => ({
  AccountMappingComponent: ({
    fiscalYearId,
    fiscalYearYear,
    onMappingComplete,
    onCancel,
  }: {
    fiscalYearId?: string
    fiscalYearYear?: number
    onMappingComplete: (data: { accountMapping: Record<string, string | null>; journalMapping?: Record<string, string | null> }) => void
    onCancel: () => void
  }) => (
    <div data-testid="account-mapping">
      <p>{`Exercice cible ${fiscalYearId} (${fiscalYearYear})`}</p>
      <button
        type="button"
        onClick={() => onMappingComplete({ accountMapping: { '41100000': 'acc-411' }, journalMapping: { BQ: 'j-bq' } })}
      >
        Valider les comptes
      </button>
      <button type="button" onClick={onCancel}>
        Revenir
      </button>
    </div>
  ),
}))

import { ImportDialog, type ImportResult } from '../import-dialog'

const FEC = [
  'JournalCode\tJournalLib\tEcritureNum\tEcritureDate\tCompteNum\tCompteLib\tDebit\tCredit',
  'VT\tVentes\t1\t20260105\t41100000\tClients\t1200,00\t0,00',
  'VT\tVentes\t1\t20260105\t70600000\tPrestations\t0,00\t1200,00',
].join('\n')

const FY_2026 = {
  id: '',
  year: 2026,
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  wasCreated: true,
  entriesCount: 2,
  linesCount: 5,
}

const fetchMock = vi.fn()
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

type Route = (init: RequestInit | undefined) => Response | Promise<Response>

/** Answers by "METHOD url"; an unexpected request fails the test. */
function routes(table: Record<string, Route>) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`
    const handler = table[key]
    if (!handler) throw new Error(`unexpected request ${key}`)
    return handler(init)
  })
}

const callsTo = (key: string) =>
  fetchMock.mock.calls.filter((call) => {
    const [url, init] = call as [string, RequestInit | undefined]
    return `${init?.method ?? 'GET'} ${url}` === key
  })

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

/** The page owns the open state, like the import page. */
function Harness({ onImportSuccess, onOpenChange }: { onImportSuccess?: (r: ImportResult) => void; onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Ouvrir l’import
      </button>
      <ImportDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          onOpenChange?.(next)
        }}
        companyId="co-1"
        onImportSuccess={onImportSuccess}
      />
    </>
  )
}

function fileInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')
  if (!input) throw new Error('file input not found')
  return input
}

/** Picks the file type first: the picker only offers the files of the selected type. */
async function chooseType(user: ReturnType<typeof userEvent.setup>, label: 'CSV' | 'Excel (.xlsx, .xls)') {
  await user.click(screen.getByRole('combobox'))
  await user.click(await screen.findByRole('option', { name: label }))
}

/** The footer button with exactly this text (Radix adds an icon close button named "Fermer"). */
function footerButton(name: string): HTMLElement {
  const button = screen.getAllByRole('button', { name }).find((b) => b.textContent === name)
  if (!button) throw new Error(`no ${name} button`)
  return button
}

describe('ImportDialog: CSV and Excel files', () => {
  it('imports a CSV file in one request and shows the result', async () => {
    const user = userEvent.setup()
    const onImportSuccess = vi.fn()
    const onOpenChange = vi.fn()
    const result = { success: true, entriesCreated: 12, accountsCreated: 3, journalsCreated: 1, errors: [] }
    routes({ 'POST /api/import': () => json(200, result) })
    render(<Harness onImportSuccess={onImportSuccess} onOpenChange={onOpenChange} />)

    expect(screen.getByRole('heading', { name: 'Importer un fichier' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Importer' })).toBeDisabled()

    // 2 048 bytes, shown as 2,0 Ko
    await chooseType(user, 'CSV')
    await user.upload(fileInput(), new File(['x'.repeat(2048)], 'ecritures.csv', { type: 'text/csv' }))
    expect(screen.getByRole('combobox')).toHaveTextContent('CSV')
    expect(screen.getByText('Fichier choisi : ecritures.csv (2,0 Ko)')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Importer' }))

    await waitFor(() => expect(onImportSuccess).toHaveBeenCalledWith(result))
    const body = callsTo('POST /api/import')[0][1].body as FormData
    expect(body.get('companyId')).toBe('co-1')
    expect(body.get('type')).toBe('csv')
    expect((body.get('file') as File).name).toBe('ecritures.csv')
    expect(body.has('mapping')).toBe(false)
    expect(body.has('accountMapping')).toBe(false)
    expect(body.has('journalMapping')).toBe(false)
    expect(body.has('cleanEntryNumbers')).toBe(false)

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Import terminé avec succès' })).toBeInTheDocument()
    const tile = (label: string) => within(dialog).getByText(label).parentElement as HTMLElement
    expect(tile('Écritures importées')).toHaveTextContent('12')
    expect(tile('Écritures ignorées')).toHaveTextContent('0')
    expect(tile('Comptes créés')).toHaveTextContent('3')
    expect(tile('Journaux créés')).toHaveTextContent('1')

    await user.click(footerButton('Fermer'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
  })

  it('detects an Excel file and sends it as excel', async () => {
    const user = userEvent.setup()
    routes({ 'POST /api/import': () => json(200, { success: true, entriesCreated: 1 }) })
    render(<Harness />)

    await chooseType(user, 'Excel (.xlsx, .xls)')
    await user.upload(fileInput(), new File(['x'], 'grand-livre.xlsx'))
    expect(screen.getByRole('combobox')).toHaveTextContent('Excel (.xlsx, .xls)')
    await user.click(screen.getByRole('button', { name: 'Importer' }))
    await waitFor(() => expect(callsTo('POST /api/import')).toHaveLength(1))
    expect((callsTo('POST /api/import')[0][1].body as FormData).get('type')).toBe('excel')
  })

  it('shows the API error of a refused import', async () => {
    const user = userEvent.setup()
    const onImportSuccess = vi.fn()
    routes({ 'POST /api/import': () => json(400, { error: 'Colonne « Débit » introuvable.' }) })
    render(<Harness onImportSuccess={onImportSuccess} />)

    await chooseType(user, 'CSV')
    await user.upload(fileInput(), new File(['x'], 'ecritures.csv'))
    await user.click(screen.getByRole('button', { name: 'Importer' }))

    expect(await screen.findByText('Colonne « Débit » introuvable.')).toBeInTheDocument()
    expect(onImportSuccess).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Importer' })).toBeEnabled()
  })

  it('falls back to French messages when the error has no text or the request fails', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(json(500, {})).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    render(<Harness />)

    await chooseType(user, 'CSV')
    await user.upload(fileInput(), new File(['x'], 'ecritures.csv'))
    await user.click(screen.getByRole('button', { name: 'Importer' }))
    expect(await screen.findByText("Erreur lors de l'import")).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Importer' }))
    expect(await screen.findByText("Erreur lors de l'import du fichier")).toBeInTheDocument()
  })
})

describe('ImportDialog: result of an import', () => {
  async function importWith(result: ImportResult) {
    const user = userEvent.setup()
    routes({ 'POST /api/import': () => json(200, result) })
    render(<Harness />)
    await chooseType(user, 'CSV')
    await user.upload(fileInput(), new File(['x'], 'ecritures.csv'))
    await user.click(screen.getByRole('button', { name: 'Importer' }))
    return within(await screen.findByRole('dialog'))
  }

  it('says a FEC import was refused as a whole and lists the refused entries', async () => {
    // A FEC import is atomic: one refused entry cancels it (Kledg import rule, ImportResult.refused)
    const dialog = await importWith({
      success: false,
      entriesCreated: 0,
      refused: [
        { entry: 'VT-0004', line: 12, reason: 'déséquilibrée' },
        { entry: 'BQ-0010', line: 30, reason: 'date hors exercice' },
      ],
      errors: ['VT-0004 (ligne 12) : déséquilibrée', 'BQ-0010 (ligne 30) : date hors exercice'],
    })
    expect(dialog.getByRole('heading', { name: /^Import refusé\s:\saucune écriture importée$/ })).toBeInTheDocument()
    expect(dialog.getByText('Écritures refusées').parentElement).toHaveTextContent('2')
    expect(dialog.getByText('Écritures refusées (2)')).toBeInTheDocument()
    expect(dialog.getByText('VT-0004 (ligne 12) : déséquilibrée')).toBeInTheDocument()
  })

  it('separates a partial import, its ignored entries and the warnings to check', async () => {
    const dialog = await importWith({
      success: false,
      entriesCreated: 40,
      errors: ['Ligne 7 : compte manquant'],
      warnings: ['Le journal « AN » a été créé', 'Écart d’arrondi de 0,01 € sur VT-0012'],
    })
    expect(dialog.getByRole('heading', { name: 'Import partiellement réussi' })).toBeInTheDocument()
    expect(dialog.getByText('Écritures ignorées (1)')).toBeInTheDocument()
    expect(dialog.getByText('Ligne 7 : compte manquant')).toBeInTheDocument()
    expect(dialog.getByText('À vérifier (2)')).toBeInTheDocument()
    expect(dialog.getByText('Écart d’arrondi de 0,01 € sur VT-0012')).toBeInTheDocument()
    expect(dialog.queryByText('Comptes créés')).not.toBeInTheDocument()
  })

  it('says an import that created nothing failed', async () => {
    const dialog = await importWith({ success: false, entriesCreated: 0, errors: [] })
    expect(dialog.getByRole('heading', { name: 'Import échoué' })).toBeInTheDocument()
  })
})

describe('ImportDialog: FEC files', () => {
  it('goes through columns, fiscal year creation, PCG accounts and account mapping, then sends every mapping', async () => {
    const user = userEvent.setup()
    const onImportSuccess = vi.fn()
    const createdFy = { id: 'fy-26', year: 2026, startDate: '2026-01-01T00:00:00.000Z', endDate: '2026-12-31T00:00:00.000Z' }
    routes({
      'POST /api/import/preview-fiscal-years': () => json(200, [FY_2026]),
      'GET /api/companies/co-1/fiscal-years': () => json(200, []),
      'POST /api/companies/co-1/fiscal-years': () => json(201, createdFy),
      'POST /api/accounts/seed-pcg': () => json(200, { created: 820 }),
      'POST /api/import': () => json(200, { success: true, entriesCreated: 2 }),
    })
    render(<Harness onImportSuccess={onImportSuccess} />)

    // A .txt file is read as a FEC and goes straight to the column step
    await user.upload(fileInput(), new File([FEC], 'FEC123456789FEC20261231.txt', { type: 'text/plain' }))
    expect(await screen.findByRole('heading', { name: 'Correspondance des colonnes' })).toBeInTheDocument()
    expect(screen.getByText('3 lignes lues')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Importer un fichier' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Valider les colonnes' }))

    // The fiscal years of the file are previewed with the column mapping
    expect(await screen.findByRole('heading', { name: "Choisir ou créer l'exercice fiscal" })).toBeInTheDocument()
    expect(JSON.parse(callsTo('POST /api/import/preview-fiscal-years')[0][1].body as string)).toEqual({
      companyId: 'co-1',
      content: FEC,
      mapping: COLUMNS,
    })
    expect(screen.getByText("Le fichier contient des écritures pour l'exercice 2026 (2 écritures, 5 lignes).")).toBeInTheDocument()
    expect(await screen.findByText('Aucun exercice existant.')).toBeInTheDocument()
    expect(screen.getByText('Exercice 2026, du 01/01/2026 au 31/12/2026')).toBeInTheDocument()
    const proceed = screen.getByRole('button', { name: 'Continuer vers le mapping des comptes' })
    expect(proceed).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Créer cet exercice' }))
    expect(await screen.findByText(/Exercice 2026 sélectionné/)).toBeInTheDocument()
    expect(JSON.parse(callsTo('POST /api/companies/co-1/fiscal-years')[0][1].body as string)).toEqual({
      year: 2026,
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-12-31T00:00:00.000Z',
    })
    // The new fiscal year is listed and selected
    expect(screen.getByRole('button', { name: /^Exercice 2026, du 01\/01\/2026 au 31\/12\/2026/ })).toBeInTheDocument()
    expect(proceed).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Ajouter les comptes PCG' }))
    expect(await screen.findByRole('button', { name: 'Comptes PCG ajoutés' })).toBeDisabled()
    const seed = callsTo('POST /api/accounts/seed-pcg')[0][1].body as FormData
    expect(Object.fromEntries(seed.entries())).toEqual({ companyId: 'co-1', fiscalYearId: 'fy-26', includeOptionalAccounts: 'false' })

    await user.click(proceed)
    expect(await screen.findByText('Exercice cible fy-26 (2026)')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Correspondance des comptes et journaux - Exercice 2026' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Valider les comptes' }))

    // Back to the main dialog, now a preview of what will be imported
    expect(await screen.findByRole('heading', { name: "Prévisualisation de l'import" })).toBeInTheDocument()
    expect(screen.getByText('Exercice fiscal détecté:')).toBeInTheDocument()
    expect(screen.getByText('Du 01/01/2026 au 31/12/2026')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Importer' }))

    await waitFor(() => expect(onImportSuccess).toHaveBeenCalledWith({ success: true, entriesCreated: 2 }))
    const body = callsTo('POST /api/import')[0][1].body as FormData
    expect(body.get('type')).toBe('fec')
    expect(JSON.parse(body.get('mapping') as string)).toEqual(COLUMNS)
    expect(JSON.parse(body.get('accountMapping') as string)).toEqual({ '41100000': 'acc-411' })
    expect(JSON.parse(body.get('journalMapping') as string)).toEqual({ BQ: 'j-bq' })
    expect(body.has('cleanEntryNumbers')).toBe(false)
  })

  it('imports into an existing fiscal year, with the optional PCG accounts or without adding any', async () => {
    const user = userEvent.setup()
    routes({
      'POST /api/import/preview-fiscal-years': () => json(200, [{ ...FY_2026, id: 'fy-26', wasCreated: false }]),
      'GET /api/companies/co-1/fiscal-years': () =>
        json(200, [
          { id: 'fy-26', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31' },
          { id: 'fy-25', year: 2025, startDate: '2025-01-01', endDate: '2025-12-31' },
        ]),
      'POST /api/accounts/seed-pcg': () => json(200, {}),
    })
    render(<Harness />)

    await user.upload(fileInput(), new File([FEC], 'export.fec'))
    await user.click(await screen.findByRole('button', { name: 'Valider les colonnes' }))
    await screen.findByRole('heading', { name: "Choisir ou créer l'exercice fiscal" })
    expect(await screen.findByRole('button', { name: /Exercice 2025, du 01\/01\/2025 au 31\/12\/2025/ })).toBeInTheDocument()
    // Nothing to create: the file's year already exists
    expect(screen.queryByRole('button', { name: 'Créer cet exercice' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continuer vers le mapping des comptes' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: /Exercice 2025/ }))
    expect(screen.getByText(/Exercice 2025 sélectionné/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Ajouter les comptes PCG (avec optionnels)' }))
    await screen.findByRole('button', { name: 'Comptes PCG ajoutés' })
    expect(Object.fromEntries((callsTo('POST /api/accounts/seed-pcg')[0][1].body as FormData).entries())).toEqual({
      companyId: 'co-1',
      fiscalYearId: 'fy-25',
      includeOptionalAccounts: 'true',
    })

    await user.click(screen.getByRole('button', { name: 'Continuer vers le mapping des comptes' }))
    expect(await screen.findByText('Exercice cible fy-25 (2025)')).toBeInTheDocument()

    // Going back from the accounts returns to the fiscal year step
    await user.click(screen.getByRole('button', { name: 'Revenir' }))
    expect(await screen.findByRole('heading', { name: "Choisir ou créer l'exercice fiscal" })).toBeInTheDocument()
  })

  it('lets the user skip the PCG step when the accounts exist', async () => {
    const user = userEvent.setup()
    routes({
      'POST /api/import/preview-fiscal-years': () => json(200, [FY_2026]),
      'GET /api/companies/co-1/fiscal-years': () => json(200, [{ id: 'fy-26', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31' }]),
    })
    render(<Harness />)

    await user.upload(fileInput(), new File([FEC], 'export.txt'))
    await user.click(await screen.findByRole('button', { name: 'Valider les colonnes' }))
    await user.click(await screen.findByRole('button', { name: /Exercice 2026, du/ }))
    await user.click(screen.getByRole('button', { name: 'Les comptes existent déjà, passer cette étape' }))
    expect(screen.getByRole('button', { name: 'Comptes PCG ajoutés' })).toBeDisabled()
    expect(callsTo('POST /api/accounts/seed-pcg')).toHaveLength(0)
  })

  it('warns when the file spans several fiscal years, all imported at once', async () => {
    const user = userEvent.setup()
    routes({
      'POST /api/import/preview-fiscal-years': () =>
        json(200, [
          { ...FY_2026, year: 2025, startDate: '2025-01-01', endDate: '2025-12-31', wasCreated: false, id: 'fy-25', accountsCount: 120, journalsCount: 5 },
          FY_2026,
        ]),
    })
    render(<Harness />)

    await user.upload(fileInput(), new File([FEC], 'export.txt'))
    await user.click(await screen.findByRole('button', { name: 'Valider les colonnes' }))

    expect(await screen.findByRole('heading', { name: "Prévisualisation de l'import" })).toBeInTheDocument()
    expect(screen.getByText(/Ce fichier FEC contient plusieurs exercices fiscaux \(\s*2025, 2026\)\. Tous seront importés en une seule fois\./)).toBeInTheDocument()
    expect(screen.getByText('Exercices fiscaux détectés:')).toBeInTheDocument()
    expect(screen.getByText('(sera créé)')).toBeInTheDocument()
    expect(screen.getByText('120')).toBeInTheDocument()
  })

  it('reopens the main dialog with an error when no fiscal year is found', async () => {
    const user = userEvent.setup()
    routes({ 'POST /api/import/preview-fiscal-years': () => json(200, []) })
    render(<Harness />)

    await user.upload(fileInput(), new File([FEC], 'export.txt'))
    await user.click(await screen.findByRole('button', { name: 'Valider les colonnes' }))

    expect(await screen.findByText('Aucun exercice fiscal détecté dans le fichier')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Importer un fichier' })).toBeInTheDocument()
  })

  it('imports with the column mapping only when the preview is unavailable, with cleaned entry numbers', async () => {
    const user = userEvent.setup()
    routes({
      'POST /api/import/preview-fiscal-years': () => json(500, {}),
      'POST /api/import': () => json(200, { success: true, entriesCreated: 2 }),
    })
    render(<Harness />)

    await user.upload(fileInput(), new File([FEC], 'export.txt'))
    await user.click(await screen.findByRole('button', { name: 'Valider les colonnes' }))
    expect(await screen.findByText('Aucun exercice fiscal détecté dans le fichier')).toBeInTheDocument()
    expect(screen.getByText('Correspondance configurée')).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: "Nettoyer les numéros d'écriture (enlever les zéros à gauche)" }))
    await user.click(screen.getByRole('button', { name: 'Importer' }))

    await waitFor(() => expect(callsTo('POST /api/import')).toHaveLength(1))
    const body = callsTo('POST /api/import')[0][1].body as FormData
    expect(body.get('type')).toBe('fec')
    expect(JSON.parse(body.get('mapping') as string)).toEqual(COLUMNS)
    expect(body.get('cleanEntryNumbers')).toBe('true')
    expect(body.has('accountMapping')).toBe(false)
  })

  it('reopens the column step from "Modifier le mapping"', async () => {
    const user = userEvent.setup()
    routes({ 'POST /api/import/preview-fiscal-years': () => json(500, {}) })
    render(<Harness />)

    await user.upload(fileInput(), new File([FEC], 'export.txt'))
    await user.click(await screen.findByRole('button', { name: 'Valider les colonnes' }))
    await user.click(await screen.findByRole('button', { name: 'Modifier le mapping' }))
    expect(await screen.findByRole('heading', { name: 'Correspondance des colonnes' })).toBeInTheDocument()
  })

  it('goes back to the main dialog when the column step is abandoned', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.upload(fileInput(), new File([FEC], 'export.txt'))
    await user.click(await screen.findByRole('button', { name: 'Abandonner les colonnes' }))

    expect(await screen.findByRole('heading', { name: 'Importer un fichier' })).toBeInTheDocument()
    expect(screen.queryByText(/Fichier choisi/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Importer' })).toBeDisabled()
  })

  it('asks for the column mapping before importing a FEC whose type was not detected', async () => {
    // `accept` is only a hint: the system picker can still offer every file
    const user = userEvent.setup({ applyAccept: false })
    render(<Harness />)

    // Unknown extension: the type stays FEC and nothing is read yet
    await user.upload(fileInput(), new File([FEC], 'export.dat'))
    expect(screen.getByText(/Pour les fichiers FEC, vous devrez configurer la correspondance des colonnes/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Importer' }))

    expect(await screen.findByRole('heading', { name: 'Correspondance des colonnes' })).toBeInTheDocument()
    expect(screen.getByText('3 lignes lues')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads the chosen file again when the type is switched to FEC', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await chooseType(user, 'CSV')
    await user.upload(fileInput(), new File([FEC], 'export.csv'))
    await user.click(screen.getByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: 'FEC (Fichier des Écritures Comptables)' }))

    expect(await screen.findByRole('heading', { name: 'Correspondance des colonnes' })).toBeInTheDocument()
  })

  // The error of creating the fiscal year shows in the fiscal year step, where the click was made
  it('shows the API error in the fiscal year step when the fiscal year cannot be created', async () => {
    const user = userEvent.setup()
    routes({
      'POST /api/import/preview-fiscal-years': () => json(200, [FY_2026]),
      'GET /api/companies/co-1/fiscal-years': () => json(200, []),
      'POST /api/companies/co-1/fiscal-years': () => json(409, { error: 'Un exercice chevauche déjà cette période.' }),
    })
    render(<Harness />)

    await user.upload(fileInput(), new File([FEC], 'export.txt'))
    await user.click(await screen.findByRole('button', { name: 'Valider les colonnes' }))
    await user.click(await screen.findByRole('button', { name: 'Créer cet exercice' }))
    expect(await screen.findByText('Un exercice chevauche déjà cette période.')).toBeInTheDocument()
  })

  it('keeps the fiscal year error for the main dialog and lets the user go back to it', async () => {
    const user = userEvent.setup()
    routes({
      'POST /api/import/preview-fiscal-years': () => json(200, [FY_2026]),
      'GET /api/companies/co-1/fiscal-years': () => json(200, []),
      'POST /api/companies/co-1/fiscal-years': () => json(409, { error: 'Un exercice chevauche déjà cette période.' }),
    })
    render(<Harness />)

    await user.upload(fileInput(), new File([FEC], 'export.txt'))
    await user.click(await screen.findByRole('button', { name: 'Valider les colonnes' }))
    await user.click(await screen.findByRole('button', { name: 'Créer cet exercice' }))
    await waitFor(() => expect(callsTo('POST /api/companies/co-1/fiscal-years')).toHaveLength(1))
    expect(screen.getByRole('button', { name: 'Continuer vers le mapping des comptes' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(await screen.findByText('Un exercice chevauche déjà cette période.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: "Prévisualisation de l'import" })).toBeInTheDocument()
  })

  it('shows a PCG seeding failure once back on the main dialog', async () => {
    const user = userEvent.setup()
    routes({
      'POST /api/import/preview-fiscal-years': () => json(200, [{ ...FY_2026, id: 'fy-26', wasCreated: false }]),
      'GET /api/companies/co-1/fiscal-years': () => json(200, [{ id: 'fy-26', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31' }]),
      'POST /api/accounts/seed-pcg': () => json(500, { error: 'Plan comptable introuvable.' }),
    })
    render(<Harness />)

    await user.upload(fileInput(), new File([FEC], 'export.txt'))
    await user.click(await screen.findByRole('button', { name: 'Valider les colonnes' }))
    await user.click(await screen.findByRole('button', { name: 'Ajouter les comptes PCG' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ajouter les comptes PCG' })).toBeEnabled())

    await user.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(await screen.findByText('Plan comptable introuvable.')).toBeInTheDocument()
  })
})
