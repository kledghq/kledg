/**
 * Runs the merge step of .github/workflows/update-from-kledg.yml (the block
 * between "# BEGIN kledg-merge" and "# END kledg-merge") against real local
 * git repositories: a fork (shared history) and copies made by the Vercel
 * button (a single snapshot commit, unrelated to Kledg's history, sometimes
 * without the .github folder).
 */

import { execFileSync, spawnSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const WORKFLOW = path.resolve(__dirname, '../../../.github/workflows/update-from-kledg.yml')

function mergeScript(): string {
  const lines = readFileSync(WORKFLOW, 'utf8').split('\n')
  const start = lines.findIndex((l) => l.includes('# BEGIN kledg-merge'))
  const end = lines.findIndex((l) => l.includes('# END kledg-merge'))
  expect(start).toBeGreaterThan(0)
  expect(end).toBeGreaterThan(start)
  const indent = lines[start].match(/^\s*/)![0].length
  return lines
    .slice(start + 1, end)
    .map((l) => l.slice(indent))
    .join('\n')
}

let root: string
let counter = 0
const BASE_TIME = 1_780_000_000 // seconds

function env(time?: number): NodeJS.ProcessEnv {
  const date = time ? `@${time} +0000` : undefined
  return {
    ...process.env,
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}),
  }
}

function git(cwd: string, args: string[], time?: number): string {
  return execFileSync('git', args, { cwd, env: env(time), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function newDir(name: string): string {
  const dir = path.join(root, `${name}-${++counter}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function init(dir: string) {
  git(dir, ['init', '-q', '-b', 'main'])
}

function write(dir: string, files: Record<string, string | null>) {
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(dir, file)
    if (content === null) {
      if (existsSync(full)) unlinkSync(full)
      continue
    }
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
}

function commit(dir: string, files: Record<string, string | null>, message: string, time: number): string {
  write(dir, files)
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', message], time)
  return git(dir, ['rev-parse', 'HEAD'])
}

const APP_V1 = ['line 1', 'line 2', 'line 3', 'line 4', 'line 5', 'line 6', ''].join('\n')
const CI_V1 = 'name: CI\n'

/** kledghq/kledg: two releases, the second edits app.ts, ci.yml and adds a migration. */
function makeUpstream(): { dir: string; v1: string; v2: string } {
  const dir = newDir('upstream')
  init(dir)
  commit(
    dir,
    {
      'package.json': '{"name":"kledg","version":"0.0.9"}\n',
      'app.ts': APP_V1,
      '.github/workflows/ci.yml': CI_V1,
      'prisma/migrations/0001_init/migration.sql': 'CREATE TABLE a ();\n',
    },
    'Init',
    BASE_TIME,
  )
  const v1 = commit(dir, { 'package.json': '{"name":"kledg","version":"0.1.0"}\n' }, 'Release 0.1.0', BASE_TIME + 100)
  git(dir, ['tag', 'v0.1.0'])
  const v2 = commit(
    dir,
    {
      'package.json': '{"name":"kledg","version":"0.2.0"}\n',
      'app.ts': APP_V1.replace('line 1', 'line 1 (upstream)'),
      '.github/workflows/ci.yml': 'name: CI v2\n',
      'prisma/migrations/0002_more/migration.sql': 'ALTER TABLE a ADD COLUMN b TEXT;\n',
    },
    'Release 0.2.0',
    BASE_TIME + 10_000,
  )
  git(dir, ['tag', 'v0.2.0'])
  return { dir, v1, v2 }
}

/** What the Vercel button does: a new repository whose single commit is a snapshot of upstream. */
function makeVercelCopy(upstream: string, opts: { withGithub: boolean }): string {
  const dir = newDir('copy')
  init(dir)
  const archive = path.join(root, `snapshot-${++counter}.tar`)
  git(upstream, ['archive', '--format=tar', '-o', archive, 'v0.1.0'])
  execFileSync('tar', ['-xf', archive, '-C', dir])
  if (!opts.withGithub) rmSync(path.join(dir, '.github'), { recursive: true, force: true })
  commit(dir, {}, 'Initial commit', BASE_TIME + 500)
  return dir
}

/** What actions/checkout gives the job: a clone of the user's repository, plus the upstream remote. */
function checkout(repo: string, upstream: string, ref: string): string {
  const dir = newDir('runner')
  execFileSync('git', ['clone', '-q', repo, dir], { env: env() })
  git(dir, ['remote', 'add', 'upstream', upstream])
  git(dir, ['fetch', '-q', 'upstream', `refs/tags/${ref}:refs/tags/${ref}`])
  git(dir, ['checkout', '-q', '-B', 'kledg-update'])
  return dir
}

function runMerge(dir: string, opts: { ref: string; workflowToken?: boolean }) {
  const output = path.join(dir, '..', `output-${++counter}`)
  writeFileSync(output, '')
  const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', mergeScript()], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...env(BASE_TIME + 20_000),
      REF: `refs/tags/${opts.ref}`,
      BASE: 'main',
      HAS_WORKFLOW_TOKEN: opts.workflowToken ? 'true' : 'false',
      GITHUB_OUTPUT: output,
    },
  })
  const outputs = Object.fromEntries(
    readFileSync(output, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  )
  return { status: result.status, stdout: result.stdout + result.stderr, outputs }
}

const read = (dir: string, file: string) => readFileSync(path.join(dir, file), 'utf8')

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'kledg-update-'))
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('update workflow merge step', () => {
  it('merges a fork normally and keeps local changes', () => {
    const up = makeUpstream()
    const fork = newDir('fork')
    execFileSync('git', ['clone', '-q', '--branch', 'v0.1.0', up.dir, fork], { env: env() })
    git(fork, ['checkout', '-q', '-B', 'main'])
    commit(fork, { 'app.ts': APP_V1.replace('line 6', 'line 6 (mine)') }, 'My change', BASE_TIME + 600)

    const runner = checkout(fork, up.dir, 'v0.2.0')
    const { status, outputs, stdout } = runMerge(runner, { ref: 'v0.2.0' })

    expect(status, stdout).toBe(0)
    expect(outputs.adopted).toBeUndefined()
    expect(read(runner, 'app.ts')).toContain('line 1 (upstream)')
    expect(read(runner, 'app.ts')).toContain('line 6 (mine)')
    expect(existsSync(path.join(runner, 'prisma/migrations/0002_more/migration.sql'))).toBe(true)
    // The Actions token cannot push workflow changes: ci.yml stays as it was.
    expect(read(runner, '.github/workflows/ci.yml')).toBe(CI_V1)
    expect(outputs.workflows_kept).toContain('.github/workflows/ci.yml')
  })

  it('refuses a plain merge of a Vercel copy (unrelated histories)', () => {
    const up = makeUpstream()
    const copy = makeVercelCopy(up.dir, { withGithub: true })
    const runner = checkout(copy, up.dir, 'v0.2.0')
    const plain = spawnSync('git', ['merge', '--no-edit', 'refs/tags/v0.2.0'], { cwd: runner, env: env(), encoding: 'utf8' })
    expect(plain.status).not.toBe(0)
    expect(plain.stderr).toContain('unrelated histories')
  })

  it('attaches a Vercel copy without .github to Kledg history, then merges the update', () => {
    const up = makeUpstream()
    const copy = makeVercelCopy(up.dir, { withGithub: false })
    commit(copy, { 'app.ts': APP_V1.replace('line 6', 'line 6 (mine)'), 'NOTES.md': 'mine\n' }, 'My change', BASE_TIME + 700)

    const runner = checkout(copy, up.dir, 'v0.2.0')
    const { status, outputs, stdout } = runMerge(runner, { ref: 'v0.2.0' })

    expect(status, stdout).toBe(0)
    expect(outputs.adopted).toBe(up.v1)
    expect(read(runner, 'app.ts')).toContain('line 1 (upstream)')
    expect(read(runner, 'app.ts')).toContain('line 6 (mine)')
    expect(read(runner, 'NOTES.md')).toBe('mine\n')
    expect(read(runner, 'package.json')).toContain('0.2.0')
    expect(existsSync(path.join(runner, 'prisma/migrations/0002_more/migration.sql'))).toBe(true)
    // No workflow file is pushed with the Actions token.
    expect(git(runner, ['diff', '--name-only', 'origin/main', 'HEAD', '--', '.github'])).toBe('')
    // Kledg history is now an ancestor: the next update is a normal merge.
    expect(spawnSync('git', ['merge-base', '--is-ancestor', up.v2, 'HEAD'], { cwd: runner }).status).toBe(0)
  })

  it('takes Kledg workflow changes when a workflow token is configured', () => {
    const up = makeUpstream()
    const copy = makeVercelCopy(up.dir, { withGithub: true })
    const runner = checkout(copy, up.dir, 'v0.2.0')
    const { status, outputs, stdout } = runMerge(runner, { ref: 'v0.2.0', workflowToken: true })

    expect(status, stdout).toBe(0)
    expect(outputs.adopted).toBe(up.v1)
    expect(outputs.workflows_kept).toBeUndefined()
    expect(read(runner, '.github/workflows/ci.yml')).toBe('name: CI v2\n')
  })

  it('stops on a real conflict with local changes', () => {
    const up = makeUpstream()
    const copy = makeVercelCopy(up.dir, { withGithub: true })
    commit(copy, { 'app.ts': APP_V1.replace('line 1', 'line 1 (mine)') }, 'Conflicting change', BASE_TIME + 700)
    const runner = checkout(copy, up.dir, 'v0.2.0')
    const { status, stdout } = runMerge(runner, { ref: 'v0.2.0' })

    expect(status).toBe(1)
    expect(stdout).toContain('fusionnez à la main')
  })
})
