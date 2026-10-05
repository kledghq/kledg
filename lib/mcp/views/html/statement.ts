/**
 * Template "statement": a financial statement as a table (bilan, compte de
 * résultat, balance générale): sections, subtotals, totals and one to six
 * amount columns (N and N-1, or debit, credit and balance). A filter box
 * appears on long statements.
 */

import type { TemplateSource } from './page'

export const STATEMENT_TEMPLATE: TemplateSource = {
  title: 'Kledg : état financier',
  css: `
.k-statement th.k-label{min-width:220px}
.k-statement .k-code{color:var(--k-muted);font-family:var(--k-mono);font-size:12px;margin-right:8px}
.k-statement tbody tr:hover th,.k-statement tbody tr:hover td{background:var(--k-surface)}
.k-statement tr[hidden]{display:none}
.k-note{margin-top:8px;font-size:12px}
`,
  js: String.raw`
(function () {
  var K = window.Kledg;
  var el = K.el;

  function valueCells(values, count) {
    var cells = [];
    for (var i = 0; i < count; i++) {
      var v = Array.isArray(values) ? values[i] : null;
      cells.push(K.cell(typeof v === 'number' ? v : null, 'euros'));
    }
    return cells;
  }

  function labelCell(row) {
    var th = el('th', { scope: 'row', class: 'k-label' }, [
      row.code ? el('span', { class: 'k-code' }, row.code) : null,
      row.label,
    ]);
    th.style.paddingLeft = 8 + (row.depth || 0) * 16 + 'px';
    return th;
  }

  K.view('statement', function (data, root) {
    var count = data.columns.length;
    root.appendChild(el('div', null, K.header(data)));

    var rowsTotal = 0;
    data.sections.forEach(function (s) { rowsTotal += s.rows.length; });

    var table = el('table', { class: 'k-table k-statement' });
    table.appendChild(el('caption', { class: 'k-sr' }, data.title));
    table.appendChild(el('thead', null, el('tr', null, [el('th', { scope: 'col' }, 'Poste')].concat(
      data.columns.map(function (c) { return el('th', { scope: 'col', class: 'k-num' }, c.label); })
    ))));

    var searchable = [];
    data.sections.forEach(function (section) {
      var body = el('tbody');
      body.appendChild(el('tr', { class: 'k-section' }, el('th', { scope: 'colgroup', colspan: count + 1 }, section.title)));
      section.rows.forEach(function (row) {
        var cls = row.kind === 'subtotal' ? 'k-subtotal' : row.kind === 'group' ? 'k-group' : null;
        var tr = el('tr', { class: cls }, [labelCell(row)].concat(row.kind === 'group' ? [el('td', { colspan: count })] : valueCells(row.values, count)));
        searchable.push({ row: tr, text: ((row.code || '') + ' ' + row.label).toLowerCase() });
        body.appendChild(tr);
      });
      if (section.total) {
        body.appendChild(el('tr', { class: 'k-total' }, [el('th', { scope: 'row' }, section.total.label)].concat(valueCells(section.total.values, count))));
      }
      table.appendChild(body);
    });

    if (Array.isArray(data.totals) && data.totals.length) {
      var foot = el('tfoot');
      data.totals.forEach(function (t) {
        foot.appendChild(el('tr', { class: t.emphasis ? 'k-total' : 'k-subtotal' }, [el('th', { scope: 'row' }, t.label)].concat(valueCells(t.values, count))));
      });
      table.appendChild(foot);
    }

    if (rowsTotal > 30) {
      var input = el('input', { type: 'search', class: 'k-input', placeholder: 'Filtrer par compte ou libellé', 'aria-label': 'Filtrer les lignes' });
      input.addEventListener('input', function () {
        var q = input.value.trim().toLowerCase();
        searchable.forEach(function (s) {
          if (!q || s.text.indexOf(q) !== -1) s.row.removeAttribute('hidden');
          else s.row.setAttribute('hidden', '');
        });
      });
      root.appendChild(el('div', { class: 'k-toolbar' }, input));
    }

    root.appendChild(table);
    if (data.hiddenZeroRows) {
      root.appendChild(el('p', { class: 'k-muted k-note' }, data.hiddenZeroRows + ' ligne' + (data.hiddenZeroRows > 1 ? 's' : '') + ' à zéro masquée' + (data.hiddenZeroRows > 1 ? 's' : '') + ' (présentes dans la réponse en texte).'));
    }
    K.footer(data).forEach(function (n) { root.appendChild(n); });
  });
})();
`,
}
