/**
 * Erasure of a natural person (RGPD art. 17) in the details of an approval
 * of the accounts (lib/approval/schemas.ts): chair, secretary, officers and
 * proxies are stored as names. Pure: no database access.
 *
 * - Approved accounts (approvedOn set): the minutes are a company-law record
 *   the company keeps (procès-verbaux of the decisions, C. com. R221-3,
 *   R223-24, R225-106; the decision on the allocation of the result backs
 *   the accounting entries, kept 10 years, C. com. L123-22). Erasure does
 *   not reach them: RGPD art. 17, 3, b (legal obligation) and e (defence of
 *   legal claims). They are left unchanged.
 * - Accounts not approved yet: the pack is a draft, no retention applies;
 *   the person's name is replaced by ERASED_PERSON.
 */

import type { ApprovalDetails } from './schemas'

export const ERASED_PERSON = 'Personne effacée'

const normalize = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()

/** The ways a person's name is written in the details: first name and birth or usual name, both orders. */
export function namesOfPerson(person: { firstName: string; name: string; usualName?: string | null }): Set<string> {
  const names = new Set<string>()
  for (const last of [person.name, person.usualName].filter((n): n is string => !!n && !!n.trim())) {
    names.add(normalize(`${person.firstName} ${last}`))
    names.add(normalize(`${last} ${person.firstName}`))
  }
  return names
}

/** Whether `value` names the person (the name alone, or followed by a title after a comma). */
function names(value: string | null | undefined, set: Set<string>): boolean {
  if (!value) return false
  return set.has(normalize(value)) || set.has(normalize(value.split(',')[0]))
}

/** The details with the person's name replaced, and whether anything changed. */
export function pseudonymiseApprovalDetails(details: ApprovalDetails, person: Set<string>): { details: ApprovalDetails; changed: boolean } {
  let changed = false
  const swap = <T extends string | null>(value: T): T | string => {
    if (!names(value, person)) return value
    changed = true
    return ERASED_PERSON
  }
  const next: ApprovalDetails = {
    ...details,
    chair: details.chair ? { ...details.chair, name: swap(details.chair.name) } : details.chair,
    secretary: swap(details.secretary),
    officers: details.officers.map((officer) => ({ ...officer, name: swap(officer.name) })),
    attendance: details.attendance.map((row) => ({ ...row, proxy: swap(row.proxy) })),
  }
  return { details: next, changed }
}

/** Whether the details name the person anywhere. */
export function approvalNamesPerson(details: ApprovalDetails, person: Set<string>): boolean {
  return pseudonymiseApprovalDetails(details, person).changed
}
