import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { writeAuditLog } from '@/lib/audit'
import {
  eraseCompanyPerson,
  exportCompanyPerson,
  updateCompanyPerson,
  UpdatePersonSchema,
} from '@/lib/companies/manage-persons.service'

/** GET: every data held on the person, with its links (RGPD art. 15 and 20). */
export const GET = companyRoute(
  { company: fromParam('id'), permission: { settings: ['read'] } },
  async ({ params, companyId }) => NextResponse.json(await exportCompanyPerson(companyId, params.personId as string)),
)

/** PATCH: corrects the data of a person of the company (RGPD art. 16). */
export const PATCH = companyRoute(
  { company: fromParam('id'), permission: { settings: ['update'] }, body: UpdatePersonSchema },
  async ({ params, companyId, body }) => {
    const person = await updateCompanyPerson(companyId, params.personId as string, body)
    await writeAuditLog('info', 'Person rectified', { action: 'PERSON_UPDATED', companyId, metadata: { personId: person.id } })
    return NextResponse.json(person)
  },
)

/** DELETE: erases a person of the company, within what the law obliges to keep (RGPD art. 17). */
export const DELETE = companyRoute(
  { company: fromParam('id'), permission: { settings: ['update'] } },
  async ({ params, companyId }) => {
    const result = await eraseCompanyPerson(companyId, params.personId as string)
    await writeAuditLog('info', 'Person erased', { action: 'PERSON_ERASED', companyId, metadata: { personId: params.personId } })
    return NextResponse.json(result)
  },
)
