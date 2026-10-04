/**
 * "Apparence" settings: the preview follows the draft, the theme choice is
 * the header toggle's (next-themes), saving sends the palette and applies
 * it to the page at once, low contrast is flagged, and a refusing instance
 * disables the controls.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const theme = vi.hoisted(() => ({ theme: 'system', resolvedTheme: 'light', setTheme: vi.fn() }))
const router = vi.hoisted(() => ({ refresh: vi.fn() }))
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

vi.mock('next-themes', () => ({ useTheme: () => theme }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))
vi.mock('sonner', () => ({ toast: toasts }))

import { AppearanceSettings } from '../appearance-settings'
import { ChartPalettePreview } from '../chart-palette-preview'
import { CHART_PRESET_DEFINITIONS, DEFAULT_APPEARANCE, type AppearancePreferences } from '@/lib/appearance/palette'
import type { AppearanceView } from '@/lib/appearance/appearance.service'

const view = (appearance: AppearancePreferences = DEFAULT_APPEARANCE, canChange = true): AppearanceView => ({
  appearance,
  isDefault: appearance.palette === 'sobre',
  canChange,
  refusal: canChange ? null : "Cette action est désactivée sur cette instance.",
})

const fetchMock = vi.fn()

function previewStyle() {
  return screen.getByTestId('chart-palette-preview').style
}

beforeEach(() => {
  vi.clearAllMocks()
  theme.resolvedTheme = 'light'
  theme.theme = 'system'
  document.documentElement.removeAttribute('style')
  fetchMock.mockImplementation(async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { palette: AppearancePreferences['palette']; base?: AppearancePreferences['base']; custom?: AppearancePreferences['custom'] }
    const appearance: AppearancePreferences =
      body.palette === 'custom'
        ? { palette: 'custom', base: body.base ?? 'sobre', custom: body.custom ?? { light: {}, dark: {} } }
        : { palette: body.palette, base: body.palette, custom: { light: {}, dark: {} } }
    return new Response(JSON.stringify(view(appearance)), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ChartPalettePreview', () => {
  it('sets the series variables on the preview only, with the real chart components', () => {
    const colors = CHART_PRESET_DEFINITIONS.daltonisme.colors.light
    const { container } = render(<ChartPalettePreview colors={colors} />)
    expect(previewStyle().getPropertyValue('--chart-revenue')).toBe('#0072b2')
    expect(previewStyle().getPropertyValue('--chart-balance')).toBe('#000000')
    expect(container.querySelectorAll('[data-slot="chart"]')).toHaveLength(3)
    expect(screen.getByText('Répartition des charges')).toBeInTheDocument()
    expect(document.documentElement.style.getPropertyValue('--chart-revenue')).toBe('')
  })
})

describe('AppearanceSettings', () => {
  it('previews the chosen preset in the displayed theme before saving', async () => {
    render(<AppearanceSettings initial={view()} />)
    expect(previewStyle().getPropertyValue('--chart-revenue')).toBe(CHART_PRESET_DEFINITIONS.sobre.colors.light.revenue)
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled()

    await userEvent.click(screen.getByRole('radio', { name: /Contrasté/ }))
    expect(previewStyle().getPropertyValue('--chart-revenue')).toBe(CHART_PRESET_DEFINITIONS.contraste.colors.light.revenue)
    expect(document.documentElement.style.getPropertyValue('--chart-revenue-light')).toBe('')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('previews dark values in the dark theme', () => {
    theme.resolvedTheme = 'dark'
    render(<AppearanceSettings initial={view({ palette: 'pastel', base: 'pastel', custom: { light: {}, dark: {} } })} />)
    expect(previewStyle().getPropertyValue('--chart-revenue')).toBe(CHART_PRESET_DEFINITIONS.pastel.colors.dark.revenue)
  })

  it('saves the palette, then applies it to the page without a reload', async () => {
    render(<AppearanceSettings initial={view()} />)
    await userEvent.click(screen.getByRole('radio', { name: /Daltonisme/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))

    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith('Couleurs enregistrées'))
    expect(fetchMock).toHaveBeenCalledWith('/api/account/appearance', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ palette: 'daltonisme' }) }))
    expect(document.documentElement.style.getPropertyValue('--chart-revenue-light')).toBe('#0072b2')
    expect(document.documentElement.style.getPropertyValue('--chart-revenue-dark')).toBe('#56b4e9')
    expect(router.refresh).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled()
  })

  it('edits one colour of the custom palette, flags low contrast, and saves the theme it belongs to', async () => {
    render(<AppearanceSettings initial={view()} />)
    await userEvent.click(screen.getByRole('radio', { name: /Personnalisé/ }))
    const field = screen.getByRole('textbox', { name: 'Produits' })
    fireEvent.change(field, { target: { value: '#EEEEEE' } })

    expect(previewStyle().getPropertyValue('--chart-revenue')).toBe('#eeeeee')
    const row = field.closest('li')!
    expect(within(row).getByText(/Contraste de 1,1:1 avec le fond des cartes/)).toBeInTheDocument()
    expect(screen.getByText('Contraste insuffisant')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body).toEqual({ palette: 'custom', base: 'sobre', custom: { light: { revenue: '#eeeeee' }, dark: {} } })
    await waitFor(() => expect(document.documentElement.style.getPropertyValue('--chart-revenue-light')).toBe('#eeeeee'))
    // Only the changed colour is set on top of Sobre: the others keep globals.css.
    expect(document.documentElement.style.getPropertyValue('--chart-expenses-light')).toBe('')
  })

  it('restores one colour with "Rétablir" and refuses a malformed hex', async () => {
    render(<AppearanceSettings initial={view({ palette: 'custom', base: 'sobre', custom: { light: { revenue: '#123456' }, dark: {} } })} />)
    const field = screen.getByRole('textbox', { name: 'Produits' })
    expect(field).toHaveValue('#123456')

    fireEvent.change(field, { target: { value: 'bleu' } })
    fireEvent.blur(field)
    expect(screen.getByText(/format #rrggbb/)).toBeInTheDocument()
    expect(previewStyle().getPropertyValue('--chart-revenue')).toBe('#123456')

    await userEvent.click(screen.getByRole('button', { name: 'Rétablir la couleur Produits, thème clair' }))
    expect(field).toHaveValue(CHART_PRESET_DEFINITIONS.sobre.colors.light.revenue)
    expect(previewStyle().getPropertyValue('--chart-revenue')).toBe(CHART_PRESET_DEFINITIONS.sobre.colors.light.revenue)
  })

  it('edits the dark colours in their own tab', async () => {
    render(<AppearanceSettings initial={view({ palette: 'custom', base: 'sobre', custom: { light: {}, dark: {} } })} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Thème sombre' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Trésorerie' }), { target: { value: '#ffcc00' } })
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body).custom).toEqual({ light: {}, dark: { treasury: '#ffcc00' } })
  })

  it('resets to the default colours at once, with an undo', async () => {
    render(<AppearanceSettings initial={view({ palette: 'pastel', base: 'pastel', custom: { light: {}, dark: {} } })} />)
    await userEvent.click(screen.getByRole('button', { name: 'Rétablir les couleurs par défaut' }))
    await waitFor(() => expect(toasts.success).toHaveBeenCalled())
    expect(JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)).toEqual({ palette: 'sobre' })
    expect(toasts.success.mock.calls[0][1]).toMatchObject({ action: { label: 'Annuler' } })
    expect(document.documentElement.getAttribute('style') ?? '').not.toContain('--chart')
  })

  it('shares the theme with the header toggle', async () => {
    render(<AppearanceSettings initial={view()} />)
    await userEvent.click(await screen.findByRole('radio', { name: 'Sombre' }))
    expect(theme.setTheme).toHaveBeenCalledWith('dark')
  })

  it('shows the policy message and disables the colours when the instance refuses', () => {
    render(<AppearanceSettings initial={view(DEFAULT_APPEARANCE, false)} />)
    expect(screen.getByText('Cette action est désactivée sur cette instance.')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Pastel/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Rétablir les couleurs par défaut' })).toBeDisabled()
  })
})
