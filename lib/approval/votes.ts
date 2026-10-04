/**
 * Quorum and majority of the approval decisions, and their French wording
 * in the minutes. Pure. Votes are counted in votes, one per part or share
 * (statutory double voting rights are not modelled: enter the votes as cast).
 *
 * - SARL: adopted by associés holding more than half of the parts; on a
 *   second consultation, by the majority of the votes cast, unless the
 *   statuts say otherwise (C. com. L223-29). Remote participants are not
 *   counted for the approval of the accounts (L223-27).
 * - SA: quorum of one fifth of the voting shares on first call, none on
 *   second call; majority of the votes cast, abstentions, blank and void
 *   votes not counted (L225-98).
 * - SAS and SCI: the rule of the statuts (L227-9; C. civ. 1853), unanimity
 *   of the associés when the statuts of a société civile are silent
 *   (C. civ. 1852).
 * - EURL and SASU: the associé unique decides alone (L223-31, L227-9).
 */

import type { ApprovalRegime } from './legal-regime'
import type { ApprovalDetails, VoteInput } from './schemas'

export interface VoteContext {
  /** Votes of every holder of the company. */
  totalVotes: number
  /** Votes of the holders present, represented or taking part remotely. */
  presentVotes: number
  secondCall: boolean
  statutoryRule: ApprovalDetails['statutoryRule']
}

export interface VoteOutcome {
  /** null: the counts do not let Kledg decide (no holder or vote entered). */
  adopted: boolean | null
  quorumMet: boolean | null
  /** Sentence closing the resolution in the minutes. */
  wording: string
}

/** A count with French thousands separators (no-break spaces). */
export const count = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
const voix = (n: number) => `${count(n)} voix`
const abstentions = (n: number) => (n > 1 ? `${count(n)} abstentions` : `${count(n)} abstention`)

/** Quorum of a regime, null when the law or the statuts set none. */
export function quorumMet(regime: ApprovalRegime, context: VoteContext): boolean | null {
  if (context.totalVotes <= 0) return null
  if (regime.majority === 'sa') return context.secondCall ? true : context.presentVotes * 5 >= context.totalVotes
  if (regime.majority === 'statutes' && context.statutoryRule?.quorumPercent != null) {
    return context.presentVotes * 100 >= context.statutoryRule.quorumPercent * context.totalVotes
  }
  return true
}

/** The rule in one sentence, for the opening of the minutes. */
export function majorityRuleText(regime: ApprovalRegime, context: Pick<VoteContext, 'secondCall' | 'statutoryRule'>): string {
  switch (regime.majority) {
    case 'sole':
      return "L'associé unique exerce les pouvoirs dévolus à la collectivité des associés."
    case 'sarl':
      return context.secondCall
        ? "Sur deuxième consultation, les décisions sont prises à la majorité des votes émis, quel que soit le nombre de votants, sauf stipulation contraire des statuts (C. com. art. L. 223-29)."
        : 'Les décisions sont adoptées par un ou plusieurs associés représentant plus de la moitié des parts sociales (C. com. art. L. 223-29).'
    case 'sa':
      return context.secondCall
        ? "Sur deuxième convocation, l'assemblée délibère valablement quel que soit le nombre d'actions représentées et statue à la majorité des voix exprimées (C. com. art. L. 225-98)."
        : "L'assemblée délibère valablement si les actionnaires présents ou représentés possèdent au moins le cinquième des actions ayant le droit de vote, et statue à la majorité des voix exprimées (C. com. art. L. 225-98)."
    case 'statutes': {
      const rule = context.statutoryRule
      const where = rule?.article ? `à l'article ${rule.article} des statuts` : 'aux statuts'
      if (!rule) {
        return regime.form === 'SCI'
          ? `Les décisions sont prises dans les conditions prévues par les statuts, à l'unanimité des associés à défaut (C. civ. art. 1852).`
          : 'Les décisions sont prises dans les conditions de quorum et de majorité prévues par les statuts (C. com. art. L. 227-9).'
      }
      if (rule.kind === 'unanimity') return `Les décisions sont prises à l'unanimité des associés, conformément ${where}.`
      const base = rule.base === 'cast' ? 'des voix exprimées' : rule.base === 'present' ? 'des voix des associés présents ou représentés' : 'des voix de tous les associés'
      const threshold = rule.percent === 50 ? 'à la majorité' : `à plus de ${count(rule.percent)} %`
      const quorum = rule.quorumPercent != null ? `, avec un quorum de ${count(rule.quorumPercent)} % des voix` : ''
      return `Les décisions sont prises ${threshold} ${base}${quorum}, conformément ${where}.`
    }
  }
}

/** Whether a resolution is adopted, and the sentence that says so. */
export function voteOutcome(regime: ApprovalRegime, context: VoteContext, vote: VoteInput | undefined): VoteOutcome {
  if (regime.majority === 'sole') {
    return { adopted: true, quorumMet: true, wording: "Cette décision est prise par l'associé unique." }
  }
  const quorum = quorumMet(regime, context)
  if (quorum === false) {
    return {
      adopted: false,
      quorumMet: false,
      wording: "Le quorum requis n'étant pas atteint, cette résolution n'a pu être valablement mise aux voix.",
    }
  }
  if (!vote || context.totalVotes <= 0) return { adopted: null, quorumMet: quorum, wording: '' }

  const forVotes = vote.unanimous ? context.presentVotes : vote.for
  const against = vote.unanimous ? 0 : vote.against
  const abstain = vote.unanimous ? 0 : vote.abstain
  if (forVotes + against + abstain === 0) return { adopted: null, quorumMet: quorum, wording: '' }

  let adopted: boolean
  switch (regime.majority) {
    case 'sarl':
      adopted = context.secondCall ? forVotes > against : forVotes * 2 > context.totalVotes
      break
    case 'sa':
      adopted = forVotes > against
      break
    case 'statutes': {
      const rule = context.statutoryRule
      if (!rule) {
        // SAS: no legal default, the statuts must say; Kledg does not guess.
        if (regime.form !== 'SCI') return { adopted: null, quorumMet: quorum, wording: '' }
        // Société civile: unanimity of the associés when the statuts are silent (C. civ. 1852).
        adopted = forVotes === context.totalVotes
        break
      }
      if (rule.kind === 'unanimity') {
        adopted = forVotes === context.totalVotes
        break
      }
      const base = rule.base === 'cast' ? forVotes + against : rule.base === 'present' ? context.presentVotes : context.totalVotes
      adopted = base > 0 && forVotes * 100 > rule.percent * base
      break
    }
  }
  return { adopted, quorumMet: quorum, wording: resultWording(adopted, vote.unanimous, forVotes, against, abstain) }
}

function resultWording(adopted: boolean | null, unanimous: boolean, forVotes: number, against: number, abstain: number): string {
  if (adopted === null) return ''
  if (unanimous && adopted) return 'Cette résolution, mise aux voix, est adoptée à l’unanimité des voix des présents et représentés.'
  const detail = `${voix(forVotes)} pour, ${voix(against)} contre et ${abstentions(abstain)}`
  return adopted ? `Cette résolution, mise aux voix, est adoptée par ${detail}.` : `Cette résolution, mise aux voix, est rejetée par ${detail}.`
}
