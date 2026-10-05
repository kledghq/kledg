/**
 * Legal bases of exempt sales and the mention their invoices carry. CGI
 * ann. II art. 242 nonies A, I, 12°: "En cas d'exonération, la référence à
 * la disposition pertinente du code général des impôts ou à la disposition
 * correspondante de la directive 2006/112/CE"; BOI-TVA-DECLA-30-20-20-10
 * §500 admits any mention stating unequivocally the nature of the exempt
 * operation. Pure, usable on both sides.
 *
 * training: formation professionnelle continue of CGI art. 261, 4, 4° a,
 * given by a holder of the attestation of the administrative authority;
 * the exemption cannot be waived (BOI-TVA-CHAMP-30-10-20-50 §280).
 *
 * The mention goes on an invoice only when one of its lines is exempt, and
 * names the exempt lines when the invoice also has taxed ones: never on a
 * taxed line.
 */

export const VAT_EXEMPTIONS = {
  training: {
    label: 'Formation professionnelle continue exonérée (CGI, art. 261, 4, 4° a)',
    defaultMention: 'Exonération de TVA, article 261, 4, 4° a du CGI',
  },
} as const

export type VatExemption = keyof typeof VAT_EXEMPTIONS
export const VAT_EXEMPTION_CODES = Object.keys(VAT_EXEMPTIONS) as [VatExemption, ...VatExemption[]]
export const MAX_MENTION_LENGTH = 300

export function isVatExemption(value: string | null | undefined): value is VatExemption {
  return value !== null && value !== undefined && (VAT_EXEMPTION_CODES as readonly string[]).includes(value)
}

/** The mention of an exemption: the company's text for training when it set one, else the default. */
export function mentionOf(code: VatExemption, companyMention: string | null | undefined): string {
  return code === 'training' && companyMention && companyMention.trim() ? companyMention.trim() : VAT_EXEMPTIONS[code].defaultMention
}

export interface MentionLine {
  position: number
  vatExemption: string | null
}

/**
 * The mentions an invoice carries, one per exemption present; the lines
 * they apply to are named when the invoice also has taxed lines. Empty
 * without an exempt line.
 */
export function invoiceExemptionMentions(lines: readonly MentionLine[], companyMention: string | null | undefined): Array<{ code: VatExemption; text: string; positions: number[] }> {
  const exempt = lines.filter((l): l is MentionLine & { vatExemption: VatExemption } => isVatExemption(l.vatExemption))
  if (exempt.length === 0) return []
  const mixed = exempt.length < lines.length
  return VAT_EXEMPTION_CODES.flatMap((code) => {
    const positions = exempt.filter((l) => l.vatExemption === code).map((l) => l.position)
    if (positions.length === 0) return []
    const base = mentionOf(code, companyMention)
    const text = mixed ? `${base} (${positions.length > 1 ? 'lignes' : 'ligne'} ${positions.join(', ')})` : base
    return [{ code, text, positions }]
  })
}
