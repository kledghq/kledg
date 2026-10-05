import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import {
  deleteRemunerationScenario,
  saveRemunerationScenario,
  SaveScenarioBodySchema,
  ScenarioQuerySchema,
} from '@/lib/remuneration/save-remuneration-scenario.service'
import { REMUNERATION_WRITE } from '@/lib/remuneration/permissions'

/** PUT /api/companies/[id]/remuneration/scenarios { fiscalYearId, name, inputs, pick }: saves a scenario (replaced when the name exists in the fiscal year). */
export const PUT = companyRoute(
  { company: fromParam(), permission: REMUNERATION_WRITE, body: SaveScenarioBodySchema },
  async ({ companyId, body, user }) => NextResponse.json(await saveRemunerationScenario(companyId, body, user.id)),
)

/** DELETE /api/companies/[id]/remuneration/scenarios?scenarioId=: deletes a saved scenario. */
export const DELETE = companyRoute(
  { company: fromParam(), permission: REMUNERATION_WRITE, query: ScenarioQuerySchema },
  async ({ companyId, query }) => {
    await deleteRemunerationScenario(companyId, query.scenarioId)
    return new NextResponse(null, { status: 204 })
  },
)
