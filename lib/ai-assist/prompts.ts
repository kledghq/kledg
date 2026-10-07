/**
 * Requests of the "Proposer avec l'IA" button (components/features/ai-assist):
 * one short French template per kind of object, naming the company and the
 * object by their ids so the assistant reads them with the MCP tools of
 * Kledg (docs/mcp.md) instead of guessing.
 *
 * The request is built from data only. Text that comes from outside Kledg's
 * control (a bank label, a tiers name, a check written by Kledg but naming
 * user data) is never part of the instructions: it is quoted as data between
 * « », stripped of guillemets, line breaks and control characters, and cut
 * short, so a label cannot close the quote or add an instruction. No secret
 * (token, key, IBAN) is ever part of a request.
 *
 * Pure module: used on the client and tested on plain values.
 */

import { formatCentsFr } from '@/lib/utils/money'
import { addIsoDays, formatIsoDateFr, isIsoDate } from '@/lib/utils/date'
import { receiptVendorById } from '@/lib/receipts/vendors'

/** The company the request is about: its name (quoted as data) and its id. */
export interface PromptCompany {
  id: string
  name: string
}

export type AiPromptTarget =
  | { kind: 'bank_transaction'; id: string; date: string; label: string; amountCents: number }
  | { kind: 'draft_entry'; id: string; date: string; label: string; journalCode?: string | null }
  | { kind: 'invoice'; id: string; direction: 'SALE' | 'PURCHASE'; number: string | null; date: string; tiersName: string; totalInclTaxCents: number; posted: boolean }
  | {
      kind: 'missing_receipt'
      id: string
      date: string
      label: string
      amountCents: number
      /** Supplier recognised from the label (lib/receipts/detect-supplier.ts): its name, and the vendor id for the page of its invoices. */
      supplier?: { name: string; vendorId: string | null } | null
      /** Banking provider of the account: QONTO takes the receipt through upload_receipt. */
      bankProvider?: string | null
    }
  | { kind: 'simple_expense'; id: string; side: 'debit' | 'credit'; date: string; label: string; amountCents: number }
  | { kind: 'vat_return'; period: string; periodStart: string; periodEnd: string }
  | { kind: 'closing_check'; fiscalYearId: string; year: number; checks: string[] }

export type AiPromptKind = AiPromptTarget['kind']

/** Longest quoted value: enough to recognise a label, too short to carry a payload. */
export const MAX_QUOTED_LENGTH = 120

/**
 * A value quoted as data: guillemets, quotes that could pass for them, line
 * breaks and control characters become spaces, spaces collapse, and the
 * value is cut to MAX_QUOTED_LENGTH characters. Always between « ».
 */
export function quote(value: string | null | undefined): string {
  const clean = (value ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u00ab\u00bb\u2039\u203a"\u201c\u201d\u201e`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const cut = clean.length > MAX_QUOTED_LENGTH ? `${clean.slice(0, MAX_QUOTED_LENGTH - 1).trimEnd()}\u2026` : clean
  return `«\u00a0${cut || 'sans libellé'}\u00a0»`
}

/** An id as Kledg writes them (cuid, uuid, slug): anything else is dropped from the request. */
export function id(value: string): string {
  return /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : 'inconnu'
}

/** A VAT period key of get_vat_return (yyyy-mm, yyyy-Tn, yyyy). */
const period = (key: string) => (/^\d{4}(-(0[1-9]|1[0-2]|T[1-4]))?$/.test(key) ? key : 'inconnue')
const day = (iso: string) => formatIsoDateFr(String(iso).slice(0, 10)) || 'date inconnue'
/** The days an invoice is looked for around a payment: 10 days before to 5 days after. */
export const INVOICE_WINDOW_DAYS = { before: 10, after: 5 } as const
const invoiceWindow = (iso: string) =>
  isIsoDate(iso) ? `du ${day(addIsoDays(iso, -INVOICE_WINDOW_DAYS.before))} au ${day(addIsoDays(iso, INVOICE_WINDOW_DAYS.after))}` : 'autour de cette date'
/**
 * The page of invoices of a known vendor, read from lib/receipts/vendors.ts
 * by its id: a URL never comes from the target itself.
 */
const invoicesPage = (vendorId: string | null | undefined) => receiptVendorById(vendorId)?.invoicesUrl ?? null

function missingReceiptRequest(t: Extract<AiPromptTarget, { kind: 'missing_receipt' }>): string {
  const url = invoicesPage(t.supplier?.vendorId)
  const found =
    t.bankProvider === 'QONTO'
      ? 'dis-moi ce que tu as trouvé puis joins-la avec upload_receipt'
      : 'donne-moi le fichier et ses détails (date, numéro, montant)'
  return [
    `aide-moi à retrouver le justificatif de la transaction ${id(t.id)} du ${day(t.date)}, ${quote(t.label)}, ${amount(t.amountCents)}. Lis-la avec get_transaction_details.`,
    t.supplier?.name ? `Fournisseur reconnu\u00a0: ${quote(t.supplier.name)}.` : 'Identifie le fournisseur.',
    `Cherche sa facture datée ${invoiceWindow(t.date)}, de ${amount(t.amountCents)} TTC, dans mes outils de messagerie et de fichiers si tu y as accès (Gmail, Outlook, Google Drive, OneDrive...).`,
    `Si tu la trouves, ${found}.`,
    url ? `Sinon, indique-moi la page de ses factures\u00a0: ${url}` : 'Sinon, dis-moi où la demander.',
  ].join(' ')
}

const amount = (cents: number) => (Number.isSafeInteger(cents) ? formatCentsFr(Math.abs(cents)) : 'montant inconnu')

/** Every template, by kind of object. The opening names the company so the assistant picks it with list_companies. */
export const PROMPT_TEMPLATES: { [K in AiPromptKind]: (target: Extract<AiPromptTarget, { kind: K }>) => string } = {
  bank_transaction: (t) =>
    `propose l'écriture pour la transaction ${id(t.id)} du ${day(t.date)}, ${quote(t.label)}, ${t.amountCents < 0 ? 'débit' : 'crédit'} de ${amount(t.amountCents)}. Lis-la avec get_transaction_details, puis prépare l'écriture en brouillon (reconcile_transaction ou create_draft_entry) sans la valider.`,
  draft_entry: (t) =>
    `vérifie le brouillon d'écriture ${id(t.id)} du ${day(t.date)}${t.journalCode ? `, journal ${id(t.journalCode)}` : ''}, ${quote(t.label)}. Lis-le avec get_entry, puis propose les corrections (comptes, TVA, pièce) avec update_draft_entry, sans le valider.`,
  invoice: (t) =>
    `${t.posted ? 'vérifie' : 'propose la comptabilisation de'} la facture ${t.direction === 'SALE' ? 'de vente' : "d'achat"} ${t.number ? `n°\u00a0${quote(t.number)} ` : ''}(id ${id(t.id)}) du ${day(t.date)}, ${t.direction === 'SALE' ? 'client' : 'fournisseur'} ${quote(t.tiersName)}, ${amount(t.totalInclTaxCents)} TTC. Lis-la avec get_invoice, puis propose ${t.posted ? 'le rapprochement avec son paiement' : 'ses comptes et sa TVA'} sans rien valider.`,
  missing_receipt: missingReceiptRequest,
  simple_expense: (t) =>
    `propose la catégorie ${t.side === 'credit' ? 'de la recette' : 'de la dépense'} ${id(t.id)} du ${day(t.date)}, ${quote(t.label)}, ${amount(t.amountCents)}. Lis-la avec list_expenses_to_review et explique ton choix simplement, sans la confirmer.`,
  vat_return: (t) =>
    `vérifie la déclaration de TVA de la période ${period(t.period)}, du ${day(t.periodStart)} au ${day(t.periodEnd)}. Lis-la avec get_vat_return (period ${period(t.period)}), explique les montants et les contrôles à corriger avant de la déposer.`,
  closing_check: (t) =>
    `aide-moi à lever ce qui bloque la clôture de l'exercice${Number.isInteger(t.year) && t.year > 0 ? ` ${t.year}` : ''} (id ${id(t.fiscalYearId)})${t.checks.length ? `\u00a0: ${t.checks.slice(0, 5).map(quote).join(', ')}` : ''}. Lis l'exercice avec list_fiscal_years et close_fiscal_year en aperçu (dryRun), puis propose les corrections sans clôturer.`,
}

/** "Avec Kledg (société « Atelier Lumen », id c1), propose l'écriture pour ..." */
export function buildAiPrompt(company: PromptCompany, target: AiPromptTarget): string {
  const body = (PROMPT_TEMPLATES[target.kind] as (t: AiPromptTarget) => string)(target)
  return `Avec Kledg (société ${quote(company.name)}, id ${id(company.id)}), ${body}`
}
