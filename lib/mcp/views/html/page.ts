/**
 * Assembles a view template: one self-contained HTML5 document (inline CSS
 * and scripts, no external resource), served as an MCP Apps UI resource
 * (text/html;profile=mcp-app). The Content-Security-Policy meta tag repeats
 * what the resource declares to the host (no connection, no external
 * resource, no frame): the host enforces its own CSP, this one is a second
 * lock if a host is laxer than the specification.
 */

import { BASE_CSS, RUNTIME_JS } from './runtime'

export const VIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data:',
  'font-src data:',
  "connect-src 'none'",
  "media-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

export interface TemplateSource {
  /** Title of the document (the host may show it). */
  title: string
  /** CSS of the template, after the shared CSS. */
  css: string
  /** Script of the template: calls Kledg.view(name, render). */
  js: string
}

export function buildPage(source: TemplateSource): string {
  return [
    '<!DOCTYPE html>',
    '<html lang="fr">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="${VIEW_CSP}">`,
    `<title>${source.title}</title>`,
    `<style>${BASE_CSS}${source.css}</style>`,
    '</head>',
    '<body>',
    // Parsed as SVG by the HTML parser: the runtime reads the SVG namespace from it.
    '<svg id="k-svg-ns" class="k-sr" aria-hidden="true" focusable="false" width="0" height="0"></svg>',
    '<main id="app" aria-live="polite"></main>',
    `<script>${RUNTIME_JS}</script>`,
    `<script>${source.js}</script>`,
    '</body>',
    '</html>',
    '',
  ].join('\n')
}
