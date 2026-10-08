import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/session'
import { AuthShell } from '@/components/brand/auth-shell'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Se déconnecter' }

/**
 * Shown for a direct visit to /auth/signout (a link, a bookmark) or a sign
 * out request that did not come from this instance: signing out takes a
 * click on this page, which posts to /auth/signout (app/auth/signout/route.ts).
 */
export default async function SignOutConfirmPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  return (
    <AuthShell>
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>Se déconnecter de Kledg&nbsp;?</h1>
          </CardTitle>
          <CardDescription>
            Vous êtes connecté avec {user.email}. Vous devrez saisir votre mot de passe pour revenir.
          </CardDescription>
        </CardHeader>
        <form method="post" action="/auth/signout">
          <CardFooter className="flex justify-end gap-2 pt-5">
            <Button variant="outline" asChild>
              <Link href="/">Annuler</Link>
            </Button>
            <Button type="submit">Se déconnecter</Button>
          </CardFooter>
        </form>
      </Card>
    </AuthShell>
  )
}
