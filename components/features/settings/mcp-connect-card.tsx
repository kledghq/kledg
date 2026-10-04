'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { StatusBadge } from '@/components/shared'
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
          await navigator.clipboard.writeText(value)
          toast.success('Copié')
        }}
      >
        <Copy aria-hidden />
      </Button>
    </div>
  )
}

function TabLabel({ children, connected }: { children: React.ReactNode; connected: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      {children}
      {connected && <span aria-label="connecté" className="bg-success size-1.5 rounded-full" />}
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
 * Code (with a key from the Clés API page). Tabs of assistants already
 * connected carry a dot and a badge.
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
        <Tabs defaultValue="claude">
          <TabsList>
            <TabsTrigger value="claude">
              <TabLabel connected={claude}>
                <ClaudeLogo className="size-3.5" />
                Claude
              </TabLabel>
            </TabsTrigger>
            <TabsTrigger value="chatgpt">
              <TabLabel connected={chatgpt}>
                <OpenAILogo className="size-3.5" />
                ChatGPT
              </TabLabel>
            </TabsTrigger>
            <TabsTrigger value="claude-code">
              <TabLabel connected={claudeCode}>
                <ClaudeLogo className="size-3.5" />
                Claude Code
              </TabLabel>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="claude" className="text-muted-foreground space-y-3 pt-2 text-sm">
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
                Cliquez sur <strong>Ajouter</strong> : Claude ouvre Kledg. Connectez-vous et choisissez
                l&apos;accès&nbsp;: lecture seule, lecture et brouillons d&apos;écritures (par défaut), ou contrôle total.
              </li>
            </ol>
            <p>
              Claude apparaît ensuite dans les assistants autorisés ci-dessous, où vous pouvez réduire ou révoquer
              son accès à tout moment.
            </p>
          </TabsContent>
          <TabsContent value="chatgpt" className="text-muted-foreground space-y-3 pt-2 text-sm">
            {chatgpt && <Connected label="ChatGPT est connecté" />}
            <p>
              Dans ChatGPT, ouvrez <strong>Paramètres, Applications et connecteurs</strong>, créez un
              connecteur avec l&apos;URL ci-dessus et l&apos;authentification <strong>OAuth</strong>.
              ChatGPT vous redirige vers Kledg pour choisir l&apos;accès&nbsp;: lecture seule, lecture et brouillons
              d&apos;écritures (par défaut), ou contrôle total.
            </p>
          </TabsContent>
          <TabsContent value="claude-code" className="text-muted-foreground space-y-3 pt-2 text-sm">
            {claudeCode && <Connected label={hasApiKey ? 'Clé API active' : 'Claude Code est connecté'} />}
            <p>
              Créez une clé API sur la page{' '}
              <Link href="/settings/api-keys" className="text-foreground font-medium underline underline-offset-4">
                Clés API
              </Link>
              , puis lancez&nbsp;:
            </p>
            <CopyLine
              value={`claude mcp add --transport http kledg ${url} --header "Authorization: Bearer VOTRE_CLE"`}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
