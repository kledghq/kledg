import { parisDayOf } from '@/lib/accounting/entry-date'
import { formatIsoDateFr } from '@/lib/utils/date'

/**
 * Expiry day of an invitation as shown in its email and on its page
 * (dd/mm/yyyy). The expiry is an instant; the day shown is the one in France,
 * whatever the server timezone: an invitation that expires at 0:30 in Paris
 * (23:30 UTC the day before) expires on the Paris day.
 */
export function invitationExpiresOn(expiresAt: Date): string {
  return formatIsoDateFr(parisDayOf(expiresAt))
}
