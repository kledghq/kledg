import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/session'
import { isGlobalAdmin } from '@/lib/rbac/authorize'
import { PageHeader } from '@/components/shared'
import { CreateUserForm } from '@/components/features/settings/create-user-form'

export const metadata = { title: 'Créer un compte' }

/** Account creation, for instance administrators only (there is no public sign-up). */
export default async function NewUserPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (!isGlobalAdmin(user)) redirect('/companies')
  return (
    <div className="w-full max-w-3xl space-y-6">
      <PageHeader title="Créer un compte" description="Donnez accès à Kledg à un membre de votre équipe." />
      <CreateUserForm />
    </div>
  )
}
