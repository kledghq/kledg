import Link from 'next/link'
import { AuthShell } from '@/components/brand/auth-shell'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { getCurrentUser } from '@/lib/session'
import { readInvitation, type InvitationView } from '@/lib/rbac/company-invitations.service'
import { formatDateShort } from '@/lib/utils/date'
import { AcceptInvitation } from './accept-invitation'

export const metadata = { title: 'Invitation' }

/** Every request reads the invitation again: its state changes (accepted, revoked, expired). */
export const dynamic = 'force-dynamic'

function Notice({ title, description, action }: { title: string; description: string; action?: { href: string; label: string } }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>{title}</h1>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      {action ? (
        <CardFooter>
          <Button asChild className="w-full">
            <Link href={action.href}>{action.label}</Link>
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  )
}

function closedNotice(view: InvitationView) {
  const who = view.inviterName ?? "l'administrateur de la société"
  if (view.state === 'accepted') {
    return <Notice title="Invitation déjà acceptée" description="Ce lien a déjà servi. Connectez-vous pour ouvrir la société." action={{ href: '/login', label: 'Se connecter' }} />
  }
  if (view.state === 'revoked') {
    return <Notice title="Invitation annulée" description={`Cette invitation a été annulée. Demandez à ${who} de vous inviter de nouveau si besoin.`} />
  }
  return (
    <Notice
      title="Invitation expirée"
      description={`Cette invitation a expiré le ${formatDateShort(view.expiresAt)}. Demandez à ${who} de vous l'envoyer de nouveau.`}
    />
  )
}

/**
 * Page of the link emailed with a company invitation (issue #13,
 * lib/rbac/company-invitations.service.ts). Public: the invitee may have no
 * account yet. What it offers depends on who opens it: the invited account
 * signed in accepts in one click; an existing account signs in first;
 * otherwise the invitee chooses a password, when the instance allows
 * accounts created from an invitation.
 */
export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const [view, user] = await Promise.all([readInvitation(token), getCurrentUser()])

  if (!view) {
    return (
      <AuthShell>
        <Notice
          title="Lien d'invitation invalide"
          description="Ce lien ne correspond à aucune invitation. Vérifiez qu'il est complet, ou demandez une nouvelle invitation à l'administrateur de la société."
        />
      </AuthShell>
    )
  }
  if (view.state !== 'open') return <AuthShell>{closedNotice(view)}</AuthShell>

  const intro = `${view.inviterName ?? 'Un administrateur'} vous invite à rejoindre ${view.companyName} avec le rôle « ${view.roleLabel} ». Invitation valable jusqu'au ${formatDateShort(view.expiresAt)}.`
  const signedInAsInvitee = user?.email.trim().toLowerCase() === view.email

  if (user && !signedInAsInvitee) {
    return (
      <AuthShell>
        <Notice
          title={`Rejoindre ${view.companyName}`}
          description={`${intro} Cette invitation est adressée à ${view.email}, et vous êtes connecté avec ${user.email}. Déconnectez-vous, puis rouvrez ce lien avec le compte de ${view.email}.`}
        />
      </AuthShell>
    )
  }

  let mode: 'join' | 'sign-in' | 'create' | 'refused'
  if (view.confirmedAccount) mode = signedInAsInvitee ? 'join' : 'sign-in'
  else mode = view.signUpAllowed ? 'create' : 'refused'

  if (mode === 'sign-in') {
    return (
      <AuthShell>
        <Notice
          title={`Rejoindre ${view.companyName}`}
          description={`${intro} Un compte existe pour ${view.email} : connectez-vous pour accepter l'invitation.`}
          action={{ href: `/login?redirect=${encodeURIComponent(`/invitation/${token}`)}`, label: 'Se connecter pour accepter' }}
        />
      </AuthShell>
    )
  }
  if (mode === 'refused') {
    return (
      <AuthShell>
        <Notice
          title={`Rejoindre ${view.companyName}`}
          description={`${intro} Sur cette instance, votre compte doit d'abord être créé par l'administrateur de l'instance. Une fois votre compte créé, rouvrez ce lien pour accepter l'invitation.`}
        />
      </AuthShell>
    )
  }
  return (
    <AuthShell>
      <AcceptInvitation token={token} mode={mode} title={`Rejoindre ${view.companyName}`} intro={intro} email={view.email} />
    </AuthShell>
  )
}
