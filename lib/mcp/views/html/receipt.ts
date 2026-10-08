/**
 * Template "receipt-capture": a receipt photographed or picked in the
 * conversation (docs/justificatifs-photo.md).
 *
 * The view never reaches Kledg itself: the file and every action go through
 * tools of the server called by the host (tools/call), checked like the
 * assistant's calls. Steps:
 * - capture: the camera ("Prendre une photo", capture=environment) or a
 *   file (image or PDF); a photo larger than the limit, or in a format other
 *   than JPEG or PNG (HEIC on an iPhone), is redrawn on a canvas and sent
 *   as a JPEG of 2000 pixels at most, smaller quality first until it fits;
 *   then stage_receipt with the amount and the date typed or prefilled;
 * - result: "Rattacher" per transaction (file_receipt action attach),
 *   "Créer la note de frais" (action expense);
 * - approval: an attach starts with its dry run; in validation mode the
 *   user approves in Kledg (the view cannot) and "Exécuter" calls again
 *   with the actionId; in automatic mode "Confirmer" runs it;
 * - done: the link to the item in Kledg.
 * Each call answers this view again, drawn with api.show.
 */

import type { TemplateSource } from './page'

export const RECEIPT_TEMPLATE: TemplateSource = {
  title: 'Kledg : justificatif',
  css: `
.k-form{display:grid;gap:10px;margin:0 0 12px}
.k-field{display:grid;gap:4px}
.k-field label{font-size:12px;color:var(--k-muted)}
.k-row{display:flex;flex-wrap:wrap;gap:10px}
.k-row .k-field{flex:1 1 140px}
.k-file{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.k-file input[type=file]{position:absolute;width:1px;height:1px;opacity:0}
.k-chosen{color:var(--k-muted);font-size:12px}
.k-cards{list-style:none;margin:0 0 12px;padding:0;display:grid;gap:8px}
.k-card{border:1px solid var(--k-border);border-radius:var(--k-radius);padding:10px 12px;display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px 16px;align-items:flex-start}
.k-card-main{min-width:0;flex:1 1 220px}
.k-card-title{font-weight:600;display:block}
.k-card-meta{color:var(--k-muted);font-size:12px;display:block}
.k-card-side{display:flex;flex-direction:column;align-items:flex-end;gap:6px}
.k-reasons{margin:4px 0 0;padding:0;list-style:none;display:flex;flex-wrap:wrap;gap:4px}
.k-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:6px 16px;margin:8px 0}
.k-facts dt{color:var(--k-muted);font-size:11px}
.k-facts dd{margin:0;font-weight:500}
`,
  js: String.raw`
(function () {
  var K = window.Kledg;
  var el = K.el;
  var MAX_SIDE = 2000;
  var QUALITIES = [0.85, 0.7, 0.55, 0.4];

  // ------------------------------------------------------------ files

  function readBytes(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(new Uint8Array(reader.result)); };
      reader.onerror = function () { reject(new Error('Le fichier n’a pas pu être lu.')); };
      reader.readAsArrayBuffer(blob);
    });
  }

  /** Base64 of bytes, by chunks (String.fromCharCode takes a bounded number of arguments). */
  function base64Of(bytes) {
    var binary = '';
    for (var i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return window.btoa(binary);
  }

  function encode(canvas, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (blob) resolve(blob);
        else reject(new Error('Cette photo n’a pas pu être réduite : envoyez-la en JPEG ou en PDF.'));
      }, 'image/jpeg', quality);
    });
  }

  /** The file to send: as it is when it fits and is JPEG, PNG or PDF; a photo redrawn as JPEG otherwise. */
  function prepare(file, maxBytes) {
    var type = String(file.type || '').toLowerCase();
    var name = String(file.name || 'justificatif');
    var direct = (type === 'image/jpeg' || type === 'image/png' || type === 'application/pdf') && file.size <= maxBytes;
    if (direct) return readBytes(file).then(function (bytes) { return { base64: base64Of(bytes), fileName: name }; });
    if (type === 'application/pdf') return Promise.reject(new Error('PDF trop volumineux (' + Math.round(maxBytes / 1048576) + ' Mo au plus) : envoyez une photo de la page.'));
    if (typeof window.createImageBitmap !== 'function') return Promise.reject(new Error('Cette photo n’a pas pu être réduite dans cet assistant : envoyez-la en JPEG de moins de ' + Math.round(maxBytes / 1048576) + ' Mo, ou en PDF.'));
    return window.createImageBitmap(file).then(function (image) {
      var scale = Math.min(1, MAX_SIDE / Math.max(image.width || 1, image.height || 1));
      var canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      var context = canvas.getContext('2d');
      if (!context) throw new Error('Cette photo n’a pas pu être réduite : envoyez-la en JPEG ou en PDF.');
      context.fillStyle = 'white';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      var attempt = function (i) {
        if (i >= QUALITIES.length) throw new Error('Photo trop volumineuse, même réduite : reprenez-la de plus loin.');
        return encode(canvas, QUALITIES[i]).then(function (blob) {
          if (blob.size > maxBytes) return attempt(i + 1);
          return readBytes(blob).then(function (bytes) { return { base64: base64Of(bytes), fileName: name.replace(/\.[A-Za-z0-9]{1,5}$/, '') + '.jpg' }; });
        });
      };
      return attempt(0);
    }, function () {
      throw new Error('Cette photo n’a pas pu être ouverte : envoyez-la en JPEG ou en PDF.');
    });
  }

  /** "23,45" or "1 234.5" in euros, or null. */
  function parseAmount(text) {
    var value = String(text || '').replace(/[\s  €]/g, '').replace(',', '.');
    if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
    return Number(value);
  }

  // ------------------------------------------------------------ view

  K.view('receipt-capture', function (data, root, api) {
    var busy = false;
    var status = el('div', { role: 'status', 'aria-live': 'polite' });

    K.header(data).forEach(function (n) { root.appendChild(n); });

    function setStatus(kind, nodes) {
      K.clear(status);
      if (nodes) status.appendChild(el('div', { class: 'k-panel' + (kind ? ' k-status-' + kind : ''), role: kind === 'error' ? 'alert' : null }, nodes));
      api.resized();
    }

    function lock(locked) {
      busy = locked;
      var buttons = root.querySelectorAll('button[data-action]');
      for (var i = 0; i < buttons.length; i++) buttons[i].disabled = locked || buttons[i].getAttribute('data-disabled') === 'true';
    }

    function fail(message) {
      lock(false);
      setStatus('error', [el('p', null, message || 'L’action n’a pas abouti.')]);
    }

    /** Calls a tool and draws the view it answers. */
    function call(tool, args, pending, tell) {
      if (busy) return;
      lock(true);
      setStatus(null, [el('p', { class: 'k-loading' }, pending)]);
      api.callTool(tool, args).then(function (result) {
        if (!result.ok) return fail(result.text);
        var next = result.data;
        if (!next || next.view !== 'receipt-capture') return fail('Réponse inattendue de Kledg : la réponse en texte reste dans la conversation.');
        lock(false);
        api.show(next);
        if (tell) api.updateContext(tell(next));
      }, function (error) { fail(error.message); });
    }

    function button(label, onclick, options) {
      var o = options || {};
      return el('button', { type: 'button', class: 'k-btn' + (o.primary ? ' k-btn-primary' : '') + (o.danger ? ' k-btn-danger' : ''), 'data-action': label, 'data-disabled': o.disabled ? 'true' : null, disabled: o.disabled || null, onclick: onclick }, label);
    }

    function fieldsLine(f) {
      var parts = [];
      if (f.merchant) parts.push(f.merchant);
      if (f.date) parts.push(K.date(f.date));
      if (typeof f.amount === 'number') parts.push(f.currency === 'EUR' ? K.euros(f.amount) : K.number(f.amount, 2) + ' ' + f.currency);
      return parts.join(', ');
    }

    function describe(next) {
      var parts = ['Vue Kledg, justificatif'];
      if (next.receipt) parts.push('stagedReceiptId ' + next.receipt.id);
      if (next.outcome) parts.push('résultat ' + next.outcome);
      if (next.done) parts.push(next.done.message);
      return parts.join(', ') + '.';
    }

    // ---------------------------------------------------------- capture

    function captureForm() {
      var f = data.fields;
      var chosen = null;
      var chosenText = el('span', { class: 'k-chosen' }, data.receipt ? data.receipt.fileName : 'Aucun fichier choisi');
      function picker(id, label, capture) {
        var input = el('input', { type: 'file', id: id, accept: data.accept, capture: capture ? 'environment' : null });
        input.addEventListener('change', function () {
          chosen = input.files && input.files[0] ? input.files[0] : null;
          K.clear(chosenText);
          chosenText.appendChild(document.createTextNode(chosen ? chosen.name : 'Aucun fichier choisi'));
        });
        return [input, button(label, function () { input.click(); })];
      }
      var amount = el('input', { class: 'k-input', id: 'k-amount', inputmode: 'decimal', autocomplete: 'off', value: typeof f.amount === 'number' ? String(f.amount).replace('.', ',') : '' });
      var date = el('input', { class: 'k-input', id: 'k-date', type: 'date', value: f.date || '' });
      var merchant = el('input', { class: 'k-input', id: 'k-merchant', autocomplete: 'off', value: f.merchant || '' });
      var form = el('div', { class: 'k-form' }, [
        data.receipt ? null : el('div', { class: 'k-file' }, picker('k-camera', 'Prendre une photo', true).concat(picker('k-pick', 'Choisir un fichier', false)).concat([chosenText])),
        el('div', { class: 'k-row' }, [
          el('div', { class: 'k-field' }, [el('label', { for: 'k-amount' }, 'Montant TTC' + (f.currency !== 'EUR' ? ' (' + f.currency + ')' : ' (€)')), amount]),
          el('div', { class: 'k-field' }, [el('label', { for: 'k-date' }, 'Date du ticket'), date]),
          el('div', { class: 'k-field' }, [el('label', { for: 'k-merchant' }, 'Commerçant'), merchant]),
        ]),
      ]);
      function submit() {
        var value = parseAmount(amount.value);
        if (!data.receipt && !chosen) return fail('Prenez la photo ou choisissez le fichier du justificatif.');
        if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(date.value)) return fail('Indiquez le montant TTC (par exemple 23,45) et la date du justificatif.');
        var fields = { companyId: data.companyId, amount: value, date: date.value, currency: f.currency };
        if (merchant.value.trim()) fields.merchant = merchant.value.trim();
        if (f.vat && f.vat.length) fields.vat = f.vat;
        if (f.paymentMethod) fields.paymentMethod = f.paymentMethod;
        if (data.receipt) {
          fields.action = 'match';
          fields.stagedReceiptId = data.receipt.id;
          return call('file_receipt', fields, 'Recherche de la transaction…', describe);
        }
        lock(true);
        setStatus(null, [el('p', { class: 'k-loading' }, 'Préparation du fichier…')]);
        prepare(chosen, data.maxBytes).then(function (file) {
          lock(false);
          fields.contentBase64 = file.base64;
          fields.fileName = file.fileName;
          fields.from = 'capture_view';
          call('stage_receipt', fields, 'Envoi à Kledg et recherche de la transaction…', describe);
        }, function (error) { fail(error.message); });
      }
      root.appendChild(form);
      root.appendChild(el('div', { class: 'k-actions' }, button(data.receipt ? 'Rechercher la transaction' : 'Envoyer à Kledg', submit, { primary: true })));
    }

    // ---------------------------------------------------------- result

    function attachArgs(transactionId, extra) {
      var args = { companyId: data.companyId, action: 'attach', stagedReceiptId: data.receipt.id, transactionId: transactionId };
      for (var key in extra) if (Object.prototype.hasOwnProperty.call(extra, key)) args[key] = extra[key];
      return args;
    }

    function attach(transactionId) {
      // A high-impact action: its dry run first (automatic mode), or the pending action to approve (validation mode).
      call('file_receipt', attachArgs(transactionId, data.executionMode === 'automatic' ? { dryRun: true } : {}), 'Préparation du rattachement…', describe);
    }

    function card(c, withButton) {
      var badge = el('span', { class: 'k-badge ' + (c.sendsToBank ? 'k-tone-info' : 'k-tone-success') }, c.sendsToBank ? 'Envoyé à Qonto' : 'Conservé par Kledg');
      var side = [el('strong', { class: 'k-num' }, K.euros(c.amount)), badge];
      if (withButton) side.push(data.canAttach ? button('Rattacher', function () { attach(c.transactionId); }, { primary: data.outcome === 'matched' }) : el('span', { class: 'k-chosen' }, 'Rattachement réservé à qui rapproche la banque'));
      return el('li', { class: 'k-card' }, [
        el('div', { class: 'k-card-main' }, [
          el('span', { class: 'k-card-title' }, c.label),
          el('span', { class: 'k-card-meta' }, K.date(c.date) + ', ' + c.bankAccount),
          c.reasons.length ? el('ul', { class: 'k-reasons', 'aria-label': 'Pourquoi' }, c.reasons.map(function (r) { return el('li', { class: 'k-badge' }, r); })) : null,
        ]),
        el('div', { class: 'k-card-side' }, side),
      ]);
    }

    function proposal(p) {
      var facts = el('dl', { class: 'k-facts' }, [
        el('div', null, [el('dt', null, 'Date'), el('dd', null, K.date(p.date))]),
        el('div', null, [el('dt', null, 'Commerçant'), el('dd', null, p.merchant || 'Non indiqué')]),
        el('div', null, [el('dt', null, 'Montant TTC'), el('dd', null, K.euros(p.amount))]),
        el('div', null, [el('dt', null, 'Catégorie'), el('dd', null, p.category + (p.accountCode ? ' (' + p.accountCode + ')' : ''))]),
        el('div', null, [el('dt', null, 'Note de frais'), el('dd', null, p.openDraft ? p.openDraft + ' (brouillon en cours)' : 'Nouvelle note du mois')]),
      ]);
      var nodes = [el('h2', null, 'Est-ce une note de frais ?'), el('p', { class: 'k-muted' }, 'Payée personnellement (carte personnelle ou espèces) : Kledg prépare la note de frais en brouillon, vous la vérifiez et la soumettez dans Kledg.'), facts];
      if (p.needsEuroAmount) nodes.push(el('p', { class: 'k-error-text' }, 'Justificatif en devise étrangère : indiquez le montant débité en euros pour la note de frais.'));
      if (data.canExpense) {
        nodes.push(el('div', { class: 'k-actions' }, button('Créer la note de frais', function () {
          call('file_receipt', { companyId: data.companyId, action: 'expense', stagedReceiptId: data.receipt.id }, 'Préparation de la note de frais…', describe);
        }, { primary: data.outcome === 'none', disabled: p.needsEuroAmount })));
      }
      return el('section', { class: 'k-panel', 'aria-label': 'Note de frais' }, nodes);
    }

    function result() {
      if (data.receipt) root.appendChild(el('p', { class: 'k-muted' }, data.receipt.fileName + (fieldsLine(data.fields) ? ', ' + fieldsLine(data.fields) : '')));
      var open = data.outcome === 'matched' || data.outcome === 'candidates';
      if (data.candidates.length) root.appendChild(el('ul', { class: 'k-cards', 'aria-label': 'Transactions' }, data.candidates.map(function (c) { return card(c, open); })));
      if (data.proposal && data.receipt && data.receipt.status === 'staged') root.appendChild(proposal(data.proposal));
      if (data.receipt && data.receipt.status === 'staged') {
        var armed = false;
        root.appendChild(el('div', { class: 'k-actions' }, button('Abandonner ce justificatif', function (event) {
          if (!armed) {
            armed = true;
            event.target.textContent = 'Confirmer l’abandon';
            return;
          }
          call('file_receipt', { companyId: data.companyId, action: 'discard', stagedReceiptId: data.receipt.id }, 'Abandon…', describe);
        }, { danger: true })));
      }
    }

    // ---------------------------------------------------------- approval

    function approval() {
      var a = data.approval;
      if (a.transaction) root.appendChild(el('ul', { class: 'k-cards', 'aria-label': 'Transaction' }, [card(a.transaction, false)]));
      root.appendChild(el('p', { class: 'k-panel' }, a.effect));
      var actions = [];
      if (a.actionId) {
        if (a.approvalUrl) actions.push(button('Approuver dans Kledg', function () { api.openLink(a.approvalUrl).catch(function () {}); }, { primary: true }));
        actions.push(button('Exécuter après approbation', function () {
          call('file_receipt', attachArgs(a.transactionId, { actionId: a.actionId }), 'Rattachement…', describe);
        }));
        root.appendChild(el('p', { class: 'k-muted' }, 'L’assistant ne peut pas approuver cette action : vous l’approuvez dans Kledg.'));
      } else {
        actions.push(button('Confirmer : rattacher', function () { call('file_receipt', attachArgs(a.transactionId, {}), 'Rattachement…', describe); }, { primary: true }));
      }
      root.appendChild(el('div', { class: 'k-actions' }, actions));
    }

    // ---------------------------------------------------------- done

    function finished() {
      root.appendChild(el('div', { class: 'k-panel k-status-success' }, el('p', null, data.done.message)));
      if (data.receipt) root.appendChild(el('p', { class: 'k-muted' }, data.receipt.fileName + (fieldsLine(data.fields) ? ', ' + fieldsLine(data.fields) : '')));
    }

    if (data.mode === 'capture') captureForm();
    else if (data.mode === 'approval' && data.approval) approval();
    else if (data.mode === 'done' && data.done) finished();
    else result();
    root.appendChild(status);
    K.footer(data).forEach(function (n) { root.appendChild(n); });
  });
})();
`,
}
