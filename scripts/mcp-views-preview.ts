/**
 * Static previews of the MCP Apps views (docs/mcp-views.md): one HTML page
 * per sample of lib/mcp/__tests__/view-samples.ts, each playing the host
 * (Claude, ChatGPT): it loads the real template in a sandboxed iframe,
 * answers its ui/initialize, sends the tool result, and simulates the tool
 * calls of the buttons (dry run, approval link, execution) without any
 * server. Open index.html in a browser.
 *
 *   pnpm tsx scripts/mcp-views-preview.ts [output directory]
 *
 * Default output: ../mcp-views-preview (outside the repository).
 */

import { mkdirSync, writeFileSync } from 'fs'
import path from 'path'
import { getAppUrl } from '@/lib/config'
import { viewHtml } from '@/lib/mcp/views'
import { viewSamples } from '@/lib/mcp/__tests__/view-samples'

const out = path.resolve(process.argv[2] ?? path.join(process.cwd(), '..', 'mcp-views-preview'))

/** JSON safe inside a script element. */
const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

const STYLE = `
:root{color-scheme:light dark;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;--bg:#f6f6f6;--fg:#171717;--muted:#666;--card:#fff;--border:#e5e5e5}
@media (prefers-color-scheme:dark){:root{--bg:#0f0f0f;--fg:#f2f2f2;--muted:#a3a3a3;--card:#171717;--border:#2a2a2a}}
body{margin:0;background:var(--bg);color:var(--fg)}
.wrap{max-width:880px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:18px;margin:0 0 4px}
p{color:var(--muted);margin:0 0 16px;font-size:13px}
.bar{display:flex;gap:8px;align-items:center;margin:0 0 12px;font-size:13px}
.bar button{font:inherit;border:1px solid var(--border);background:var(--card);color:var(--fg);border-radius:6px;padding:4px 10px;cursor:pointer}
.bubble{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:8px}
iframe{display:block;width:100%;border:0;height:200px}
#log{margin-top:16px;font:12px ui-monospace,Menlo,monospace;color:var(--muted);white-space:pre-wrap}
ul{padding-left:18px}li{margin:6px 0}a{color:inherit}
`

function hostPage(title: string, tool: string, template: string, data: unknown): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">
<h1>${title}</h1>
<p>Résultat de l'outil <code>${tool}</code> rendu par le modèle de vue, comme dans Claude ou ChatGPT. Hôte simulé\u00a0: les boutons appellent des outils fictifs, rien n'est envoyé.</p>
<div class="bar">Thème de l'hôte\u00a0: <button type="button" data-theme="light">Clair</button><button type="button" data-theme="dark">Sombre</button> Largeur\u00a0: <button type="button" data-width="360">Étroite</button><button type="button" data-width="">Pleine</button> <a href="index.html">Tous les aperçus</a></div>
<div class="bubble"><iframe id="view" sandbox="allow-scripts" title="${title}"></iframe></div>
<div id="log"></div>
</div>
<script>
(function () {
  var template = ${scriptJson(template)};
  var data = ${scriptJson(data)};
  var frame = document.getElementById('view');
  var log = document.getElementById('log');
  var theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  var counter = 0;
  function note(text) { log.textContent = 'Hôte\u00a0: ' + text + '\\n' + log.textContent; }
  function send(message) { frame.contentWindow.postMessage(message, '*'); }
  function reply(id, result) { send({ jsonrpc: '2.0', id: id, result: result }); }
  function text(value) { return { content: [{ type: 'text', text: JSON.stringify(value) }] }; }
  function simulate(name, args) {
    if (data.refresh && name === data.refresh.tool) return Object.assign(text({}), { structuredContent: data });
    if (name === 'validate_entries' || name === 'delete_draft_entry') {
      var ids = args.entryIds || [args.entryId];
      if (args.actionId) return text({ executed: true, result: { count: ids.length } });
      if (args.dryRun || data.executionMode === 'validation') {
        counter++;
        var preview = { entries: ids.map(function (id, i) { return { entryNumber: id, description: name === 'validate_entries' ? 'Brouillon' : 'À supprimer', numberToAssign: name === 'validate_entries' ? String(118 + i) : null }; }), warnings: [] };
        return data.executionMode === 'validation'
          ? text({ dryRun: true, preview: preview, actionId: 'act_demo_' + counter, approvalUrl: ${scriptJson(`${getAppUrl()}/approbations/demo`)}, expiresAt: '2026-10-05T12:00:00Z' })
          : text({ dryRun: true, preview: preview });
      }
      return text({ executed: true, result: { count: ids.length } });
    }
    return text({ ok: true });
  }
  window.addEventListener('message', function (event) {
    if (event.source !== frame.contentWindow) return;
    var m = event.data;
    if (!m || m.jsonrpc !== '2.0') return;
    if (m.method === 'ui/initialize') {
      reply(m.id, { protocolVersion: '2026-01-26', hostInfo: { name: 'kledg-preview', version: '1.0.0' }, hostCapabilities: { serverTools: {}, openLinks: {}, logging: {} }, hostContext: { theme: theme, displayMode: 'inline', locale: 'fr-FR', platform: 'web' } });
    } else if (m.method === 'ui/notifications/initialized') {
      send({ jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: { arguments: {} } });
      send({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: Object.assign(text({ note: 'texte JSON de l outil' }), { structuredContent: data }) });
    } else if (m.method === 'ui/notifications/size-changed') {
      if (m.params && m.params.height) frame.style.height = Math.min(4000, m.params.height) + 'px';
    } else if (m.method === 'tools/call') {
      note('tools/call ' + m.params.name + ' ' + JSON.stringify(m.params.arguments));
      setTimeout(function () { reply(m.id, simulate(m.params.name, m.params.arguments || {})); }, 400);
    } else if (m.method === 'ui/open-link') {
      note('ouvrirait ' + m.params.url);
      reply(m.id, {});
    } else if (m.method === 'ui/message') {
      note('message envoyé à l assistant\u00a0: ' + m.params.content[0].text);
      reply(m.id, {});
    } else if (m.method === 'ui/update-model-context') {
      note('contexte transmis à l assistant\u00a0: ' + m.params.content[0].text);
      reply(m.id, {});
    } else if (m.id !== undefined) {
      send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Non simulé' } });
    }
  });
  document.querySelectorAll('[data-theme]').forEach(function (b) {
    b.addEventListener('click', function () {
      theme = b.getAttribute('data-theme');
      send({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { theme: theme } });
    });
  });
  document.querySelectorAll('[data-width]').forEach(function (b) {
    b.addEventListener('click', function () {
      var width = b.getAttribute('data-width');
      frame.parentNode.style.maxWidth = width ? width + 'px' : '';
    });
  });
  frame.srcdoc = template;
})();
</script>
</body>
</html>
`
}

mkdirSync(out, { recursive: true })
const samples = viewSamples()
const items: string[] = []
for (const sample of samples) {
  const file = `${sample.name}.html`
  writeFileSync(path.join(out, file), hostPage(sample.data.title, sample.tool, viewHtml(sample.data.view), sample.data))
  items.push(`<li><a href="${file}">${sample.data.title}</a> <span style="color:var(--muted)">(${sample.tool}, modèle ${sample.data.view})</span></li>`)
}
writeFileSync(
  path.join(out, 'index.html'),
  `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Vues MCP de Kledg</title><style>${STYLE}</style></head>
<body><div class="wrap"><h1>Vues MCP de Kledg\u00a0: aperçus</h1><p>Données fictives, modèles réels (lib/mcp/views). Chaque page simule l'hôte MCP Apps.</p><ul>${items.join('')}</ul></div></body></html>
`,
)
console.log(`${samples.length} previews written to ${out}`)
