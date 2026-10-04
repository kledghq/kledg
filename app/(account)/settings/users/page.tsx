import Link from 'next/link'
import { redirect } from 'next/navigation'
import { UserPlus } from 'lucide-react'
import { getCurrentUser } from '@/lib/session'
import { isGlobalAdmin } from '@/lib/rbac/authorize'
import { listInstanceUsers, manageUsersState } from '@/lib/users/instance-users.service'
import { PageHeader } from '@/components/shared'
import { Button } from '@/components/ui/button'
import { ActionNotice } from '@/components/features/account/action-notice'
import { InstanceUsersTable } from '@/components/features/settings/instance-users-table'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Utilisateurs' }

/** Accounts of the instance, for instance administrators: roles, blocking, email changes and deletions. */
export default async function InstanceUsersPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (!isGlobalAdmin(user)) redirect('/companies')
  const [users, manage] = await Promise.all([listInstanceUsers(), manageUsersState(user)])

  return (
    <div className="w-full max-w-3xl space-y-6">
      <PageHeader
        title="Utilisateurs"
        description="Les comptes de cette instance&nbsp;: rôle, blocage, adresse de connexion et suppression."
        actions={
          <Button asChild>
            <Link href="/settings/users/new">
              <UserPlus aria-hidden />
              Créer un compte
            </Link>
          </Button>
        }
      />
      {manage.allowed ? null : <ActionNotice>{manage.message}</ActionNotice>}
      <InstanceUsersTable users={users} currentUserId={user.id} canManage={manage.allowed} />
    </div>
  )
}
