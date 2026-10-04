/**
 * Full control tool on invoices: record a draft purchase or sales invoice,
 * optionally with its draft entry. A thin wrapper over
 * lib/invoices/manage-invoices.service.ts (totals computed on the server,
 * French VAT rates, tiers of the company, due date within L441-10) and
 * post-invoice.service.ts (fiscal year containing the date, accounts of
 * that year). Follows the connection's execution mode (approval in Kledg or
 * automatic): the dry run shows the totals the invoice would have.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { computeInvoiceTotals, parseQuantity, rateToBasisPoints } from '@/lib/invoices/amounts'
import { assertInvoiceAmountsFit, createInvoice } from '@/lib/invoices/manage-invoices.service'
import { postInvoice } from '@/lib/invoices/post-invoice.service'
import { fromCents, toCents } from '@/lib/utils/money'
import { fullControlTool, type RegisterTool } from './define'
import { ACTS_AS_USER, TWO_STEP } from './descriptions'

const input = {
  direction: z.enum(['SALE', 'PURCHASE']).describe('SALE: invoice issued to a customer (journal VE); PURCHASE: invoice received from a supplier (journal AC).'),
  tiers: z.string().min(1).max(64).describe('Tiers id or auxiliary account number, from list_tiers (a customer for a sale, a supplier for a purchase).'),
  number: z.string().min(1).max(60).describe('Invoice number as printed on the document.'),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format attendu\u00a0: AAAA-MM-JJ'),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format attendu\u00a0: AAAA-MM-JJ').optional().describe('Defaults to the payment terms of the tiers or the company.'),
  creditNote: z.boolean().default(false).describe('true for a credit note (avoir, type 381).'),
  label: z.string().max(500).optional(),
  lines: z
    .array(
      z.object({
        label: z.string().min(1).max(500),
        quantity: z.number().positive().max(1e9),
        unitPrice: z.number().min(0).max(1e11).describe('Unit price excluding tax, in euros, two decimals at most.'),
        vatRate: z.number().min(0).max(100).describe('VAT rate in percent: 20, 10, 5.5, 2.1 or 0 (also 13, 8.5, 1.75, 1.05, 0.9 for Corsica and overseas).'),
        accountCode: z.string().max(20).optional().describe('Expense (class 6), fixed asset (class 2) or revenue (class 7) account, from search_accounts.'),
        nature: z.enum(['GOODS', 'SERVICES']).default('SERVICES'),
        fixedAsset: z.boolean().default(false),
      }),
    )
    .min(1)
    .max(200),
  post: z.boolean().default(false).describe('true: also create its DRAFT entry (validated later by a person in Kledg).'),
}

type Args = z.infer<z.ZodObject<typeof input>> & { companyId: string }

async function resolveTiers(companyId: string, ref: string) {
  const tiers = await prisma.tiers.findFirst({
    where: { companyId, OR: [{ id: ref }, { auxiliaryAccountNumber: ref.toUpperCase() }] },
    select: { id: true, name: true, kind: true, auxiliaryAccountNumber: true },
  })
  if (!tiers) throw new NotFoundError('Tiers introuvable : utilisez list_tiers.')
  return tiers
}

function linesOf(args: Args) {
  return args.lines.map((line, i) => {
    const unitPriceCents = toCents(line.unitPrice)
    const vatRateBp = rateToBasisPoints(String(line.vatRate), 'percent')
    const quantity = parseQuantity(line.quantity)
    if (unitPriceCents === null || vatRateBp === null || quantity === null) {
      throw new ValidationError(`Ligne ${i + 1} : quantité (3 décimales), prix (2 décimales) ou taux de TVA invalide.`)
    }
    return { label: line.label, quantity: String(line.quantity), unitPriceCents, vatRateBp, accountCode: line.accountCode ?? null, nature: line.nature, fixedAsset: line.fixedAsset, quantityThousandths: quantity }
  })
}

const createDraftInvoiceTool = fullControlTool({
  name: 'create_draft_invoice',
  title: 'Enregistrer une facture',
  description: `Records a purchase or sales invoice in Kledg as a draft (brouillon), with its lines and several VAT rates: totals are computed by Kledg (VAT per rate on the sum of the line totals, CGI ann. II art. 242 nonies A). With post: true it also creates the DRAFT entry (AC or VE journal) in the fiscal year containing the invoice date; a person validates it in Kledg. Kledg records invoices, it does not issue or send them. ${ACTS_AS_USER} ${TWO_STEP} The dry run shows the totals and VAT breakdown.`,
  input,
  permission: { entries: ['create'] },
  confirmation: true,
  async preview(args) {
    const tiers = await resolveTiers(args.companyId, args.tiers)
    const lines = linesOf(args)
    const totals = computeInvoiceTotals(lines)
    assertInvoiceAmountsFit(totals)
    const problems: string[] = []
    if ((args.direction === 'SALE') !== (tiers.kind === 'CUSTOMER')) problems.push(args.direction === 'SALE' ? 'Une facture de vente s’adresse à un client.' : 'Une facture d’achat vient d’un fournisseur.')
    return {
      tiers,
      number: args.number,
      totalExclTax: fromCents(totals.totalExclTaxCents),
      totalVat: fromCents(totals.totalVatCents),
      totalInclTax: fromCents(totals.totalInclTaxCents),
      vatBreakdown: totals.breakdown.map((row) => ({ ratePercent: row.vatRateBp / 100, base: fromCents(row.baseCents), vat: fromCents(row.vatCents) })),
      willPost: args.post,
      problems,
    }
  },
  async execute(args) {
    const tiers = await resolveTiers(args.companyId, args.tiers)
    const invoice = await createInvoice(
      args.companyId,
      {
        direction: args.direction,
        tiersId: tiers.id,
        number: args.number,
        issueDate: args.issueDate,
        dueDate: args.dueDate ?? null,
        typeCode: args.creditNote ? '381' : '380',
        label: args.label ?? null,
        lines: linesOf(args).map((line) => ({ label: line.label, quantity: line.quantity, unitPriceCents: line.unitPriceCents, vatRateBp: line.vatRateBp, accountCode: line.accountCode, nature: line.nature, fixedAsset: line.fixedAsset })),
      },
      { source: 'mcp' },
    )
    const posted = args.post ? await postInvoice(args.companyId, invoice.id, { source: 'mcp' }) : null
    return {
      invoiceId: invoice.id,
      status: posted ? 'posted' : 'draft',
      totalInclTax: fromCents(invoice.totalInclTaxCents),
      entryId: posted?.entryId ?? null,
      message: posted
        ? 'Facture enregistrée et écriture créée en brouillon\u00a0: elle doit être validée dans Kledg.'
        : 'Facture enregistrée en brouillon\u00a0: comptabilisez-la dans Kledg (ou rappelez l’outil avec post: true).',
    }
  },
  audit: (args, result) => ({ invoiceId: result.invoiceId, number: args.number, direction: args.direction, entryId: result.entryId }),
})

export function registerInvoiceTools(register: RegisterTool) {
  register(createDraftInvoiceTool)
}
