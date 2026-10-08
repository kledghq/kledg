'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth-client'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { acceptAsSignedInUser, acceptWithNewAccount } from './actions'

const MIN_PASSWORD_LENGTH = 10

/**
 * Acceptance of an invitation: one click for the invited account signed in
 * ('join'), or the creation of the account from the link ('create'), then a
 * sign-in and the company's dashboard.
 */
export function AcceptInvitation({
  token,
  mode,
  title,
  intro,
  email,
}: {
  token: string
  mode: 'join' | 'create'
  title: string
  intro: string
  email: string
}) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function join() {
    setLoading(true)
    setError(null)
    const result = await acceptAsSignedInUser(token)
    if (!result.ok) {
      setLoading(false)
      setError(result.error)
      return
    }
    router.push(result.href)
  }

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`)
      return
    }
    if (password !== confirm) {
      setError('Les mots de passe ne correspondent pas.')
      return
    }
    setLoading(true)
    const result = await acceptWithNewAccount(token, { name, password })
    if (!result.ok) {
      setLoading(false)
      setError(result.error)
      return
    }
    const { error: signInError } = await authClient.signIn.email({ email: result.email, password })
    if (signInError) {
      // The account and the membership exist: signing in from the login page finishes.
      router.push(`/login?redirect=${encodeURIComponent(result.href)}`)
      return
    }
    router.push(result.href)
  }

  const errorAlert = error ? (
    <Alert variant="destructive">
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  ) : null

  if (mode === 'join') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>{title}</h1>
          </CardTitle>
          <CardDescription>{intro}</CardDescription>
        </CardHeader>
        {errorAlert ? <CardContent>{errorAlert}</CardContent> : null}
        <CardFooter>
          <Button className="w-full" onClick={join} loading={loading}>
            Rejoindre la société
          </Button>
        </CardFooter>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>{title}</h1>
        </CardTitle>
        <CardDescription>
          {intro} Créez votre compte pour accepter l&apos;invitation.
        </CardDescription>
      </CardHeader>
      <form onSubmit={create}>
        <CardContent className="space-y-4">
          {errorAlert}
          <div className="space-y-2">
            <Label htmlFor="invitation-email">Email</Label>
            <Input id="invitation-email" type="email" autoComplete="username" value={email} readOnly />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invitation-name">Nom</Label>
            <Input
              id="invitation-name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Prénom Nom"
              disabled={loading}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invitation-password">Mot de passe</Label>
            <Input
              id="invitation-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invitation-confirm">Confirmation</Label>
            <Input
              id="invitation-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              disabled={loading}
            />
          </div>
        </CardContent>
        <CardFooter className="pt-6">
          <Button type="submit" className="w-full" loading={loading}>
            Créer mon compte et rejoindre la société
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
