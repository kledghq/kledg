/**
 * Full control tools on lettering (lettrage) of third-party accounts: list
 * the unlettered lines of an account, letter a balanced set of lines,
 * remove a lettering code. Thin wrappers over
 * lib/lettering/lettering.service.ts, which keeps the rules (balanced
 * groups only, validated entries only, no change in a closed fiscal year,
 * one code sequence per account under a lock). Lettering and unlettering
 * follow the connection's execution mode (approval in Kledg or automatic).
 */

import { z } from 'zod'
import { ValidationError } from '@/lib/accounting/errors'
import { getActiveFiscalYear } from '@/lib/accounting/fiscal-year-utils'
import { getLetteringSuggestions, letterLines, listLetteringLines, previewLettering, unletterCode } from '@/lib/lettering/lettering.service'
import { SUGGESTION_LABELS } from '@/lib/lettering/match'
import { fromCents } from '@/lib/utils/money'
import { fullControlTool, type RegisterTool } from './define'
import { ACTS_AS_USER, TWO_STEP } from './descriptions'
import { accountIdsByCode, ownedFiscalYear } from './resolve'

const accountInput = {
  accountCode: z.string().min(1).max(20).describe('Third-party account number, e.g. 411000, 401000, 4081, 467.'),
  fiscalYearId: z.string().optional().describe('Fiscal year id, from list_fiscal_years. Defaults to the current fiscal year (accounts are per fiscal year).'),
}

async function accountIdOf(companyId: string, accountCode: string, fiscalYearId?: string): Promise<string> {
  const fiscalYear = fiscalYearId ? await ownedFiscalYear(companyId, fiscalYearId) : await getActiveFiscalYear(companyId)
  if (!fiscalYear) throw new ValidationError('Aucun exercice ouvert\u00a0: indiquez fiscalYearId.')
  return (await accountIdsByCode(companyId, fiscalYear.id, [accountCode])).get(accountCode)!
}

const euros = (cents: number) => fromCents(cents)

const listUnletteredTool = fullControlTool({
  name: 'list_unlettered_lines',
  title: 'Lister les lignes à lettrer',
  description: `Lists the unlettered lines (lignes non lettrées) of a third-party account with their ids, amounts, auxiliary account and running balance, and the automatic lettering proposals (same tiers and amount, payments reconciled with the bank first). Use the line ids with letter_entry_lines. ${ACTS_AS_USER}`,
  input: accountInput,
  permission: { entries: ['read'] },
  confirmation: false,
  readOnly: true,
  async execute({ companyId, accountCode, fiscalYearId }) {
    const accountId = await accountIdOf(companyId, accountCode, fiscalYearId)
    const [{ account, fiscalYear, lines, truncated, nextCode }, { suggestions }] = await Promise.all([
      listLetteringLines(companyId, { accountId, status: 'open' }),
      getLetteringSuggestions(companyId, accountId),
    ])
    return {
      account,
      fiscalYear,
      nextCode,
      truncated,
      lines: lines.map((l) => ({
        id: l.id,
        entryNumber: l.entryNumber,
        date: l.date,
        journal: l.journalCode,
        label: l.description,
        debit: euros(l.debitCents),
        credit: euros(l.creditCents),
        auxiliaryAccount: l.auxiliaryAccountNumber,
        auxiliaryLabel: l.auxiliaryAccountLabel,
        reconciledWithBank: l.reconciled,
        runningBalance: euros(l.runningBalanceCents),
      })),
      suggestions: suggestions.map((s) => ({
        lineIds: s.lineIds,
        amount: euros(s.amountCents),
        auxiliaryAccount: s.auxiliaryAccountNumber,
        reason: SUGGESTION_LABELS[s.reason],
        fromReconciliation: s.fromReconciliation,
      })),
    }
  },
  audit: null,
})

const letterInput = {
  ...accountInput,
  lineIds: z.array(z.string().min(1)).min(2).max(500).describe('Ids of the lines to letter together, from list_unlettered_lines. Debits must equal credits.'),
}

const letterTool = fullControlTool({
  name: 'letter_entry_lines',
  title: 'Lettrer des lignes',
  description: `Letters lines of a third-party account together (lettrage): they get the next code of the account (AA, AB...) and today's date, written to the FEC (EcritureLet, DateLet). Only lines of validated entries, debits equal to credits (no partial lettering), one auxiliary account at most, in an open fiscal year. ${ACTS_AS_USER} ${TWO_STEP} The dry run shows the lines, their totals, the code they would take and the reasons it would be refused.`,
  input: letterInput,
  permission: { entries: ['update'] },
  confirmation: true,
  async preview({ companyId, accountCode, fiscalYearId, lineIds }) {
    const preview = await previewLettering(companyId, { accountId: await accountIdOf(companyId, accountCode, fiscalYearId), lineIds })
    return {
      account: preview.account,
      code: preview.code,
      totalDebit: euros(preview.debitCents),
      totalCredit: euros(preview.creditCents),
      lines: preview.lines.map((l) => ({ ...l, debit: euros(l.debitCents), credit: euros(l.creditCents) })),
      problems: preview.problems,
    }
  },
  async execute({ companyId, accountCode, fiscalYearId, lineIds }) {
    const group = await letterLines(companyId, { accountId: await accountIdOf(companyId, accountCode, fiscalYearId), lineIds }, { source: 'mcp' })
    return { code: group.code, letteringDate: group.letteringDate, lineIds: group.lineIds, amount: euros(group.amountCents) }
  },
  audit: (args, result) => ({ accountCode: args.accountCode, code: result.code, lineIds: result.lineIds }),
})

const unletterTool = fullControlTool({
  name: 'unletter_entry_lines',
  title: 'Délettrer',
  description: `Removes a lettering code (délettrage) from every line of a third-party account that carries it, in an open fiscal year. ${ACTS_AS_USER} ${TWO_STEP}`,
  input: { ...accountInput, code: z.string().min(1).max(20).describe('Lettering code to remove, e.g. AB.') },
  permission: { entries: ['update'] },
  confirmation: true,
  destructive: true,
  async preview({ companyId, accountCode, fiscalYearId, code }) {
    const accountId = await accountIdOf(companyId, accountCode, fiscalYearId)
    const { account, fiscalYear, lines } = await listLetteringLines(companyId, { accountId, status: 'lettered' })
    const affected = lines.filter((l) => l.letteringCode === code)
    return {
      account,
      code,
      lines: affected.map((l) => ({ id: l.id, entryNumber: l.entryNumber, date: l.date, debit: euros(l.debitCents), credit: euros(l.creditCents) })),
      problems: [
        ...(affected.length === 0 ? [`Aucune ligne lettrée ${code} sur ce compte.`] : []),
        ...(fiscalYear.isClosed ? [`L'exercice ${fiscalYear.year} est clôturé\u00a0: son lettrage ne peut plus changer.`] : []),
      ],
    }
  },
  async execute({ companyId, accountCode, fiscalYearId, code }) {
    return unletterCode(companyId, { accountId: await accountIdOf(companyId, accountCode, fiscalYearId), code }, { source: 'mcp' })
  },
  audit: (args, result) => ({ accountCode: args.accountCode, code: result.code, lineCount: result.lineCount }),
})

export function registerLetteringTools(register: RegisterTool) {
  register(listUnletteredTool)
  register(letterTool)
  register(unletterTool)
}
