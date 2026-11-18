import { adminRoute, NextResponse } from '@/lib/api/route'
import { loadConnection } from '@/lib/updates/connection'
import { guardRead, requireGitHubDeploy } from '@/lib/updates/guard'
import { findUpdateBranch, findUpdatePull, getChannel, getWorkflow, latestRun } from '@/lib/updates/service'

export const dynamic = 'force-dynamic'

/**
 * State of the update on GitHub: channel, workflow, last run, open update
 * pull request, or the prepared branch when GitHub did not let the workflow
 * open the pull request (installing then opens it, POST /api/updates/install).
 */
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
  const branch = pull ? null : await findUpdateBranch(conn)
  return NextResponse.json(
    {
      channel,
      repository: `${conn.repository.owner}/${conn.repository.repo}`,
      workflow: { present: workflow.present, state: workflow.state, current: workflow.current },
      run,
      pull,
      branch,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
})
