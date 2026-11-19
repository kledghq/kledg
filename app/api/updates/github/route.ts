import { adminRoute, NextResponse } from '@/lib/api/route'
import { loadConnection } from '@/lib/updates/connection'
import { guardRead, requireGitHubDeploy } from '@/lib/updates/guard'
import { findUpdateBranch, findUpdatePull, getChannel, getWorkflow, latestRun, pendingDeployment } from '@/lib/updates/service'
import { getDeployedVersion } from '@/lib/updates/version'

export const dynamic = 'force-dynamic'

/**
 * State of the update on GitHub: channel, workflow, last run, open update
 * pull request, or the prepared branch when GitHub did not let the workflow
 * open the pull request (installing then opens it, POST /api/updates/install),
 * and the deployment of the default branch while the host builds it.
 */
export const GET = adminRoute({}, async ({ user }) => {
  requireGitHubDeploy()
  await guardRead(user.id)
  const conn = await loadConnection()
  const [channel, workflow, run, pull, deployment] = await Promise.all([
    getChannel(conn),
    getWorkflow(conn),
    latestRun(conn),
    findUpdatePull(conn),
    // Extra information: GitHub refusing it leaves the rest of the state readable
    pendingDeployment(conn, getDeployedVersion().commit).catch(() => null),
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
      deployment,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
})
