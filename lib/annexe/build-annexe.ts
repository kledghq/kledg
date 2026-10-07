/**
 * The annexe des comptes annuels of a fiscal year (pure module, amounts in
 * cents), from the books, the fixed asset report, the register of methods,
 * the participations and what the user answered (schemas.ts).
 *
 * Which notes depend on the size category (règlement ANC 2014-03, PCG
 * version of 1 January 2026, title VIII):
 * - micro-entreprise (C. com. L123-16-1, PCG art. 811-7): no annexe
 *   required; the information to give after the balance sheet (accounting
 *   regulation applied, commitments, pensions, related entities, advances
 *   to officers, own shares) is generated instead;
 * - petite entreprise under the régime réel simplifié (C. com. L123-25, PCG
 *   art. 811-8): the short list of that article;
 * - petite entreprise (C. com. L123-16, PCG art. 811-9): the list of that
 *   article;
 * - moyenne and grande entreprise: every article of chapter III (art. 831-1
 *   to 838-x), director remuneration (835-2) and the consolidating entity
 *   (831-4) included.
 * Information without significance is not given (PCG art. 811-6): a note
 * with nothing in the books (no revaluation, no own shares...) is left out.
 *
 * Nothing is invented: what only the user knows and a note needs is listed
 * in `missing`, and the document is not generated until it is answered.
 */

import { eur, type Block } from '@/lib/approval/documents/model'
import { SIZE_LABELS, type SizeCategory } from '@/lib/approval/size'
import type { FixedAssetReport } from './fixed-asset-report'
import type { Rubrique } from './fixed-asset-forms'
import { CHANGE_KIND_LABELS, CHANGE_SOURCES, METHOD_TOPIC_LABELS, TREATMENT_LABELS, type MethodTopic } from './methods/rules'
import type { AccountingChangeView, AccountingMethodView } from './methods/manage-accounting-methods.service'
import { COMMITMENT_LABELS, COMMITMENT_KINDS, type AnnexeDetails } from './schemas'

/** One account over the year: balance from the opening entry (debit positive), then the movements of the year. */
export interface AccountYear {
  code: string
  label: string
  openingCents: number
  debitCents: number
  creditCents: number
}

export interface ParticipationLine {
  name: string
  siren: string | null
  /** Share of the capital, in basis points. */
  ownershipBp: number
  capitalCents: number | null
  equityCents: number | null
  bookValueGrossCents: number | null
  bookValueNetCents: number | null
  loansCents: number | null
  revenueCents: number | null
  resultCents: number | null
  dividendsCents: number | null
}

export interface RegisterSummary {
  rubrique: Rubrique
  methods: string[]
  minYears: number | null
  maxYears: number | null
  assets: number
}

export type AnnexeList = 'micro' | 'simplified' | 'small' | 'full'

export interface AnnexeData {
  company: { name: string; siren: string; totalShares: number | null; nominalCents: number | null; shareCapitalCents: number | null; corporateTaxRegime: string | null }
  fiscalYear: { id: string; year: number; startDate: string; endDate: string; isClosed: boolean }
  size: { category: SizeCategory; confirmed: boolean }
  /** Belongs to a group that consolidates its accounts (approval details); null when not answered. */
  groupMember: boolean | null
  /** Headcount entered on the approval page. */
  approvalEmployees: number | null
  accounts: AccountYear[]
  /** Result of the year (classes 7 minus 6, closing entry excluded). */
  resultCents: number
  fixedAssets: FixedAssetReport
  register: RegisterSummary[]
  methods: AccountingMethodView[]
  changes: AccountingChangeView[]
  /** Companies held and followed in Kledg, with the titres not attributed (261); null when not read. */
  participations: { rows: ParticipationLine[]; unattributedCents: number } | null
}

export interface MissingItem {
  id: string
  label: string
  /** PCG article or text asking for it. */
  source: string
}

export interface AnnexeNote {
  id: string
  title: string
  /** PCG articles of the note ("PCG art. 832-1"). */
  source: string
  blocks: Block[]
}

export interface Annexe {
  list: AnnexeList
  listLabel: string
  listSource: string
  required: boolean
  category: SizeCategory
  categoryLabel: string
  categoryConfirmed: boolean
  notes: AnnexeNote[]
  missing: MissingItem[]
  warnings: string[]
}

const SIMPLIFIED_ARTICLES = ['831-1', '831-2', '832-1', '832-3', '832-8', '832-9', '832-12', '832-13', '832-15', '834-2', '836-1', '836-3', '836-5', '838-1']
const SMALL_ARTICLES = [
  '831-1', '831-2', '832-1', '832-2', '832-3', '832-4', '832-5', '832-6', '832-7', '832-8', '832-9', '832-10', '832-11', '832-12', '832-13', '832-14',
  '832-15', '832-17', '832-19', '832-21', '833-1', '833-2', '834-2', '835-1', '836-1', '836-2', '836-3', '836-5', '837-1', '838-1',
]

/** Which list of PCG title VIII applies: art. 811-7 (micro), 811-8 (régime simplifié), 811-9 (petite), all of chapter III otherwise. */
export function annexeListOf(category: SizeCategory, corporateTaxRegime: string | null): AnnexeList {
  if (category === 'micro') return 'micro'
  if (category === 'small') return corporateTaxRegime === 'simplified' ? 'simplified' : 'small'
  return 'full'
}

const LIST_LABELS: Record<AnnexeList, { label: string; source: string }> = {
  micro: { label: 'Micro-entreprise : informations à la suite du bilan, annexe facultative', source: 'C. com. art. L123-16-1, PCG art. 811-7' },
  simplified: { label: 'Petite entreprise au régime réel simplifié : annexe simplifiée', source: 'C. com. art. L123-25, PCG art. 811-8' },
  small: { label: 'Petite entreprise : annexe simplifiée', source: 'C. com. art. L123-16, PCG art. 811-9' },
  full: { label: 'Moyenne ou grande entreprise : annexe complète', source: 'PCG art. 831-1 à 838-x' },
}

function applies(list: AnnexeList, article: string): boolean {
  if (list === 'full') return true
  if (list === 'micro') return false
  return (list === 'simplified' ? SIMPLIFIED_ARTICLES : SMALL_ARTICLES).includes(article)
}

const balanceOf = (a: AccountYear) => a.openingCents + a.debitCents - a.creditCents
const matches = (code: string, prefixes: readonly string[]) => prefixes.some((p) => code.startsWith(p))
const sum = <T>(items: readonly T[], f: (item: T) => number) => items.reduce((s, i) => s + f(i), 0)
const frDay = (iso: string) => iso.split('-').reverse().join('/')
const pct = (bp: number) => `${(bp / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`
const maybe = (cents: number | null) => (cents === null ? 'non renseigné' : eur(cents))

/** Debit balances (assets) or credit balances (liabilities) of the accounts matching `prefixes`, at the closing. */
function balances(accounts: readonly AccountYear[], prefixes: readonly string[], side: 'debit' | 'credit', exclude: readonly string[] = []): number {
  return sum(
    accounts.filter((a) => matches(a.code, prefixes) && !matches(a.code, exclude)),
    (a) => {
      const b = balanceOf(a)
      return side === 'debit' ? Math.max(0, b) : Math.max(0, -b)
    },
  )
}

interface Group {
  label: string
  prefixes: string[]
  exclude?: string[]
}

/** Opening, increases (credits), decreases (debits) and closing of credit-balance accounts (equity, provisions). */
function creditMovements(accounts: readonly AccountYear[], group: Group) {
  const list = accounts.filter((a) => matches(a.code, group.prefixes) && !matches(a.code, group.exclude ?? []))
  const opening = -sum(list, (a) => a.openingCents)
  const increase = sum(list, (a) => a.creditCents)
  const decrease = sum(list, (a) => a.debitCents)
  return { label: group.label, opening, increase, decrease, closing: opening + increase - decrease }
}

const PROVISION_GROUPS: Group[] = [
  { label: 'Provisions pour risques et charges', prefixes: ['15'] },
  { label: 'Dépréciations des immobilisations incorporelles', prefixes: ['290'] },
  { label: 'Dépréciations des immobilisations corporelles', prefixes: ['291', '292', '293'] },
  { label: 'Dépréciations des immobilisations financières', prefixes: ['296', '297'] },
  { label: 'Dépréciations des stocks et en-cours', prefixes: ['39'] },
  { label: 'Dépréciations des créances', prefixes: ['49'] },
  { label: 'Dépréciations des valeurs mobilières de placement', prefixes: ['59'] },
]

const EQUITY_GROUPS: Group[] = [
  { label: 'Capital', prefixes: ['101', '108'] },
  { label: "Primes d'émission, de fusion, d'apport", prefixes: ['104'] },
  { label: 'Écarts de réévaluation', prefixes: ['105'] },
  { label: 'Réserves', prefixes: ['106'] },
  { label: 'Report à nouveau', prefixes: ['11'] },
  { label: "Résultat de l'exercice", prefixes: ['12'] },
  { label: "Subventions d'investissement", prefixes: ['13'] },
  { label: 'Provisions réglementées', prefixes: ['14'] },
]

const RECEIVABLE_GROUPS: Array<Group & { side: 'debit' }> = [
  { label: 'Créances rattachées à des participations', prefixes: ['267'], side: 'debit' },
  { label: 'Prêts et autres immobilisations financières', prefixes: ['268', '27'], exclude: ['279', '2768'], side: 'debit' },
  { label: 'Clients et comptes rattachés', prefixes: ['41'], exclude: ['419'], side: 'debit' },
  { label: 'Personnel et organismes sociaux', prefixes: ['42', '43'], side: 'debit' },
  { label: 'État et autres collectivités publiques', prefixes: ['44'], side: 'debit' },
  { label: 'Groupe et associés', prefixes: ['45'], side: 'debit' },
  { label: 'Débiteurs divers', prefixes: ['46', '47'], exclude: ['476', '477'], side: 'debit' },
  { label: "Charges constatées d'avance", prefixes: ['486'], side: 'debit' },
]

const DEBT_GROUPS: Array<Group & { side: 'credit' }> = [
  { label: 'Emprunts obligataires', prefixes: ['161', '163'], side: 'credit' },
  { label: 'Emprunts et dettes auprès des établissements de crédit', prefixes: ['164', '512', '514', '517', '519'], side: 'credit' },
  { label: 'Emprunts et dettes financières divers', prefixes: ['165', '166', '167', '168', '17'], side: 'credit' },
  { label: 'Fournisseurs et comptes rattachés', prefixes: ['40'], exclude: ['409'], side: 'credit' },
  { label: 'Personnel et organismes sociaux', prefixes: ['42', '43'], side: 'credit' },
  { label: 'État et autres collectivités publiques', prefixes: ['44'], side: 'credit' },
  { label: 'Groupe et associés', prefixes: ['45'], side: 'credit' },
  { label: 'Autres dettes', prefixes: ['46', '47', '419'], exclude: ['476', '477'], side: 'credit' },
  { label: "Produits constatés d'avance", prefixes: ['487'], side: 'credit' },
]

/** Accruals (PCG art. 832-19): charges à payer and produits à recevoir accounts of the chart. */
const ACCRUED_CHARGES = ['1688', '408', '4282', '4286', '4382', '4386', '4482', '4486', '4686']
const ACCRUED_INCOME = ['2768', '418', '4287', '4387', '4487', '4687']

const table = (columns: string[], rows: string[][]): Block => ({ kind: 'table', columns, rows, numeric: columns.map((_, i) => i).filter((i) => i > 0) })
const p = (text: string): Block => ({ kind: 'paragraph', text })
const answerText = (a: { none: boolean; text: string | null } | null) => (a === null ? null : a.none ? 'Néant.' : (a.text as string))

const RUBRIQUE_LABELS: Record<Rubrique, string> = { intangible: 'Immobilisations incorporelles', tangible: 'Immobilisations corporelles', financial: 'Immobilisations financières' }

export function buildAnnexe(data: AnnexeData, details: AnnexeDetails): Annexe {
  const list = annexeListOf(data.size.category, data.company.corporateTaxRegime)
  const notes: AnnexeNote[] = []
  const missing: MissingItem[] = []
  const warnings: string[] = []
  const ask = (id: string, label: string, source: string) => missing.push({ id, label, source })
  const accounts = data.accounts
  const fy = data.fiscalYear
  const period = `l'exercice du ${frDay(fy.startDate)} au ${frDay(fy.endDate)}`

  if (!data.size.confirmed) {
    warnings.push(`Catégorie proposée d'après les comptes (${SIZE_LABELS[data.size.category]}) : confirmez-la sur la page Approbation des comptes, elle décide du contenu de l'annexe.`)
  }
  if (!fy.isClosed) warnings.push("L'exercice n'est pas clôturé : les montants peuvent encore changer.")

  // Commitments are asked whatever the category (PCG art. 811-7 and 836-1)
  const commitments = details.commitments
  if (commitments === null) ask('commitments', 'Engagements hors bilan (cautions, garanties, sûretés, crédit-bail, retraite, entités liées), ou « Néant »', list === 'micro' ? 'PCG art. 811-7' : 'PCG art. 836-1 à 836-5')
  const commitmentBlocks = (): Block[] => {
    if (!commitments) return []
    if (commitments.none) return [p('Néant : aucun engagement financier, garantie ou passif éventuel ne figure hors du bilan.')]
    return COMMITMENT_KINDS.flatMap((kind) => {
      const items = commitments.items.filter((c) => c.kind === kind)
      if (items.length === 0) return []
      const rows = items.map((c) => [c.description, maybe(c.amountCents), ...(kind === 'leasing' ? [maybe(c.residualCents)] : [])])
      return [
        { kind: 'heading' as const, text: COMMITMENT_LABELS[kind] },
        table(['Engagement', kind === 'leasing' ? 'Redevances restant à payer' : 'Montant', ...(kind === 'leasing' ? ['Prix d’achat résiduel'] : [])], rows),
      ]
    })
  }
  const advances = details.directorAdvances
  const advancesBlocks = (): Block[] =>
    advances === null
      ? []
      : [p(advances.none ? 'Aucune avance ni aucun crédit n’a été alloué aux dirigeants.' : `Avances et crédits alloués aux dirigeants : ${maybe(advances.amountCents)}${advances.conditions ? `, ${advances.conditions}` : ''}.`)]
  const ownShares = balances(accounts, ['502', '2771', '2772'], 'debit')

  if (list === 'micro') {
    if (advances === null) ask('directorAdvances', 'Avances et crédits alloués aux dirigeants, ou « Néant »', 'PCG art. 811-7')
    notes.push({
      id: 'micro',
      title: 'Informations mentionnées à la suite du bilan',
      source: 'C. com. art. L123-16-1, PCG art. 811-7',
      blocks: [
        p(`Les comptes annuels de ${period} sont établis selon le règlement ANC n° 2014-03 relatif au plan comptable général, dans sa version applicable à l'exercice. La société, micro-entreprise, n'établit pas d'annexe.`),
        { kind: 'heading', text: 'Engagements financiers, garanties et passifs éventuels hors bilan' },
        ...commitmentBlocks(),
        { kind: 'heading', text: 'Avances et crédits alloués aux dirigeants' },
        ...advancesBlocks(),
        ...(ownShares > 0 ? [{ kind: 'heading' as const, text: 'Actions propres' }, p(`Valeur des actions propres détenues à la clôture : ${eur(ownShares)}.`)] : []),
      ],
    })
    return finish()
  }

  // 1. Rules and methods (PCG art. 831-1)
  if (details.derogations === null) ask('derogations', 'Dérogations aux règles générales ou à la durée de l’exercice, ou « Néant »', 'PCG art. 831-1, 2°')
  const hasStocks = accounts.some((a) => a.code.startsWith('3') && balanceOf(a) !== 0)
  const hasAssets = data.fixedAssets.rubriques.some((r) => r.closingCents !== 0 || r.openingCents !== 0)
  if (data.methods.length === 0 && (hasStocks || hasAssets)) {
    ask('methods', 'Méthodes comptables retenues (registre des méthodes : amortissements, stocks...)', 'PCG art. 831-1, 3°')
  }
  const rulesBlocks: Block[] = [
    p(`Les comptes annuels de ${period} sont établis conformément au règlement ANC n° 2014-03 relatif au plan comptable général, dans sa version applicable à l'exercice. Les conventions générales comptables ont été appliquées dans le respect du principe de prudence, de continuité d'exploitation, de permanence des méthodes et d'indépendance des exercices.`),
  ]
  const derogations = answerText(details.derogations)
  if (derogations) rulesBlocks.push({ kind: 'heading', text: 'Dérogations' }, p(derogations))
  if (data.methods.length > 0) {
    rulesBlocks.push(
      { kind: 'heading', text: 'Principales méthodes retenues' },
      table(
        ['Sujet', 'Méthode retenue', 'Application'],
        data.methods.map((m) => [METHOD_TOPIC_LABELS[m.topic as MethodTopic] ?? m.topic, `${m.label}${m.referenceMethod ? ' (méthode de référence)' : ''}`, m.description]),
      ),
    )
  }
  const depreciated = data.register.filter((r) => r.assets > 0 && r.methods.length > 0)
  if (applies(list, '832-1') && depreciated.length > 0) {
    rulesBlocks.push(
      { kind: 'heading', text: "Modes et durées d'amortissement" },
      table(
        ['Rubrique', 'Mode', "Durée d'utilisation"],
        depreciated.map((r) => [
          RUBRIQUE_LABELS[r.rubrique],
          r.methods.join(', '),
          r.minYears === null ? '-' : r.minYears === r.maxYears ? `${r.minYears} ans` : `${r.minYears} à ${r.maxYears} ans`,
        ]),
      ),
    )
  }
  notes.push({ id: 'rules', title: 'Règles et méthodes comptables', source: 'PCG art. 831-1', blocks: rulesBlocks })

  // 2. Changes of method or estimate, corrections of errors (PCG art. 831-2, 831-3)
  if (applies(list, '831-2')) {
    const blocks: Block[] =
      data.changes.length === 0
        ? [p("Aucun changement de réglementation ou de méthode comptable, aucun changement d'estimation et aucune correction d'erreur n'a été enregistré pour l'exercice.")]
        : data.changes.flatMap((c) => [
            { kind: 'heading' as const, text: `${CHANGE_KIND_LABELS[c.kind]} : ${c.label}` },
            p(c.description),
            {
              kind: 'list' as const,
              items: [
                `Traitement : ${TREATMENT_LABELS[c.treatment]} (${CHANGE_SOURCES[c.kind]}).`,
                ...(c.treatment === 'PROSPECTIVE'
                  ? []
                  : [
                      `Impact avant impôt : ${eur(c.impactCents)}${c.taxEffectCents ? `, effet d'impôt ${eur(c.taxEffectCents)}, impact après impôt ${eur(c.netImpactCents)}` : ''}.`,
                      ...(c.accountCode ? [`Poste concerné : compte ${c.accountCode}.`] : []),
                    ]),
                ...(c.method ? [`Méthode concernée : ${c.method.label}.`] : []),
              ],
            },
          ])
    for (const c of data.changes) {
      if (c.entryExpected && !c.entry) warnings.push(`« ${c.label} » : l'écriture de rattrapage n'est pas préparée (page Méthodes comptables).`)
      else if (c.entry?.status === 'draft') warnings.push(`« ${c.label} » : l'écriture n° ${c.entry.entryNumber} est encore en brouillon.`)
    }
    notes.push({ id: 'changes', title: "Changements de méthode, changements d'estimation et corrections d'erreurs", source: 'PCG art. 122-1 à 122-6, 831-2', blocks })
  }

  // 3. Fixed assets and depreciation (PCG art. 832-1, 832-2)
  const fa = data.fixedAssets
  if (hasAssets) {
    const gross = fa.rubriques.filter((r) => r.openingCents !== 0 || r.closingCents !== 0 || r.increaseCents !== 0 || r.decreaseCents !== 0)
    const total = { opening: sum(gross, (r) => r.openingCents), increase: sum(gross, (r) => r.increaseCents), decrease: sum(gross, (r) => r.decreaseCents), closing: sum(gross, (r) => r.closingCents) }
    const blocks: Block[] = [
      table(
        ['Rubrique', 'Valeur brute au début', 'Augmentations', 'Diminutions', 'Valeur brute à la fin'],
        [
          ...gross.map((r) => [r.label, eur(r.openingCents), eur(r.increaseCents), eur(r.decreaseCents), eur(r.closingCents)]),
          ['Total', eur(total.opening), eur(total.increase), eur(total.decrease), eur(total.closing)],
        ],
      ),
    ]
    if (applies(list, '832-2')) {
      const detail = fa.form2054.filter((r) => !r.isTotal && Object.values(r.amounts).some((v) => v !== null && v !== 0))
      blocks.push(
        { kind: 'heading', text: 'Détail des mouvements' },
        table(
          ['Poste', 'Réévaluations', 'Entrées et virements', 'Virements de poste à poste', 'Cessions et mises hors service'],
          detail.map((r) => [r.label, eur(r.amounts.revaluation ?? 0), eur(r.amounts.increase ?? 0), eur(r.amounts.transferOut ?? 0), eur(r.amounts.disposal ?? 0)]),
        ),
      )
    }
    notes.push({ id: 'fixed-assets', title: 'Immobilisations', source: 'PCG art. 832-1 et 832-2', blocks })

    const dep = fa.form2055.filter((r) => !r.isTotal && Object.values(r.amounts).some((v) => v !== null && v !== 0))
    if (dep.length > 0) {
      const t = fa.form2055.find((r) => r.id === 'grandTotal')!
      notes.push({
        id: 'depreciation',
        title: 'Amortissements',
        source: 'PCG art. 832-1',
        blocks: [
          table(
            ['Poste', 'Au début', 'Dotations', 'Diminutions', 'À la fin'],
            [
              ...dep.map((r) => [r.label, eur(r.amounts.opening ?? 0), eur(r.amounts.allowance ?? 0), eur(r.amounts.decrease ?? 0), eur(r.amounts.closing ?? 0)]),
              ['Total', eur(t.amounts.opening ?? 0), eur(t.amounts.allowance ?? 0), eur(t.amounts.decrease ?? 0), eur(t.amounts.closing ?? 0)],
            ],
          ),
          p("Les dotations aux amortissements sont comprises dans les dotations d'exploitation du compte de résultat (comptes 6811 et 6812)."),
        ],
      })
    }
    for (const c of fa.checks.filter((c) => !c.ok && c.id.startsWith('balance-sheet'))) warnings.push(c.message as string)
  }

  // 4. Provisions and impairments (PCG art. 832-1, 832-8, 832-13)
  const provisions = PROVISION_GROUPS.map((g) => creditMovements(accounts, g)).filter((m) => m.opening || m.increase || m.decrease)
  if (provisions.length > 0) {
    notes.push({
      id: 'provisions',
      title: 'Provisions et dépréciations',
      source: 'PCG art. 832-1, 832-8 et 832-13',
      blocks: [
        table(
          ['Nature', 'Au début', 'Dotations', 'Reprises', 'À la fin'],
          provisions.map((m) => [m.label, eur(m.opening), eur(m.increase), eur(m.decrease), eur(m.closing)]),
        ),
        p("Les provisions et dépréciations sont détaillées, avec leur objet et leur mode d'estimation, sur la page Provisions et dépréciations."),
      ],
    })
  }

  // 5. Revaluation (PCG art. 832-3)
  const revaluation = creditMovements(accounts, { label: 'Écarts de réévaluation', prefixes: ['105'] })
  if (applies(list, '832-3') && (revaluation.opening || revaluation.increase || revaluation.decrease)) {
    notes.push({
      id: 'revaluation',
      title: 'Réévaluation',
      source: 'PCG art. 832-3',
      blocks: [p(`Écart de réévaluation : ${eur(revaluation.opening)} au début de l'exercice, ${eur(revaluation.increase)} d'augmentation, ${eur(revaluation.decrease)} de diminution, ${eur(revaluation.closing)} à la clôture.`)],
    })
  }

  // 6. Subsidiaries and participations (PCG art. 832-5, C. com. L233-15)
  if (applies(list, '832-5')) {
    const held = data.participations
    const titres = balances(accounts, ['261', '266'], 'debit')
    const rows: ParticipationLine[] = [...(held?.rows ?? [])]
    // Titres no company of Kledg explains: the user gives that company's figures (never guessed)
    if (held === null && titres > 0) warnings.push("Les filiales et participations n'ont pas été lues pour cette réponse : ouvrez la page Annexe pour les voir.")
    if (held !== null && held.unattributedCents > 0) {
      if (details.externalParticipations === null) ask('externalParticipations', 'Sociétés détenues hors Kledg (titres 261) : capital, capitaux propres, quote-part, résultat', 'PCG art. 832-5')
    }
    for (const e of details.externalParticipations ?? []) {
      rows.push({
        name: e.name,
        siren: e.siren,
        ownershipBp: Math.round(e.sharePercent * 100),
        capitalCents: e.capitalCents,
        equityCents: e.equityCents,
        bookValueGrossCents: null,
        bookValueNetCents: null,
        loansCents: null,
        revenueCents: e.revenueCents,
        resultCents: e.resultCents,
        dividendsCents: e.dividendsCents,
      })
    }
    if (rows.length > 0) {
      notes.push({
        id: 'participations',
        title: 'Filiales et participations',
        source: 'PCG art. 832-5, C. com. art. L233-15',
        blocks: [
          table(
            ['Société', 'Quote-part du capital', 'Capital', 'Capitaux propres', 'Valeur comptable brute', 'Valeur comptable nette', 'Prêts et avances', "Chiffre d'affaires", 'Résultat', 'Dividendes encaissés'],
            rows.map((r) => [
              `${r.name}${r.siren ? ` (${r.siren})` : ''}`,
              pct(r.ownershipBp),
              maybe(r.capitalCents),
              maybe(r.equityCents),
              maybe(r.bookValueGrossCents),
              maybe(r.bookValueNetCents),
              maybe(r.loansCents),
              maybe(r.revenueCents),
              maybe(r.resultCents),
              maybe(r.dividendsCents),
            ]),
          ),
          p('Filiale : plus de 50 % du capital détenu (C. com. art. L233-1) ; participation : de 10 à 50 % (art. L233-2).'),
        ],
      })
    }
  }

  // 7. Receivables by maturity (PCG art. 832-9)
  const receivables = RECEIVABLE_GROUPS.map((g) => ({ label: g.label, cents: balances(accounts, g.prefixes, 'debit', g.exclude) })).filter((r) => r.cents > 0)
  const receivablesTotal = sum(receivables, (r) => r.cents)
  if (applies(list, '832-9') && receivablesTotal > 0) {
    const m = details.receivableMaturities
    if (m === null) ask('receivableMaturities', 'Part des créances à plus d’un an à la clôture', 'PCG art. 832-9')
    else if (m.overOneYearCents > receivablesTotal) warnings.push('La part des créances à plus d’un an dépasse le total des créances.')
    notes.push({
      id: 'receivables',
      title: 'État des créances',
      source: 'PCG art. 832-9',
      blocks: [
        table(['Créances', 'Montant brut'], [...receivables.map((r) => [r.label, eur(r.cents)]), ['Total', eur(receivablesTotal)]]),
        ...(m ? [p(`Échéance à un an au plus : ${eur(receivablesTotal - m.overOneYearCents)} ; à plus d'un an : ${eur(m.overOneYearCents)}.`)] : []),
      ],
    })
  }

  // 8. Equity (PCG art. 832-11)
  if (applies(list, '832-11')) {
    const rows = EQUITY_GROUPS.map((g) => creditMovements(accounts, g)).map((m) => (m.label === "Résultat de l'exercice" ? { ...m, increase: m.increase + Math.max(0, data.resultCents), decrease: m.decrease + Math.max(0, -data.resultCents), closing: m.closing + data.resultCents } : m))
    const shown = rows.filter((m) => m.opening || m.increase || m.decrease || m.closing)
    const c = data.company
    const blocks: Block[] = []
    if (c.totalShares !== null) {
      blocks.push(p(`Le capital est composé de ${c.totalShares.toLocaleString('fr-FR')} titres${c.nominalCents !== null ? ` d'une valeur nominale de ${eur(c.nominalCents)}` : ''}${c.shareCapitalCents !== null ? `, soit ${eur(c.shareCapitalCents)}` : ''}.`))
    }
    const capitalIncrease = creditMovements(accounts, { label: 'Capital', prefixes: ['101'] })
    if (capitalIncrease.increase > 0) blocks.push(p(`Le capital a augmenté de ${eur(capitalIncrease.increase)} au cours de l'exercice.`))
    blocks.push(
      table(
        ['Capitaux propres', 'Au début', 'Augmentations', 'Diminutions', 'À la fin'],
        [...shown.map((m) => [m.label, eur(m.opening), eur(m.increase), eur(m.decrease), eur(m.closing)]), ['Total', eur(sum(shown, (m) => m.opening)), eur(sum(shown, (m) => m.increase)), eur(sum(shown, (m) => m.decrease)), eur(sum(shown, (m) => m.closing))]],
      ),
    )
    notes.push({ id: 'equity', title: 'Capital et variation des capitaux propres', source: 'PCG art. 832-11', blocks })
  }

  // 9. Own shares (PCG art. 832-12)
  if (applies(list, '832-12') && ownShares > 0) {
    notes.push({ id: 'own-shares', title: 'Actions propres', source: 'PCG art. 832-12', blocks: [p(`Valeur des actions propres détenues à la clôture (comptes 502, 2771 et 2772) : ${eur(ownShares)}.`)] })
  }

  // 10. Debts by maturity (PCG art. 832-15)
  const debts = DEBT_GROUPS.map((g) => ({ label: g.label, cents: balances(accounts, g.prefixes, 'credit', g.exclude) })).filter((r) => r.cents > 0)
  const debtsTotal = sum(debts, (r) => r.cents)
  if (applies(list, '832-15') && debtsTotal > 0) {
    const m = details.debtMaturities
    if (m === null) ask('debtMaturities', 'Part des dettes à plus d’un an et à plus de cinq ans à la clôture', 'PCG art. 832-15')
    else if (m.overOneYearCents > debtsTotal) warnings.push('La part des dettes à plus d’un an dépasse le total des dettes.')
    notes.push({
      id: 'debts',
      title: 'État des dettes',
      source: 'PCG art. 832-15',
      blocks: [
        table(['Dettes', 'Montant'], [...debts.map((r) => [r.label, eur(r.cents)]), ['Total', eur(debtsTotal)]]),
        ...(m
          ? [p(`Échéance à un an au plus : ${eur(debtsTotal - m.overOneYearCents)} ; à plus d'un an et cinq ans au plus : ${eur(m.overOneYearCents - m.overFiveYearsCents)} ; à plus de cinq ans : ${eur(m.overFiveYearsCents)}.`)]
          : []),
      ],
    })
  }

  // 11. Accruals and prepayments (PCG art. 832-10, 832-17, 832-19)
  if (applies(list, '832-19')) {
    const charges = balances(accounts, ACCRUED_CHARGES, 'credit')
    const income = balances(accounts, ACCRUED_INCOME, 'debit')
    const prepaid = balances(accounts, ['486'], 'debit')
    const deferred = balances(accounts, ['487'], 'credit')
    const rows = [
      ['Charges à payer', charges],
      ['Produits à recevoir', income],
      ["Charges constatées d'avance", prepaid],
      ["Produits constatés d'avance", deferred],
    ].filter(([, v]) => (v as number) > 0) as Array<[string, number]>
    if (rows.length > 0) {
      notes.push({ id: 'accruals', title: 'Charges à payer, produits à recevoir et comptes de régularisation', source: 'PCG art. 832-10, 832-17 et 832-19', blocks: [table(['Nature', 'Montant'], rows.map(([l, v]) => [l, eur(v)]))] })
    }
  }

  // 12. Exceptional result (PCG art. 832-21)
  if (applies(list, '832-21')) {
    const charges = accounts.filter((a) => a.code.startsWith('67') || a.code.startsWith('687')).map((a) => [a.code, a.label, a.debitCents - a.creditCents] as const)
    const income = accounts.filter((a) => a.code.startsWith('77') || a.code.startsWith('787')).map((a) => [a.code, a.label, a.creditCents - a.debitCents] as const)
    const rows = [...charges, ...income].filter(([, , v]) => v !== 0)
    if (rows.length > 0) {
      notes.push({
        id: 'exceptional',
        title: 'Résultat exceptionnel',
        source: 'PCG art. 832-21',
        blocks: [{ kind: 'table', columns: ['Compte', 'Nature', 'Montant'], rows: rows.map(([code, label, v]) => [code, label, eur(v)]), numeric: [2] }],
      })
    }
  }

  // 13. Tax credits (PCG art. 833-2)
  if (applies(list, '833-2')) {
    const credits = details.taxCredits
    if (credits === null) ask('taxCredits', "Crédits d'impôt de l'exercice (recherche, autres), ou « Néant »", 'PCG art. 833-2')
    else
      notes.push({
        id: 'tax-credits',
        title: "Crédits d'impôt",
        source: 'PCG art. 833-2',
        blocks: credits.none ? [p("Aucun crédit d'impôt.")] : [table(["Crédit d'impôt", 'Montant'], credits.items.map((c) => [c.label, eur(c.amountCents)]))],
      })
  }

  // 14. Related parties (PCG art. 834-2)
  if (applies(list, '834-2')) {
    const related = answerText(details.relatedParties)
    if (related === null) ask('relatedParties', 'Transactions significatives avec des parties liées hors conditions normales de marché, ou « Néant »', 'PCG art. 834-2')
    else notes.push({ id: 'related-parties', title: 'Transactions avec les parties liées', source: 'PCG art. 834-2', blocks: [p(related)] })
  }

  // 15. Officers (PCG art. 835-1, 835-2)
  if (applies(list, '835-1')) {
    if (advances === null) ask('directorAdvances', 'Avances et crédits alloués aux dirigeants, ou « Néant »', 'PCG art. 835-1')
    const blocks = advancesBlocks()
    if (applies(list, '835-2')) {
      const r = details.directorRemuneration
      if (r === null) ask('directorRemuneration', 'Montant global des rémunérations allouées aux dirigeants', 'PCG art. 835-2')
      else blocks.push(p(r.omitted ? "Les rémunérations des dirigeants ne sont pas mentionnées : leur montant permettrait d'identifier la situation d'un dirigeant (PCG art. 835-2)." : `Rémunérations allouées aux dirigeants au titre de leurs fonctions : ${maybe(r.amountCents)}.`))
    }
    if (blocks.length > 0) notes.push({ id: 'officers', title: 'Dirigeants', source: applies(list, '835-2') ? 'PCG art. 835-1 et 835-2' : 'PCG art. 835-1', blocks })
  }

  // 16. Commitments (PCG art. 836-1 to 836-5)
  if (commitments !== null) notes.push({ id: 'commitments', title: 'Engagements hors bilan', source: 'PCG art. 836-1 à 836-5', blocks: commitmentBlocks() })

  // 17. Headcount (PCG art. 837-1)
  if (applies(list, '837-1')) {
    const employees = details.employees ?? data.approvalEmployees
    if (employees === null) ask('employees', 'Effectif moyen employé pendant l’exercice', 'PCG art. 837-1, C. com. art. D123-200')
    else notes.push({ id: 'headcount', title: 'Effectif', source: 'PCG art. 837-1', blocks: [p(`Effectif moyen employé pendant l'exercice : ${employees}.`)] })
  }

  // 18. Consolidating entity (PCG art. 831-4)
  if (applies(list, '831-4') && data.groupMember === true) {
    const e = details.consolidatingEntity
    if (e === null) ask('consolidatingEntity', 'Société qui établit les comptes consolidés du groupe (nom, siège, SIREN)', 'PCG art. 831-4')
    else
      notes.push({
        id: 'consolidating-entity',
        title: 'Entité consolidante',
        source: 'PCG art. 831-4',
        blocks: [p(`Les comptes de la société sont inclus dans les comptes consolidés établis par ${e.name}, ${e.seat}${e.siren ? `, SIREN ${e.siren}` : ''}.${e.copiesAt ? ` Copie des comptes consolidés : ${e.copiesAt}.` : ''}`)],
      })
  }

  // 19. Events after the closing and other information (PCG art. 831-1, 4° and 5°)
  const events = answerText(details.postClosingEvents)
  if (events === null) ask('postClosingEvents', 'Événements postérieurs à la clôture, ou « Néant »', 'PCG art. 831-1, 4°')
  const other: Block[] = []
  if (events !== null) other.push({ kind: 'heading', text: 'Événements postérieurs à la clôture' }, p(events))
  if (details.otherInformation) other.push({ kind: 'heading', text: 'Autres informations' }, p(details.otherInformation))
  if (other.length > 0) notes.push({ id: 'other', title: 'Autres informations', source: 'PCG art. 831-1, 4° et 5°', blocks: other })

  return finish()

  function finish(): Annexe {
    const seen = new Set<string>()
    return {
      list,
      listLabel: LIST_LABELS[list].label,
      listSource: LIST_LABELS[list].source,
      required: list !== 'micro',
      category: data.size.category,
      categoryLabel: SIZE_LABELS[data.size.category],
      categoryConfirmed: data.size.confirmed,
      notes,
      missing: missing.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true))),
      warnings,
    }
  }
}
