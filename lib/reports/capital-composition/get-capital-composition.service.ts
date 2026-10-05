/**
 * Capital composition report of a company (lib/reports/capital-composition/compute.ts):
 * its shareholders with shares, percentages and nominal amounts, the
 * totals and the checks, and the capital booked in account 101 at the end
 * of a fiscal year next to the capital of the company's information.
 *
 * Read with reports:read. Personal data of natural persons (birth, address,
 * contact) is never returned: names and photos only. The fiscal year is the company's
 * (404 otherwise).
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/accounting/errors'
import { calendarDayOf } from '@/lib/utils/date'
import { formatCentsFr, parseCents, toCents } from '@/lib/utils/money'
import { buildCapitalComposition, type CapitalComposition } from './compute'

/** ?fiscalYearId= (the latest fiscal year by default). */
export const CapitalCompositionQuerySchema = z.object({ fiscalYearId: z.string().max(64).optional() })
export type CapitalCompositionQuery = z.infer<typeof CapitalCompositionQuerySchema>

export interface CapitalCompositionReport extends CapitalComposition {
  company: { name: string; siren: string; legalType: string | null }
  fiscalYear: { id: string; year: number; endDate: string } | null
  /** Credit balance of the 101 accounts at the end of the fiscal year (validated entries, opening included), cents. */
  bookedCapitalCents: number | null
}

export async function getCapitalComposition(companyId: string, query: CapitalCompositionQuery = {}): Promise<CapitalCompositionReport> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { name: true, siren: true, legalType: true, shareCapital: true, totalShares: true, shareNominalValue: true },
  })
  if (!company) throw new NotFoundError('Société introuvable')
  const fiscalYear = query.fiscalYearId
    ? await prisma.fiscalYear.findFirst({ where: { id: query.fiscalYearId, companyId }, select: { id: true, year: true, endDate: true } })
    : await prisma.fiscalYear.findFirst({ where: { companyId }, orderBy: { startDate: 'desc' }, select: { id: true, year: true, endDate: true } })
  if (query.fiscalYearId && !fiscalYear) throw new NotFoundError('Exercice introuvable pour cette société.')

  const shareholders = await prisma.shareholder.findMany({
    where: { companyId },
    select: {
      id: true,
      type: true,
      name: true,
      siret: true,
      sharePercentage: true,
      numberOfShares: true,
      capitalAmount: true,
      person: { select: { firstName: true, name: true, usualName: true, photo: true } },
      companyShareholder: { select: { name: true, siren: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  let bookedCapitalCents: number | null = null
  if (fiscalYear) {
    const sums = await prisma.entryLine.aggregate({
      where: { accountFiscalYearId: fiscalYear.id, account: { code: { startsWith: '101' } }, accountingEntry: { companyId, fiscalYearId: fiscalYear.id, status: 'validated' } },
      _sum: { debit: true, credit: true },
    })
    bookedCapitalCents = (parseCents(sums._sum.credit) ?? 0) - (parseCents(sums._sum.debit) ?? 0)
  }

  const composition = buildCapitalComposition(
    {
      legalType: company.legalType,
      shareCapitalCents: company.shareCapital === null ? null : toCents(company.shareCapital),
      totalShares: company.totalShares,
      nominalCents: company.shareNominalValue === null ? null : toCents(company.shareNominalValue),
    },
    shareholders.map((s) => {
      const personName = s.person ? `${s.person.firstName} ${s.person.usualName || s.person.name}`.trim() : null
      return {
        id: s.id,
        kind: s.type,
        name: (s.type === 'PHYSICAL' ? personName : (s.companyShareholder?.name ?? s.name)) || 'Actionnaire sans nom',
        photo: s.type === 'PHYSICAL' ? (s.person?.photo ?? null) : null,
        siren: s.type === 'LEGAL' ? (s.companyShareholder?.siren ?? (s.siret ? s.siret.slice(0, 9) : null)) : null,
        shares: s.numberOfShares,
        percentHundredths: toCents(s.sharePercentage) ?? 0,
        capitalCents: s.capitalAmount === null ? null : toCents(s.capitalAmount),
      }
    }),
  )
  const capital = composition.capital.shareCapitalCents
  if (fiscalYear && bookedCapitalCents !== null && capital !== null && bookedCapitalCents !== capital) {
    composition.checks.push(
      `Le capital comptabilisé au compte 101 à la clôture de l'exercice ${fiscalYear.year} (${formatCentsFr(bookedCapitalCents)}) diffère du capital social des informations de la société (${formatCentsFr(capital)}).`,
    )
  }
  return {
    ...composition,
    company: { name: company.name, siren: company.siren, legalType: company.legalType },
    fiscalYear: fiscalYear ? { id: fiscalYear.id, year: fiscalYear.year, endDate: calendarDayOf(fiscalYear.endDate) as string } : null,
    bookedCapitalCents,
  }
}
