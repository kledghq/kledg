/**
 * Plain-language wording of the "Combien puis-je me verser ?" card of the
 * simple home (docs/mode-simple.md, docs/remuneration-dividendes.md): the
 * words of someone who does not keep books, checked against the jargon list
 * of lib/simple/vocabulary.ts by the tests. Pure, no imports.
 */

const NB = ' '

export const SIMPLE_CARD_TITLE = `Combien puis-je me verser${NB}?`

const euros = (cents: number) => `${Math.round(cents / 100).toLocaleString('fr-FR').replace(/ |\s/g, NB)}${NB}€`

/** "Avec 80 000 € de bénéfice prévu avant votre rémunération, ..." */
export function simpleCardSentence(resultCents: number, netCents: number): string {
  return `Avec ${euros(resultCents)} de bénéfice prévu avant votre rémunération, vous pourriez garder environ ${euros(netCents)} après impôts et cotisations.`
}

/** How the optimum splits the money: pay, dividends. */
export function simpleSplitSentence(payCostCents: number, dividendsCents: number): string {
  if (payCostCents <= 0 && dividendsCents <= 0) return 'Il n’y a rien à vous verser cette année.'
  if (payCostCents <= 0) return `Le plus avantageux${NB}: tout en dividendes, soit ${euros(dividendsCents)} pour vous.`
  if (dividendsCents <= 0) return `Le plus avantageux${NB}: tout en salaire, pour un coût de ${euros(payCostCents)} pour la société.`
  return `Le plus avantageux${NB}: un salaire qui coûte ${euros(payCostCents)} à la société, puis ${euros(dividendsCents)} de dividendes pour vous.`
}

export const SIMPLE_CARD_HINT = 'Estimation indicative, pas un conseil. Parlez-en à votre comptable avant de décider.'
export const SIMPLE_CARD_ACTION = 'Voir le détail'
