/**
 * "Démarrer" checklist of a company: the steps that make a fresh company
 * useful, each detected from the company's own data (never ticked by hand),
 * so the list stays true when the work is done from another page, by
 * another member or by an AI assistant. Pure: the facts are loaded by
 * load-onboarding.service.ts.
 */

export type OnboardingStepId = 'chart' | 'bank' | 'history' | 'rule' | 'accountant' | 'assistant'

export interface RuleSuggestion {
  /** The label as shown to the user ("OVH SAS"). */
  label: string
  /** How many bank operations carry it. */
  count: number
  /** A recent operation with this label, to prefill the rule from it. */
  transactionId: string
}

/** What the checklist is computed from (counts and dates, no rows). */
export interface OnboardingFacts {
  accounts: number
  journals: number
  /** API bank connections whose integration is active (Qonto, Revolut, Ponto). */
  activeBankConnections: number
  bankProviders: string[]
  bankTransactions: number
  /** Company creation date and first day of its earliest fiscal year in Kledg (yyyy-mm-dd). */
  foundationDate: string | null
  firstFiscalYearStart: string | null
  /** Entries of the AN journal (opening balances), whatever their status. */
  openingEntries: number
  /** Entries dated in a fiscal year before the latest one (an imported FEC of a previous year). */
  earlierYearEntries: number
  rules: number
  ruleSuggestions: RuleSuggestion[]
  /** Members holding the Comptable role (alone or with other roles). */
  accountants: number
  /** AI assistants or API keys that can reach this company. */
  aiConnections: number
}

export interface OnboardingAction {
  label: string
  /** Path inside the app ("/atelier-lumen/banking/connect"). */
  href: string
}

export interface OnboardingStep {
  id: OnboardingStepId
  title: string
  /** One sentence: why this step matters. */
  why: string
  done: boolean
  /** What Kledg detected, in French ("214 opérations reçues"). */
  detail: string | null
  action: OnboardingAction | null
}

export interface OnboardingChecklist {
  steps: OnboardingStep[]
  done: number
  total: number
  complete: boolean
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`

/**
 * Whether the company existed before its first fiscal year in Kledg, so its
 * opening balances must be taken over (bilan d'ouverture). A company whose
 * first exercice in Kledg starts on its creation date has nothing to take over.
 */
export function historyApplies(facts: Pick<OnboardingFacts, 'foundationDate' | 'firstFiscalYearStart'>): boolean {
  if (!facts.firstFiscalYearStart) return false
  return !facts.foundationDate || facts.foundationDate < facts.firstFiscalYearStart
}

export function buildChecklist(
  facts: OnboardingFacts,
  context: { companySlug: string; canManageMembers: boolean },
): OnboardingChecklist {
  const base = `/${context.companySlug}`
  const steps: OnboardingStep[] = []

  steps.push({
    id: 'chart',
    title: 'Plan comptable prêt',
    why: 'Les comptes du plan comptable général et les journaux habituels sont créés : vos écritures s’y rangent.',
    done: facts.accounts > 0 && facts.journals > 0,
    detail: facts.accounts > 0 ? `${plural(facts.accounts, 'compte', 'comptes')}, ${plural(facts.journals, 'journal', 'journaux')}` : null,
    action: { label: facts.accounts > 0 ? 'Voir le plan comptable' : 'Créer le plan comptable', href: `${base}/accounts/plan` },
  })

  const bankDone = facts.activeBankConnections > 0 || facts.bankTransactions > 0
  steps.push({
    id: 'bank',
    title: 'Connecter une banque ou importer un relevé',
    why: 'Les opérations bancaires sont la source de la plupart des écritures : Kledg les reçoit, puis vous aide à les comptabiliser.',
    done: bankDone,
    detail: bankDone
      ? [
          facts.bankProviders.length > 0 ? `Connectée à ${facts.bankProviders.join(', ')}` : null,
          facts.bankTransactions > 0 ? plural(facts.bankTransactions, 'opération reçue', 'opérations reçues') : null,
        ]
          .filter(Boolean)
          .join(', ')
      : null,
    action: { label: 'Connecter une banque', href: `${base}/banking/connect` },
  })

  if (historyApplies(facts)) {
    const done = facts.openingEntries > 0 || facts.earlierYearEntries > 0
    steps.push({
      id: 'history',
      title: 'Reprendre l’historique',
      why: 'Votre société existait avant Kledg : reprenez les soldes de l’exercice précédent pour que le bilan parte des bons chiffres.',
      done,
      detail: done
        ? facts.openingEntries > 0
          ? 'Écriture d’à-nouveaux saisie'
          : 'Écritures d’un exercice précédent importées'
        : null,
      action: { label: 'Saisir le bilan d’ouverture', href: `${base}/fiscal-years/opening-balances` },
    })
  }

  const top = facts.ruleSuggestions[0]
  steps.push({
    id: 'rule',
    title: 'Créer une première règle d’affectation',
    why: 'Une règle comptabilise toute seule les opérations qui reviennent : loyer, abonnements, cotisations.',
    done: facts.rules > 0,
    detail:
      facts.rules > 0
        ? plural(facts.rules, 'règle', 'règles')
        : facts.ruleSuggestions.length > 0
          ? `Libellés fréquents : ${facts.ruleSuggestions.map((s) => `${s.label} (${s.count} fois)`).join(', ')}`
          : null,
    action: {
      label: top && facts.rules === 0 ? `Créer la règle « ${top.label} »` : 'Créer une règle',
      href: top && facts.rules === 0 ? `${base}/rules?fromTransaction=${encodeURIComponent(top.transactionId)}` : `${base}/rules`,
    },
  })

  steps.push({
    id: 'accountant',
    title: 'Inviter votre expert-comptable',
    why: 'Avec le rôle Comptable, il travaille sur les écritures et les états de la société, sans accès à vos réglages bancaires.',
    // Only the Comptable role counts: a second member with another role
    // (a partner as viewer, a co-founder as administrator) is not the
    // accountant this step asks for.
    done: facts.accountants > 0,
    detail:
      facts.accountants > 0
        ? plural(facts.accountants, 'membre avec le rôle Comptable', 'membres avec le rôle Comptable')
        : context.canManageMembers
          ? null
          : "L'administrateur de l'instance donne les accès.",
    action: context.canManageMembers ? { label: 'Inviter', href: `${base}/members` } : null,
  })

  steps.push({
    id: 'assistant',
    title: 'Connecter un assistant IA',
    why: 'Claude ou ChatGPT peuvent lire vos comptes et préparer des écritures en brouillon, que vous validez.',
    done: facts.aiConnections > 0,
    detail: facts.aiConnections > 0 ? plural(facts.aiConnections, 'connexion active', 'connexions actives') : null,
    action: { label: 'Connecter un assistant', href: '/settings/assistants' },
  })

  const done = steps.filter((s) => s.done).length
  return { steps, done, total: steps.length, complete: done === steps.length }
}

/** Words that change from one operation to the next: dates, references, amounts, card numbers, payment types. */
const NOISE = /(?<![\p{L}\d])(?:\d[\d/.:-]*|x{2,}\d*|cb|carte|prlv|prelevement|prélèvement|vir|virement|sepa|ref|réf)(?![\p{L}\d])/giu
const STOP_WORDS = /(?<![\p{L}\d])(?:du|de|des|le|la|les)(?![\p{L}\d])/giu

/** A label without what changes from one operation to the next: "PRLV SEPA OVH SAS 12/09" -> "OVH SAS". */
export function cleanLabel(label: string): string {
  return label
    .replace(NOISE, ' ')
    .replace(/[^\p{L}\s&'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The grouping key of a label: "PRLV SEPA OVH SAS 12/09" and "OVH SAS" are the same counterpart. */
export function normalizeLabel(label: string): string {
  return cleanLabel(label)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(STOP_WORDS, ' ')
    .replace(/[^\p{L}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The counterparts that come back most often among recent bank operations
 * (at least twice), as candidates for a first rule.
 */
export function suggestRules(
  transactions: Array<{ id: string; label: string | null; counterpartyName: string | null }>,
  limit = 3,
): RuleSuggestion[] {
  const groups = new Map<string, { label: string; count: number; transactionId: string }>()
  for (const tx of transactions) {
    const shown = cleanLabel(tx.counterpartyName || tx.label || '')
    const key = normalizeLabel(shown)
    if (key.length < 2) continue
    const group = groups.get(key)
    if (group) group.count++
    else groups.set(key, { label: shown, count: 1, transactionId: tx.id })
  }
  return [...groups.values()]
    .filter((g) => g.count >= 2)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'fr'))
    .slice(0, limit)
}
