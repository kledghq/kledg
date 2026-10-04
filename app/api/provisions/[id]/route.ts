import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfProvision } from '@/lib/api/resources'
import { deleteProvision, ProvisionBodySchema, updateProvision } from '@/lib/provisions/manage-provisions.service'

const company = fromResource(companyOfProvision)

/** PATCH /api/provisions/[id]: replaces the provision (its account and history are fixed once a movement is validated). */
export const PATCH = companyRoute({ company, permission: { entries: ['create'] }, body: ProvisionBodySchema }, async ({ companyId, params, body }) =>
  NextResponse.json(await updateProvision(companyId, params.id as string, body)),
)

/** DELETE /api/provisions/[id]: with its assessments and draft entries (409 once a movement is validated). */
export const DELETE = companyRoute({ company, permission: { entries: ['delete'] } }, async ({ companyId, params }) => {
  await deleteProvision(companyId, params.id as string)
  return new NextResponse(null, { status: 204 })
})
