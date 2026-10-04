/**
 * VAT settings that decide how invoices post (lib/invoices/posting-plan.ts):
 * the option to pay VAT on services on debits. CGI art. 269, 2, c: VAT on
 * services is due when the price is received, unless the company opted to
 * pay it on debits (the option is then printed on its invoices, CGI ann. II
 * art. 242 nonies A, I, 11° bis). The VAT franchise (isVatExempt) is shown
 * here and edited with the company's information.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/accounting/errors'
import { writeAuditLog } from '@/lib/audit'

/** Body of PUT /api/companies/[id]/vat-settings. */
export const VatSettingsBodySchema = z.object({
  servicesVatOnDebits: z.boolean({ error: 'Précisez si la TVA sur les prestations est payée d’après les débits' }),
})

export interface VatSettings {
  servicesVatOnDebits: boolean
  isVatExempt: boolean
}

export async function getVatSettings(companyId: string): Promise<VatSettings> {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { servicesVatOnDebits: true, isVatExempt: true } })
  if (!company) throw new NotFoundError('Société introuvable')
  return company
}

export async function updateVatSettings(companyId: string, input: z.infer<typeof VatSettingsBodySchema>): Promise<VatSettings> {
  const company = await prisma.company.update({
    where: { id: companyId },
    data: { servicesVatOnDebits: input.servicesVatOnDebits },
    select: { servicesVatOnDebits: true, isVatExempt: true },
  })
  await writeAuditLog('info', 'VAT settings updated', { action: 'UPDATE_VAT_SETTINGS', companyId, metadata: input })
  return company
}
