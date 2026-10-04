/**
 * Chart colours: the series every chart of Kledg draws, the palette presets
 * and how a user's choice becomes CSS variables. Pure, no imports: used by
 * the root layout (server), the appearance API and the settings page
 * (client). docs/design-system.md, "Chart colours".
 *
 * How the colours reach the charts: app/globals.css defines one variable per
 * series (`--chart-revenue`...), equal to `--chart-revenue-light` (`-dark`
 * under `.dark`) when it is set and to the Sobre default otherwise. The root
 * layout sets only the `-light` and `-dark` variables, as an inline style on
 * <html> rendered on the server: no flash of default colours, no style tag
 * (page CSP), and the theme toggle switches colours without a request.
 *
 * Invariant: a user who never chose anything (or chose Sobre) gets no
 * variable at all, so the charts keep the exact values of globals.css.
 */

export const CHART_THEMES = ['light', 'dark'] as const
export type ChartTheme = (typeof CHART_THEMES)[number]

/** Series with a fixed meaning, in the order the settings page lists them. */
export const CHART_SERIES = ['revenue', 'expenses', 'treasury', 'breakdown', 'debit', 'credit', 'balance'] as const
export type ChartSeries = (typeof CHART_SERIES)[number]

export interface ChartSeriesInfo {
  /** French label shown in the settings and in the chart legends. */
  label: string
  /** Where the colour is used, for the settings page. */
  usage: string
}

export const CHART_SERIES_INFO: Readonly<Record<ChartSeries, ChartSeriesInfo>> = {
  revenue: { label: 'Produits', usage: 'Barres des produits du graphique Produits et charges.' },
  expenses: { label: 'Charges', usage: 'Barres des charges du graphique Produits et charges.' },
  treasury: { label: 'Trésorerie', usage: 'Courbe de la trésorerie dans le temps (comptes 512).' },
  breakdown: { label: 'Répartition des charges', usage: 'Barres des postes de charges (60 à 65).' },
  debit: { label: 'Débit', usage: "Barres des débits de l'évolution du solde d'un compte." },
  credit: { label: 'Crédit', usage: "Barres des crédits de l'évolution du solde d'un compte." },
  balance: { label: 'Solde cumulé', usage: "Courbe du solde cumulé de l'évolution du solde d'un compte." },
}

/** The CSS variable a chart reads for a series (app/globals.css). */
export function chartSeriesVariable(series: ChartSeries): `--chart-${ChartSeries}` {
  return `--chart-${series}`
}

/** The variable the server sets for a series in one theme (read by globals.css). */
export function chartThemeVariable(series: ChartSeries, theme: ChartTheme): `--chart-${ChartSeries}-${ChartTheme}` {
  return `--chart-${series}-${theme}`
}

export const CHART_PRESETS = ['sobre', 'contraste', 'daltonisme', 'pastel'] as const
export type ChartPreset = (typeof CHART_PRESETS)[number]

/** The palette choice: a preset, or colours set by the user. */
export const CHART_PALETTES = [...CHART_PRESETS, 'custom'] as const
export type ChartPalette = (typeof CHART_PALETTES)[number]

export type ChartColors = Record<ChartSeries, string>
export type ThemedChartColors = Record<ChartTheme, ChartColors>

export interface ChartPresetDefinition {
  label: string
  description: string
  colors: ThemedChartColors
}

/**
 * Presets, each with its light and dark values. Sobre repeats the defaults
 * of app/globals.css as hex (brand-600 or brand-400, base-400 or base-500,
 * the foreground ink): it is what a user sees without any choice, and these
 * values only serve the preview, the contrast check and as the start of a
 * custom palette. Every other preset reaches 3:1 against the card in both
 * themes (lib/appearance/__tests__/palette.test.ts).
 */
export const CHART_PRESET_DEFINITIONS: Readonly<Record<ChartPreset, ChartPresetDefinition>> = {
  sobre: {
    label: 'Sobre',
    description: 'Le vert de Kledg face à un gris neutre. Les couleurs par défaut.',
    colors: {
      light: {
        revenue: '#1c7f55',
        expenses: '#737373',
        treasury: '#1c7f55',
        breakdown: '#1c7f55',
        debit: '#1c7f55',
        credit: '#737373',
        balance: '#0a0a0a',
      },
      dark: {
        revenue: '#55c08c',
        expenses: '#737373',
        treasury: '#55c08c',
        breakdown: '#55c08c',
        debit: '#55c08c',
        credit: '#737373',
        balance: '#f5f5f5',
      },
    },
  },
  contraste: {
    label: 'Contrasté',
    description: 'Des teintes franches et bien séparées, lisibles sur tous les écrans.',
    colors: {
      light: {
        revenue: '#047857',
        expenses: '#7e22ce',
        treasury: '#1d4ed8',
        breakdown: '#7e22ce',
        debit: '#047857',
        credit: '#7e22ce',
        balance: '#0a0a0a',
      },
      dark: {
        revenue: '#34d399',
        expenses: '#c084fc',
        treasury: '#60a5fa',
        breakdown: '#c084fc',
        debit: '#34d399',
        credit: '#c084fc',
        balance: '#f5f5f5',
      },
    },
  },
  daltonisme: {
    label: 'Daltonisme',
    description: 'Palette Okabe-Ito (bleu, vermillon, vert bleuté) : distincte en cas de deutéranopie ou de protanopie.',
    colors: {
      light: {
        revenue: '#0072b2',
        expenses: '#d55e00',
        treasury: '#009e73',
        breakdown: '#d55e00',
        debit: '#0072b2',
        credit: '#d55e00',
        balance: '#000000',
      },
      dark: {
        revenue: '#56b4e9',
        expenses: '#e69f00',
        treasury: '#009e73',
        breakdown: '#e69f00',
        debit: '#56b4e9',
        credit: '#e69f00',
        balance: '#f5f5f5',
      },
    },
  },
  pastel: {
    label: 'Pastel',
    description: 'Des tons doux et désaturés, assez soutenus pour rester lisibles.',
    colors: {
      light: {
        revenue: '#5b84b1',
        expenses: '#b87a5e',
        treasury: '#5a8f7b',
        breakdown: '#b87a5e',
        debit: '#5b84b1',
        credit: '#b87a5e',
        balance: '#52525b',
      },
      dark: {
        revenue: '#a5c8e8',
        expenses: '#f2c2a8',
        treasury: '#a8d8c8',
        breakdown: '#f2c2a8',
        debit: '#a5c8e8',
        credit: '#f2c2a8',
        balance: '#e4e4e7',
      },
    },
  },
}

/** Card background of each theme (`--card` of app/globals.css as hex): what chart marks are drawn on. */
export const CARD_BACKGROUND: Readonly<Record<ChartTheme, string>> = { light: '#ffffff', dark: '#101010' }

/** A colour as stored and sent: `#rrggbb`. */
export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

export type ChartColorOverrides = Partial<Record<ChartSeries, string>>

/** A user's chart colours. */
export interface AppearancePreferences {
  palette: ChartPalette
  /** The preset a custom palette starts from: a colour the user did not set comes from it. */
  base: ChartPreset
  /** Colours set by the user, per theme: a colour readable on white is rarely readable on a dark card. */
  custom: Record<ChartTheme, ChartColorOverrides>
}

export const DEFAULT_APPEARANCE: AppearancePreferences = { palette: 'sobre', base: 'sobre', custom: { light: {}, dark: {} } }

/** The colours every series has in `theme` with these preferences. */
export function resolveChartColors(prefs: AppearancePreferences, theme: ChartTheme): ChartColors {
  if (prefs.palette !== 'custom') return { ...CHART_PRESET_DEFINITIONS[prefs.palette].colors[theme] }
  return { ...CHART_PRESET_DEFINITIONS[prefs.base].colors[theme], ...prefs.custom[theme] }
}

/** The colours that differ from the defaults of app/globals.css (Sobre) in `theme`. */
function overridesOf(prefs: AppearancePreferences, theme: ChartTheme): ChartColorOverrides {
  if (prefs.palette === 'sobre') return {}
  if (prefs.palette === 'custom' && prefs.base === 'sobre') return { ...prefs.custom[theme] }
  return resolveChartColors(prefs, theme)
}

/**
 * The inline CSS variables of <html> for these preferences: the `-light`
 * and `-dark` variables of each series that differs from the default.
 * Empty for Sobre, so the charts keep the values of globals.css.
 */
export function chartStyleVariables(prefs: AppearancePreferences): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const theme of CHART_THEMES) {
    const overrides = overridesOf(prefs, theme)
    for (const series of CHART_SERIES) {
      const color = overrides[series]
      if (color && HEX_COLOR.test(color)) vars[chartThemeVariable(series, theme)] = color.toLowerCase()
    }
  }
  return vars
}

/** Every variable chartStyleVariables may set: cleared before new colours apply in the page. */
export const ALL_CHART_THEME_VARIABLES: readonly string[] = CHART_THEMES.flatMap((theme) =>
  CHART_SERIES.map((series) => chartThemeVariable(series, theme)),
)
