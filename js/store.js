// Client-side cache of one model (UP-3). Opening a model loads what does not
// grow with its elements and relationships: the model, its statistics, the
// view list, the folders (without what is filed in them) and the property index. Elements and relationships are kept as the API's
// answers bring them; look-ups (`element(id)`, `relationship(id)`) stay
// synchronous and answer only what is cached, so every entry point of the UI
// first makes sure of what it will show (`ensure`, or one of the lists below).
// (PLAN.md, phase 4: the full load of every element and relationship is gone.)

import { api } from './api.js';
import { propertyIndexFrom } from './properties.js';
import { t as tr } from './i18n.js';

/** A folder, as opposed to an item of the folder tree that files an element, a relationship or a view (API-11). */
export const isFolder = o => o.refElementId == null && o.refRelationshipId == null && o.refViewId == null;

/** Complete, not a summary: the API's summaries have no properties. */
const isFull = o => Array.isArray(o?.properties);

/** Ids asked for by `ids=` in one request: well below the API's limit of 1000, for the length of the URL. */
const IDS_PER_REQUEST = 500;
const chunks = (list, n = IDS_PER_REQUEST) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, (i + 1) * n));

export class ModelStore {
  constructor(model) {
    this.model = model;
    this.id = model.id;
    this.elements = new Map();      // id -> element, complete or a summary; `degree` where the API counted it
    this.relationships = new Map(); // id -> relationship, complete or a summary
    this.missing = new Set();       // ids asked for that the model does not have ("e12", "r5")
    this.lists = new Map();         // kept answers of the lists below, by key
    this.views = [];
    this.liveScripts = [];      // 2.35.0 (API 3.26.0): the model's live recipe templates, listed under Views
    this.viewCache = new Map(); // viewId -> {nodes, connections}
    this.stats = null;          // GET …/stats (API-5): the counts the tree, the status line and the details show
    this.propertyIndex = new Map(); // properties used on elements: name -> { count, values, langs } (HLP-9)
  }

  /** Load what opening a model needs; signal (EN-2) cancels the remaining requests, e.g. when another model is chosen meanwhile. */
  async load(onProgress, { signal } = {}) {
    onProgress?.(tr('Loading model…'));
    const [views, stats, properties] = await Promise.all([
      api.listViews(this.id, { signal }),
      api.stats(this.id, { signal }),
      api.propertyIndex(this.id, { signal }),
      this.loadFolders({ signal }), // the folder tree with its counts (BR-9, HLP-7)
    ]);
    this.stats = stats;
    this.propertyIndex = propertyIndexFrom(properties);
    this.views = views.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }

  // ------------------------------------------------------------- the cache

  /**
   * Keep elements and relationships from an answer. What is known is merged
   * with what comes, so a summary never replaces a complete item.
   */
  remember({ elements = [], relationships = [] } = {}) {
    for (const e of elements) this.elements.set(e.id, { ...this.elements.get(e.id), ...e });
    for (const r of relationships) this.relationships.set(r.id, { ...this.relationships.get(r.id), ...r });
  }

  /**
   * Make sure the given elements and relationships are cached complete, by `ids=` (HLP-8);
   * a relationship comes with its ends (as far as they are relationships, theirs too), so
   * that it can be named. `degree`: the elements also need their relationship counts (HLP-6).
   * Ids the model does not have stay unknown: check with element(id) afterwards.
   */
  async ensure({ elements = [], relationships = [] } = {}, { signal, degree = false } = {}) {
    const els = [...new Set(elements)].filter(id => id != null && !this.missing.has(`e${id}`)
      && !(isFull(this.elements.get(id)) && (!degree || this.elements.get(id).degree)));
    const rels = [...new Set(relationships)].filter(id => id != null && !this.missing.has(`r${id}`) && !isFull(this.relationships.get(id)));
    if (!els.length && !rels.length) return;
    await Promise.all([
      ...chunks(els).map(async ids => {
        this.remember({ elements: await api.listElements(this.id, { ids: ids.join(','), include: 'degree' }, { signal }) });
        for (const id of ids) if (!this.elements.has(id)) this.missing.add(`e${id}`);
      }),
      ...chunks(rels).map(async ids => {
        this.rememberWithEnds(await api.listRelationshipsWithEnds(this.id, { ids: ids.join(',') }, { signal }));
        for (const id of ids) if (!this.relationships.has(id)) this.missing.add(`r${id}`);
      }),
    ]);
  }

  /** Keep an answer of api.listRelationshipsWithEnds; returns its relationships as cached. */
  rememberWithEnds({ relationships, ends }) {
    this.remember({ elements: ends.elements, relationships: ends.relationships });
    this.remember({ relationships });
    return relationships.map(r => this.relationship(r.id));
  }

  /** A list kept under `key`: asked for once per model. */
  #kept(key, load) {
    if (!this.lists.has(key)) this.lists.set(key, load().catch(e => { this.lists.delete(key); throw e; }));
    return this.lists.get(key);
  }

  element(id) { return this.elements.get(id); }
  relationship(id) { return this.relationships.get(id); }
  view(id) { return this.views.find(v => v.id === id); }

  /** BR-25: a view this page made or changed (a created view), as the API answered it; its content is read again. */
  putView(v) {
    const known = this.view(v.id);
    this.views = [...this.views.filter(x => x.id !== v.id), v].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    this.viewCache.delete(v.id);
    if (!known && this.stats) {
      this.stats.views.total += 1;
      if (v.origin === 'created') this.stats.views.created = (this.stats.views.created || 0) + 1;
    }
  }

  /** 2.33.0: the views read again, after a recipe script made, changed or deleted some of them. */
  async reloadViews({ signal } = {}) {
    const views = await api.listViews(this.id, { signal });
    this.views = views.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    this.viewCache.clear();
    if (this.stats) {
      this.stats.views.total = views.length;
      this.stats.views.created = views.filter(v => v.origin === 'created').length;
    }
  }

  /** 2.35.0 (API 3.26.0): the live recipe templates, read again (when a script was kept, run or deleted). */
  async loadLiveScripts({ signal } = {}) {
    this.liveScripts = (await api.recipeScripts.list(this.id, { signal })).filter(x => x.live)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** BR-25: a view this page deleted. */
  dropView(id) {
    const known = this.view(id);
    if (!known) return;
    this.views = this.views.filter(v => v.id !== id);
    this.viewCache.delete(id);
    if (this.stats) {
      this.stats.views.total -= 1;
      if (known.origin === 'created') this.stats.views.created = Math.max(0, (this.stats.views.created || 1) - 1);
    }
  }

  /** `{ outgoing, incoming }` relationship counts of an element, where known (HLP-6). */
  degree(id) { return this.elements.get(id)?.degree; }

  // ------------------------------------------------------------- lists, asked for when needed

  /** The elements of a type, sorted by name, each with its relationship counts. */
  async elementsOfType(type, { signal } = {}) {
    const ids = await this.#kept(`type:${type}`, async () => {
      const els = await api.listElements(this.id, { type, include: 'degree' }, { signal });
      this.remember({ elements: els });
      return els.map(e => e.id);
    });
    return ids.map(id => this.element(id)).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }

  /** The relationships of a type, by the names of their ends (GAP-8), each with its ends cached. */
  relationshipsOfType(type, { signal } = {}) {
    return this.#relationshipList(`reltype:${type}`, { type, sort: 'ends' }, signal);
  }

  /** Relationships that have another relationship as source or target (BR-6). */
  relationshipsOnRelationships({ signal } = {}) {
    if (!this.stats?.relationships.onRelationships) return Promise.resolve([]);
    return this.#relationshipList('onrel', { onRelationship: true, sort: 'ends' }, signal);
  }

  /** The relationships of an element: { outgoing, incoming }, each with its other end cached. */
  async relationshipsOf(elementId, { signal } = {}) {
    const [outgoing, incoming] = await Promise.all([
      this.#relationshipList(`out:${elementId}`, { sourceElementId: elementId }, signal),
      this.#relationshipList(`in:${elementId}`, { targetElementId: elementId }, signal),
    ]);
    return { outgoing, incoming };
  }

  /** Relationships whose source or target is the given *relationship* (BR-6). */
  async attachedTo(relationshipId, { signal } = {}) {
    if (!this.stats?.relationships.onRelationships) return [];
    const lists = await Promise.all([
      this.#relationshipList(`rout:${relationshipId}`, { sourceRelationshipId: relationshipId }, signal),
      this.#relationshipList(`rin:${relationshipId}`, { targetRelationshipId: relationshipId }, signal),
    ]);
    return lists.flat();
  }

  async #relationshipList(key, query, signal) {
    const ids = await this.#kept(key, async () =>
      this.rememberWithEnds(await api.listRelationshipsWithEnds(this.id, query, { signal })).map(r => r.id));
    return ids.map(id => this.relationship(id));
  }

  // ------------------------------------------------------------- names

  /** Display name for a relationship endpoint (element or relationship). */
  endpointName(elementId, relationshipId) {
    if (elementId != null) return this.element(elementId)?.name || `#${elementId}`;
    const r = this.relationship(relationshipId);
    if (!r) return `[relationship #${relationshipId}]`;
    // one level only: "[Serving: A → B]" (nested relationship endpoints shown as "…")
    const end = (e, rr) => (e != null ? this.element(e)?.name || `#${e}` : rr != null ? '…' : '?');
    return `[${r.type}${r.name ? ' ' + r.name : ''}: ${end(r.sourceElementId, r.sourceRelationshipId)} → ${end(r.targetElementId, r.targetRelationshipId)}]`;
  }

  relationshipLabel(r) {
    return `${this.endpointName(r.sourceElementId, r.sourceRelationshipId)} → ${this.endpointName(r.targetElementId, r.targetRelationshipId)}`;
  }

  // ------------------------------------------------------------- views

  /** { nodes, connections } of a stored view, in one request (API-2), with its elements and relationships cached; kept once loaded. */
  async viewContent(viewId, { signal } = {}) {
    if (!this.viewCache.has(viewId)) {
      const { nodes, connections, elements = [], relationships = [] } = await api.viewContent(this.id, viewId, { signal });
      this.remember({ elements, relationships });
      this.viewCache.set(viewId, { nodes, connections });
    }
    return this.viewCache.get(viewId);
  }

  /**
   * The elements a stored view shows, with their place there: element id -> { x, y }
   * of the first node that shows it (HLP-7).
   */
  async viewElementPositions(viewId, { signal } = {}) {
    const shape = new Map();
    const els = await api.viewElements(this.id, viewId, { signal });
    this.remember({ elements: els.map(({ position, ...e }) => e) });
    for (const e of els) shape.set(e.id, { x: e.position.x, y: e.position.y });
    return shape;
  }

  /** The views that show an element or a relationship (`kind`), as view summaries (API-4). */
  async viewsShowing(kind, id, { signal } = {}) {
    const usages = await (kind === 'element' ? api.elementViews : api.relationshipViews)(this.id, id, { signal });
    return usages.map(u => u.view);
  }

  /** Drill-down links of a view (API-10): { outgoing: [{ targetViewId, label, … }], incoming: [{ sourceViewId, … }] }. */
  viewLinks(viewId, { signal } = {}) {
    return api.viewLinks(this.id, viewId, { signal });
  }

  // ------------------------------------------------------------- folders (BR-9, HLP-7)

  /**
   * Load the folder tree once, folders only. The API counts what every folder
   * holds (`counts`), lists what is filed in one (folderItems, folderElements)
   * and knows where an item is filed (folderPathOf); kept here is only the
   * shape of the tree: the folders by id and their parents.
   */
  async loadFolders({ signal } = {}) {
    if (this.folders) return this.folders;
    const roots = await api.organizations(this.id, { foldersOnly: true, signal });
    const byId = new Map(), parentOf = new Map();
    const walk = (items, parent) => {
      for (const o of items) {
        if (!isFolder(o)) continue;
        byId.set(o.id, o);
        parentOf.set(o.id, parent?.id ?? null);
        walk(o.children || [], o);
      }
    };
    walk(roots, null);
    this.folders = { roots, byId, parentOf };
    return this.folders;
  }

  /** What a folder holds at any depth: { elements, relationships, views, folders }. */
  folderCounts(folderId) {
    return this.folders?.byId.get(folderId)?.counts || { elements: 0, relationships: 0, views: 0, folders: 0 };
  }

  /** Folder chain from the root down to `folderId` (array of folder objects). */
  folderPath(folderId) {
    const path = [];
    for (let id = folderId; id != null && this.folders?.byId.has(id); id = this.folders.parentOf.get(id)) path.unshift(this.folders.byId.get(id));
    return path;
  }

  /**
   * Folder path of an element / relationship / view, as [{ id, label }] from
   * the root down, or null when it is filed nowhere. An item filed more
   * than once gives its first place.
   */
  async folderPathOf(kind, id, { signal } = {}) {
    const path = await api.folderPath(this.id, kind, id, { signal });
    return path.length ? path : null;
  }

  /**
   * What is filed in a folder itself, in its order: { elements, relationships, views }, the elements
   * and relationships cached complete (relationships with their ends), the views as listed.
   */
  async folderItems(folderId, { signal } = {}) {
    const items = await this.#kept(`folder:${folderId}`, () => api.folderItems(this.id, folderId, { signal }));
    await this.ensure({ elements: items.elements.map(e => e.id), relationships: items.relationships.map(r => r.id) }, { signal, degree: true });
    return {
      elements: items.elements.map(e => this.element(e.id)).filter(Boolean),
      relationships: items.relationships.map(r => this.relationship(r.id)).filter(Boolean),
      views: items.views.map(v => this.view(v.id) || v),
    };
  }

  /** Element id -> the labels of the folders it is filed in, from the root down (its first place), for exports. */
  elementFolders({ signal } = {}) {
    return this.#kept('element-folders', async () => {
      const out = new Map();
      const walk = (items, path) => {
        for (const o of items) {
          if (isFolder(o)) walk(o.children || [], [...path, o.label || '']);
          else if (o.refElementId != null && !out.has(o.refElementId)) out.set(o.refElementId, path.filter(Boolean));
        }
      };
      walk(await api.organizations(this.id, { signal }), []);
      return out;
    });
  }

  /** Summaries ({ id, type, name, … }) of the elements filed in a folder, optionally including sub-folders. */
  async folderElements(folderId, { recursive = true, order = 'name', signal } = {}) {
    const els = await api.folderElements(this.id, folderId, { recursive, order }, { signal });
    this.remember({ elements: els });
    return els;
  }

  /** Ids of the elements filed in a folder, optionally including sub-folders. */
  async folderElementIds(folderId, recursive = true, { signal } = {}) {
    return (await this.folderElements(folderId, { recursive, signal })).map(e => e.id);
  }

}
