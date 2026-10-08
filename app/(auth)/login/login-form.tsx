'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { AuthShell } from '@/components/brand/auth-shell'
import { authClient } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { safeRedirectPath } from '@/lib/safe-redirect'

/** Sign-in form. `extra` (the LoginExtra instance slot) is shown above the card. */
export function LoginForm({ extra }: { extra?: React.ReactNode }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: session } = authClient.useSession()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const errorParam = searchParams.get('error')
    if (errorParam) {
      // Already decoded by URLSearchParams: decoding again throws on a literal "%".
      setError(errorParam)
      router.replace('/login')
    }
  }, [searchParams, router])

  // If already signed in, bounce to the dashboard (or requested redirect).
  // This runs client-side to avoid server-side redirect loops between
  // /login and / when cookie state is transient.
  useEffect(() => {
    if (session?.user && !searchParams.get('client_id')) {
      const target = safeRedirectPath(searchParams.get('redirect'))
      router.replace(target)
    }
  }, [session, searchParams, router])

  // Only same-origin paths: ?redirect=https://evil.example would be an open redirect
  const redirectTo = safeRedirectPath(searchParams.get('redirect'))

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const { data, error: signInError } = await authClient.signIn.email({
      email,
      password,
    })

    if (signInError) {
      // Instances that require a confirmed address (REQUIRE_EMAIL_VERIFICATION,
      // lib/instance/policy.ts): Better Auth has just sent the link again.
      setError(
        signInError.code === 'EMAIL_NOT_VERIFIED'
          ? 'Confirmez d’abord votre adresse email\u00a0: nous venons de vous renvoyer le lien de confirmation.'
          : (signInError.message ?? 'Échec de la connexion'),
      )
      setLoading(false)
      return
    }

    // During an OAuth authorization (an MCP client connecting), the server
    // answers with the URL that continues the flow (consent or the client).
    const continueUrl = (data as { url?: string; redirect?: boolean } | null)?.url
    if (continueUrl) {
      window.location.href = continueUrl
      return
    }

    router.push(redirectTo)
    router.refresh()
  }

  return (
    <AuthShell>
        {extra}
        <Card>
          <CardHeader>
            <CardTitle>
            <h1>Connexion</h1>
          </CardTitle>
            <CardDescription>
              Accédez à la comptabilité de vos sociétés.
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleLogin}>
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
                  autoComplete="email username"
                  placeholder="vous@societe.fr"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Mot de passe</Label>
                  <Link
                    href="/forgot-password"
                    className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline pointer-coarse:-my-3.5 pointer-coarse:py-3.5"
                  >
                    Mot de passe oublié&nbsp;?
                  </Link>
                </div>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>
            </CardContent>
            <CardFooter className="flex flex-col space-y-4 pt-6">
              <Button type="submit" className="w-full" loading={loading}>
                Se connecter
              </Button>
            </CardFooter>
          </form>
        </Card>
    </AuthShell>
  )
}
