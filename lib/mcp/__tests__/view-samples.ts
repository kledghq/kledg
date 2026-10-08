/**
 * Sample data of every view, built with the real builders from service
 * shaped inputs (lib/mcp/views/builders.ts): the jsdom render test
 * (views.test.ts) and the static previews (scripts/mcp-views-preview.ts)
 * read them. Fictitious companies and people.
 */

import type { BalanceSheetData, BalanceSheetLine } from '@/lib/reports/balance-sheet/types'
import type { IncomeStatementData, IncomeStatementLine } from '@/lib/reports/income-statement/types'
import type { TrialBalanceData } from '@/lib/reports/trial-balance/get-trial-balance.service'
import type { TiersFlowsReport } from '@/lib/reports/third-parties/get-third-party-reports.service'
import type { GroupView } from '@/lib/group/get-group-view.service'
import type { GroupTreasuryReport } from '@/lib/group/get-group-treasury.service'
import type { GroupStructureReport } from '@/lib/group/get-group-structure.service'
import type { ViewData } from '@/lib/mcp/views'
import type { UniqueMatch } from '@/lib/reconciliation/unique-match'
import {
  balanceSheetStatement,
  bankTransactionsList,
  entriesList,
  expenseReportDocument,
  groupFlowsChart,
  groupStructureOrganigram,
  groupTreasuryChart,
  incomeStatementStatement,
  invoiceDocument,
  missingReceiptsList,
  tiersFlowsChart,
  trialBalanceStatement,
} from '@/lib/mcp/views/builders'
import { receiptCaptureForm, receiptMatchView, receiptDoneView, type MatchOut, type ReceiptOut } from '@/lib/mcp/views/receipt'

const COMPANY = 'cmp_atelier'
const FY = { id: 'fy_2025', year: 2025, startDate: '2025-01-01', endDate: '2025-12-31' }
const ctx = { companyId: COMPANY, companyName: 'Atelier Lumen SAS', fiscalYear: FY, previousYear: 2024, variant: 'simplified' as const }

let lineId = 0
function bsLine(label: string, net: number, children?: BalanceSheetLine[]): BalanceSheetLine {
  lineId++
  return { id: `l${lineId}`, lineLabel: label, value: net, net, accounts: [], order: lineId, ...(children && { children }) }
}

function balanceSheets(): [BalanceSheetData, BalanceSheetData] {
  lineId = 0
  const make = (k: number): BalanceSheetData => {
    lineId = 0
    const actifLines = [
      bsLine('Actif immobilisé', 18400 * k, [bsLine('Immobilisations incorporelles', 2400 * k), bsLine('Immobilisations corporelles', 16000 * k), bsLine('Immobilisations financières', 0)]),
      bsLine('Actif circulant', 96250.4 * k, [bsLine('Stocks', 0), bsLine('Créances clients', 41200.4 * k), bsLine('Disponibilités', 55050 * k)]),
    ]
    const passifLines = [
      bsLine('Capitaux propres', 61450.4 * k, [bsLine('Capital social', 10000), bsLine('Réserves', 1000 * k), bsLine("Résultat de l'exercice", Math.round((61450.4 * k - 10000 - 1000 * k) * 100) / 100)]),
      bsLine('Dettes', 53200 * k, [bsLine('Emprunts', 20000 * k), bsLine('Dettes fournisseurs', 18200 * k), bsLine('Dettes fiscales et sociales', 15000 * k)]),
    ]
    const actifTotal = 114650.4 * k
    return {
      companyId: COMPANY,
      fiscalYearId: FY.id,
      reportVariant: 'simplified',
      actif: { label: 'Actif', lines: actifLines, total: actifTotal, netTotal: actifTotal },
      passif: { label: 'Passif', lines: passifLines, total: actifTotal, netTotal: actifTotal },
      actifTotal,
      passifTotal: actifTotal,
      generatedAt: new Date('2026-01-15T10:00:00Z'),
    }
  }
  return [make(1), make(0.8)]
}

function isLine(label: string, value: number, children?: IncomeStatementLine[]): IncomeStatementLine {
  lineId++
  return { id: `i${lineId}`, lineLabel: label, value, accounts: [], order: lineId, ...(children && { children }) }
}

function incomeStatements(): [IncomeStatementData, IncomeStatementData] {
  const make = (k: number): IncomeStatementData => {
    lineId = 0
    const produits = [isLine("Produits d'exploitation", 248000 * k, [isLine('Ventes de marchandises', 0), isLine('Production vendue (services)', 246500 * k), isLine("Subventions d'exploitation", 1500 * k)]), isLine('Produits financiers', 320 * k)]
    const charges = [
      isLine("Charges d'exploitation", 183869.6 * k, [isLine('Achats et charges externes', 61200 * k), isLine('Impôts et taxes', 2100 * k), isLine('Salaires et traitements', 88000 * k), isLine('Charges sociales', 30569.6 * k), isLine('Dotations aux amortissements', 2000 * k)]),
      isLine('Charges financières', 900 * k),
      isLine('Impôt sur les bénéfices', 13100 * k),
    ]
    const totalProduits = 248320 * k
    const totalCharges = 197869.6 * k
    return {
      companyId: COMPANY,
      fiscalYearId: FY.id,
      reportVariant: 'simplified',
      produits: { label: 'Produits', lines: produits, total: totalProduits },
      charges: { label: 'Charges', lines: charges, total: totalCharges },
      totalProduits,
      totalCharges,
      netResult: Math.round((totalProduits - totalCharges) * 100) / 100,
      intermediateResults: { resultatExploitation: Math.round((248000 - 183869.6) * k * 100) / 100, resultatFinancier: Math.round((320 - 900) * k * 100) / 100 },
      generatedAt: new Date('2026-01-15T10:00:00Z'),
    }
  }
  return [make(1), make(0.85)]
}

function trialBalance(): TrialBalanceData {
  const rows: Array<[string, string, number, number]> = [
    ['101000', 'Capital', 0, 10000],
    ['106100', 'Réserve légale', 0, 1000],
    ['164000', 'Emprunts auprès des établissements de crédit', 5000, 25000],
    ['218300', 'Matériel de bureau et informatique', 16000, 0],
    ['401000', 'Fournisseurs', 52000, 70200],
    ['411000', 'Clients', 296000, 254799.6],
    ['445660', 'TVA déductible sur autres biens et services', 9800, 9800],
    ['445710', 'TVA collectée', 49300, 49300],
    ['512000', 'Banque', 301250, 246200],
    ['530000', 'Caisse', 0, 0],
    ['604000', 'Achats de prestations de services', 61200, 0],
    ['641000', 'Rémunérations du personnel', 88000, 0],
    ['645000', 'Charges de sécurité sociale', 34249.6, 0],
    ['706000', 'Prestations de services', 0, 246500],
  ]
  const balances = rows.map(([code, label, debit, credit], i) => ({
    accountId: `a${i}`,
    code,
    label,
    openingDebit: 0,
    openingCredit: 0,
    movementDebit: debit,
    movementCredit: credit,
    closingDebit: debit > credit ? debit - credit : 0,
    closingCredit: credit > debit ? credit - debit : 0,
    debit,
    credit,
    balance: Math.round((debit - credit) * 100) / 100,
  }))
  const debit = balances.reduce((s, b) => s + b.debit, 0)
  const credit = balances.reduce((s, b) => s + b.credit, 0)
  return {
    fiscalYear: { id: FY.id, year: 2025, startDate: FY.startDate, endDate: FY.endDate, isClosed: false },
    balances,
    totals: { debit, credit, balance: Math.round((debit - credit) * 100) / 100 },
    period: { startDate: FY.startDate, endDate: FY.endDate },
  } as unknown as TrialBalanceData
}

function tiersFlows(): TiersFlowsReport {
  const side = (kind: 'customers' | 'suppliers', list: Array<[string, string, number]>) => {
    const tiers = list.map(([code, name, euros]) => ({ code, name, cents: Math.round(euros * 100), count: 1 }))
    return { kind, totalCents: tiers.reduce((s, t) => s + t.cents, 0), tiers, shown: tiers }
  }
  return {
    fiscalYear: { id: FY.id, year: 2025, startDate: FY.startDate, endDate: FY.endDate },
    company: { name: 'Atelier Lumen SAS' },
    customers: side('customers', [
      ['C00001', 'Maison Dupont', 98400],
      ['C00002', 'Studio Bérard', 61200],
      ['C00003', 'Librairie des Quais', 42000],
      ['C00004', 'Hôtel du Parc', 28100],
    ]),
    suppliers: side('suppliers', [
      ['F00001', 'Imprimerie Martin', 31200],
      ['F00002', 'Loyer SCI Lumen', 24000],
      ['F00003', 'Fournitures Lebrun', 9800],
    ]),
  } as unknown as TiersFlowsReport
}

const HOLDING = { id: 'cmp_holding', name: 'Lumen Holding' }
const members = [
  { id: 'cmp_holding', name: 'Lumen Holding' },
  { id: 'cmp_atelier', name: 'Atelier Lumen' },
  { id: 'cmp_studio', name: 'Studio Lumen' },
]

function groupView(): GroupView {
  const figures = (ca: number, cash: number) => ({ chiffreAffairesCents: ca, ebeCents: 0, resultatCents: 0, tresorerieCents: cash, capitauxPropresCents: 0, endettementCents: 0, totalBilanCents: 0 })
  return {
    holding: HOLDING,
    fiscalYear: { id: 'fy_h', year: 2025, startDate: FY.startDate, endDate: FY.endDate },
    members,
    unreachable: [],
    truncated: 0,
    combined: figures(61_200_000, 18_450_000),
    afterEliminations: figures(57_600_000, 18_450_000),
    eliminations: {
      operations: [
        { sellerId: 'cmp_holding', buyerId: 'cmp_atelier', categories: ['management_fee'], revenueCents: 2_400_000, chargeCents: 2_400_000, gapCents: 0 },
        { sellerId: 'cmp_holding', buyerId: 'cmp_studio', categories: ['management_fee'], revenueCents: 1_200_000, chargeCents: 1_200_000, gapCents: 0 },
      ],
      dividends: [{ receiverId: 'cmp_holding', payerId: 'cmp_atelier', cents: 3_000_000 }],
      balances: [{ creditorId: 'cmp_holding', debtorId: 'cmp_studio', categories: ['current_account'], receivableCents: 1_500_000, payableCents: 1_500_000, eliminatedCents: 1_500_000, gapCents: 0 }],
    },
    flows: [],
    treasury: [],
    titresParticipationCents: 0,
    warnings: [],
  } as unknown as GroupView
}

function groupTreasury(): GroupTreasuryReport {
  const months = ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12']
  const values = [182000, 171500, 158900, 166000, 149200, 131000, 118400, 96500, 104300, 122800, 139600, 184500]
  return {
    holding: HOLDING,
    fiscalYear: { id: 'fy_h', year: 2025, startDate: FY.startDate, endDate: FY.endDate },
    companies: [],
    totalsByCurrency: [{ currency: 'EUR', balanceCents: 18_450_000 }],
    ledgerTotalCents: 18_450_000,
    months: months.map((month, i) => ({ month, byCompany: {}, totalCents: values[i] * 100 })),
    currentAccounts: [],
    currentAccountLines: [],
    unreachable: [],
    truncated: 0,
    warnings: [],
  } as unknown as GroupTreasuryReport
}

function groupStructure(): GroupStructureReport {
  const node = (id: string, label: string, kind: string, level: number, order: number, extra: Record<string, unknown> = {}) => ({
    id,
    label,
    kind,
    level,
    order,
    photo: null,
    logo: null,
    slug: null,
    legalType: null,
    officers: [],
    holdingInterest: null,
    holders: [],
    ...extra,
  })
  return {
    holding: HOLDING,
    nodes: [
      node('p_claire', 'Claire Martin', 'person', 0, 0),
      node('p_hugo', 'Hugo Bérard', 'person', 0, 1),
      node('cmp_holding', 'Lumen Holding', 'holding', 1, 0, { legalType: 'SAS', officers: [{ name: 'Claire Martin', title: 'Présidente' }], holders: [{ nodeId: 'p_claire', label: 'Claire Martin', directBp: 7000, indirectBp: 0, totalBp: 7000 }, { nodeId: 'p_hugo', label: 'Hugo Bérard', directBp: 3000, indirectBp: 0, totalBp: 3000 }] }),
      node('cmp_atelier', 'Atelier Lumen', 'subsidiary', 2, 0, { legalType: 'SAS', holdingInterest: { directBp: 10000, indirectBp: 0, totalBp: 10000 }, holders: [{ nodeId: 'cmp_holding', label: 'Lumen Holding', directBp: 10000, indirectBp: 0, totalBp: 10000 }] }),
      node('cmp_studio', 'Studio Lumen', 'subsidiary', 2, 1, { legalType: 'SARL', holdingInterest: { directBp: 6000, indirectBp: 0, totalBp: 6000 }, holders: [{ nodeId: 'cmp_holding', label: 'Lumen Holding', directBp: 6000, indirectBp: 0, totalBp: 6000 }] }),
      node('hidden_1', 'Société non accessible', 'hidden', 2, 2),
    ],
    edges: [
      { id: 'e1', from: 'p_claire', to: 'cmp_holding', bp: 7000, kind: null },
      { id: 'e2', from: 'p_hugo', to: 'cmp_holding', bp: 3000, kind: null },
      { id: 'e3', from: 'cmp_holding', to: 'cmp_atelier', bp: 10000, kind: 'filiale' },
      { id: 'e4', from: 'cmp_holding', to: 'cmp_studio', bp: 6000, kind: 'filiale' },
      { id: 'e5', from: 'cmp_holding', to: 'hidden_1', bp: null, kind: null },
    ],
    levels: 3,
    unreachable: [{ id: 'x' }],
    warnings: [],
  } as unknown as GroupStructureReport
}

const entry = (id: string, number: string, date: string, description: string, status: 'draft' | 'validated', lines: Array<[string, string, number, number]>) => ({
  id,
  number,
  date,
  journal: status === 'draft' ? 'BQ' : 'VE',
  description,
  reference: null,
  status,
  lines: lines.map(([account, accountLabel, debit, credit]) => ({ account, accountLabel, debit: String(debit), credit: String(credit), label: null })),
})

export const SAMPLE_ENTRIES = [
  entry('e_1', 'BR-0042', '2025-11-28', 'Imprimerie Martin, facture 2025-118', 'draft', [['604000', 'Achats de prestations', 1500, 0], ['445660', 'TVA déductible', 300, 0], ['512000', 'Banque', 0, 1800]]),
  entry('e_2', 'BR-0041', '2025-11-27', 'Maison Dupont, règlement F-2025-071', 'draft', [['512000', 'Banque', 12480, 0], ['411000', 'Clients', 0, 12480]]),
  entry('e_3', 'BR-0040', '2025-11-25', 'Abonnement logiciel', 'draft', [['651000', 'Redevances pour logiciels', 49, 0], ['445660', 'TVA déductible', 9.8, 0], ['512000', 'Banque', 0, 58.8]]),
]

export const SAMPLE_TRANSACTIONS = [
  { id: 't_1', date: '2025-11-28', amount: '1800.00', side: 'debit', label: 'PRLV IMPRIMERIE MARTIN', counterpartyName: 'Imprimerie Martin', reconciled: false, bankAccount: 'Compte courant' },
  { id: 't_2', date: '2025-11-27', amount: '12480.00', side: 'credit', label: 'VIR MAISON DUPONT', counterpartyName: 'Maison Dupont', reconciled: false, bankAccount: 'Compte courant' },
  { id: 't_3', date: '2025-11-26', amount: '58.80', side: 'debit', label: 'CB LOGICIEL <img src=x onerror=alert(1)>', counterpartyName: null, reconciled: false, bankAccount: 'Compte courant' },
  { id: 't_4', date: '2025-11-25', amount: '35.88', side: 'debit', label: 'PRLV OVH SAS', counterpartyName: 'OVH', reconciled: false, bankAccount: 'Compte courant' },
]

/** Unique matches as lib/reconciliation/unique-match.ts returns them: t_2 has its entry, t_4 its only rule. */
export const SAMPLE_MATCHES = new Map<string, UniqueMatch>([
  [
    't_2',
    {
      kind: 'entry',
      transactionId: 't_2',
      entryId: 'e_412',
      lineId: 'l_412_1',
      ruleId: null,
      label: 'Écriture n° BQ-0412 du 27/11/2025 (Règlement F-2025-071 Maison Dupont)',
      amount: 12480,
      date: '2025-11-27',
      arguments: { transactionId: 't_2', entryId: 'e_412' },
    },
  ],
  [
    't_4',
    {
      kind: 'rule',
      transactionId: 't_4',
      entryId: null,
      lineId: null,
      ruleId: 'r_ovh',
      label: 'Règle « Hébergement OVH »\u00a0: écriture en brouillon 626000, 44566',
      amount: -35.88,
      date: '2025-11-25',
      arguments: {
        transactionId: 't_4',
        journalCode: 'BQ',
        date: '2025-11-25',
        description: 'OVH hébergement',
        lines: [
          { accountCode: '626000', debit: 29.9 },
          { accountCode: '44566', debit: 5.98 },
        ],
      },
    },
  ],
])

const SAMPLE_INVOICE = {
  id: 'inv_1',
  direction: 'SALE',
  number: 'F-2025-071',
  creditNote: false,
  issueDate: '2025-10-31',
  dueDate: '2025-11-30',
  tiers: { name: 'Maison Dupont', auxiliaryAccountNumber: 'C00001' },
  parties: { sellerSiren: '123456782', sellerVatNumber: 'FR32123456782', buyerSiren: '552100554', buyerVatNumber: 'FR40552100554' },
  status: 'paid',
  lines: [
    { label: 'Conception graphique, catalogue automne', quantity: '1', unitPrice: 6200, vatRatePercent: 20, totalExclTax: 6200, accountCode: '706000' },
    { label: 'Retouches photo', quantity: '12', unitPrice: 320, vatRatePercent: 20, totalExclTax: 3840, accountCode: '706000' },
    { label: 'Frais de déplacement', quantity: '1', unitPrice: 360, vatRatePercent: 20, totalExclTax: 360, accountCode: '708500' },
  ],
  vatBreakdown: [{ ratePercent: 20, base: 10400, vat: 2080 }],
  totalExclTax: 10400,
  totalVat: 2080,
  totalInclTax: 12480,
  paid: 12480,
  remaining: 0,
  lettering: 'AA',
  entry: { entryNumber: 'VE-0071' },
  payments: [{ amount: 12480, entryNumber: 'BQ-0412', date: '2025-11-27' }],
  source: 'MANUAL',
}

const SAMPLE_EXPENSE_REPORT = {
  id: 'ndf_1',
  number: 'NDF-2025-014',
  label: 'Salon du livre de Lyon',
  claimant: { name: 'Hugo Bérard', kind: 'DIRIGEANT', auxiliaryAccountNumber: 'S00002' },
  periodStart: '2025-11-01',
  periodEnd: '2025-11-30',
  status: 'submitted',
  returnNote: null,
  totalOwed: 412.6,
  recoverableVat: 21.3,
  charges: 391.3,
  lines: [
    { kind: 'EXPENSE', date: '2025-11-13', supplier: 'SNCF', label: 'Paris Lyon aller retour', categoryLabel: 'Transport', accountCode: '625100', amountPaid: 154, recoverableVat: 0, receipt: 'INVOICE' },
    { kind: 'EXPENSE', date: '2025-11-13', supplier: 'Brasserie Georges', label: 'Déjeuner client', categoryLabel: 'Repas d’affaires', accountCode: '625700', amountPaid: 86.6, recoverableVat: 7.87, receipt: 'RECEIPT' },
    { kind: 'MILEAGE', date: '2025-11-20', supplier: null, label: 'Visite atelier Villeurbanne', categoryLabel: 'Indemnités kilométriques', accountCode: '625100', amountPaid: 172, recoverableVat: 13.43, receipt: null, mileage: { distanceKm: 268 } },
  ],
  entry: null,
  lettering: null,
}

const MISSING = {
  period: { startDate: '2025-01-01', endDate: '2025-12-31' },
  threshold: 50,
  count: 2,
  total: 1858.8,
  truncated: false,
  transactions: [
    { id: 't_1', date: '2025-11-28', label: 'PRLV IMPRIMERIE MARTIN', counterparty: 'Imprimerie Martin', amount: 1800, bankAccount: 'Compte courant', reconciled: true },
    { id: 't_3', date: '2025-11-26', label: 'CB LOGICIEL', counterparty: null, amount: 58.8, bankAccount: 'Compte courant', reconciled: false },
  ],
}

export interface ViewSample {
  /** File name of the preview and test label. */
  name: string
  /** The tool that returns it. */
  tool: string
  data: ViewData
  /** Texts the rendered view must show. */
  expect: string[]
}

/** A staged receipt and its match, as file_receipt returns them (euros). */
export const SAMPLE_RECEIPT: ReceiptOut = {
  id: 'sr_1',
  fileName: 'ticket-boulangerie.jpg',
  contentType: 'image/jpeg',
  size: 182_340,
  status: 'staged',
  fields: { amount: 43.5, currency: 'EUR', date: '2026-10-03', merchant: 'Boulangerie du Marché', vat: [{ rate: 5.5, amount: 2.27 }], paymentMethod: null },
}

export const SAMPLE_RECEIPT_MATCH: MatchOut = {
  action: 'match',
  receipt: SAMPLE_RECEIPT,
  outcome: 'candidates',
  match: null,
  candidates: [
    { transactionId: 't_31', date: '2026-10-04', label: 'CB BOULANGERIE DU MARCHE', counterpartyName: null, amount: 43.5, bankAccountName: 'Qonto principal', sendsToBank: true, score: 0.8, reasons: ['Montant identique', 'Débitée 1\u00a0jour après'] },
    { transactionId: 't_32', date: '2026-10-05', label: 'CB BOUL. ST MARTIN', counterpartyName: null, amount: 43.5, bankAccountName: 'Banque Populaire', sendsToBank: false, score: 0.78, reasons: ['Montant identique', 'Débitée 2\u00a0jours après'] },
  ],
  reason: null,
  expenseProposal: { date: '2026-10-03', merchant: 'Boulangerie du Marché', amount: 43.5, category: 'MEALS', categoryLabel: 'Repas', accountCode: '6256', openDraft: { id: 'er_7', number: 'NDF-0007' }, needsEuroAmount: false },
}

const RECEIPT_CTX = { executionMode: 'validation' as const, canAttach: true, canExpense: true }

export function viewSamples(): ViewSample[] {
  const [bs, bsPrev] = balanceSheets()
  const [is, isPrev] = incomeStatements()
  const validation = { canAdmin: true, executionMode: 'validation' as const }
  return [
    { name: 'bilan', tool: 'get_balance_sheet', data: balanceSheetStatement(ctx, bs, bsPrev), expect: ['Bilan, Atelier Lumen SAS', 'Total actif', '114\u00a0650,40\u00a0€', 'Exercice 2024'] },
    { name: 'compte-de-resultat', tool: 'get_income_statement', data: incomeStatementStatement(ctx, is, isPrev), expect: ['Compte de résultat', 'Résultat net (bénéfice)', '50\u00a0450,40\u00a0€'] },
    { name: 'balance-generale', tool: 'get_trial_balance', data: trialBalanceStatement(COMPANY, 'Atelier Lumen SAS', trialBalance()), expect: ['Balance générale', 'Classe 4\u00a0: comptes de tiers', 'Total général', '411000'] },
    { name: 'flux-tiers', tool: 'get_tiers_flows', data: tiersFlowsChart(COMPANY, tiersFlows(), 'all'), expect: ['Flux avec les clients et fournisseurs', 'Maison Dupont', 'Facturé aux clients', '229\u00a0700,00\u00a0€'] },
    { name: 'flux-groupe', tool: 'get_group_view', data: groupFlowsChart(HOLDING.id, groupView()), expect: ['Flux entre les sociétés du groupe', 'Frais de gestion', 'Dividendes', 'Studio Lumen'] },
    { name: 'tresorerie-groupe', tool: 'get_group_treasury', data: groupTreasuryChart(HOLDING.id, groupTreasury()), expect: ['Trésorerie du groupe Lumen Holding', 'Soldes bancaires (EUR)', 'déc.\u00a02025'] },
    {
      name: 'prevision-tresorerie',
      tool: 'cash forecast (à brancher)',
      data: {
        view: 'chart',
        title: 'Prévision de trésorerie, Atelier Lumen SAS',
        subtitle: 'Solde bancaire prévu en fin de jour, 13 semaines',
        chart: {
          kind: 'line',
          x: 'date',
          series: [
            { name: 'Solde prévu', color: 'treasury', points: ['2025-12-01', '2025-12-15', '2026-01-01', '2026-01-15', '2026-02-01', '2026-02-15', '2026-03-01'].map((x, i) => ({ x, y: [55050, 41200, 28400, 9600, 14800, 22300, 31900][i] })) },
          ],
          threshold: { value: 15000, label: 'Seuil de sécurité' },
        },
        summary: 'Solde bancaire prévu du 01/12/2025 au 01/03/2026\u00a0: au plus bas 9 600,00 € le 15/01/2026, sous le seuil de sécurité de 15 000,00 €.',
        warnings: ['Le solde passe sous le seuil de sécurité autour du 15/01/2026.'],
      },
      expect: ['Prévision de trésorerie', 'Seuil de sécurité (15\u00a0000,00\u00a0€)', '15/01/2026'],
    },
    { name: 'brouillons', tool: 'list_entries', data: entriesList(COMPANY, validation, { companyId: COMPANY, status: 'draft', limit: 50 }, { year: 2025 }, SAMPLE_ENTRIES), expect: ['Écritures en brouillon', 'BR-0042', 'Valider la sélection', '1\u00a0800,00\u00a0€'] },
    { name: 'transactions', tool: 'list_bank_transactions', data: bankTransactionsList(COMPANY, { canAdmin: true, executionMode: 'automatic' }, { companyId: COMPANY, onlyUnreconciled: true, limit: 50 }, SAMPLE_TRANSACTIONS, SAMPLE_MATCHES), expect: ['Transactions à rapprocher', 'Proposer une écriture', 'Rapprocher', 'Correspondance\u00a0: Écriture n° BQ-0412', 'Règle « Hébergement OVH »', '-1\u00a0800,00\u00a0€', '<img src=x onerror=alert(1)>'] },
    { name: 'justificatifs', tool: 'list_missing_receipts', data: missingReceiptsList(COMPANY, { canAdmin: false, executionMode: 'validation' }, { companyId: COMPANY, limit: 50 }, MISSING), expect: ['Justificatifs manquants', 'Retrouver la pièce', '1\u00a0858,80\u00a0€'] },
    { name: 'facture', tool: 'get_invoice', data: invoiceDocument(COMPANY, SAMPLE_INVOICE), expect: ['Facture de vente n° F-2025-071', 'Maison Dupont', 'Total TTC', '12\u00a0480,00\u00a0€', 'Payée'] },
    { name: 'note-de-frais', tool: 'get_expense_report', data: expenseReportDocument(COMPANY, SAMPLE_EXPENSE_REPORT), expect: ['Note de frais n° NDF-2025-014', 'Hugo Bérard', 'Indemnités kilométriques, 268 km', '412,60\u00a0€', 'Soumise'] },
    { name: 'organigramme', tool: 'get_group_structure', data: groupStructureOrganigram(HOLDING.id, groupStructure()), expect: ['Structure du groupe Lumen Holding', 'Claire Martin', 'Studio Lumen', '60\u00a0%', 'Société non accessible'] },    { name: 'depot-justificatif', tool: 'capture_receipt', data: receiptCaptureForm(COMPANY, RECEIPT_CTX, { amount: 43.5, date: '2026-10-03', merchant: 'Boulangerie du Marché' }), expect: ['Déposer un justificatif', 'Prendre une photo', 'Choisir un fichier', 'Envoyer à Kledg'] },
    { name: 'justificatif-candidats', tool: 'file_receipt', data: receiptMatchView(COMPANY, RECEIPT_CTX, SAMPLE_RECEIPT_MATCH), expect: ['Transactions possibles', 'CB BOULANGERIE DU MARCHE', '43,50\u00a0€', 'Envoyé à Qonto', 'Conservé par Kledg', 'Est-ce une note de frais\u00a0?', 'NDF-0007', 'Créer la note de frais'] },
    { name: 'justificatif-depose', tool: 'stage_receipt', data: receiptCaptureForm(COMPANY, RECEIPT_CTX, {}, { ...SAMPLE_RECEIPT, fields: { ...SAMPLE_RECEIPT.fields, amount: null, date: null } }), expect: ['Justificatif déposé', 'Rechercher la transaction'] },
    { name: 'justificatif-note-de-frais', tool: 'file_receipt (expense)', data: receiptDoneView(COMPANY, RECEIPT_CTX, { kind: 'expense', receipt: { ...SAMPLE_RECEIPT, status: 'expense' }, message: 'Ligne ajoutée à la note de frais NDF-0007 en brouillon\u00a0: vérifiez-la et soumettez-la dans Kledg.', link: { label: 'Ouvrir la note de frais NDF-0007', page: 'expense-reports/er_7' } }), expect: ['Note de frais préparée', 'NDF-0007', 'Ouvrir la note de frais NDF-0007'] },
  ]
}
