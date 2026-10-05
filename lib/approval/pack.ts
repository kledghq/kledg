/**
 * The approval pack of one fiscal year: from the books and the company
 * record (ApprovalContext) and what the user entered (ApprovalDetails),
 * everything the screen and the documents need: the legal regime, the
 * proposed allocation of the result, the resolutions with their outcome,
 * the deadlines, which documents are required and what each still misses,
 * the size category and its consequences, and the filing checklist.
 *
 * Pure: no database, no clock (the day is in the context). Rules and their
 * sources are in legal-regime.ts, votes.ts, size.ts; the allocation is the
 * one Kledg books (lib/accounting/result-allocation/compute.ts, C. com.
 * L232-10 and L232-11).
 *
 * Nothing is invented: a value the law requires and Kledg does not hold is
 * listed in `missing` for the document that needs it, and that document is
 * not generated until the user gives it.
 */

import { approvalDeadlineOf, filingDeadlineOf } from '@/lib/deadlines/engine'
import {
  legalReserveApplies,
  planAllocation,
  type AllocationBalances,
  type AllocationPlan,
} from '@/lib/accounting/result-allocation/compute'
import { addIsoDays } from '@/lib/utils/date'
import { approvalRegime, decisionTitle, defaultDecisionMode, unsupportedReason, type ApprovalRegime, type DecisionMode } from './legal-regime'
import type { ApprovalDetails, AttendanceStatus, ConfidentialityOption, ResolutionId } from './schemas'
import { proposeCategory, SIZE_LABELS, type SizeCategory } from './size'
import { SOURCES, type LegalSource } from './sources'
import { voteOutcome, type VoteContext, type VoteOutcome } from './votes'

export interface ApprovalHolder {
  id: string
  name: string
  kind: 'PHYSICAL' | 'LEGAL'
  shares: number | null
}

/** What the books and the company record say, loaded by get-approval.service.ts. */
export interface ApprovalContext {
  today: string
  company: {
    name: string
    siren: string
    legalType: string | null
    shareCapitalCents: number | null
    /** Head office, one line; null when not recorded. */
    address: string | null
    /** Company.isHolding: its activity is managing participations (excluded from the micro option and the report exemption). */
    isHolding: boolean
    /** Company.corporateTaxRegime: normal or simplified means subject to IS; null when unknown. */
    corporateTaxRegime: string | null
    /** Deadline settings: accounts filed online by default. */
    accountsFiledOnline: boolean
  }
  fiscalYear: { id: string; year: number; startDate: string; endDate: string; isClosed: boolean }
  holders: ApprovalHolder[]
  /** Company.totalShares; null when not recorded. */
  totalShares: number | null
  /** Balances for the allocation, the result of the year included (validated entries). */
  balances: AllocationBalances
  /** Figures of the year and the previous one for the size category, cents. */
  figures: {
    revenueCents: number
    totalAssetsCents: number
    previous: { revenueCents: number; totalAssetsCents: number } | null
  }
  /** Validated entries only: drafts of the year, which may change the result. */
  draftEntries: number
}

/** 'annexe' is added by get-approval.service.ts from lib/annexe (it reads the books, the pack is pure). */
export const DOCUMENT_IDS = ['convocation', 'management-report', 'decision', 'attendance', 'confidentiality', 'annexe', 'filing-checklist'] as const
export type DocumentId = (typeof DOCUMENT_IDS)[number]

export interface PackDocument {
  id: DocumentId
  title: string
  /** Required by law in this situation (false: useful or optional). */
  required: boolean
  /** Why it is needed, with its source. */
  reason: string
  sources: LegalSource[]
  /** What the user must still give before it can be generated, in French. */
  missing: string[]
}

export interface PackResolution {
  id: ResolutionId
  title: string
  outcome: VoteOutcome
}

export interface ChecklistItem {
  text: string
  sources: LegalSource[]
}

export interface ConfidentialityChoice {
  value: ConfidentialityOption
  label: string
  available: boolean
  reason: string | null
}

export interface ApprovalPack {
  regime: ApprovalRegime | null
  unsupported: string | null
  decisionMode: DecisionMode | null
  decisionTitle: string | null
  holders: Array<ApprovalHolder & { status: AttendanceStatus | null; proxy: string | null; votes: number }>
  totalVotes: number
  presentVotes: number
  plan: AllocationPlan
  resultCents: number
  /** Dividends of the three previous years are recalled (CGI art. 243 bis): companies subject to IS. */
  priorDividendsRequired: boolean
  size: {
    proposed: SizeCategory
    certain: boolean
    confirmed: SizeCategory | null
    label: string | null
  }
  managementReport: { required: boolean | null; produced: boolean; reason: string; sources: LegalSource[] }
  confidentiality: { choices: ConfidentialityChoice[]; chosen: ConfidentialityOption }
  resolutions: PackResolution[]
  deadlines: {
    /** Last day to approve (null: per statuts or no legal deadline). */
    approval: string | null
    approvalNote: string
    /** Last day to send the convocation, from the meeting date. */
    convocation: string | null
    /** Last day to file with the greffe (null: no filing). */
    filing: string | null
    filingBasis: 'approval' | 'deadline' | null
    sources: LegalSource[]
  }
  documents: PackDocument[]
  publication: { required: boolean; items: ChecklistItem[]; notes: string[] }
  /** Things to look at, in French: they do not block the documents. */
  warnings: string[]
}

const ATTENDING: ReadonlySet<AttendanceStatus> = new Set(['present', 'represented', 'remote'])

/** "30 juin 2026" from yyyy-mm-dd. */
export function longDate(iso: string): string {
  const months = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
  const day = Number(iso.slice(8, 10))
  return `${day === 1 ? '1er' : day} ${months[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`
}

function isSubjectToCorporateTax(context: ApprovalContext, regime: ApprovalRegime): boolean {
  const r = context.company.corporateTaxRegime
  if (r === 'normal' || r === 'simplified') return true
  // A société civile is at the income tax unless it opted; other forms are at IS by default.
  return r === null && regime.form !== 'SCI'
}

function confidentialityChoices(category: SizeCategory | null, details: ApprovalDetails, context: ApprovalContext): ConfidentialityChoice[] {
  const excluded = details.excludedEntity
  const choice = (value: ConfidentialityOption, label: string, why: string | null): ConfidentialityChoice => ({ value, label, available: why === null, reason: why })
  const notCategory = (needed: SizeCategory) =>
    category === null ? 'Indiquez la catégorie de la société.' : category !== needed ? `Réservé aux sociétés de catégorie ${SIZE_LABELS[needed].toLowerCase()}.` : null
  const group = details.groupMember === true ? "Exclu pour une société d'un groupe qui consolide ses comptes (C. com. art. L. 233-16)." : details.groupMember == null ? "Indiquez si la société appartient à un groupe qui consolide ses comptes." : null
  const excludedWhy = excluded ? 'Exclu pour les entités de l’article L. 123-16-2 du Code de commerce.' : null
  return [
    choice('none', 'Publication de tous les comptes', null),
    choice(
      'full',
      'Comptes annuels non publiés (micro-entreprise)',
      notCategory('micro') ?? excludedWhy ?? (context.company.isHolding ? 'Exclu pour une société dont l’activité consiste à gérer des titres de participations ou des valeurs mobilières.' : null),
    ),
    choice('income_statement', 'Compte de résultat non publié (petite entreprise)', notCategory('small') ?? excludedWhy ?? group),
    choice('simplified', 'Bilan et annexe publiés sous forme simplifiée (moyenne entreprise)', notCategory('medium') ?? excludedWhy ?? group),
  ]
}

/**
 * Sources cited once each: a form's own articles often also govern its
 * register or its filing (L223-31, L227-9), and a citation shown twice in
 * the same parenthesis reads as a mistake.
 */
function uniqueSources(sources: readonly LegalSource[]): LegalSource[] {
  const seen = new Set<string>()
  return sources.filter((s) => (seen.has(s.label) ? false : (seen.add(s.label), true)))
}

/** The pack of a fiscal year. */
export function buildApprovalPack(context: ApprovalContext, details: ApprovalDetails): ApprovalPack {
  const holderCount = context.holders.length
  const regime = approvalRegime(context.company.legalType, holderCount)
  const unsupported = regime ? null : unsupportedReason(context.company.legalType)
  const warnings: string[] = []

  const mode: DecisionMode | null = regime
    ? regime.sole
      ? 'sole'
      : details.decisionMode && regime.decisionModes.includes(details.decisionMode)
        ? details.decisionMode
        : defaultDecisionMode(regime)
    : null

  // Holders, attendance and votes (one vote per part or share).
  const attendance = new Map(details.attendance.map((a) => [a.shareholderId, a]))
  const holders = context.holders.map((h) => {
    const a = attendance.get(h.id)
    return { ...h, status: regime?.sole ? ('present' as const) : (a?.status ?? null), proxy: a?.proxy ?? null, votes: h.shares ?? 0 }
  })
  const sumShares = holders.reduce((s, h) => s + h.votes, 0)
  const totalVotes = context.totalShares && context.totalShares > 0 ? context.totalShares : sumShares
  const presentVotes = holders.filter((h) => h.status && ATTENDING.has(h.status)).reduce((s, h) => s + h.votes, 0)

  // Result and allocation, as Kledg books it (L232-10, L232-11).
  const plan = planAllocation(context.balances, details.allocation, { legalReserveRequired: legalReserveApplies(context.company.legalType) })
  const resultCents = context.balances.resultCents

  // Size category (L123-16, L230-1, D123-200).
  const employees = details.size.employees
  const proposal = proposeCategory(
    { totalAssetsCents: context.figures.totalAssetsCents, revenueCents: context.figures.revenueCents, employees },
    context.figures.previous ? { ...context.figures.previous, employees } : null,
  )
  const category = details.size.category

  // Management report (L232-1 IV; C. civ. 1856).
  let reportRequired: boolean | null = null
  let reportReason = ''
  let reportSources: LegalSource[] = []
  if (regime?.managementReport === 'always') {
    reportRequired = true
    reportReason = 'Les gérants rendent compte de leur gestion au moins une fois par an par un rapport écrit sur l’activité, les bénéfices et les pertes.'
    reportSources = [SOURCES.CIV_1856]
  } else if (regime) {
    reportSources = [SOURCES.L232_1, SOURCES.L230_1, SOURCES.L123_16_2]
    if (category === null) {
      reportReason = 'Indiquez la catégorie de la société : les micro et petites entreprises commerciales sont dispensées du rapport de gestion.'
    } else if ((category === 'micro' || category === 'small') && !details.excludedEntity && !context.company.isHolding) {
      reportRequired = false
      reportReason = `${SIZE_LABELS[category]} : la société est dispensée du rapport de gestion.`
    } else {
      reportRequired = true
      reportReason =
        category === 'micro' || category === 'small'
          ? 'La dispense ne s’applique pas aux sociétés dont l’activité consiste à gérer des titres de participations ou des valeurs mobilières, ni aux entités de l’article L. 123-16-2.'
          : `${SIZE_LABELS[category]} : le rapport de gestion est obligatoire.`
    }
  }
  const reportProduced = reportRequired === true || details.managementReport.produce

  // Resolutions and their outcome.
  const voteContext: VoteContext = {
    totalVotes,
    presentVotes,
    secondCall: details.meeting.secondCall,
    statutoryRule: details.statutoryRule ?? null,
  }
  const resolutionIds: ResolutionId[] = ['approval']
  if (regime?.regulatedAgreements && !(regime.sole && details.regulatedAgreements !== 'some')) resolutionIds.push('agreements')
  resolutionIds.push('allocation', 'powers')
  const RESOLUTION_TITLES: Record<ResolutionId, string> = {
    approval: 'Approbation des comptes annuels',
    agreements: 'Conventions réglementées',
    allocation: 'Affectation du résultat',
    powers: 'Pouvoirs pour les formalités',
  }
  const resolutions: PackResolution[] = regime
    ? resolutionIds.map((id) => ({ id, title: RESOLUTION_TITLES[id], outcome: voteOutcome(regime, voteContext, details.votes[id]) }))
    : []

  // Deadlines (shared with the calendar, lib/deadlines/engine.ts).
  const end = context.fiscalYear.endDate
  const approvalDeadline = regime?.sixMonthDeadline ? approvalDeadlineOf(end) : null
  const online = details.filedOnline ?? context.company.accountsFiledOnline
  const filingBase = details.approvedOn ?? (regime?.filing.required ? approvalDeadlineOf(end) : null)
  const filing = regime?.filing.required && filingBase ? filingDeadlineOf(filingBase, online) : null
  const meetingDate = details.meeting.date ?? null
  const convocation = regime?.convocation?.minDays && meetingDate && mode !== 'sole' ? addIsoDays(meetingDate, -regime.convocation.minDays) : null
  const approvalNote = !regime
    ? ''
    : regime.sixMonthDeadline
      ? `Six mois après la clôture, sauf prolongation accordée par ordonnance du président du tribunal de commerce saisi avant l’échéance.`
      : regime.form === 'SAS'
        ? 'Le Code de commerce ne fixe pas de délai pour une SAS pluripersonnelle : celui des statuts s’applique, six mois le plus souvent.'
        : 'Au moins une fois par an, dans les conditions des statuts (C. civ. art. 1856).'

  // Documents and what each misses.
  const missingCommon: string[] = []
  if (!context.company.address) missingCommon.push('Adresse du siège (informations de la société)')
  if (!details.rcsCity) missingCommon.push('Ville du greffe (RCS) où la société est immatriculée')
  if (context.company.shareCapitalCents === null) missingCommon.push('Capital social (informations de la société)')
  const officers = details.officers.filter((o) => o.name)
  const missingOfficers = officers.length === 0 ? [`Nom du ${regime?.officerTitle.singular ?? 'dirigeant'}`] : []
  const missingHolders: string[] = []
  if (holderCount === 0) missingHolders.push('Associés de la société (informations de la société, rubrique associés)')
  else if (holders.some((h) => h.shares === null || h.shares <= 0)) missingHolders.push('Nombre de titres de chaque associé (informations de la société)')
  const soleHolder = regime?.sole ? holders[0] : undefined
  const missingSole = soleHolder?.kind === 'LEGAL' && !soleHolder.proxy ? ['Représentant de l’associé unique (personne morale)'] : []

  const priorDividendsRequired = regime ? isSubjectToCorporateTax(context, regime) : false
  const missingDecision: string[] = [...missingCommon, ...missingOfficers, ...missingHolders, ...missingSole]
  if (!meetingDate) missingDecision.push(mode === 'sole' ? 'Date de la décision' : mode === 'written' ? 'Date de clôture de la consultation' : "Date de l'assemblée")
  if (mode === 'meeting' && !details.meeting.place) missingDecision.push("Lieu de l'assemblée")
  if (mode === 'meeting' && !details.chair?.name) missingDecision.push('Président de séance')
  if (!details.signatureCity) missingDecision.push('Ville de signature')
  if (mode === 'written' && !details.meeting.convocationDate) missingDecision.push('Date d’envoi de la consultation')
  if (mode !== 'sole' && regime && holders.some((h) => h.status === null)) missingDecision.push('Présence de chaque associé')
  if (regime?.majority === 'statutes' && regime.form === 'SAS' && !details.statutoryRule) missingDecision.push('Règle de majorité des statuts')
  if (regime && mode !== 'sole') {
    for (const r of resolutions) {
      if (r.outcome.adopted === null && r.outcome.quorumMet !== false) missingDecision.push(`Résultat du vote : ${r.title.toLowerCase()}`)
    }
  }
  if (plan.errors.length > 0 && resultCents !== 0) missingDecision.push(`Affectation du résultat : ${plan.errors.join(' ')}`)
  if (resultCents === 0) missingDecision.push("Résultat de l'exercice : aucun résultat dans les écritures validées (comptes 6, 7, 120 et 129 soldés)")
  if (priorDividendsRequired && details.priorDividends == null) missingDecision.push('Dividendes des trois exercices précédents (CGI art. 243 bis)')
  if (regime?.regulatedAgreements && details.regulatedAgreements == null) missingDecision.push('Conventions réglementées conclues ou non au cours de l’exercice')

  const missingConvocation = [...missingCommon, ...missingOfficers, ...missingHolders]
  if (!meetingDate) missingConvocation.push(mode === 'written' ? 'Date limite de réponse' : "Date de l'assemblée")
  if (mode === 'meeting' && !details.meeting.time) missingConvocation.push("Heure de l'assemblée")
  if (mode === 'meeting' && !details.meeting.place) missingConvocation.push("Lieu de l'assemblée")
  if (!details.meeting.convocationDate) missingConvocation.push('Date d’envoi de la convocation')
  if (!details.signatureCity) missingConvocation.push('Ville de signature')

  const missingAttendance = [...missingCommon, ...missingHolders]
  if (!meetingDate) missingAttendance.push("Date de l'assemblée")
  if (!details.meeting.place) missingAttendance.push("Lieu de l'assemblée")
  if (holders.some((h) => h.status === null)) missingAttendance.push('Présence de chaque associé')

  const missingReport = [...missingCommon, ...missingOfficers]
  if (!details.managementReport.activity) missingReport.push('Activité et situation de la société pendant l’exercice')
  if (!details.managementReport.outlook) missingReport.push('Évolution prévisible et perspectives')
  if (regime && regime.form !== 'SCI') {
    // L232-1 II: events after the closing and research and development are mentioned, "Aucun" when there are none.
    if (!details.managementReport.postClosingEvents) missingReport.push('Événements importants depuis la clôture (écrivez « Aucun » s’il n’y en a pas)')
    if (!details.managementReport.research) missingReport.push('Activités de recherche et de développement (écrivez « Aucune » s’il n’y en a pas)')
  }
  if (!details.signatureCity) missingReport.push('Ville de signature')
  if (plan.errors.length > 0 && resultCents !== 0) missingReport.push(`Affectation du résultat : ${plan.errors.join(' ')}`)
  if (priorDividendsRequired && details.priorDividends == null) missingReport.push('Dividendes des trois exercices précédents (CGI art. 243 bis)')

  const choices = regime ? confidentialityChoices(category, details, context) : []
  const chosen = details.confidentiality
  const chosenChoice = choices.find((c) => c.value === chosen)
  const missingConfidentiality = [...missingCommon, ...missingOfficers]
  if (chosenChoice && !chosenChoice.available && chosenChoice.reason) missingConfidentiality.push(chosenChoice.reason)
  if (!details.signatureCity) missingConfidentiality.push('Ville de signature')

  const documents: PackDocument[] = []
  if (regime) {
    if (mode !== 'sole' && regime.convocation) {
      documents.push({
        id: 'convocation',
        title: mode === 'written' ? 'Lettre de consultation écrite des associés' : "Convocation à l'assemblée générale",
        required: true,
        reason: regime.convocation.how,
        sources: regime.convocation.sources,
        missing: missingConvocation,
      })
    }
    if (reportProduced) {
      documents.push({
        id: 'management-report',
        title: regime.form === 'SCI' ? 'Rapport écrit de la gérance' : 'Rapport de gestion',
        required: reportRequired === true,
        reason: reportRequired === true ? reportReason : 'Établi à votre demande : la société en est dispensée.',
        sources: reportSources,
        missing: missingReport,
      })
    }
    documents.push({
      id: 'decision',
      title: decisionTitle(regime, mode as DecisionMode),
      required: true,
      reason: regime.sole
        ? `L’associé unique approuve les comptes et décide de l’affectation du résultat ; la décision est consignée au registre. ${regime.register.text}`
        : `Les associés approuvent les comptes et décident de l’affectation du résultat. ${regime.register.text}`,
      sources: uniqueSources([...regime.sources, ...regime.register.sources]),
      missing: missingDecision,
    })
    if (mode === 'meeting' && regime.attendanceSheet !== 'none') {
      documents.push({
        id: 'attendance',
        title: 'Feuille de présence',
        required: regime.attendanceSheet === 'required',
        reason:
          regime.attendanceSheet === 'required'
            ? 'Une feuille de présence est tenue à chaque assemblée d’actionnaires.'
            : 'Elle établit le quorum et la majorité ; utile même quand la loi ne l’impose pas.',
        sources: regime.attendanceSheet === 'required' ? [SOURCES.R225_95] : [],
        missing: missingAttendance,
      })
    }
    if (regime.filing.required && chosen !== 'none') {
      documents.push({
        id: 'confidentiality',
        title: chosen === 'simplified' ? 'Déclaration de publication simplifiée' : 'Déclaration de confidentialité des comptes annuels',
        required: true,
        reason: 'Jointe au dépôt des comptes pour demander que les comptes, ou une partie, ne soient pas rendus publics.',
        sources: [SOURCES.L232_25, SOURCES.R123_111_1],
        missing: missingConfidentiality,
      })
    }
    if (regime.filing.required) {
      documents.push({
        id: 'filing-checklist',
        title: 'Liste du dépôt des comptes au greffe',
        required: false,
        reason: 'Les pièces à déposer, le délai et le canal de dépôt.',
        sources: regime.filing.sources,
        missing: [],
      })
    }
  }

  // Filing checklist (L232-22, L232-23, L232-25).
  const items: ChecklistItem[] = []
  const notes: string[] = []
  if (regime?.filing.required) {
    items.push({
      text:
        chosen === 'full'
          ? 'Comptes annuels (bilan, compte de résultat et, si elle est établie, annexe), accompagnés de la déclaration de confidentialité : ils ne seront pas rendus publics.'
          : category === 'micro'
            ? 'Comptes annuels : bilan et compte de résultat (une micro-entreprise peut ne pas établir d’annexe).'
            : 'Comptes annuels : bilan, compte de résultat et annexe.',
      sources: [regime.filing.sources[0], ...(category === 'micro' ? [SOURCES.L123_16_1] : [])],
    })
    items.push({ text: "Proposition d'affectation du résultat et décision d'affectation votée (procès-verbal ou décision de l'associé unique, ou un extrait).", sources: regime.filing.sources })
    if (details.hasAuditor) items.push({ text: 'Rapport du commissaire aux comptes sur les comptes annuels.', sources: regime.filing.sources })
    if (chosen !== 'none') items.push({ text: chosen === 'simplified' ? 'Déclaration de publication simplifiée.' : 'Déclaration de confidentialité.', sources: [SOURCES.L232_25, SOURCES.R123_111_1] })
    items.push({
      text: "En cas de refus d'approbation : une copie de la délibération, dans le même délai.",
      sources: regime.filing.sources,
    })
    notes.push(
      online
        ? `Délai : deux mois après l'approbation pour un dépôt en ligne${filing ? `, soit le ${longDate(filing)} au plus tard` : ''}.`
        : `Délai : un mois après l'approbation (deux mois en cas de dépôt en ligne)${filing ? `, soit le ${longDate(filing)} au plus tard` : ''}.`,
      "Dépôt sur le guichet unique des formalités des entreprises (formalites.entreprises.gouv.fr). Des frais de greffe s'appliquent : vérifiez le montant au paiement.",
      "Le rapport de gestion n'est pas déposé : il est tenu à la disposition de toute personne qui en fait la demande.",
      "Un défaut de dépôt est puni de l'amende des contraventions de la cinquième classe (C. com. art. R. 247-3) et peut donner lieu à une injonction sous astreinte (art. L. 123-5-1).",
    )
    if (regime.filingWorthApproval) notes.push(regime.filingWorthApproval.condition)
  } else if (regime) {
    notes.push(
      "Une société civile ne dépose pas ses comptes au greffe : le procès-verbal et le rapport de la gérance sont conservés au registre de la société. Une société civile qui dépasse les seuils lui imposant un commissaire aux comptes peut avoir d'autres obligations : vérifiez avec votre conseil.",
    )
  }

  // Warnings.
  if (!context.fiscalYear.isClosed) warnings.push("L'exercice n'est pas clôturé : le résultat peut encore changer. Clôturez-le avant de faire approuver les comptes.")
  if (context.draftEntries > 0) warnings.push(
      context.draftEntries > 1
        ? `${context.draftEntries} écritures en brouillon sur l'exercice ne sont pas comptées dans le résultat.`
        : "1 écriture en brouillon sur l'exercice n'est pas comptée dans le résultat.",
    )
  if (regime && (context.company.legalType === 'EURL' || context.company.legalType === 'SASU') && holderCount > 1) {
    warnings.push(`La société est une ${context.company.legalType} mais ${holderCount} associés sont enregistrés : vérifiez la forme juridique ou la liste des associés.`)
  }
  if (regime?.sole && context.company.legalType !== 'EURL' && context.company.legalType !== 'SASU') {
    warnings.push(`Un seul associé est enregistré : les règles de l'associé unique (${regime.form}) s'appliquent.`)
  }
  if (approvalDeadline && meetingDate && meetingDate > approvalDeadline) {
    warnings.push(
      `La date de la décision (${longDate(meetingDate)}) dépasse le délai de six mois (${longDate(approvalDeadline)}) : demandez une prolongation au président du tribunal de commerce avant l'échéance.`,
    )
  }
  if (convocation && details.meeting.convocationDate && details.meeting.convocationDate > convocation) {
    warnings.push(`La convocation du ${longDate(details.meeting.convocationDate)} arrive moins de ${regime?.convocation?.minDays} jours avant l'assemblée : envoyez-la au plus tard le ${longDate(convocation)}.`)
  }
  if (regime?.form === 'SARL' && holders.some((h) => h.status === 'remote')) {
    warnings.push("Dans une SARL, les associés qui participent à distance ne sont pas comptés pour l'approbation des comptes (C. com. art. L. 223-27) : ne comptez pas leurs voix sur cette résolution.")
  }
  if (meetingDate && meetingDate <= context.fiscalYear.endDate) warnings.push("La date de la décision doit être postérieure à la clôture de l'exercice.")
  if (details.filedOn && details.approvedOn && details.filedOn < details.approvedOn) warnings.push("La date de dépôt précède la date d'approbation.")
  if (filing && !details.filedOn && context.today > filing) warnings.push(`Le délai de dépôt au greffe est dépassé depuis le ${longDate(filing)}.`)
  if (approvalDeadline && !details.approvedOn && context.today > approvalDeadline) warnings.push(`Le délai d'approbation est dépassé depuis le ${longDate(approvalDeadline)}.`)
  const approval = resolutions.find((r) => r.id === 'approval')
  if (approval?.outcome.adopted === false) warnings.push("Les comptes ne sont pas approuvés : la délibération de refus est à déposer au greffe dans le même délai.")
  if (reportProduced && details.hasAuditor && regime?.form !== 'SCI') {
    warnings.push("Le rapport de gestion d'une société dont les comptes sont certifiés indique les délais de paiement des fournisseurs et des clients (C. com. art. L. 441-14 et D. 441-6) : ajoutez ce tableau, Kledg ne le génère pas encore.")
  }
  if (regime?.form === 'SA') warnings.push("Une SA établit aussi le rapport sur le gouvernement d'entreprise (C. com. art. L. 225-37), que Kledg ne génère pas.")
  if (category && proposal.category !== category) {
    warnings.push(`Les chiffres de Kledg suggèrent la catégorie ${SIZE_LABELS[proposal.category].toLowerCase()} : vérifiez la catégorie retenue (deux exercices consécutifs).`)
  }

  return {
    regime,
    unsupported,
    decisionMode: mode,
    decisionTitle: regime && mode ? decisionTitle(regime, mode) : null,
    holders,
    totalVotes,
    presentVotes,
    plan,
    resultCents,
    priorDividendsRequired,
    size: { proposed: proposal.category, certain: proposal.certain, confirmed: category, label: category ? SIZE_LABELS[category] : null },
    managementReport: { required: reportRequired, produced: reportProduced, reason: reportReason, sources: reportSources },
    confidentiality: { choices, chosen },
    resolutions,
    deadlines: {
      approval: approvalDeadline,
      approvalNote,
      convocation,
      filing,
      filingBasis: filing ? (details.approvedOn ? 'approval' : 'deadline') : null,
      sources: regime ? uniqueSources([...regime.sources, ...regime.filing.sources]) : [],
    },
    documents,
    publication: { required: Boolean(regime?.filing.required), items, notes },
    warnings,
  }
}
