/**
 * Template "chart": a line or area chart over months or days (treasury,
 * cash forecast) with an optional threshold line, or a Sankey diagram of
 * flows (customers and suppliers of a company, money between the companies
 * of a group). Drawn in SVG by a few lines of code, no library. The chart
 * has a text alternative (aria-label) and its figures are in a table under
 * it ("Voir les données"), so colour is never the only way to read it.
 */

import { CHART_COLORS } from '../schemas'
import type { TemplateSource } from './page'

const colorClasses = CHART_COLORS.map((c) => `.k-s-${c}{stroke:var(--k-chart-${c})}.k-f-${c}{fill:var(--k-chart-${c})}.k-bg-${c}{background:var(--k-chart-${c})}`).join('\n')

export const CHART_TEMPLATE: TemplateSource = {
  title: 'Kledg\u00a0: graphique',
  css: `
.k-chart{width:100%;height:auto;display:block;overflow:visible}
.k-line{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.k-area{opacity:0.12;stroke:none}
.k-point{stroke:var(--k-bg);stroke-width:1.5}
.k-threshold{stroke:var(--k-muted);stroke-width:1.25;stroke-dasharray:5 4}
.k-zero{stroke:var(--k-muted);stroke-width:1}
.k-link{fill:none;stroke-opacity:0.5}
.k-link:hover{stroke-opacity:0.8}
.k-node{fill:var(--k-fg)}
.k-node-value{fill:var(--k-muted)}
.k-node-label{paint-order:stroke;stroke:var(--k-bg);stroke-width:3px;stroke-linejoin:round}
.k-node-name{font-weight:500}
.k-sankey{width:100%}
.k-sankey .k-chart{width:100%;max-width:100%;height:auto}
${colorClasses}
`,
  js: String.raw`
(function () {
  var K = window.Kledg;
  var el = K.el;
  var s = K.svg;

  function niceStep(span) {
    if (!(span > 0)) return 1;
    var raw = span / 4;
    var power = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var unit = raw / power;
    var nice = unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10;
    return nice * power;
  }

  /** Axis labels: "120 k€" above 10 000 €, else whole euros. */
  function axisLabel(value, big) {
    if (big) return K.number(value / 1000, 1) + '\u00a0k€';
    return K.number(value, 0) + '\u00a0€';
  }

  function xLabel(value, kind) {
    return kind === 'month' ? K.month(value) : K.date(value);
  }

  /** Axis label: "mars 2025", or "15/01" for a day (the full date is in the tooltip and the table). */
  function axisX(value, kind) {
    if (kind === 'month') return K.month(value);
    var m = /^\d{4}-(\d{2})-(\d{2})/.exec(value);
    return m ? m[2] + '/' + m[1] : value;
  }

  function legend(items) {
    return el('ul', { class: 'k-legend', 'aria-label': 'Légende' }, items.map(function (item) {
      return el('li', null, [item.dash ? el('span', { class: 'k-dash', 'aria-hidden': 'true' }) : el('span', { class: 'k-swatch k-bg-' + item.color, 'aria-hidden': 'true' }), item.label]);
    }));
  }

  function dataTable(caption, headers, rows) {
    var table = el('table', { class: 'k-table' }, [
      el('caption', { class: 'k-sr' }, caption),
      el('thead', null, el('tr', null, headers.map(function (h) { return el('th', { scope: 'col', class: h.numeric ? 'k-num' : null }, h.label); }))),
      el('tbody', null, rows.map(function (r) {
        return el('tr', null, r.map(function (c, i) { return i === 0 ? el('th', { scope: 'row' }, c.text) : el('td', { class: c.numeric ? 'k-num' + (c.negative ? ' k-neg' : '') : null }, c.text); }));
      })),
    ]);
    return el('details', null, [el('summary', null, 'Voir les données'), table]);
  }

  function lineChart(data, chart, root) {
    var W = 640, H = 260, L = 64, R = 16, T = 16, B = 30;
    var xs = [];
    var seen = {};
    chart.series.forEach(function (serie) {
      serie.points.forEach(function (p) { if (!seen[p.x]) { seen[p.x] = true; xs.push(p.x); } });
    });
    xs.sort();
    if (!xs.length) {
      root.appendChild(el('p', { class: 'k-empty' }, 'Aucune donnée sur la période.'));
      return;
    }
    var values = [0];
    chart.series.forEach(function (serie) { serie.points.forEach(function (p) { values.push(p.y); }); });
    if (chart.threshold) values.push(chart.threshold.value);
    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    if (min === max) max = min + 1;
    var step = niceStep(max - min);
    min = Math.floor(min / step) * step;
    max = Math.ceil(max / step) * step;
    var big = Math.max(Math.abs(min), Math.abs(max)) >= 10000;
    var x = function (i) { return xs.length === 1 ? L + (W - L - R) / 2 : L + (i * (W - L - R)) / (xs.length - 1); };
    var y = function (v) { return T + ((max - v) * (H - T - B)) / (max - min); };

    var graph = s('svg', { class: 'k-chart', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': data.summary });
    for (var t = min; t <= max + step / 2; t += step) {
      graph.appendChild(s('line', { class: t === 0 ? 'k-zero' : 'k-grid', x1: L, x2: W - R, y1: y(t), y2: y(t) }));
      graph.appendChild(s('text', { class: 'k-axis', x: L - 8, y: y(t), 'text-anchor': 'end', 'dominant-baseline': 'central' }, axisLabel(t, big)));
    }
    var every = Math.max(1, Math.ceil(xs.length / (chart.x === 'month' ? 8 : 7)));
    var lastIndex = xs.length - 1;
    xs.forEach(function (value, i) {
      // Every few labels, always the last one, never two too close.
      var shown = i === lastIndex || (i % every === 0 && (lastIndex - i >= every || lastIndex === 0));
      if (!shown) return;
      var anchor = xs.length > 1 && i === lastIndex ? 'end' : xs.length > 1 && i === 0 ? 'start' : 'middle';
      graph.appendChild(s('text', { class: 'k-axis', x: x(i), y: H - 8, 'text-anchor': anchor }, axisX(value, chart.x)));
    });
    if (chart.threshold) {
      var ty = y(chart.threshold.value);
      graph.appendChild(s('line', { class: 'k-threshold', x1: L, x2: W - R, y1: ty, y2: ty }));
      graph.appendChild(s('text', { class: 'k-axis', x: W - R, y: ty - 6, 'text-anchor': 'end' }, chart.threshold.label));
    }
    var index = {};
    xs.forEach(function (value, i) { index[value] = i; });
    chart.series.forEach(function (serie) {
      var points = serie.points.slice().sort(function (a, b) { return a.x < b.x ? -1 : a.x > b.x ? 1 : 0; });
      if (!points.length) return;
      var d = points.map(function (p, i) { return (i ? 'L' : 'M') + x(index[p.x]).toFixed(1) + ' ' + y(p.y).toFixed(1); }).join(' ');
      if (chart.kind === 'area') {
        var base = y(Math.max(min, Math.min(0, max)));
        graph.appendChild(s('path', { class: 'k-area k-f-' + serie.color, d: d + ' L' + x(index[points[points.length - 1].x]).toFixed(1) + ' ' + base.toFixed(1) + ' L' + x(index[points[0].x]).toFixed(1) + ' ' + base.toFixed(1) + ' Z' }));
      }
      graph.appendChild(s('path', { class: 'k-line k-s-' + serie.color, d: d }));
      points.forEach(function (p) {
        graph.appendChild(s('circle', { class: 'k-point k-f-' + serie.color, cx: x(index[p.x]), cy: y(p.y), r: points.length > 40 ? 2 : 3 }, s('title', null, serie.name + ', ' + xLabel(p.x, chart.x) + '\u00a0: ' + K.euros(p.y))));
      });
    });
    root.appendChild(graph);

    var items = chart.series.map(function (serie) { return { label: serie.name, color: serie.color }; });
    if (chart.threshold) items.push({ label: chart.threshold.label + ' (' + K.euros(chart.threshold.value) + ')', dash: true });
    root.appendChild(legend(items));
    root.appendChild(el('p', { class: 'k-sr' }, data.summary));

    var headers = [{ label: chart.x === 'month' ? 'Mois' : 'Jour' }].concat(chart.series.map(function (serie) { return { label: serie.name, numeric: true }; }));
    var rows = xs.map(function (value) {
      return [{ text: xLabel(value, chart.x) }].concat(chart.series.map(function (serie) {
        var point = null;
        serie.points.forEach(function (p) { if (p.x === value) point = p; });
        return { text: point ? K.euros(point.y) : '', numeric: true, negative: point && point.y < 0 };
      }));
    });
    root.appendChild(dataTable(data.title, headers, rows));
  }

  /** Width of a label in px: measured by the browser, estimated where it cannot (no layout). */
  function textWidth(text, cls) {
    var probe = document.getElementById('k-svg-ns');
    var node = s('text', { class: cls || null }, text);
    probe.appendChild(node);
    var width = typeof node.getComputedTextLength === 'function' ? node.getComputedTextLength() : 0;
    probe.removeChild(node);
    return width > 0 ? width : text.length * 6.4;
  }

  /** The text, cut with an ellipsis to fit max px (the full text goes in the title). */
  function fit(text, max, cls) {
    if (textWidth(text, cls) <= max) return text;
    var cut = text;
    while (cut.length > 1 && textWidth(cut + '…', cls) > max) cut = cut.slice(0, -1);
    return cut.replace(/\s+$/, '') + '…';
  }

  /**
   * Sankey laid out for its actual width: labels of the first column on the
   * left of their nodes, of the last column on the right, of a middle column
   * in a band above the flows; each node gets a slot at least as tall as its
   * two-line label (name, amount), so labels never overlap the flows nor each
   * other; names too long for the width are cut, in full in their title.
   */
  function drawSankey(data, chart, holder, available) {
    var NW = 10, GAP = 10, LINE = 14, LABEL_H = 2 * LINE + 2, PAD = 6;
    var W = Math.max(300, Math.min(960, Math.floor(available || 640)));
    var nodes = chart.nodes.map(function (n, i) { return { i: i, label: n.label, column: n.column, inflow: 0, outflow: 0, inUsed: 0, outUsed: 0 }; });
    var links = chart.links.filter(function (l) { return nodes[l.source] && nodes[l.target] && l.source !== l.target; });
    links.forEach(function (l) { nodes[l.source].outflow += l.value; nodes[l.target].inflow += l.value; });
    var used = nodes.filter(function (n) { return n.inflow > 0 || n.outflow > 0; });
    var columns = [];
    used.forEach(function (n) { n.value = Math.max(n.inflow, n.outflow); (columns[n.column] = columns[n.column] || []).push(n); });
    var indexes = [];
    columns.forEach(function (c, i) { if (c && c.length) indexes.push(i); });
    var first = indexes[0], last = indexes[indexes.length - 1];
    var middle = indexes.length > 2;

    // Labels: as wide as the longest of each side, within what the width leaves to the flows.
    var sideMax = Math.max(70, Math.min(220, (W - 2 * NW - (middle ? 200 : 140)) / 2));
    used.forEach(function (n) {
      n.amount = K.euros(n.value);
      var room = n.column === first || n.column === last ? sideMax : Math.min(220, W / 3);
      n.name = fit(n.label, room, 'k-node-name');
      n.labelWidth = Math.min(room, Math.max(textWidth(n.name, 'k-node-name'), textWidth(n.amount)));
    });
    var widest = function (column) { return (columns[column] || []).reduce(function (w, n) { return Math.max(w, n.labelWidth); }, 0); };
    var left = Math.ceil(widest(first)) + PAD + 2;
    var right = Math.ceil(widest(last)) + PAD + 2;
    var T = middle ? LABEL_H + 14 : 6, B = 6;

    var maxCount = 0;
    indexes.forEach(function (i) { maxCount = Math.max(maxCount, columns[i].length); });
    var bands = Math.max(200, maxCount * (LABEL_H + GAP));
    var scale = Infinity;
    indexes.forEach(function (i) {
      var total = columns[i].reduce(function (t, n) { return t + n.value; }, 0);
      scale = Math.min(scale, (bands - (columns[i].length - 1) * GAP) / total);
    });
    var height = 0;
    indexes.forEach(function (i) {
      var top = T;
      var span = Math.max(1, last - first);
      columns[i].forEach(function (n) {
        n.h = Math.max(2, n.value * scale);
        // Side labels need their slot; a middle label sits in the band above.
        var slot = n.column === first || n.column === last ? Math.max(n.h, LABEL_H) : n.h;
        n.x = left + ((i - first) * (W - left - right - NW)) / span;
        n.y = top + (slot - n.h) / 2;
        top += slot + GAP;
      });
      height = Math.max(height, top - GAP);
    });
    var H = Math.ceil(height + B);

    var graph = s('svg', { class: 'k-chart', viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img', 'aria-label': data.summary });
    links.forEach(function (l) {
      var a = nodes[l.source], b = nodes[l.target];
      var w = Math.max(1, l.value * scale);
      var sy = a.y + a.outUsed + w / 2;
      var ty = b.y + b.inUsed + w / 2;
      a.outUsed += w;
      b.inUsed += w;
      var x0 = a.x + NW, x1 = b.x, mid = (x0 + x1) / 2;
      var d = 'M' + x0.toFixed(1) + ' ' + sy.toFixed(1) + ' C' + mid.toFixed(1) + ' ' + sy.toFixed(1) + ' ' + mid.toFixed(1) + ' ' + ty.toFixed(1) + ' ' + x1.toFixed(1) + ' ' + ty.toFixed(1);
      graph.appendChild(s('path', { class: 'k-link k-s-' + l.color, d: d, 'stroke-width': w.toFixed(1) }, s('title', null, a.label + ' vers ' + b.label + (l.kind ? ' (' + l.kind + ')' : '') + ' : ' + K.euros(l.value))));
    });
    used.forEach(function (n) {
      var title = n.label + ' : ' + n.amount;
      graph.appendChild(s('rect', { class: 'k-node', x: n.x, y: n.y, width: NW, height: n.h, rx: 1 }, s('title', null, title)));
      var side = n.column === first ? 'left' : n.column === last ? 'right' : 'top';
      var anchor = side === 'left' ? 'end' : side === 'right' ? 'start' : 'middle';
      var x = side === 'left' ? n.x - PAD : side === 'right' ? n.x + NW + PAD : n.x + NW / 2;
      var y = side === 'top' ? n.y - 10 - LINE : n.y + n.h / 2 - LINE / 2 + 1;
      graph.appendChild(s('text', { class: 'k-node-label', x: x, y: y, 'text-anchor': anchor, 'dominant-baseline': 'central' }, [
        s('title', null, title),
        s('tspan', { class: 'k-node-name', x: x }, n.name),
        s('tspan', { class: 'k-node-value', x: x, dy: LINE }, n.amount),
      ]));
    });
    holder.appendChild(graph);
  }

  function sankey(data, chart, root, api) {
    var hasLinks = chart.links.some(function (l) { return chart.nodes[l.source] && chart.nodes[l.target] && l.source !== l.target; });
    if (!hasLinks) {
      root.appendChild(el('p', { class: 'k-empty' }, 'Aucun flux sur la période.'));
      return;
    }
    var holder = el('div', { class: 'k-sankey' });
    root.appendChild(holder);
    var drawnWidth = 0;
    var redraw = function () {
      var width = holder.clientWidth || 640;
      if (drawnWidth && Math.abs(width - drawnWidth) < 8) return;
      drawnWidth = width;
      K.clear(holder);
      drawSankey(data, chart, holder, width);
      api.resized();
    };
    redraw();
    if (typeof ResizeObserver === 'function') new ResizeObserver(redraw).observe(holder);
    if (Array.isArray(chart.legend) && chart.legend.length) root.appendChild(legend(chart.legend));
    root.appendChild(el('p', { class: 'k-sr' }, data.summary));
    var rows = chart.links.filter(function (l) { return chart.nodes[l.source] && chart.nodes[l.target]; }).map(function (l) {
      return [{ text: chart.nodes[l.source].label }, { text: chart.nodes[l.target].label }, { text: l.kind || '' }, { text: K.euros(l.value), numeric: true }];
    });
    root.appendChild(dataTable(data.title, [{ label: 'De' }, { label: 'Vers' }, { label: 'Nature' }, { label: 'Montant', numeric: true }], rows));
  }

  K.view('chart', function (data, root, api) {
    K.header(data).forEach(function (n) { root.appendChild(n); });
    var figures = K.figures(data.figures);
    if (figures) root.appendChild(figures);
    if (data.chart.kind === 'sankey') sankey(data, data.chart, root, api);
    else lineChart(data, data.chart, root);
    K.footer(data).forEach(function (n) { root.appendChild(n); });
  });
})();
`,
}
