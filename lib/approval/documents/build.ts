/**
 * The documents of the approval pack, written from the pack (pack.ts), the
 * books and what the user entered. Pure. A builder is only called once the
 * pack lists nothing missing for its document (export-approval-document.service.tsx),
 * so every value written here comes from Kledg or from the user.
 *
 * Legal content per document (sources in sources.ts and in the pack):
 * - convocation: agenda, date, time and place; SARL documents sent fifteen
 *   days before and inventory at the head office (R223-18, R223-20); SA
 *   fifteen days (R225-69); SCI fifteen days (décret n° 78-704, art. 40-41);
 *   SAS per statuts (L227-9);
 * - minutes or decision of the associé unique: date, place, holders present
 *   or represented, documents presented, text of the resolutions and the
 *   result of each vote (R223-24 for SARL, R225-106 for SA); for a sole
 *   partner, recorded in the register (L223-31, L227-9). No "quitus"
 *   resolution: no decision of the associés can extinguish a liability
 *   action against the officers (L223-22, L225-253), so it would mislead;
 * - management report: activity, foreseeable evolution, events after the
 *   closing, research and development (L232-1 II), allocation and the
 *   dividends of the three previous years (CGI art. 243 bis);
 * - confidentiality declaration (L232-25, R123-111-1).
 */

import type { AllocationPlan } from '@/lib/accounting/result-allocation/compute'
import { accountsPreparedBy, type ApprovalRegime } from '../legal-regime'
import { longDate, type ApprovalContext, type ApprovalPack, type DocumentId } from '../pack'
import type { ApprovalDetails, ResolutionId } from '../schemas'
import { majorityRuleText, count } from '../votes'
import { eur, type Block, type GeneratedDocument } from './model'

/** "a, b et c". */
const joinFr = (items: string[]) => (items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}`)

/** "à Lyon", "au siège social", "chez Maître X": the place as the user wrote it, with "à" only when it has no preposition. */
const atPlace = (place: string) => (/^(à|au|aux|chez|en|dans|par)\s/i.test(place) ? place : `à ${place}`)

const lower = (s: string) => `${s.charAt(0).toLowerCase()}${s.slice(1)}`

const ORDINALS = ['Première', 'Deuxième', 'Troisième', 'Quatrième', 'Cinquième', 'Sixième']

interface Input {
  context: ApprovalContext
  details: ApprovalDetails
  pack: ApprovalPack
}

function regimeOf(pack: ApprovalPack): ApprovalRegime {
  if (!pack.regime) throw new Error('No approval regime')
  return pack.regime
}

const fileSafe = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '') || 'societe'

function companyHeader({ context, details, pack }: Input): string[] {
  const regime = regimeOf(pack)
  const c = context.company
  return [
    c.name,
    `${regime.formLabel} au capital de ${eur(c.shareCapitalCents ?? 0)}`,
    `Siège social : ${c.address ?? ''}`,
    `${c.siren.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3')} RCS ${details.rcsCity ?? ''}`,
  ]
}

const shareWords = (regime: ApprovalRegime, n: number) =>
  regime.form === 'SA' || regime.form === 'SAS' || regime.form === 'SASU' ? (n > 1 ? 'actions' : 'action') : n > 1 ? 'parts sociales' : 'part sociale'

const endLabel = (context: ApprovalContext) => `l'exercice clos le ${longDate(context.fiscalYear.endDate)}`

function officerList(details: ApprovalDetails, regime: ApprovalRegime) {
  return details.officers
    .filter((o) => o.name)
    .map((o) => ({ name: o.name as string, role: o.title ?? regime.officerTitle.singular }))
}

/** Who speaks in the resolutions. */
function subjectOf(regime: ApprovalRegime, mode: ApprovalPack['decisionMode']): string {
  if (mode === 'sole') return "L'associé unique"
  if (mode === 'written') return 'Les associés'
  if (regime.form === 'SAS') return 'La collectivité des associés'
  return "L'assemblée générale"
}

/**
 * The allocation of the result: decided (`subject` decides) in the minutes,
 * proposed (`subject` null: "Nous vous proposons") in the management report.
 */
function allocationParagraphs(plan: AllocationPlan, input: Input, subject: string | null): Block[] {
  const { context, details, pack } = input
  const decides = (rest: string) => (subject ? `${subject} décide ${rest}` : `Nous vous proposons ${rest}`)
  const notes = (rest: string) => (subject ? `${lower(subject)} prend acte ${rest}` : `nous vous rappelons ${rest}`)
  const regime = regimeOf(pack)
  const blocks: Block[] = []
  const balances = context.balances
  if (plan.resultCents > 0) {
    blocks.push({ kind: 'paragraph', text: decides(`d'affecter le bénéfice de l'exercice, qui s'élève à ${eur(plan.resultCents)}, de la manière suivante :`) })
    const items: string[] = []
    if (plan.legalReserveCents > 0) items.push(`à la réserve légale : ${eur(plan.legalReserveCents)}`)
    if (plan.otherReservesCents > 0) items.push(`aux autres réserves : ${eur(plan.otherReservesCents)}`)
    const to = regime.sole ? "à l'associé unique" : `aux ${regime.holderWord.plural}`
    if (plan.dividendsCents > 0) items.push(`${regime.form === 'SCI' ? to : `${to}, à titre de dividendes`} : ${eur(plan.dividendsCents)}`)
    if (plan.priorLossesClearedCents > 0) items.push(`à l'apurement du report à nouveau débiteur : ${eur(plan.priorLossesClearedCents)}`)
    if (plan.retainedEarningsCents > 0) items.push(`au compte report à nouveau : ${eur(plan.retainedEarningsCents)}`)
    blocks.push({ kind: 'list', items })
    if (plan.retainedEarningsCents < 0) {
      blocks.push({ kind: 'paragraph', text: `Les dividendes sont prélevés, à hauteur de ${eur(-plan.retainedEarningsCents)}, sur le compte report à nouveau antérieur.` })
    }
    if (plan.legalReserveRequired) {
      if (plan.legalReserveCents > 0) {
        blocks.push({ kind: 'paragraph', text: "La dotation à la réserve légale représente le vingtième du bénéfice diminué, le cas échéant, des pertes antérieures (C. com. art. L. 232-10)." })
      } else if (balances.capitalCents > 0 && balances.legalReserveCents * 10 >= balances.capitalCents) {
        blocks.push({ kind: 'paragraph', text: 'La réserve légale ayant atteint le dixième du capital social, aucune dotation n’est requise (C. com. art. L. 232-10).' })
      } else if (plan.resultCents <= balances.priorLossesCents) {
        blocks.push({ kind: 'paragraph', text: 'Le bénéfice étant absorbé par les pertes antérieures, aucune dotation à la réserve légale n’est requise (C. com. art. L. 232-10).' })
      }
    }
    if (plan.dividendsCents > 0 && regime.form !== 'SCI') {
      blocks.push({ kind: 'paragraph', text: "Les dividendes sont mis en paiement dans un délai maximal de neuf mois après la clôture de l'exercice (C. com. art. L. 232-13)." })
    }
  } else if (plan.resultCents < 0) {
    const after = balances.retainedEarningsCents - balances.priorLossesCents + plan.resultCents
    blocks.push({
      kind: 'paragraph',
      text: decides(`d'affecter la perte de l'exercice, qui s'élève à ${eur(-plan.resultCents)}, au compte report à nouveau, dont le solde ${after < 0 ? 'débiteur' : 'créditeur'} est ainsi porté à ${eur(Math.abs(after))}.`),
    })
  }
  if (pack.priorDividendsRequired && details.priorDividends) {
    const paid = details.priorDividends.filter((d) => d.amountCents > 0)
    if (paid.length === 0) {
      blocks.push({ kind: 'paragraph', text: `Conformément à l'article 243 bis du Code général des impôts, ${notes("qu'aucun dividende n'a été distribué au titre des trois exercices précédents.")}` })
    } else {
      blocks.push({
        kind: 'paragraph',
        text: `Conformément à l'article 243 bis du Code général des impôts, ${notes('que les dividendes distribués au titre des trois exercices précédents ont été les suivants :')}`,
      })
      blocks.push({
        kind: 'list',
        items: [...details.priorDividends].sort((a, b) => b.year - a.year).map((d) => `exercice ${d.year} : ${d.amountCents > 0 ? eur(d.amountCents) : 'aucun dividende'}`),
      })
    }
  }
  return blocks
}

function resolutionBlocks(id: ResolutionId, input: Input, subject: string): Block[] {
  const { context, details, pack } = input
  const regime = regimeOf(pack)
  const result = pack.resultCents
  const documents: string[] = []
  if (pack.managementReport.produced) documents.push(regime.form === 'SCI' ? 'du rapport écrit de la gérance' : 'du rapport de gestion')
  if (details.hasAuditor) documents.push('du rapport du commissaire aux comptes')
  documents.push(`des comptes annuels de ${endLabel(context)}`)
  switch (id) {
    case 'approval': {
      const blocks: Block[] = [
        {
          kind: 'paragraph',
          text: `${subject}, après avoir pris connaissance ${joinFr(documents)}, approuve ces comptes tels qu'ils ont été arrêtés par ${accountsPreparedBy(regime)} et présentés, ainsi que les opérations traduites dans ces comptes${pack.managementReport.produced ? ' ou résumées dans ce rapport' : ''}. Ces comptes font apparaître ${result >= 0 ? 'un bénéfice' : 'une perte'} de ${eur(Math.abs(result))}.`,
        },
      ]
      const nd = details.nonDeductibleExpensesCents
      if (pack.priorDividendsRequired && nd != null) {
        blocks.push({
          kind: 'paragraph',
          text:
            nd > 0
              ? `En application de l'article 223 quater du Code général des impôts, ${lower(subject)} approuve le montant global des dépenses et charges visées à l'article 39, 4 de ce code, soit ${eur(nd)}.`
              : `${subject} prend acte qu'aucune dépense ni charge visée à l'article 39, 4 du Code général des impôts n'a été engagée au cours de l'exercice.`,
        })
      }
      return blocks
    }
    case 'agreements': {
      const article = regime.regulatedAgreements?.article ?? ''
      if (regime.sole) {
        return [
          {
            kind: 'paragraph',
            text: `${subject} prend acte des conventions intervenues au cours de l'exercice, directement ou par personne interposée, entre la société et son ${regime.officerTitle.singular}, qui sont mentionnées au registre des décisions (C. com. art. ${article}).`,
          },
        ]
      }
      if (details.regulatedAgreements === 'none') {
        return [
          {
            kind: 'paragraph',
            text: `${subject}, après avoir pris connaissance du rapport sur les conventions visées à l'article ${article} du Code de commerce, prend acte qu'aucune convention de cette nature n'a été conclue au cours de l'exercice.`,
          },
        ]
      }
      const excluded = regime.form === 'SARL' || regime.form === 'SA'
      return [
        {
          kind: 'paragraph',
          text: `${subject}, après avoir pris connaissance du rapport sur les conventions visées à l'article ${article} du Code de commerce, approuve chacune des conventions qui y sont mentionnées.${excluded ? ` Les ${regime.holderWord.plural} intéressés n'ont pas pris part au vote et leurs voix n'ont pas été prises en compte pour le calcul de la majorité.` : ''}`,
        },
      ]
    }
    case 'allocation':
      return allocationParagraphs(pack.plan, input, subject)
    case 'powers':
      return [
        {
          kind: 'paragraph',
          text: `${subject} confère tous pouvoirs au porteur d'un original, d'une copie ou d'un extrait ${regime.sole ? 'de la présente décision' : 'du présent procès-verbal'} pour accomplir les formalités de dépôt et de publicité prévues par la loi.`,
        },
      ]
  }
}

function resolutionsSection(input: Input, withOutcome: boolean): Block[] {
  const { pack } = input
  const regime = regimeOf(pack)
  const subject = subjectOf(regime, pack.decisionMode)
  const word = regime.sole ? 'décision' : 'résolution'
  const blocks: Block[] = []
  pack.resolutions.forEach((r, i) => {
    blocks.push({ kind: 'heading', text: `${ORDINALS[i] ?? `${i + 1}e`} ${word} : ${r.title.toLowerCase()}` })
    blocks.push(...resolutionBlocks(r.id, input, subject))
    if (withOutcome && r.outcome.wording && !regime.sole) blocks.push({ kind: 'paragraph', text: r.outcome.wording })
  })
  return blocks
}

const agenda = (pack: ApprovalPack, details: ApprovalDetails): string[] => {
  const items: string[] = []
  if (pack.managementReport.produced) items.push(pack.regime?.form === 'SCI' ? 'Lecture du rapport écrit de la gérance' : 'Lecture du rapport de gestion')
  if (details.hasAuditor) items.push('Lecture du rapport du commissaire aux comptes sur les comptes annuels')
  return [...items, ...pack.resolutions.map((r) => r.title)]
}

function holdersTable(input: Input, withSignature: boolean): Block {
  const { pack } = input
  const regime = regimeOf(pack)
  const status = (s: string | null, proxy: string | null) =>
    s === 'present' ? 'Présent' : s === 'represented' ? `Représenté${proxy ? ` par ${proxy}` : ''}` : s === 'remote' ? 'À distance' : 'Absent'
  const rows = pack.holders.map((h) => [h.name, count(h.votes), status(h.status, h.proxy), ...(withSignature ? [''] : [])])
  rows.push(['Total présents ou représentés', count(pack.presentVotes), `sur ${count(pack.totalVotes)}`, ...(withSignature ? [''] : [])])
  return {
    kind: 'table',
    columns: [regime.holderWord.singular.replace(/^./, (c) => c.toUpperCase()), regime.form === 'SA' ? 'Actions' : regime.form === 'SAS' ? 'Actions' : 'Parts', 'Présence', ...(withSignature ? ['Signature'] : [])],
    rows,
    numeric: [1],
  }
}

function decisionDocument(input: Input): GeneratedDocument {
  const { context, details, pack } = input
  const regime = regimeOf(pack)
  const date = details.meeting.date as string
  const officers = officerList(details, regime)
  const blocks: Block[] = []

  if (pack.decisionMode === 'sole') {
    const holder = pack.holders[0]
    const name = holder.kind === 'LEGAL' ? `${holder.name}, représentée par ${holder.proxy}` : holder.name
    const docs: string[] = []
    if (pack.managementReport.produced) docs.push('du rapport de gestion')
    if (details.hasAuditor) docs.push('du rapport du commissaire aux comptes')
    docs.push(`des comptes annuels de ${endLabel(context)} arrêtés par ${accountsPreparedBy(regime)}`)
    blocks.push({
      kind: 'paragraph',
      text: `Le ${longDate(date)}, ${name}, associé unique de la société, détenant la totalité des ${count(pack.totalVotes)} ${shareWords(regime, pack.totalVotes)} composant le capital social, après avoir pris connaissance ${joinFr(docs)}, a pris les décisions suivantes.`,
    })
    blocks.push(...resolutionsSection(input, false))
    blocks.push({
      kind: 'paragraph',
      text: `De tout ce qui précède, il a été dressé la présente décision, consignée au registre des décisions de l'associé unique.`,
    })
    blocks.push({ kind: 'signatures', place: details.signatureCity, date: longDate(date), signers: [{ name: holder.kind === 'LEGAL' ? `${holder.name}, représentée par ${holder.proxy}` : holder.name, role: 'associé unique' }] })
    return {
      header: companyHeader(input),
      title: `Décision de l'associé unique du ${longDate(date)}`,
      subtitle: `Approbation des comptes de ${endLabel(context)}`,
      blocks,
      footer: `${context.company.name}, décision de l'associé unique du ${longDate(date)}`,
      fileName: `Decision_associe_unique_${fileSafe(context.company.name)}_${context.fiscalYear.year}`,
    }
  }

  const present = pack.holders.filter((h) => h.status && h.status !== 'absent')
  const holderPlural = regime.holderWord.plural
  if (pack.decisionMode === 'written') {
    blocks.push({
      kind: 'paragraph',
      text: `Le ${longDate(date)}, date limite de réponse, ${officers.map((o) => `${o.name}, ${o.role}`).join(' et ')} ${officers.length > 1 ? 'ont' : 'a'} constaté le résultat de la consultation écrite des ${holderPlural} adressée le ${details.meeting.convocationDate ? longDate(details.meeting.convocationDate) : ''}, prévue par les statuts.`,
    })
    blocks.push({ kind: 'paragraph', text: `${count(present.length)} ${present.length > 1 ? holderPlural : regime.holderWord.singular} détenant ${count(pack.presentVotes)} ${shareWords(regime, pack.presentVotes)} sur ${count(pack.totalVotes)} ont répondu.` })
  } else {
    const convocation = details.meeting.convocationDate ? ` adressée le ${longDate(details.meeting.convocationDate)}` : ''
    blocks.push({
      kind: 'paragraph',
      text: `Le ${longDate(date)}${details.meeting.time ? `, à ${details.meeting.time}` : ''}, les ${holderPlural} de la société se sont réunis en assemblée ${regime.form === 'SAS' ? 'des associés' : 'générale ordinaire annuelle'}, ${atPlace(details.meeting.place as string)}, sur convocation ${accountsPreparedBy(regime).replace(/^le /, 'du ').replace(/^la /, 'de la ')}${convocation}.`,
    })
    if (regime.attendanceSheet !== 'none') {
      blocks.push({ kind: 'paragraph', text: `Il a été établi une feuille de présence, émargée par les ${holderPlural} présents et les mandataires des ${holderPlural} représentés.` })
    }
    blocks.push({
      kind: 'paragraph',
      text: `L'assemblée est présidée par ${details.chair?.name}${details.chair?.title ? `, ${details.chair.title}` : ''}.${details.secretary ? ` ${details.secretary} est désigné comme secrétaire.` : ''}`,
    })
  }
  blocks.push(holdersTable(input, false))
  blocks.push({ kind: 'paragraph', text: majorityRuleText(regime, { secondCall: details.meeting.secondCall, statutoryRule: details.statutoryRule ?? null }) })
  const quorum = pack.resolutions[0]?.outcome.quorumMet
  if (regime.form === 'SA' && quorum !== null && quorum !== undefined) {
    blocks.push({
      kind: 'paragraph',
      text: quorum
        ? `Les actionnaires présents ou représentés possèdent ${count(pack.presentVotes)} actions sur les ${count(pack.totalVotes)} actions ayant le droit de vote : le quorum est atteint et l'assemblée peut valablement délibérer.`
        : `Les actionnaires présents ou représentés ne possèdent que ${count(pack.presentVotes)} actions sur les ${count(pack.totalVotes)} actions ayant le droit de vote : le quorum n'est pas atteint.`,
    })
  }
  if (pack.decisionMode === 'meeting') {
    blocks.push({ kind: 'paragraph', text: "Le président de séance rappelle l'ordre du jour :" })
    blocks.push({ kind: 'list', items: agenda(pack, details) })
    const docs = ['les comptes annuels']
    if (pack.managementReport.produced) docs.push(regime.form === 'SCI' ? 'le rapport écrit de la gérance' : 'le rapport de gestion')
    if (details.hasAuditor) docs.push('le rapport du commissaire aux comptes')
    docs.push('le texte des projets de résolutions')
    blocks.push({
      kind: 'paragraph',
      text: `Le président de séance met à la disposition de l'assemblée ${joinFr(docs)}. Il rappelle que ces documents ont été adressés aux ${holderPlural} et tenus à leur disposition dans les conditions prévues par la loi et les statuts. Puis la discussion est ouverte ; personne ne demandant plus la parole, il met successivement aux voix les résolutions suivantes.`,
    })
  }
  blocks.push(...resolutionsSection(input, true))
  blocks.push({
    kind: 'paragraph',
    text:
      pack.decisionMode === 'meeting'
        ? "L'ordre du jour étant épuisé, la séance est levée. De tout ce qui précède, il a été dressé le présent procès-verbal, signé après lecture."
        : 'De tout ce qui précède, il a été dressé le présent procès-verbal.',
  })
  const signers =
    pack.decisionMode === 'meeting'
      ? [
          { name: details.chair?.name as string, role: 'président de séance' },
          ...(details.secretary ? [{ name: details.secretary, role: 'secrétaire' }] : []),
          ...officers.filter((o) => o.name !== details.chair?.name),
        ]
      : officers
  blocks.push({ kind: 'signatures', place: details.signatureCity, date: longDate(date), signers })
  return {
    header: companyHeader(input),
    title: pack.decisionTitle ?? '',
    subtitle: `Du ${longDate(date)}, approbation des comptes de ${endLabel(context)}`,
    blocks,
    footer: `${context.company.name}, ${(pack.decisionTitle ?? '').toLowerCase()} du ${longDate(date)}`,
    fileName: `Proces_verbal_${fileSafe(context.company.name)}_${context.fiscalYear.year}`,
  }
}

function convocationDocument(input: Input): GeneratedDocument {
  const { context, details, pack } = input
  const regime = regimeOf(pack)
  const date = details.meeting.date as string
  const officers = officerList(details, regime)
  const blocks: Block[] = []
  blocks.push({ kind: 'paragraph', text: `Destinataires : ${pack.holders.map((h) => h.name).join(', ')}.` })
  blocks.push({ kind: 'paragraph', text: 'Madame, Monsieur,' })
  const enclosed = [`les comptes annuels de ${endLabel(context)}`]
  if (pack.managementReport.produced) enclosed.push(regime.form === 'SCI' ? 'le rapport écrit de la gérance' : 'le rapport de gestion')
  if (details.hasAuditor) enclosed.push('le rapport du commissaire aux comptes')
  enclosed.push('le texte des projets de résolutions')
  if (pack.decisionMode === 'written') {
    blocks.push({
      kind: 'paragraph',
      text: `Conformément aux statuts, nous vous consultons par écrit sur les résolutions dont le texte figure ci-après. Nous vous remercions de nous adresser votre vote, en indiquant pour chaque résolution « pour », « contre » ou « abstention », au plus tard le ${longDate(date)}.`,
    })
  } else {
    blocks.push({
      kind: 'paragraph',
      text: `Nous avons l'honneur de vous convoquer à l'assemblée ${regime.form === 'SAS' ? 'des associés' : 'générale ordinaire annuelle'} de la société, qui se tiendra le ${longDate(date)} à ${details.meeting.time}, ${atPlace(details.meeting.place as string)}, à l'effet de délibérer sur l'ordre du jour suivant :`,
    })
    blocks.push({ kind: 'list', items: agenda(pack, details) })
  }
  blocks.push({ kind: 'paragraph', text: `Vous trouverez joints à la présente ${joinFr(enclosed)}.` })
  if (regime.form === 'SARL') {
    blocks.push({ kind: 'paragraph', text: "L'inventaire est tenu à votre disposition au siège social pendant les quinze jours qui précèdent l'assemblée (C. com. art. R. 223-18)." })
  }
  if (pack.decisionMode !== 'written') {
    blocks.push({ kind: 'paragraph', text: "Si vous ne pouvez assister à l'assemblée, vous pouvez vous y faire représenter dans les conditions prévues par la loi et les statuts." })
  }
  blocks.push({ kind: 'paragraph', text: 'Nous vous prions d’agréer, Madame, Monsieur, l’expression de nos salutations distinguées.' })
  blocks.push({ kind: 'signatures', place: details.signatureCity, date: details.meeting.convocationDate ? longDate(details.meeting.convocationDate) : null, signers: officers })
  blocks.push({ kind: 'heading', text: 'Projets de résolutions' })
  blocks.push(...resolutionsSection(input, false))
  blocks.push({ kind: 'note', text: `Envoi : ${regime.convocation?.how ?? ''}` })
  return {
    header: companyHeader(input),
    title: pack.decisionMode === 'written' ? 'Consultation écrite des associés' : "Convocation à l'assemblée générale ordinaire annuelle",
    subtitle: `Approbation des comptes de ${endLabel(context)}`,
    blocks,
    footer: `${context.company.name}, convocation du ${details.meeting.convocationDate ? longDate(details.meeting.convocationDate) : ''}`,
    fileName: `Convocation_${fileSafe(context.company.name)}_${context.fiscalYear.year}`,
  }
}

function attendanceDocument(input: Input): GeneratedDocument {
  const { context, details } = input
  const date = details.meeting.date as string
  const blocks: Block[] = [
    { kind: 'paragraph', text: `Assemblée générale ordinaire annuelle du ${longDate(date)}${details.meeting.time ? `, à ${details.meeting.time}` : ''}, ${atPlace(details.meeting.place as string)}.` },
    holdersTable(input, true),
    { kind: 'paragraph', text: 'Certifiée sincère et véritable par le bureau de l’assemblée.' },
    {
      kind: 'signatures',
      place: null,
      date: null,
      signers: [
        ...(details.chair?.name ? [{ name: details.chair.name, role: 'président de séance' }] : []),
        ...(details.secretary ? [{ name: details.secretary, role: 'secrétaire' }] : []),
      ],
    },
  ]
  return {
    header: companyHeader(input),
    title: 'Feuille de présence',
    subtitle: `Approbation des comptes de ${endLabel(context)}`,
    blocks,
    footer: `${context.company.name}, feuille de présence du ${longDate(date)}`,
    fileName: `Feuille_de_presence_${fileSafe(context.company.name)}_${context.fiscalYear.year}`,
  }
}

function managementReportDocument(input: Input): GeneratedDocument {
  const { context, details, pack } = input
  const regime = regimeOf(pack)
  const officers = officerList(details, regime)
  const report = details.managementReport
  const by = regime.form === 'SA' ? "du conseil d'administration" : regime.form === 'SAS' || regime.form === 'SASU' ? 'du président' : 'de la gérance'
  const blocks: Block[] = [
    {
      kind: 'paragraph',
      text: regime.sole
        ? `Nous vous présentons le rapport sur l'activité de la société pendant ${endLabel(context)} et les comptes annuels soumis à votre approbation.`
        : `Nous vous avons réunis pour vous rendre compte de l'activité de la société pendant ${endLabel(context)} et soumettre à votre approbation les comptes annuels de cet exercice.`,
    },
    { kind: 'heading', text: 'Activité et situation de la société' },
    { kind: 'paragraph', text: report.activity ?? '' },
    { kind: 'heading', text: "Résultats de l'exercice" },
    {
      kind: 'paragraph',
      text: `Le chiffre d'affaires de l'exercice s'élève à ${eur(context.figures.revenueCents)}. L'exercice se solde par ${pack.resultCents >= 0 ? 'un bénéfice' : 'une perte'} de ${eur(Math.abs(pack.resultCents))}.`,
    },
  ]
  if (regime.form !== 'SCI') {
    blocks.push({ kind: 'heading', text: 'Événements importants survenus depuis la clôture' }, { kind: 'paragraph', text: report.postClosingEvents ?? '' })
    blocks.push({ kind: 'heading', text: 'Activités en matière de recherche et de développement' }, { kind: 'paragraph', text: report.research ?? '' })
  } else if (report.postClosingEvents) {
    blocks.push({ kind: 'heading', text: 'Événements importants survenus depuis la clôture' }, { kind: 'paragraph', text: report.postClosingEvents })
  }
  blocks.push({ kind: 'heading', text: 'Évolution prévisible et perspectives' }, { kind: 'paragraph', text: report.outlook ?? '' })
  blocks.push({ kind: 'heading', text: "Proposition d'affectation du résultat" })
  blocks.push(...allocationParagraphs(pack.plan, input, null))
  const nd = details.nonDeductibleExpensesCents
  if (pack.priorDividendsRequired && nd != null && nd > 0) {
    blocks.push({ kind: 'heading', text: 'Dépenses non déductibles fiscalement' })
    blocks.push({ kind: 'paragraph', text: `Les dépenses et charges visées à l'article 39, 4 du Code général des impôts s'élèvent à ${eur(nd)} (CGI art. 223 quater).` })
  }
  blocks.push({ kind: 'paragraph', text: 'Nous vous invitons à approuver les comptes et à adopter les résolutions qui vous sont soumises.' })
  const signDate = details.meeting.convocationDate ?? details.meeting.date
  blocks.push({ kind: 'signatures', place: details.signatureCity, date: signDate ? longDate(signDate) : null, signers: officers })
  return {
    header: companyHeader(input),
    title: regime.form === 'SCI' ? 'Rapport écrit de la gérance' : `Rapport de gestion ${by}`,
    subtitle: `Exercice clos le ${longDate(context.fiscalYear.endDate)}`,
    blocks,
    footer: `${context.company.name}, rapport de gestion de ${endLabel(context)}`,
    fileName: `Rapport_de_gestion_${fileSafe(context.company.name)}_${context.fiscalYear.year}`,
  }
}

function confidentialityDocument(input: Input): GeneratedDocument {
  const { context, details, pack } = input
  const regime = regimeOf(pack)
  const officer = officerList(details, regime)[0]
  const option = details.confidentiality
  const definition =
    option === 'full'
      ? "de micro-entreprise au sens de l'article L. 123-16-1 du Code de commerce"
      : option === 'income_statement'
        ? "de petite entreprise au sens de l'article L. 123-16 du Code de commerce"
        : "de moyenne entreprise au sens de l'article L. 123-16 du Code de commerce"
  const exclusions = ["qu'elle n'est pas une entité mentionnée à l'article L. 123-16-2 du Code de commerce"]
  if (option === 'full') exclusions.push("que son activité ne consiste pas à gérer des titres de participations ou des valeurs mobilières")
  else exclusions.push("qu'elle n'appartient pas à un groupe au sens de l'article L. 233-16 du Code de commerce")
  const request =
    option === 'full'
      ? 'que les comptes annuels déposés ne soient pas rendus publics'
      : option === 'income_statement'
        ? 'que le compte de résultat déposé ne soit pas rendu public'
        : 'que le bilan et l’annexe déposés soient rendus publics sous une forme simplifiée'
  const signDate = details.filedOn ?? context.today
  const blocks: Block[] = [
    {
      kind: 'paragraph',
      text: `Je soussigné(e) ${officer.name}, ${officer.role} de la société ${context.company.name}, déclare que la société répond, pour ${endLabel(context)}, à la définition ${definition}, ${exclusions.join(' et ')}.`,
    },
    { kind: 'paragraph', text: `En conséquence, conformément à l'article L. 232-25 du Code de commerce, je demande ${request}.` },
    { kind: 'note', text: "Les comptes restent communiqués aux autorités judiciaires, aux autorités administratives et à la Banque de France. Le guichet unique propose le modèle de déclaration fixé par arrêté (C. com. art. R. 123-111-1) : ce document en reprend les éléments." },
    { kind: 'signatures', place: details.signatureCity, date: longDate(signDate), signers: [officer] },
  ]
  return {
    header: companyHeader(input),
    title: option === 'simplified' ? 'Déclaration de publication simplifiée des comptes annuels' : 'Déclaration de confidentialité des comptes annuels',
    subtitle: `Exercice clos le ${longDate(context.fiscalYear.endDate)}`,
    blocks,
    footer: `${context.company.name}, déclaration de confidentialité`,
    fileName: `Declaration_confidentialite_${fileSafe(context.company.name)}_${context.fiscalYear.year}`,
  }
}

function filingChecklistDocument(input: Input): GeneratedDocument {
  const { context, pack } = input
  const blocks: Block[] = []
  if (pack.deadlines.filing) {
    blocks.push({
      kind: 'paragraph',
      text: `Date limite de dépôt : ${longDate(pack.deadlines.filing)}${pack.deadlines.filingBasis === 'deadline' ? ", comptée depuis la date limite d'approbation tant que la date d'approbation n'est pas enregistrée" : ''}.`,
    })
  }
  blocks.push({ kind: 'heading', text: 'Pièces à déposer' }, { kind: 'checklist', items: pack.publication.items.map((i) => `${i.text} (${i.sources.map((s) => s.label).join(', ')})`) })
  blocks.push({ kind: 'heading', text: 'À savoir' }, { kind: 'list', items: pack.publication.notes })
  return {
    header: companyHeader(input),
    title: 'Dépôt des comptes annuels au greffe',
    subtitle: `Exercice clos le ${longDate(context.fiscalYear.endDate)}`,
    blocks,
    footer: `${context.company.name}, dépôt des comptes`,
    fileName: `Depot_des_comptes_${fileSafe(context.company.name)}_${context.fiscalYear.year}`,
  }
}

/** The document `id` of the pack. Call only when the pack lists nothing missing for it. */
export function buildDocument(id: DocumentId, input: Input): GeneratedDocument {
  switch (id) {
    case 'decision':
      return decisionDocument(input)
    case 'convocation':
      return convocationDocument(input)
    case 'attendance':
      return attendanceDocument(input)
    case 'management-report':
      return managementReportDocument(input)
    case 'confidentiality':
      return confidentialityDocument(input)
    case 'filing-checklist':
      return filingChecklistDocument(input)
    case 'annexe':
      // Built from the books by lib/annexe (export-approval-document.service.tsx routes it there)
      throw new Error('The annexe is built by lib/annexe')
  }
}
