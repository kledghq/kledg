/**
 * Interactive views of the MCP server (MCP Apps, docs/mcp-views.md).
 *
 * A wired tool declares its template in `_meta.ui.resourceUri` (viewMeta)
 * and returns, besides its unchanged JSON text, a `structuredContent` the
 * template renders (withView). The templates are UI resources
 * (`ui://kledg/...`, mime type text/html;profile=mcp-app) registered on the
 * server by registerKledgViews; a host that supports MCP Apps (Claude,
 * ChatGPT...) renders them in a sandboxed iframe, a host that does not
 * shows the text, as before.
 *
 * Five data-driven templates serve every wired tool: statement, chart,
 * actions, document and organigram (lib/mcp/views/html).
 */

import type { McpServer } from '@modelcontextprotocol/server'
import { logger } from '@/lib/logger'
import type { ToolResult } from '@/lib/mcp/tool-result'
import { VIEW_SCHEMAS, type ViewData, type ViewName } from './schemas'
import { buildPage, type TemplateSource } from './html/page'
import { STATEMENT_TEMPLATE } from './html/statement'
import { CHART_TEMPLATE } from './html/chart'
import { ACTIONS_TEMPLATE } from './html/actions'
import { DOCUMENT_TEMPLATE } from './html/document'
import { ORGANIGRAM_TEMPLATE } from './html/organigram'

export type { ViewData, ViewName } from './schemas'

/** Mime type of an MCP Apps HTML resource (SEP-1865). */
export const VIEW_MIME_TYPE = 'text/html;profile=mcp-app'

/**
 * Version of the templates, in their URI: hosts may cache a resource, so a
 * change of the data contract or of the templates that an old cached copy
 * would render wrongly bumps it.
 */
export const VIEWS_VERSION = 1

/** What the resources ask of the host: no connection, no external resource, no frame; a border. */
export const VIEW_RESOURCE_META = {
  ui: {
    csp: { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] },
    prefersBorder: true,
  },
} as const

interface ViewDefinition {
  uri: string
  title: string
  description: string
  source: TemplateSource
}

const uriOf = (name: ViewName) => `ui://kledg/${name}.v${VIEWS_VERSION}.html`

export const VIEWS: Record<ViewName, ViewDefinition> = {
  statement: {
    uri: uriOf('statement'),
    title: 'État financier',
    description: 'Bilan, compte de résultat ou balance générale en tableau : sections, sous-totaux, totaux, colonnes N et N-1.',
    source: STATEMENT_TEMPLATE,
  },
  chart: {
    uri: uriOf('chart'),
    title: 'Graphique',
    description: 'Courbe de trésorerie (avec un seuil) ou diagramme des flux (clients et fournisseurs, sociétés du groupe).',
    source: CHART_TEMPLATE,
  },
  actions: {
    uri: uriOf('actions'),
    title: 'Liste à traiter',
    description: 'Transactions à rapprocher, brouillons à valider, justificatifs manquants, avec des boutons qui passent par les outils de Kledg (approbation dans Kledg inchangée).',
    source: ACTIONS_TEMPLATE,
  },
  document: {
    uri: uriOf('document'),
    title: 'Document',
    description: 'Aperçu d’une facture, d’un avoir ou d’une note de frais.',
    source: DOCUMENT_TEMPLATE,
  },
  organigram: {
    uri: uriOf('organigram'),
    title: 'Organigramme du groupe',
    description: 'Associés, holding et filiales avec les pourcentages de détention.',
    source: ORGANIGRAM_TEMPLATE,
  },
}

const pages = new Map<ViewName, string>()

/** The HTML document of a template (built once per instance). */
export function viewHtml(name: ViewName): string {
  let html = pages.get(name)
  if (!html) {
    html = buildPage(VIEWS[name].source)
    pages.set(name, html)
  }
  return html
}

/**
 * `_meta` of a tool rendered by a template: the MCP Apps key, the flat key
 * of the earlier drafts that some hosts still read, and the ChatGPT alias.
 */
export function viewMeta(name: ViewName): Record<string, unknown> {
  const uri = VIEWS[name].uri
  return { ui: { resourceUri: uri }, 'ui/resourceUri': uri, 'openai/outputTemplate': uri }
}

/** Registers the templates as UI resources (once per server, besides the tools). */
export function registerKledgViews(server: Pick<McpServer, 'registerResource'>): void {
  for (const [name, view] of Object.entries(VIEWS) as Array<[ViewName, ViewDefinition]>) {
    server.registerResource(
      `view-${name}`,
      view.uri,
      { title: view.title, description: view.description, mimeType: VIEW_MIME_TYPE, _meta: VIEW_RESOURCE_META },
      (uri) => ({ contents: [{ uri: uri.href, mimeType: VIEW_MIME_TYPE, text: viewHtml(name), _meta: VIEW_RESOURCE_META }] }),
    )
  }
}

/** Parses view data with the schema of its template; throws when it does not match. */
export function parseViewData(data: ViewData): ViewData {
  return VIEW_SCHEMAS[data.view].parse(data) as ViewData
}

/**
 * The tool result with the data of its view. The text is untouched; when
 * the view data cannot be built or does not match its schema, the result
 * goes out without it (the host then shows the text), never as an error.
 */
export async function withView(result: ToolResult, build: () => ViewData | Promise<ViewData>): Promise<ToolResult> {
  if (result.isError) return result
  try {
    const data = parseViewData(await build())
    return { ...result, structuredContent: data as unknown as Record<string, unknown> }
  } catch (error) {
    logger.error('[mcp-views] view data left out', error)
    return result
  }
}
