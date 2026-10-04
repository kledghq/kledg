import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/session'
import { getAccountOverview } from '@/lib/account/account-overview'
import { PageHeader } from '@/components/shared'
import { ProfileSettings, type EmailConfirmation } from '@/components/features/account/profile-settings'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Profil' }

/** The signed-in user's account: name, email, password, sessions and deletion. */
export default async function ProfilePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const params = await searchParams
  // Better Auth brings the user back here from the confirmation link, with
  // ?error=<code> when the link expired or was already used.
  const emailConfirmation: EmailConfirmation = params.error ? 'failed' : params.email === 'confirmed' ? 'confirmed' : null

  return (
    <div className="w-full max-w-3xl space-y-6">
      <PageHeader
        title="Profil"
        description="Votre nom, l'adresse avec laquelle vous vous connectez, votre mot de passe et les appareils connectés à votre compte."
      />
      <ProfileSettings overview={await getAccountOverview(user)} emailConfirmation={emailConfirmation} />
    </div>
  )
}
