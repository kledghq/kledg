import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ActiveConnection } from '../connection'
import {
  findUpdatePull,
  getChannel,
  mergeUpdatePull,
  mergeUpstream,
  prepareUpdate,
  setChannel,
  setRetryDelay,
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
      ...workflowRoutes({ file: 'old workflow', state: 'disabled_fork' }),
      [`PUT ${WF}/enable`]: { status: 204 },
    })
    const result = await prepareUpdate(fork, 'releases')
    expect(result).toMatchObject({ mode: 'workflow', workflowInstalled: false })
    expect(fake.called('PUT', `${WF}/enable`)).toBe(true)
    // A fork shares Kledg's history: its workflow is not rewritten.
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
  const pull = { number: 7, title: 'Mise à jour Kledg v0.2.0', html_url: 'https://github.com/acme/compta/pull/7', head: { sha: SHA, ref: 'kledg-update' }, mergeable: true, mergeable_state: 'clean' }

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
