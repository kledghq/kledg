'use client'

import { Check } from 'lucide-react'

import { DISPLAY_MODE_LABELS, type DisplayMode } from '@/lib/appearance/display-mode'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'

/** What each mode shows, in the words of the approved onboarding mockup. */
const MODE_DETAILS: Record<DisplayMode, { pitch: string; points: string[]; badge?: string }> = {
  simple: {
    pitch: 'Je ne suis pas comptable. Je veux voir mon argent, mes dépenses et ce que je dois, sans jargon.',
    points: [
      'Vos dépenses classées automatiquement',
      'Des questions simples quand un doute existe',
      'Trésorerie, TVA à payer et factures en attente',
      'Votre expert-comptable valide derrière vous',
    ],
    badge: 'Recommandé si vous débutez',
  },
  expert: {
    pitch: 'Je connais la comptabilité, ou je suis expert-comptable. Je veux tout voir et tout contrôler.',
    points: ['Écritures, journaux et plan comptable', 'Grand livre, balance, lettrage', 'Clôture, bilan, liasse et FEC', 'Validation des saisies du mode simple'],
  },
}

const ORDER: DisplayMode[] = ['simple', 'expert']

/**
 * The two cards "Simple" and "Expert" (docs/mode-simple.md): the onboarding
 * step of the company wizard and the Apparence settings share them.
 */
export function DisplayModeChoice({
  value,
  onChange,
  disabled,
  idPrefix = 'display-mode',
}: {
  value: DisplayMode
  onChange: (mode: DisplayMode) => void
  disabled?: boolean
  idPrefix?: string
}) {
  return (
    <RadioGroup
      aria-label="Mode d'affichage"
      value={value}
      onValueChange={(next) => onChange(next as DisplayMode)}
      disabled={disabled}
      className="grid gap-3 sm:grid-cols-2"
    >
      {ORDER.map((mode) => {
        const details = MODE_DETAILS[mode]
        const id = `${idPrefix}-${mode}`
        return (
          <Label
            key={mode}
            htmlFor={id}
            className="has-[[data-state=checked]]:border-foreground hover:bg-muted/40 flex cursor-pointer flex-col items-stretch gap-3 rounded-lg border p-4 font-normal has-[[data-state=checked]]:ring-1 has-[[data-state=checked]]:ring-foreground"
          >
            <span className="flex flex-wrap items-center gap-2">
              <RadioGroupItem value={mode} id={id} />
              <span className="text-base font-semibold">{DISPLAY_MODE_LABELS[mode]}</span>
              {details.badge ? (
                <Badge variant="success" className="ml-auto">
                  {details.badge}
                </Badge>
              ) : null}
            </span>
            <span className="text-sm leading-snug">{details.pitch}</span>
            <span className="space-y-1.5">
              {details.points.map((point) => (
                <span key={point} className="text-muted-foreground flex gap-2 text-sm">
                  <Check aria-hidden className="text-foreground mt-0.5 size-4 shrink-0" />
                  {point}
                </span>
              ))}
            </span>
          </Label>
        )
      })}
    </RadioGroup>
  )
}
