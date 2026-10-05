/**
 * Register of accounting methods, and changes of method, regulation or
 * estimate and corrections of errors of a fiscal year (rules.ts for the
 * accounting rules, PCG art. 121-5 and 122-1 to 122-6).
 *
 * Invariants owned here:
 * - the method and the fiscal year of a change are the company's (404);
 * - a kind only takes the treatments the PCG allows it (also a CHECK for
 *   estimates), and an entry needs a balance sheet account to adjust;
 * - the catch-up entry is only ever a DRAFT prepared by Kledg, in an open
 *   fiscal year, under the lock of its row (like the year-end entries);
 *   the user validates it (PCG art. 1031-3);
 * - a change whose entry is validated keeps its figures: the entry is
 *   reversed first; a draft entry that no longer matches is deleted with
 *   the change of figures, then prepared again.
 */

import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ClosedFiscalYearError, ConflictError, NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { createEntryInTx, deleteDraftEntryInTx } from '@/lib/accounting/services/entry-lifecycle.service'
import { ensureAccounts, ensureJournal } from '@/lib/accounting/fiscal-year-closure/ledger'
import { lockFiscalYearRow } from '@/lib/accounting/fiscal-year-closure/lock'
import { centsField, optionalCalendarDay, optionalText } from '@/lib/api/zod-fields'
import { writeAuditLog } from '@/lib/audit'
import { calendarDayOf, isoDateToUtc } from '@/lib/utils/date'
import { centsToDecimal, parseCents } from '@/lib/utils/money'
import {
  CHANGE_KINDS,
  CHANGE_TREATMENTS,
  METHOD_TOPICS,
  changeEntryDescription,
  changeEntryLines,
  counterpartError,
  defaultTreatment,
  treatmentError,
  type ChangeKind,
  type ChangeTreatment,
} from './rules'

export const METHOD_NOT_FOUND = 'Méthode comptable introuvable'
export const CHANGE_NOT_FOUND = 'Changement ou correction introuvable'
const FISCAL_YEAR_NOT_FOUND = 'Exercice introuvable pour cette société.'
const OD_JOURNAL = { code: 'OD', label: 'Opérations diverses' }

const text = (message: string, max: number) => z.string({ error: message }).trim().min(1, message).max(max, `${max} caractères au maximum`)

/** Body of POST /api/accounting-methods (with companyId) and PATCH /api/accounting-methods/[id]. */
export const MethodBodySchema = z.object({
  topic: z.enum(METHOD_TOPICS, { error: 'Choisissez le sujet de la méthode' }),
  label: text('Indiquez la méthode retenue', 200),
  description: text("Décrivez comment la méthode s'applique", 4000),
  adoptedOn: optionalCalendarDay("Date d'adoption invalide"),
  referenceMethod: z.boolean().optional(),
})
export type MethodBody = z.infer<typeof MethodBodySchema>
export const CreateMethodBodySchema = MethodBodySchema.extend({ companyId: z.string() })

/** Body of POST /api/accounting-changes (with companyId) and PATCH /api/accounting-changes/[id]. */
export const ChangeBodySchema = z.object({
  fiscalYearId: z.string({ error: "L'exercice est requis" }).min(1, "L'exercice est requis").max(64),
  kind: z.enum(CHANGE_KINDS, { error: 'Choisissez le type : changement de méthode, de réglementation, d’estimation ou correction d’erreur' }),
  treatment: z.enum(CHANGE_TREATMENTS).optional(),
  methodId: z.string().max(64).nullable().optional(),
  label: text('Le libellé est requis', 200),
  description: text('Décrivez la nature du changement ou de l’erreur et sa justification', 4000),
  impactCents: centsField({ invalid: 'Impact invalide' }).optional(),
  taxEffectCents: centsField({ min: 0, invalid: "Effet d'impôt invalide", negative: "L'effet d'impôt est un montant positif" }).optional(),
  accountCode: optionalText(10),
  entryDate: optionalCalendarDay("Date de l'écriture invalide"),
})
export type ChangeBody = z.infer<typeof ChangeBodySchema>
export const CreateChangeBodySchema = ChangeBodySchema.extend({ companyId: z.string() })

/** ?fiscalYearId= of GET /api/accounting-methods (optional: every change otherwise). */
export const RegisterQuerySchema = z.object({ fiscalYearId: z.string().max(64).optional() })

const day = (value: Date | null) => (value ? (calendarDayOf(value) as string) : null)
const cents = (value: Prisma.Decimal | null | undefined) => (value == null ? 0 : (parseCents(value) ?? 0))

const CHANGE_SELECT = {
  id: true,
  fiscalYearId: true,
  kind: true,
  treatment: true,
  methodId: true,
  label: true,
  description: true,
  impact: true,
  taxEffect: true,
  accountCode: true,
  entryDate: true,
  updatedAt: true,
  fiscalYear: { select: { year: true, startDate: true, endDate: true, isClosed: true } },
  method: { select: { id: true, label: true, topic: true } },
  entry: { select: { id: true, entryNumber: true, status: true } },
} as const

type ChangeRow = Prisma.AccountingChangeGetPayload<{ select: typeof CHANGE_SELECT }>

export interface AccountingChangeView {
  id: string
  fiscalYearId: string
  fiscalYear: number
  kind: ChangeKind
  treatment: ChangeTreatment
  method: { id: string; label: string; topic: string } | null
  label: string
  description: string
  impactCents: number
  taxEffectCents: number
  /** Impact after tax (PCG art. 122-3). */
  netImpactCents: number
  accountCode: string | null
  entryDate: string | null
  entry: { id: string; entryNumber: string; status: string } | null
  /** Whether Kledg can prepare a catch-up entry for it (treatment, impact and account given, open year). */
  entryExpected: boolean
}

function view(row: ChangeRow): AccountingChangeView {
  const impact = cents(row.impact)
  const tax = cents(row.taxEffect)
  return {
    id: row.id,
    fiscalYearId: row.fiscalYearId,
    fiscalYear: row.fiscalYear.year,
    kind: row.kind,
    treatment: row.treatment,
    method: row.method,
    label: row.label,
    description: row.description,
    impactCents: impact,
    taxEffectCents: tax,
    netImpactCents: impact >= 0 ? impact - tax : impact + tax,
    accountCode: row.accountCode,
    entryDate: day(row.entryDate),
    entry: row.entry,
    entryExpected: row.treatment !== 'PROSPECTIVE' && impact !== 0 && row.accountCode !== null,
  }
}

export interface AccountingMethodView {
  id: string
  topic: string
  label: string
  description: string
  adoptedOn: string | null
  referenceMethod: boolean
}

export async function listAccountingMethods(companyId: string): Promise<AccountingMethodView[]> {
  const rows = await prisma.accountingMethod.findMany({
    where: { companyId },
    orderBy: [{ topic: 'asc' }, { createdAt: 'asc' }],
    take: 200,
    select: { id: true, topic: true, label: true, description: true, adoptedOn: true, referenceMethod: true },
  })
  return rows.map((r) => ({ ...r, adoptedOn: day(r.adoptedOn) }))
}

export async function listAccountingChanges(companyId: string, fiscalYearId?: string): Promise<AccountingChangeView[]> {
  if (fiscalYearId) {
    const fy = await prisma.fiscalYear.findFirst({ where: { id: fiscalYearId, companyId }, select: { id: true } })
    if (!fy) throw new NotFoundError(FISCAL_YEAR_NOT_FOUND)
  }
  const rows = await prisma.accountingChange.findMany({
    where: { companyId, ...(fiscalYearId ? { fiscalYearId } : {}) },
    orderBy: [{ fiscalYear: { startDate: 'desc' } }, { createdAt: 'asc' }],
    take: 500,
    select: CHANGE_SELECT,
  })
  return rows.map(view)
}

/** The register: methods of the company and the changes (of one fiscal year when given). */
export async function getAccountingRegister(companyId: string, fiscalYearId?: string) {
  const [methods, changes] = await Promise.all([listAccountingMethods(companyId), listAccountingChanges(companyId, fiscalYearId)])
  return { methods, changes }
}

function methodData(body: MethodBody) {
  return {
    topic: body.topic,
    label: body.label,
    description: body.description,
    adoptedOn: body.adoptedOn ? isoDateToUtc(body.adoptedOn) : null,
    referenceMethod: body.referenceMethod ?? false,
  }
}

async function ownedMethod(companyId: string, methodId: string) {
  const method = await prisma.accountingMethod.findFirst({ where: { id: methodId, companyId }, select: { id: true, referenceMethod: true, topic: true, label: true } })
  if (!method) throw new NotFoundError(METHOD_NOT_FOUND)
  return method
}

export async function createAccountingMethod(companyId: string, body: MethodBody): Promise<AccountingMethodView> {
  const created = await prisma.accountingMethod.create({ data: { companyId, ...methodData(body) }, select: { id: true } })
  await writeAuditLog('info', 'Accounting method recorded', { action: 'CREATE_ACCOUNTING_METHOD', companyId, metadata: { methodId: created.id, topic: body.topic } })
  return (await listAccountingMethods(companyId)).find((m) => m.id === created.id)!
}

/**
 * Replaces a method. A reference method of the PCG cannot be given up for
 * another method of the same topic (PCG art. 121-5: "l'adoption d'une
 * méthode comptable de référence est irréversible").
 */
export async function updateAccountingMethod(companyId: string, methodId: string, body: MethodBody): Promise<AccountingMethodView> {
  const current = await ownedMethod(companyId, methodId)
  if (current.referenceMethod && body.referenceMethod === false) {
    throw new ConflictError("L'adoption d'une méthode de référence est irréversible (PCG art. 121-5) : la méthode reste une méthode de référence.")
  }
  await prisma.accountingMethod.update({ where: { id: methodId }, data: methodData({ ...body, referenceMethod: body.referenceMethod ?? current.referenceMethod }) })
  await writeAuditLog('info', 'Accounting method updated', { action: 'UPDATE_ACCOUNTING_METHOD', companyId, metadata: { methodId } })
  return (await listAccountingMethods(companyId)).find((m) => m.id === methodId)!
}

/** Deletes a method of the register; its changes stay, without the link. */
export async function deleteAccountingMethod(companyId: string, methodId: string): Promise<void> {
  await ownedMethod(companyId, methodId)
  await prisma.accountingMethod.delete({ where: { id: methodId } })
  await writeAuditLog('info', 'Accounting method deleted', { action: 'DELETE_ACCOUNTING_METHOD', companyId, metadata: { methodId } })
}

interface NormalizedChange {
  fiscalYearId: string
  kind: ChangeKind
  treatment: ChangeTreatment
  methodId: string | null
  label: string
  description: string
  impact: string
  taxEffect: string
  accountCode: string | null
  entryDate: Date | null
}

async function normalizeChange(companyId: string, body: ChangeBody): Promise<NormalizedChange> {
  const fy = await prisma.fiscalYear.findFirst({ where: { id: body.fiscalYearId, companyId }, select: { id: true, startDate: true, endDate: true } })
  if (!fy) throw new NotFoundError(FISCAL_YEAR_NOT_FOUND)
  const treatment = body.treatment ?? defaultTreatment(body.kind)
  const refused = treatmentError(body.kind, treatment)
  if (refused) throw new ValidationError(refused)
  const methodId = body.methodId ? (await ownedMethod(companyId, body.methodId)).id : null
  const impact = body.impactCents ?? 0
  const tax = body.taxEffectCents ?? 0
  if (tax > Math.abs(impact)) throw new ValidationError("L'effet d'impôt dépasse l'impact du changement.")
  const accountCode = body.accountCode ?? null
  if (accountCode) {
    const error = counterpartError(accountCode)
    if (error) throw new ValidationError(error)
  }
  if (treatment !== 'PROSPECTIVE' && impact !== 0 && !accountCode) {
    throw new ValidationError("Indiquez le compte de bilan que le changement ajuste (stocks, provisions, immobilisations...) : c'est la contrepartie de l'écriture.")
  }
  const entryDate = body.entryDate ?? null
  if (entryDate) {
    const start = calendarDayOf(fy.startDate) as string
    const end = calendarDayOf(fy.endDate) as string
    if (entryDate < start || entryDate > end) throw new ValidationError("La date de l'écriture doit être dans l'exercice du changement.")
  }
  return {
    fiscalYearId: fy.id,
    kind: body.kind,
    treatment,
    methodId,
    label: body.label,
    description: body.description,
    impact: centsToDecimal(impact),
    taxEffect: centsToDecimal(tax),
    accountCode,
    entryDate: entryDate ? isoDateToUtc(entryDate) : null,
  }
}

async function getChange(companyId: string, changeId: string): Promise<AccountingChangeView> {
  const row = await prisma.accountingChange.findFirst({ where: { id: changeId, companyId }, select: CHANGE_SELECT })
  if (!row) throw new NotFoundError(CHANGE_NOT_FOUND)
  return view(row)
}

export async function createAccountingChange(companyId: string, body: ChangeBody): Promise<AccountingChangeView> {
  const data = await normalizeChange(companyId, body)
  const created = await prisma.accountingChange.create({ data: { companyId, ...data }, select: { id: true } })
  await writeAuditLog('info', 'Accounting change recorded', { action: 'CREATE_ACCOUNTING_CHANGE', companyId, metadata: { changeId: created.id, kind: data.kind } })
  return getChange(companyId, created.id)
}

/** What the catch-up entry depends on: a change of these makes a linked entry obsolete. */
const entryKey = (c: { treatment: string; impact: string; taxEffect: string; accountCode: string | null; entryDate: Date | null; fiscalYearId: string; kind: string; label: string }) =>
  JSON.stringify([c.treatment, c.impact, c.taxEffect, c.accountCode, c.entryDate?.toISOString() ?? null, c.fiscalYearId, c.kind, c.label])

export async function updateAccountingChange(companyId: string, changeId: string, body: ChangeBody): Promise<AccountingChangeView> {
  const data = await normalizeChange(companyId, body)
  await prisma.$transaction(async (tx) => {
    const current = await tx.accountingChange.findFirst({
      where: { id: changeId, companyId },
      select: { treatment: true, impact: true, taxEffect: true, accountCode: true, entryDate: true, fiscalYearId: true, kind: true, label: true, entry: { select: { id: true, status: true, entryNumber: true } } },
    })
    if (!current) throw new NotFoundError(CHANGE_NOT_FOUND)
    const before = entryKey({ ...current, impact: centsToDecimal(cents(current.impact)), taxEffect: centsToDecimal(cents(current.taxEffect)) })
    const changed = before !== entryKey(data)
    if (changed && current.entry?.status === 'validated') {
      throw new ConflictError(
        `L'écriture n° ${current.entry.entryNumber} de ce changement est validée : contre-passez-la avant de modifier le traitement, l'impact, le compte ou la date (PCG art. 1031-3).`,
      )
    }
    if (changed && current.entry) await deleteDraftEntryInTx(tx, companyId, current.entry.id)
    await tx.accountingChange.update({ where: { id: changeId }, data: { ...data, ...(changed && current.entry ? { entryId: null } : {}) } })
  })
  await writeAuditLog('info', 'Accounting change updated', { action: 'UPDATE_ACCOUNTING_CHANGE', companyId, metadata: { changeId } })
  return getChange(companyId, changeId)
}

/** Deletes a change with its draft entry; refused while its entry is validated. */
export async function deleteAccountingChange(companyId: string, changeId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const current = await tx.accountingChange.findFirst({ where: { id: changeId, companyId }, select: { entry: { select: { id: true, status: true, entryNumber: true } } } })
    if (!current) throw new NotFoundError(CHANGE_NOT_FOUND)
    if (current.entry?.status === 'validated') {
      throw new ConflictError(`L'écriture n° ${current.entry.entryNumber} de ce changement est validée : contre-passez-la avant de supprimer le changement.`)
    }
    await tx.accountingChange.delete({ where: { id: changeId } })
    if (current.entry) await deleteDraftEntryInTx(tx, companyId, current.entry.id)
  })
  await writeAuditLog('info', 'Accounting change deleted', { action: 'DELETE_ACCOUNTING_CHANGE', companyId, metadata: { changeId } })
}

export interface PreparedChangeEntry {
  change: AccountingChangeView
  /** created: a new draft; unchanged: the linked entry already books it. */
  outcome: 'created' | 'unchanged'
}

/**
 * Prepares the catch-up entry of a change as a DRAFT in the OD journal:
 * at the opening of the year for an impact in report à nouveau (PCG art.
 * 122-3, "dès l'ouverture de l'exercice"), at the entry date or the last
 * day of the year in the result. Idempotent: a linked draft is replaced, a
 * validated entry is left alone. Runs under the lock of the fiscal year row.
 */
export async function prepareAccountingChangeEntry(companyId: string, changeId: string): Promise<PreparedChangeEntry> {
  const outcome = await prisma.$transaction(
    async (tx) => {
      const change = await tx.accountingChange.findFirst({ where: { id: changeId, companyId }, select: { ...CHANGE_SELECT, entryId: true } })
      if (!change) throw new NotFoundError(CHANGE_NOT_FOUND)
      const locked = await lockFiscalYearRow(tx, change.fiscalYearId, companyId)
      if (!locked) throw new NotFoundError(FISCAL_YEAR_NOT_FOUND)
      if (locked.closed) throw new ClosedFiscalYearError(locked.year)
      const accountLabel = change.accountCode
        ? ((await tx.account.findFirst({ where: { companyId, fiscalYearId: change.fiscalYearId, code: change.accountCode }, select: { label: true } }))?.label ?? `Compte ${change.accountCode}`)
        : ''
      const lines = changeEntryLines(
        { kind: change.kind, treatment: change.treatment, label: change.label, impactCents: cents(change.impact), taxCents: cents(change.taxEffect), accountCode: change.accountCode },
        accountLabel,
      )
      if (!lines) {
        throw new ValidationError(
          change.treatment === 'PROSPECTIVE'
            ? "Un changement prospectif n'a pas d'écriture de rattrapage : il s'applique aux opérations de l'exercice et des suivants (PCG art. 122-3 et 122-5)."
            : "Indiquez l'impact et le compte de bilan ajusté pour préparer l'écriture.",
        )
      }
      if (change.entry?.status === 'validated') return 'unchanged' as const
      if (change.entry) await deleteDraftEntryInTx(tx, companyId, change.entry.id)
      const journal = await ensureJournal(tx, companyId, OD_JOURNAL)
      const ids = await ensureAccounts(tx, companyId, change.fiscalYearId, lines.map(({ code, label }) => ({ code, label })))
      const date = change.entryDate ?? (change.treatment === 'EQUITY' ? change.fiscalYear.startDate : change.fiscalYear.endDate)
      const description = changeEntryDescription(change.kind, change.label)
      const entry = await createEntryInTx(tx, {
        companyId,
        fiscalYearId: change.fiscalYearId,
        journalId: journal.id,
        date,
        description,
        reference: `CHG-${change.fiscalYear.year}`,
        status: 'draft',
        lines: lines.map((l) => ({ accountId: ids.get(l.code) as string, debit: centsToDecimal(l.debitCents), credit: centsToDecimal(l.creditCents), description })),
      })
      await tx.accountingChange.update({ where: { id: changeId }, data: { entryId: entry.id } })
      return 'created' as const
    },
    { maxWait: 10_000, timeout: 60_000 },
  )
  const change = await getChange(companyId, changeId)
  if (outcome === 'created') {
    await writeAuditLog('info', 'Accounting change entry prepared', { action: 'PREPARE_ACCOUNTING_CHANGE_ENTRY', companyId, metadata: { changeId, entryId: change.entry?.id } })
  }
  return { change, outcome }
}

