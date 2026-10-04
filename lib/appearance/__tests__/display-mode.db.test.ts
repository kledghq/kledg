/**
 * Display mode against PostgreSQL (migration 20261031090000_user_display_mode,
 * docs/mode-simple.md), through the real routes with only the session mocked:
 * - a user who never chose reads 'expert' (existing users see no change);
 * - the choice persists in the user's preferences row, next to the chart
 *   colours, without touching them (and colours saved later keep the mode);
 * - a row holding only the mode reads as the default colours;
 * - the database refuses any other value;
 * - the onboarding step is asked on the first run only.
 *
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('display_mode')
  return { user: null as null | { id: string; email: string; name: string; role: string | null } }
})

vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => state.user,
}))

import { prepareTestDatabase, queryAsOwner, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

type Prisma = typeof import('@/lib/prisma').prisma
type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>

let prisma: Prisma
let modeRoute: Record<'GET' | 'PUT', Handler>
let appearanceRoute: Record<'GET' | 'PUT', Handler>

const USERS = {
  claire: { id: 'u-claire', email: 'claire@test.local', name: 'Claire', role: 'user' },
  marc: { id: 'u-marc', email: 'marc@test.local', name: 'Marc', role: 'user' },
  member: { id: 'u-member', email: 'member@test.local', name: 'Membre', role: 'user' },
} as const
type Who = keyof typeof USERS | 'anonymous'

function call(who: Who, handler: Handler, method: 'GET' | 'PUT', path: string, body?: unknown) {
  state.user = who === 'anonymous' ? null : { ...USERS[who] }
  return handler(
    new NextRequest(`http://localhost${path}`, {
      method,
      ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
    }),
    { params: Promise.resolve({}) },
  )
}

const readMode = async (who: Who) => (await (await call(who, modeRoute.GET, 'GET', '/api/account/display-mode')).json()) as { mode: string; chosen: boolean }
const setMode = (who: Who, mode: unknown) => call(who, modeRoute.PUT, 'PUT', '/api/account/display-mode', { mode })

describe.skipIf(!available)('display mode preference', () => {
  beforeAll(async () => {
    await prepareTestDatabase('display_mode')
    ;({ prisma } = await import('@/lib/prisma'))
    modeRoute = (await import('@/app/api/account/display-mode/route')) as unknown as typeof modeRoute
    appearanceRoute = (await import('@/app/api/account/appearance/route')) as unknown as typeof appearanceRoute
    for (const user of Object.values(USERS)) {
      await prisma.user.create({ data: { id: user.id, email: user.email, name: user.name, role: user.role } })
    }
    const company = await prisma.company.create({ data: { name: 'Atelier Lumen', slug: 'atelier-lumen', siren: '111111111' } })
    await prisma.organization.create({ data: { id: 'org-a', name: 'A', slug: 'org-a', createdAt: new Date(), companyId: company.id } })
    await prisma.member.create({ data: { id: 'm-member', userId: 'u-member', organizationId: 'org-a', role: 'companyAdmin', createdAt: new Date() } })
  }, 60_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('reads expert for a user who never chose, without writing a row', async () => {
    expect(await readMode('claire')).toEqual({ mode: 'expert', chosen: false })
    expect(await prisma.userPreference.count()).toBe(0)
  })

  it('answers 401 to an anonymous request', async () => {
    expect((await call('anonymous', modeRoute.GET, 'GET', '/api/account/display-mode')).status).toBe(401)
    expect((await setMode('anonymous', 'simple')).status).toBe(401)
  })

  it("persists the choice in the user's own row, and reads the default colours", async () => {
    const response = await setMode('claire', 'simple')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ mode: 'simple', chosen: true })
    expect(await readMode('claire')).toEqual({ mode: 'simple', chosen: true })
    // Another user is not affected
    expect(await readMode('marc')).toEqual({ mode: 'expert', chosen: false })
    const row = await prisma.userPreference.findUnique({ where: { userId: 'u-claire' } })
    expect(row).toMatchObject({ displayMode: 'simple', appearance: null })
    const appearance = (await (await call('claire', appearanceRoute.GET, 'GET', '/api/account/appearance')).json()) as { isDefault: boolean; appearance: { palette: string } }
    expect(appearance).toMatchObject({ isDefault: true, appearance: { palette: 'sobre' } })
  })

  it('keeps the colours when the mode changes, and the mode when the colours change', async () => {
    expect((await call('marc', appearanceRoute.PUT, 'PUT', '/api/account/appearance', { palette: 'pastel' })).status).toBe(200)
    expect((await setMode('marc', 'simple')).status).toBe(200)
    expect((await setMode('marc', 'expert')).status).toBe(200)
    expect((await call('marc', appearanceRoute.PUT, 'PUT', '/api/account/appearance', { palette: 'contraste' })).status).toBe(200)
    const row = await prisma.userPreference.findUnique({ where: { userId: 'u-marc' } })
    expect(row?.displayMode).toBe('expert')
    expect(row?.appearance).toMatchObject({ palette: 'contraste' })
    expect(await readMode('marc')).toEqual({ mode: 'expert', chosen: true })
  })

  it('refuses another value in the API and in the database', async () => {
    expect((await setMode('claire', 'debutant')).status).toBe(400)
    expect((await call('claire', modeRoute.PUT, 'PUT', '/api/account/display-mode', { mode: 'expert', userId: 'u-marc' })).status).toBe(400)
    expect(await readMode('claire')).toEqual({ mode: 'simple', chosen: true })
    await expect(queryAsOwner('display_mode', `UPDATE "user_preferences" SET "displayMode" = 'debutant' WHERE "userId" = 'u-claire'`)).rejects.toThrow(
      /user_preferences_displayMode_check/,
    )
  })

  it('asks the onboarding question on the first run only', async () => {
    const { shouldAskDisplayMode } = await import('../display-mode.service')
    // Never chose and no company yet: asked
    await prisma.user.create({ data: { id: 'u-new', email: 'new@test.local', name: 'Nouveau', role: 'user' } })
    expect(await shouldAskDisplayMode('u-new')).toBe(true)
    // Already chose: not asked again
    expect(await shouldAskDisplayMode('u-claire')).toBe(false)
    // An existing member who never chose keeps the expert mode, unasked
    expect(await shouldAskDisplayMode('u-member')).toBe(false)
  })
})
