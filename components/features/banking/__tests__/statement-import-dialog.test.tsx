import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))

import { CompanyAccessProvider } from '@/components/features/companies/company-access'
import { importSummary, StatementImportDialog, type ImportableAccount } from '../statement-import-dialog'
import {
  EXTERNAL_FILE_DRAG_TYPE,
  IMPORT_DIALOG_STATE_EVENT,
  IMPORT_FILE_EVENT,
  registerExternalFile,
  unregisterExternalFile,
} from '../statement-drop'

/** Intl fr-FR uses U+202F (thousands) and U+00A0 (before the currency sign). */
const norm = (text: string | null | undefined) => (text ?? '').replace(/[\u202f\u00a0]/g, ' ')

const COURANT: ImportableAccount = { id: 'ba-1', name: 'Compte courant', displayName: null, iban: 'FR76 3000 4000 0312 3456 7890 143' }
const EPARGNE: ImportableAccount = { id: 'ba-2', name: 'atelier-lumen-epargne', displayName: null, iban: 'FR76 1111 2222 3333 4444 5555 987' }

interface Row {
  index: number
  key: string
  line: number
  bookingDate: string
  valueDate: string | null
  label: string
  reference: string | null
  counterparty: string | null
  amount: string
  duplicate: false | 'import' | 'sync' | 'file' | 'probable'
  match: {
    id: string
    date: string
    valueDate: string | null
    label: string | null
    amount: string
    source: 'file' | 'sync'
    format: string | null
  } | null
}

const row = (over: Partial<Row> & Pick<Row, 'index' | 'line' | 'label' | 'amount'>): Row => ({
  key: `k${over.index}`,
  bookingDate: '2026-03-02',
  valueDate: null,
  reference: null,
  counterparty: null,
  duplicate: false,
  match: null,
  ...over,
})

const tabular = {
  delimiter: ';',
  headerRow: 2,
  headers: ['Date', 'Libellé', 'Montant', 'Débit', 'Crédit'],
  sampleRows: [['02/03/2026', 'LOYER MARS', '-1200,00', '', '']],
  mapping: { date: 0, label: 1, debit: 3, credit: 4 },
  dateFormat: 'dd/mm/yyyy' as const,
  decimalSeparator: ',' as const,
  preset: { id: 'bnp-paribas', name: 'BNP Paribas' },
  confidence: 'high' as const,
}

type Preview = Record<string, unknown> & { summary: Record<string, unknown> }

function preview(over: Partial<Preview> = {}): Preview {
  return {
    format: 'csv',
    encoding: 'windows-1252',
    tabular,
    probable: [],
    warnings: [],
    errors: [],
    errorCount: 0,
    rows: [
      row({ index: 0, line: 4, label: 'LOYER MARS', amount: '-1200.00', reference: 'REF-LOY' }),
      row({ index: 1, line: 5, label: 'VIR CLIENT DUPONT', amount: '2500.50', bookingDate: '2026-03-31' }),
      row({ index: 2, line: 6, label: 'PRLV EDF', amount: '-80.00', duplicate: 'import' }),
      row({ index: 3, line: 7, label: 'CB AMAZON', amount: '-15.00', duplicate: 'sync' }),
      row({ index: 4, line: 8, label: 'CB AMAZON BIS', amount: '-15.00', duplicate: 'file' }),
    ],
    ...over,
    summary: {
      total: 5,
      new: 2,
      duplicates: 3,
      probable: 0,
      probableKept: 0,
      from: '2026-03-02',
      to: '2026-03-31',
      debitsCents: 120000,
      creditsCents: 250050,
      ...over.summary,
    },
  }
}

const fetchMock = vi.fn()

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** The FormData of the n-th call to the import route. */
function sentForm(n = 0): FormData {
  const calls = fetchMock.mock.calls.filter(([url]) => url === '/api/banking/import-statement')
  const init = calls[n]?.[1] as RequestInit | undefined
  expect(init?.method).toBe('POST')
  return init?.body as FormData
}

const csv = () => new File(['Date;Libellé;Montant\n'], 'releve-mars.csv', { type: 'text/csv' })

function fileInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')
  if (!input) throw new Error('file input not found')
  return input
}

async function openWithFile(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Importer un relevé' }))
  await user.upload(fileInput(), csv())
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  vi.mocked(toast.success).mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  window.history.replaceState(null, '', '/')
})

describe('importSummary', () => {
  it('names imported lines, exact and probable duplicates with French plurals', () => {
    expect(importSummary({ created: 0, duplicates: 0, probableSkipped: 0 })).toBe('0 opération importée')
    expect(importSummary({ created: 1, duplicates: 1, probableSkipped: 1 })).toBe(
      '1 opération importée, 1 doublon ignoré, 1 doublon probable ignoré',
    )
    expect(importSummary({ created: 12, duplicates: 2, probableSkipped: 3 })).toBe(
      '12 opérations importées, 2 doublons ignorés, 3 doublons probables ignorés',
    )
  })
})

describe('StatementImportDialog', () => {
  it('previews the file with an exact multipart request, then shows the summary and rows', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(respond(200, preview()))
    render(<StatementImportDialog companyId="co-1" accounts={[COURANT]} />)

    await user.click(screen.getByRole('button', { name: 'Importer un relevé' }))
    const analyze = screen.getByRole('button', { name: 'Analyser le fichier' })
    // A single account is chosen for the user; the file is still missing
    expect(analyze).toBeDisabled()

    await user.upload(fileInput(), csv())
    expect(screen.getByText('releve-mars.csv')).toBeInTheDocument()
    expect(analyze).toBeEnabled()
    await user.click(analyze)

    await screen.findByText('Format détecté :')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/banking/import-statement')
    const form = sentForm()
    expect(form.get('companyId')).toBe('co-1')
    expect(form.get('bankAccountId')).toBe('ba-1')
    expect(form.get('mode')).toBe('preview')
    expect((form.get('file') as File).name).toBe('releve-mars.csv')
    // No forced options and no error override on a first analysis
    expect(form.has('options')).toBe(false)
    expect(form.has('allowErrors')).toBe(false)
    expect(form.has('keep')).toBe(false)

    const badges = within(screen.getByText('Format détecté :').parentElement as HTMLElement)
    expect(badges.getByText('CSV')).toBeInTheDocument()
    expect(badges.getByText('Windows-1252')).toBeInTheDocument()
    expect(badges.getByText('séparateur point-virgule')).toBeInTheDocument()
    expect(badges.getByText('Modèle BNP Paribas')).toBeInTheDocument()
    expect(badges.queryByText('Colonnes à vérifier')).not.toBeInTheDocument()

    const tile = (label: string) => screen.getByText(label).closest('div') as HTMLElement
    expect(within(tile('À importer')).getByText('2')).toBeInTheDocument()
    expect(within(tile('Doublons exacts ignorés')).getByText('3')).toBeInTheDocument()
    expect(within(tile('Période')).getByText('Du 02/03/2026 au 31/03/2026')).toBeInTheDocument()
    // Debits shown negative, credits with an explicit plus sign (summary cents / 100)
    const amounts = within(tile('Débits et crédits'))
      .getAllByText(/€/)
      .map((el) => norm(el.textContent))
    expect(amounts).toEqual(['-1 200,00 €', '+2 500,50 €'])

    expect(screen.getByText('Aperçu :')).toBeInTheDocument()
    // "LOYER MARS" is also a raw sample line of the column mapping: find the preview row by its reference
    const loyer = screen.getByText('REF-LOY').closest('tr') as HTMLElement
    expect(within(loyer).getByText('LOYER MARS')).toBeInTheDocument()
    // One badge for phones, one in the Statut column
    expect(within(loyer).getAllByText('Nouvelle')).toHaveLength(2)
    expect(norm(within(loyer).getByText(/€/).textContent)).toBe('-1 200,00 €')
    const edf = screen.getByText('PRLV EDF').closest('tr') as HTMLElement
    expect(within(edf).getAllByText('Déjà importée')).toHaveLength(2)
    expect(edf).toHaveClass('text-muted-foreground')
    expect(within(screen.getByText('CB AMAZON').closest('tr') as HTMLElement).getAllByText('Déjà synchronisée')).toHaveLength(2)
    expect(within(screen.getByText('CB AMAZON BIS').closest('tr') as HTMLElement).getAllByText('Doublon dans le fichier')).toHaveLength(2)

    expect(screen.getByRole('button', { name: 'Importer 2 opérations' })).toBeEnabled()
  })

  it('imports after the preview: toast with the server counts, callback, dialog closed', async () => {
    const user = userEvent.setup()
    const onImported = vi.fn()
    fetchMock
      .mockResolvedValueOnce(respond(200, preview()))
      .mockResolvedValueOnce(respond(200, { created: 2, duplicates: 3, probableSkipped: 0 }))
    render(<StatementImportDialog companyId="co-1" accounts={[COURANT]} onImported={onImported} />)

    await openWithFile(user)
    await user.click(screen.getByRole('button', { name: 'Analyser le fichier' }))
    await user.click(await screen.findByRole('button', { name: 'Importer 2 opérations' }))

    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1))
    const form = sentForm(1)
    expect(form.get('mode')).toBe('import')
    expect(form.get('bankAccountId')).toBe('ba-1')
    expect((form.get('file') as File).name).toBe('releve-mars.csv')
    expect(form.has('keep')).toBe(false)
    expect(toast.success).toHaveBeenCalledWith('2 opérations importées, 3 doublons ignorés')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    // Reopening starts from scratch
    await user.click(screen.getByRole('button', { name: 'Importer un relevé' }))
    expect(screen.getByText('Aucun fichier choisi')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Analyser le fichier' })).toBeDisabled()
  })

  it('shows the API error of a refused preview and keeps the analyse step', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(respond(422, { error: 'Le fichier ne contient aucune opération.' }))
    render(<StatementImportDialog companyId="co-1" accounts={[COURANT]} />)

    await openWithFile(user)
    await user.click(screen.getByRole('button', { name: 'Analyser le fichier' }))

    expect(await screen.findByText('Le fichier ne contient aucune opération.')).toBeInTheDocument()
    expect(screen.queryByText('Format détecté :')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Analyser le fichier' })).toBeEnabled()
  })

  it('falls back to a French message when the error body is missing or unreadable', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(respond(500, {}))
      .mockResolvedValueOnce(new Response('<html>Bad gateway</html>', { status: 502 }))
    render(<StatementImportDialog companyId="co-1" accounts={[COURANT]} />)

    await openWithFile(user)
    await user.click(screen.getByRole('button', { name: 'Analyser le fichier' }))
    expect(await screen.findByText("Erreur lors de l'import du fichier.")).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Analyser le fichier' }))
    expect(await screen.findByText('Réponse du serveur illisible.')).toBeInTheDocument()
  })

  it('keeps the dialog open with the error when the import itself fails', async () => {
    const user = userEvent.setup()
    const onImported = vi.fn()
    fetchMock
      .mockResolvedValueOnce(respond(200, preview()))
      .mockResolvedValueOnce(respond(409, { error: 'Un import est déjà en cours sur ce compte.' }))
    render(<StatementImportDialog companyId="co-1" accounts={[COURANT]} onImported={onImported} />)

    await openWithFile(user)
    await user.click(screen.getByRole('button', { name: 'Analyser le fichier' }))
    await user.click(await screen.findByRole('button', { name: 'Importer 2 opérations' }))

    expect(await screen.findByText('Un import est déjà en cours sur ce compte.')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onImported).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('asks for the bank account when there are several, and sends the chosen one', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(respond(200, preview()))
    render(<StatementImportDialog companyId="co-1" accounts={[COURANT, EPARGNE]} />)

    await openWithFile(user)
    const analyze = screen.getByRole('button', { name: 'Analyser le fichier' })
    expect(analyze).toBeDisabled()

    await user.click(screen.getByRole('combobox', { name: 'Compte bancaire' }))
    // A real name shows the IBAN tail next to it; a Qonto slug is replaced by "Compte •••• 5987"
    expect(await screen.findByRole('option', { name: /^Compte courant\s*•••• 0143$/ })).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: 'Compte •••• 5987' }))

    expect(analyze).toBeEnabled()
    await user.click(analyze)
    await screen.findByText('Format détecté :')
    expect(sentForm().get('bankAccountId')).toBe('ba-2')
  })

  it('preselects the default account among several', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(respond(200, preview()))
    render(<StatementImportDialog companyId="co-1" accounts={[COURANT, EPARGNE]} defaultAccountId="ba-2" />)

    await openWithFile(user)
    await user.click(screen.getByRole('button', { name: 'Analyser le fichier' }))
    await screen.findByText('Format détecté :')
    expect(sentForm().get('bankAccountId')).toBe('ba-2')
  })

  describe('probable duplicates', () => {
    const probable = [
      row({
        index: 5,
        key: 'p5',
        line: 9,
        label: 'PRLV SEPA ORANGE',
        amount: '-45.90',
        bookingDate: '2026-02-27',
        duplicate: 'probable',
        match: { id: 't1', date: '2026-02-27', valueDate: null, label: 'ORANGE SA', amount: '-45.90', source: 'sync', format: null },
      }),
      row({
        index: 6,
        key: 'p6',
        line: 10,
        label: 'REMISE CHEQUE',
        amount: '300.00',
        bookingDate: '2026-03-10',
        duplicate: 'probable',
        match: { id: 't2', date: '2026-03-10', valueDate: null, label: null, amount: '300.00', source: 'file', format: 'ofx' },
      }),
    ]

    it('skips them by default and imports a line the user unchecks, with its key and index', async () => {
      const user = userEvent.setup()
      fetchMock
        .mockResolvedValueOnce(respond(200, preview({ probable, rows: [probable[0]], summary: { total: 7, new: 2, probable: 2 } })))
        .mockResolvedValueOnce(respond(200, { created: 3, duplicates: 3, probableSkipped: 1 }))
      render(<StatementImportDialog companyId="co-1" accounts={[COURANT]} />)

      await openWithFile(user)
      await user.click(screen.getByRole('button', { name: 'Analyser le fichier' }))
      expect(await screen.findByRole('heading', { name: '2 doublons probables' })).toBeInTheDocument()

      // Where the existing operation comes from
      expect(screen.getByText('27/02/2026, Synchronisation bancaire')).toBeInTheDocument()
      expect(screen.getByText('10/03/2026, Import OFX')).toBeInTheDocument()
      expect(screen.getByText('Sans libellé')).toBeInTheDocument()
      expect(screen.getByText('Déjà présente : 10/03/2026, sans libellé')).toBeInTheDocument()

      const all = screen.getByRole('checkbox', { name: 'Ignorer tous les doublons probables' })
      expect(all).toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'Ignorer la ligne 9' })).toBeChecked()
      expect(screen.getAllByText('Doublon probable')).toHaveLength(2)

      await user.click(screen.getByRole('checkbox', { name: 'Ignorer la ligne 9' }))
      expect(all).toHaveAttribute('data-state', 'indeterminate')
      const tile = (label: string) => screen.getByText(label).closest('div') as HTMLElement
      expect(within(tile('À importer')).getByText('3')).toBeInTheDocument()
      expect(within(tile('Doublons probables')).getByText('dont 1 importé')).toBeInTheDocument()
      // The kept line (27/02) widens the period and adds its 45,90 € to the debits
      expect(within(tile('Période')).getByText('Du 27/02/2026 au 31/03/2026')).toBeInTheDocument()
      expect(within(tile('Débits et crédits')).getAllByText(/€/).map((el) => norm(el.textContent))).toEqual([
        '-1 245,90 €',
        '+2 500,50 €',
      ])
      expect(screen.getAllByText('Doublon probable, importé')).toHaveLength(2)

      await user.click(screen.getByRole('button', { name: 'Importer 3 opérations' }))
      await waitFor(() => expect(toast.success).toHaveBeenCalled())
      expect(JSON.parse(sentForm(1).get('keep') as string)).toEqual([{ index: 5, key: 'p5' }])
      expect(toast.success).toHaveBeenCalledWith('3 opérations importées, 3 doublons ignorés, 1 doublon probable ignoré')
    })

    it('keeps or ignores them all from the header checkbox', async () => {
      const user = userEvent.setup()
      fetchMock.mockResolvedValueOnce(respond(200, preview({ probable, summary: { new: 0, probable: 2, from: null, to: null, debitsCents: 0, creditsCents: 0 } })))
      render(<StatementImportDialog companyId="co-1" accounts={[COURANT]} />)

      await openWithFile(user)
      await user.click(screen.getByRole('button', { name: 'Analyser le fichier' }))
      const all = await screen.findByRole('checkbox', { name: 'Ignorer tous les doublons probables' })
      // Nothing new and every probable duplicate skipped: nothing to import
      expect(screen.getByRole('button', { name: 'Rien à importer' })).toBeDisabled()
      expect(within(screen.getByText('Période').closest('div') as HTMLElement).getByText('Aucune opération')).toBeInTheDocument()

      await user.click(all)
      expect(all).not.toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'Ignorer la ligne 9' })).not.toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'Ignorer la ligne 10' })).not.toBeChecked()
      expect(screen.getByRole('button', { name: 'Importer 2 opérations' })).toBeEnabled()
      expect(within(screen.getByText('Période').closest('div') as HTMLElement).getByText('Du 27/02/2026 au 10/03/2026')).toBeInTheDocument()

      await user.click(all)
      expect(all).toBeChecked()
      expect(screen.getByRole('button', { name: 'Rien à importer' })).toBeDisabled()
    })
  })

  it('blocks the import on line errors until the user accepts to import the valid lines', async () => {
    const user = userEvent.setup()
    const errors = Array.from({ length: 10 }, (_, i) => ({ line: i + 10, message: `Ligne ${i + 10} : date illisible` }))
    fetchMock
      .mockResolvedValueOnce(respond(200, preview({ errors, errorCount: 10, warnings: ['2 opérations en attente ignorées'] })))
      .mockResolvedValueOnce(respond(200, { created: 2, duplicates: 0, probableSkipped: 0 }))
    render(<StatementImportDialog companyId="co-1" accounts={[COURANT]} />)

    await openWithFile(user)
    await user.click(screen.getByRole('button', { name: 'Analyser le fichier' }))
    expect(await screen.findByText('10 problèmes dans le fichier')).toBeInTheDocument()
    expect(screen.getByText('2 opérations en attente ignorées')).toBeInTheDocument()
    // Only the first 8 messages, then a count of the others
    expect(screen.getByText('Ligne 17 : date illisible')).toBeInTheDocument()
    expect(screen.queryByText('Ligne 18 : date illisible')).not.toBeInTheDocument()
    expect(screen.getByText('et 2 autres')).toBeInTheDocument()

    const importButton = screen.getByRole('button', { name: 'Importer 2 opérations' })
    expect(importButton).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: 'Importer quand même les lignes valides' }))
    expect(importButton).toBeEnabled()

    await user.click(importButton)
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('2 opérations importées'))
    expect(sentForm(1).get('allowErrors')).toBe('true')
  })

  it('opens the column mapping on a blocking file error and re-runs the preview with the chosen column', async () => {
    const user = userEvent.setup()
    const lowConfidence = { ...tabular, confidence: 'low' as const, preset: undefined, mapping: { date: 0, label: 1, debit: 3, credit: 4 } }
    fetchMock
      .mockResolvedValueOnce(
        respond(200, preview({
          tabular: lowConfidence,
          errors: [{ line: 0, message: 'Colonne du montant introuvable.' }],
          errorCount: 1,
          rows: [],
          summary: { new: 0, total: 0, from: null, to: null },
        })),
      )
      .mockResolvedValueOnce(respond(200, preview({ tabular: { ...lowConfidence, mapping: { date: 0, label: 1, amount: 2 } } })))
    render(<StatementImportDialog companyId="co-1" accounts={[COURANT]} />)

    await openWithFile(user)
    await user.click(screen.getByRole('button', { name: 'Analyser le fichier' }))

    expect(await screen.findByText('Colonnes à vérifier')).toBeInTheDocument()
    const details = screen.getByText('Correspondance des colonnes et formats').closest('details') as HTMLDetailsElement
    expect(details.open).toBe(true)
    expect(screen.getByText(/choisissez les colonnes manquantes ci-dessus/)).toBeInTheDocument()
    // A blocking error cannot be overridden
    expect(screen.queryByRole('checkbox', { name: 'Importer quand même les lignes valides' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rien à importer' })).toBeDisabled()
    // Raw lines of the file, with the header position (0-based 2, shown as line 3)
    expect(screen.getByText('Premières lignes du fichier (en-tête trouvé ligne 3) :')).toBeInTheDocument()
    expect(screen.getByText('-1200,00')).toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: 'Montant (signé)' }))
    await user.click(await screen.findByRole('option', { name: 'Montant' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    // A signed amount replaces Débit/Crédit; the header row found is sent back
    expect(JSON.parse(sentForm(1).get('options') as string)).toEqual({
      mapping: { date: 0, label: 1, amount: 2 },
      headerRow: 2,
    })
    expect(await screen.findByRole('button', { name: 'Importer 2 opérations' })).toBeEnabled()
    // The mapping stays open while the user edits it
    expect(details.open).toBe(true)
  })

  it('moves a column to another role and clears the alternative amount columns', async () => {
    const user = userEvent.setup()
    const withAmount = { ...tabular, mapping: { date: 0, label: 1, amount: 2 } }
    fetchMock.mockImplementation(async () => respond(200, preview({ tabular: withAmount })))
    render(<StatementImportDialog companyId="co-1" accounts={[COURANT]} />)

    await openWithFile(user)
    await user.click(screen.getByRole('button', { name: 'Analyser le fichier' }))
    await screen.findByText('Format détecté :')

    // Débit chosen: the signed amount column goes away
    await user.click(screen.getByRole('combobox', { name: 'Débit' }))
    await user.click(await screen.findByRole('option', { name: 'Débit' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(sentForm(1).get('options') as string).mapping).toEqual({ date: 0, label: 1, debit: 3 })

    // The Libellé column given to Référence leaves the Libellé role
    await user.click(screen.getByRole('combobox', { name: 'Référence' }))
    await user.click(await screen.findByRole('option', { name: 'Libellé' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(JSON.parse(sentForm(2).get('options') as string).mapping).toEqual({ date: 0, amount: 2, reference: 1 })

    // "Aucune" removes a role
    await user.click(screen.getByRole('combobox', { name: 'Libellé' }))
    await user.click(await screen.findByRole('option', { name: 'Aucune' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))
    expect(JSON.parse(sentForm(3).get('options') as string).mapping).toEqual({ date: 0, amount: 2 })
  })

  it('re-runs the preview with a forced bank preset, date format, decimal separator and sheet', async () => {
    const user = userEvent.setup()
    const excel = { ...tabular, delimiter: undefined, preset: undefined, sheetNames: ['Opérations', 'Synthèse'] }
    fetchMock.mockImplementation(async () => respond(200, preview({ format: 'xlsx', encoding: null, tabular: excel })))
    render(<StatementImportDialog companyId="co-1" accounts={[COURANT]} />)

    await openWithFile(user)
    await user.click(screen.getByRole('button', { name: 'Analyser le fichier' }))
    expect(await screen.findByText('Excel (.xlsx)')).toBeInTheDocument()
    expect(screen.queryByText(/^séparateur/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: 'Modèle de banque' }))
    await user.click(await screen.findByRole('option', { name: 'Société Générale' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(sentForm(1).get('options') as string)).toEqual({ preset: 'societe-generale' })

    await user.click(screen.getByRole('combobox', { name: 'Format des dates' }))
    await user.click(await screen.findByRole('option', { name: 'MM/JJ/AAAA (américain)' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(JSON.parse(sentForm(2).get('options') as string)).toEqual({ preset: 'societe-generale', dateFormat: 'mm/dd/yyyy' })

    await user.click(screen.getByRole('combobox', { name: 'Séparateur décimal des montants' }))
    await user.click(await screen.findByRole('option', { name: 'Point (1,234.56)' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))
    expect(JSON.parse(sentForm(3).get('options') as string)).toEqual({
      preset: 'societe-generale',
      dateFormat: 'mm/dd/yyyy',
      decimalSeparator: '.',
    })

    // Another sheet starts a fresh detection on that sheet
    await user.click(screen.getByRole('combobox', { name: 'Feuille du classeur' }))
    await user.click(await screen.findByRole('option', { name: 'Synthèse' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5))
    expect(JSON.parse(sentForm(4).get('options') as string)).toEqual({ sheetName: 'Synthèse' })

    // A preset keeps the chosen sheet, and back to automatic detection keeps the sheet only
    await user.click(screen.getByRole('combobox', { name: 'Modèle de banque' }))
    await user.click(await screen.findByRole('option', { name: 'BNP Paribas' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6))
    expect(JSON.parse(sentForm(5).get('options') as string)).toEqual({ sheetName: 'Synthèse', preset: 'bnp-paribas' })
    await user.click(screen.getByRole('combobox', { name: 'Modèle de banque' }))
    await user.click(await screen.findByRole('option', { name: 'Détection automatique' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(7))
    expect(JSON.parse(sentForm(6).get('options') as string)).toEqual({ sheetName: 'Synthèse' })
  })

  it('says when the preview shows only the first operations of a long file', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(respond(200, preview({ format: 'ofx', encoding: 'utf-8', tabular: null, summary: { total: 240 } })))
    render(<StatementImportDialog companyId="co-1" accounts={[COURANT]} />)

    await openWithFile(user)
    await user.click(screen.getByRole('button', { name: 'Analyser le fichier' }))
    expect(await screen.findByText('Aperçu des 5 premières opérations sur 240 :')).toBeInTheDocument()
    expect(screen.getByText('OFX / QFX')).toBeInTheDocument()
    expect(screen.getByText('UTF-8')).toBeInTheDocument()
    expect(screen.queryByText('Correspondance des colonnes et formats')).not.toBeInTheDocument()
  })

  it('drops the preview when another file is chosen', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(respond(200, preview()))
    render(<StatementImportDialog companyId="co-1" accounts={[COURANT]} />)

    await openWithFile(user)
    await user.click(screen.getByRole('button', { name: 'Analyser le fichier' }))
    await screen.findByText('Format détecté :')

    await user.upload(fileInput(), new File(['x'], 'avril.ofx'))
    expect(screen.queryByText('Format détecté :')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Analyser le fichier' })).toBeEnabled()
  })

  it('is disabled with the reason for a role that cannot reconcile', () => {
    render(
      <CompanyAccessProvider value={{ granted: { banking: ['read'] }, roleLabel: 'Lecteur' }}>
        <StatementImportDialog companyId="co-1" accounts={[COURANT]} />
      </CompanyAccessProvider>,
    )
    const trigger = screen.getByRole('button', { name: 'Importer un relevé' })
    expect(trigger).toBeDisabled()
    expect(norm(trigger.getAttribute('title'))).toBe(
      "Votre rôle (Lecteur) ne permet pas d'importer un relevé : demandez-le à un administrateur de la société.",
    )
  })

  it('reports open state changes to a controlling page', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const { rerender } = render(<StatementImportDialog companyId="co-1" accounts={[COURANT]} open={false} onOpenChange={onOpenChange} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    rerender(<StatementImportDialog companyId="co-1" accounts={[COURANT]} open onOpenChange={onOpenChange} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
  })

  it('announces its open and preview state to external file sources', async () => {
    const user = userEvent.setup()
    const states: Array<{ open: boolean; hasPreview: boolean }> = []
    const listener = (e: Event) => states.push((e as CustomEvent<{ open: boolean; hasPreview: boolean }>).detail)
    window.addEventListener(IMPORT_DIALOG_STATE_EVENT, listener)
    fetchMock.mockResolvedValueOnce(respond(200, preview()))
    const { unmount } = render(<StatementImportDialog companyId="co-1" accounts={[COURANT]} />)

    await openWithFile(user)
    await user.click(screen.getByRole('button', { name: 'Analyser le fichier' }))
    await screen.findByText('Format détecté :')
    unmount()
    window.removeEventListener(IMPORT_DIALOG_STATE_EVENT, listener)

    expect(states[0]).toEqual({ open: false, hasPreview: false })
    expect(states).toContainEqual({ open: true, hasPreview: false })
    expect(states).toContainEqual({ open: true, hasPreview: true })
    expect(states[states.length - 1]).toEqual({ open: false, hasPreview: false })
  })

  describe('files handed over without the picker', () => {
    /** jsdom has no DragEvent: a plain event carrying a DataTransfer-like object. */
    function dragEvent(type: string, data: { files?: File[]; token?: string }): Event {
      const event = new Event(type, { bubbles: true, cancelable: true })
      const types = [...(data.files ? ['Files'] : []), ...(data.token ? [EXTERNAL_FILE_DRAG_TYPE] : [])]
      const dataTransfer = {
        types,
        files: data.files ?? [],
        dropEffect: 'none',
        getData: (format: string) => (format === EXTERNAL_FILE_DRAG_TYPE ? (data.token ?? '') : ''),
      }
      Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
      return event
    }

    it('shows a page-wide drop target and analyses a file dropped anywhere', async () => {
      fetchMock.mockResolvedValueOnce(respond(200, preview()))
      render(<StatementImportDialog companyId="co-1" accounts={[COURANT]} />)
      const file = csv()

      act(() => {
        window.dispatchEvent(dragEvent('dragenter', { files: [file] }))
      })
      expect(screen.getByText('Déposez le relevé pour l’importer')).toBeInTheDocument()
      const over = dragEvent('dragover', { files: [file] })
      act(() => {
        window.dispatchEvent(over)
      })
      expect(over.defaultPrevented).toBe(true)

      // A drag without a file (text selection) is ignored
      act(() => {
        window.dispatchEvent(dragEvent('dragleave', {}))
      })
      expect(screen.getByText('Déposez le relevé pour l’importer')).toBeInTheDocument()

      await act(async () => {
        window.dispatchEvent(dragEvent('drop', { files: [file] }))
      })
      expect(await screen.findByText('Format détecté :')).toBeInTheDocument()
      expect(screen.queryByText('Déposez le relevé pour l’importer')).not.toBeInTheDocument()
      expect(sentForm().get('mode')).toBe('preview')
      expect((sentForm().get('file') as File).name).toBe('releve-mars.csv')
    })

    it('hides the drop target when the drag leaves the page', () => {
      render(<StatementImportDialog companyId="co-1" accounts={[COURANT]} />)
      const file = csv()
      act(() => {
        window.dispatchEvent(dragEvent('dragenter', { files: [file] }))
        window.dispatchEvent(dragEvent('dragleave', { files: [file] }))
      })
      expect(screen.queryByText('Déposez le relevé pour l’importer')).not.toBeInTheDocument()
    })

    it('offers no drop target to a role that cannot import', () => {
      render(
        <CompanyAccessProvider value={{ granted: { banking: ['read'] }, roleLabel: 'Lecteur' }}>
          <StatementImportDialog companyId="co-1" accounts={[COURANT]} />
        </CompanyAccessProvider>,
      )
      act(() => {
        window.dispatchEvent(dragEvent('dragenter', { files: [csv()] }))
      })
      expect(screen.queryByText('Déposez le relevé pour l’importer')).not.toBeInTheDocument()
    })

    it('asks for the account when a dropped file does not say which one', async () => {
      render(<StatementImportDialog companyId="co-1" accounts={[COURANT, EPARGNE]} />)
      await act(async () => {
        window.dispatchEvent(dragEvent('drop', { files: [csv()] }))
      })
      expect(await screen.findByText('Choisissez le compte bancaire, puis analysez le fichier.')).toBeInTheDocument()
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('analyses a registered external file dropped on the dialog, on its own account', async () => {
      const user = userEvent.setup()
      fetchMock.mockResolvedValueOnce(respond(200, preview()))
      const token = registerExternalFile({ fileName: 'qonto-mars.csv', load: async () => new File(['x'], 'qonto-mars.csv'), bankAccountId: 'ba-2' })
      render(<StatementImportDialog companyId="co-1" accounts={[COURANT, EPARGNE]} />)
      await user.click(screen.getByRole('button', { name: 'Importer un relevé' }))

      const zone = screen.getByRole('dialog')
      const over = dragEvent('dragover', { token })
      act(() => {
        zone.dispatchEvent(over)
      })
      expect(screen.getByText('Déposez le fichier ici')).toBeInTheDocument()
      await act(async () => {
        zone.dispatchEvent(dragEvent('drop', { token }))
      })

      await screen.findByText('Format détecté :')
      expect(sentForm().get('bankAccountId')).toBe('ba-2')
      expect((sentForm().get('file') as File).name).toBe('qonto-mars.csv')
      unregisterExternalFile(token)
    })

    it('loads a file asked for by an external source through the window event', async () => {
      fetchMock.mockResolvedValueOnce(respond(200, preview()))
      const token = registerExternalFile({ fileName: 'mars.csv', load: async () => new File(['x'], 'mars.csv'), bankAccountId: 'ba-1' })
      render(<StatementImportDialog companyId="co-1" accounts={[COURANT, EPARGNE]} />)

      const event = new CustomEvent(IMPORT_FILE_EVENT, { detail: { token }, cancelable: true })
      await act(async () => {
        window.dispatchEvent(event)
      })
      // Cancelled: the source knows the dialog took the file
      expect(event.defaultPrevented).toBe(true)
      await screen.findByText('Format détecté :')
      expect(sentForm().get('bankAccountId')).toBe('ba-1')

      // An unknown token is left alone
      const unknown = new CustomEvent(IMPORT_FILE_EVENT, { detail: { token: 'forged' }, cancelable: true })
      window.dispatchEvent(unknown)
      expect(unknown.defaultPrevented).toBe(false)
      unregisterExternalFile(token)
    })

    it('shows the error when an external file cannot be loaded', async () => {
      const token = registerExternalFile({
        fileName: 'mars.csv',
        load: async () => {
          throw new Error('Téléchargement du relevé impossible.')
        },
      })
      render(<StatementImportDialog companyId="co-1" accounts={[COURANT]} />)
      await act(async () => {
        window.dispatchEvent(new CustomEvent(IMPORT_FILE_EVENT, { detail: { token }, cancelable: true }))
      })
      expect(await screen.findByText('Téléchargement du relevé impossible.')).toBeInTheDocument()
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      unregisterExternalFile(token)
    })

    it('loads the file named by ?importFile= after a navigation and cleans the URL', async () => {
      fetchMock.mockResolvedValueOnce(respond(200, preview()))
      const token = registerExternalFile({ fileName: 'mars.csv', load: async () => new File(['x'], 'mars.csv') })
      window.history.replaceState(null, '', `/co-1/banking/statements?importFile=${token}&tab=files`)
      render(<StatementImportDialog companyId="co-1" accounts={[COURANT]} />)

      expect(window.location.search).toBe('?tab=files')
      expect(await screen.findByText('Format détecté :')).toBeInTheDocument()
      expect((sentForm().get('file') as File).name).toBe('mars.csv')
      unregisterExternalFile(token)
    })

    it('ignores an unknown ?importFile= token but still cleans the URL', () => {
      window.history.replaceState(null, '', '/co-1/banking/statements?importFile=forged')
      render(<StatementImportDialog companyId="co-1" accounts={[COURANT]} />)
      expect(window.location.search).toBe('')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })
})
