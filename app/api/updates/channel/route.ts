import { z } from 'zod'
import { adminRoute, NextResponse } from '@/lib/api/route'
import { writeAuditLog } from '@/lib/audit'
import { loadConnection } from '@/lib/updates/connection'
import { guardWrite, requireGitHubDeploy } from '@/lib/updates/guard'
import { CHANNELS, setChannel } from '@/lib/updates/service'

export const dynamic = 'force-dynamic'

const channelSchema = z.object({ channel: z.enum(CHANNELS) })

/** Writes the repository variable KLEDG_UPDATES read by the update workflow. */
export const PUT = adminRoute({ body: channelSchema }, async ({ request, user, body }) => {
  await guardWrite(request, user)
  requireGitHubDeploy()
  const conn = await loadConnection()
  await setChannel(conn, body.channel)
  await writeAuditLog('info', `Kledg update channel set to ${body.channel}`, {
    action: 'UPDATES_CHANNEL',
    metadata: { repository: `${conn.repository.owner}/${conn.repository.repo}`, channel: body.channel },
  })
  return NextResponse.json({ channel: body.channel })
})
