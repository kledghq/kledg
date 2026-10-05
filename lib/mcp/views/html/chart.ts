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
  title: 'Kledg : graphique',
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
        graph.appendChild(s('circle', { class: 'k-point k-f-' + serie.color, cx: x(index[p.x]), cy: y(p.y), r: points.length > 40 ? 2 : 3 }, s('title', null, serie.name + ', ' + xLabel(p.x, chart.x) + ' : ' + K.euros(p.y))));
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

  function sankey(data, chart, root) {
    var nodes = chart.nodes.map(function (n, i) { return { i: i, label: n.label, column: n.column, inflow: 0, outflow: 0, inUsed: 0, outUsed: 0 }; });
    var links = chart.links.filter(function (l) { return nodes[l.source] && nodes[l.target] && l.source !== l.target; });
    if (!links.length) {
      root.appendChild(el('p', { class: 'k-empty' }, 'Aucun flux sur la période.'));
      return;
    }
    links.forEach(function (l) { nodes[l.source].outflow += l.value; nodes[l.target].inflow += l.value; });
    var used = nodes.filter(function (n) { return n.inflow > 0 || n.outflow > 0; });
    var columns = [];
    used.forEach(function (n) { (columns[n.column] = columns[n.column] || []).push(n); });
    var columnIndexes = [];
    columns.forEach(function (c, i) { if (c && c.length) columnIndexes.push(i); });
    var maxCount = 0;
    columnIndexes.forEach(function (i) { maxCount = Math.max(maxCount, columns[i].length); });
    var W = 640, NW = 10, GAP = 18, T = 24, B = 12;
    var H = Math.max(220, maxCount * 46 + T + B);
    var scale = Infinity;
    columnIndexes.forEach(function (i) {
      var total = 0;
      columns[i].forEach(function (n) { n.value = Math.max(n.inflow, n.outflow); total += n.value; });
      var room = H - T - B - (columns[i].length - 1) * GAP;
      scale = Math.min(scale, room / total);
    });
    var first = columnIndexes[0];
    var last = columnIndexes[columnIndexes.length - 1];
    var span = Math.max(1, last - first);
    columnIndexes.forEach(function (i) {
      var height = 0;
      columns[i].forEach(function (n) { n.h = Math.max(2, n.value * scale); height += n.h; });
      height += (columns[i].length - 1) * GAP;
      var top = T + (H - T - B - height) / 2;
      columns[i].forEach(function (n) {
        n.x = 8 + ((i - first) * (W - 16 - NW)) / span;
        n.y = top;
        top += n.h + GAP;
      });
    });

    var graph = s('svg', { class: 'k-chart', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': data.summary });
    links.forEach(function (l) {
      var a = nodes[l.source], b = nodes[l.target];
      var w = Math.max(1, l.value * scale);
      var sy = a.y + a.outUsed + w / 2;
      var ty = b.y + b.inUsed + w / 2;
      a.outUsed += w;
      b.inUsed += w;
      var x0 = a.x + NW, x1 = b.x, mid = (x0 + x1) / 2;
      var d = 'M' + x0.toFixed(1) + ' ' + sy.toFixed(1) + ' C' + mid.toFixed(1) + ' ' + sy.toFixed(1) + ' ' + mid.toFixed(1) + ' ' + ty.toFixed(1) + ' ' + x1.toFixed(1) + ' ' + ty.toFixed(1);
      graph.appendChild(s('path', { class: 'k-link k-s-' + l.color, d: d, 'stroke-width': w.toFixed(1) }, s('title', null, a.label + ' vers ' + b.label + (l.kind ? ' (' + l.kind + ')' : '') + ' : ' + K.euros(l.value))));
    });
    used.forEach(function (n) {
      graph.appendChild(s('rect', { class: 'k-node', x: n.x, y: n.y, width: NW, height: n.h, rx: 1 }, s('title', null, n.label + ' : ' + K.euros(n.value))));
      var isFirst = n.column === first, isLast = n.column === last;
      var anchor = isFirst ? 'start' : isLast ? 'end' : 'middle';
      var tx = isFirst ? n.x + NW + 6 : isLast ? n.x - 6 : n.x + NW / 2;
      var ty = isFirst || isLast ? n.y + n.h / 2 : n.y - 8;
      graph.appendChild(s('text', { class: 'k-node-label', x: tx, y: ty, 'text-anchor': anchor, 'dominant-baseline': 'central' }, [n.label + ' ', s('tspan', { class: 'k-node-value' }, K.euros(n.value))]));
    });
    root.appendChild(graph);
    if (Array.isArray(chart.legend) && chart.legend.length) root.appendChild(legend(chart.legend));
    root.appendChild(el('p', { class: 'k-sr' }, data.summary));
    var rows = links.map(function (l) {
      return [{ text: nodes[l.source].label }, { text: nodes[l.target].label }, { text: l.kind || '' }, { text: K.euros(l.value), numeric: true }];
    });
    root.appendChild(dataTable(data.title, [{ label: 'De' }, { label: 'Vers' }, { label: 'Nature' }, { label: 'Montant', numeric: true }], rows));
  }

  K.view('chart', function (data, root) {
    K.header(data).forEach(function (n) { root.appendChild(n); });
    var figures = K.figures(data.figures);
    if (figures) root.appendChild(figures);
    if (data.chart.kind === 'sankey') sankey(data, data.chart, root);
    else lineChart(data, data.chart, root);
    K.footer(data).forEach(function (n) { root.appendChild(n); });
  });
})();
`,
}
