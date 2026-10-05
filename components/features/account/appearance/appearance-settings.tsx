'use client'

import { useState, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import { Monitor, Moon, Sun, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'

import type { AppearanceView } from '@/lib/appearance/appearance.service'
import {
  CARD_BACKGROUND,
  CHART_PALETTES,
  CHART_PRESET_DEFINITIONS,
  CHART_PRESETS,
  CHART_SERIES,
  CHART_SERIES_INFO,
  DEFAULT_APPEARANCE,
  resolveChartColors,
  type AppearancePreferences,
  type ChartPalette,
  type ChartPreset,
  type ChartSeries,
  type ChartTheme,
} from '@/lib/appearance/palette'
import { contrastRatio, formatContrastRatio, NON_TEXT_MIN_CONTRAST } from '@/lib/appearance/contrast'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SegmentedControl } from '@/components/shared'
import { cn } from '@/lib/utils'
import { accountApi } from '../account-api'
import { ActionNotice } from '../action-notice'
import { applyChartColors } from './apply-chart-colors'
import { ChartPalettePreview } from './chart-palette-preview'
import { HexColorRow } from './hex-color-row'

const THEMES = [
  { value: 'light', label: 'Clair', icon: Sun },
  { value: 'dark', label: 'Sombre', icon: Moon },
  { value: 'system', label: 'Système', icon: Monitor },
] as const

const THEME_NAMES: Record<ChartTheme, string> = { light: 'thème clair', dark: 'thème sombre' }

const PALETTE_LABELS: Record<ChartPalette, string> = {
  ...Object.fromEntries(CHART_PRESETS.map((id) => [id, CHART_PRESET_DEFINITIONS[id].label])),
  custom: 'Personnalisé',
} as Record<ChartPalette, string>

/** Same choice on the server: custom colours only count for a custom palette. */
function samePreferences(a: AppearancePreferences, b: AppearancePreferences): boolean {
  if (a.palette !== b.palette) return false
  if (a.palette !== 'custom') return true
  return a.base === b.base && JSON.stringify(a.custom) === JSON.stringify(b.custom)
}

function isDefault(prefs: AppearancePreferences): boolean {
  return prefs.palette === 'sobre'
}

/** The body of PUT /api/account/appearance. */
function toBody(prefs: AppearancePreferences) {
  return prefs.palette === 'custom' ? { palette: 'custom', base: prefs.base, custom: prefs.custom } : { palette: prefs.palette }
}

/** Series under 3:1 on the card, in both themes. */
function contrastIssues(prefs: AppearancePreferences) {
  return (['light', 'dark'] as const).flatMap((theme) => {
    const colors = resolveChartColors(prefs, theme)
    return CHART_SERIES.flatMap((series) => {
      const ratio = contrastRatio(colors[series], CARD_BACKGROUND[theme])
      return ratio < NON_TEXT_MIN_CONTRAST ? [{ series, theme, ratio }] : []
    })
  })
}

/** The swatches of a palette option, in the displayed theme. */
function Swatches({ prefs, theme }: { prefs: AppearancePreferences; theme: ChartTheme }) {
  const colors = resolveChartColors(prefs, theme)
  return (
    <span className="flex shrink-0 gap-1" aria-hidden>
      {(['revenue', 'expenses', 'treasury', 'balance'] as const).map((series) => (
        <span key={series} className="size-4 rounded-sm border" style={{ backgroundColor: colors[series] }} />
      ))}
    </span>
  )
}

const noSubscription = () => () => {}

function ThemeCard() {
  const { theme, setTheme } = useTheme()
  // The theme is only known on the client (next-themes): false on the server and during hydration.
  const mounted = useSyncExternalStore(noSubscription, () => true, () => false)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Thème</CardTitle>
        <CardDescription>
          S&apos;applique tout de suite et reste mémorisé sur cet appareil. Le bouton de thème de l&apos;en-tête règle le même choix.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <RadioGroup
          aria-label="Thème"
          value={mounted ? (theme ?? 'system') : undefined}
          onValueChange={setTheme}
          disabled={!mounted}
          className="grid gap-2 sm:grid-cols-3"
        >
          {THEMES.map(({ value, label, icon: Icon }) => (
            <Label
              key={value}
              htmlFor={`theme-${value}`}
              className="has-[[data-state=checked]]:border-primary hover:bg-muted/50 flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 font-normal"
            >
              <RadioGroupItem id={`theme-${value}`} value={value} />
              <Icon aria-hidden className="text-muted-foreground size-4" />
              {label}
            </Label>
          ))}
        </RadioGroup>
      </CardContent>
    </Card>
  )
}

/** The "Apparence" page: theme, then chart colours with a live preview. */
export function AppearanceSettings({ initial }: { initial: AppearanceView }) {
  const router = useRouter()
  const { resolvedTheme } = useTheme()
  // The theme is unknown on the server: render light until hydrated, so both renders match.
  const mounted = useSyncExternalStore(noSubscription, () => true, () => false)
  const displayed: ChartTheme = mounted && resolvedTheme === 'dark' ? 'dark' : 'light'
  const [saved, setSaved] = useState<AppearancePreferences>(initial.appearance)
  const [draft, setDraft] = useState<AppearancePreferences>(initial.appearance)
  const [editedTheme, setEditedTheme] = useState<ChartTheme | null>(null)
  const [saving, setSaving] = useState(false)
  const disabled = !initial.canChange
  const theme = editedTheme ?? displayed
  const dirty = !samePreferences(draft, saved)
  const issues = contrastIssues(draft)

  async function persist(prefs: AppearancePreferences): Promise<AppearancePreferences> {
    const view = await accountApi<AppearanceView>('/api/account/appearance', { method: 'PUT', body: toBody(prefs) })
    setSaved(view.appearance)
    setDraft(view.appearance)
    // Every chart of the page switches now; the next server render agrees.
    applyChartColors(view.appearance)
    router.refresh()
    return view.appearance
  }

  async function save() {
    setSaving(true)
    try {
      await persist(draft)
      toast.success('Couleurs enregistrées')
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function resetToDefault() {
    const previous = saved
    setSaving(true)
    try {
      await persist(DEFAULT_APPEARANCE)
      toast.success('Couleurs par défaut rétablies', {
        action: isDefault(previous)
          ? undefined
          : {
              label: 'Annuler',
              onClick: () => {
                persist(previous).catch((error: Error) => toast.error(error.message))
              },
            },
      })
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  function choosePalette(value: string) {
    const palette = value as ChartPalette
    setDraft((current) =>
      palette === 'custom'
        ? { palette, base: current.palette === 'custom' ? current.base : current.palette, custom: current.custom }
        : { palette, base: palette, custom: current.custom },
    )
  }

  function setColor(series: ChartSeries, color: string | null) {
    setDraft((current) => {
      const colors = { ...current.custom[theme] }
      if (color) colors[series] = color
      else delete colors[series]
      return { ...current, custom: { ...current.custom, [theme]: colors } }
    })
  }

  const editedColors = resolveChartColors(draft, theme)

  return (
    <>
      <ThemeCard />
      <Card>
        <CardHeader>
          <CardTitle>Couleurs des graphiques</CardTitle>
          <CardDescription>
            Les couleurs du tableau de bord (produits et charges, trésorerie, répartition des charges) et de
            l&apos;évolution du solde des comptes. Elles vous suivent sur tous vos appareils.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {disabled ? <ActionNotice>{initial.refusal}</ActionNotice> : null}

          <RadioGroup aria-label="Palette" value={draft.palette} onValueChange={choosePalette} disabled={disabled} className="gap-2">
            {CHART_PALETTES.map((palette) => {
              const option: AppearancePreferences = palette === 'custom' ? { ...draft, palette: 'custom' } : { palette, base: palette, custom: draft.custom }
              return (
                <Label
                  key={palette}
                  htmlFor={`palette-${palette}`}
                  className={cn(
                    'has-[[data-state=checked]]:border-primary flex items-start gap-3 rounded-md border px-3 py-3 font-normal',
                    disabled ? 'cursor-not-allowed opacity-70' : 'hover:bg-muted/50 cursor-pointer',
                  )}
                >
                  <RadioGroupItem id={`palette-${palette}`} value={palette} className="mt-0.5" />
                  <span className="min-w-0 flex-1 space-y-0.5">
                    <span className="block text-sm font-medium">{PALETTE_LABELS[palette]}</span>
                    <span className="text-muted-foreground block text-xs">
                      {palette === 'custom'
                        ? 'Choisissez la couleur de chaque série, pour le thème clair et pour le thème sombre.'
                        : CHART_PRESET_DEFINITIONS[palette].description}
                    </span>
                  </span>
                  <Swatches prefs={option} theme={displayed} />
                </Label>
              )
            })}
          </RadioGroup>

          {draft.palette === 'custom' ? (
            <section aria-labelledby="custom-colors-title" className="space-y-4">
              <div className="space-y-1">
                <h2 id="custom-colors-title" className="text-sm font-medium">
                  Couleurs personnalisées
                </h2>
                <p className="text-muted-foreground text-xs">
                  Chaque couleur se règle séparément pour le thème clair et pour le thème sombre&nbsp;: une couleur
                  lisible sur fond blanc l&apos;est rarement sur fond sombre. Une couleur que vous ne changez pas vient
                  de la palette de départ.
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-2">
                  <Label htmlFor="custom-base">Palette de départ</Label>
                  <Select
                    value={draft.base}
                    onValueChange={(value) => setDraft((current) => ({ ...current, base: value as ChartPreset }))}
                    disabled={disabled}
                  >
                    <SelectTrigger id="custom-base" className="w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CHART_PRESETS.map((preset) => (
                        <SelectItem key={preset} value={preset}>
                          {CHART_PRESET_DEFINITIONS[preset].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <SegmentedControl
                  label="Thème des couleurs à régler"
                  value={theme}
                  onValueChange={setEditedTheme}
                  options={[
                    { value: 'light', label: 'Thème clair' },
                    { value: 'dark', label: 'Thème sombre' },
                  ]}
                />
              </div>
              <ul className="divide-y rounded-md border">
                {CHART_SERIES.map((series) => (
                  <HexColorRow
                    key={`${theme}-${series}`}
                    series={series}
                    theme={theme}
                    value={editedColors[series]}
                    overridden={draft.custom[theme][series] !== undefined}
                    disabled={disabled}
                    onChange={(color) => setColor(series, color)}
                  />
                ))}
              </ul>
            </section>
          ) : null}

          <section aria-labelledby="preview-title" className="space-y-3">
            <div className="space-y-1">
              <h2 id="preview-title" className="text-sm font-medium">
                Aperçu
              </h2>
              <p className="text-muted-foreground text-xs">
                {theme === displayed
                  ? `Les graphiques dans le ${THEME_NAMES[displayed]}, avant enregistrement.`
                  : `L'aperçu montre le ${THEME_NAMES[displayed]} affiché. Passez au ${THEME_NAMES[theme]} pour voir ces couleurs.`}
              </p>
            </div>
            <ChartPalettePreview colors={resolveChartColors(draft, displayed)} />
          </section>

          {issues.length ? (
            <Alert>
              <TriangleAlert aria-hidden className="text-warning" />
              <AlertTitle>Contraste insuffisant</AlertTitle>
              <AlertDescription>
                <p>
                  Ces couleurs se distinguent mal du fond des cartes (moins de 3:1, le minimum recommandé pour un
                  graphique)&nbsp;:
                </p>
                <ul className="list-disc pl-4">
                  {issues.map(({ series, theme: issueTheme, ratio }) => (
                    <li key={`${issueTheme}-${series}`}>
                      {CHART_SERIES_INFO[series].label}, {THEME_NAMES[issueTheme]}&nbsp;: {formatContrastRatio(ratio)}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
        <CardFooter className="flex flex-wrap justify-end gap-2 pt-5">
          <Button
            type="button"
            variant="outline"
            onClick={resetToDefault}
            disabled={disabled || saving || (isDefault(saved) && isDefault(draft))}
          >
            Rétablir les couleurs par défaut
          </Button>
          <Button type="button" onClick={save} loading={saving} disabled={disabled || !dirty}>
            Enregistrer
          </Button>
        </CardFooter>
      </Card>
    </>
  )
}
