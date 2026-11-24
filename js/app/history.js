// ArchiMate Browser: what others change (2.14.0). MU-13: the open model is checked for changes made
// elsewhere (the MCP server, another person, a script), and a bar offers to load them. MU-17: the
// record of changes (API 3.11.0) of an element, relationship or view, and of the model, in the details.
// 2.26.0 (MU-14): with the API's change events (3.17.0) the bar comes at once, with who changed what from
// the event; polling every changeCheckSeconds is what is left when the stream cannot be had.

import { api, isAbort, isOffline, isOwnRequest, olderThan } from '../api.js';
import { ChangeStream } from '../events.js';
import { settings } from '../config.js';
import { t } from '../i18n.js';
import { prettyType } from '../archimate.js';
import { link, setDetailTab } from './details.js';
import { canPutBack, putBack } from './editing.js';
import { refreshModelList, refreshModels } from './models.js';
import { select } from './routing.js';
import { $, state } from './state.js';
import { errorBox, h, may } from './ui.js';

// ================================================================ the change bar (MU-13)

let timer = null;
let stream = null;    // the change events of the open model (2.26.0)
let known = null;     // the revision of the model as loaded
let shownFor = null;  // the revision the bar was shown (or dismissed) for
let pending = [];     // 2.26.0: the change events of others since the model was loaded

/**
 * Watch the model just opened: through the API's change events (3.17.0), or else by checking its revision
 * every changeCheckSeconds while the page is visible.
 */
export function watchModel(store) {
  stopPolling();
  stream?.stop();
  stream = null;
  hideBar();
  known = store?.stats?.revision ?? null;
  shownFor = null;
  pending = [];
  if (!store || known == null) return;
  if (!isOffline() && state.apiVersion && !olderThan(state.apiVersion, '3.17.0')) {
    stream = new ChangeStream({ model: store.id, onEvent: e => changeEvent(store, e), onState: s => streamState(store, s) }).start();
  } else {
    startPolling(store);
  }
}

function startPolling(store) {
  const every = Number(settings.changeCheckSeconds) || 0;
  if (timer || every <= 0) return;
  timer = setInterval(() => check(store), every * 1000);
}

function stopPolling() {
  clearInterval(timer);
  timer = null;
}

/** The stream answers: no polling; it is down: polling meanwhile (it is tried again); off: polling. */
function streamState(store, s) {
  if (state.store !== store) return;
  if (s === 'open') stopPolling();
  else startPolling(store);
}

let listTimer = null;

function changeEvent(store, { event, data }) {
  if (state.store !== store) return;
  if (event === 'reset') { check(store); return; } // what came meanwhile cannot be told: the revision can
  if (event !== 'change' || !data) return;
  const own = isOwnRequest(data.requestId);
  if (data.modelId !== store.id) {
    // another model made, renamed, imported or deleted: the list of models follows (nothing open there)
    if (data.kind === 'model' && !own) {
      clearTimeout(listTimer);
      listTimer = setTimeout(refreshModelList, 300);
    }
    return;
  }
  if (own) { // this page's change: not "changed since it was loaded"
    if (data.revision != null) known = Math.max(known, data.revision);
    return;
  }
  if (data.op === 'deleteModel') {
    $('#change-bar-msg').textContent = t('The model was deleted elsewhere.');
    $('#change-bar').hidden = false;
    return;
  }
  if (data.revision != null && data.revision <= known) return;
  pending.push(data);
  shownFor = data.revision ?? shownFor;
  barFromEvents();
}

/** The bar, with who changed what when the events say it (they do for editors, as the record of changes). */
function barFromEvents() {
  const n = pending.reduce((sum, d) => sum + (d.count || 1), 0);
  const who = [...new Set(pending.map(d => d.user).filter(Boolean))];
  const clients = [...new Set(pending.map(d => d.client).filter(Boolean))];
  $('#change-bar-msg').textContent = who.length
    ? t('The model was changed since it was loaded: {n} change(s) by {who}{via}.', { n, who: who.join(', '), via: clients.length ? ` (${clients.join(', ')})` : '' })
    : t('The model was changed since it was loaded.');
  $('#change-bar').hidden = false;
}

async function check(store) {
  if (state.store !== store || document.hidden) return;
  let model;
  try {
    model = await api.getModel(store.id);
  } catch { return; } // the API down: the banner of connection.js says so; a deleted model: the next request says so
  if (state.store !== store || model.revision <= known || model.revision === shownFor) return;
  shownFor = model.revision;
  showBar(store, model.revision);
}

async function showBar(store, revision) {
  $('#change-bar-msg').textContent = t('The model was changed since it was loaded.');
  $('#change-bar').hidden = false;
  if (!may('write')) return; // the record of changes is for editors (API 3.11.0)
  try {
    const { items } = await api.history(store.id, { limit: 100 });
    const newer = items.filter(e => e.revision != null && e.revision > known);
    if (state.store !== store || !newer.length) return;
    const who = [...new Set(newer.map(e => e.user || t('someone')))];
    const clients = [...new Set(newer.map(e => e.client).filter(Boolean))];
    $('#change-bar-msg').textContent = t('The model was changed since it was loaded: {n} change(s) by {who}{via}.', {
      n: newer.length, who: who.join(', '), via: clients.length ? ` (${clients.join(', ')})` : '' });
  } catch { /* the plain message stays */ }
}

/** BR-25: this page changed the model (a created view): that change is not "changed since it was loaded". */
export function ownChange() {
  if (known != null) known += 1;
}

export function hideBar() {
  $('#change-bar').hidden = true;
  pending = [];
}

/** Wires the bar's buttons (once, from app.js). */
export function setupChangeBar() {
  $('#btn-change-refresh').addEventListener('click', () => { hideBar(); refreshModels(); });
  $('#btn-change-show').addEventListener('click', () => { if (state.store) { setDetailTab('history'); select('model', state.store.id); } });
  $('#btn-change-dismiss').addEventListener('click', hideBar);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.store) check(state.store); });
}

// ================================================================ the record of changes (MU-17)

const OP = {
  create: () => t('created'), update: () => t('changed'), delete: () => t('deleted'),
  import: () => t('imported'), replace: () => t('replaced from a file'), deleteModel: () => t('model deleted'),
  createContent: () => t('drawn'), updateContent: () => t('content saved'), // a created view's content (API 3.15.0)
  unlink: () => t('unlinked from its file'), // API 3.17.0
};
const KIND = {
  element: () => t('element'), relationship: () => t('relationship'), view: () => t('view'), node: () => t('node in a view'),
  connection: () => t('line in a view'), folder: () => t('folder'), filing: () => t('filing'), property: () => t('property'),
  propertyDefinition: () => t('property definition'), metadata: () => t('metadata'), model: () => t('model'),
};
const SHOWN_FIELDS = ['name', 'label', 'value', 'type', 'documentation'];

const short = (v, n = 60) => {
  const text = v == null ? '' : String(v);
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
};

/** What an update changed, in a line: names and values before and after, other fields by name. */
function fieldsText(entry) {
  if (entry.op !== 'update') return '';
  const after = entry.after || {}, before = entry.before || {};
  const parts = [];
  for (const key of Object.keys(after)) {
    if (key === 'documentation') parts.push(t('documentation'));
    else if (SHOWN_FIELDS.includes(key)) {
      const show = v => (key === 'type' ? prettyType(v) : short(v));
      parts.push(`${key}: “${show(before[key])}” → “${show(after[key])}”`);
    } else parts.push(key);
  }
  return parts.join('; ');
}

const when = iso => new Date(iso).toLocaleString();

function entryRow(e, { withItem }) {
  const item = withItem ? itemLink(e) : null;
  const what = fieldsText(e);
  return h('li', { class: 'history-entry' },
    h('span', { class: 'muted' }, when(e.time)), ' · ', h('strong', {}, e.user || t('(no user)')),
    e.client ? h('span', { class: 'muted' }, ` (${e.client})`) : '', ' · ',
    OP[e.op]?.() ?? e.op,
    item ? [' ', item] : '',
    what ? h('div', { class: 'history-fields' }, what) : '',
    // BR-11 (E9): with ✎ Edit on, an earlier name or documentation back into the form
    canPutBack(e) ? h('button', { type: 'button', class: 'linklike', 'data-put-back': e.itemId, onclick: () => putBack(e) }, t('Put back')) : '');
}

/** The item an entry is about, linked when it can be shown. */
function itemLink(e) {
  const label = `${KIND[e.kind]?.() ?? e.kind} ${e.name ? `“${short(e.name, 40)}”` : `#${e.itemId ?? ''}`}`;
  const s = state.store;
  const exists = e.op !== 'delete' && (
    (e.kind === 'element' && s?.elements.has(e.itemId)) || (e.kind === 'relationship' && s?.relationships.has(e.itemId))
    || (e.kind === 'view' && s?.view(e.itemId)));
  return exists ? link(label, () => select(e.kind, e.itemId)) : h('span', {}, label);
}

/**
 * The "History" section of an element, relationship or view (kind, id), or of the whole model (no id): the
 * newest changes first. Empty for a key that may not read the record (the API gives it to editors).
 * `heading: false` in the History tab of the details (2.19.0), which names it already.
 */
const HISTORY_PAGE = 50;

export function historySection(kind, id, signal, xmiIdentifier = null, { heading = true } = {}) {
  if (!may('write')) return null;
  const box = h('div', {}, h('p', { class: 'muted' }, t('Loading…')));
  const s = state.store;
  // by XMI identifier where there is one: it stays across a replace, an id may be given again (API 3.11.0)
  const query = kind === 'model' ? {} : xmiIdentifier ? { kind, xmiIdentifier } : { kind, itemId: id };
  const list = h('ul', { class: 'rels history' });
  const more = h('div', { class: 'history-more' });
  let shown = 0;
  // 2.28.0: a page at a time, newest first; "Show older changes" fetches the next page
  const load = async () => {
    try {
      const { items, total } = await api.history(s.id, { ...query, limit: HISTORY_PAGE, offset: shown }, { signal });
      if (signal?.aborted) return;
      if (!shown && !items.length) {
        box.replaceChildren(h('p', { class: 'muted' }, kind === 'model'
          ? t('No changes recorded yet (the record starts with API 3.11.0).')
          : t('No changes recorded (the record starts with API 3.11.0; an import is recorded for the whole model).')));
        return;
      }
      list.append(...items.map(e => entryRow(e, { withItem: kind === 'model' })));
      shown += items.length;
      const rest = total - shown;
      more.replaceChildren(
        h('p', { class: 'muted' }, t('{n} of {total} changes shown.', { n: shown, total })),
        rest > 0 && items.length ? h('button', {
          type: 'button', 'data-history-more': '',
          onclick: ev => { ev.currentTarget.disabled = true; load(); },
        }, t('Show {n} older change|Show {n} older changes', { n: Math.min(rest, HISTORY_PAGE) })) : null);
      if (!list.isConnected) box.replaceChildren(list, more);
    } catch (e) {
      if (isAbort(e)) return;
      if (e.status === 404) { box.replaceChildren(h('p', { class: 'muted' }, t('This API keeps no record of changes (it needs 3.11.0).'))); return; }
      box.replaceChildren(errorBox(e, () => { box.replaceChildren(h('p', { class: 'muted' }, t('Loading…'))); load(); }, { compact: true }));
    }
  };
  load();
  return [heading ? h('h3', {}, kind === 'model' ? t('Recent changes') : t('History')) : null, box];
}
