/**
 * Structure of the group space (docs/vue-groupe.md): the organigramme of the
 * holding, its holders and its subsidiaries (structure.ts), from the cap
 * tables of the companies read (collectGroupHolders, the same reading as
 * Associés et dirigeants).
 *
 * What leaves the server about a subsidiary the user does not read: a node
 * "Société non accessible" with an opaque key, the holding's arrow to it
 * without percentage and the arrows it has to companies read (from their
 * own cap tables, read with the user's rights). Never its id, name, SIREN
 * or figures; its name only when the user is a member of it with a role
 * too low (as everywhere in the group space). Persons and companies outside
 * the group get positional keys: an internal key carries an email or an id.
 */

import type { GroupAccess } from '@/lib/management-fees/access'
import { MAX_GROUP_SUBSIDIARIES } from '@/lib/management-fees/holding'
import { collectGroupHolders } from './get-group-persons.service'
import { perimeterWarnings } from './members'
import { companyKey } from './ownership'
import { readIfAllowed, type UnreachableSubsidiary } from './perimeter'
import { buildGroupStructure, type GroupStructure, type StructureHiddenInput, type StructureHolderInput, type StructureHoldingInput } from './structure'

export interface GroupStructureReport extends GroupStructure {
  holding: { id: string; name: string; slug: string }
  unreachable: UnreachableSubsidiary[]
  truncated: number
  warnings: string[]
}

export async function getGroupStructure(holdingId: string, access: GroupAccess): Promise<GroupStructureReport> {
  const { read, readable, subsidiaries, drafts, edges } = await collectGroupHolders(holdingId, access)

  // Subsidiaries not read, within the limit of the group space: opaque keys, named only for a member with a role too low.
  const hiddenIds = [...subsidiaries].slice(0, MAX_GROUP_SUBSIDIARIES).filter((id) => !readable.has(id))
  const hiddenNames: Array<{ id: string; name: string | null }> = []
  for (const id of hiddenIds) {
    const result = await readIfAllowed(access, id, async () => null)
    hiddenNames.push({ id, name: result.ok ? null : result.unreachable.name })
  }
  hiddenNames.sort((a, b) => (a.name ?? '￿').localeCompare(b.name ?? '￿', 'fr'))
  const hiddenKey = new Map(hiddenNames.map((h, i) => [companyKey(h.id), `hidden-${i + 1}`]))
  const hidden: StructureHiddenInput[] = hiddenNames.map((h, i) => ({ key: `hidden-${i + 1}`, name: h.name }))

  // Holders outside the companies read: positional keys.
  const holderKey = new Map<string, string>()
  const holders: StructureHolderInput[] = []
  for (const d of drafts.values()) {
    if (d.kind === 'officer' || d.groupCompanyId || d.hidden) continue
    const key = `holder-${holders.length + 1}`
    holderKey.set(d.key, key)
    holders.push({ key, kind: d.kind === 'person' ? 'person' : d.kind === 'company' ? 'company' : 'other', name: d.name ?? 'Actionnaire', photo: d.photo })
  }
  const keyOf = (internal: string) => {
    const id = internal.startsWith('company:') ? internal.slice('company:'.length) : null
    if (id && readable.has(id)) return internal
    return hiddenKey.get(internal) ?? holderKey.get(internal) ?? null
  }

  const holdings: StructureHoldingInput[] = []
  for (const e of edges) {
    const key = keyOf(e.holderKey)
    if (key) holdings.push({ holderKey: key, companyKey: e.companyId, bp: e.bp })
  }
  // The holding holds each hidden subsidiary (that is what makes it a subsidiary); the percentage is in its own cap table.
  for (const h of hidden) holdings.push({ holderKey: companyKey(holdingId), companyKey: h.key, bp: null })

  const structure = buildGroupStructure({
    holdingId,
    companies: read.members.map((m) => ({
      id: m.ref.id,
      name: m.ref.name,
      slug: m.ref.slug,
      role: m.ref.role,
      logo: m.value.company?.logo ?? null,
      legalType: m.value.company?.legalType ?? null,
      officers: m.value.officers,
    })),
    hidden,
    holders,
    holdings,
  })

  const warnings = perimeterWarnings(read.unreachable.length, read.truncated)
  if (read.unreachable.length > 0) {
    warnings.push('Les associés des filiales non lues ne sont pas connus\u00a0: le pourcentage détenu par la holding et les chaînes qui passent par elles manquent.')
  }
  return {
    ...structure,
    holding: { id: read.holding.id, name: read.holding.name, slug: read.holding.slug },
    unreachable: read.unreachable,
    truncated: read.truncated,
    warnings,
  }
}
