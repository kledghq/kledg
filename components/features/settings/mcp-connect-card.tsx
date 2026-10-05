'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Copy, Info } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SegmentedControl, StatusBadge } from '@/components/shared'
import { ClaudeLogo, OpenAILogo } from './assistant-logos'
import type { AssistantKind } from './use-assistant-connections'

function CopyLine({ value }: { value: string }) {
  return (
    <div className="bg-muted flex items-center gap-2 rounded-md p-2 font-mono text-xs">
      <code className="flex-1 break-all">{value}</code>
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label="Copier"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value)
            toast.success('Copié')
          } catch {
            // Refused outside HTTPS or by the browser: the text stays selectable
            toast.error('Copie impossible dans ce navigateur\u00a0: sélectionnez le texte puis copiez-le.')
          }
        }}
      >
        <Copy aria-hidden />
      </Button>
    </div>
  )
}

/**
 * An address only this computer or its network can reach: claude.ai and
 * ChatGPT connect from the internet, so they cannot use it.
 */
export function isLocalOrigin(origin: string): boolean {
  let host: string
  try {
    host = new URL(origin).hostname
  } catch {
    return false
  }
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === '[::1]' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  )
}

function ClientLabel({ children, connected }: { children: React.ReactNode; connected: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      {children}
      {connected && <span role="img" aria-label="connecté" className="bg-success size-1.5 rounded-full" />}
    </span>
  )
}

function Connected({ label }: { label: string }) {
  return (
    <StatusBadge tone="success" className="mb-1">
      {label}
    </StatusBadge>
  )
}

/**
 * How to connect this instance's MCP endpoint to Claude, ChatGPT or Claude
 * Code (with a key from the Clés API page): one assistant at a time, chosen
 * with a segmented control (no tabs). Assistants already connected carry a
 * dot and a badge.
 */
export function McpConnectCard({
  connected,
  hasApiKey,
}: {
  connected: ReadonlySet<AssistantKind>
  hasApiKey: boolean
}) {
  const [origin, setOrigin] = useState('')
  useEffect(() => setOrigin(window.location.origin), [])
  const url = `${origin}/api/mcp`
  const claude = connected.has('claude')
  const chatgpt = connected.has('chatgpt')
  const claudeCode = connected.has('claude-code') || hasApiKey
  const [client, setClient] = useState<Exclude<AssistantKind, 'other'>>('claude')

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connecter un assistant IA</CardTitle>
        <CardDescription>
          Votre instance expose un serveur MCP. Connectez-le à Claude ou ChatGPT pour interroger votre
          comptabilité en langage naturel. Les écritures proposées par l&apos;assistant restent en
          brouillon jusqu&apos;à ce que vous les validiez.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="text-sm font-medium">URL du serveur MCP</div>
          <CopyLine value={url} />
        </div>
        {origin && isLocalOrigin(origin) ? (
          <Alert role="note">
            <Info aria-hidden />
            <AlertTitle>Adresse locale</AlertTitle>
            <AlertDescription>
              Claude et ChatGPT se connectent depuis internet et ne peuvent pas joindre cette adresse. Ouvrez Kledg à
              son adresse publique pour les connecter, ou utilisez Claude Code sur cet ordinateur.
            </AlertDescription>
          </Alert>
        ) : null}
        <SegmentedControl
          label="Assistant à connecter"
          value={client}
          onValueChange={setClient}
          options={[
            {
              value: 'claude',
              label: (
                <ClientLabel connected={claude}>
                  <ClaudeLogo className="size-3.5" />
                  Claude
                </ClientLabel>
              ),
            },
            {
              value: 'chatgpt',
              label: (
                <ClientLabel connected={chatgpt}>
                  <OpenAILogo className="size-3.5" />
                  ChatGPT
                </ClientLabel>
              ),
            },
            {
              value: 'claude-code',
              label: (
                <ClientLabel connected={claudeCode}>
                  <ClaudeLogo className="size-3.5" />
                  Claude Code
                </ClientLabel>
              ),
            },
          ]}
        />
        {client === 'claude' ? (
          <div className="text-muted-foreground space-y-3 pt-2 text-sm">
            {claude && <Connected label="Claude est connecté" />}
            <p>Sur claude.ai ou dans l&apos;application Claude&nbsp;:</p>
            <ol className="list-decimal space-y-1.5 pl-5">
              <li>
                Ouvrez <strong>Paramètres</strong>, <strong>Connecteurs</strong>, puis{' '}
                <strong>Ajouter un connecteur personnalisé</strong>.
              </li>
              <li>
                Nommez-le <strong>Kledg</strong> et collez l&apos;URL ci-dessus.
              </li>
              <li>
                Laissez les choix détectés par Claude&nbsp;: <strong>Authentification</strong> sur{' '}
                <em>Se connecter maintenant</em> (Sign in now) et <strong>Client OAuth</strong> sur{' '}
                <em>Utiliser l&apos;identité publiée de Claude</em> (Use Claude&apos;s published identity).
                Aucun en-tête n&apos;est nécessaire.
              </li>
              <li>
                Cliquez sur <strong>Ajouter</strong>&nbsp;: Claude ouvre Kledg. Connectez-vous et choisissez
                l&apos;accès&nbsp;: lecture seule, lecture et brouillons d&apos;écritures (par défaut), ou contrôle total.
              </li>
            </ol>
            <p>
              Claude apparaît ensuite dans les assistants autorisés ci-dessous, où vous pouvez réduire ou révoquer
              son accès à tout moment.
            </p>
          </div>
        ) : null}
        {client === 'chatgpt' ? (
          <div className="text-muted-foreground space-y-3 pt-2 text-sm">
            {chatgpt && <Connected label="ChatGPT est connecté" />}
            <p>Dans ChatGPT&nbsp;:</p>
            <ol className="list-decimal space-y-1.5 pl-5">
              <li>
                Ouvrez <strong>Paramètres</strong>, puis <strong>Applications et connecteurs</strong>.
              </li>
              <li>
                Créez un connecteur nommé <strong>Kledg</strong> avec l&apos;URL ci-dessus et l&apos;authentification{' '}
                <strong>OAuth</strong>.
              </li>
              <li>
                ChatGPT ouvre Kledg. Connectez-vous et choisissez l&apos;accès&nbsp;: lecture seule, lecture et
                brouillons d&apos;écritures (par défaut), ou contrôle total.
              </li>
            </ol>
            <p>ChatGPT apparaît ensuite dans les assistants autorisés ci-dessous.</p>
          </div>
        ) : null}
        {client === 'claude-code' ? (
          <div className="text-muted-foreground space-y-3 pt-2 text-sm">
            {claudeCode && <Connected label={hasApiKey ? 'Clé API active' : 'Claude Code est connecté'} />}
            <p>
              Créez une clé API sur la page{' '}
              <Link href="/settings/api-keys" className="text-link underline-offset-4 hover:underline">
                Clés API
              </Link>
              , puis lancez&nbsp;:
            </p>
            <CopyLine
              value={`claude mcp add --transport http kledg ${url} --header "Authorization: Bearer VOTRE_CLE"`}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
