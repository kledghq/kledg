/**
 * Nature of an imported invoice line when the document does not say it
 * (#132): Qonto invoices carry no goods or services flag. It matters for
 * the VAT of a sale: due on delivery for goods (CGI art. 269, 2, a), on
 * receipt of the price for services (art. 269, 2, c).
 *
 * In order: the account the tiers posts to (sales: 707 marchandises, 701
 * to 703 produits are goods, 704 to 706 and 708 works and services;
 * purchases: 601, 602, 603, 606 and 607 are goods, 604, 61 and 62
 * services), then, for a sale, the company's activity code (NAF divisions
 * 10 to 33, manufacturing, and 45 to 47, trade, sell goods), else
 * services: for a purchase, its VAT then waits for the payment, deducted
 * later rather than too early (CGI art. 271, I-2). Pure, no imports.
 */

export type LineNature = 'GOODS' | 'SERVICES'

export function defaultLineNature(input: { tiersAccountCode?: string | null; activityCode?: string | null }): LineNature {
  const account = input.tiersAccountCode?.trim() ?? ''
  if (/^70[1237]/.test(account) || /^60[12367]/.test(account)) return 'GOODS'
  if (/^70[4568]/.test(account) || /^(604|61|62)/.test(account)) return 'SERVICES'
  const division = Number((input.activityCode ?? '').replace(/[^0-9]/g, '').slice(0, 2))
  if ((division >= 10 && division <= 33) || (division >= 45 && division <= 47)) return 'GOODS'
  return 'SERVICES'
}
