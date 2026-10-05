'use client'

import { useParams } from 'next/navigation'
import { GroupSpaceProvider } from '@/components/features/group/space'

/**
 * The group space of a holding (/<holding>/group/..., docs/vue-groupe.md).
 * The company layout above already checked the user's membership of the
 * holding; every API the pages call checks each subsidiary again. The
 * holding's fiscal year chosen on one page stays chosen on the others.
 */
export default function GroupLayout({ children }: { children: React.ReactNode }) {
  const params = useParams()
  return <GroupSpaceProvider companyId={params.companyId as string}>{children}</GroupSpaceProvider>
}
