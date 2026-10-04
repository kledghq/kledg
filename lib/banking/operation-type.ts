/**
 * French labels for the operation types banks send with a transaction
 * (Qonto `operation_type`, imported statements). Pure module, usable by
 * client components: the raw provider codes ("transfer", "card") must never
 * reach the UI.
 */

const LABELS: Record<string, string> = {
  transfer: 'Virement',
  income: 'Virement reçu',
  swift_income: 'Virement international reçu',
  swift_transfer: 'Virement international',
  instant_transfer: 'Virement instantané',
  card: 'Carte',
  card_acquirer_payout: 'Encaissement carte',
  direct_debit: 'Prélèvement',
  direct_debit_collection: 'Prélèvement émis',
  direct_debit_hold: 'Prélèvement en attente',
  cheque: 'Chèque',
  check: 'Chèque',
  qonto_fee: 'Frais bancaires',
  fee: 'Frais bancaires',
  recall: 'Rappel de virement',
  pay_later: 'Paiement différé',
  financing_installment: 'Échéance de financement',
  atm: 'Retrait',
  cash: 'Espèces',
  sepa: 'SEPA',
}

/**
 * French label of a bank operation type. Unknown codes are turned into words
 * ("other_thing" gives "Other thing") rather than hidden, so nothing is lost;
 * a missing type gives null.
 */
export function operationTypeLabel(type: string | null | undefined): string | null {
  if (!type) return null
  const key = type.trim().toLowerCase()
  if (!key) return null
  const known = LABELS[key]
  if (known) return known
  const words = key.replace(/[_-]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
