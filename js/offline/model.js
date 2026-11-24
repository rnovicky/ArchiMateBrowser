// Offline copy (2.20.0): the model of a snapshot (GET …/snapshot, API 3.14.0), indexed for the stand-in
// of the API (standin.js). Everything here mirrors what the API does with its database, so that the
// stand-in answers as the API would; tests/unit/offline.test.js compares the two answer by answer.

/** Python's str.casefold() for the letters where it differs from toLowerCase(): the API folds with it. */
export function casefold(text) {
  if (typeof text !== 'string') return text;
  return text.toLowerCase().replace(/ß/g, 'ss').replace(/ς/g, 'σ').replace(/ſ/g, 's')
    .replace(/[ﬀ-ﬆ]/g, c => ({ 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st' })[c]);
}

/** Compare as Python compares tuples: element by element; false before true, numbers and strings as such. */
export function byKey(key) {
  return (a, b) => {
    const x = key(a), y = key(b);
    for (let i = 0; i < x.length; i++) {
      if (x[i] === y[i]) continue;
      if (x[i] == null) return -1;
      if (y[i] == null) return 1;
      return x[i] < y[i] ? -1 : 1;
    }
    return 0;
  };
}

/** Order by name without regard to case, items without a name last, then by id (the API's _by_name). */
export const byName = byKey(o => [o.name == null, casefold(o.name ?? ''), o.id]);

/** An answer of the API's paged lists. */
export function page(items, { limit, offset }) {
  return { items: items.slice(offset, offset + limit), total: items.length, limit, offset };
}

export const elementSummary = e => ({ id: e.id, xmiIdentifier: e.xmiIdentifier, type: e.type, name: e.name });

export const relationshipSummary = r => ({
  id: r.id, xmiIdentifier: r.xmiIdentifier, type: r.type, name: r.name,
  sourceElementId: r.sourceElementId, sourceRelationshipId: r.sourceRelationshipId,
  targetElementId: r.targetElementId, targetRelationshipId: r.targetRelationshipId,
  accessType: r.accessType, isDirected: r.isDirected,
});

export const viewSummary = v => ({ id: v.id, xmiIdentifier: v.xmiIdentifier, name: v.name, type: v.type, viewpoint: v.viewpoint });

/** Python's sorted(set of ints). */
export const sortedIds = ids => [...new Set(ids)].sort((a, b) => a - b);

const NUMBER = /^-?[0-9]+([.][0-9]+)?$/;
const NUMERIC_TYPES = ['number', 'currency'];

export class OfflineModel {
  constructor(snapshot) {
    this.snapshot = snapshot;
    this.model = snapshot.model;
    this.id = snapshot.model.id;
    this.elementList = snapshot.elements;          // by id
    this.relationshipList = snapshot.relationships; // by id
    this.elements = new Map(this.elementList.map(e => [e.id, e]));
    this.relationships = new Map(this.relationshipList.map(r => [r.id, r]));
    this.out = new Map(); // element id -> relationships it is the source of, by id
    this.in = new Map();  // element id -> relationships it is the target of, by id
    for (const r of this.relationshipList) {
      if (r.sourceElementId != null) push(this.out, r.sourceElementId, r);
      if (r.targetElementId != null) push(this.in, r.targetElementId, r);
    }
    this.views = snapshot.views; // by sortOrder, then id
    this.viewById = new Map(this.views.map(v => [v.id, v]));
    this.definitions = new Map(snapshot.propertyDefinitions.map(d => [d.id, d]));
    this.#indexViews();
    this.#indexFolders();
  }

  // ------------------------------------------------------------------ views

  #indexViews() {
    this.nodes = [];       // every node of every view, flat, with its view id
    this.connections = []; // every connection of every view
    this.content = new Map(); // view id -> { nodes, connections }
    for (const v of this.views) {
      const c = this.snapshot.viewContents[String(v.id)] || { nodes: [], connections: [] };
      this.content.set(v.id, c);
      const walk = list => list.forEach(n => { this.nodes.push(n); walk(n.children || []); });
      walk(c.nodes);
      this.connections.push(...c.connections);
    }
    this.nodesById = new Map(this.nodes.map(n => [n.id, n]));
  }

  /** Nodes of one view, flat, by id (the API's queries of a view's nodes order by id). */
  viewNodes(viewId) {
    return this.nodes.filter(n => n.viewId === viewId).sort((a, b) => a.id - b.id);
  }

  /** The distinct elements a view shows, with the box of the first node that shows each (folders.view_elements). */
  viewElements(viewId) {
    const found = new Map();
    for (const n of this.viewNodes(viewId)) {
      for (const id of [n.elementRefId, n.conceptRefElementId]) {
        if (id != null && !found.has(id)) found.set(id, { nodeId: n.id, x: n.x, y: n.y, w: n.w, h: n.h });
      }
    }
    return found;
  }

  // ------------------------------------------------------------------ folders

  #indexFolders() {
    this.orgById = new Map();   // every row of the folder tree: folders and the items filed in them
    this.orgParent = new Map(); // row id -> parent row id
    const walk = (list, parent) => list.forEach(o => {
      this.orgById.set(o.id, o);
      this.orgParent.set(o.id, parent);
      walk(o.children || [], o.id);
    });
    walk(this.snapshot.organizations, null);
  }

  static isFolder(o) { return o.refElementId == null && o.refRelationshipId == null && o.refViewId == null; }

  /** The folder and, if `recursive`, every folder below it (folders.folders_below). */
  foldersBelow(folderId, recursive = true) {
    if (!recursive) return [folderId];
    const found = [], todo = [folderId];
    while (todo.length) {
      const id = todo.pop();
      found.push(id);
      for (const c of this.orgById.get(id)?.children || []) if (OfflineModel.isFolder(c)) todo.push(c.id);
    }
    return found;
  }

  /** Ids of `kind` filed directly in the folders, in the order of the folder items, each once (filed_in_order). */
  filedInOrder(kind, folderIds) {
    const ref = REF[kind], wanted = new Set(folderIds);
    const rows = [...this.orgById.values()].filter(o => o[ref] != null && wanted.has(this.orgParent.get(o.id)))
      .sort(byKey(o => [o.sortOrder, o.id]));
    return [...new Set(rows.map(o => o[ref]))];
  }

  /** Every place an item is filed in, as paths of { id, label } from the root (folders.folder_paths). */
  folderPaths(kind, itemId) {
    const ref = REF[kind];
    const leaves = [...this.orgById.values()].filter(o => o[ref] === itemId).sort((a, b) => a.id - b.id);
    const paths = [];
    for (const leaf of leaves) {
      const path = [], seen = new Set();
      for (let p = this.orgParent.get(leaf.id); p != null && !seen.has(p); p = this.orgParent.get(p)) {
        seen.add(p);
        const f = this.orgById.get(p);
        if (!f) break;
        path.unshift({ id: f.id, label: f.label });
      }
      if (!paths.some(q => JSON.stringify(q) === JSON.stringify(path))) paths.push(path);
    }
    return paths;
  }

  // ------------------------------------------------------------------ elements and relationships

  /** { outgoing, incoming } over all relationship types (summaries.degrees). */
  degree(id) {
    return { outgoing: this.out.get(id)?.length || 0, incoming: this.in.get(id)?.length || 0 };
  }

  /** Elements as the helper endpoints return them (summaries.elements): summaries or complete, with `degree`. */
  elementPayload(id, fields = 'summary', degree = false) {
    const e = this.elements.get(id);
    if (!e) return null;
    const out = fields === 'full' ? structuredClone(e) : elementSummary(e);
    if (degree) out.degree = this.degree(id);
    return out;
  }

  relationshipPayload(id, fields = 'summary') {
    const r = this.relationships.get(id);
    if (!r) return null;
    return fields === 'full' ? structuredClone(r) : relationshipSummary(r);
  }

  /** The property values of an item (element, relationship or view), as its Read schema lists them. */
  static props(item) { return item?.properties || []; }

  /** The name of a property value's definition. */
  definitionName(p) { return p.propertyDefinitionName ?? this.definitions.get(p.propertyDefinitionId)?.name; }

  /** predicates.property_condition: does `item` meet the condition on its property `name`? */
  meets(item, name, op = 'eq', value = null) {
    const wanted = casefold(name);
    const values = OfflineModel.props(item).filter(p => casefold(this.definitionName(p) ?? '') === wanted);
    let found;
    if (op === 'exists' || op === 'missing') found = values.length > 0;
    else if (op === 'eq' || op === 'ne') found = values.some(p => casefold(p.value ?? '') === casefold(value));
    else if (op === 'contains') found = values.some(p => casefold(p.value ?? '').includes(casefold(value)));
    else if (op === 'gt' || op === 'lt') {
      const cmp = (a, b) => (op === 'gt' ? a > b : a < b);
      const number = Number.isFinite(Number(value)) && String(value).trim() !== '' ? Number(value) : null;
      found = values.some(p => {
        const def = this.definitions.get(p.propertyDefinitionId);
        if (NUMERIC_TYPES.includes(def?.dataType)) return number != null && NUMBER.test(p.value ?? '') && cmp(Number(p.value), number);
        return cmp(casefold(p.value ?? ''), casefold(value));
      });
    } else found = false;
    return op === 'ne' || op === 'missing' ? !found : found;
  }

  /** The `property`, `propertyValue`, `propertyOp` of a list (_utils.property_filter) as a test, or null. */
  static propertyTest(model, name, value, op) {
    if (name == null) return null;
    const o = op || (value == null ? 'exists' : 'eq');
    return item => model.meets(item, name, o, value);
  }
}

const REF = { elements: 'refElementId', relationships: 'refRelationshipId', views: 'refViewId' };

function push(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}
