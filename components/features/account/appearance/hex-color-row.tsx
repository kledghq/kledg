'use client'

import { useId, useState } from 'react'
import { RotateCcw, TriangleAlert } from 'lucide-react'

import { CARD_BACKGROUND, CHART_SERIES_INFO, HEX_COLOR, type ChartSeries, type ChartTheme } from '@/lib/appearance/palette'
import { contrastRatio, formatContrastRatio, NON_TEXT_MIN_CONTRAST } from '@/lib/appearance/contrast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/** "#1C7F55", "1c7f55" or " #1c7f55 " to "#1c7f55"; null when it is not a 6 digit hex colour. */
export function normalizeHex(text: string): string | null {
  const value = text.trim()
  const withHash = value.startsWith('#') ? value : `#${value}`
  return HEX_COLOR.test(withHash) ? withHash.toLowerCase() : null
}

interface HexColorRowProps {
  series: ChartSeries
  theme: ChartTheme
  /** The colour shown (the user's, else the starting palette's). */
  value: string
  /** Whether the user set this colour. */
  overridden: boolean
  disabled?: boolean
  /** A new colour, or null to go back to the starting palette's. */
  onChange: (color: string | null) => void
}

/** One chart series: a colour picker, its hex field, "Rétablir" and the contrast warning. */
export function HexColorRow({ series, theme, value, overridden, disabled, onChange }: HexColorRowProps) {
  const id = useId()
  const info = CHART_SERIES_INFO[series]
  const themeName = theme === 'light' ? 'thème clair' : 'thème sombre'
  const [text, setText] = useState(value)
  const [shown, setShown] = useState(value)
  const [invalid, setInvalid] = useState(false)
  // A change from outside (picker, "Rétablir", palette de départ) updates the field.
  if (value !== shown) {
    setShown(value)
    if (normalizeHex(text) !== value) setText(value)
    setInvalid(false)
  }

  const ratio = contrastRatio(value, CARD_BACKGROUND[theme])
  const lowContrast = ratio < NON_TEXT_MIN_CONTRAST
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const warningId = `${id}-contrast`

  function typed(next: string) {
    setText(next)
    const color = normalizeHex(next)
    if (color) {
      setInvalid(false)
      if (color !== value) onChange(color)
    }
  }

  return (
    <li className="space-y-2 px-3 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-48">
          <label htmlFor={`${id}-hex`} className="text-sm font-medium">
            {info.label}
          </label>
          <p id={hintId} className="text-muted-foreground text-xs">
            {info.usage}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value.toLowerCase())}
            aria-label={`Couleur ${info.label}, ${themeName}`}
            className="border-input size-9 shrink-0 cursor-pointer rounded-md border bg-transparent p-1 disabled:cursor-not-allowed disabled:opacity-50"
          />
          <Input
            id={`${id}-hex`}
            value={text}
            disabled={disabled}
            onChange={(event) => typed(event.target.value)}
            onBlur={() => setInvalid(normalizeHex(text) === null)}
            aria-invalid={invalid || undefined}
            aria-describedby={[hintId, invalid ? errorId : null, lowContrast ? warningId : null].filter(Boolean).join(' ')}
            spellCheck={false}
            autoComplete="off"
            maxLength={7}
            className="w-28 font-mono"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || !overridden}
            onClick={() => onChange(null)}
            aria-label={`Rétablir la couleur ${info.label}, ${themeName}`}
            title="Rétablir la couleur de la palette de départ"
          >
            <RotateCcw aria-hidden />
            Rétablir
          </Button>
        </div>
      </div>
      {invalid ? (
        <p id={errorId} className="text-destructive text-xs">
          Saisissez une couleur au format #rrggbb, par exemple #1c7f55.
        </p>
      ) : null}
      {lowContrast ? (
        <p id={warningId} className="text-warning flex items-start gap-1.5 text-xs">
          <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
          <span>
            Contraste de {formatContrastRatio(ratio)} avec le fond des cartes, sous le minimum de 3:1 recommandé pour un
            graphique. Choisissez une couleur plus {theme === 'light' ? 'foncée' : 'claire'}.
          </span>
        </p>
      ) : null}
    </li>
  )
}
