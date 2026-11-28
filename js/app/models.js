// ArchiMate Browser: Model loading, search, settings, the Content-Security-Policy notes, import / delete, linked models.
// Part of js/app.js until 2026-10-24 (EN-6); app.js wires it to the page.

import { api, isAbort, isOffline, olderThan } from '../api.js';
import { settings } from '../config.js';
import { t, lang } from '../i18n.js';
import { Tree } from '../tree.js';
import { ModelStore } from '../store.js';
import { APP_VERSION } from '../version.js';
import { menuItems, moveInMenu } from '../menu.js';
import { prettyType } from '../archimate.js';
import { PropertyOptions, describeConditions, parsePropertySearch, searchConditions, searchParams } from '../properties.js';
import { loadBasket, updateBasket } from './basket.js';
import { link, renderDetails } from './details.js';
import { resetDiagram, treeDragData } from './diagram.js';
import { closeNodeMenu, markElements, openTreeMenu, refreshMarks, selectInfo } from './menus.js';
import { drillToView, propertyPanel, renderLayoutPanel, setPropertyOptions } from './panels.js';
import { applyHash, modelMatches, modelsOfLink, readHash, resolveHash, select } from './routing.js';
import { autoPane, setSectionCollapsed, showPane } from './shell.js';
import { $, state } from './state.js';
import { openSignIn, updateWho } from './signin.js';
import { watchModel } from './history.js';
import { syncEditButton } from './editing.js';
import { restoreTabs, saveTabs } from './tabs.js';
import { buildTree, elementSpec, relationshipSpec, viewSpec } from './treespecs.js';
import { openLiveRecipe } from './views.js';
import { RENDER_MODE, apiTooOld, cancelJob, errorBox, errorMessage, forbiddenText, h, may, startJob, status } from './ui.js';

// API-8: what the API key in use may do (GET auth/me), or null while unknown; then nothing is hidden
export let me = null;

// ================================================================ model loading

export let tree, searchTree;

export async function loadModels() {
  status(t('Connecting…'));
  const sel = $('#model-select');
  const signal = startJob('model');
  $('#tree').replaceChildren(h('div', { class: 'placeholder' }, t('Connecting…')));
  let models;
  try {
    // API-8: what this key may do decides which buttons are offered; an answer is not required.
    // UP-1: the version is checked before anything is shown, so an older API fails here and not half-way.
    let health;
    [models, me, health] = await Promise.all([api.listModels({ signal }), api.me({ signal }).catch(() => null), api.health({ signal }).catch(() => null)]);
    const old = apiTooOld(health);
    if (old) throw old;
    state.apiVersion = health?.version || null;
    updateModelButtons();
    updateWho();
  } catch (e) {
    if (isAbort(e) || signal.aborted) return;
    if (e.status === 404 && e.code !== 'API_TOO_OLD') e = apiTooOld(await api.health().catch(() => null)) || e;
    me = null;
    updateWho();
    status(errorMessage(e), true);
    sel.replaceChildren();
    const box = errorBox(e, loadModels);
    if (e.status !== 401 && e.status !== 403) box.querySelector('.actions').append(h('button', { type: 'button', onclick: openSettings }, t('Open settings')));
    $('#tree').replaceChildren(box);
    // MU-4: without a key the API takes, the way on is to sign in
    if (e.status === 401) openSignIn(settings.apiKey ? errorMessage(e) : t('The ArchiMate API needs a key: sign in with yours.'));
    return;
  }
  state.models = models;
  fillModelSelect(models);
  if (!models.length) {
    state.store = null;
    updateModelButtons();
    status(t('The API contains no models.'));
    $('#tree').replaceChildren(h('div', { class: 'placeholder' }, h('p', {}, t('No models yet.')),
      may('import') ? h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: openImport }, t('Import model…')),
        h('button', { onclick: openNewModel }, t('New model…'))) : null));
    renderDetails(null);
    return;
  }
  if (me?.expiresSoon) status(`${status.last} · ${t('your key expires on {date}', { date: me.expiresAt.slice(0, 10) })}`, true);
  const hash = readHash();
  const wanted = (hash.model && await modelOfLink(hash.model, models)) || models[0];
  if (signal.aborted) return;
  sel.value = wanted.id;
  await openModel(wanted, hash);
}

function fillModelSelect(models) {
  // copies often keep the name too: then the number tells them apart
  const named = name => models.filter(m => m.name === name).length;
  // 2.32.0: by name (as people look for them; the API lists them by id), copies by id
  const sorted = [...models].sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base', numeric: true }) || a.id - b.id);
  $('#model-select').replaceChildren(...sorted.map(m => h('option', { value: m.id }, named(m.name) > 1 ? `${m.name} (#${m.id})` : m.name)));
}

/**
 * 2.26.0: the list of models again, after a change event says a model was made, renamed, imported or deleted
 * elsewhere. The open model stays as it is; while it is gone from the list (deleted elsewhere, which the
 * change bar says), the list is left alone.
 */
export async function refreshModelList() {
  let models;
  try {
    models = await api.listModels();
  } catch { return; }
  if (state.store && !models.some(m => m.id === state.store.id)) return;
  state.models = models;
  fillModelSelect(models);
  if (state.store) $('#model-select').value = state.store.id;
}

/**
 * BR-21: the model list and the open model loaded again from the API, so that models and changes made
 * elsewhere (the MCP server, Archi, a script) appear. The open tabs and the diagram shown stay; a model
 * that is gone gives way to the first one.
 */
export async function refreshModels() {
  if (state.store) saveTabs();
  await loadModels();
}

/**
 * The model the `model=` of a link names (null: none). When several models share the identifier
 * it names (API 2.10.0), the user picks one; cancelling opens the oldest.
 */
export async function modelOfLink(token, models) {
  const found = modelsOfLink(token, models);
  return found.length > 1 ? (await chooseModel(found)) || found[0] : found[0] || null;
}

/** Resolves to the model the user picks from `models`, or null. */
export function chooseModel(models) {
  return new Promise(resolve => {
    const dialog = $('#choose-model-dialog');
    let picked = null;
    $('#choose-model-text').textContent = t('The link names a model by an identifier that {n} models share. Which one should open?', { n: models.length });
    $('#choose-model-list').replaceChildren(...models.map(m => h('button', {
      type: 'button', class: 'choose-model', 'data-model': m.id,
      onclick: () => { picked = m; dialog.close('ok'); },
    }, t('{name} (model #{id}, revision {revision})', { name: m.name, id: m.id, revision: m.revision }))));
    dialog.addEventListener('close', () => resolve(picked), { once: true });
    dialog.showModal();
  });
}

/** 2.35.0: live recipe templates (API 3.26.0), not in an offline copy. */
export const canLiveTemplates = () => !isOffline() && !!state.apiVersion && !olderThan(state.apiVersion, '3.26.0');

export async function openModel(model, hash = {}) {
  const signal = startJob('model'); // EN-2: another model chosen meanwhile cancels this one
  status(t('Loading {name}…', { name: model.name }));
  $('#tree').replaceChildren(h('div', { class: 'placeholder' }, t('Loading model…')));
  const store = new ModelStore(model);
  try {
    await store.load(msg => { if (!signal.aborted) status(msg); }, { signal });
  } catch (e) {
    if (isAbort(e) || signal.aborted) return;
    status(errorMessage(e), true);
    $('#tree').replaceChildren(errorBox(e, () => openModel(model, hash)));
    return;
  }
  if (signal.aborted) return;
  if (canLiveTemplates()) await store.loadLiveScripts({ signal }).catch(() => { /* listed when they can be read */ });
  if (signal.aborted) return;
  // The search shown was made in the model before: closed, or, when the same model was opened
  // again (updated from its file, replaced by an import), asked again, since its ids may differ now.
  const searchAgain = !$('#search-results').hidden && searchShown?.modelId === store.id ? searchShown.q : null;
  closeSearch();
  state.store = store;
  state.link = null;
  watchModel(store); // MU-13: changes made elsewhere from now on
  loadLink(store);
  // the hash may have changed while the model was loading (a pasted link, a deep link): use the current one
  const current = readHash();
  if (!current.model || modelMatches(current.model, model)) hash = current;
  resetDiagram();
  updateModelButtons();
  propertyPanel.redraw(); // property names/values of this model
  renderLayoutPanel(); // … and in Label and Colour by
  loadBasket({ signal }) // the identifiers stored are resolved by the API
    .then(() => {
      if (state.store !== store || !state.basket.size) return;
      updateBasket();
      status(`${status.last} · ${t('basket restored ({n})', { n: state.basket.size })}`);
    })
    .catch(e => { if (!isAbort(e)) status(errorMessage(e), true); });
  updateBasket();
  state.marked.clear();
  refreshMarks();
  tree = new Tree($('#tree'), {
    label: t('Model'),
    dragData: treeDragData,
    onContextMenu: (data, spec, at) => openTreeMenu(data, spec, at, tree.root),
    onMark: markElements, isMarked: d => d?.kind === 'element' && state.marked.has(d.id),
    onSelect: data => {
      if (state.marked.size) markElements([], 'set'); // a plain click ends a multi-selection
      if (data.kind === 'type') selectType(data.type);
      else if (data.kind === 'layer' || data.kind === 'reltype') selectInfo(data);
      else if (data.kind === 'property' || data.kind === 'propvalue') selectInfo({ kind: 'property', name: data.name });
      else if (data.drill) drillToView(data.id); // view link inside a view's node tree
      else if (data.kind === 'liverecipe') openLiveRecipe(data.recipe, data.name); // 2.35.0
      else if (data.kind === 'livescript') { /* its entries are below it */ }
      else select(data.kind, data.id ?? null, { fromTree: true });
    },
  });
  tree.setRoots(buildTree(store));
  status(t('{elements} elements · {relationships} relationships · {views} views', { elements: store.stats.elements.total, relationships: store.stats.relationships.total, views: store.stats.views.total }));
  // Property options on a property this model does not have: a filter would leave every diagram
  // empty, a label or colours would show nothing. Each such option is removed.
  const missing = name => name && !store.propertyIndex.has(name);
  const { filterName, label, colour } = state.props;
  if (missing(filterName) || missing(label) || missing(colour)) {
    setPropertyOptions(new PropertyOptions({
      ...state.props,
      ...(missing(filterName) ? { filterName: '', filterOp: 'has', filterValue: '' } : {}),
      ...(missing(label) ? { label: '' } : {}),
      ...(missing(colour) ? { colour: '' } : {}),
    }), { rerender: false, redraw: true });
    const removed = [
      missing(filterName) ? t('property filter on “{name}”', { name: filterName }) : null,
      missing(label) ? t('label “{name}”', { name: label }) : null,
      missing(colour) ? t('colour by “{name}”', { name: colour }) : null,
    ].filter(Boolean);
    status(`${status.last} · ${t('removed, this model has no such property: {what}', { what: removed.join(', ') })}`);
  }

  let resolved = hash;
  try {
    resolved = await resolveHash(hash, { signal });
  } catch (e) {
    if (isAbort(e) || signal.aborted) return;
    status(errorMessage(e), true); // the model is open; the link's items are left out
    resolved = { model: hash.model };
  }
  if (signal.aborted) return;
  if (!applyHash(resolved)) select('model', model.id);
  if (!RENDER_MODE) restoreTabs(); // BR-15: the other tabs that were open before a reload (RN-1: one diagram at a time)
  if (searchAgain) {
    $('#search-input').value = searchAgain;
    runSearch(searchAgain, { showPane: false });
  }
}

/** 2.30.0: "Rename model…": its name and documentation (admin, as the API asks). */
export async function renameModel() {
  const s = state.store;
  if (!s) return;
  const { askNameAndText } = await import('./views.js');
  const m = s.model;
  const asked = await askNameAndText({ title: t('Rename model'), name: m.name, documentation: m.documentation, okLabel: t('Save') });
  if (!asked) return;
  try {
    const updated = await api.updateModel(s.id, asked, { revision: m.revision });
    Object.assign(s.model, updated);
    state.models = state.models.map(x => (x.id === s.id ? { ...x, ...updated } : x));
    fillModelSelect(state.models);
    $('#model-select').value = s.id;
    tree?.setRoots(buildTree(s));
    select('model', s.id);
    status(t('Model renamed to “{name}”.', { name: updated.name }));
  } catch (e) {
    status(e.status === 412 ? t('Rename model: the model was changed meanwhile. Refresh and try again.')
      : `${t('Rename model')}: ${errorMessage(e)}`, true);
  }
}

export function selectType(type) {
  state.selection = { kind: 'type', type };
  renderDetails(state.selection);
}

// ================================================================ search

export const SEARCH_PAGE = 50;
export const SEARCH_KINDS = ['elements', 'relationships', 'views'];
// the search shown in the results pane: { q, params, property, modelId, groups: { elements: { items, total }, … } }
export let searchShown = null;

/**
 * Search the model (API-6). The API does the searching, also for a property
 * query ("@name=value" etc., see parsePropertyQuery): it returns one group
 * per kind, best match first, a page at a time; "Show more" fetches the
 * next page of one group.
 */
/** Hide the search results and forget them: Close, or another model opened. A search on its way is cancelled. */
export function closeSearch() {
  cancelJob('search');
  $('#search-results').hidden = true;
  $('#search-input').value = '';
  searchShown = null;
  searchTree?.setRoots([]);
}

export async function runSearch(q, { showPane = true } = {}) {
  if (!state.store || !q.trim()) return;
  const store = state.store;
  const box = $('#search-results');
  box.hidden = false;
  if (box.classList.contains('collapsed')) setSectionCollapsed(box, false); // new results are shown
  if (showPane) autoPane('tree'); // UX-1: the results are in the tree pane
  $('#search-title').textContent = t('Search: “{query}”', { query: q });
  // don't move the main tree while clicking through results ("Show in tree" does that)
  searchTree ??= new Tree($('#search-tree'), {
    label: t('Search results'),
    onSelect: d => {
      if (d.kind === 'results') return; // a group heading (its menu acts on all results)
      if (d.kind === 'more') { moreResults(d.what); return; }
      if (state.marked.size) markElements([], 'set');
      select(d.kind, d.id, { reveal: false });
    },
    dragData: spec => resultsDragData(spec) ?? treeDragData(spec),
    onContextMenu: (data, spec, at) => openTreeMenu(data, spec, at, searchTree.root),
    onMark: markElements, isMarked: d => d?.kind === 'element' && state.marked.has(d.id),
  });
  searchTree.setRoots([{ label: t('Searching…'), muted: true }]);

  // a property search, "@name=value", also several conditions with AND and OR (2.28.0, API 3.20.0)
  const groups = parsePropertySearch(q);
  const single = groups?.length === 1 && groups[0].length === 1 ? groups[0][0] : null;
  const property = single || (groups && { describeFilter: () => describeConditions(groups) });
  if (groups && !single && (!state.apiVersion || olderThan(state.apiVersion, '3.20.0'))) {
    $('#search-title').textContent = t('Search: “{query}”', { query: q });
    searchTree.setRoots([{ label: t('Property searches with AND and OR need API 3.20.0.'), muted: true }]);
    return;
  }
  const params = {
    ...(single ? searchParams(single) : groups ? { properties: searchConditions(groups) } : { q: q.trim() }),
    kinds: SEARCH_KINDS.join(','), limit: SEARCH_PAGE,
  };
  const signal = startJob('search'); // EN-2: a newer search cancels this one
  try {
    const res = await api.search(store.id, params, { signal });
    await cacheHits(store, res, signal);
    if (signal.aborted || state.store !== store) return;
    searchShown = { q, params, property, modelId: store.id, groups: Object.fromEntries(SEARCH_KINDS.map(k => [k, { items: res[k].items, total: res[k].total }])) };
    drawSearch();
  } catch (e) {
    if (isAbort(e) || signal.aborted || state.store !== store) return;
    $('#search-title').textContent = t('Search: “{query}”', { query: q });
    searchTree.setRoots([]);
    searchTree.root.replaceChildren(h('li', {}, errorBox(e, () => runSearch(q), { compact: true })));
  }
}

/** UP-3: the elements and relationships found, cached complete: rows with counts, relationships with named ends. */
function cacheHits(store, res, signal) {
  return store.ensure({ elements: (res.elements?.items || []).map(e => e.id), relationships: (res.relationships?.items || []).map(r => r.id) },
    { signal, degree: true });
}

/** The next page of one group of the search shown. */
export async function moreResults(kind) {
  const shown = searchShown, group = shown?.groups[kind];
  if (!group || group.loading) return;
  group.loading = true;
  const signal = startJob('search');
  try {
    const res = await api.search(shown.modelId, { ...shown.params, kinds: kind, offset: group.items.length }, { signal });
    await cacheHits(state.store, res, signal);
    if (signal.aborted || searchShown !== shown) return;
    group.items.push(...res[kind].items);
    group.total = res[kind].total;
    drawSearch(kind);
  } catch (e) {
    if (!isAbort(e)) status(errorMessage(e), true);
  } finally {
    group.loading = false;
  }
}

/** Draw the search shown: a heading per kind with its total, the hits, and "Show more" while there are more. */
export function drawSearch(expand = null) {
  const { q, property, groups } = searchShown;
  const s = state.store;
  // where the text was found, when not in the name; a property search has no text
  const where = hit => (hit.match?.rank === 5 ? t('in a property') : hit.match?.rank === 6 ? t('in the documentation') : undefined);
  const specs = {
    elements: groups.elements.items.map(e => elementSpec(s.element(e.id) || e, { sub: where(e) })),
    relationships: groups.relationships.items.map(r => ({ ...relationshipSpec(s.relationship(r.id) || r), ...(where(r) ? { sub: where(r) } : {}) })),
    views: groups.views.items.map(v => ({ ...viewSpec(s.view(v.id) || v), ...(where(v) ? { sub: where(v) } : {}) })),
  };
  const total = SEARCH_KINDS.reduce((n, k) => n + groups[k].total, 0);
  const shown = SEARCH_KINDS.reduce((n, k) => n + groups[k].items.length, 0);
  $('#search-title').textContent = property ? t('Property search: {filter} — {n} hits', { filter: property.describeFilter(), n: total })
    : total > shown ? t('Search: “{query}” — first {n} of {total} hits', { query: q, n: shown, total })
    : t('Search: “{query}” — {n} hits', { query: q, n: shown });
  const few = groups.elements.items.length < 20;
  const group = (kind, icon, label, expanded) => {
    const g = groups[kind], rest = g.total - g.items.length;
    const more = rest > 0 ? [{ icon: '…', label: t('Show {n} more of {total}', { n: Math.min(rest, SEARCH_PAGE), total: g.total }), data: { kind: 'more', what: kind } }] : [];
    return { key: `s:${kind}`, icon, label, sub: String(g.total), children: [...specs[kind], ...more], expanded: expanded || expand === kind, data: resultsData(kind, specs[kind]) };
  };
  searchTree.setRoots([
    group('elements', '◧', t('Elements'), true),
    group('relationships', '⇢', t('Relationships'), groups.relationships.items.length > 0 && few),
    group('views', '🖼', t('Views'), groups.views.items.length > 0 && few),
  ]);
}

/** Data of a search-result heading (CM-5): the ids of its rows; none (no menu) when empty. */
/**
 * Drag payload of a search results group: the found elements ("Diagram of the results"),
 * the ends of the found relationships ("Diagram of their ends"), or the elements shown
 * in the found views ("Diagram of their elements").
 */
export function resultsDragData(spec) {
  const d = spec.data;
  if (d?.kind !== 'results' || !d.ids.length) return null;
  if (d.what === 'elements') return `found:${d.ids.join('.')}`;
  if (d.what === 'relationships') return `foundrels:${d.ids.join('.')}`;
  if (d.what === 'views') return `foundviews:${d.ids.join('.')}`;
  return null;
}

export function resultsData(what, specs) {
  const ids = specs.map(sp => sp.data?.id).filter(id => id != null);
  return ids.length ? { kind: 'results', what, ids } : undefined;
}

// ================================================================ settings

export async function openSettings() {
  const dlg = $('#settings-dialog');
  const f = $('#settings-form');
  f.lang.value = settings.lang || '';
  f.apiBase.value = settings.apiBase;
  f.apiKey.value = settings.apiKey;
  f.apiKeyRemember.checked = !!settings.apiKeyRemember;
  f.plantumlServer.value = settings.plantumlServer;
  f.plantumlLegend.checked = !!settings.plantumlLegend;
  f.plantumlSketch.checked = !!settings.plantumlSketch;
  f.wholeModelMax.value = String(settings.wholeModelMax ?? 300);
  proxyInfo ??= await fetch('__proxy/info').then(r => (r.ok ? r.json() : false)).catch(() => false); // false: not served by serve.py
  $('#proxy-key-note').textContent = proxyInfo?.apiKeyInjected
    ? t('The local proxy injects an API key for {api}; you can leave this empty.', { api: proxyInfo.api })
    : t('Leave empty if the proxy injects the key.');
  checkCspNotes();
  // UP-1: which API answers at the saved base URL
  const version = $('#api-version-note');
  const browser = t('ArchiMate Browser {version}.', { version: APP_VERSION });
  version.textContent = browser;
  api.health().then(hl => {
    if (hl.version) version.textContent = `${browser} ${t('Connected to ArchiMate API {version}.', { version: hl.version })}`;
  }).catch(() => { /* the banner and the panes report an unreachable API */ });
  dlg.showModal();
}

// ---------------------------------------------------------------- Content-Security-Policy (EN-3)

export let proxyInfo = null; // GET __proxy/info of serve.py: { api, apiKeyInjected, csp: { allow } | null }, or false

/** The origin of `url` when the page may not contact it under serve.py's CSP, else null. */
export function cspBlockedOrigin(url) {
  const allow = proxyInfo?.csp?.allow;
  if (!allow) return null; // no CSP (or not served by serve.py)
  let origin;
  try { origin = new URL(url, location.href).origin; } catch { return null; }
  return origin === location.origin || allow.includes(origin) ? null : origin;
}

/** Settings dialog: warn when the PlantUML server or a direct API URL is not allowed by the CSP. */
export function checkCspNotes() {
  const f = $('#settings-form');
  const note = (el, url) => {
    const origin = cspBlockedOrigin(url);
    el.hidden = !origin;
    if (origin) el.textContent = t('The server\'s security policy blocks {origin}. Start the server with --csp-allow {origin} (e.g. archimatebrowser.bat start --csp-allow {origin}).', { origin });
  };
  note($('#plantuml-csp-note'), f.plantumlServer.value.trim());
  note($('#api-csp-note'), f.apiBase.value.trim());
}

// ================================================================ import / delete (BR-13)

/** Up to 15 lines as a bullet list (starting with a line break), then "… n more"; '' for an empty list. */
export function bulletList(lines) {
  if (!Array.isArray(lines) || !lines.length) return '';
  return `\n• ${lines.slice(0, 15).join('\n• ')}${lines.length > 15 ? '\n' + t('… {n} more', { n: lines.length - 15 }) : ''}`;
}

export function apiErrorText(e) {
  const details = bulletList(e.details);
  if (e.status === 409 && e.candidates?.length > 1) {
    return t('{n} models with the identifier of this file are there already:', { n: e.candidates.length })
      + bulletList(e.candidates.map(candidateText));
  }
  if (e.status === 409 && e.candidates?.length) {
    return t('A model with the same identifier already exists: {model}.', { model: candidateText(e.candidates[0]) }) + '\n'
      + t('Replace it with this file, or import the file as a separate model.');
  }
  if (e.status === 409) {
    return t('A model with the same identifier already exists ({message}).', { message: e.message }) + '\n'
      + t('Replace it with this file, or import a different file.') + details;
  }
  if (e.status === 412) return t('The model was changed after the check ({message}). Nothing was replaced; replace it again to see the changes now.', { message: e.message });
  if (e.status === 422 || e.status === 400) return t('The file was rejected: {message}', { message: e.message }) + details;
  if (e.status === 401) return t('Not authorised — check the API key in Settings.');
  if (e.status === 403) return forbiddenText();
  return `${e.message}${details}`;
}

export const candidateText = c => t('{name} (model #{id}, revision {revision})', c);

/** The candidates of a refusal (API 2.10.0), the one with the file's name first. */
export const byName = candidates => [...candidates].sort((a, b) => Number(b.sameName) - Number(a.sameName));

// 2.28.0: the top-level folders Archi gives a new model, in its order (as the MCP server's create_model)
const ARCHI_FOLDERS = ['Strategy', 'Business', 'Application', 'Technology & Physical', 'Motivation',
  'Implementation & Migration', 'Other', 'Relations', 'Views'];

/** 2.28.0: "New model…": a new, empty model (role admin). */
export function openNewModel() {
  const form = $('#new-model-form');
  form.reset();
  $('#new-model-result').textContent = '';
  $('#new-model-result').className = 'dialog-result';
  $('#btn-new-model-create').disabled = false;
  $('#new-model-dialog').showModal();
  form.name.focus();
}

/** Create it: the model, then its folders in one transaction; then open it. */
export async function createNewModel() {
  const form = $('#new-model-form');
  const out = $('#new-model-result');
  const name = form.name.value.trim();
  if (!name) return;
  $('#btn-new-model-create').disabled = true;
  out.className = 'dialog-result';
  out.textContent = t('Creating the model…');
  try {
    const model = await api.createModel({
      xmiIdentifier: `id-${crypto.randomUUID()}`, name,
      ...(form.documentation.value.trim() ? { documentation: form.documentation.value.trim() } : {}),
    });
    if (form.folders.checked) {
      await api.changes(model.id, { operations: ARCHI_FOLDERS.map((label, i) => ({ op: 'createFolder', label, sortOrder: i })) });
    }
    $('#new-model-dialog').close();
    history.replaceState(null, '', `#model=${model.id}`);
    await loadModels();
    status(t('Model “{name}” created.', { name }));
  } catch (e) {
    out.className = 'dialog-result error';
    out.textContent = apiErrorText(e);
    $('#btn-new-model-create').disabled = false;
  }
}

export function openImport() {
  const dlg = $('#import-dialog');
  $('#import-form').reset();
  const out = $('#import-result');
  out.textContent = '';
  out.className = 'dialog-result';
  $('#btn-import-run').disabled = false;
  dlg.showModal();
}

/**
 * BL-33, BR-16: what replacing a model changes, one line per kind, then what was added, removed and
 * changed: by name and type (API 3.10.0, BL-36), or by XMI identifier from an older API.
 */
/** API 3.16.0 (BL-57): the changes made here since the import that a replace undoes, in a line or two; '' for none. */
export function undoesText(undoes) {
  if (!undoes?.count) return '';
  const who = undoes.users.join(', ') || t('someone');
  const newest = (undoes.last || []).map(x => `${x.kind} “${x.name || '…'}”`).join(', ');
  return t('It undoes {n} change(s) made here since the last import, by {who}{via}.', {
    n: undoes.count, who, via: undoes.clients?.length ? ` (${undoes.clients.join(', ')})` : '' })
    + (newest ? ' ' + t('The newest: {items}.', { items: newest }) : '');
}

export function changesText(changes) {
  const kinds = [['elements', t('Elements')], ['relationships', t('Relationships')], ['views', t('Views')]];
  const lines = kinds.map(([k, label]) => t('{kind}: {added} added, {removed} removed, {kept} kept',
    { kind: label, added: changes[k].added.length, removed: changes[k].removed.length, kept: changes[k].kept }));
  for (const [k, label] of kinds) {
    const c = changes[k], kind = label.toLowerCase();
    if (c.addedItems) {
      if (c.addedItems.length) lines.push(t('Added {kind}:', { kind }) + bulletList(c.addedItems.map(itemText)));
      if (c.removedItems.length) lines.push(t('Removed {kind}:', { kind }) + bulletList(c.removedItems.map(itemText)));
      if (c.changed?.length) lines.push(t('Changed {kind}:', { kind }) + bulletList(c.changed.map(i => `${itemText(i)}: ${fieldsText(i.fields)}`)));
      continue;
    }
    if (c.added.length) lines.push(t('Added {kind} (XMI identifiers):', { kind }) + bulletList(c.added));
    if (c.removed.length) lines.push(t('Removed {kind} (XMI identifiers):', { kind }) + bulletList(c.removed));
  }
  return lines.join('\n');
}

/** A concept of a replace's changes: its name and type, then its XMI identifier. */
const itemText = i => `${i.name || t('(no name)')}${i.type ? ` (${prettyType(i.type)})` : ''} · ${i.xmiIdentifier}`;

/** What differs in a kept concept (BL-36): names and types before and after, property values by name. */
function fieldsText(fields) {
  const parts = [];
  for (const [field, { before, after }] of Object.entries(fields || {})) {
    if (field === 'name') parts.push(t('name “{before}” → “{after}”', { before: before ?? '', after: after ?? '' }));
    else if (field === 'type') parts.push(t('type {before} → {after}', { before: prettyType(before), after: prettyType(after) }));
    else if (field === 'properties') {
      for (const name of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
        parts.push(t('{name}: “{before}” → “{after}”', { name, before: before?.[name] ?? '', after: after?.[name] ?? '' }));
      }
    } else parts.push({ documentation: t('documentation changed'), source: t('source changed'), target: t('target changed') }[field] || field);
  }
  return parts.join('; ');
}

/** The import itself; `opts` as for api.importModel. Shows the result in the dialog and opens the model. */
export async function runImport(file, opts = {}) {
  const out = $('#import-result');
  const run = $('#btn-import-run');
  run.disabled = true;
  out.className = 'dialog-result';
  out.textContent = t('Importing {name} ({size} KB)… this can take a while for large models.', { name: file.name, size: (file.size / 1024).toFixed(0) });
  try {
    const { model, warnings = [], changes } = await api.importModel(file, opts);
    history.replaceState(null, '', `#model=${model.id}`); // loadModels() opens the model named in the hash
    if (changes) {
      // BL-33: the model was replaced; the dialog stays open so the changes can be read
      out.className = warnings.length ? 'dialog-result warn' : 'dialog-result ok';
      out.textContent = t('Replaced “{name}” (model #{id}) with the content of the file.', { name: model.name, id: model.id })
        + '\n' + changesText(changes) + leftOutText(warnings);
      loadModels();
      return;
    }
    if (warnings.length) {
      // BL-4: the API says what it left out; the dialog stays open so the list can be read
      out.className = 'dialog-result warn';
      out.textContent = t('Imported “{name}” as model #{id}. The API left out {n} item or reference of the file:|Imported “{name}” as model #{id}. The API left out {n} items or references of the file:',
        { name: model.name, id: model.id, n: warnings.length }) + bulletList(warnings);
      loadModels();
      return;
    }
    out.className = 'dialog-result ok';
    out.textContent = t('Imported “{name}” as model #{id}. Opening it…', { name: model.name, id: model.id });
    setTimeout(() => { $('#import-dialog').close(); loadModels(); }, 900);
  } catch (e) {
    importFailed(e, file, opts.replace, opts);
  } finally {
    run.disabled = false;
  }
}

export function leftOutText(warnings) {
  return warnings.length ? '\n' + t('The API left out {n} item or reference of the file:|The API left out {n} items or references of the file:', { n: warnings.length }) + bulletList(warnings) : '';
}

export function importFailed(e, file, replacing, opts = {}) {
  const out = $('#import-result');
  out.className = 'dialog-result error';
  out.textContent = apiErrorText(e);
  if (e.status === 409 && e.undoes) {
    // BL-57: the model was changed here since its import; replacing it undoes that, so only when asked
    out.textContent = t('The model was changed here since its last import.') + ' ' + undoesText(e.undoes);
    out.append(h('div', { class: 'actions' }, h('button', {
      type: 'button', id: 'btn-import-overwrite', class: 'primary',
      onclick: () => runImport(file, { ...opts, replace: true, overwriteChanges: true }),
    }, t('Replace it anyway, undoing {n} change(s)', { n: e.undoes.count }))));
    return;
  }
  if (e.status !== 409 || !e.candidates?.length) return;
  // BL-33: offer to replace the model that has the file's identifier (after a preview). API 2.10.0:
  // when several models have it, to replace one of them (the one with the file's name first),
  // and to import the file as a separate model
  const several = e.candidates.length > 1;
  out.append(h('div', { class: 'actions' },
    ...byName(e.candidates).map((c, i) => h('button', {
      type: 'button', id: i ? null : 'btn-import-replace', class: i ? 'import-replace' : 'import-replace primary', 'data-model': c.id,
      onclick: () => { $('#import-form').replace.checked = true; previewReplace(file, c.id); },
    }, several ? t('Replace “{name}” (#{id})', c) : t('Replace it'))),
    replacing && !several ? null : h('button', {
      type: 'button', id: 'btn-import-new', onclick: () => runImport(file, { asNew: true }),
    }, t('Import as a separate model'))));
}

/**
 * BL-34: before replacing, a dry run shows what would change; the replace then runs only
 * on the user's confirmation, and only on the version that was shown (expectedRevision).
 * A file that would become a new model is imported at once.
 */
export async function previewReplace(file, modelId) {
  const out = $('#import-result');
  const run = $('#btn-import-run');
  run.disabled = true;
  out.className = 'dialog-result';
  out.textContent = t('Checking what replacing would change ({name}, {size} KB)…', { name: file.name, size: (file.size / 1024).toFixed(0) });
  let dry;
  try {
    dry = await api.importModel(file, { replace: true, dryRun: true, modelId });
  } catch (e) {
    importFailed(e, file, true);
    return;
  } finally {
    run.disabled = false;
  }
  if (!dry.changes) return runImport(file, { replace: true }); // no such model: a plain import
  const { model, warnings = [], changes } = dry;
  const undoes = changes.undoes; // BL-57 (API 3.16.0): changes made here that the replace would undo
  out.className = 'dialog-result warn';
  out.textContent = t('Replacing “{name}” (model #{id}) with this file would change:', { name: model.name, id: model.id })
    + '\n' + changesText(changes) + leftOutText(warnings) + (undoes ? '\n' + undoesText(undoes) : '') + '\n' + t('Nothing has been changed yet.');
  out.append(h('div', { class: 'actions' }, h('button', {
    type: 'button', id: 'btn-import-confirm', class: 'primary',
    onclick: () => runImport(file, { replace: true, modelId: model.id, expectedRevision: model.revision - 1, overwriteChanges: !!undoes }),
  }, undoes ? t('Replace the model, undoing {n} change(s)', { n: undoes.count }) : t('Replace the model'))));
}

export function openDeleteModel() {
  const s = state.store;
  if (!s) return;
  const m = s.model;
  $('#delete-form').reset();
  $('#delete-model-name').textContent = `${m.name} (#${m.id})`;
  $('#delete-model-counts').textContent = t('{elements} elements, {relationships} relationships, {views} views', { elements: s.stats.elements.total, relationships: s.stats.relationships.total, views: s.stats.views.total });
  $('#delete-result').textContent = '';
  $('#delete-result').className = 'dialog-result';
  $('#btn-delete-run').disabled = true;
  $('#delete-dialog').showModal();
}

// ---------------------------------------------------------------- linked models (BR-20, API 2.8.0, BL-42)

export let linkLoads = 0; // only the newest loadLink counts: an older answer may arrive later

/** The link of the open model (null without one); redraws the menu and the model's details. */
export async function loadLink(store) {
  const load = ++linkLoads;
  let link = null;
  try {
    link = (await api.listLinks()).find(l => l.modelId === store.id) ?? null; // no 404 for each model without one
  } catch (e) {
    if (!isAbort(e)) console.warn('link', e);
  }
  if (state.store !== store || load !== linkLoads) return; // another model opened, or a newer load
  state.link = link;
  updateModelButtons();
  if (state.selection?.kind === 'model') renderDetails(state.selection);
}

export const when = iso => (iso ? new Date(iso).toLocaleString(lang) : '—');

/** What the link says, as a list: file, interval, last update and check, next check. */
export function linkStateList(link) {
  const lastStatus = { updated: t('updated'), unchanged: t('file unchanged'), failed: t('failed') }[link.lastStatus] ?? '—';
  const rows = [
    [t('File'), link.path],
    [t('Updated'), link.intervalMinutes ? t('every {n} min', { n: link.intervalMinutes }) : t('by hand only')],
    [t('Last update'), when(link.lastUpdatedAt)],
    [t('Last check'), `${when(link.lastCheckedAt)} · ${lastStatus}`],
    link.lastMessage ? [t('Message'), link.lastMessage] : null,
    link.nextCheckAt ? [t('Next check'), when(link.nextCheckAt)] : null,
  ].filter(Boolean);
  return h('dl', { class: 'link-state' }, rows.flatMap(([k, v]) =>
    [h('dt', {}, k), h('dd', { class: k === t('Last check') && link.lastStatus === 'failed' ? 'failed' : null }, v)]));
}

/** What an update or a link did, for a dialog or the status line. */
export function linkResultText(result) {
  const { status: what, model, changes, warnings = [] } = result;
  if (what === 'unchanged') return t('The file has not changed since the last update.');
  const head = what === 'imported'
    ? t('Imported “{name}” as model #{id} and linked it to the file.', { name: model.name, id: model.id })
    : t('Updated “{name}” (model #{id}) from the file.', { name: model.name, id: model.id });
  return head + (changes ? '\n' + changesText(changes) : '') + leftOutText(warnings);
}

/** Update the open model from its file; with `out`, the result goes there, else to the status line. */
export async function updateFromLink({ out = null } = {}) {
  const store = state.store;
  if (!store) return;
  const say = (text, kind = '') => {
    if (out) { out.className = `dialog-result ${kind}`; out.textContent = text; } else status(text, kind === 'error');
  };
  say(t('Updating “{name}” from its file… Archi converts it, which takes a few seconds.', { name: store.model.name }));
  try {
    const result = await api.updateFromLink(store.id);
    say(linkResultText(result), result.warnings?.length ? 'warn' : 'ok');
    if (result.status === 'updated') {
      history.replaceState(null, '', `#model=${store.id}`);
      loadModels();
    } else {
      await loadLink(store);
    }
    return result;
  } catch (e) {
    say(apiErrorText(e), 'error');
    loadLink(store);
    return null;
  }
}

/**
 * The link dialog. 'model': the open model's link (to see; an admin may change or remove it).
 * 'new': link a file on the server as a model of its own (from the import dialog).
 */
export function openLinkDialog(mode) {
  const dlg = $('#link-dialog');
  const form = $('#link-form');
  const link = mode === 'model' ? state.link : null;
  form.reset();
  form.dataset.mode = mode;
  const admin = may('import');
  $('#link-title').textContent = mode === 'new' ? t('Link a file on the server') : t('Linked file');
  form.path.value = link?.path ?? '';
  form.interval.value = link?.intervalMinutes ?? '';
  for (const input of [form.path, form.interval]) input.disabled = !admin;
  $('#link-state').replaceWith(link ? Object.assign(linkStateList(link), { id: 'link-state' }) : h('dl', { id: 'link-state', class: 'link-state' }));
  const out = $('#link-result');
  out.textContent = '';
  out.className = 'dialog-result';
  if (mode === 'model' && !link) {
    out.textContent = t('This model is not linked to a file. Link it to the file it was exported from, and it is updated from there.');
  }
  $('#btn-link-save').hidden = !admin;
  $('#btn-link-save').textContent = link ? t('Save') : t('link::Link');
  $('#btn-link-save').disabled = false;
  $('#btn-link-remove').hidden = !admin || !link;
  $('#btn-link-now').hidden = !link || !may('write');
  // 2.28.0: pick the file from the folders the server allows (API 3.20.0)
  $('#btn-link-browse').hidden = !admin || !state.apiVersion || olderThan(state.apiVersion, '3.20.0');
  $('#link-picker').hidden = true;
  dlg.showModal();
  (admin ? form.path : $('#link-dialog button[value=cancel]')).focus();
}

/**
 * 2.28.0: the picker of the link dialog, one folder at a time (API 3.20.0, GET /models/link-files): the
 * allowed folders, then a folder's sub-folders and its .archimate and .xml files. A file fills the path.
 */
export async function browseLinkFiles(folder = null) {
  const box = $('#link-picker');
  const form = $('#link-form');
  box.hidden = false;
  box.replaceChildren(h('p', { class: 'muted' }, t('Loading…')));
  try {
    const res = await api.linkFiles(folder);
    const open = path => h('button', { type: 'button', class: 'link', onclick: () => browseLinkFiles(path) });
    const size = n => (n < 1024 * 1024 ? t('{n} kB', { n: Math.max(1, Math.round(n / 1024)) }) : t('{n} MB', { n: (n / 1024 / 1024).toFixed(1) }));
    const rows = [
      res.folder ? h('li', { class: 'link-picker-up' }, Object.assign(open(res.parent), { textContent: res.parent ? '↑ ' + t('Up') : '↑ ' + t('Allowed folders') })) : null,
      ...res.folders.map(f => h('li', { 'data-folder': f.path }, Object.assign(open(f.path), { textContent: '📁 ' + f.name }))),
      ...res.files.map(f => h('li', { 'data-file': f.path },
        h('button', {
          type: 'button', class: 'link', onclick: () => {
            form.path.value = f.path;
            box.hidden = true;
            form.path.focus();
          },
        }, (f.name.toLowerCase().endsWith('.xml') ? '🗎 ' : '🗂 ') + f.name),
        h('span', { class: 'muted' }, ` ${size(f.size)} · ${when(f.modified + 'Z')}`
          + (f.linkedTo != null ? ' · ' + t('linked to model #{id}', { id: f.linkedTo }) : '')))),
    ];
    box.replaceChildren(
      h('div', { class: 'link-picker-where' }, res.folder ?? t('The folders whose files may be linked')),
      res.folders.length || res.files.length || res.folder
        ? h('ul', {}, rows)
        : h('p', { class: 'muted' }, t('No folders are allowed on the server.')),
      res.folder && !res.folders.length && !res.files.length ? h('p', { class: 'muted' }, t('No .archimate or .xml files here.')) : null,
      res.truncated ? h('p', { class: 'muted' }, t('Only the first 1000 entries are shown.')) : null);
  } catch (e) {
    box.replaceChildren(h('p', { class: 'dialog-result error' }, apiErrorText(e)));
  }
}

/** A file linked as a new model, or to a model that was there: says so and opens the model. */
export function linkedNew(result) {
  const out = $('#link-result');
  out.className = result.warnings?.length ? 'dialog-result warn' : 'dialog-result ok';
  out.textContent = linkResultText(result);
  history.replaceState(null, '', `#model=${result.model.id}`);
  loadModels();
}

/**
 * API 2.10.0: the file holds a model that is there already, several times, or linked to another
 * file. Offers to link one of them (the one with the file's name first) or a separate model.
 */
export function linkFailed(e, body, again = null) {
  const out = $('#link-result');
  out.className = 'dialog-result error';
  if (e.status === 409 && e.undoes && again) {
    // BL-57: linking replaces the model from the file, which undoes the changes made here: only when asked
    out.textContent = t('The model was changed here since its last import.') + ' ' + undoesText(e.undoes);
    out.append(h('div', { class: 'actions' }, h('button', {
      type: 'button', id: 'btn-link-overwrite', class: 'primary',
      onclick: async () => {
        out.className = 'dialog-result';
        out.textContent = t('Archi converts the file and the API imports it… this takes a few seconds.');
        try { await again({ overwriteChanges: true }); } catch (err) { linkFailed(err, body); }
      },
    }, t('Link it anyway, undoing {n} change(s)', { n: e.undoes.count }))));
    return;
  }
  if (e.status !== 409 || !e.candidates?.length || $('#link-form').dataset.mode !== 'new') {
    out.textContent = apiErrorText(e);
    return;
  }
  out.textContent = t('The file holds a model that is there already ({message}).', { message: e.message });
  const run = async how => {
    out.className = 'dialog-result';
    out.textContent = t('Archi converts the file and the API imports it… this takes a few seconds.');
    try { await how(); } catch (err) { linkFailed(err, body); }
  };
  out.append(h('div', { class: 'actions' },
    ...byName(e.candidates).map((c, i) => h('button', {
      type: 'button', class: i ? 'link-candidate' : 'link-candidate primary', 'data-model': c.id,
      onclick: () => run(async () => {
        await api.putLink(c.id, body);
        out.className = 'dialog-result ok';
        out.textContent = t('Linked. The model was updated from the file.');
        history.replaceState(null, '', `#model=${c.id}`);
        loadModels();
      }),
    }, t('Link “{name}” (#{id})', c))),
    h('button', {
      type: 'button', id: 'btn-link-as-new', onclick: () => run(async () => linkedNew(await api.createLinkedModel(body, { asNew: true }))),
    }, t('Import as a separate model'))));
}

export function updateModelButtons() {
  syncEditButton(); // BR-11: ✎ Edit, for a model mastered here
  $('#btn-export').disabled = !state.store;
  $('#btn-export-archimate').disabled = !state.store;
  // 2.17.0: an SQLite database of the model, from API 3.13.0
  $('#btn-export-sqlite').disabled = !state.store;
  $('#btn-export-sqlite').hidden = !state.apiVersion || olderThan(state.apiVersion, '3.13.0');
  // 2.20.0: an offline copy is made of the model's snapshot, from API 3.14.0
  $('#btn-export-offline').disabled = !state.store;
  $('#btn-export-offline').hidden = !state.apiVersion || olderThan(state.apiVersion, '3.14.0');
  // BR-20: admins link models to files; everyone sees the link of a linked model, editors may update it
  $('#btn-linked-file').disabled = !state.store;
  $('#btn-linked-file').hidden = !may('import') && !state.link;
  $('#btn-link-update').hidden = !state.link || !may('write');
  $('#btn-link-new').hidden = !may('import');
  $('#btn-delete-model').disabled = !state.store;
  for (const id of ['#btn-report-quality', '#btn-report-matrix', '#btn-report-landscape']) $(id).disabled = !state.store;
  // 2.33.0: recipe scripts, from API 3.24.0
  $('#btn-recipe-script').disabled = !state.store;
  $('#btn-recipe-script').hidden = !state.apiVersion || olderThan(state.apiVersion, '3.24.0');
  // API-8: a key that may not import or delete (role reader or editor) is not offered the buttons
  $('#btn-import').hidden = !may('import');
  $('#btn-new-model').hidden = !may('import'); // 2.28.0: creating a model needs admin, as importing does
  $('#btn-delete-model').hidden = !may('deleteModel');
  $('#model-menu hr.before-delete').hidden = $('#btn-delete-model').hidden;
}

/**
 * A menu button of the page (Model actions, Export): opens on click or ↓/↑, closes on
 * Escape, a click outside or a chosen item; ↑/↓/Home/End move between the items.
 */
export function setupMenuButton(trigger, menu) {
  const items = () => menuItems(menu);
  const close = focusTrigger => {
    if (menu.hidden) return;
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (focusTrigger) trigger.focus();
  };
  const open = which => {
    closeNodeMenu();
    for (const m of document.querySelectorAll('.dropdown:not([hidden])')) if (m !== menu) m.hidden = true;
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    const list = items();
    (which === 'last' ? list.at(-1) : list[0])?.focus();
  };
  trigger.addEventListener('click', () => (menu.hidden ? open() : close(true)));
  trigger.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(e.key === 'ArrowUp' ? 'last' : 'first'); }
  });
  // the item's own click handler runs first; a dialog it opens takes the focus
  menu.addEventListener('click', e => { if (e.target.closest('[role=menuitem], [role=menuitemradio]')) close(false); });
  menu.addEventListener('keydown', e => {
    if (moveInMenu(menu, e)) return; // UX-6: shared with the context menus
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === 'Tab') close(false);
  });
  document.addEventListener('pointerdown', e => {
    if (!menu.hidden && !menu.contains(e.target) && !trigger.contains(e.target)) close(false);
  });
}
