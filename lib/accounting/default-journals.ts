import { prisma } from '@/lib/prisma'

/**
 * Canonical journals: the standard French set every company gets once, at
 * creation (createCompany). Nothing else creates default journals; closing
 * adds CL "Journal de clôture" when it posts. The journals an old read of the
 * Journaux page added on top (VT "Ventes", CA "Caisse") are removed by the
 * data migration 20261010090000_remove_leftover_journals when unused.
 */
export const DEFAULT_JOURNALS = [
  { code: 'AC', label: 'Achats' },
  { code: 'VE', label: 'Ventes' },
  { code: 'BQ', label: 'Banque' },
  { code: 'OD', label: 'Opérations diverses' },
  { code: 'AN', label: 'À-nouveaux' },
] as const

/** Creates the default journals that don't exist yet for a company. */
export async function ensureDefaultJournals(companyId: string): Promise<void> {
  const existing = await prisma.journal.findMany({ where: { companyId }, select: { code: true } })
  const codes = new Set(existing.map((j) => j.code))
  const missing = DEFAULT_JOURNALS.filter((j) => !codes.has(j.code))
  if (missing.length === 0) return
  await prisma.journal.createMany({ data: missing.map((j) => ({ ...j, companyId })) })
}
