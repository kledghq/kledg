'use client'

import { useRef } from 'react'
import { CircleCheck, CircleAlert } from 'lucide-react'
import type { AccountOverview } from '@/lib/account/account-overview'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ProfileNameCard } from './profile-name-card'
import { EmailCard } from './email-card'
import { PasswordCard } from './password-card'
import { SessionsCard, type SessionsCardHandle } from './sessions-card'
import { DeleteAccountCard } from './delete-account-card'

/** Outcome of an email confirmation link, read from the URL it brings the user back to. */
export type EmailConfirmation = 'confirmed' | 'failed' | null

/** The sections of the profile page, in the order users need them. */
export function ProfileSettings({
  overview,
  emailConfirmation,
}: {
  overview: AccountOverview
  emailConfirmation: EmailConfirmation
}) {
  const sessions = useRef<SessionsCardHandle>(null)
  const { profile } = overview

  return (
    <>
      {emailConfirmation === 'confirmed' ? (
        <Alert>
          <CircleCheck aria-hidden />
          <AlertDescription>
            Votre nouvelle adresse est confirmée&nbsp;: connectez-vous désormais avec {profile.email}.
          </AlertDescription>
        </Alert>
      ) : null}
      {emailConfirmation === 'failed' ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>
            Le lien de confirmation a expiré ou n&apos;est plus valable&nbsp;: votre adresse n&apos;a pas changé. Recommencez
            le changement d&apos;adresse.
          </AlertDescription>
        </Alert>
      ) : null}
      <ProfileNameCard name={profile.name} email={profile.email} />
      <EmailCard email={profile.email} mode={overview.email} />
      <PasswordCard state={overview.password} onOtherSessionsRevoked={() => void sessions.current?.reload()} />
      <SessionsCard ref={sessions} />
      <DeleteAccountCard email={profile.email} deletion={overview.deletion} />
    </>
  )
}
