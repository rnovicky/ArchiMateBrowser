// Thin client for the ArchiMate API, version 2 (/api/v2; see xmi_oas.json
// in the API's folder). Read-only except for model import/delete (BR-13),
// which the UI confirms explicitly.
//
// EN-2: every call takes an optional last argument { signal } (AbortController)
// so the app can cancel requests it no longer needs; a cancelled request
// rejects with an ApiError whose code is 'ABORTED' (see isAbort). Each outcome
// is reported to connection.js, which tracks whether the API is reachable.

import { APP_VERSION } from './version.js';
import { settings } from './config.js';
import { t } from './i18n.js';
import { reportResult } from './connection.js';

export { isAbort, isConnectionError } from './connection.js';

export class ApiError extends Error {
  /**
   * `candidates`: with 409 for a model's identifier (API 2.10.0), [{ id, name, revision, sameName }].
   * `lastChange`: with 412 PRECONDITION_FAILED (API 3.12.0), the last change of the item from the record;
   * `current`: the item as it is now.
   * `undoes`: with 409 for a replace (API 3.16.0, BL-57), the changes made here that it would undo.
   */
  constructor(status, code, message, details, candidates, lastChange, { current, undoes } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.candidates = candidates;
    this.lastChange = lastChange;
    this.current = current;
    this.undoes = undoes;
  }
}

// 2.20.0: an offline copy of a model (js/offline/) carries the model's snapshot, set by its start script
// as window.ARCHIXMI_OFFLINE; its requests are answered by a stand-in of the API instead of the network.
export const isOffline = () => !!globalThis.ARCHIXMI_OFFLINE;
/** 2.27.2: an offline copy of part of a model (BR-24, API 3.19.0 `scope`): its links may lead to views it does not hold. */
export const isPartialCopy = () => !!globalThis.ARCHIXMI_OFFLINE?.snapshot?.scope;
let standIn = null;
function transport(url, init) {
  if (!isOffline()) return fetch(url, init);
  standIn ??= import('./offline/standin.js').then(m => m.offlineFetch(globalThis.ARCHIXMI_OFFLINE.snapshot, { base: settings.apiBase }));
  return standIn.then(answer => answer(url, init));
}

function buildUrl(path, query) {
  const base = settings.apiBase.replace(/\/+$/, '');
  const url = new URL(base + path, window.location.href);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  return url;
}

/** fetch() with the API's error handling: ApiError for network failures, cancellations and non-2xx answers. */
async function call(url, init, signal, { detailsInMessage = true } = {}) {
  if (signal?.aborted) throw new ApiError(0, 'ABORTED', t('Cancelled.'));
  let res;
  try {
    res = await transport(url, { ...init, signal });
  } catch (e) {
    if (e?.name === 'AbortError' || signal?.aborted) throw new ApiError(0, 'ABORTED', t('Cancelled.'));
    const err = new ApiError(0, 'NETWORK', t('Cannot reach the API at {url} ({message}).', { url: settings.apiBase, message: e.message }));
    reportResult(err);
    throw err;
  }
  if (!res.ok) {
    let body = {};
    try { body = await res.json(); } catch { /* non-JSON error */ }
    let msg = body.message || body.detail || res.statusText || t('Request failed');
    if (typeof msg !== 'string') msg = JSON.stringify(msg);
    if (detailsInMessage && Array.isArray(body.details) && body.details.length) msg += ' ' + body.details.join('; ');
    const err = new ApiError(res.status, body.code || `HTTP_${res.status}`, msg, body.details,
      Array.isArray(body.candidates) ? body.candidates : undefined, body.lastChange || undefined,
      { current: body.current || undefined, undoes: body.undoes || undefined });
    reportResult(err);
    throw err;
  }
  reportResult(null);
  return res;
}

function headers(accept) {
  const h = { Accept: accept };
  if (settings.apiKey) h['X-API-Key'] = settings.apiKey;
  // The API's record of changes names the client (API 3.11.0). Only through the proxy: a header of its own
  // would need the API's CORS to allow it, which an older API does not.
  if (new URL(buildUrl('/')).origin === window.location.origin) h['X-Client'] = `ArchiMate Browser ${APP_VERSION}`;
  return h;
}

async function request(path, query, { raw = false, signal } = {}) {
  const res = await call(buildUrl(path, query), { headers: headers(raw ? '*/*' : 'application/json') }, signal);
  return raw ? res : res.json();
}

/**
 * Non-GET request (BR-13: import/delete; BR-20: links). `body` may be FormData (multipart;
 * the browser sets the boundary), a plain object (sent as JSON) or undefined. Returns parsed
 * JSON, or null for 204.
 */
async function send(method, path, body, { signal, query, ifMatch } = {}) {
  const h = headers('application/json');
  h['X-Request-Id'] = newRequestId(); // 2.26.0: its change event is known as this page's own (isOwnRequest)
  if (ifMatch != null) h['If-Match'] = `"${ifMatch}"`; // API 3.12.0: refused (412) when it changed since
  if (body !== undefined && !(body instanceof FormData)) {
    h['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const res = await call(buildUrl(path, query), { method, headers: h, body }, signal, { detailsInMessage: false }); // the dialogs list the details themselves
  return res.status === 204 ? null : res.json().catch(() => null);
}

// 2.26.0: the ids of the writes this page sent (X-Request-Id, which the API writes into the record of changes
// and its change events), so that their events are not "changed elsewhere". The newest few hundred.
const OWN_REQUESTS = 500;
const ownRequests = new Set();

function newRequestId() {
  const id = `br-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  ownRequests.add(id);
  if (ownRequests.size > OWN_REQUESTS) ownRequests.delete(ownRequests.values().next().value);
  return id;
}

/** Whether a change (its `requestId`, API 3.17.0) was made by a write of this page. */
export const isOwnRequest = id => !!id && ownRequests.has(id);

/**
 * MU-14 (2.26.0): the API's change events (3.17.0), an answer that stays open. Resolves to the fetch Response,
 * whose body js/events.js reads, whatever its status (404 from an API without events, 503 with too many
 * streams); rejects when the API cannot be reached. Not reported to connection.js: a refused stream is not
 * an API that is down. `after`: the last event id seen, to get what came since.
 */
function events({ model, after } = {}, { signal } = {}) {
  return transport(buildUrl('/events', { model, after }), { headers: headers('text/event-stream'), cache: 'no-store', signal });
}

// UP-4, HLP-0: answers of the read-only POST helpers, kept per request with their ETag.
// A browser caches no POST by itself, so the same question asked again is sent with
// If-None-Match; the API answers 304 while the model has not changed (the ETag holds
// its revision), and the kept answer is returned. Callers must not change an answer.
const KEPT_ANSWERS = 300;
const kept = new Map(); // "path body" -> { etag, data }, oldest first

async function ask(path, body, { signal, accept = 'application/json' } = {}) {
  const text = JSON.stringify(body);
  const key = `${accept} ${path} ${text}`;
  const had = kept.get(key);
  const h = { ...headers(accept), 'Content-Type': 'application/json' };
  if (had) h['If-None-Match'] = had.etag;
  let res;
  try {
    res = await call(buildUrl(path), { method: 'POST', headers: h, body: text }, signal);
  } catch (e) {
    if (e.status !== 304 || !had) throw e; // fetch() does not call 304 a success
    reportResult(null);
    kept.delete(key);
    kept.set(key, had); // used again: newest
    return had.data;
  }
  const data = accept === 'application/json' ? await res.json() : await res.text();
  const etag = res.headers.get('ETag');
  if (etag) {
    kept.delete(key);
    kept.set(key, { etag, data });
    if (kept.size > KEPT_ANSWERS) kept.delete(kept.keys().next().value);
  }
  return data;
}

/** How many answers of the POST helpers are kept, and how often one was reused (for the tests). */
export const askStats = () => ({ kept: kept.size });

/** The largest page every list endpoint of the API accepts (API-1; MAX_PAGE_SIZE there). */
export const PAGE_SIZE = 1000;

/**
 * Fetch every page of a list endpoint. In v2 every list answers
 * { items, total, limit, offset } (API-2), so after the first page the rest
 * is fetched concurrently (max 4 in flight). pageSize is for the tests.
 */
async function getAll(path, query = {}, { onProgress, signal, pageSize = PAGE_SIZE } = {}) {
  const limit = pageSize;
  const first = await request(path, { ...query, limit, offset: 0 }, { signal });
  const offsets = [];
  for (let o = first.items.length; o < first.total; o += limit) offsets.push(o);
  const pages = new Array(offsets.length);
  let loaded = first.items.length;
  onProgress?.(loaded, first.total);
  let next = 0;
  const worker = async () => {
    while (next < offsets.length) {
      const i = next++;
      pages[i] = (await request(path, { ...query, limit, offset: offsets[i] }, { signal })).items;
      loaded += pages[i].length;
      onProgress?.(loaded, first.total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, offsets.length) }, worker));
  return first.items.concat(...pages);
}

/**
 * Every item of one group of an answer that has a paged group per kind,
 * { elements: { items, total, … }, … }: the contents of a folder, the search.
 */
async function getAllOf(group, path, query = {}, { signal, pageSize = PAGE_SIZE } = {}) {
  const items = [];
  for (;;) {
    const page = (await request(path, { ...query, kinds: group, limit: pageSize, offset: items.length }, { signal }))[group];
    items.push(...page.items);
    if (!page.items.length || items.length >= page.total) return items;
  }
}

const m = id => `/models/${encodeURIComponent(id)}`;

/** The oldest API this browser works with: it uses what 2.1.0 to 2.10.0 added (PLAN.md, the gaps). */
export const MIN_API_VERSION = '2.10.0';

/** True when version `have` ("2.0.0") is older than `need`. */
export function olderThan(have, need = MIN_API_VERSION) {
  const a = String(have).split('.').map(Number), b = String(need).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) < (b[i] || 0);
  return false;
}

/**
 * `/health` at the API's root (outside /api/v2): { status, version, apiVersions }.
 * It is what the API-down banner polls (EN-2); the API answers 503 when its
 * database is down (BL-6), which rejects here like any failed request.
 */
async function health({ signal } = {}) {
  const res = await transport(new URL('/health', buildUrl('/')).href, { signal, cache: 'no-store', headers: { Accept: 'application/json' } });
  if (!res.ok) throw new ApiError(res.status, `HTTP_${res.status}`, res.statusText || t('Request failed'));
  return res.json().catch(() => ({}));
}

// o = { signal } (EN-2); list calls also take o.onProgress(loaded, total)
export const api = {
  health,
  events,
  /** The key in use: { name, role, permissions: ['read', 'write', 'import', 'deleteModel'] } (API-8). */
  me: o => request('/auth/me', null, o),
  listModels: o => getAll('/models', {}, o),
  getModel: (id, o) => request(m(id), null, o),
  /**
   * Everything about a model in one answer, from one state of the database (API 3.14.0): what an
   * offline copy is made of (js/app/offline.js).
   */
  snapshot: (id, o) => request(`${m(id)}/snapshot`, null, o),
  /** BR-24 (2.27.0): the snapshot of a part of the model, { folder } or { view } (API 3.19.0). */
  snapshotOf: (id, scope, o) => request(`${m(id)}/snapshot`, scope, o),
  /**
   * query: { omitOpenLines: true } leaves out the lines without ends (BL-41, 2.7.0);
   * { format: 'archimate' } gives Archi's own format, converted by Archi on the server (BL-42, 2.8.0).
   */
  exportModel: (id, query, o) => request(`${m(id)}/export`, query, { ...o, raw: true }),
  /**
   * BR-20 (API 2.8.0, BL-42): a model linked to an .archimate file on the server is updated from it and is
   * read-only. The link: { path, intervalMinutes, lastCheckedAt, lastUpdatedAt, lastStatus, lastMessage,
   * nextCheckAt }, or null when the model has none.
   */
  getLink: (id, o) => request(`${m(id)}/link`, null, o).catch(e => { if (e.status === 404) return null; throw e; }),
  /** Every link, as [{ modelId, path, … }]: which models are linked, in one request. */
  listLinks: o => request('/models/links', null, o).then(r => r.items),
  /**
   * body: { path, intervalMinutes }. Resolves to { status: 'imported'|'updated', model, link, warnings, changes }.
   * `asNew` (API 2.10.0): a separate model even when models with the file's identifier exist.
   */
  createLinkedModel: (body, { asNew = false, overwriteChanges = false, ...o } = {}) =>
    send('POST', '/models/linked', body, { ...o, query: { asNew: asNew ? 'true' : undefined, overwriteChanges: overwriteChanges ? 'true' : undefined } }),
  /** `overwriteChanges` (API 3.16.0, BL-57): also a model changed here since its import, whose changes linking undoes. */
  /** 2.28.0 (API 3.20.0): the linkable files of a folder on the server; without `folder` the allowed folders. */
  linkFiles: (folder, o) => request('/models/link-files', folder ? { folder } : null, o),
  putLink: (id, body, { overwriteChanges = false, ...o } = {}) =>
    send('PUT', `${m(id)}/link`, body, { ...o, query: { overwriteChanges: overwriteChanges ? 'true' : undefined } }),
  deleteLink: (id, o) => send('DELETE', `${m(id)}/link`, undefined, o),
  /** Resolves to { status: 'updated'|'unchanged', model, link, warnings, changes }. */
  updateFromLink: (id, { force = false, ...o } = {}) =>
    send('POST', `${m(id)}/link/update`, undefined, { ...o, query: { force: force ? 'true' : undefined } }),
  /** { openLines: [{ id, xmiIdentifier, missing, viewId, viewName, … }], omitted, warnings }: what an export warns about (BL-41). */
  exportCheck: (id, o) => request(`${m(id)}/export/check`, null, o),
  /**
   * Resolves to { model, warnings, changes }: one warning per item or reference the import left out (BL-4).
   * With `replace`, the model with the file's identifier is replaced in one step (API 2.3.0, BL-33); `changes`
   * then says, for elements, relationships and views, which XMI identifiers were added and removed and how
   * many were kept. It is null when the file became a new model. `dryRun` (API 2.4.0, BL-34): the API runs
   * the import, answers what it would do and stores nothing. `expectedRevision`: replace only that version.
   * API 2.10.0 (models that share an identifier): `modelId`, the model to replace; `asNew`, a separate
   * model even when models with the file's identifier exist. A refusal (409) lists them: `candidates`.
   */
  importModel: (file, { replace = false, dryRun = false, expectedRevision, modelId, asNew = false, overwriteChanges = false, ...o } = {}) => {
    const fd = new FormData(); fd.append('file', file, file.name);
    const query = {
      replace: replace ? 'true' : undefined, dryRun: dryRun ? 'true' : undefined, expectedRevision,
      modelId, asNew: asNew ? 'true' : undefined,
      overwriteChanges: overwriteChanges ? 'true' : undefined, // API 3.16.0 (BL-57): also undo the changes made here
    };
    return send('POST', '/models/import', fd, { ...o, query });
  },
  /** `revision`: the model's revision as the page has it; the API refuses (412) when it changed since (3.12.0). */
  /** 2.28.0: a new, empty model (role admin): { xmiIdentifier, name, documentation? } -> the model. */
  createModel: (body, o) => send('POST', '/models', body, o),
  /** 2.30.0: a model's name, documentation, version (admin); `revision` (If-Match): refused (412) when it changed since. */
  updateModel: (id, body, { revision, ...o } = {}) => send('PUT', m(id), body, { ...o, ifMatch: revision }),
  deleteModel: (id, { revision, ...o } = {}) => send('DELETE', m(id), undefined, { ...o, ifMatch: revision }),

  listElements: (modelId, query, o) => getAll(`${m(modelId)}/elements`, query, o),
  getElement: (modelId, id, o) => request(`${m(modelId)}/elements/${id}`, null, o),
  neighbours: (modelId, id, query, o) => request(`${m(modelId)}/elements/${id}/neighbours`, query, o),

  listRelationships: (modelId, query, o) => getAll(`${m(modelId)}/relationships`, query, o),
  /**
   * Every relationship of a list with `include=ends` (BL-29): { relationships, ends: { elements, relationships } },
   * the ends as summaries, including the ends of ends that are relationships. query: as listRelationships.
   */
  listRelationshipsWithEnds: async (modelId, query, { signal, pageSize = PAGE_SIZE } = {}) => {
    const relationships = [], elements = [], endRels = [];
    for (;;) {
      const page = await request(`${m(modelId)}/relationships`, { ...query, include: 'ends', limit: pageSize, offset: relationships.length }, { signal });
      relationships.push(...page.items);
      elements.push(...page.ends.elements);
      endRels.push(...page.ends.relationships);
      if (!page.items.length || relationships.length >= page.total) return { relationships, ends: { elements, relationships: endRels } };
    }
  },
  getRelationship: (modelId, id, o) => request(`${m(modelId)}/relationships/${id}`, null, o),

  propertyDefinitions: (modelId, o) => request(`${m(modelId)}/property-definitions`, null, o).then(r => r.items ?? r),
  /** The record of changes of a model (API 3.11.0, role editor): { items, total, limit, offset }, newest first. */
  history: (modelId, query, o) => request(`${m(modelId)}/history`, query, o),
  modelProperties: (modelId, o) => request(`${m(modelId)}/properties`, null, o).then(r => r.items ?? r),
  metadata: (modelId, o) => request(`${m(modelId)}/metadata`, null, o),
  /** Counts of the model: elements by type and layer, relationships by type, views, folders (API-5). */
  stats: (modelId, o) => request(`${m(modelId)}/stats`, null, o),
  /** The properties in use on elements: [{ name, count, values: [{ value, count }], langs }] (HLP-9). */
  propertyIndex: (modelId, o) => request(`${m(modelId)}/properties/index`, { owner: 'element', maxValues: 1000 }, o),

  // ---- folders (HLP-7)
  /**
   * The folder tree; every folder has `counts`: what it holds at any depth. `foldersOnly` (API 3.5.0,
   * BL-49) leaves out the items filed in the folders; an older API ignores it and sends them.
   */
  organizations: (modelId, { foldersOnly = false, ...o } = {}) =>
    request(`${m(modelId)}/organizations`, { counts: true, foldersOnly: foldersOnly ? 'true' : undefined }, o),
  /** Summaries of what is filed in one folder itself, as it lists them: { elements, relationships, views }. */
  folderItems: async (modelId, folderId, o) => {
    const [elements, relationships, views] = await Promise.all(['elements', 'relationships', 'views'].map(kind =>
      getAllOf(kind, `${m(modelId)}/organizations/${folderId}/contents`, { recursive: false, order: 'model' }, o)));
    return { elements, relationships, views };
  },
  /** Summaries of the elements filed in a folder and, unless `recursive` is false, below it; `order`: 'name' | 'model'. */
  folderElements: (modelId, folderId, { recursive = true, order = 'name' } = {}, o) =>
    getAllOf('elements', `${m(modelId)}/organizations/${folderId}/contents`, { recursive, order }, o),
  /** The folders from the root down to the one an element / relationship / view is filed in; [] when it is filed nowhere. */
  folderPath: (modelId, kind, id, o) => request(`${m(modelId)}/${kind}s/${id}/folder`, null, o),

  // ---- views
  listViews: (modelId, o) => getAll(`${m(modelId)}/views`, {}, o),
  getView: (modelId, id, o) => request(`${m(modelId)}/views/${id}`, null, o),
  /**
   * { view, nodes, connections, elements, relationships }: everything needed to draw one view, in one
   * request (API-2), with the elements and relationships it refers to, complete (GAP-10).
   */
  viewContent: (modelId, viewId, o) => request(`${m(modelId)}/views/${viewId}/content`, { include: 'concepts', fields: 'full' }, o),
  /**
   * BR-25 (API 3.15.0, BL-56): created views. body: { name, documentation?, basedOn?, content: { nodes, connections } }
   * (viewcontent.js); resolves to the view. A source view is never changed: the API answers 409.
   */
  createView: (modelId, body, o) => send('POST', `${m(modelId)}/views`, body, o),
  /** BR-11 (2.23.0): changes in one transaction (API BL-13): { operations: [...] }; resolves to { results, revision, warnings }. */
  changes: (modelId, body, o) => send('POST', `${m(modelId)}/changes`, body, o),
  /**
   * 2.33.0 (API 3.24.0): recipe scripts. check: a dry run, the report (errors by line, the recipes it would make);
   * run: makes and updates them, the report with the views' ids; a script with errors: ApiError code SCRIPT_ERRORS,
   * the report in `details`.
   */
  recipeScripts: {
    check: (modelId, script, o) => send('POST', `${m(modelId)}/recipe-scripts/check`, { script }, o),
    run: (modelId, script, { deleteObsolete = false, ...o } = {}) =>
      send('POST', `${m(modelId)}/recipe-scripts/run`, { script, deleteObsolete }, o),
  },
  /** The relationship types ArchiMate allows from one concept to another (API 3.7.0): { allowed: [...] }. */
  allowedRelationships: (source, target, o) => request('/metamodel/relationships', { source, target }, o),
  /** Replaces what a created view shows; `version` (If-Match): refused (412) when someone saved it since. Resolves to its content. */
  putViewContent: (modelId, viewId, content, { version, ...o } = {}) =>
    send('PUT', `${m(modelId)}/views/${viewId}/content`, content, { ...o, ifMatch: version }),
  updateView: (modelId, viewId, body, { version, ...o } = {}) => send('PUT', `${m(modelId)}/views/${viewId}`, body, { ...o, ifMatch: version }),
  deleteView: (modelId, viewId, { version, ...o } = {}) => send('DELETE', `${m(modelId)}/views/${viewId}`, undefined, { ...o, ifMatch: version }),
  /** The elements a view shows, each once, with `position`: the box of the first node showing it (HLP-7). */
  viewElements: (modelId, viewId, o) => getAll(`${m(modelId)}/views/${viewId}/elements`, { positions: true }, o),
  /** Where an element or a relationship is shown: [{ view, nodeIds | connectionIds, labelNodeIds }] (API-4). */
  elementViews: (modelId, id, o) => getAll(`${m(modelId)}/elements/${id}/views`, {}, o),
  relationshipViews: (modelId, id, o) => getAll(`${m(modelId)}/relationships/${id}/views`, {}, o),
  /** { outgoing, incoming }: the drill-down links from a view and to it (API-10). */
  viewLinks: (modelId, viewId, o) => request(`${m(modelId)}/views/${viewId}/links`, null, o),
  /**
   * BL-35 (API 2.5.0): { items: { xmiIdentifier: { kind, id } }, notFound: [...] } for at most 1000 identifiers;
   * BL-40 (2.6.0): folderPaths (lists of labels, top first) give folderPaths: [id or null] in the same order.
   */
  resolve: (modelId, { xmiIdentifiers = [], folderPaths = [] }, o) => ask(`${m(modelId)}/resolve`, {
    ...(xmiIdentifiers.length ? { xmiIdentifiers } : {}), ...(folderPaths.length ? { folderPaths } : {}),
  }, o),

  // ---- graph helpers (HLP-1 to HLP-5): see graph.js, which builds the requests
  graph: {
    neighbourhood: (modelId, body, o) => ask(`${m(modelId)}/graph/neighbourhood`, body, o),
    subgraph: (modelId, body, o) => ask(`${m(modelId)}/graph/subgraph`, body, o),
    impact: (modelId, body, o) => ask(`${m(modelId)}/graph/impact`, body, o),
    impactCsv: (modelId, body, o) => ask(`${m(modelId)}/graph/impact`, body, { ...o, accept: 'text/csv' }),
    expansionCounts: (modelId, body, o) => ask(`${m(modelId)}/graph/expansion-counts`, body, o),
    paths: (modelId, query, o) => request(`${m(modelId)}/graph/paths`, query, o),
  },

  /** The reports of API 3.6.0 (HLP-10 to HLP-12); an older API answers 404. */
  reports: {
    quality: (modelId, query, o) => request(`${m(modelId)}/analysis/quality`, query, o),
    matrix: (modelId, body, o) => ask(`${m(modelId)}/graph/matrix`, body, o),
    matrixCsv: (modelId, body, o) => ask(`${m(modelId)}/graph/matrix`, body, { ...o, accept: 'text/csv' }),
    hierarchy: (modelId, body, o) => ask(`${m(modelId)}/graph/hierarchy`, body, o),
  },

  /**
   * The search (API-6): { query, elements: { items, total, limit, offset }, relationships, views },
   * one page per kind in `params.kinds`, best match first; every item has `match: { fields, rank }`.
   * `params`: q, kinds, limit, offset, property, propertyOp, propertyValue …
   */
  search: (modelId, params, o) => request(`${m(modelId)}/search`, params, o),
};
