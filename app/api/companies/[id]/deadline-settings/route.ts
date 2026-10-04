import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { DeadlineSettingsBody } from '@/lib/deadlines/settings'
import { getDeadlineSettings, saveDeadlineSettings } from '@/lib/deadlines/deadline-settings.service'

/** GET: the settings of the deadline calendar (defaults when never saved). */
export const GET = companyRoute(
  { company: fromParam('id'), permission: { settings: ['read'] } },
  async ({ companyId }) => NextResponse.json(await getDeadlineSettings(companyId)),
)

/** PUT: replaces the settings of the deadline calendar (company settings: administrators). */
export const PUT = companyRoute(
  { company: fromParam('id'), permission: { settings: ['update'] }, body: DeadlineSettingsBody },
  async ({ companyId, body }) => NextResponse.json(await saveDeadlineSettings(companyId, body)),
)
