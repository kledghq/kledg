import type { BankTransaction } from '@prisma/client';
import { centsToDecimal, toCents } from '@/lib/utils/money';
import type { TransactionRuleConditionInput } from './types';

/**
 * Extrait les conditions suggérées depuis une transaction
 */
export function extractConditionsFromTransaction(
  transaction: BankTransaction & {
    counterpartyName?: string | null;
    category?: string | null;
    cashflowCategory?: string | null;
    cashflowSubcategory?: string | null;
    operationType?: string | null;
    status?: string | null;
    attachmentsCount?: number;
    attachments?: unknown[];
  }
): TransactionRuleConditionInput[] {
  const conditions: TransactionRuleConditionInput[] = [];

  // Condition sur contrepartie si disponible
  if (transaction.counterpartyName) {
    conditions.push({
      conditionType: 'counterparty',
      operator: 'equals',
      value: transaction.counterpartyName,
    });
  }

  // Condition sur catégorie si disponible
  if (transaction.category) {
    conditions.push({
      conditionType: 'category',
      operator: 'equals',
      value: transaction.category,
    });
  }

  // Condition sur catégorie de flux si disponible
  if (transaction.cashflowCategory) {
    conditions.push({
      conditionType: 'cashflowCategory',
      operator: 'equals',
      value: transaction.cashflowCategory,
    });
  }

  // Condition sur sous-catégorie de flux si disponible
  if (transaction.cashflowSubcategory) {
    conditions.push({
      conditionType: 'cashflowSubcategory',
      operator: 'equals',
      value: transaction.cashflowSubcategory,
    });
  }

  // Condition sur type d'opération
  if (transaction.operationType) {
    conditions.push({
      conditionType: 'operationType',
      operator: 'equals',
      value: transaction.operationType,
    });
  }

  // Condition sur le sens (debit/credit)
  if (transaction.side) {
    conditions.push({
      conditionType: 'side',
      operator: 'equals',
      value: transaction.side,
    });
  }

  // Condition sur le status (ex: completed pour TVA vérifiée)
  if (transaction.status) {
    conditions.push({
      conditionType: 'status',
      operator: 'equals',
      value: transaction.status,
    });
  }

  // Condition justificatif (attachments)
  const attachmentsCount =
    transaction.attachmentsCount ?? transaction.attachments?.length ?? 0;
  if (attachmentsCount > 0) {
    conditions.push({
      conditionType: 'attachment',
      operator: 'equals',
      value: 'yes',
    });
  }

  // Amount within 5%: bounds in cents, rounded inward (ceil the minimum, floor
  // the maximum) so a cent amount matches exactly when it did with the
  // floating point bounds 0.95 * amount and 1.05 * amount.
  const cents = transaction.amount ? toCents(transaction.amount) : null;
  if (cents) {
    const amount = Math.abs(cents);
    conditions.push({
      conditionType: 'amount',
      operator: 'between',
      value: centsToDecimal(Math.ceil((amount * 95) / 100)),
      value2: centsToDecimal(Math.floor((amount * 105) / 100)),
    });
  }

  // Condition sur le label si disponible
  if (transaction.label) {
    conditions.push({
      conditionType: 'label',
      operator: 'contains',
      value: transaction.label,
    });
  }

  // Condition sur la référence si disponible
  if (transaction.reference && String(transaction.reference).trim()) {
    conditions.push({
      conditionType: 'reference',
      operator: 'contains',
      value: String(transaction.reference).trim(),
    });
  }

  return conditions;
}

/**
 * Bank prefixes that say how a line was paid, not who was paid: "CB",
 * "PRLV SEPA", "VIR INST"... (French bank statement wording).
 */
const PAYMENT_PREFIX =
  /^(?:(?:paiement|achat|retrait|facture)\s+(?:par\s+)?(?:cb|carte)|carte|cb|prlv(?:\s+sepa)?|pr[ée]l[èe]vement(?:\s+sepa)?|vir(?:ement)?(?:\s+(?:sepa|inst(?:antan[ée])?|re[çc]u|[ée]mis|permanent))*|ch[èe]que|chq|remise)\b[\s:./-]*/i;

const SMALL_WORDS = new Set(['à', 'a', 'au', 'aux', 'de', 'des', 'du', 'd', 'en', 'et', 'la', 'le', 'les', 'l', 'pour', 'sur', 'par'])

/**
 * Text in capitals made readable; mixed case is kept as typed. Short words
 * stay in capitals (acronyms: SNCF, EDF), small French words go lower case.
 * "title": "PAPETERIE MARTIN" -> "Papeterie Martin" (a name);
 * "sentence": "BILLET DE TRAIN" -> "Billet de train" (a label).
 */
function readableCase(text: string, mode: 'title' | 'sentence'): string {
  if (text !== text.toUpperCase() || !/[A-Z]/.test(text)) return text;
  return text
    .split(' ')
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && SMALL_WORDS.has(lower)) return lower;
      if (word.length <= 4 && /^[A-Z]+$/.test(word) && !SMALL_WORDS.has(lower)) return word;
      if (index === 0 || mode === 'title') return lower.charAt(0).toUpperCase() + lower.slice(1);
      return lower;
    })
    .join(' ');
}

/**
 * Default name of a rule created from a transaction, editable in the rule
 * dialog: the counterparty when the bank gives one, else the label without
 * its payment prefix, card number, dates and long references ("CB Billet
 * de train 12/03" -> "Billet de train"). The raw bank label is never used
 * as is.
 */
export function suggestRuleName(transaction: { counterpartyName?: string | null; label?: string | null }): string {
  const counterparty = transaction.counterpartyName?.replace(/\s+/g, ' ').trim();
  if (counterparty) return readableCase(counterparty, 'title').slice(0, 80);

  let label = (transaction.label ?? '').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) label = label.replace(PAYMENT_PREFIX, '').trim();
  // Transfer markers before the name: "/DE ATELIER LUMEN", "DE: ATELIER LUMEN"
  label = label.replace(/^\/?(?:de|from|frm)\s*[:/]?\s+/i, '');
  label = label
    // Card numbers (X1234), dates (12/03, 12/03/26) and long numbers or references
    .replace(/\bx\d{4}\b/gi, ' ')
    .replace(/\b\d{2}[/.]\d{2}(?:[/.]\d{2,4})?\b/g, ' ')
    .replace(/\b\d{6,}\b/g, ' ')
    .replace(/\b(?=[A-Z0-9]*\d)[A-Z0-9]{8,}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:./-]+|[\s:./-]+$/g, '');
  return label ? readableCase(label, 'sentence').slice(0, 80) : 'Nouvelle règle';
}
