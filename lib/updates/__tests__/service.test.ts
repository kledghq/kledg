import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ActiveConnection } from '../connection'
import {
  actionsSettingsLinks,
  findUpdateBranch,
  findUpdatePull,
  getChannel,
  installUpdateBranch,
  mergeUpdatePull,
  mergeUpstream,
  prepareUpdate,
  setChannel,
  setRetryDelay,
  versionLabelOf,
} from '../service'
import { UPDATE_WORKFLOW } from '../workflow-template'
import { fakeGitHub, resetGitHub, TOKEN, type FakeHandler } from './fake-github'

const copy: ActiveConnection = { repository: { owner: 'acme', repo: 'compta' }, kind: 'copy', defaultBranch: 'main', token: TOKEN }
const fork: ActiveConnection = { ...copy, kind: 'fork' }
const SHA = 'a'.repeat(40)
const MERGED = 'b'.repeat(40)

const WF = '/repos/acme/compta/actions/workflows/update-from-kledg.yml'
const WF_FILE = 'GET /repos/acme/compta/contents/.github/workflows/update-from-kledg.yml?ref=main'
const b64 = (s: string) => Buffer.from(s).toString('base64')

function workflowRoutes(opts: { file?: string | null; state?: string }): Record<string, FakeHandler> {
  return {
    ...(opts.file === null ? {} : { [WF_FILE]: { body: { sha: 'filesha', content: b64(opts.file ?? UPDATE_WORKFLOW) } } }),
    ...(opts.file === null ? {} : { [`GET ${WF}`]: { body: { state: opts.state ?? 'active' } } }),
    [`POST ${WF}/dispatches`]: { status: 204 },
  }
}

beforeEach(() => setRetryDelay(async () => {}))
afterEach(() => {
  resetGitHub()
  setRetryDelay(null)
})

describe('prepareUpdate', () => {
  it('dispatches the workflow of a copy that has it', async () => {
    const fake = fakeGitHub(workflowRoutes({}))
    const result = await prepareUpdate(copy, 'releases')
    expect(result).toMatchObject({ mode: 'workflow', workflowInstalled: false })
    const dispatch = fake.calls.find((c) => c.path === `${WF}/dispatches`)
    expect(dispatch?.body).toEqual({ ref: 'main' })
    expect(fake.calls.some((c) => c.method === 'PUT')).toBe(false)
  })

  it('installs the workflow in a copy that lacks it (Vercel button), then dispatches', async () => {
    let dispatches = 0
    const fake = fakeGitHub({
      ...workflowRoutes({ file: null }),
      'PUT /repos/acme/compta/contents/.github/workflows/update-from-kledg.yml': { status: 201, body: {} },
      // Not dispatchable right after creation, then accepted.
      [`POST ${WF}/dispatches`]: () => (++dispatches === 1 ? { status: 404, body: { message: 'Not Found' } } : { status: 204 }),
    })
    const result = await prepareUpdate(copy, 'releases')
    expect(result).toMatchObject({ mode: 'workflow', workflowInstalled: true })
    const put = fake.calls.find((c) => c.method === 'PUT')
    expect(put?.body).toMatchObject({ branch: 'main', message: 'Add the Kledg update workflow' })
    expect(Buffer.from((put?.body as { content: string }).content, 'base64').toString()).toBe(UPDATE_WORKFLOW)
    expect(dispatches).toBe(2)
  })

  it('upgrades an old workflow in a copy (no unrelated-history support)', async () => {
    const fake = fakeGitHub({
      ...workflowRoutes({ file: 'name: Update from Kledg\n' }),
      'PUT /repos/acme/compta/contents/.github/workflows/update-from-kledg.yml': { body: {} },
    })
    await prepareUpdate(copy, 'main')
    expect(fake.calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ sha: 'filesha', message: 'Update the Kledg update workflow' })
  })

  it('[KLEDG-R3-INPUT-06] upgrades a version 1 workflow (expressions inside scripts)', async () => {
    const v1 = UPDATE_WORKFLOW.replace('# kledg-workflow-version: 3', '')
    expect(v1).toContain('# BEGIN kledg-merge')
    const fake = fakeGitHub({
      ...workflowRoutes({ file: v1 }),
      'PUT /repos/acme/compta/contents/.github/workflows/update-from-kledg.yml': { body: {} },
    })
    for (const conn of [copy, fork]) {
      fake.calls.length = 0
      await prepareUpdate(conn, 'releases')
      const put = fake.calls.find((c) => c.method === 'PUT')
      expect(put?.body).toMatchObject({ sha: 'filesha', message: 'Update the Kledg update workflow' })
      expect(Buffer.from((put?.body as { content: string }).content, 'base64').toString()).toBe(UPDATE_WORKFLOW)
    }
  })

  it('upgrades a version 2 workflow, which pushed with a personal token (CI/CD audit)', async () => {
    const v2 = UPDATE_WORKFLOW.replace('# kledg-workflow-version: 3', '# kledg-workflow-version: 2')
    const fake = fakeGitHub({
      ...workflowRoutes({ file: v2 }),
      'PUT /repos/acme/compta/contents/.github/workflows/update-from-kledg.yml': { body: {} },
    })
    await prepareUpdate(copy, 'releases')
    const put = fake.calls.find((c) => c.method === 'PUT')
    expect(Buffer.from((put?.body as { content: string }).content, 'base64').toString()).toBe(UPDATE_WORKFLOW)
    // The installed workflow never reads a personal token
    expect(UPDATE_WORKFLOW).not.toContain('secrets.KLEDG_UPDATE_TOKEN')
    expect(UPDATE_WORKFLOW).toContain("HAS_WORKFLOW_TOKEN: 'false'")
  })

  it('explains the missing Workflows permission', async () => {
    fakeGitHub({
      ...workflowRoutes({ file: null }),
      'PUT /repos/acme/compta/contents/.github/workflows/update-from-kledg.yml': {
        status: 403,
        body: { message: 'Resource not accessible' },
      },
    })
    await expect(prepareUpdate(copy, 'releases')).rejects.toThrow('permission Workflows')
  })

  it('enables the workflow of a fork (Actions are disabled in new forks) and dispatches', async () => {
    const fake = fakeGitHub({
      ...workflowRoutes({ state: 'disabled_fork' }),
      [`PUT ${WF}/enable`]: { status: 204 },
    })
    const result = await prepareUpdate(fork, 'releases')
    expect(result).toMatchObject({ mode: 'workflow', workflowInstalled: false })
    expect(fake.called('PUT', `${WF}/enable`)).toBe(true)
    // A current workflow is not rewritten (an older version is, see KLEDG-R3-INPUT-06 above).
    expect(fake.called('PUT', '/repos/acme/compta/contents/.github/workflows/update-from-kledg.yml')).toBe(false)
  })

  it('uses merge-upstream for a fork without the workflow', async () => {
    const fake = fakeGitHub(workflowRoutes({ file: null }))
    expect(await prepareUpdate(fork, 'main')).toEqual({ mode: 'merge-upstream' })
    expect(fake.calls.some((c) => c.method !== 'GET')).toBe(false)
  })

  it('refuses when updates are off', async () => {
    fakeGitHub({})
    await expect(prepareUpdate(copy, 'off')).rejects.toThrow('désactivées')
  })
})

describe('channel', () => {
  it('reads KLEDG_UPDATES, defaulting to releases', async () => {
    fakeGitHub({ 'GET /repos/acme/compta/actions/variables/KLEDG_UPDATES': { body: { value: 'main' } } })
    expect(await getChannel(copy)).toBe('main')
    fakeGitHub({})
    expect(await getChannel(copy)).toBe('releases')
    fakeGitHub({ 'GET /repos/acme/compta/actions/variables/KLEDG_UPDATES': { status: 403, body: {} } })
    expect(await getChannel(copy)).toBeNull()
  })

  it('updates the variable, or creates it', async () => {
    let fake = fakeGitHub({ 'PATCH /repos/acme/compta/actions/variables/KLEDG_UPDATES': { status: 204 } })
    await setChannel(copy, 'off')
    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0].body).toEqual({ name: 'KLEDG_UPDATES', value: 'off' })

    fake = fakeGitHub({ 'POST /repos/acme/compta/actions/variables': { status: 201 } })
    await setChannel(copy, 'main')
    expect(fake.calls.map((c) => c.method)).toEqual(['PATCH', 'POST'])
  })
})

describe('update pull request', () => {
  const pull = { number: 7, title: 'Mise à jour Kledg v0.2.0', html_url: 'https://github.com/acme/compta/pull/7', head: { sha: SHA, ref: 'kledg-update', repo: { id: 42, full_name: 'Acme/Compta' } }, base: { ref: 'main', repo: { id: 42 } }, mergeable: true, mergeable_state: 'clean' }

  it('finds the pull request, its migrations and its Vercel preview', async () => {
    const fake = fakeGitHub({
      'GET /repos/acme/compta/pulls': { body: [pull] },
      'GET /repos/acme/compta/pulls/7': { body: pull },
      'GET /repos/acme/compta/pulls/7/files': {
        body: [
          { filename: 'prisma/migrations/20261101000000_new/migration.sql', status: 'added' },
          { filename: 'app/page.tsx', status: 'modified' },
        ],
      },
      'GET /repos/acme/compta/deployments': { body: [{ id: 99 }] },
      'GET /repos/acme/compta/deployments/99/statuses': { body: [{ state: 'success', environment_url: 'https://compta-git-kledg-update.vercel.app' }] },
    })
    const found = await findUpdatePull(copy)
    expect(found).toMatchObject({
      number: 7,
      headSha: SHA,
      migrations: ['20261101000000_new'],
      preview: { url: 'https://compta-git-kledg-update.vercel.app', state: 'success' },
    })
    expect(fake.calls[0].path).toBe('/repos/acme/compta/pulls?state=open&head=acme%3Akledg-update&base=main&per_page=1')
  })

  it('returns null without an open update pull request', async () => {
    fakeGitHub({ 'GET /repos/acme/compta/pulls': { body: [] } })
    expect(await findUpdatePull(copy)).toBeNull()
  })

  it('merges only the confirmed commit', async () => {
    const fake = fakeGitHub({
      'GET /repos/acme/compta/pulls/7': { body: pull },
      'PUT /repos/acme/compta/pulls/7/merge': { body: { merged: true, sha: MERGED } },
    })
    expect(await mergeUpdatePull(copy, 7, SHA)).toEqual({ sha: MERGED })
    expect(fake.calls.find((c) => c.method === 'PUT')?.body).toEqual({ sha: SHA, merge_method: 'merge' })

    await expect(mergeUpdatePull(copy, 7, 'c'.repeat(40))).rejects.toThrow('a changé depuis votre confirmation')
  })

  it('refuses to merge another pull request', async () => {
    fakeGitHub({ 'GET /repos/acme/compta/pulls/8': { body: { ...pull, number: 8, head: { sha: SHA, ref: 'feature' } } } })
    await expect(mergeUpdatePull(copy, 8, SHA)).rejects.toThrow("n'est pas une mise à jour Kledg")
  })

  it('[KLEDG-R3-INPUT-05] refuses a kledg-update branch of another repository or into another branch', async () => {
    fakeGitHub({
      'GET /repos/acme/compta/pulls/9': { body: { ...pull, number: 9, head: { ...pull.head, repo: { full_name: 'evil/kledg' } } } },
      'GET /repos/acme/compta/pulls/10': { body: { ...pull, number: 10, head: { ...pull.head, repo: null } } },
      'GET /repos/acme/compta/pulls/11': { body: { ...pull, number: 11, base: { ...pull.base, ref: 'release' } } },
      // A fork renamed like the connected repository: same name, another repository id
      'GET /repos/acme/compta/pulls/12': { body: { ...pull, number: 12, head: { ...pull.head, repo: { id: 99, full_name: 'acme/compta' } } } },
      'GET /repos/acme/compta/pulls/13': { body: { ...pull, number: 13, head: { ...pull.head, repo: { full_name: 'acme/compta' } } } },
    })
    for (const n of [9, 10, 11, 12, 13]) await expect(mergeUpdatePull(copy, n, SHA)).rejects.toThrow("n'est pas une mise à jour Kledg")
  })

  it('[KLEDG-R3-INPUT-05] refuses a head pushed between the check and the merge', async () => {
    fakeGitHub({
      'GET /repos/acme/compta/pulls/7': { body: pull },
      'PUT /repos/acme/compta/pulls/7/merge': { status: 409, body: { message: 'Head branch was modified. Review and try the merge again.' } },
    })
    await expect(mergeUpdatePull(copy, 7, SHA)).rejects.toThrow('a changé depuis votre confirmation')
  })

  it('explains a pull request GitHub will not merge', async () => {
    fakeGitHub({
      'GET /repos/acme/compta/pulls/7': { body: pull },
      'PUT /repos/acme/compta/pulls/7/merge': { status: 405, body: { message: 'Pull Request is not mergeable' } },
    })
    await expect(mergeUpdatePull(copy, 7, SHA)).rejects.toThrow('refuse de fusionner')
  })
})

describe('mergeUpstream (forks without the workflow)', () => {
  it('syncs the default branch and returns its new head', async () => {
    const fake = fakeGitHub({
      'POST /repos/acme/compta/merge-upstream': { body: { merge_type: 'fast-forward' } },
      'GET /repos/acme/compta/branches/main': { body: { commit: { sha: MERGED } } },
    })
    expect(await mergeUpstream(fork)).toEqual({ sha: MERGED })
    expect(fake.calls[0].body).toEqual({ branch: 'main' })
  })

  it('reports conflicts and refuses copies', async () => {
    fakeGitHub({ 'POST /repos/acme/compta/merge-upstream': { status: 409, body: {} } })
    await expect(mergeUpstream(fork)).rejects.toThrow('Sync fork')
    await expect(mergeUpstream(copy)).rejects.toThrow("n'est pas un fork")
  })
})

describe('update prepared without its pull request', () => {
  // GitHub refuses the workflow's pull request when the repository does not let Actions create
  // pull requests ("Resource not accessible by integration"): the branch is pushed, nothing else.
  const MESSAGE = "Merge tag 'refs/tags/v0.7.0' into kledg-update"
  const COMPARE = 'GET /repos/acme/compta/compare/main...kledg-update'
  const pull = { number: 9, title: 'Mise à jour Kledg v0.7.0', html_url: 'https://github.com/acme/compta/pull/9', head: { sha: SHA, ref: 'kledg-update', repo: { id: 42, full_name: 'acme/compta' } }, base: { ref: 'main', repo: { id: 42 } }, mergeable: true }

  it('reads the version merged into the branch', () => {
    expect(versionLabelOf(MESSAGE)).toBe('v0.7.0')
    expect(versionLabelOf('Merge https://github.com/kledghq/kledg.git main into kledg-update')).toBeNull()
  })

  it('finds the branch ahead of the default branch, with its migrations', async () => {
    fakeGitHub({
      [COMPARE]: {
        body: {
          status: 'ahead',
          ahead_by: 12,
          commits: [{ sha: 'c'.repeat(40), commit: { message: 'older' } }, { sha: SHA, commit: { message: MESSAGE } }],
          files: [{ filename: 'prisma/migrations/20261218090000_e_invoice_import/migration.sql', status: 'added' }],
        },
      },
      'GET /repos/acme/compta/deployments': { body: [] },
      'GET /repos/acme/compta': { body: { owner: { login: 'acme', type: 'Organization' } } },
    })
    expect(await findUpdateBranch(copy)).toEqual({
      headSha: SHA,
      label: 'v0.7.0',
      url: 'https://github.com/acme/compta/compare/main...kledg-update',
      migrations: ['20261218090000_e_invoice_import'],
      preview: { url: null, state: null },
      settings: {
        organization: { name: 'acme', url: 'https://github.com/organizations/acme/settings/actions' },
        repositoryUrl: 'https://github.com/acme/compta/settings/actions',
      },
    })
  })

  it('links a personal account to the repository settings only', async () => {
    fakeGitHub({ 'GET /repos/acme/compta': { body: { owner: { login: 'acme', type: 'User' } } } })
    expect(await actionsSettingsLinks(copy)).toEqual({ organization: null, repositoryUrl: 'https://github.com/acme/compta/settings/actions' })
  })

  it('finds nothing without the branch, or when it brings nothing', async () => {
    fakeGitHub({ [COMPARE]: { status: 404, body: { message: 'Not Found' } } })
    expect(await findUpdateBranch(copy)).toBeNull()
    resetGitHub()
    fakeGitHub({ [COMPARE]: { body: { status: 'identical', ahead_by: 0, commits: [] } } })
    expect(await findUpdateBranch(copy)).toBeNull()
  })

  it('opens the pull request with the connection token, then merges the confirmed commit', async () => {
    const fake = fakeGitHub({
      'GET /repos/acme/compta/branches/kledg-update': { body: { commit: { sha: SHA, commit: { message: MESSAGE } } } },
      'POST /repos/acme/compta/pulls': { status: 201, body: pull },
      'GET /repos/acme/compta/pulls/9': { body: pull },
      'PUT /repos/acme/compta/pulls/9/merge': { body: { merged: true, sha: MERGED } },
    })
    expect(await installUpdateBranch(copy, SHA)).toEqual({ sha: MERGED })
    expect(fake.calls.find((c) => c.method === 'POST')?.body).toMatchObject({ head: 'kledg-update', base: 'main', title: 'Mise à jour Kledg v0.7.0' })
    expect(fake.calls.find((c) => c.method === 'PUT')?.body).toEqual({ sha: SHA, merge_method: 'merge' })
  })

  it('refuses a branch that moved since the confirmation, without opening anything', async () => {
    const fake = fakeGitHub({ 'GET /repos/acme/compta/branches/kledg-update': { body: { commit: { sha: 'd'.repeat(40) } } } })
    await expect(installUpdateBranch(copy, SHA)).rejects.toThrow('a changé depuis votre confirmation')
    expect(fake.calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('uses the pull request opened meanwhile when GitHub says one exists', async () => {
    fakeGitHub({
      'GET /repos/acme/compta/branches/kledg-update': { body: { commit: { sha: SHA, commit: { message: MESSAGE } } } },
      'POST /repos/acme/compta/pulls': { status: 422, body: { message: 'A pull request already exists for acme:kledg-update.' } },
      'GET /repos/acme/compta/pulls': { body: [pull] },
      'GET /repos/acme/compta/pulls/9': { body: pull },
      'GET /repos/acme/compta/pulls/9/files': { body: [] },
      'GET /repos/acme/compta/deployments': { body: [] },
      'PUT /repos/acme/compta/pulls/9/merge': { body: { merged: true, sha: MERGED } },
    })
    expect(await installUpdateBranch(copy, SHA)).toEqual({ sha: MERGED })
  })
})
