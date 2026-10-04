/**
 * French labels of the operation types bank providers send (Qonto
 * `operation_type`, Ponto codes): "transfer" reads "Virement" in the UI.
 * Pure module, usable in client components. Unknown types are shown as sent.
 */

const LABELS: Record<string, string> = {
  card: 'Carte',
  transfer: 'Virement',
  direct_debit: 'Prélèvement',
  direct_debit_collection: 'Prélèvement émis',
  income: 'Encaissement',
  cheque: 'Chèque',
  check: 'Chèque',
  qonto_fee: 'Frais bancaires',
  fee: 'Frais bancaires',
  swift_income: 'Virement international reçu',
  swift_outcome: 'Virement international',
  recall: 'Rappel de virement',
  financing_installment: 'Échéance de financement',
  pay_later: 'Paiement différé',
  other: 'Autre',
}

export function operationTypeLabel(type: string | null | undefined): string {
  if (!type) return ''
  return LABELS[type] ?? type
}
