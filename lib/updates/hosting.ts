/**
 * Where the instance runs, read from the variables each host sets on its
 * containers, and how it is updated there. Pure and without imports: the
 * "Mises à jour" page and the welcome page use it on both sides.
 *
 * Detection, first match wins (docs/self-hosting.md has a section per host):
 *
 * | Platform    | Variable set by the host                         |
 * | ----------- | ------------------------------------------------ |
 * | vercel      | VERCEL                                           |
 * | railway     | RAILWAY_ENVIRONMENT_ID, RAILWAY_PROJECT_ID       |
 * | render      | RENDER=true                                      |
 * | fly         | FLY_APP_NAME                                     |
 * | clevercloud | CC_DEPLOYMENT_ID, or APP_ID of the form app_<uuid> |
 * | coolify     | COOLIFY_RESOURCE_UUID, COOLIFY_CONTAINER_NAME    |
 * | docker      | KLEDG_RUNTIME=docker (set by the Dockerfile)     |
 * | node        | none of the above (`next start`)                 |
 *
 * Railway, Render, Fly.io, Clever Cloud and Coolify run the Docker image,
 * which also sets KLEDG_RUNTIME=docker: the host specific variables are
 * checked first.
 */

export const PLATFORMS = ['vercel', 'railway', 'render', 'fly', 'clevercloud', 'coolify', 'docker', 'node'] as const

export type Platform = (typeof PLATFORMS)[number]

type Env = Record<string, string | undefined>

const CLEVER_APP_ID = /^app_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function detectPlatform(env: Env): Platform {
  if (env.VERCEL) return 'vercel'
  if (env.RAILWAY_ENVIRONMENT_ID || env.RAILWAY_PROJECT_ID) return 'railway'
  if (env.RENDER === 'true') return 'render'
  if (env.FLY_APP_NAME) return 'fly'
  if (env.CC_DEPLOYMENT_ID || CLEVER_APP_ID.test(env.APP_ID ?? '')) return 'clevercloud'
  if (env.COOLIFY_RESOURCE_UUID || env.COOLIFY_CONTAINER_NAME) return 'coolify'
  if (env.KLEDG_RUNTIME === 'docker') return 'docker'
  return 'node'
}

/** Name of the host in sentences ("Railway déploie la nouvelle version"). */
export const PLATFORM_LABELS: Record<Platform, string> = {
  vercel: 'Vercel',
  railway: 'Railway',
  render: 'Render',
  fly: 'Fly.io',
  clevercloud: 'Clever Cloud',
  coolify: 'Coolify',
  docker: 'Docker',
  node: 'Node.js',
}

/**
 * Whether merging into the default branch of the GitHub repository redeploys
 * the instance, which the one-click update of the "Mises à jour" page relies
 * on (it merges a pull request, the host does the rest).
 *
 * - Vercel: always (the Vercel button and GitHub imports deploy on push).
 * - Railway and Render: when the running deployment came from a commit
 *   (RAILWAY_GIT_COMMIT_SHA, RENDER_GIT_COMMIT); an image or CLI deployment
 *   has none.
 * - Anywhere else (Fly.io through a GitHub Action, Clever Cloud or Coolify
 *   linked to GitHub, Dokploy webhooks): only when the operator says so with
 *   KLEDG_DEPLOYS_FROM_GITHUB=true. KLEDG_DEPLOYS_FROM_GITHUB=false turns the
 *   one-click update off everywhere.
 */
export function deploysFromGitHub(platform: Platform, env: Env): boolean {
  const flag = env.KLEDG_DEPLOYS_FROM_GITHUB?.trim().toLowerCase()
  if (flag === 'false') return false
  if (flag === 'true') return true
  if (platform === 'vercel') return true
  if (platform === 'railway') return Boolean(env.RAILWAY_GIT_COMMIT_SHA)
  if (platform === 'render') return Boolean(env.RENDER_GIT_COMMIT)
  return false
}

/** How a merge on GitHub reaches the instance, said on the "Mises à jour" page. */
export const GITHUB_DEPLOY_NOTES: Record<Platform, string> = {
  vercel: 'Vercel déploie chaque fusion sur la branche principale.',
  railway: 'Railway redéploie le service à chaque fusion sur la branche suivie.',
  render: 'Render redéploie le service à chaque fusion sur la branche suivie (déploiement automatique activé).',
  fly: "Fly.io redéploie à chaque fusion grâce au workflow GitHub Actions « fly deploy » de votre dépôt.",
  clevercloud: "Clever Cloud redéploie à chaque fusion quand l'application est liée à votre dépôt GitHub.",
  coolify: 'Coolify redéploie à chaque fusion quand le déploiement automatique est activé sur la ressource.',
  docker: 'Votre hébergeur redéploie à chaque fusion sur la branche principale (KLEDG_DEPLOYS_FROM_GITHUB=true).',
  node: 'Votre hébergeur redéploie à chaque fusion sur la branche principale (KLEDG_DEPLOYS_FROM_GITHUB=true).',
}

const PULL_UPSTREAM = `cd kledg   # votre clone du dépôt
git pull https://github.com/kledghq/kledg.git main`

/** Commands to update by hand, when merging on GitHub does not redeploy the instance. */
export const MANUAL_UPDATE_COMMANDS: Record<Platform, string> = {
  vercel: `${PULL_UPSTREAM}
git push`,
  railway: `${PULL_UPSTREAM}
railway up   # ou poussez sur la branche suivie par Railway`,
  render: `${PULL_UPSTREAM}
git push     # Render redéploie la branche suivie`,
  fly: `${PULL_UPSTREAM}
fly deploy --build-arg KLEDG_COMMIT=$(git rev-parse HEAD)`,
  clevercloud: `${PULL_UPSTREAM}
git push clever main:master   # remote Git de l'application Clever Cloud`,
  coolify: `${PULL_UPSTREAM}
git push     # puis « Redeploy » dans Coolify`,
  docker: `${PULL_UPSTREAM}
export KLEDG_COMMIT=$(git rev-parse HEAD)
docker compose up -d --build`,
  node: `${PULL_UPSTREAM}
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm build
# puis redémarrez le service (pnpm start)`,
}

