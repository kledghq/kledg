/**
 * The declarations tracker (docs/echeances.md): the user marks a deadline
 * of the calendar filed and/or paid on impots.gouv.fr (or with the greffe),
 * with the date, the amount, a receipt already in Kledg or its reference,
 * and a note, or says it is not due. Kledg never files nor pays.
 *
 * Invariants:
 * - the deadline is one the engine computes for the company (an unknown id
 *   is a 404, never a free text row);
 * - a fact another module owns (lib/declarations/sources.ts) is refused
 *   here (409 with the page where it is recorded): no double entry;
 * - a return is filed, a payment paid: the other date is refused; dates
 *   are never in the future; a deadline not due has neither;
 * - the receipt belongs to the company;
 * - concurrent marks of one deadline are serialized (advisory lock), only
 *   the fields sent change, a record left empty is deleted.
 * Every change writes an audit row (MARK_DECLARATION, CLEAR_DECLARATION).
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { centsField, optionalCalendarDay, optionalText } from '@/lib/api/zod-fields'
import { writeAuditLog } from '@/lib/audit'
import { computeDeadlines } from '@/lib/deadlines/engine'
import { loadDeadlineContext, type CompanyContext } from '@/lib/deadlines/load-deadlines.service'
import type { Deadline } from '@/lib/deadlines/types'
import { addIsoDays, calendarDayOf, todayUtc } from '@/lib/utils/date'
import { centsToDecimal } from '@/lib/utils/money'
import { trackDeadlines } from './load-declaration-statuses.service'
import { declarationKindOf, type LockedField, type TrackedDeadline } from './status'

/** "cfe:2026", "is-acompte:2026-12-31:2", "tva-ca3:2026-T3": rule, colon, key. */
export const DEADLINE_ID_PATTERN = /^[a-z0-9-]+:[0-9A-Za-z:-]+$/

export const DeadlineIdField = z
  .string({ error: 'L’échéance est requise' })
  .trim()
  .max(100, 'Échéance inconnue')
  .regex(DEADLINE_ID_PATTERN, 'Échéance inconnue')

export const MarkDeclarationBodySchema = z.object({
  deadlineId: DeadlineIdField,
  filedOn: optionalCalendarDay('Date de dépôt invalide'),
  paidOn: optionalCalendarDay('Date de paiement invalide'),
  amountCents: centsField({ min: 0, negative: 'Le montant ne peut pas être négatif' }).nullable().optional(),
  notDue: z.boolean({ error: 'Indiquez si l’échéance est due' }).optional(),
  attachmentId: z.string().trim().max(100).nullable().optional(),
  attachmentReference: optionalText(200),
  note: optionalText(1000),
})
export type MarkDeclarationBody = z.input<typeof MarkDeclarationBodySchema>
type MarkDeclarationInput = z.output<typeof MarkDeclarationBodySchema>

export const ClearDeclarationQuerySchema = z.object({ deadlineId: DeadlineIdField })

const day = (value: Date) => calendarDayOf(value) as string
const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

const FIELD_LABELS: Record<LockedField, string> = { filedOn: 'Le dépôt', paidOn: 'Le paiement', notDue: 'Ce point' }

/**
 * The deadline of the company with this id: the engine over every fiscal
 * year in Kledg (plus the year before and two years ahead), as the calendar
 * lists them.
 */
async function findDeadline(companyId: string, deadlineId: string, today: string): Promise<{ deadline: Deadline; context: CompanyContext }> {
  const context = await loadDeadlineContext(companyId)
  const starts = [...context.fiscalYears.map((fy) => fy.startDate), today]
  const ends = [...context.fiscalYears.map((fy) => fy.endDate), today]
  const from = addIsoDays(starts.sort()[0], -366)
  const to = addIsoDays(ends.sort()[ends.length - 1], 2 * 366)
  const deadline = computeDeadlines({ ...context, from, to }).find((d) => d.id === deadlineId)
  if (!deadline) throw new NotFoundError('Échéance inconnue pour cette société : vérifiez le calendrier des échéances.')
  return { deadline, context }
}

/** The deadline with its status, after a change. */
async function tracked(companyId: string, context: CompanyContext, deadline: Deadline, today: string): Promise<TrackedDeadline> {
  const [item] = await trackDeadlines(companyId, context, [deadline], today)
  return item
}

export async function markDeclaration(
  companyId: string,
  body: MarkDeclarationInput,
  options: { userId?: string; now?: Date; source?: 'web' | 'mcp' } = {},
): Promise<TrackedDeadline> {
  const today = day(todayUtc(options.now))
  const { deadline, context } = await findDeadline(companyId, body.deadlineId, today)
  const kind = declarationKindOf(deadline.ruleId)
  const [current] = await trackDeadlines(companyId, context, [deadline], today)

  // A fact another module owns is recorded there, never here.
  for (const field of ['filedOn', 'paidOn', 'notDue'] as const) {
    const sent = field === 'notDue' ? body.notDue === true : body[field] !== undefined && body[field] !== null
    if (sent && current.status.locked.includes(field) && current.status.sourcePage) {
      throw new ConflictError(
        `${FIELD_LABELS[field]} de cette échéance s’enregistre sur la page ${current.status.sourcePage.label} : Kledg le lit de là, pour ne pas le saisir deux fois.`,
      ).withDetails({ page: current.status.sourcePage.page })
    }
  }
  if (body.filedOn && kind === 'pay') throw new ValidationError('Cette échéance est un paiement : indiquez la date de paiement.')
  if (body.paidOn && kind === 'file') throw new ValidationError('Cette échéance est une déclaration sans paiement : indiquez la date de dépôt.')
  for (const [field, label] of [['filedOn', 'de dépôt'], ['paidOn', 'de paiement']] as const) {
    if (body[field] && body[field] > today) throw new ValidationError(`La date ${label} ne peut pas être dans le futur.`)
  }
  if (body.attachmentId) {
    const own = await prisma.attachment.findFirst({ where: { id: body.attachmentId, companyId }, select: { id: true } })
    if (!own) throw new ValidationError('Pièce justificative introuvable dans cette société.')
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`kledg:declaration-status:${companyId}:${deadline.id}`}))`
    const existing = await tx.declarationStatus.findUnique({ where: { companyId_deadlineId: { companyId, deadlineId: deadline.id } } })
    const merged = {
      filedOn: body.filedOn !== undefined ? body.filedOn : existing?.filedOn ? day(existing.filedOn) : null,
      paidOn: body.paidOn !== undefined ? body.paidOn : existing?.paidOn ? day(existing.paidOn) : null,
      amount: body.amountCents !== undefined ? (body.amountCents === null ? null : centsToDecimal(body.amountCents)) : (existing?.amount ?? null),
      notDue: body.notDue ?? existing?.notDue ?? false,
      attachmentId: body.attachmentId !== undefined ? body.attachmentId || null : (existing?.attachmentId ?? null),
      attachmentReference: body.attachmentReference !== undefined ? body.attachmentReference : (existing?.attachmentReference ?? null),
      note: body.note !== undefined ? body.note : (existing?.note ?? null),
    }
    // Marking a date says the deadline is due after all; saying it is not due clears the dates.
    if (body.notDue === true) {
      merged.filedOn = null
      merged.paidOn = null
    } else if ((body.filedOn || body.paidOn) && body.notDue === undefined) {
      merged.notDue = false
    }
    if (merged.notDue && (merged.filedOn || merged.paidOn)) throw new ValidationError('Une échéance non due n’a ni dépôt ni paiement.')
    const empty = !merged.filedOn && !merged.paidOn && !merged.notDue && !merged.note && !merged.attachmentId && !merged.attachmentReference
    if (empty) {
      if (existing) await tx.declarationStatus.delete({ where: { id: existing.id } })
      return 'cleared' as const
    }
    const data = {
      filedOn: merged.filedOn ? utc(merged.filedOn) : null,
      paidOn: merged.paidOn ? utc(merged.paidOn) : null,
      amount: merged.amount,
      notDue: merged.notDue,
      attachmentId: merged.attachmentId,
      attachmentReference: merged.attachmentReference,
      note: merged.note,
      updatedById: options.userId ?? null,
    }
    await tx.declarationStatus.upsert({
      where: { companyId_deadlineId: { companyId, deadlineId: deadline.id } },
      create: { companyId, deadlineId: deadline.id, createdById: options.userId ?? null, ...data },
      update: data,
      select: { id: true },
    })
    return 'saved' as const
  })

  await writeAuditLog('info', `Deadline ${deadline.id} ${result === 'cleared' ? 'cleared' : 'marked'} in the declarations tracker`, {
    action: result === 'cleared' ? 'CLEAR_DECLARATION' : 'MARK_DECLARATION',
    companyId,
    metadata: {
      deadlineId: deadline.id,
      fields: Object.keys(body).filter((k) => k !== 'deadlineId' && body[k as keyof MarkDeclarationInput] !== undefined),
      source: options.source ?? 'web',
    },
  })
  return tracked(companyId, context, deadline, today)
}

/** Removes what the user recorded for a deadline; the facts of other modules stay. */
export async function clearDeclaration(companyId: string, deadlineId: string, options: { now?: Date; source?: 'web' | 'mcp' } = {}): Promise<TrackedDeadline> {
  const today = day(todayUtc(options.now))
  const { deadline, context } = await findDeadline(companyId, deadlineId, today)
  const deleted = await prisma.declarationStatus.deleteMany({ where: { companyId, deadlineId: deadline.id } })
  if (deleted.count === 0) throw new NotFoundError('Rien n’est enregistré pour cette échéance.')
  await writeAuditLog('info', `Deadline ${deadline.id} cleared in the declarations tracker`, {
    action: 'CLEAR_DECLARATION',
    companyId,
    metadata: { deadlineId: deadline.id, source: options.source ?? 'web' },
  })
  return tracked(companyId, context, deadline, today)
}
