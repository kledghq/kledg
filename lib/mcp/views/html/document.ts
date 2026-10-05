/**
 * Template "document": the preview of one document recorded in Kledg (an
 * invoice, a credit note, an expense report): its parties, key facts,
 * lines, VAT breakdown and totals, laid out like the document. Read only:
 * the only button opens the document in Kledg.
 */

import type { TemplateSource } from './page'

export const DOCUMENT_TEMPLATE: TemplateSource = {
  title: 'Kledg : document',
  css: `
.k-doc{border:1px solid var(--k-border);border-radius:var(--k-radius);padding:16px;background:var(--k-bg)}
.k-doc-head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:8px 16px;margin-bottom:16px}
.k-parties{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:0 0 16px}
.k-party{border:1px solid var(--k-border);border-radius:var(--k-radius);padding:8px 10px}
.k-party-role{display:block;color:var(--k-muted);font-size:11px;text-transform:uppercase;letter-spacing:0.04em}
.k-party-name{display:block;font-weight:600;margin:2px 0}
.k-party-detail{display:block;color:var(--k-muted)}
.k-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px 16px;margin:0 0 16px}
.k-facts dt{color:var(--k-muted);font-size:11px}
.k-facts dd{margin:0;font-weight:500}
.k-doc h2{margin-top:16px}
.k-totals{margin:16px 0 0 auto;max-width:320px;width:100%}
.k-totals th{font-weight:400;color:var(--k-muted)}
.k-totals tr.k-total th{color:var(--k-fg)}
`,
  js: String.raw`
(function () {
  var K = window.Kledg;
  var el = K.el;

  K.view('document', function (data, root) {
    var doc = el('article', { class: 'k-doc', 'aria-label': data.title });
    doc.appendChild(el('div', { class: 'k-doc-head' }, [
      el('div', null, [el('h1', null, data.title), data.subtitle ? el('p', { class: 'k-sub' }, data.subtitle) : null]),
      el('span', { class: 'k-badge k-tone-' + data.status.tone }, data.status.label),
    ]));
    if (data.notice) doc.appendChild(el('p', { class: 'k-notice' }, data.notice));

    if (data.parties.length) {
      doc.appendChild(el('div', { class: 'k-parties' }, data.parties.map(function (p) {
        return el('section', { class: 'k-party', 'aria-label': p.role }, [
          el('span', { class: 'k-party-role' }, p.role),
          el('span', { class: 'k-party-name' }, p.name),
        ].concat(p.details.map(function (d) { return el('span', { class: 'k-party-detail' }, d); })));
      })));
    }

    if (data.facts.length) {
      var facts = el('dl', { class: 'k-facts' });
      data.facts.forEach(function (f) {
        facts.appendChild(el('div', null, [el('dt', null, f.label), el('dd', null, K.format(f.value, f.format || 'text'))]));
      });
      doc.appendChild(facts);
    }

    data.tables.forEach(function (t) {
      doc.appendChild(el('h2', null, t.title));
      doc.appendChild(el('table', { class: 'k-table' }, [
        el('caption', { class: 'k-sr' }, t.title),
        el('thead', null, el('tr', null, t.columns.map(function (c) { return el('th', { scope: 'col', class: c.align === 'end' || c.format === 'euros' ? 'k-num' : null }, c.label); }))),
        el('tbody', null, t.rows.map(function (r) {
          return el('tr', null, t.columns.map(function (c, i) {
            var td = K.cell(r[i] === undefined ? null : r[i], c.format, i === 0 ? 'th' : 'td');
            if (i === 0) td.setAttribute('scope', 'row');
            if (c.align === 'end') td.classList.add('k-num');
            return td;
          }));
        })),
      ]));
    });

    if (data.totals.length) {
      doc.appendChild(el('table', { class: 'k-table k-totals' }, [
        el('caption', { class: 'k-sr' }, 'Totaux'),
        el('tbody', null, data.totals.map(function (t) {
          return el('tr', { class: t.emphasis ? 'k-total' : null }, [el('th', { scope: 'row' }, t.label), K.cell(t.value, 'euros')]);
        })),
      ]));
    }
    root.appendChild(doc);
    K.footer(data).forEach(function (n) { root.appendChild(n); });
  });
})();
`,
}
