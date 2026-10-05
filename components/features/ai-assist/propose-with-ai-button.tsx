'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { ChevronDown, Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { ASSISTANT_APPS, lastAppStorageKey, pickApp, type AssistantApp } from '@/lib/ai-assist/apps'
import { buildAiPrompt, type AiPromptTarget } from '@/lib/ai-assist/prompts'
import { useAiAssist } from './ai-assist-context'

const LABEL = "Proposer avec l'IA"

function readRemembered(userId: string): string | null {
  try {
    return window.localStorage.getItem(lastAppStorageKey(userId))
  } catch {
    return null
  }
}

function remember(userId: string, app: AssistantApp) {
  try {
    window.localStorage.setItem(lastAppStorageKey(userId), app)
  } catch {
    // Private window or blocked storage: the choice is simply not remembered.
  }
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** What the user sees in the menu for each app. */
function menuLabel(app: AssistantApp): string {
  return app === 'other' ? 'Copier la demande' : `Ouvrir dans ${ASSISTANT_APPS[app].label}`
}

/**
 * Opens `app` with the request: a new tab on its "new chat" address (Claude,
 * ChatGPT), the request also copied in case the address no longer fills the
 * field; any other assistant gets the request copied only. The tab is opened
 * first, inside the click, so no popup blocker stops it.
 */
export async function launchAssistant(app: AssistantApp, prompt: string): Promise<void> {
  const info = ASSISTANT_APPS[app]
  if (info.url) window.open(info.url(prompt), '_blank', 'noopener,noreferrer')
  const copied = await copy(prompt)
  if (info.url) {
    toast.success(`Demande ouverte dans ${info.label}`, {
      description: copied ? 'Elle est aussi copiée\u00a0: collez-la si le champ est vide.' : undefined,
    })
  } else if (copied) {
    toast.success('Demande copiée', { description: 'Collez-la dans votre assistant connecté à Kledg.' })
  } else {
    toast.error("La demande n'a pas pu être copiée. Réessayez, ou autorisez le presse-papiers pour ce site.")
  }
}

/**
 * "Proposer avec l'IA": asks the user's assistant to propose what to do with
 * one object (a transaction to reconcile, a draft entry, an invoice...),
 * through a prepared request naming the company and the object
 * (lib/ai-assist/prompts.ts). Shown only when the user connected an
 * assistant to this company; nothing otherwise.
 *
 * One assistant: one button. Several: the button opens the last one chosen
 * (remembered per user in this browser), the arrow next to it lists them.
 * `icon`: a square ghost button for table rows.
 */
export function ProposeWithAiButton({
  target,
  size = 'sm',
  icon = false,
  className,
  tabIndex,
}: {
  target: AiPromptTarget
  size?: 'default' | 'sm' | 'xs'
  icon?: boolean
  className?: string
  /** For rows with a roving focus (only the active row is in the Tab order). */
  tabIndex?: number
}) {
  const { companyId, companyName, userId, apps } = useAiAssist()
  const [remembered, setRemembered] = React.useState<string | null>(null)
  React.useEffect(() => setRemembered(readRemembered(userId)), [userId])

  const current = pickApp(apps, remembered)
  if (!current) return null

  const prompt = () => buildAiPrompt({ id: companyId, name: companyName }, target)
  const launch = (app: AssistantApp) => {
    if (apps.length > 1) {
      remember(userId, app)
      setRemembered(app)
    }
    void launchAssistant(app, prompt())
  }
  const title = current === 'other' ? 'Copier une demande pour votre assistant' : `Ouvrir dans ${ASSISTANT_APPS[current].label} avec une demande préparée`

  const menu = (trigger: React.ReactNode) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      {/* Keys stay in the menu: a row with its own arrow navigation (reconciliation queue) must not see them through the portal. */}
      <DropdownMenuContent align="end" onKeyDown={(event) => event.stopPropagation()}>
        <DropdownMenuLabel>{LABEL}</DropdownMenuLabel>
        {apps.map((app) => (
          <DropdownMenuItem key={app} onSelect={() => launch(app)}>
            {menuLabel(app)}
            {app === current ? <span className="text-muted-foreground ml-auto text-xs">Dernier choix</span> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  if (icon) {
    const button = (
      <Button type="button" variant="ghost" size="icon-sm" tabIndex={tabIndex} aria-label={LABEL} title={title} className={className} onClick={apps.length > 1 ? undefined : () => launch(current)}>
        <Sparkles aria-hidden />
      </Button>
    )
    return apps.length > 1 ? menu(button) : button
  }

  const main = (
    <Button type="button" variant="outline" size={size} tabIndex={tabIndex} title={title} onClick={() => launch(current)} className={cn(apps.length > 1 && 'rounded-r-none', apps.length > 1 ? undefined : className)}>
      <Sparkles aria-hidden />
      {LABEL}
    </Button>
  )
  if (apps.length === 1) return main
  return (
    <div className={cn('inline-flex', className)}>
      {main}
      {menu(
        <Button type="button" variant="outline" size={size === 'default' ? 'icon' : size === 'sm' ? 'icon-sm' : 'icon-xs'} tabIndex={tabIndex} aria-label="Choisir l'assistant" title="Choisir l'assistant" className="-ml-px rounded-l-none">
          <ChevronDown aria-hidden />
        </Button>,
      )}
    </div>
  )
}
