import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'

const pushMock = vi.hoisted(() => vi.fn())
const refreshMock = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { CompanyWizard } from '../company-wizard'

const fetchMock = vi.fn()

/** Matches a French formatted amount whatever the no-break spaces are (U+202F, U+00A0). */
const amount = (text: string) => new RegExp(text.replace(/ /g, '\\s'))

// SIREN numbers that pass, and fail, the Luhn check INSEE applies to SIREN
// (INSEE, "Le numéro SIREN": 8 digits plus a Luhn check digit).
const VALID_SIREN = '732829320'
const INVALID_SIREN = '123456789'

beforeEach(() => {
  // The wizard reads the browser's local day: freeze it (Date only, so
  // user-event timers keep running).
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-03-15T12:00:00'))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('scrollTo', vi.fn())
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  vi.clearAllMocks()
})

/**
 * The SIREN input. Not found by its label: the Field wraps a div (input plus
 * search button), so the label points at the div (see the skipped test).
 */
function sirenInput(): HTMLInputElement {
  return document.getElementById('siren') as HTMLInputElement
}

/** The legal form trigger: unlabelled for the same reason (see the skipped test). */
function legalTypeTrigger(): HTMLElement {
  return document.getElementById('legalType') as HTMLElement
}

async function fillIdentity(user: UserEvent, name = 'Atelier Lumen', siren = '732 829 320') {
  await user.type(screen.getByRole('textbox', { name: 'Nom de la société' }), name)
  await user.type(sirenInput(), siren)
}

async function continueTo(user: UserEvent, title: string) {
  await user.click(screen.getByRole('button', { name: 'Continuer' }))
  await screen.findByText(title, { ignore: 'nav *, script, style' })
}

async function chooseRegimes(user: UserEvent) {
  await user.click(screen.getByRole('radio', { name: /Réel simplifié/ }))
  await user.click(screen.getByRole('radio', { name: /Régime simplifié d'imposition/ }))
}

async function chooseLegalType(user: UserEvent, option: RegExp) {
  await user.click(legalTypeTrigger())
  await user.click(await screen.findByRole('option', { name: option }))
}

describe('CompanyWizard, identity step', () => {
  it('refuses to continue without a name and a 9 digit SIREN', async () => {
    const user = userEvent.setup()
    render(<CompanyWizard />)
    await user.click(screen.getByRole('button', { name: 'Continuer' }))
    expect(await screen.findByText('Indiquez le nom de la société.')).toBeInTheDocument()
    expect(screen.getByText('Le SIREN compte exactement 9 chiffres.')).toBeInTheDocument()
    expect(screen.getByText('Identité de la société')).toBeInTheDocument()
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('Identité')
  })

  // The SIREN label names the input, and its hint describes it (Field wraps the input and its button)
  it('labels the SIREN input and wires its hint', () => {
    render(<CompanyWizard />)
    const input = screen.getByRole('textbox', { name: 'SIREN' })
    expect(input).toHaveAccessibleDescription(/Les 9 chiffres du numéro/)
  })

  // A Radix Select root renders nothing: the label targets its trigger by id
  it('labels the legal form select', () => {
    render(<CompanyWizard />)
    expect(screen.getByRole('combobox', { name: /Forme juridique/ })).toBeInTheDocument()
  })

  it('warns about a SIREN that fails the INSEE Luhn check, as a hint only', async () => {
    const user = userEvent.setup()
    render(<CompanyWizard />)
    const siren = sirenInput()
    expect(screen.getByText(/Les 9 chiffres du numéro/)).toBeInTheDocument()
    await user.type(siren, INVALID_SIREN)
    expect(screen.getByText(/^Ce numéro ne passe pas le contrôle du SIREN\s: vérifiez-le\.$/)).toBeInTheDocument()
    await user.clear(siren)
    await user.type(siren, '732 829 320')
    expect(screen.queryByText(/ne passe pas le contrôle/)).not.toBeInTheDocument()
  })

  it('does not call the directory for a SIREN that is not 9 digits', async () => {
    const user = userEvent.setup()
    render(<CompanyWizard />)
    await user.type(sirenInput(), '12345')
    await user.click(screen.getByRole('button', { name: 'Rechercher' }))
    expect(await screen.findByText('Le SIREN compte exactement 9 chiffres.')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('prefills the identity from the public directory and explains the SAS/SASU ambiguity', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        status: 'found',
        company: {
          siren: VALID_SIREN,
          name: 'ATELIER LUMEN',
          legalType: 'SAS',
          natureJuridique: '5710',
          activityCode: '62.01Z',
          creationDate: '2026-02-01',
          active: false,
          headOffice: { siret: '73282932000074', street: '12 rue des Artisans', street2: null, postalCode: '69001', city: 'Lyon' },
        },
      }),
    )
    const user = userEvent.setup()
    render(<CompanyWizard />)
    await user.type(sirenInput(), '732 829 320{Enter}')

    expect(await screen.findByText("Société trouvée dans l'annuaire des entreprises")).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(`/api/companies/lookup?siren=${VALID_SIREN}`)
    expect(screen.getByRole('textbox', { name: 'Nom de la société' })).toHaveValue('ATELIER LUMEN')
    expect(screen.getByRole('textbox', { name: /Code NAF/ })).toHaveValue('62.01Z')
    expect(screen.getByRole('textbox', { name: /SIRET du siège/ })).toHaveValue('73282932000074')
    expect(screen.getByRole('textbox', { name: /^Adresse/ })).toHaveValue('12 rue des Artisans')
    expect(screen.getByRole('textbox', { name: /Ville/ })).toHaveValue('Lyon')
    expect(screen.getByRole('textbox', { name: /Date de création/ })).toHaveValue('01/02/2026')
    expect(legalTypeTrigger()).toHaveTextContent('SAS (Société par actions simplifiée)')
    // INSEE legal category 5710 covers both SAS and SASU (INSEE, catégories juridiques niveau III).
    expect(screen.getByText(/L'Insee ne distingue pas SAS et SASU/)).toBeInTheDocument()
    expect(screen.getByText(/cette société est indiquée comme cessée/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Voir la fiche publique/ })).toHaveAttribute(
      'href',
      `https://annuaire-entreprises.data.gouv.fr/entreprise/${VALID_SIREN}`,
    )

    // A company created on 2026-02-01 is in its first exercice, closing on
    // 31/12/2026, and the SAS form defaults to corporate tax.
    await continueTo(user, 'Premier exercice dans Kledg')
    expect(screen.getByRole('textbox', { name: /Début de l'exercice/ })).toHaveValue('01/02/2026')
    expect(screen.getByRole('textbox', { name: /Date de clôture/ })).toHaveValue('31/12/2026')
    expect(screen.getByRole('radio', { name: /La société vient d'être créée/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Régime simplifié d'imposition/ })).toBeChecked()
    expect(screen.getByText(/Exercice de/)).toHaveTextContent('Exercice de 11 mois, du 01/02/2026 au 31/12/2026.')
  })

  it('explains the SARL/EURL ambiguity for INSEE category 5499', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        status: 'found',
        company: { siren: VALID_SIREN, name: 'X', legalType: null, natureJuridique: '5499', activityCode: null, creationDate: null, active: true, headOffice: null },
      }),
    )
    const user = userEvent.setup()
    render(<CompanyWizard />)
    await user.type(sirenInput(), VALID_SIREN)
    await user.click(screen.getByRole('button', { name: 'Rechercher' }))
    expect(await screen.findByText(/L'Insee ne distingue pas SARL et EURL/)).toBeInTheDocument()
    expect(screen.queryByText(/indiquée comme cessée/)).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /Code NAF/ })).toHaveValue('')
  })

  it('says when the directory has no such company', async () => {
    fetchMock.mockResolvedValue(Response.json({ status: 'not_found' }))
    const user = userEvent.setup()
    render(<CompanyWizard />)
    await user.type(sirenInput(), VALID_SIREN)
    await user.click(screen.getByRole('button', { name: 'Rechercher' }))
    expect(await screen.findByText(/Aucune société publique avec ce SIREN/)).toBeInTheDocument()
  })

  it('shows the API error of a failed lookup, or a default message when the directory is down', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'Trop de recherches, réessayez dans une minute.' }, { status: 429 }))
    const user = userEvent.setup()
    render(<CompanyWizard />)
    await user.type(sirenInput(), VALID_SIREN)
    await user.click(screen.getByRole('button', { name: 'Rechercher' }))
    expect(await screen.findByText('Trop de recherches, réessayez dans une minute.')).toBeInTheDocument()

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await user.click(screen.getByRole('button', { name: 'Rechercher' }))
    expect(await screen.findByText(/L'annuaire des entreprises ne répond pas pour l'instant/)).toBeInTheDocument()

    fetchMock.mockResolvedValueOnce(new Response('oops', { status: 502 }))
    await user.click(screen.getByRole('button', { name: 'Rechercher' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(await screen.findByText(/L'annuaire des entreprises ne répond pas pour l'instant/)).toBeInTheDocument()
  })

  it('warns before leaving the page once something is typed', async () => {
    const add = vi.spyOn(window, 'addEventListener')
    const user = userEvent.setup()
    render(<CompanyWizard />)
    expect(add).not.toHaveBeenCalledWith('beforeunload', expect.any(Function))
    await user.type(screen.getByRole('textbox', { name: 'Nom de la société' }), 'A')
    expect(add).toHaveBeenCalledWith('beforeunload', expect.any(Function))
    const handler = add.mock.calls.find(([type]) => type === 'beforeunload')![1] as (e: Event) => void
    const event = new Event('beforeunload', { cancelable: true })
    handler(event)
    expect(event.defaultPrevented).toBe(true)
    add.mockRestore()
  })
})

describe('CompanyWizard, fiscal year and taxes', () => {
  it('suggests the calendar year in progress for an existing company and requires both regimes', async () => {
    const user = userEvent.setup()
    render(<CompanyWizard />)
    await fillIdentity(user)
    await continueTo(user, 'Premier exercice dans Kledg')

    expect(screen.getByRole('textbox', { name: /Début de l'exercice/ })).toHaveValue('01/01/2026')
    expect(screen.getByRole('textbox', { name: /Date de clôture/ })).toHaveValue('31/12/2026')
    expect(screen.getByRole('radio', { name: /La société existait déjà/ })).toBeChecked()
    expect(screen.getByText(/Exercice de/)).toHaveTextContent('Exercice de 12 mois, du 01/01/2026 au 31/12/2026.')

    await user.click(screen.getByRole('button', { name: 'Continuer' }))
    expect(await screen.findByText('Choisissez le régime de TVA.')).toBeInTheDocument()
    expect(screen.getByText("Choisissez le régime d'impôt sur les sociétés.")).toBeInTheDocument()
    expect(screen.getByText('Premier exercice dans Kledg')).toBeInTheDocument()
  })

  it('proposes the first exercice again from a typed creation date, until the user picks dates', async () => {
    const user = userEvent.setup()
    render(<CompanyWizard />)
    await fillIdentity(user)
    // Created in the last quarter: the first exercice closes at the end of the
    // next year rather than after less than three months.
    const creation = screen.getByRole('textbox', { name: /Date de création/ })
    await user.type(creation, '01/11/2025')
    await user.tab()
    await continueTo(user, 'Premier exercice dans Kledg')
    expect(screen.getByRole('textbox', { name: /Début de l'exercice/ })).toHaveValue('01/11/2025')
    expect(screen.getByRole('textbox', { name: /Date de clôture/ })).toHaveValue('31/12/2026')
    expect(screen.getByRole('radio', { name: /La société vient d'être créée/ })).toBeChecked()

    // Starting before the creation date is refused.
    const start = screen.getByRole('textbox', { name: /Début de l'exercice/ })
    await user.clear(start)
    await user.type(start, '01/10/2025')
    await user.tab()
    expect(
      await screen.findByText('Le premier exercice ne peut pas commencer avant la date de création de la société.'),
    ).toBeInTheDocument()

    // Once the user has chosen dates, a new creation date no longer moves them.
    await user.click(screen.getByRole('button', { name: /Retour/ }))
    const again = await screen.findByRole('textbox', { name: /Date de création/ })
    await user.clear(again)
    await user.type(again, '01/02/2026')
    await user.tab()
    await continueTo(user, 'Premier exercice dans Kledg')
    expect(screen.getByRole('textbox', { name: /Début de l'exercice/ })).toHaveValue('01/10/2025')
  })

  it('blocks an exercice that ends before it starts', async () => {
    const user = userEvent.setup()
    render(<CompanyWizard />)
    await fillIdentity(user)
    await continueTo(user, 'Premier exercice dans Kledg')
    const end = screen.getByRole('textbox', { name: /Date de clôture/ })
    await user.clear(end)
    await user.type(end, '31/12/2025')
    await user.tab()
    expect(await screen.findByText("La date de fin de l'exercice doit être après sa date de début.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continuer' })).toBeDisabled()
  })

  it('warns that a non-first exercice should last 12 months (Code de commerce, art. L123-12)', async () => {
    const user = userEvent.setup()
    render(<CompanyWizard />)
    await fillIdentity(user)
    await continueTo(user, 'Premier exercice dans Kledg')
    const end = screen.getByRole('textbox', { name: /Date de clôture/ })
    await user.clear(end)
    await user.type(end, '30/06/2026')
    await user.tab()
    expect(await screen.findByText(/Un exercice dure normalement 12 mois \(Code de commerce, art\. L123-12\)/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continuer' })).toBeEnabled()
  })

  it('refuses a first exercice longer than 24 months (usage of the greffes)', async () => {
    const user = userEvent.setup()
    render(<CompanyWizard />)
    await fillIdentity(user)
    await continueTo(user, 'Premier exercice dans Kledg')
    await user.click(screen.getByRole('radio', { name: /La société vient d'être créée/ }))
    const end = screen.getByRole('textbox', { name: /Date de clôture/ })
    await user.clear(end)
    await user.type(end, '31/03/2028')
    await user.tab()
    expect(
      await screen.findByText(/Le premier exercice ne peut pas dépasser 24 mois .* au plus tard le 31\/12\/2027\./),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continuer' })).toBeDisabled()
  })
})

describe('CompanyWizard, capital and creation', () => {
  it('computes the share capital, checks the shares held, and posts the company', async () => {
    fetchMock.mockResolvedValue(Response.json({ slug: 'atelier-lumen', name: 'Atelier Lumen' }, { status: 201 }))
    const dispatched = vi.fn()
    window.addEventListener('companies:refresh', dispatched)
    const user = userEvent.setup()
    render(<CompanyWizard />)
    await fillIdentity(user, '  Atelier Lumen ')
    await continueTo(user, 'Premier exercice dans Kledg')
    await chooseRegimes(user)
    await user.click(screen.getByRole('checkbox', { name: /sous-comptes facultatifs/ }))
    await continueTo(user, 'Capital et associés')

    expect(screen.getByText('À calculer')).toBeInTheDocument()
    await user.type(screen.getByRole('spinbutton', { name: /Nombre de parts/ }), '1000')
    await user.type(screen.getByRole('textbox', { name: /Valeur nominale/ }), '1,50')
    // 1000 shares of 1,50 EUR: 150 000 cents.
    expect(screen.getByText(amount('1 500,00 €'))).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Ajouter un associé' }))
    // A new shareholder gets the shares not yet held.
    expect(screen.getByRole('spinbutton', { name: 'Parts' })).toHaveValue(1000)
    await user.type(screen.getByRole('textbox', { name: 'Prénom' }), 'Camille')
    await user.type(screen.getByRole('textbox', { name: 'Nom' }), 'Durand')
    const shares = screen.getByRole('spinbutton', { name: 'Parts' })
    await user.clear(shares)
    await user.type(shares, '1200')
    await user.click(screen.getByRole('button', { name: 'Continuer' }))
    expect(await screen.findByText('Les associés détiennent 1200 parts, plus que les 1000 parts du capital.')).toBeInTheDocument()

    await user.clear(shares)
    await user.type(shares, '1000')
    expect(screen.getByText((_, el) => el?.tagName === 'P' && /1000 parts réparties sur 1000\.$/.test(el.textContent ?? ''))).toBeInTheDocument()
    await continueTo(user, 'Vérifier avant de créer')

    const summary = (label: string) => screen.getByText(label, { selector: 'dt' }).nextElementSibling as HTMLElement
    expect(summary('SIREN')).toHaveTextContent('732 829 320')
    expect(summary('Premier exercice')).toHaveTextContent('Du 01/01/2026 au 31/12/2026 (12 mois)')
    expect(summary('TVA')).toHaveTextContent('Réel simplifié')
    expect(summary('Impôt sur les sociétés')).toHaveTextContent("Régime simplifié d'imposition")
    expect(summary('Capital').textContent).toMatch(amount('1 500,00 € \\(1000 parts de 1,50 €\\)'))
    expect(summary('Associés')).toHaveTextContent('Camille Durand : 1000 parts')

    await user.click(screen.getByRole('button', { name: 'Créer la société' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/companies')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body as string)).toEqual({
      name: 'Atelier Lumen',
      siren: VALID_SIREN,
      legalType: null,
      foundationDate: null,
      email: '',
      headOffice: { siret: '' },
      firstFiscalYear: { startDate: '2026-01-01', endDate: '2026-12-31', isFirst: false },
      vatRegime: 'simplified',
      corporateTaxRegime: 'simplified',
      includeOptionalAccounts: true,
      totalShares: 1000,
      // The API takes the nominal value in cents.
      shareNominalValueCents: 150,
      shareholders: [{ type: 'PHYSICAL', firstName: 'Camille', name: 'Durand', numberOfShares: 1000 }],
    })
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/atelier-lumen'))
    expect(toast.success).toHaveBeenCalledWith('Société « Atelier Lumen » créée')
    expect(refreshMock).toHaveBeenCalled()
    expect(dispatched).toHaveBeenCalledTimes(1)
    window.removeEventListener('companies:refresh', dispatched)
  })

  it('removes a shareholder', async () => {
    const user = userEvent.setup()
    render(<CompanyWizard />)
    await fillIdentity(user)
    await continueTo(user, 'Premier exercice dans Kledg')
    await chooseRegimes(user)
    await continueTo(user, 'Capital et associés')
    expect(screen.getByText('Aucun associé ajouté.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Ajouter un associé' }))
    // Without a total, a new shareholder gets one share.
    expect(screen.getByRole('spinbutton', { name: 'Parts' })).toHaveValue(1)
    await user.click(screen.getByRole('button', { name: "Retirer l'associé 1" }))
    expect(screen.getByText('Aucun associé ajouté.')).toBeInTheDocument()
  })

  it('asks for the total of shares once a shareholder is listed', async () => {
    const user = userEvent.setup()
    render(<CompanyWizard />)
    await fillIdentity(user)
    await continueTo(user, 'Premier exercice dans Kledg')
    await chooseRegimes(user)
    await continueTo(user, 'Capital et associés')
    await user.click(screen.getByRole('button', { name: 'Ajouter un associé' }))
    await user.click(screen.getByRole('button', { name: 'Continuer' }))
    expect(await screen.findByText('Indiquez le nombre total de parts pour répartir le capital.')).toBeInTheDocument()
    expect(screen.getByText("Indiquez le prénom de l'associé.")).toBeInTheDocument()
    expect(screen.getByText("Indiquez le nom de l'associé.")).toBeInTheDocument()
  })

  it('names a legal entity shareholder by its dénomination', async () => {
    const user = userEvent.setup()
    render(<CompanyWizard />)
    await fillIdentity(user)
    await continueTo(user, 'Premier exercice dans Kledg')
    await chooseRegimes(user)
    await continueTo(user, 'Capital et associés')
    await user.click(screen.getByRole('button', { name: 'Ajouter un associé' }))
    await user.click(document.getElementById('shareholders-0-type') as HTMLElement)
    await user.click(await screen.findByRole('option', { name: 'Société' }))
    expect(screen.getByRole('textbox', { name: 'Dénomination' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Prénom' })).not.toBeInTheDocument()
  })

  it('sends no capital for an individual entrepreneur and taxes them at the income tax', async () => {
    fetchMock.mockResolvedValue(Response.json({ slug: 'jean-martin', name: 'Jean Martin' }))
    const user = userEvent.setup()
    render(<CompanyWizard />)
    await fillIdentity(user, 'Jean Martin')
    await chooseLegalType(user, /^EI \(Entrepreneur individuel\)$/)
    await continueTo(user, 'Premier exercice dans Kledg')
    // An EI is taxed at the income tax of the entrepreneur by default (CGI art. 8 and 206).
    expect(screen.getByRole('radio', { name: /Pas d'impôt sur les sociétés/ })).toBeChecked()
    await user.click(screen.getByRole('radio', { name: /Franchise en base/ }))
    await continueTo(user, 'Capital et associés')
    expect(screen.getByText(/Un entrepreneur individuel n'a pas de capital social ni d'associés/)).toBeInTheDocument()
    await continueTo(user, 'Vérifier avant de créer')
    const summary = (label: string) => screen.getByText(label, { selector: 'dt' }).nextElementSibling as HTMLElement
    expect(summary('Société')).toHaveTextContent('Entrepreneur individuel')
    expect(summary('TVA')).toHaveTextContent('Franchise en base')
    expect(summary('Impôt sur les sociétés')).toHaveTextContent("Pas d'impôt sur les sociétés")
    expect(screen.queryByText('Capital', { selector: 'dt' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Créer la société' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body).toMatchObject({
      legalType: 'EI',
      vatRegime: 'franchise',
      corporateTaxRegime: null,
      totalShares: null,
      shareNominalValueCents: null,
      shareholders: [],
    })
  })

  it('goes back a step, keeping what was typed', async () => {
    const user = userEvent.setup()
    render(<CompanyWizard />)
    await fillIdentity(user)
    await continueTo(user, 'Premier exercice dans Kledg')
    await user.click(screen.getByRole('button', { name: /Retour/ }))
    expect(await screen.findByText('Identité de la société')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Nom de la société' })).toHaveValue('Atelier Lumen')
  })

  it('shows the API error when the company cannot be created, and lets the user retry', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'Une société avec ce SIREN existe déjà.' }, { status: 409 }))
    const user = userEvent.setup()
    render(<CompanyWizard />)
    await fillIdentity(user)
    await continueTo(user, 'Premier exercice dans Kledg')
    await chooseRegimes(user)
    await continueTo(user, 'Capital et associés')
    await continueTo(user, 'Vérifier avant de créer')
    await user.click(screen.getByRole('button', { name: 'Créer la société' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Une société avec ce SIREN existe déjà.'))
    expect(pushMock).not.toHaveBeenCalled()

    // A success response without a slug is a failure too, with the default message.
    fetchMock.mockResolvedValueOnce(Response.json({}))
    await user.click(screen.getByRole('button', { name: 'Créer la société' }))
    await waitFor(() => expect(toast.error).toHaveBeenLastCalledWith("La société n'a pas pu être créée. Réessayez."))

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await user.click(screen.getByRole('button', { name: 'Créer la société' }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenLastCalledWith(
        "La société n'a pas pu être créée. Vérifiez votre connexion et réessayez.",
      ),
    )
    expect(within(screen.getByRole('navigation', { name: 'Étapes de la création' })).getByRole('listitem', { current: 'step' })).toHaveTextContent('Vérifier')
  })
})

describe('CompanyWizard, display mode step (first run, docs/mode-simple.md)', () => {
  async function createCompany(user: UserEvent) {
    await fillIdentity(user)
    await continueTo(user, 'Premier exercice dans Kledg')
    await chooseRegimes(user)
    await continueTo(user, 'Capital et associés')
    await continueTo(user, 'Vérifier avant de créer')
    await user.click(screen.getByRole('button', { name: 'Créer la société' }))
  }

  it('has four steps without the question', () => {
    render(<CompanyWizard />)
    expect(within(screen.getByRole('navigation', { name: 'Étapes de la création' })).queryByText('Utilisation')).toBeNull()
  })

  it('asks how to use Kledg once the company exists, then opens it in the chosen mode', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ slug: 'atelier-lumen', name: 'Atelier Lumen' }))
    const user = userEvent.setup()
    render(<CompanyWizard askDisplayMode />)
    const steps = screen.getByRole('navigation', { name: 'Étapes de la création' })
    expect(within(steps).getByText('Utilisation')).toBeInTheDocument()
    expect(within(steps).getByText(/Étape 1 sur 5/)).toBeInTheDocument()
    await createCompany(user)

    expect(await screen.findByRole('heading', { name: 'Comment voulez-vous utiliser Kledg ?' })).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Étapes de la création' })).getByText(/Étape 5 sur 5 : Utilisation/)).toBeInTheDocument()
    // The company is created: no way back to its steps, and the page is not left yet
    expect(screen.queryByRole('button', { name: /Retour/ })).toBeNull()
    expect(pushMock).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: 'Inviter votre comptable' })).toHaveAttribute('href', '/atelier-lumen/members')

    fetchMock.mockResolvedValueOnce(Response.json({ mode: 'simple', chosen: true }))
    await user.click(screen.getByRole('button', { name: 'Ouvrir la société' }))
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/atelier-lumen/simple'))
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(url).toBe('/api/account/display-mode')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body as string)).toEqual({ mode: 'simple' })
  })
})
