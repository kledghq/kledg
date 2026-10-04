import { adminRoute, NextResponse } from '@/lib/api/route'
import { loadConnection } from '@/lib/updates/connection'
import { guardRead, requireGitHubDeploy } from '@/lib/updates/guard'
import { findUpdatePull, getChannel, getWorkflow, latestRun } from '@/lib/updates/service'

export const dynamic = 'force-dynamic'

/** State of the update on GitHub: channel, workflow, last run, open update pull request. */
export const GET = adminRoute({}, async ({ user }) => {
  requireGitHubDeploy()
  await guardRead(user.id)
  const conn = await loadConnection()
  const [channel, workflow, run, pull] = await Promise.all([
    getChannel(conn),
    getWorkflow(conn),
    latestRun(conn),
    findUpdatePull(conn),
  ])
  return NextResponse.json(
    {
      channel,
      repository: `${conn.repository.owner}/${conn.repository.repo}`,
      workflow: { present: workflow.present, state: workflow.state, current: workflow.current },
      run,
      pull,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
})
