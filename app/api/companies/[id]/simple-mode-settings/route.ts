import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { writeAuditLog } from '@/lib/audit'
import { getSimpleModeSettings, SimpleModeSettingsBodySchema, updateSimpleModeSettings } from '@/lib/simple/simple-mode-settings.service'

/** GET /api/companies/[id]/simple-mode-settings: whether simple mode entries wait for the accountant, and who they are. */
export const GET = companyRoute(
  { company: fromParam(), permission: { settings: ['read'] } },
  async ({ companyId }) => NextResponse.json(await getSimpleModeSettings(companyId), { headers: NO_CACHE_HEADERS }),
)

/** PUT /api/companies/[id]/simple-mode-settings { accountantReview: true | false | null }: null goes back to the default. */
export const PUT = companyRoute(
  { company: fromParam(), permission: { settings: ['update'] }, body: SimpleModeSettingsBodySchema },
  async ({ companyId, body }) => {
    const settings = await updateSimpleModeSettings(companyId, body)
    await writeAuditLog('info', 'Simple mode accountant review setting changed', {
      action: 'UPDATE_SIMPLE_MODE_SETTINGS',
      companyId,
      metadata: { accountantReview: body.accountantReview },
    })
    return NextResponse.json(settings)
  },
)
