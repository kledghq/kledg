/**
 * Opening balances (bilan d'ouverture) of a company that existed before
 * Kledg: one entry in the à-nouveaux journal (AN) on the first day of its
 * first fiscal year in Kledg, carrying the balance of every balance sheet
 * account of the previous closing.
 *
 * Rules (pure, shared by the form and the service):
 * - the opening balance sheet equals the closing balance sheet of the
 *   previous exercice, before the allocation of its result (Code de
 *   commerce art. L123-19, al. 3; PCG art. 112-2, intangibilité du bilan
 *   d'ouverture): the previous result stays in 120 (bénéfice) or 129
 *   (perte) until the shareholders allocate it;
 * - only balance sheet accounts are brought forward, classes 1 to 5:
 *   classes 6 and 7 are closed into the result at the end of each
 *   exercice (same rule as the closing, fiscal-year-closure/constants.ts);
 * - the entry balances to the cent (debits = credits).
 */

export interface OpeningLineInput {
  accountCode: string
  debitCents: number
  creditCents: number
}

export interface OpeningCheck {
  errors: string[]
  debitCents: number
  creditCents: number
}

/** Checks the lines of an opening entry; amounts are integer cents. */
export function checkOpeningLines(lines: OpeningLineInput[]): OpeningCheck {
  const errors: string[] = []
  let debitCents = 0
  let creditCents = 0
  const seen = new Set<string>()
  const filled = lines.filter((l) => l.debitCents !== 0 || l.creditCents !== 0)
  filled.forEach((line, index) => {
    const n = index + 1
    const code = line.accountCode.trim()
    if (!/^[1-5]\d*$/.test(code)) {
      errors.push(`Ligne ${n} : le compte ${code || '(vide)'} n'est pas un compte de bilan (classes 1 à 5).`)
    }
    if (seen.has(code)) errors.push(`Ligne ${n} : le compte ${code} apparaît deux fois, regroupez ses montants.`)
    seen.add(code)
    if (!Number.isSafeInteger(line.debitCents) || !Number.isSafeInteger(line.creditCents) || line.debitCents < 0 || line.creditCents < 0) {
      errors.push(`Ligne ${n} : montant invalide.`)
    } else if (line.debitCents > 0 && line.creditCents > 0) {
      errors.push(`Ligne ${n} : un solde est soit au débit, soit au crédit.`)
    }
    debitCents += Math.max(0, line.debitCents)
    creditCents += Math.max(0, line.creditCents)
  })
  if (filled.length < 2) errors.push('Saisissez au moins deux soldes (par exemple la banque et le capital).')
  if (debitCents !== creditCents) {
    errors.push('Le total des débits doit égaler le total des crédits : le bilan d’ouverture doit être équilibré.')
  }
  return { errors, debitCents, creditCents }
}

/** A guided line of the form: where a beginner finds the amount on the last balance sheet. */
export interface OpeningPreset {
  accountCode: string
  label: string
  side: 'debit' | 'credit'
  hint: string
}

/**
 * The usual lines of a small company's balance sheet, in the order of the
 * bilan, on accounts every new chart of accounts has (lib/accounting/pcg-data.ts).
 */
export const OPENING_PRESETS: readonly OpeningPreset[] = [
  { accountCode: '1013', label: 'Capital souscrit, appelé, versé', side: 'credit', hint: 'Capital social, au passif.' },
  { accountCode: '1061', label: 'Réserve légale', side: 'credit', hint: 'Réserves, au passif.' },
  { accountCode: '110', label: 'Report à nouveau (solde créditeur)', side: 'credit', hint: 'Report à nouveau positif.' },
  { accountCode: '119', label: 'Report à nouveau (solde débiteur)', side: 'debit', hint: 'Report à nouveau négatif (pertes antérieures).' },
  { accountCode: '120', label: "Résultat de l'exercice (bénéfice)", side: 'credit', hint: "Bénéfice de l'exercice précédent, pas encore affecté." },
  { accountCode: '129', label: "Résultat de l'exercice (perte)", side: 'debit', hint: "Perte de l'exercice précédent, pas encore affectée." },
  { accountCode: '164', label: 'Emprunts auprès des établissements de crédit', side: 'credit', hint: 'Capital restant dû des emprunts.' },
  { accountCode: '455', label: 'Associés, comptes courants', side: 'credit', hint: 'Sommes avancées par les associés.' },
  { accountCode: '401', label: 'Fournisseurs', side: 'credit', hint: 'Factures fournisseurs non payées à la clôture.' },
  { accountCode: '411', label: 'Clients', side: 'debit', hint: 'Factures clients non encaissées à la clôture.' },
  { accountCode: '4455', label: 'Taxes sur le chiffre d’affaires à décaisser', side: 'credit', hint: 'TVA due à la clôture.' },
  { accountCode: '4456', label: 'Taxes sur le chiffre d’affaires déductibles', side: 'debit', hint: 'TVA à récupérer à la clôture.' },
  { accountCode: '512', label: 'Banques', side: 'debit', hint: 'Solde bancaire au jour de la clôture (relevé).' },
]
