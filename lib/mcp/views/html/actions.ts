/**
 * Template "actions": a list of things to handle (bank transactions to
 * reconcile, draft entries to validate, missing receipts) with buttons.
 *
 * A button never acts by itself: it calls a tool of the Kledg server
 * through the host (tools/call), so the server checks the connection, the
 * company grant and the role exactly as for the assistant. A high-impact
 * tool always starts with its dry run: in validation mode the server
 * records a pending action and returns the approvalUrl, the user approves
 * in Kledg (the view cannot), then "Exécuter" calls again with the
 * actionId; in automatic mode the dry run is shown and "Confirmer" runs
 * it. A direct tool asks for a confirmation click first ("Rapprocher" on a
 * bank transaction whose unique match the server found, item.match). Other buttons
 * send a message to the assistant (ui/message) or open a page of Kledg
 * (ui/open-link).
 */

import type { TemplateSource } from './page'

export const ACTIONS_TEMPLATE: TemplateSource = {
  title: 'Kledg\u00a0: liste à traiter',
  css: `
.k-list td.k-cell-actions{width:1%;white-space:nowrap}
.k-list td.k-cell-actions .k-actions{flex-wrap:nowrap;justify-content:flex-end}
.k-list tr.k-done th,.k-list tr.k-done td{opacity:0.55}
.k-list tr.k-breakdown td{background:var(--k-surface);padding:6px 8px 10px 32px}
.k-list .k-breakdown table{width:auto;min-width:60%}
.k-list .k-breakdown td,.k-list .k-breakdown th{border-bottom:none;padding:2px 8px}
.k-list input[type=checkbox]{width:14px;height:14px;margin:2px 0 0;accent-color:var(--k-fg)}
.k-list th.k-select,.k-list td.k-select{width:1%}
.k-list tbody th{white-space:nowrap}
.k-list .k-match{margin:4px 0 0;max-width:32ch;margin-left:auto;white-space:normal;text-align:end;font-size:12px;color:var(--k-muted)}
`,
  js: String.raw`
(function () {
  var K = window.Kledg;
  var el = K.el;

  K.view('actions', function (data, root, api) {
    var busy = false;
    var selected = {};
    var panel = el('div', { role: 'status', 'aria-live': 'polite' });
    var bulkButton = null;

    K.header(data).forEach(function (n) { root.appendChild(n); });
    var figures = K.figures(data.figures);
    if (figures) root.appendChild(figures);

    // ---------------------------------------------------------- panel

    function setPanel(kind, nodes) {
      K.clear(panel);
      if (!nodes) { api.resized(); return; }
      panel.appendChild(el('div', { class: 'k-panel' + (kind ? ' k-status-' + kind : ''), role: kind === 'error' ? 'alert' : null }, nodes));
      api.resized();
    }

    function lockButtons(locked) {
      busy = locked;
      var buttons = root.querySelectorAll('button[data-action]');
      for (var i = 0; i < buttons.length; i++) buttons[i].disabled = locked || buttons[i].getAttribute('data-done') === 'true';
      updateBulk();
    }

    function failure(message) {
      lockButtons(false);
      setPanel('error', [el('p', null, message || 'L’action n’a pas abouti.')]);
    }

    function warningsOf(value) {
      return value && Array.isArray(value.warnings) ? value.warnings.filter(function (w) { return typeof w === 'string'; }) : [];
    }

    /** What a dry run says, in a few lines: entries and numbers when it lists entries, and its warnings. */
    function previewNodes(preview) {
      var nodes = [];
      if (preview && Array.isArray(preview.entries)) {
        nodes.push(el('ul', null, preview.entries.slice(0, 20).map(function (e) {
          var parts = [];
          if (e.entryNumber) parts.push('Écriture ' + e.entryNumber);
          if (e.description) parts.push(String(e.description));
          var line = parts.join(', ');
          if (e.numberToAssign) line += '\u00a0: recevra le n° ' + e.numberToAssign;
          if (e.problem) line += '\u00a0: ' + e.problem;
          return el('li', null, line);
        })));
      }
      var warnings = warningsOf(preview);
      if (warnings.length) nodes.push(el('ul', null, warnings.map(function (w) { return el('li', null, w); })));
      return nodes;
    }

    function done(action, ids, message) {
      lockButtons(false);
      ids.forEach(function (id) { markDone(id); });
      var nodes = [el('p', null, message)];
      if (data.refresh) nodes.push(el('div', { class: 'k-actions' }, el('button', { type: 'button', class: 'k-btn', onclick: refresh }, 'Actualiser la liste')));
      setPanel('success', nodes);
      api.updateContext('Depuis la vue Kledg, l’utilisateur a lancé « ' + action.label + ' » (' + action.tool + ') sur ' + ids.join(', ') + '. Résultat\u00a0: ' + message);
    }

    function refresh() {
      if (!data.refresh || busy) return;
      lockButtons(true);
      setPanel(null, [el('p', null, 'Actualisation…')]);
      api.callTool(data.refresh.tool, data.refresh.arguments).then(function (result) {
        lockButtons(false);
        if (result.ok && result.data && result.data.view === 'actions') api.show(result.data);
        else failure(result.text);
      }, function (error) { failure(error.message); });
    }

    function call(action, args, ids, then, onFail) {
      var fail = onFail || failure;
      lockButtons(true);
      setPanel(null, [el('p', null, action.label + '…')]);
      api.callTool(action.tool, args).then(function (result) {
        if (!result.ok) return fail(result.text);
        then(result.data || {});
      }, function (error) { fail(error.message); });
    }

    /** Runs a tool action, through its dry run when it is high impact. */
    function runTool(action, args, ids) {
      if (!action.highImpact) {
        call(action, args, ids, function () { done(action, ids, action.label + '\u00a0: fait.'); });
        return;
      }
      var automatic = data.executionMode === 'automatic';
      var previewArgs = automatic ? Object.assign({}, args, { dryRun: true }) : args;
      call(action, previewArgs, ids, function (result) {
        if (result.executed) return done(action, ids, action.label + '\u00a0: fait.');
        if (!result.dryRun) return done(action, ids, action.label + '\u00a0: fait.');
        showPreview(result, null);
      });

      /** The dry run with its buttons; an error of the second call is shown under it, the buttons stay. */
      function showPreview(result, error) {
        lockButtons(false);
        var nodes = [el('p', null, 'Aperçu\u00a0: rien n’a encore été modifié.')].concat(previewNodes(result.preview));
        var buttons = [];
        var retry = function (message) { showPreview(result, message || 'L’action n’a pas abouti.'); };
        var finish = function (r) { done(action, ids, r.executed ? action.label + '\u00a0: fait.' : 'Action envoyée.'); };
        if (automatic) {
          buttons.push(el('button', { type: 'button', class: 'k-btn k-btn-primary', 'data-action': 'confirm', onclick: function () {
            call(action, args, ids, finish, retry);
          } }, 'Confirmer\u00a0: ' + action.label.toLowerCase()));
        } else {
          nodes.push(el('p', null, 'Cette action doit être approuvée par vous dans Kledg (l’assistant ne peut pas l’approuver). Approuvez-la, puis revenez exécuter.'));
          if (typeof result.approvalUrl === 'string') {
            buttons.push(el('button', { type: 'button', class: 'k-btn k-btn-primary', onclick: function () { api.openLink(result.approvalUrl).catch(function (e) { retry(e.message); }); } }, 'Approuver dans Kledg'));
          }
          if (typeof result.actionId === 'string') {
            buttons.push(el('button', { type: 'button', class: 'k-btn', 'data-action': 'execute', onclick: function () {
              call(action, Object.assign({}, args, { actionId: result.actionId }), ids, finish, retry);
            } }, 'Exécuter après approbation'));
          }
        }
        buttons.push(el('button', { type: 'button', class: 'k-btn', onclick: function () { setPanel(null, null); } }, 'Annuler'));
        if (error) nodes.push(el('p', { role: 'alert', class: 'k-error-text' }, error));
        nodes.push(el('div', { class: 'k-actions' }, buttons));
        setPanel(null, nodes);
      }
    }

    function confirmThen(button, question, run) {
      if (button.getAttribute('data-confirming') === 'true') {
        button.removeAttribute('data-confirming');
        button.textContent = button.getAttribute('data-label');
        run();
        return;
      }
      button.setAttribute('data-confirming', 'true');
      button.textContent = 'Confirmer ?';
      setPanel(null, [el('p', null, question)]);
    }

    function onAction(action, ids, button) {
      if (busy) return;
      if (action.kind === 'link') {
        api.openLink(action.url).catch(function (e) { failure(e.message); });
        return;
      }
      if (action.kind === 'message') {
        api.sendMessage(action.prompt).then(function () {
          setPanel('success', [el('p', null, 'Demande envoyée à l’assistant.')]);
        }, function (e) { failure(e.message); });
        return;
      }
      if (!action.highImpact && action.confirm) {
        confirmThen(button, action.confirm, function () { runTool(action, action.arguments, ids); });
        return;
      }
      runTool(action, action.arguments, ids);
    }

    function actionButton(action, ids) {
      var cls = action.kind === 'link' ? 'k-btn k-btn-link' : action.kind === 'tool' && action.danger ? 'k-btn k-btn-danger' : action.kind === 'tool' && (action.highImpact || action.primary) ? 'k-btn k-btn-primary' : 'k-btn';
      var button = el('button', { type: 'button', class: cls, 'data-action': action.kind, 'data-label': action.label }, action.label);
      button.addEventListener('click', function () { onAction(action, ids, button); });
      return button;
    }

    // ---------------------------------------------------------- table

    var rows = {};
    function markDone(id) {
      var row = rows[id];
      if (!row) return;
      row.classList.add('k-done');
      var buttons = row.querySelectorAll('button[data-action=tool]');
      for (var i = 0; i < buttons.length; i++) { buttons[i].disabled = true; buttons[i].setAttribute('data-done', 'true'); }
      var box = row.querySelector('input[type=checkbox]');
      if (box) { box.checked = false; box.disabled = true; delete selected[id]; updateBulk(); }
    }

    function updateBulk() {
      if (!bulkButton) return;
      var count = Object.keys(selected).length;
      bulkButton.disabled = busy || count === 0;
      bulkButton.textContent = data.bulk.label + (count ? ' (' + count + ')' : '');
    }

    if (!data.items.length) {
      root.appendChild(panel);
      root.appendChild(el('p', { class: 'k-empty' }, data.empty));
      K.footer(data).forEach(function (n) { root.appendChild(n); });
      return;
    }

    var toolbar = [];
    if (data.bulk) {
      bulkButton = el('button', { type: 'button', class: 'k-btn k-btn-primary', 'data-action': 'bulk', disabled: true }, data.bulk.label);
      bulkButton.addEventListener('click', function () {
        var ids = Object.keys(selected);
        if (!ids.length || busy) return;
        var args = Object.assign({}, data.bulk.arguments);
        args[data.bulk.argument] = ids;
        runTool({ kind: 'tool', label: data.bulk.label, tool: data.bulk.tool, highImpact: data.bulk.highImpact }, args, ids);
      });
      toolbar.push(bulkButton);
    }
    if (data.refresh) toolbar.push(el('button', { type: 'button', class: 'k-btn', 'data-action': 'refresh', onclick: refresh }, 'Actualiser'));
    if (toolbar.length) root.appendChild(el('div', { class: 'k-toolbar' }, toolbar));
    root.appendChild(panel);

    var hasBreakdown = data.items.some(function (item) { return Array.isArray(item.breakdown) && item.breakdown.length; });
    var hasActions = data.items.some(function (item) { return item.actions.length; });
    var head = [];
    if (data.bulk) head.push(el('th', { scope: 'col', class: 'k-select' }, el('span', { class: 'k-sr' }, 'Sélection')));
    data.columns.forEach(function (c) { head.push(el('th', { scope: 'col', class: c.align === 'end' ? 'k-num' : null }, c.label)); });
    if (hasActions || hasBreakdown) head.push(el('th', { scope: 'col' }, el('span', { class: 'k-sr' }, 'Actions')));
    var body = el('tbody');
    var span = head.length;

    data.items.forEach(function (item) {
      var cells = [];
      if (data.bulk) {
        var box = el('input', { type: 'checkbox', 'aria-label': 'Sélectionner ' + String(item.cells[data.columns[0].key] || item.id), disabled: !item.selectable });
        box.addEventListener('change', function () {
          if (box.checked) selected[item.id] = true;
          else delete selected[item.id];
          updateBulk();
        });
        cells.push(el('td', { class: 'k-select' }, box));
      }
      data.columns.forEach(function (c, i) {
        var value = item.cells[c.key];
        var td = K.cell(value === undefined ? null : value, c.format, i === 0 ? 'th' : 'td');
        if (i === 0) td.setAttribute('scope', 'row');
        if (c.align === 'end') td.classList.add('k-num');
        cells.push(td);
      });
      var buttons = item.actions.map(function (a) { return actionButton(a, [item.id]); });
      var detailRow = null;
      if (Array.isArray(item.breakdown) && item.breakdown.length) {
        var toggle = el('button', { type: 'button', class: 'k-btn', 'aria-expanded': 'false' }, 'Détail');
        detailRow = el('tr', { class: 'k-breakdown', hidden: true }, el('td', { colspan: span }, el('div', { class: 'k-breakdown' }, el('table', null, [
          el('thead', null, el('tr', null, [el('th', { scope: 'col' }, 'Ligne'), el('th', { scope: 'col', class: 'k-num' }, 'Débit'), el('th', { scope: 'col', class: 'k-num' }, 'Crédit')])),
          el('tbody', null, item.breakdown.map(function (l) { return el('tr', null, [el('th', { scope: 'row' }, l.label), K.cell(l.debit, 'euros'), K.cell(l.credit, 'euros')]); })),
        ]))));
        toggle.addEventListener('click', function () {
          var open = toggle.getAttribute('aria-expanded') === 'true';
          toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
          if (open) detailRow.setAttribute('hidden', '');
          else detailRow.removeAttribute('hidden');
          api.resized();
        });
        buttons.unshift(toggle);
      }
      var actionNodes = [el('div', { class: 'k-actions' }, buttons)];
      // The match the server found for the row (the view never computes one)
      if (item.match) actionNodes.push(el('p', { class: 'k-match' }, 'Correspondance\u00a0: ' + item.match.label + ', ' + K.euros(item.match.amount)));
      if (hasActions || hasBreakdown) cells.push(el('td', { class: 'k-cell-actions' }, actionNodes));
      var row = el('tr', null, cells);
      rows[item.id] = row;
      body.appendChild(row);
      if (detailRow) body.appendChild(detailRow);
    });

    root.appendChild(el('table', { class: 'k-table k-list' }, [el('caption', { class: 'k-sr' }, data.title), el('thead', null, el('tr', null, head)), body]));
    K.footer(data).forEach(function (n) { root.appendChild(n); });
  });
})();
`,
}
