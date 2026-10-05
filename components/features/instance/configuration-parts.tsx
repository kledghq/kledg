'use client'

import { useState } from 'react'
import { Check, Copy, Mail, RefreshCw, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'

async function postJson(url: string): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    const data = (await response.json().catch(() => null)) as { error?: string } | null
    if (!response.ok) return { ok: false, error: data?.error ?? "L'envoi a échoué." }
    return { ok: true, data }
  } catch {
    return { ok: false, error: 'Le serveur ne répond pas. Réessayez.' }
  }
}

/** "Send a test email" of the Configuration page: to the administrator's own address only. */
export function TestEmailButton() {
  const [state, setState] = useState<{ status: 'idle' | 'sending' } | { status: 'sent'; to: string } | { status: 'error'; error: string }>({
    status: 'idle',
  })

  async function send() {
    setState({ status: 'sending' })
    const result = await postJson('/api/instance/test-email')
    setState(result.ok ? { status: 'sent', to: (result.data as { sentTo: string }).sentTo } : { status: 'error', error: result.error })
  }

  return (
    <div className="space-y-2">
      <Button variant="outline" size="sm" onClick={send} disabled={state.status === 'sending'}>
        <Mail aria-hidden />
        {state.status === 'sending' ? 'Envoi…' : 'Envoyer un email de test'}
      </Button>
      <p aria-live="polite" className="text-sm">
        {state.status === 'sent' && <span className="text-success">Envoyé à {state.to}. Vérifiez aussi les indésirables.</span>}
        {state.status === 'error' && <span className="text-destructive">{state.error}</span>}
      </p>
    </div>
  )
}

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * A CRON_SECRET to paste into the host's variables: 32 random bytes from the
 * browser, never sent to the server (the instance cannot set its own
 * environment).
 */
export function SecretGenerator({ name }: { name: string }) {
  const [value, setValue] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function generate() {
    const next = randomHex(32)
    setValue(next)
    try {
      await navigator.clipboard.writeText(next)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  if (!value) {
    return (
      <Button variant="outline" size="sm" onClick={generate}>
        <Sparkles aria-hidden />
        Générer {name}
      </Button>
    )
  }
  return (
    <div className="flex max-w-md items-center gap-2 rounded-md border px-2 py-1.5">
      <code className="text-foreground min-w-0 flex-1 truncate font-mono text-xs select-all" title={value}>
        {value}
      </code>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Copier"
        onClick={() => navigator.clipboard.writeText(value).then(() => setCopied(true)).catch(() => {})}
      >
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Générer une autre valeur" onClick={generate}>
        <RefreshCw aria-hidden />
      </Button>
    </div>
  )
}
