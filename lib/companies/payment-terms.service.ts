/**
 * Payment terms of a company, read by the aged balance to compute due dates
 * (lib/reports/third-parties/payment-terms.ts). Saving refuses terms above
 * the caps of Code de commerce art. L441-10 (60 days, or 45 days end of
 * month), with the same check as the database constraint
 * (migration 20261018090000).
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { writeAuditLog } from '@/lib/audit'
import { capPaymentTerms, MAX_PAYMENT_DAYS, paymentTermsErrors, type PaymentTerms } from '@/lib/reports/third-parties/payment-terms'

/** Body of PUT /api/companies/[id]/payment-terms. */
export const PaymentTermsBodySchema = z.object({
  days: z
    .number({ error: 'Indiquez le délai en jours' })
    .int('Le délai est un nombre entier de jours')
    .min(0, 'Le délai ne peut pas être négatif')
    .max(MAX_PAYMENT_DAYS, `Le délai ne peut dépasser ${MAX_PAYMENT_DAYS} jours (Code de commerce, art. L441-10)`),
  endOfMonth: z.boolean({ error: 'Précisez si le délai court jusqu’à la fin du mois' }).default(false),
})

export async function getPaymentTerms(companyId: string): Promise<PaymentTerms> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { paymentTermsDays: true, paymentTermsEndOfMonth: true },
  })
  if (!company) throw new NotFoundError('Société introuvable')
  return capPaymentTerms({ days: company.paymentTermsDays, endOfMonth: company.paymentTermsEndOfMonth })
}

export async function updatePaymentTerms(companyId: string, terms: PaymentTerms): Promise<PaymentTerms> {
  const errors = paymentTermsErrors(terms)
  if (errors.length > 0) throw new ValidationError(errors.join(' '))
  const company = await prisma.company.update({
    where: { id: companyId },
    data: { paymentTermsDays: terms.days, paymentTermsEndOfMonth: terms.endOfMonth },
    select: { paymentTermsDays: true, paymentTermsEndOfMonth: true },
  })
  await writeAuditLog('info', 'Payment terms updated', {
    action: 'UPDATE_PAYMENT_TERMS',
    companyId,
    metadata: { days: terms.days, endOfMonth: terms.endOfMonth },
  })
  return { days: company.paymentTermsDays, endOfMonth: company.paymentTermsEndOfMonth }
}
