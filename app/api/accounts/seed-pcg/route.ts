import { NextResponse } from 'next/server'
import { z } from 'zod'
import { companyRoute, fromForm } from '@/lib/api/route'
import { seedPcgChart } from '@/lib/accounting/pcg-chart.service'

/** Multipart form (sent by the import dialog), read like a JSON body. */
const SeedPcgForm = z.object({
  fiscalYearId: z.string({ error: "L'exercice est requis" }).min(1, "L'exercice est requis"),
  includeOptionalAccounts: z.string().optional(),
})

/** Seeds the PCG accounts in the chart of a fiscal year of the company. */
export const POST = companyRoute(
  { company: fromForm(), permission: { ledger: ['manage'] }, multipart: true },
  async ({ request, companyId }) => {
    const form = SeedPcgForm.parse(Object.fromEntries(await request.formData()))
    await seedPcgChart(companyId, form.fiscalYearId, form.includeOptionalAccounts === 'true')
    return NextResponse.json({ success: true })
  },
)
