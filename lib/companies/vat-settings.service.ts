/**
 * VAT settings that decide how invoices post (lib/invoices/posting-plan.ts):
 * the option to pay VAT on services on debits. CGI art. 269, 2, c: VAT on
 * services is due when the price is received, unless the company opted to
 * pay it on debits (the option is then printed on its invoices, CGI ann. II
 * art. 242 nonies A, I, 11° bis). The VAT franchise (isVatExempt) is shown
 * here and edited with the company's information. The mention of the
 * invoices of exempt training sales is set here too.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/accounting/errors'
import { writeAuditLog } from '@/lib/audit'
import { MAX_MENTION_LENGTH, VAT_EXEMPTIONS } from '@/lib/invoices/vat-exemptions'

/** Body of PUT /api/companies/[id]/vat-settings. */
export const VatSettingsBodySchema = z.object({
  servicesVatOnDebits: z.boolean({ error: 'Précisez si la TVA sur les prestations est payée d’après les débits' }).optional(),
  /**
   * Mention of the invoices of exempt training sales (CGI ann. II art. 242
   * nonies A, I, 12°); null or empty: the default of lib/invoices/vat-exemptions.ts.
   */
  vatExemptionMention: z.string().trim().max(MAX_MENTION_LENGTH, `${MAX_MENTION_LENGTH} caractères au plus`).nullable().optional(),
}).refine((body) => body.servicesVatOnDebits !== undefined || body.vatExemptionMention !== undefined, {
  error: 'Précisez si la TVA sur les prestations est payée d’après les débits, ou la mention d’exonération',
})

export interface VatSettings {
  servicesVatOnDebits: boolean
  isVatExempt: boolean
  vatExemptionMention: string | null
  /** The mention printed when the company set none. */
  defaultVatExemptionMention: string
}

const SELECT = { servicesVatOnDebits: true, isVatExempt: true, vatExemptionMention: true } as const
const withDefault = (row: Omit<VatSettings, 'defaultVatExemptionMention'>): VatSettings => ({ ...row, defaultVatExemptionMention: VAT_EXEMPTIONS.training.defaultMention })

export async function getVatSettings(companyId: string): Promise<VatSettings> {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: SELECT })
  if (!company) throw new NotFoundError('Société introuvable')
  return withDefault(company)
}

export async function updateVatSettings(companyId: string, input: z.infer<typeof VatSettingsBodySchema>): Promise<VatSettings> {
  const company = await prisma.company.update({
    where: { id: companyId },
    data: {
      ...(input.servicesVatOnDebits !== undefined ? { servicesVatOnDebits: input.servicesVatOnDebits } : {}),
      ...(input.vatExemptionMention !== undefined ? { vatExemptionMention: input.vatExemptionMention ? input.vatExemptionMention : null } : {}),
    },
    select: SELECT,
  })
  await writeAuditLog('info', 'VAT settings updated', { action: 'UPDATE_VAT_SETTINGS', companyId, metadata: input })
  return withDefault(company)
}
