/**
 * Template "organigram": the structure of a group, one row per level
 * (shareholders, holding, subsidiaries), a card per person or company with
 * its holders and the holding's interest, and the holdings between them as
 * lines labelled with their percentage. Every card also says in words who
 * holds the company, and the table "Liens de détention" lists every line,
 * so the drawing is never the only way to read it.
 */

import type { TemplateSource } from './page'

export const ORGANIGRAM_TEMPLATE: TemplateSource = {
  title: 'Kledg\u00a0: organigramme',
  css: `
.k-org{position:relative;padding:4px 0}
.k-org-level{display:flex;flex-wrap:wrap;justify-content:center;gap:12px;margin:0 0 36px;padding:0;list-style:none;position:relative;z-index:1}
.k-org-level:last-child{margin-bottom:0}
.k-org-card{border:1px solid var(--k-border);border-radius:var(--k-radius);background:var(--k-bg);padding:8px 10px;min-width:160px;max-width:240px}
.k-org-card.k-holding{border-color:var(--k-fg)}
.k-org-card.k-hidden{border-style:dashed;color:var(--k-muted)}
.k-org-kind{display:block;color:var(--k-muted);font-size:11px;text-transform:uppercase;letter-spacing:0.04em}
.k-org-name{display:block;font-weight:600}
.k-org-meta{display:block;color:var(--k-muted);font-size:12px}
.k-org-lines{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0}
.k-org-lines path{fill:none;stroke:var(--k-muted);stroke-width:1.25}
.k-org-lines text{fill:var(--k-fg);font-size:11px;paint-order:stroke;stroke:var(--k-bg);stroke-width:4px}
`,
  js: String.raw`
(function () {
  var K = window.Kledg;
  var el = K.el;
  var KINDS = { holding: 'Holding', subsidiary: 'Société du groupe', person: 'Personne', company: 'Société actionnaire', other: 'Actionnaire', hidden: 'Non accessible' };

  K.view('organigram', function (data, root, api) {
    K.header(data).forEach(function (n) { root.appendChild(n); });
    if (!data.nodes.length) {
      root.appendChild(el('p', { class: 'k-empty' }, 'Aucune société dans ce groupe.'));
      K.footer(data).forEach(function (n) { root.appendChild(n); });
      return;
    }
    var levels = {};
    data.nodes.forEach(function (n) { (levels[n.level] = levels[n.level] || []).push(n); });
    var keys = Object.keys(levels).map(Number).sort(function (a, b) { return a - b; });
    var labels = {};
    data.nodes.forEach(function (n) { labels[n.id] = n.label; });

    var org = el('div', { class: 'k-org' });
    var lines = K.svg('svg', { class: 'k-org-lines', 'aria-hidden': 'true' });
    org.appendChild(lines);
    var cards = {};
    keys.forEach(function (level) {
      var row = el('ul', { class: 'k-org-level', 'aria-label': 'Niveau ' + (level + 1) });
      levels[level].sort(function (a, b) { return a.order - b.order; }).forEach(function (n) {
        var meta = [];
        if (n.legalType) meta.push(el('span', { class: 'k-org-meta' }, n.legalType));
        if (typeof n.interestPercent === 'number' && n.kind !== 'holding') meta.push(el('span', { class: 'k-org-meta' }, 'Détenue par le groupe\u00a0: ' + K.percent(n.interestPercent)));
        if (n.holders.length) {
          meta.push(el('span', { class: 'k-org-meta' }, 'Associés\u00a0: ' + n.holders.map(function (h) { return h.label + (typeof h.percent === 'number' ? ' (' + K.percent(h.percent) + ')' : ''); }).join(', ')));
        }
        if (n.officers.length) meta.push(el('span', { class: 'k-org-meta' }, 'Dirigeants\u00a0: ' + n.officers.join(', ')));
        var card = el('li', { class: 'k-org-card k-' + n.kind, 'data-node': n.id }, [
          el('span', { class: 'k-org-kind' }, KINDS[n.kind] || n.kind),
          el('span', { class: 'k-org-name' }, n.label),
        ].concat(meta));
        cards[n.id] = card;
        row.appendChild(card);
      });
      org.appendChild(row);
    });
    root.appendChild(org);

    function drawLines() {
      K.clear(lines);
      var box = org.getBoundingClientRect();
      if (!box.width || !box.height) return;
      lines.setAttribute('viewBox', '0 0 ' + box.width + ' ' + box.height);
      data.edges.forEach(function (e) {
        var a = cards[e.from], b = cards[e.to];
        if (!a || !b) return;
        var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        var x0 = ra.left + ra.width / 2 - box.left, y0 = ra.bottom - box.top;
        var x1 = rb.left + rb.width / 2 - box.left, y1 = rb.top - box.top;
        if (y1 <= y0) return;
        var mid = (y0 + y1) / 2;
        lines.appendChild(K.svg('path', { d: 'M' + x0 + ' ' + y0 + ' C' + x0 + ' ' + mid + ' ' + x1 + ' ' + mid + ' ' + x1 + ' ' + y1 }));
        if (typeof e.percent === 'number') {
          lines.appendChild(K.svg('text', { x: (x0 + x1) / 2, y: mid, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, K.percent(e.percent)));
        }
      });
    }
    drawLines();
    if (typeof ResizeObserver === 'function') new ResizeObserver(function () { drawLines(); api.resized(); }).observe(org);

    if (data.edges.length) {
      root.appendChild(el('details', null, [
        el('summary', null, 'Liens de détention'),
        el('table', { class: 'k-table' }, [
          el('caption', { class: 'k-sr' }, 'Liens de détention'),
          el('thead', null, el('tr', null, [el('th', { scope: 'col' }, 'Associé'), el('th', { scope: 'col' }, 'Société détenue'), el('th', { scope: 'col', class: 'k-num' }, 'Part'), el('th', { scope: 'col' }, 'Nature')])),
          el('tbody', null, data.edges.map(function (e) {
            return el('tr', null, [el('th', { scope: 'row' }, labels[e.from] || ''), el('td', null, labels[e.to] || ''), K.cell(e.percent, 'percent'), el('td', null, e.kind || '')]);
          })),
        ]),
      ]));
    }
    K.footer(data).forEach(function (n) { root.appendChild(n); });
  });
})();
`,
}
