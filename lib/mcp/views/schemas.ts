/**
 * Data of the MCP Apps views (docs/mcp-views.md): the `structuredContent`
 * a wired tool returns besides its unchanged JSON text, which the view
 * template of the tool renders inside the assistant. One schema per
 * template; every builder's output is parsed with it before it leaves the
 * server (withView, lib/mcp/views/index.ts), so a template only ever reads
 * data of the shape it expects.
 *
 * Amounts are numbers in euros like the rest of the MCP server; templates
 * format them in French (1 234,56 €). Strings are plain text: templates
 * write them with textContent, never as HTML.
 */

import { z } from 'zod'

const text = z.string().max(2000)
const label = z.string().max(500)
const amount = z.number().finite()

/** Colour tokens of the charts, the same as app/globals.css (--chart-*). */
export const CHART_COLORS = [
  'treasury',
  'revenue',
  'expenses',
  'balance',
  'flow-customer',
  'flow-supplier',
  'flow-dividend',
  'flow-management-fee',
  'flow-invoice',
  'flow-loan',
  'flow-current-account',
  'flow-trade',
] as const
export const chartColor = z.enum(CHART_COLORS)
export type ChartColor = z.infer<typeof chartColor>

/** A link to a page of Kledg, opened by the host (ui/open-link), never fetched by the view. */
export const viewLink = z.object({
  label,
  url: z.string().max(2000).regex(/^https?:\/\/[^\s]+$/),
})

/** Fields every view has. */
const base = {
  title: label,
  subtitle: text.optional(),
  /** A sentence shown above the content (indicative figures, scope). */
  notice: text.optional(),
  warnings: z.array(text).max(50).optional(),
  links: z.array(viewLink).max(10).optional(),
}

/** How a cell is written: euros, a day (yyyy-mm-dd), a month (yyyy-mm), a percentage or plain text. */
export const cellFormat = z.enum(['text', 'euros', 'date', 'month', 'percent', 'number'])

// ---------------------------------------------------------------- statement

const values = z.array(amount.nullable()).max(6)

export const statementRow = z.object({
  label,
  /** Account number or form code, shown before the label. */
  code: z.string().max(40).nullable().optional(),
  /** Indentation level, 0 at the top. */
  depth: z.number().int().min(0).max(8),
  /** line: a plain line; subtotal: a line that sums the lines below it; group: a heading without amounts. */
  kind: z.enum(['line', 'subtotal', 'group']),
  values,
})

export const statementView = z.object({
  view: z.literal('statement'),
  ...base,
  /** Amount columns (N, N-1, or debit, credit, balance). */
  columns: z.array(z.object({ label })).min(1).max(6),
  sections: z
    .array(
      z.object({
        title: label,
        rows: z.array(statementRow).max(5000),
        total: z.object({ label, values }).optional(),
      }),
    )
    .max(20),
  /** Results below the sections (résultat net, totals). */
  totals: z.array(z.object({ label, values, emphasis: z.boolean().optional() })).max(10).optional(),
  /** Rows left out because every amount is zero (the text result keeps them). */
  hiddenZeroRows: z.number().int().min(0).optional(),
})

// -------------------------------------------------------------------- chart

const lineChart = z.object({
  kind: z.enum(['line', 'area']),
  /** What the x values are: a month (yyyy-mm) or a day (yyyy-mm-dd). */
  x: z.enum(['month', 'date']),
  series: z
    .array(
      z.object({
        name: label,
        color: chartColor,
        points: z.array(z.object({ x: z.string().max(10), y: amount })).max(400),
      }),
    )
    .min(1)
    .max(6),
  /** A horizontal reference line (a minimum cash level, zero). */
  threshold: z.object({ value: amount, label }).optional(),
})

const sankeyChart = z.object({
  kind: z.literal('sankey'),
  /** column 0 on the left; links go from a lower column to a higher one. */
  nodes: z.array(z.object({ label, column: z.number().int().min(0).max(4) })).max(60),
  links: z
    .array(
      z.object({
        source: z.number().int().min(0),
        target: z.number().int().min(0),
        value: z.number().positive().finite(),
        color: chartColor,
        /** Nature of the flow, for the table and the tooltip. */
        kind: label.optional(),
      }),
    )
    .max(200),
  legend: z.array(z.object({ label, color: chartColor })).max(12),
})

export const chartView = z.object({
  view: z.literal('chart'),
  ...base,
  chart: z.discriminatedUnion('kind', [lineChart, sankeyChart]),
  /** Text alternative of the chart, read by screen readers and shown under it. */
  summary: text,
  /** Key figures shown above the chart. */
  figures: z.array(z.object({ label, value: amount, format: z.enum(['euros', 'percent', 'number']).optional() })).max(8).optional(),
})

// ------------------------------------------------------------ actionable list

const toolName = z.string().regex(/^[a-z][a-z0-9_]{1,63}$/)
const toolArguments = z.record(z.string(), z.unknown())

export const viewAction = z.discriminatedUnion('kind', [
  /**
   * Calls a tool of this server through the host (tools/call): the server
   * checks the connection, the company and the role, and a high-impact tool
   * follows the execution mode (approval in Kledg in validation mode).
   */
  z.object({
    kind: z.literal('tool'),
    label,
    tool: toolName,
    arguments: toolArguments,
    /** The tool follows the execution mode: the view asks for the dry run first. */
    highImpact: z.boolean(),
    /** Question asked before a direct (not high-impact) call. */
    confirm: text.optional(),
    /** Destroys something (a draft): drawn in red. */
    danger: z.boolean().optional(),
  }),
  /** Sends a message to the assistant as the user (ui/message), who then works with the tools. */
  z.object({ kind: z.literal('message'), label, prompt: text }),
  /** Opens a page of Kledg (ui/open-link). */
  z.object({ kind: z.literal('link'), label, url: viewLink.shape.url }),
])

export const actionsView = z.object({
  view: z.literal('actions'),
  ...base,
  /** Execution mode of the connection's full control, null without full control. */
  executionMode: z.enum(['validation', 'automatic']).nullable(),
  columns: z
    .array(z.object({ key: z.string().max(40), label, format: cellFormat, align: z.enum(['start', 'end']).optional() }))
    .min(1)
    .max(10),
  items: z
    .array(
      z.object({
        id: z.string().max(100),
        cells: z.record(z.string(), z.union([z.string().max(2000), amount, z.null()])),
        /** Lines of the item (the lines of an entry), shown on demand. */
        breakdown: z
          .array(z.object({ label, debit: amount.nullable(), credit: amount.nullable() }))
          .max(200)
          .optional(),
        /** Whether the bulk action can take this item. */
        selectable: z.boolean().optional(),
        actions: z.array(viewAction).max(6),
      }),
    )
    .max(500),
  /** One call for the selected items: `argument` receives the list of their ids. */
  bulk: z
    .object({ label, tool: toolName, argument: z.string().max(40), arguments: toolArguments, highImpact: z.boolean() })
    .optional(),
  /** Calls the same tool again to show fresh data. */
  refresh: z.object({ tool: toolName, arguments: toolArguments }).optional(),
  figures: z.array(z.object({ label, value: z.union([amount, z.string().max(200)]), format: cellFormat })).max(6).optional(),
  /** Sentence shown when there is no item. */
  empty: text,
})

// ----------------------------------------------------------------- document

export const documentView = z.object({
  view: z.literal('document'),
  ...base,
  kind: z.enum(['invoice', 'credit_note', 'expense_report']),
  status: z.object({ label, tone: z.enum(['neutral', 'info', 'warning', 'success', 'danger']) }),
  parties: z.array(z.object({ role: label, name: label, details: z.array(label).max(6) })).max(3),
  facts: z.array(z.object({ label, value: label, format: cellFormat.optional() })).max(12),
  tables: z
    .array(
      z.object({
        title: label,
        columns: z.array(z.object({ label, format: cellFormat, align: z.enum(['start', 'end']).optional() })).min(1).max(8),
        rows: z.array(z.array(z.union([z.string().max(2000), amount, z.null()]))).max(500),
      }),
    )
    .max(4),
  totals: z.array(z.object({ label, value: amount, emphasis: z.boolean().optional() })).max(8),
})

// --------------------------------------------------------------- organigram

export const organigramView = z.object({
  view: z.literal('organigram'),
  ...base,
  nodes: z
    .array(
      z.object({
        id: z.string().max(200),
        label,
        kind: z.enum(['holding', 'subsidiary', 'person', 'company', 'other', 'hidden']),
        /** Row of the chart: shareholders above (0), the holding below them, then its subsidiaries. */
        level: z.number().int().min(0).max(20),
        order: z.number().int().min(0),
        legalType: z.string().max(40).nullable(),
        /** The holding's total interest in this company, in percent. */
        interestPercent: z.number().min(0).max(100).nullable(),
        holders: z.array(z.object({ label, percent: z.number().min(0).max(100).nullable() })).max(50),
        officers: z.array(label).max(20),
      }),
    )
    .max(200),
  edges: z
    .array(z.object({ from: z.string().max(200), to: z.string().max(200), percent: z.number().min(0).max(100).nullable(), kind: label.nullable() }))
    .max(400),
})

export const VIEW_SCHEMAS = {
  statement: statementView,
  chart: chartView,
  actions: actionsView,
  document: documentView,
  organigram: organigramView,
} as const

export type ViewName = keyof typeof VIEW_SCHEMAS
export type StatementView = z.infer<typeof statementView>
export type StatementRow = z.infer<typeof statementRow>
export type ChartView = z.infer<typeof chartView>
export type ActionsView = z.infer<typeof actionsView>
export type ViewAction = z.infer<typeof viewAction>
export type DocumentView = z.infer<typeof documentView>
export type OrganigramView = z.infer<typeof organigramView>
export type ViewData = StatementView | ChartView | ActionsView | DocumentView | OrganigramView
