// ArchiMate Browser: Selection and the URL hash; references by XMI identifier (BR-17).
// Part of js/app.js until 2026-10-24 (EN-6); app.js wires it to the page.

import { api } from '../api.js';
import { t } from '../i18n.js';
import { isFolder } from '../store.js';
import { layerOf } from '../archimate.js';
import { LayoutPrefs } from '../layoutprefs.js';
import { isManual, encodeManual, decodeManual, saveManual, mapManualKeys } from '../manual.js';
import { isId, unescapeRef, tokenFor, isPath, pathToken, labelsOf } from '../refs.js';
import { DiagramFilter } from '../filters.js';
import { PropertyOptions } from '../properties.js';
import { renderDetails } from './details.js';
import { adoptSignature, layoutSignature, manualKey, nestingMode, setNesting, showView } from './diagram.js';
import { tree } from './models.js';
import { decodeDef, encodeDef, renderDef, setFilter, setLayoutPrefs, setPropertyOptions } from './panels.js';
import { autoPane } from './shell.js';
import { $, state } from './state.js';
import { status } from './ui.js';

// ================================================================ selection / routing

/**
 * Select an item and show its details.
 * fromTree: the click came from the main tree (don't move the tree).
 * reveal:   expand the main tree to the item's canonical location (default for
 *           selections made in the details pane, diagrams or via the URL).
 */
export function select(kind, id, { fromTree = false, reveal = !fromTree } = {}) {
  state.selection = { kind, id };
  if (kind === 'view' && fromTree) showView(id);
  // UX-1: an item picked in the tree (or a menu's "Details") shows its details; a view shows itself
  else if (fromTree) autoPane('details');
  const selection = state.selection;
  // the link names the item by its XMI identifier, known once the details have it cached (UP-3)
  renderDetails(selection).then(() => { if (state.selection === selection) writeHash(); }).catch(e => status(e.message, true));
  highlightInDiagrams();
  if (reveal) revealInTree(kind, id);
  writeHash();
}

/** Path through the Folders branch (BR-9), or null when the item isn't filed. Asks the API where an item is filed (HLP-7). */
export async function folderTreePath(kind, id) {
  const s = state.store;
  if (kind === 'folder') return s.folders?.byId.has(id) ? ['m', 'folders', ...s.folderPath(id).map(f => `f:${f.id}`)] : null;
  const path = await s.folderPathOf(kind, id);
  if (!path) return null;
  return ['m', 'folders', ...path.map(f => `f:${f.id}`), `${{ element: 'e', relationship: 'r', view: 'v' }[kind]}:${id}`];
}

/** Canonical tree path (spec keys) of an item, see buildTree(). */
export async function treePath(kind, id) {
  const s = state.store;
  if (kind === 'model') return ['m'];
  if (kind === 'element' || kind === 'relationship') await s.ensure({ [`${kind}s`]: [id] });
  if (kind === 'element') {
    const e = s.element(id);
    return e && ['m', 'elements', `l:${layerOf(e.type).key}`, `t:${e.type}`, `e:${id}`];
  }
  if (kind === 'relationship') {
    const r = s.relationship(id);
    return r && ['m', 'relationships', `rt:${r.type}`, `r:${id}`];
  }
  if (kind === 'view') {
    return s.view(id) ? ['m', 'views', `v:${id}`] : null; // 2.31.0: every view directly under Views
  }
  return null;
}

export let revealSeq = 0;
export async function revealInTree(kind, id, { via = 'types' } = {}) {
  if (!state.store || !tree) return;
  const seq = ++revealSeq;
  const path = via === 'folders' || kind === 'folder' ? await folderTreePath(kind, id) : await treePath(kind, id);
  if (!path && via === 'folders') status(t('This item is not filed in a folder.'));
  if (!path) return;
  await Promise.resolve(); // let a just-built tree expand its root first
  if (seq !== revealSeq) return; // a newer selection superseded this one
  const ok = await tree.reveal(path);
  if (!ok && seq === revealSeq) status(t('Could not locate {kind} #{id} in the tree.', { kind, id }), true);
}

/** Mark the selected element/relationship in the PlantUML and layout diagrams. */
export function highlightInDiagrams() {
  const sel = state.selection;
  const attr = sel?.kind === 'element' ? 'data-element' : sel?.kind === 'relationship' ? 'data-relationship' : null;
  for (const root of [$('#tab-plantuml'), $('#tab-layout')]) {
    root.querySelectorAll('.diagram-selected').forEach(g => g.classList.remove('diagram-selected'));
    if (attr && sel.id != null) root.querySelectorAll(`[${attr}="${sel.id}"]`).forEach(g => g.classList.add('diagram-selected'));
  }
}

/**
 * URL hash = shareable state:
 *   model=<ref>  element|relationship|view|folder=<ref> (selection)
 *   d=<diagram definition>  f=<type filter>  p=<property options>  m=<moved elements>
 *   (see encodeDef, DiagramFilter.encode, PropertyOptions.encode, encodeManual)
 * BR-17: a <ref> is the item's XMI identifier (escaped, refs.js) where it has one, else its
 * id; links then survive a replace of the model, which may give its items new ids.
 */
export function writeHash() {
  const p = new URLSearchParams();
  if (state.store) p.set('model', modelRef(state.store.model));
  if (state.selection?.id != null && ['element', 'relationship', 'view', 'folder'].includes(state.selection.kind)) p.set(state.selection.kind, refOf(state.selection.kind, state.selection.id));
  diagramParams(p);
  if (state.diagramDef && state.diagramDef.kind !== 'view' && state.doc.proposal) p.set('vn', state.doc.proposal.name); // BR-25: a proposed view keeps its name
  history.replaceState(null, '', '#' + readable(p));
}

// '~', ':', '!' and '@' are valid in a fragment; keep them readable
const readable = p => p.toString().replace(/%7E/gi, '~').replace(/%3A/gi, ':').replace(/%21/g, '!').replace(/%40/g, '@');

/** The diagram shown, as a link carries it: d=, and for a generated diagram f=, p=, lo=, n=, m=. */
function diagramParams(p) {
  if (state.diagramDef) p.set('d', linkDef(state.diagramDef));
  const f = state.filter.encode();
  if (f && state.diagramDef && state.diagramDef.kind !== 'view') p.set('f', f);
  const po = state.props.encode();
  if (po && state.diagramDef) p.set('p', po);
  if (state.diagramDef && state.diagramDef.kind !== 'view') {
    const lo = state.layoutPrefs.encode();
    if (lo) p.set('lo', lo);
    p.set('n', String(nestingMode())); // the nesting travels with the link: the reader sees the same boxes
    if (isManual(state.gen?.manual)) p.set('m', encodeManual(state.gen.manual, layoutSignature(), keyOut));
  }
  return p;
}

/** 2.30.0: the recipe of the generated diagram shown (what a recipe view stores), or null for none or a stored view. */
export function recipeOfDiagram() {
  if (!state.diagramDef || state.diagramDef.kind === 'view') return null;
  return readable(diagramParams(new URLSearchParams()));
}

/** The parameters of the page's hash, or of the hash of `url`. */
export function readHash(url = null) {
  const p = new URLSearchParams((url ? new URL(url).hash : location.hash).slice(1));
  return Object.fromEntries(p.entries());
}

// ================================================================ references (BR-17)

export const KIND_OF_KEY = { e: 'element', r: 'relationship' }; // layout node ids: "e12", "r5"

export function itemOf(kind, id) {
  const s = state.store;
  if (kind === 'element') return s.element(id);
  if (kind === 'relationship') return s.relationship(id);
  if (kind === 'view') return s.view(id);
  if (kind === 'folder') return s.folders?.byId.get(id);
  return null;
}

/**
 * The link token of an item: its XMI identifier where known; for a folder without one,
 * its path of labels (BR-18); else its id.
 */
export function refOf(kind, id) {
  const xmi = itemOf(kind, id)?.xmiIdentifier;
  if (kind === 'folder' && !xmi) return folderPathToken(id) ?? String(id);
  return tokenFor(id, xmi);
}

/**
 * BR-18: the path token of a folder, or null while the folders are not loaded (they are
 * then loaded, and the hash written again) or when the path would name another folder:
 * the API takes the first of sibling folders with the same label.
 */
export function folderPathToken(id) {
  const s = state.store, f = s.folders;
  if (!f) {
    if (!s.pendingFolders) {
      s.pendingFolders = s.loadFolders()
        .then(() => { if (state.store === s) writeHash(); })
        .catch(() => { /* links keep the folder's id */ })
        .finally(() => { s.pendingFolders = null; });
    }
    return null;
  }
  const labels = [];
  for (let at = id; at != null; at = f.parentOf.get(at)) {
    const folder = f.byId.get(at);
    if (!folder) return null;
    const parent = f.parentOf.get(at);
    const siblings = parent == null ? f.roots : f.byId.get(parent)?.children || [];
    if (siblings.find(o => isFolder(o) && o.label === folder.label)?.id !== at) return null;
    labels.unshift(folder.label);
  }
  return labels.length ? pathToken(labels) : null;
}

/**
 * Models may share an XMI identifier (API 2.10.0): a model copied by copying its file keeps it.
 * The identifier names a model in links and storage keys only while no other model has it.
 */
export const sharingWith = m => state.models.filter(x => x.xmiIdentifier && x.xmiIdentifier === m.xmiIdentifier);
export const modelRef = m => (sharingWith(m).length > 1 ? String(m.id) : tokenFor(m.id, m.xmiIdentifier));
/** Does the `model=` of a link name this model (by id, or by XMI identifier since BR-17)? */
export const modelMatches = (token, m) => token === String(m.id) || token === tokenFor(m.id, m.xmiIdentifier);
/** The models a `model=` names: one by id, or every model with that identifier. */
export const modelsOfLink = (token, models = state.models) => {
  const byId = models.find(m => token === String(m.id));
  return byId ? [byId] : models.filter(m => modelMatches(token, m));
};

/**
 * The model's part of the keys of what is stored per model (baskets, moved elements): its XMI
 * identifier, which survives a replace. A copy that shares it adds its id; the oldest model keeps
 * the plain identifier, and with it what was stored before the copy came.
 */
export function modelKey(m) {
  const sharing = sharingWith(m);
  return sharing.length > 1 && sharing[0].id !== m.id ? `${m.xmiIdentifier}#${m.id}` : (m.xmiIdentifier || m.id);
}

/** A diagram definition with references (for links and the keys of stored layouts). */
export const linkDef = def => encodeDef(def, refOf);

/** Layout node id -> its token in links and storage ("e12" -> "eid-3f2a…"). */
export const keyOut = k => (k[0] === 'n' ? k : k[0] + refOf(KIND_OF_KEY[k[0]], Number(k.slice(1)))); // notes: "n<ref>" (CM-14)

/** Token -> layout node id, for the elements and relationships of a diagram; null when it is not there. */
export function keyInFor(elements, relationships, notes = []) {
  const byToken = new Map(notes.map(n => [n.key, n.key]));
  for (const e of elements) byToken.set(`e${tokenFor(e.id, e.xmiIdentifier)}`, `e${e.id}`);
  for (const r of relationships) byToken.set(`r${tokenFor(r.id, r.xmiIdentifier)}`, `r${r.id}`);
  return k => (isId(k.slice(1)) ? k : byToken.get(k) ?? null);
}

/**
 * BR-17: a hash whose references are turned into ids, so that applyHash can use it.
 * Ids stay as they are (links written before BR-17); XMI identifiers are resolved by
 * the API in one request (BL-35). What the model no longer has is left out, and the
 * status line says how much.
 */
export async function resolveHash(hash, { signal } = {}) {
  const wanted = new Set(), paths = new Set();
  const note = token => {
    if (isPath(token)) paths.add(token);
    else if (!isId(token)) wanted.add(unescapeRef(token));
    return 0;
  };
  const sel = ['element', 'relationship', 'view', 'folder'].find(k => hash[k] != null);
  if (sel) note(hash[sel]);
  if (hash.d) decodeDef(hash.d, note);
  const moved = hash.m ? decodeManual(hash.m) : null;
  if (moved) for (const k of [...(moved.manual.hints?.keys() || []), ...moved.manual.pins.keys()]) if (k[0] !== 'n') note(k.slice(1));
  if (!wanted.size && !paths.size) return hash;

  const found = new Map();
  const list = [...wanted];
  for (let i = 0; i < list.length; i += 1000) {
    const res = await api.resolve(state.store.id, { xmiIdentifiers: list.slice(i, i + 1000) }, { signal });
    for (const [xmi, hit] of Object.entries(res.items)) found.set(xmi, hit);
  }
  const pathList = [...paths];
  for (let i = 0; i < pathList.length; i += 1000) {
    const chunk = pathList.slice(i, i + 1000);
    const res = await api.resolve(state.store.id, { folderPaths: chunk.map(labelsOf) }, { signal });
    chunk.forEach((token, j) => { if (res.folderPaths[j] != null) found.set(token, { kind: 'folder', id: res.folderPaths[j] }); });
  }
  let missing = 0;
  const idOf = (token, kind) => {
    if (isId(token)) return Number(token);
    const hit = found.get(isPath(token) ? token : unescapeRef(token));
    if (hit?.kind === kind) return hit.id;
    missing++;
    return null;
  };
  const out = { ...hash };
  if (sel) {
    const id = idOf(hash[sel], sel);
    if (id == null) delete out[sel]; else out[sel] = String(id);
  }
  if (hash.d) {
    const def = decodeDef(hash.d, idOf);
    if (def) out.d = encodeDef(def); else delete out.d;
  }
  if (moved) {
    const tr = k => { if (k[0] === 'n') return k; const id = idOf(k.slice(1), KIND_OF_KEY[k[0]]); return id == null ? null : k[0] + id; };
    out.m = encodeManual(mapManualKeys(moved.manual, tr), moved.signature);
  }
  if (missing) status(t('{n} item of the link is not in this model any more.|{n} items of the link are not in this model any more.', { n: missing }), true);
  return out;
}

/** Apply a hash (initial load or manual edit / pasted link). */
export function applyHash(hash) {
  // A diagram link carries its own filter (absent = no filter), so it renders as the sender saw it.
  if (hash.d) {
    const f = DiagramFilter.decode(hash.f || '');
    if (f.encode() !== state.filter.encode()) setFilter(f, { rerender: false });
    const po = PropertyOptions.decode(hash.p || '');
    if (po.encode() !== state.props.encode()) setPropertyOptions(po, { rerender: false, redraw: true });
    // layout options travel with links that set them or carry a manual layout (LV-6);
    // other links keep the reader's own layout preferences
    if (hash.lo || hash.m) {
      const lp = LayoutPrefs.decode(hash.lo || '');
      if (lp.encode() !== state.layoutPrefs.encode()) setLayoutPrefs(lp, { rerender: false });
    }
    // links without n= (from before) keep the reader's nesting
    if (/^[0-4]$/.test(hash.n || '')) setNesting(Number(hash.n), { rerender: false });
    const def = decodeDef(hash.d);
    if (hash.m && def && def.kind !== 'view') {
      const { signature, manual } = decodeManual(hash.m);
      adoptSignature(signature);
      saveManual(manualKey(def), manual, keyOut);
    }
  }
  if (hash.element) select('element', Number(hash.element));
  else if (hash.relationship) select('relationship', Number(hash.relationship));
  else if (hash.view) select('view', Number(hash.view));
  else if (hash.folder) select('folder', Number(hash.folder));
  const def = hash.d ? decodeDef(hash.d) : hash.view ? { kind: 'view', id: Number(hash.view) } : null;
  if (def) renderDef(def);
  // BR-25 (2.22.1): a proposed view (the MCP server's propose_view): the diagram to arrange and save under this name
  if (def && def.kind !== 'view' && hash.vn) state.doc.proposal = { name: String(hash.vn).slice(0, 500) };
  return !!(hash.element || hash.relationship || hash.view || hash.folder);
}
