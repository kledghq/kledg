/**
 * Plain-language labels of the simple mode (docs/mode-simple.md): the words
 * of someone who does not keep books. Pure, no imports: the simple pages
 * (server and client) build their sentences here, so the wording stays in
 * one place and the jargon test (SIMPLE_MODE_JARGON) can check it.
 *
 * Amounts arrive already formatted (formatAmount of components/shared), so
 * this module never formats money itself.
 */

const MONTHS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];

/** A whole word or phrase, accents included (\b does not see letters such as é). */
const word = (pattern: string) =>
  new RegExp(`(?<![\\p{L}\\d])(?:${pattern})(?![\\p{L}\\d])`, "iu");

/**
 * Words the simple mode never shows: accounting terms a beginner does not
 * know, and account numbers named as such. Checked by the tests of this
 * module and of the simple home.
 */
export const SIMPLE_MODE_JARGON: readonly RegExp[] = [
  word("écritures?"),
  word("journal"),
  word("lettrage"),
  word("rapprochement"),
  word("débit"),
  word("crédit(?! de TVA)"),
  word("balance"),
  word("grand livre"),
  word("plan (?:de comptes|comptable)"),
  word("PCG"),
  word("exercice"),
  word("créances?"),
  word("charges"),
  word("produits"),
  // "compte 512", "compte n° 411000" (not "vos comptes" followed by an amount)
  word("compte (?:n°\\s?)?\\d{3,}"),
];

/** The jargon found in a text (empty when the text is plain). */
export function jargonIn(text: string): string[] {
  return SIMPLE_MODE_JARGON.flatMap((pattern) => {
    const match = text.match(pattern);
    return match ? [match[0]] : [];
  });
}

/** "3 octobre": a calendar day (yyyy-mm-dd) in words, without the year. */
export function dayInWords(day: string): string {
  const [, month, date] = day.split("-").map(Number);
  return `${date === 1 ? "1er" : date} ${MONTHS[month - 1]}`;
}

/** "4 octobre 2026". */
export function dateInWords(day: string): string {
  return `${dayInWords(day)} ${day.slice(0, 4)}`;
}

/** "Bonjour Claire" from the user's name (first word), "Bonjour" without one. */
export function greeting(name: string | null | undefined): string {
  const first = name?.trim().split(/\s+/)[0];
  return first ? `Bonjour ${first}` : "Bonjour";
}

export const SIMPLE_LABELS = {
  home: "Accueil",
  bankBalance: "Argent sur vos comptes",
  receivables: "Vos clients vous doivent",
  todo: "À faire",
  accountantCard: "Votre comptable",
} as const;

/** "Voici où en est Atelier Lumen au 4 octobre 2026." */
export function situationSentence(companyName: string, today: string): string {
  return `Voici où en est ${companyName} au ${dateInWords(today)}.`;
}

/** "+3 210,00 € ce mois-ci" / "-120,00 € ce mois-ci" / "Aucun mouvement ce mois-ci". */
export function monthChangeLabel(
  cents: number,
  formattedSigned: string,
): string {
  return cents === 0
    ? "Aucun mouvement ce mois-ci"
    : `${formattedSigned} ce mois-ci`;
}

/** Under the bank figure when no bank account is connected yet. */
export const NO_BANK_ACCOUNT_HINT =
  "Aucun compte bancaire relié pour le moment";

/** "dont 2 400,00 € en retard", or "Rien en retard". */
export function overdueLabel(cents: number, formatted: string): string {
  return cents > 0 ? `dont ${formatted} en retard` : "Rien en retard";
}

/** "TVA à payer le 24 octobre", "TVA à payer" without a known deadline, "TVA en votre faveur" for a credit. */
export function vatTitle(
  estimateCents: number | null,
  deadlineDay: string | null,
): string {
  if (estimateCents !== null && estimateCents < 0) return "TVA en votre faveur";
  return deadlineDay
    ? `TVA à payer le ${dayInWords(deadlineDay)}`
    : "TVA à payer";
}

/** Under the VAT figure: it reads the books, not the return. */
export const VAT_ESTIMATE_HINT = "Estimation, à confirmer";

/**
 * Under the VAT figure when it is the amount of the prepared return:
 * "D'après votre déclaration de septembre 2026", "... du 3e trimestre
 * 2026", "... de l'année 2025".
 */
export function vatReturnHint(periodLabel: string): string {
  const of = /^\d/.test(periodLabel)
    ? "du "
    : periodLabel.startsWith("année")
      ? "de l'"
      : "de ";
  return `D'après votre déclaration ${of}${periodLabel}`;
}

export const NO_VAT_HINT = "Aucune TVA enregistrée pour le moment";

/** "Bénéfice depuis janvier" (or the month the year started), "Perte depuis janvier" when negative. */
export function profitTitle(cents: number, yearStartDay: string): string {
  const month = MONTHS[Number(yearStartDay.slice(5, 7)) - 1];
  return `${cents < 0 ? "Perte" : "Bénéfice"} depuis ${month}`;
}

export const PROFIT_HINT = "Avant impôt sur les sociétés";

/** Next to the profit: the IS the worksheet estimates from the entries so far (lib/corporate-tax). */
export const CORPORATE_TAX_TITLE = "Impôt sur les sociétés estimé";

/** "Estimation sur le bénéfice depuis janvier, à confirmer à la clôture". */
export function corporateTaxHint(yearStartDay: string): string {
  const month = MONTHS[Number(yearStartDay.slice(5, 7)) - 1];
  return `Estimation sur le bénéfice depuis ${month}, à confirmer à la clôture`;
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count > 1 ? pluralForm : singular}`;
}

/** "5 dépenses à vérifier". */
export function expensesToCheckLabel(count: number): string {
  return `${plural(count, "dépense", "dépenses")} à vérifier`;
}

export const EXPENSES_TO_CHECK_HINT =
  "Kledg propose une catégorie, une seule question à trancher";

/** "3 recettes à identifier". */
export function incomeToCheckLabel(count: number): string {
  return `${plural(count, "recette", "recettes")} à identifier`;
}

export const INCOME_TO_CHECK_HINT =
  "Kledg retrouve la facture payée ou propose une catégorie";

/** "3 justificatifs manquants". */
export function missingReceiptsLabel(count: number): string {
  return plural(count, "justificatif manquant", "justificatifs manquants");
}

export const MISSING_RECEIPTS_HINT =
  "Prenez la facture en photo ou glissez le PDF";

/** "Relancer Studio Nord pour 2 400,00 €". */
export function chaseLabel(customer: string, formatted: string): string {
  return `Relancer ${customer} pour ${formatted}`;
}

/** "À payer depuis le 2 septembre, 32 jours de retard". */
export function lateLabel(
  dueDay: string | null,
  daysLate: number | null,
): string {
  const since = dueDay
    ? `À payer depuis le ${dayInWords(dueDay)}`
    : "En retard";
  return daysLate && daysLate > 0
    ? `${since}, ${plural(daysLate, "jour", "jours")} de retard`
    : since;
}

export const NOTHING_TO_DO =
  "Rien à faire pour le moment. Revenez quand de nouvelles dépenses arrivent.";

export const ACCOUNTANT_PENDING =
  "Rien n'est définitif dans vos comptes tant qu'il n'a pas validé.";

/** "12 dépenses classées ce mois-ci : 9 validées, 3 en attente de sa validation." */
export function validationProgress(
  classified: number,
  validated: number,
  toValidate: number,
): string {
  const expenses =
    classified === 1 ? "1 dépense classée" : `${classified} dépenses classées`;
  if (classified === 0)
    return "Aucune dépense classée ce mois-ci pour l'instant.";
  const done = validated === 1 ? "1 validée" : `${validated} validées`;
  const waiting =
    toValidate === 1
      ? "1 en attente de sa validation"
      : `${toValidate} en attente de sa validation`;
  return `${expenses} ce mois-ci\u00a0: ${done}, ${waiting}.`;
}
export const NO_ACCOUNTANT =
  "Vous avez un expert-comptable\u00a0? Invitez-le\u00a0: il validera vos dépenses classées avant qu'elles soient définitives.";
