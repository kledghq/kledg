/**
 * Shared part of every view template (docs/mcp-views.md): the CSS (Kledg
 * tokens, light and dark) and the runtime script: the MCP Apps bridge
 * (JSON-RPC 2.0 over postMessage with the host, SEP-1865), the ChatGPT
 * fallback (window.openai) and the helpers templates draw with.
 *
 * Rules the guard test checks (lib/mcp/__tests__/views.test.ts): no
 * network (no fetch, XHR, WebSocket, no http(s) URL), no HTML parsing of
 * data (no innerHTML, outerHTML, insertAdjacentHTML, document.write, eval):
 * every string from the data is written with textContent or setAttribute.
 * The script is plain ES5 inside a TypeScript string: no backquote and no
 * dollar-brace in it.
 */

/** Colours copied from app/globals.css (light :root, dark .dark): keep them in sync (checked by the guard test). */
export const LIGHT_TOKENS: Record<string, string> = {
  bg: 'oklch(1 0 0)',
  fg: 'oklch(0.145 0 0)',
  surface: 'oklch(0.985 0 0)',
  muted: 'oklch(0.47 0 0)',
  subtle: 'oklch(0.967 0 0)',
  border: 'oklch(0.922 0 0)',
  input: 'oklch(0.87 0 0)',
  primary: 'oklch(0.145 0 0)',
  'primary-fg': 'oklch(0.99 0 0)',
  link: 'oklch(0.45 0.092 160)',
  ring: 'oklch(0.63 0.125 160)',
  success: 'oklch(0.53 0.11 160)',
  warning: 'oklch(0.555 0.163 48.998)',
  danger: 'oklch(0.577 0.245 27.325)',
  info: 'oklch(0.5 0.134 242.749)',
  'chart-treasury': 'oklch(0.53 0.11 160)',
  'chart-revenue': 'oklch(0.53 0.11 160)',
  'chart-expenses': 'oklch(0.556 0 0)',
  'chart-balance': 'oklch(0.145 0 0)',
  'chart-flow-dividend': 'oklch(0.56 0.14 152)',
  'chart-flow-management-fee': 'oklch(0.55 0.15 255)',
  'chart-flow-invoice': 'oklch(0.64 0.15 70)',
  'chart-flow-loan': 'oklch(0.54 0.18 300)',
  'chart-flow-current-account': 'oklch(0.58 0.11 195)',
  'chart-flow-trade': 'oklch(0.57 0.18 25)',
  'chart-flow-customer': 'oklch(0.56 0.13 160)',
  'chart-flow-supplier': 'oklch(0.6 0.16 35)',
}

export const DARK_TOKENS: Record<string, string> = {
  bg: 'oklch(0.145 0 0)',
  fg: 'oklch(0.97 0 0)',
  surface: 'oklch(0.17 0 0)',
  muted: 'oklch(0.708 0 0)',
  subtle: 'oklch(0.22 0 0)',
  border: 'oklch(1 0 0 / 10%)',
  input: 'oklch(1 0 0 / 15%)',
  primary: 'oklch(0.97 0 0)',
  'primary-fg': 'oklch(0.16 0 0)',
  link: 'oklch(0.81 0.1 160)',
  ring: 'oklch(0.73 0.125 160)',
  success: 'oklch(0.73 0.125 160)',
  warning: 'oklch(0.828 0.189 84.429)',
  danger: 'oklch(0.704 0.191 22.216)',
  info: 'oklch(0.746 0.16 232.661)',
  'chart-treasury': 'oklch(0.73 0.125 160)',
  'chart-revenue': 'oklch(0.73 0.125 160)',
  'chart-expenses': 'oklch(0.556 0 0)',
  'chart-balance': 'oklch(0.97 0 0)',
  'chart-flow-dividend': 'oklch(0.72 0.15 152)',
  'chart-flow-management-fee': 'oklch(0.7 0.14 255)',
  'chart-flow-invoice': 'oklch(0.78 0.14 75)',
  'chart-flow-loan': 'oklch(0.7 0.16 300)',
  'chart-flow-current-account': 'oklch(0.75 0.11 195)',
  'chart-flow-trade': 'oklch(0.7 0.17 25)',
  'chart-flow-customer': 'oklch(0.73 0.14 160)',
  'chart-flow-supplier': 'oklch(0.73 0.15 40)',
}

const declarations = (tokens: Record<string, string>) =>
  Object.entries(tokens)
    .map(([name, value]) => `--k-${name}:${value};`)
    .join('')

export const BASE_CSS = `
:root{color-scheme:light dark;${declarations(LIGHT_TOKENS)}--k-font:"Geist","Geist Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;--k-mono:"Geist Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--k-radius:8px}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){${declarations(DARK_TOKENS)}}}
:root[data-theme=dark]{color-scheme:dark;${declarations(DARK_TOKENS)}}
:root[data-theme=light]{color-scheme:light}
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:var(--k-bg);color:var(--k-fg);font-family:var(--k-font);font-size:13px;line-height:1.45;font-feature-settings:"tnum","lnum";-webkit-font-smoothing:antialiased}
#app{padding:16px;max-width:100%;overflow-x:auto}
h1{font-size:15px;font-weight:600;margin:0;letter-spacing:-0.01em}
h2{font-size:13px;font-weight:600;margin:16px 0 8px}
p{margin:0}
.k-head{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:8px 16px;margin-bottom:12px}
.k-sub{color:var(--k-muted);margin-top:2px}
.k-notice{border:1px solid var(--k-border);background:var(--k-surface);border-radius:var(--k-radius);padding:8px 10px;margin:0 0 12px;color:var(--k-muted)}
.k-warnings{margin:12px 0 0;padding:8px 10px 8px 26px;border:1px solid var(--k-border);border-left:3px solid var(--k-warning);border-radius:var(--k-radius)}
.k-warnings li{margin:2px 0}
.k-muted{color:var(--k-muted)}
.k-mono{font-family:var(--k-mono);font-size:12px}
.k-num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.k-nowrap{white-space:nowrap}
.k-error-text{color:var(--k-danger)}
.k-table{width:100%;border-collapse:collapse}
.k-table th,.k-table td{padding:6px 8px;border-bottom:1px solid var(--k-border);vertical-align:top;text-align:left}
.k-table thead th{font-weight:500;color:var(--k-muted);font-size:12px;border-bottom:1px solid var(--k-border);white-space:nowrap}
.k-table th.k-num,.k-table td.k-num{text-align:right}
.k-table tbody th{font-weight:400}
.k-table tr.k-total th,.k-table tr.k-total td{font-weight:600;border-top:1px solid var(--k-fg);border-bottom:none}
.k-table tr.k-subtotal th,.k-table tr.k-subtotal td{font-weight:600}
.k-table tr.k-group th{font-weight:600;color:var(--k-muted);text-transform:uppercase;font-size:11px;letter-spacing:0.04em;padding-top:14px}
.k-table tr.k-section th{font-weight:600;font-size:13px;padding-top:16px;border-bottom:1px solid var(--k-fg)}
.k-figures{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px;padding:0;list-style:none}
.k-figures li{border:1px solid var(--k-border);border-radius:var(--k-radius);padding:6px 10px;min-width:120px}
.k-figures .k-figure-label{display:block;color:var(--k-muted);font-size:11px}
.k-figures .k-figure-value{display:block;font-weight:600;font-size:14px;font-variant-numeric:tabular-nums}
.k-badge{display:inline-block;border:1px solid var(--k-border);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;white-space:nowrap}
.k-tone-success{color:var(--k-success);border-color:currentColor}
.k-tone-warning{color:var(--k-warning);border-color:currentColor}
.k-tone-danger{color:var(--k-danger);border-color:currentColor}
.k-tone-info{color:var(--k-info);border-color:currentColor}
.k-btn{font:inherit;font-size:12px;font-weight:500;border:1px solid var(--k-input);background:var(--k-bg);color:var(--k-fg);border-radius:6px;padding:4px 10px;cursor:pointer;white-space:nowrap}
.k-btn:hover{background:var(--k-subtle)}
.k-btn:focus-visible,.k-input:focus-visible,summary:focus-visible{outline:2px solid var(--k-ring);outline-offset:1px}
.k-btn[disabled]{opacity:0.5;cursor:default}
.k-btn-primary{background:var(--k-primary);color:var(--k-primary-fg);border-color:var(--k-primary)}
.k-btn-primary:hover{background:var(--k-primary);opacity:0.9}
.k-btn-danger{color:var(--k-danger)}
.k-btn-link{border:none;background:none;color:var(--k-link);padding:0;text-decoration:underline;text-underline-offset:2px}
.k-btn-link:hover{background:none}
.k-actions{display:flex;flex-wrap:wrap;gap:6px}
.k-input{font:inherit;border:1px solid var(--k-input);background:var(--k-bg);color:var(--k-fg);border-radius:6px;padding:4px 8px;min-width:180px}
.k-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 10px}
.k-panel{border:1px solid var(--k-border);border-radius:var(--k-radius);padding:10px 12px;margin:0 0 12px;background:var(--k-surface)}
.k-panel p+p,.k-panel p+ul,.k-panel ul+.k-actions,.k-panel p+.k-actions{margin-top:8px}
.k-panel ul{margin:0;padding-left:18px}
.k-status-error{border-left:3px solid var(--k-danger)}
.k-status-success{border-left:3px solid var(--k-success)}
.k-empty{color:var(--k-muted);padding:16px 0}
.k-legend{display:flex;flex-wrap:wrap;gap:4px 14px;margin:8px 0 0;padding:0;list-style:none;color:var(--k-muted);font-size:12px}
.k-legend li{display:flex;align-items:center;gap:6px}
.k-swatch{display:inline-block;width:10px;height:10px;border-radius:2px}
.k-dash{display:inline-block;width:14px;border-top:2px dashed var(--k-muted)}
details{margin-top:12px}
summary{cursor:pointer;color:var(--k-muted);font-size:12px}
.k-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.k-footer{display:flex;flex-wrap:wrap;gap:12px;margin-top:12px;font-size:12px}
.k-error{border:1px solid var(--k-border);border-left:3px solid var(--k-danger);border-radius:var(--k-radius);padding:10px 12px}
.k-loading{color:var(--k-muted);padding:8px 0}
svg text{font-family:var(--k-font);fill:var(--k-fg);font-size:11px}
svg .k-axis{fill:var(--k-muted)}
svg .k-grid{stroke:var(--k-border);stroke-width:1}
`

/**
 * The runtime: `window.Kledg.view(name, render)` registers the template's
 * render function; the runtime connects to the host, waits for the tool
 * result and calls render(data, root, api) with its structuredContent.
 */
export const RUNTIME_JS = String.raw`
(function () {
  'use strict';
  var PROTOCOL_VERSION = '2026-01-26';
  var host = window.parent;
  var nextId = 1;
  var pending = {};
  var state = { name: null, render: null, data: null, input: null, context: {}, connected: false, lastSize: '' };
  var SVG_NS = document.getElementById('k-svg-ns').namespaceURI;
  var root = document.getElementById('app');
  var openai = typeof window.openai === 'object' && window.openai !== null ? window.openai : null;
  // The host's origin, learnt from its answer to ui/initialize (MCP Apps gives
  // the view no other way to know it). Until then only ui/initialize leaves
  // with targetOrigin '*'; afterwards every message goes to that origin only,
  // and messages from any other origin are ignored. An opaque origin ('null',
  // a sandboxed host) cannot be a targetOrigin: messages then still go to
  // '*', but only messages from that same opaque origin are accepted.
  var hostOrigin = null;
  var postTarget = '*';

  function lockOrigin(origin) {
    if (hostOrigin !== null || typeof origin !== 'string' || origin === '') return;
    hostOrigin = origin;
    if (/^[a-z][a-z0-9+.-]*:\/\/[^\/\s]+$/i.test(origin)) postTarget = origin;
  }

  // ------------------------------------------------------------ bridge

  function send(message) {
    if (host && host !== window) host.postMessage(message, postTarget);
  }

  function request(method, params, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var id = nextId++;
      var timer = setTimeout(function () {
        delete pending[id];
        reject(new Error('Pas de réponse de l’assistant.'));
      }, timeoutMs || 15000);
      pending[id] = { resolve: resolve, reject: reject, timer: timer, method: method };
      send({ jsonrpc: '2.0', id: id, method: method, params: params || {} });
    });
  }

  function notify(method, params) {
    send({ jsonrpc: '2.0', method: method, params: params || {} });
  }

  window.addEventListener('message', function (event) {
    // Only the host (the parent frame, or the sandbox proxy that forwards for it) talks to the view.
    if (event.source !== host || host === window) return;
    // Once the handshake told the host's origin, any other origin is ignored.
    if (hostOrigin !== null && event.origin !== hostOrigin) return;
    var message = event.data;
    if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0') return;
    var hasId = message.id !== undefined && message.id !== null;
    if (typeof message.method !== 'string') {
      if (!hasId || !pending[message.id]) return;
      var call = pending[message.id];
      delete pending[message.id];
      clearTimeout(call.timer);
      if (message.error) call.reject(new Error(typeof message.error.message === 'string' ? message.error.message : 'Erreur de l’assistant.'));
      else {
        if (call.method === 'ui/initialize') lockOrigin(event.origin);
        call.resolve(message.result);
      }
      return;
    }
    if (hasId) {
      // Requests of the host: the view keeps no state to save before a teardown.
      if (message.method === 'ui/resource-teardown' || message.method === 'ping') send({ jsonrpc: '2.0', id: message.id, result: {} });
      else send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } });
      return;
    }
    var params = message.params && typeof message.params === 'object' ? message.params : {};
    if (message.method === 'ui/notifications/tool-input') state.input = params.arguments || null;
    else if (message.method === 'ui/notifications/tool-result') receive(params);
    else if (message.method === 'ui/notifications/tool-cancelled') showError('L’appel de l’outil a été annulé.');
    else if (message.method === 'ui/notifications/host-context-changed') applyContext(params);
  });

  function applyContext(context) {
    for (var key in context) if (Object.prototype.hasOwnProperty.call(context, key)) state.context[key] = context[key];
    var theme = state.context.theme;
    if (theme === 'dark' || theme === 'light') document.documentElement.setAttribute('data-theme', theme);
  }

  function connect() {
    if (!host || host === window) return;
    request('ui/initialize', {
      appInfo: { name: 'kledg-views', version: '1.0.0' },
      appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] },
      protocolVersion: PROTOCOL_VERSION,
    })
      .then(function (result) {
        state.connected = true;
        applyContext((result && result.hostContext) || {});
        notify('ui/notifications/initialized', {});
        reportSize();
      })
      .catch(function () {
        // Not an MCP Apps host: the ChatGPT globals (below) may still bring the data.
      });
  }

  function reportSize() {
    if (!state.connected) return;
    var doc = document.documentElement;
    var size = { width: Math.ceil(doc.scrollWidth), height: Math.ceil(doc.scrollHeight) };
    var key = size.width + 'x' + size.height;
    if (key === state.lastSize) return;
    state.lastSize = key;
    notify('ui/notifications/size-changed', size);
  }

  if (typeof ResizeObserver === 'function') {
    var scheduled = false;
    new ResizeObserver(function () {
      if (scheduled) return;
      scheduled = true;
      (window.requestAnimationFrame || setTimeout)(function () {
        scheduled = false;
        reportSize();
      });
    }).observe(document.documentElement);
  }

  // ------------------------------------------------------------ results

  function textOf(result) {
    var content = result && Array.isArray(result.content) ? result.content : [];
    for (var i = 0; i < content.length; i++) if (content[i] && content[i].type === 'text' && typeof content[i].text === 'string') return content[i].text;
    return '';
  }

  /** A tool result as { ok, data, text }: structuredContent, else the JSON text the Kledg tools return. */
  function parseResult(result) {
    var text = textOf(result);
    if (!result || result.isError) return { ok: false, data: null, text: text || 'L’outil a renvoyé une erreur.' };
    var data = result.structuredContent && typeof result.structuredContent === 'object' ? result.structuredContent : null;
    if (!data && text) {
      try { data = JSON.parse(text); } catch (e) { data = null; }
    }
    return { ok: true, data: data, text: text };
  }

  function receive(result) {
    if (!result || typeof result !== 'object') return;
    if (result.isError) {
      showError(textOf(result) || 'L’outil a renvoyé une erreur.');
      return;
    }
    var data = result.structuredContent;
    if (!data || typeof data !== 'object') {
      showError('Pas de vue pour ce résultat\u00a0: la réponse en texte reste dans la conversation.');
      return;
    }
    state.data = data;
    draw();
  }

  function draw() {
    if (!state.render || !state.data) return;
    clear(root);
    if (state.data.view !== state.name) {
      showError('Ces données ne correspondent pas à cette vue.');
      return;
    }
    try {
      state.render(state.data, root, api);
    } catch (error) {
      clear(root);
      showError('La vue n’a pas pu afficher ces données\u00a0: la réponse en texte reste dans la conversation.');
    }
    reportSize();
  }

  function showError(message) {
    clear(root);
    root.appendChild(el('div', { class: 'k-error', role: 'alert' }, message));
    reportSize();
  }

  // ------------------------------------------------------------ api for templates

  var api = {
    /** Calls a tool of the Kledg server through the host. Resolves to { ok, data, text }. */
    callTool: function (name, args) {
      if (state.connected) {
        return request('tools/call', { name: name, arguments: args || {} }, 120000).then(parseResult);
      }
      if (openai && typeof openai.callTool === 'function') {
        return Promise.resolve(openai.callTool(name, args || {})).then(function (result) {
          if (result && (result.content || result.structuredContent || result.isError !== undefined)) return parseResult(result);
          return { ok: true, data: result && typeof result === 'object' ? result : null, text: '' };
        });
      }
      return Promise.reject(new Error('Cet assistant n’accepte pas les actions depuis la vue.'));
    },
    /** Sends a message to the conversation as the user. */
    sendMessage: function (text) {
      if (state.connected) return request('ui/message', { role: 'user', content: [{ type: 'text', text: String(text) }] });
      if (openai && typeof openai.sendFollowUpMessage === 'function') return Promise.resolve(openai.sendFollowUpMessage({ prompt: String(text) }));
      return Promise.reject(new Error('Cet assistant n’accepte pas les messages depuis la vue.'));
    },
    /** Opens a page of Kledg in the user's browser (only http and https links). */
    openLink: function (url) {
      if (typeof url !== 'string' || !/^https?:\/\/[^\s]+$/.test(url)) return Promise.reject(new Error('Lien invalide.'));
      if (state.connected) return request('ui/open-link', { url: url });
      if (openai && typeof openai.openExternal === 'function') return Promise.resolve(openai.openExternal({ href: url }));
      return Promise.reject(new Error('Ouvrez le lien depuis Kledg.'));
    },
    /** Tells the assistant what the user did in the view (kept for its next turn). */
    updateContext: function (text) {
      if (!state.connected) return Promise.resolve();
      return request('ui/update-model-context', { content: [{ type: 'text', text: String(text) }] }).catch(function () {});
    },
    /** Shows new data of the same view (after a refresh). */
    show: function (data) {
      if (data && typeof data === 'object') {
        state.data = data;
        draw();
      }
    },
    input: function () { return state.input; },
    resized: function () { reportSize(); },
  };

  // ------------------------------------------------------------ DOM helpers

  function append(node, children) {
    if (children === null || children === undefined || children === false) return node;
    if (Array.isArray(children)) {
      for (var i = 0; i < children.length; i++) append(node, children[i]);
      return node;
    }
    if (typeof children === 'object' && children.nodeType) node.appendChild(children);
    else node.appendChild(document.createTextNode(String(children)));
    return node;
  }

  function setAttributes(node, attributes) {
    if (!attributes) return;
    for (var key in attributes) {
      if (!Object.prototype.hasOwnProperty.call(attributes, key)) continue;
      var value = attributes[key];
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.setAttribute('class', String(value));
      else if (key.slice(0, 2) === 'on' && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : String(value));
    }
  }

  /** An HTML element; text children are text nodes, never parsed. */
  function el(tag, attributes, children) {
    var node = document.createElement(tag);
    setAttributes(node, attributes);
    return append(node, children);
  }

  /** An SVG element. */
  function svg(tag, attributes, children) {
    var node = document.createElementNS(SVG_NS, tag);
    setAttributes(node, attributes);
    return append(node, children);
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  // ------------------------------------------------------------ French formatting

  var NBSP = '\u00a0';
  var MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

  function group(digits) {
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  }

  /** 1234.5 -> "1 234,50 €" (non-breaking spaces), no "-0,00 €". */
  function euros(value) {
    if (typeof value !== 'number' || !isFinite(value)) return '';
    var cents = Math.round(value * 100);
    var negative = cents < 0;
    var abs = Math.abs(cents);
    var text = group(String(Math.floor(abs / 100))) + ',' + String(abs % 100).padStart(2, '0') + NBSP + '€';
    return negative ? '-' + text : text;
  }

  function number(value, decimals) {
    if (typeof value !== 'number' || !isFinite(value)) return '';
    var d = typeof decimals === 'number' ? decimals : 0;
    var fixed = Math.abs(value).toFixed(d).split('.');
    var text = group(fixed[0]) + (fixed[1] && Number(fixed[1]) !== 0 ? ',' + fixed[1].replace(/0+$/, '') : '');
    return (value < 0 && Number(fixed.join('.')) !== 0 ? '-' : '') + text;
  }

  function percent(value) {
    if (typeof value !== 'number' || !isFinite(value)) return '';
    return number(value, 2) + NBSP + '%';
  }

  /** "2025-03-14" -> "14/03/2025". */
  function date(value) {
    if (typeof value !== 'string') return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    return m ? m[3] + '/' + m[2] + '/' + m[1] : value;
  }

  /** "2025-03" -> "mars 2025". */
  function month(value) {
    if (typeof value !== 'string') return '';
    var m = /^(\d{4})-(\d{2})/.exec(value);
    if (!m) return value;
    var index = Number(m[2]) - 1;
    return (MONTHS[index] || m[2]) + NBSP + m[1];
  }

  function format(value, kind) {
    if (value === null || value === undefined) return '';
    if (kind === 'euros') return euros(value);
    if (kind === 'percent') return percent(value);
    if (kind === 'number') return number(value, 2);
    if (kind === 'date') return date(value);
    if (kind === 'month') return month(value);
    return String(value);
  }

  // ------------------------------------------------------------ shared pieces

  /** Title, subtitle, notice and links of every view. */
  function header(data) {
    var nodes = [el('div', { class: 'k-head' }, el('div', null, [el('h1', null, data.title), data.subtitle ? el('p', { class: 'k-sub' }, data.subtitle) : null]))];
    if (data.notice) nodes.push(el('p', { class: 'k-notice' }, data.notice));
    return nodes;
  }

  function footer(data) {
    var nodes = [];
    if (Array.isArray(data.warnings) && data.warnings.length) {
      nodes.push(el('ul', { class: 'k-warnings', 'aria-label': 'Points d’attention' }, data.warnings.map(function (w) { return el('li', null, w); })));
    }
    if (Array.isArray(data.links) && data.links.length) {
      nodes.push(el('div', { class: 'k-footer' }, data.links.map(function (link) { return linkButton(link.label, link.url); })));
    }
    return nodes;
  }

  function linkButton(label, url) {
    return el('button', {
      type: 'button',
      class: 'k-btn k-btn-link',
      onclick: function () { api.openLink(url).catch(function () {}); },
    }, label);
  }

  function figures(items) {
    if (!Array.isArray(items) || !items.length) return null;
    return el('ul', { class: 'k-figures' }, items.map(function (f) {
      var text = typeof f.value === 'number' ? format(f.value, f.format || 'euros') : String(f.value);
      return el('li', null, [el('span', { class: 'k-figure-label' }, f.label), el('span', { class: 'k-figure-value' }, text)]);
    }));
  }

  /** A table cell for a value, right aligned when it is a number. */
  function cell(value, kind, tag) {
    var numeric = kind === 'euros' || kind === 'percent' || kind === 'number';
    var cls = numeric ? 'k-num' + (typeof value === 'number' && value < 0 ? ' k-neg' : '') : kind === 'date' || kind === 'month' ? 'k-nowrap' : null;
    return el(tag || 'td', { class: cls }, format(value, kind));
  }

  window.Kledg = {
    view: function (name, render) {
      state.name = name;
      state.render = render;
      root.appendChild(el('p', { class: 'k-loading', role: 'status' }, 'Chargement des données de Kledg…'));
      connect();
      if (openai) {
        if (openai.theme === 'dark' || openai.theme === 'light') applyContext({ theme: openai.theme });
        if (openai.toolOutput && typeof openai.toolOutput === 'object' && !state.data) receive({ structuredContent: openai.toolOutput });
        window.addEventListener('openai:set_globals', function (event) {
          var globals = event && event.detail && event.detail.globals;
          if (globals && globals.toolOutput && typeof globals.toolOutput === 'object' && !state.connected) receive({ structuredContent: globals.toolOutput });
          if (globals && (globals.theme === 'dark' || globals.theme === 'light')) applyContext({ theme: globals.theme });
        });
      }
    },
    el: el,
    svg: svg,
    clear: clear,
    euros: euros,
    number: number,
    percent: percent,
    date: date,
    month: month,
    format: format,
    header: header,
    footer: footer,
    figures: figures,
    cell: cell,
    linkButton: linkButton,
  };
})();
`
