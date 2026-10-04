'use client'

import { useState } from 'react'
import Link from 'next/link'
import { authClient } from '@/lib/auth-client'
import { AuthShell } from '@/components/brand/auth-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error: requestError } = await authClient.requestPasswordReset({
      email,
      redirectTo: '/reset-password',
    })
    setLoading(false)
    if (requestError) {
      setError(requestError.message ?? 'Une erreur est survenue')
      return
    }
    // Same message whether or not the account exists, to avoid leaking emails.
    setSent(true)
  }

  return (
    <AuthShell>
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>Mot de passe oublié</h1>
          </CardTitle>
          <CardDescription>
            Saisissez votre email&nbsp;: nous vous envoyons un lien pour choisir un nouveau mot de passe.
          </CardDescription>
        </CardHeader>
        {sent ? (
          <CardContent>
            <Alert>
              <AlertDescription>
                Si un compte existe pour {email}, un email vient de lui être envoyé. Pensez à vérifier
                vos courriers indésirables.
              </AlertDescription>
            </Alert>
          </CardContent>
        ) : (
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>
            </CardContent>
            <CardFooter className="pt-6">
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Envoi...' : 'Envoyer le lien'}
              </Button>
            </CardFooter>
          </form>
        )}
      </Card>
      <Link href="/login" className="text-muted-foreground hover:text-foreground self-center text-sm pointer-coarse:-my-3 pointer-coarse:py-3">
        Retour à la connexion
      </Link>
    </AuthShell>
  )
}
