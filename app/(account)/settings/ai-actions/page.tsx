import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/session'
import { PageHeader } from '@/components/shared'
import { AiActionsList } from '@/components/features/ai-actions/ai-actions-list'
import { approvalPageAvailable } from '@/lib/ai-access/manage-grants.service'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Actions IA à approuver' }

/**
 * Actions an assistant prepared with full control (validate, reverse,
 * import, close...) and that wait for the user's decision
 * (lib/mcp/full-control/pending-actions.ts). Reachable only while one of the
 * user's connections runs in validation mode, or an action still waits.
 */
export default async function AiActionsPage({ searchParams }: { searchParams: Promise<{ action?: string | string[] }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  // Without a connection in validation mode nor an action waiting, nothing is ever approved here.
  if (!(await approvalPageAvailable(user.id))) redirect('/settings/assistants')
  const { action } = await searchParams
  return (
    <div className="w-full max-w-3xl space-y-6">
      <PageHeader
        title="Actions IA à approuver"
        description="Les actions à fort impact préparées par vos assistants en contrôle total avec validation dans Kledg. Rien n'est exécuté tant que vous ne les avez pas approuvées ici."
      />
      <AiActionsList highlight={typeof action === 'string' ? action : null} />
    </div>
  )
}
