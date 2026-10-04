import { redirect } from 'next/navigation'
import { getSetupAdminEmail, MIN_SETUP_TOKEN_LENGTH, needsSetup, setupTokenStatus } from '@/lib/setup'
import { isActionAllowed } from '@/lib/instance'
import { AuthShell } from '@/components/brand/auth-shell'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SetupForm } from './setup-form'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Configuration' }

/**
 * Shown while SETUP_TOKEN is missing or too short: nobody can claim the
 * instance, and the page says how to unlock it (lib/setup.ts).
 */
function SetupBlocked({ weak }: { weak: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>Installation bloquée</h1>
        </CardTitle>
        <CardDescription>
          {weak
            ? `La variable SETUP_TOKEN est trop courte (au moins ${MIN_SETUP_TOKEN_LENGTH} caractères).`
            : "La variable d'environnement SETUP_TOKEN n'est pas définie."}{' '}
          Sans ce jeton, la première personne à ouvrir cette page deviendrait administrateur de l&apos;instance.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <ol className="list-inside list-decimal space-y-2">
          <li>
            Générez un jeton aléatoire, par exemple avec <code className="bg-muted rounded px-1">openssl rand -base64 24</code>.
          </li>
          <li>
            Définissez-le dans la variable <code className="bg-muted rounded px-1">SETUP_TOKEN</code> : sur Vercel, dans
            Settings, Environment Variables ; avec Docker, dans le fichier d&apos;environnement du conteneur.
          </li>
          <li>Redéployez ou redémarrez l&apos;instance.</li>
          <li>
            Ouvrez <code className="bg-muted rounded px-1">/setup?token=&lt;votre jeton&gt;</code> et créez le compte
            administrateur.
          </li>
        </ol>
        <p className="text-muted-foreground text-xs">
          Vous pourrez supprimer SETUP_TOKEN une fois le compte administrateur créé.
        </p>
      </CardContent>
    </Card>
  )
}

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>
}) {
  // An instance whose policy refuses "setup" provisions its accounts otherwise.
  if (!(await isActionAllowed('setup')) || !(await needsSetup())) {
    redirect('/login')
  }

  const status = setupTokenStatus()
  if (status !== 'ok') {
    return (
      <AuthShell>
        <SetupBlocked weak={status === 'weak'} />
      </AuthShell>
    )
  }

  const { token } = await searchParams
  return (
    <AuthShell>
      <SetupForm adminEmail={getSetupAdminEmail()} initialToken={typeof token === 'string' ? token : ''} />
    </AuthShell>
  )
}
