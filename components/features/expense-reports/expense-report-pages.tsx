'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/shared'
import { useCompanyAccess } from '@/components/features/companies/company-access'
import { responseError } from '@/hooks/use-cursor-list'
import { ExpenseReportEditor, type ExpenseFormValues } from './expense-report-editor'
import type { ExpenseReportDetailData } from './expense-report-detail'

/** The form values of a stored report (amounts in cents, numbers as typed text). */
export function formValuesOf(report: ExpenseReportDetailData): ExpenseFormValues {
  return {
    claimantId: report.own ? '' : report.claimant.id,
    label: report.label ?? '',
    periodStart: report.periodStart,
    periodEnd: report.periodEnd,
    lines: report.lines.map((l) => ({
      kind: l.kind,
      date: l.date,
      supplierName: l.supplierName ?? '',
      label: l.label,
      category: l.category,
      accountCode: l.accountCode ?? '',
      amountInclTaxCents: l.kind === 'EXPENSE' ? l.amountInclTaxCents : null,
      vatRateBp: String(l.vatRateBp),
      vatCents: l.kind === 'EXPENSE' ? l.vatCents : null,
      receiptKind: l.receiptKind,
      receiptAttachmentId: l.receiptAttachmentId ?? '',
      receiptReference: l.receiptReference ?? '',
      vehicleType: (l.vehicleType ?? 'CAR') as 'CAR' | 'MOTORCYCLE' | 'MOPED',
      fiscalPower: l.fiscalPower ? String(l.fiscalPower) : '',
      electric: l.electric,
      distanceKm: l.distanceKm ? String(l.distanceKm) : '',
      mealTaker: l.mealTaker ?? '',
    })),
  }
}

export function NewExpenseReportPage({ companyId }: { companyId: string }) {
  const { can } = useCompanyAccess()
  return (
    <div className="space-y-6">
      <PageHeader
        title="Nouvelle note de frais"
        description="Saisissez chaque dépense avec son justificatif, et vos trajets en véhicule personnel&nbsp;: Kledg calcule la TVA récupérable et les indemnités kilométriques."
      />
      <ExpenseReportEditor companyId={companyId} canManage={can({ expenses: ['validate'] })} canReadReceipts={can({ banking: ['read'] })} />
    </div>
  )
}

export function EditExpenseReportPage({ companyId, reportId }: { companyId: string; reportId: string }) {
  const { can } = useCompanyAccess()
  const [report, setReport] = React.useState<ExpenseReportDetailData | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [version, setVersion] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    fetch(`/api/expense-reports/${reportId}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response, 'La note de frais ne s’est pas chargée. Réessayez.'))
        return response.json() as Promise<ExpenseReportDetailData>
      })
      .then((data) => !cancelled && setReport(data))
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [reportId, version])

  if (error) {
    return (
      <Card>
        <CardContent role="alert" className="flex flex-col items-start gap-3">
          <p className="text-sm">{error}</p>
          <Button size="sm" variant="outline" onClick={() => setVersion((v) => v + 1)}>
            Réessayer
          </Button>
        </CardContent>
      </Card>
    )
  }
  if (!report) {
    return (
      <div className="space-y-4" aria-busy>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  return (
    <div className="space-y-6">
      <PageHeader title={`Modifier la note de frais ${report.number}`} description={`${report.claimant.name}. Les montants sont recalculés à l’enregistrement.`} />
      <ExpenseReportEditor
        companyId={companyId}
        reportId={reportId}
        initial={formValuesOf(report)}
        canManage={can({ expenses: ['validate'] })}
        canReadReceipts={can({ banking: ['read'] })}
        mileageBaselines={report.mileageBaselines}
        vatExempt={report.vatExempt}
        deductionPercentByYear={report.deductionPercentByYear}
      />
    </div>
  )
}
