// ArchiMate Browser: The details pane, and the impact analysis (BR-12).
// Part of js/app.js until 2026-10-24 (EN-6); app.js wires it to the page.

import { api, isAbort } from '../api.js';
import { settings, saveSettings } from '../config.js';
import { t } from '../i18n.js';
import { isFolder } from '../store.js';
import { csvFile } from '../csv.js';
import { LAYERS, RELATIONSHIP_TYPES, typesOfLayer, elementColor, elementBadge, prettyType, layerOf, relationshipGlyph, spriteUrl } from '../archimate.js';
import { PROPAGATION, DIRECTIONS, DEFAULT_TYPES as IMPACT_DEFAULT_TYPES } from '../impact.js';
import * as graph from '../graph.js';
import { actionButtons, actionContext } from './actions.js';
import { layerElementIds, relTypeEndIds, relTypeList, updateBasket } from './basket.js';
import { addToDiagram, canAddToDiagram, onDiagram, showOnDiagram, showView } from './diagram.js';
import { findWithProperty, selectInfo } from './menus.js';
import { historySection } from './history.js';
import { linkStateList, openLinkDialog, selectType, updateFromLink } from './models.js';
import { drillToView, renderDef } from './panels.js';
import { revealInTree, select } from './routing.js';
import { $, state } from './state.js';
import { download, errorBox, h, may, safeName, startJob } from './ui.js';
import { isCreated, isRecipe, lostBox, originText } from './views.js';
import { editForm, masterText } from './editing.js';

// ================================================================ details

export function fill(target, ...kids) {
  target.replaceChildren(...kids.flat(Infinity).filter(k => k != null && k !== false));
}

/** <img> of the ArchiMate sprite for an element type / relationship (type), or null. */
export function spriteImg(typeOrRel) {
  const src = spriteUrl(typeOrRel);
  return src ? h('img', { class: 'sprite', src, alt: '' }) : null;
}

/** Element-type badge: sprite + acronym on the layer colour. */
export function typeBadge(type) {
  return h('span', { class: 'badge', style: `background:${elementColor(type)}`, title: prettyType(type) }, spriteImg(type), elementBadge(type));
}

/** Relationship badge: sprite (or a text glyph if there is none) on a light chip. */
export function relBadge(rel) {
  const type = typeof rel === 'string' ? rel : rel.type;
  return h('span', { class: 'badge rel', title: type }, spriteImg(rel) || relationshipGlyph(type));
}

export function link(text, onclick) { return h('a', { onclick: e => { e.preventDefault(); onclick(); }, href: '#' }, text); }

/** Mark a details-pane item for its context menu (CM-1): kind 'element' | 'relationship' | 'view' | 'folder'. */
export function ctx(el, kind, id) {
  el.dataset.ctx = `${kind}:${id}`;
  return el;
}

export function elementLink(id) {
  const e = state.store.element(id);
  return e ? h('span', {}, typeBadge(e.type), ' ', ctx(link(e.name || t('(unnamed {type})', { type: prettyType(e.type) }), () => select('element', id)), 'element', id)) : `#${id}`;
}
export function endpointLink(eid, rid) {
  if (eid != null) return elementLink(eid);
  return ctx(link(state.store.endpointName(null, rid), () => select('relationship', rid)), 'relationship', rid);
}
export function viewLink(v, onclick) {
  return ctx(link(v?.name || t('(view)'), onclick), 'view', v?.id);
}

// ---------------------------------------------------------------- impact analysis (BR-12)

export function impactOptions() {
  const o = settings.impact || {};
  return {
    direction: DIRECTIONS[o.direction] ? o.direction : 'impact',
    depth: Math.min(10, Math.max(1, Number(o.depth) || 5)),
    types: Array.isArray(o.types) ? o.types.filter(t => RELATIONSHIP_TYPES.includes(t)) : [...IMPACT_DEFAULT_TYPES],
  };
}

/** Impact-analysis panel for an element: controls + live results (list by distance). */
export function impactBox(e) {
  const s = state.store;
  const box = h('div', { class: 'impact-box' });
  let seq = 0;
  const draw = async () => {
    const o = impactOptions();
    const set = patch => { saveSettings({ impact: { ...o, ...patch } }); draw(); };
    const def = { kind: 'impact', id: e.id, dir: o.direction, depth: o.depth, types: o.types };
    const LIMIT = 40;
    const result = h('div', {}, h('p', { class: 'muted' }, t('Loading…')));
    fill(box,
      h('div', { class: 'controls' },
        h('select', { 'aria-label': t('Analysis direction'), onchange: ev => set({ direction: ev.target.value }) },
          Object.entries(DIRECTIONS).map(([k, v]) => h('option', { value: k, selected: k === o.direction }, v.label))),
        h('label', { class: 'field' }, t('Max depth'), h('select', { onchange: ev => set({ depth: Number(ev.target.value) }) },
          Array.from({ length: 10 }, (_, i) => i + 1).map(n => h('option', { value: n, selected: n === o.depth }, n))))),
      h('div', { class: 'types', title: t('Relationship types followed') },
        RELATIONSHIP_TYPES.map(rt => h('label', { class: 'chip', title: PROPAGATION[rt] === 'out' ? t('{type}: change propagates source → target', { type: rt })
          : PROPAGATION[rt] === 'in' ? t('{type}: change propagates target → source', { type: rt }) : t('{type}: change propagates both ways', { type: rt }) },
          h('input', { type: 'checkbox', checked: o.types.includes(rt), onchange: ev => set({ types: ev.target.checked ? [...o.types, rt] : o.types.filter(x => x !== rt) }) }), relBadge(rt), rt)),
        h('button', { type: 'button', class: 'link', onclick: () => set({ types: [...IMPACT_DEFAULT_TYPES] }) }, t('defaults'))),
      result);

    // HLP-3: the API analyses; the controls above stay usable while it does
    const mine = ++seq;
    const query = { direction: o.direction, types: o.types, maxDepth: o.depth };
    let a;
    try {
      a = await graph.impact(s, [e.id], query);
    } catch (err) {
      if (mine === seq && !isAbort(err)) fill(result, errorBox(err, draw, { compact: true }));
      return;
    }
    if (mine !== seq) return; // the settings changed meanwhile
    const byLevel = new Map();
    for (const r of a.results.values()) {
      if (!byLevel.has(r.level)) byLevel.set(r.level, []);
      byLevel.get(r.level).push(r);
    }
    const csv = async () => download(safeName(`${DIRECTIONS[o.direction].short} ${e.name}`) + '.csv', csvFile(await graph.impactCsv(s, [e.id], query)), 'text/csv');
    fill(result,
      h('p', {}, a.results.size
        ? (a.truncated
          ? t('{n} element(s) over {levels} level(s) — more beyond depth {depth}.', { n: a.results.size, levels: a.maxLevel, depth: o.depth })
          : t('{n} element(s) over {levels} level(s).', { n: a.results.size, levels: a.maxLevel }))
        : t('Nothing found with these settings.')),
      a.results.size ? h('div', { class: 'actions' },
        h('button', { class: 'primary', onclick: () => renderDef(def) }, t('Impact diagram')),
        h('button', { onclick: () => { state.basket.add(e.id); a.results.forEach((_, id) => state.basket.add(id)); updateBasket(); } }, t('Add to basket')),
        h('button', { onclick: csv }, t('CSV'))) : null,
      [...byLevel.entries()].sort((x, y) => x[0] - y[0]).map(([lvl, list]) => {
        list.sort((x, y) => (s.element(x.id)?.name || '').localeCompare(s.element(y.id)?.name || ''));
        const item = r => {
          const via = s.relationship(r.via), from = s.element(r.from);
          return ctx(h('li', {}, elementLink(r.id),
            // "from X —Serving→" (X is the source) or "from X ←Composition—" (X is the target)
            h('span', { class: 'via' }, t('from {name} {via}', { name: from?.name || '#' + r.from, via: via?.sourceElementId === r.from ? `—${via?.type}→` : `←${via?.type}—` }))), 'element', r.id);
        };
        const ul = h('ul', { class: 'impact-list' }, list.slice(0, LIMIT).map(item));
        ul._analysis = { a, start: e, direction: o.direction }; // for the rows' context menu (path from the start)
        if (list.length > LIMIT) {
          ul.append(h('li', {}, h('button', { class: 'link', onclick: ev => { ev.target.closest('li').remove(); ul.append(...list.slice(LIMIT).map(item)); } }, t('Show {n} more…', { n: list.length - LIMIT }))));
        }
        return [h('div', { class: 'impact-level' }, t('Level {level} ({n})', { level: lvl, n: list.length })), ul];
      }),
    );
  };
  draw();
  return box;
}

/** "Application › Sales domain › Data Object" with clickable folders (BR-9). */
export function folderPathLinks(path) {
  if (!path?.length) return h('span', { class: 'muted' }, t('(model root)'));
  const parts = [];
  path.forEach((f, i) => {
    if (i) parts.push(h('span', { class: 'sep' }, '›'));
    parts.push(ctx(link(f.label || t('(folder)'), () => select('folder', f.id)), 'folder', f.id)); // also reveals it in the Folders branch
  });
  return h('span', { class: 'folder-path' }, parts);
}

/**
 * The folder of an element, relationship or view: a line under its name and "Show in folders" after
 * "Show in tree" (2.19.0). The API says where the item is filed (HLP-7); both stay hidden when it is
 * filed nowhere, or when the answer comes after the details have changed.
 */
export function folderLine(kind, id, signal) {
  const line = h('p', { class: 'folder-line', hidden: true });
  const button = h('button', { hidden: true, title: t('Reveal this item in the Folders branch'), onclick: () => revealInTree(kind, id, { via: 'folders' }) }, t('Show in folders'));
  state.store.folderPathOf(kind, id, { signal }).then(path => {
    if (!path || signal?.aborted) return;
    line.replaceChildren('📁 ', folderPathLinks(path));
    line.hidden = button.hidden = false;
  }).catch(e => {
    if (isAbort(e)) return;
    line.replaceChildren(errorBox(e, null, { compact: true }));
    line.hidden = false;
  });
  return { line, button };
}

// ---------------------------------------------------------------- tabs (2.19.0)

/** The tab of the details shown; it stays for the next item that has it (e.g. Impact analysis while browsing). */
let detailTab = 'properties';

/** Show the tab `id` in the details drawn next (e.g. "History" for the model's recent changes). */
export function setDetailTab(id) { detailTab = id; }

/**
 * The details below the name and the actions, in tabs: [{ id, label, content }], null entries left out.
 * `content` is the nodes of the tab, or a function that makes them when the tab is first shown (what asks
 * the API, like the impact analysis, is asked only when it is looked at). One tab gets no tab bar.
 */
export function detailTabs(tabs) {
  tabs = tabs.filter(Boolean);
  const shown = tabs.find(tab => tab.id === detailTab) || tabs[0];
  const bar = h('div', { class: 'detail-tabs', role: 'tablist', 'aria-label': t('Details') });
  const panels = h('div', {});
  const buttons = tabs.map(tab => {
    const panel = h('div', { class: 'detail-panel', role: 'tabpanel', id: `detail-panel-${tab.id}`, 'aria-labelledby': `detail-tab-${tab.id}` });
    const button = h('button', { type: 'button', role: 'tab', id: `detail-tab-${tab.id}`, 'aria-controls': panel.id, 'data-tab': tab.id }, tab.label);
    const show = () => {
      if (typeof tab.content === 'function') { fill(panel, tab.content()); tab.content = null; }
      else if (tab.content) { fill(panel, tab.content); tab.content = null; }
      for (const b of buttons) {
        const on = b === button;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', String(on));
        b.tabIndex = on ? 0 : -1;
        b._panel.hidden = !on;
      }
    };
    button._panel = panel;
    button._show = show;
    button.addEventListener('click', () => { detailTab = tab.id; show(); });
    panels.append(panel);
    return button;
  });
  bar.addEventListener('keydown', ev => {
    const i = buttons.indexOf(ev.target);
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: buttons.length - 1 }[ev.key];
    if (i < 0 || to == null) return;
    ev.preventDefault();
    const b = buttons[(to + buttons.length) % buttons.length];
    b.click();
    b.focus();
  });
  bar.append(...buttons);
  // the tabs other than the one shown are filled now unless they wait to be looked at
  tabs.forEach((tab, i) => { if (tab.content && typeof tab.content !== 'function') { fill(buttons[i]._panel, tab.content); tab.content = null; } });
  buttons[tabs.indexOf(shown)]._show();
  return tabs.length > 1 ? [bar, panels] : panels;
}

/** The History tab of an item, for those who may see the record of changes. */
function historyTab(kind, id, signal, xmiIdentifier = null) {
  return may('write') ? { id: 'history', label: t('History'), content: () => historySection(kind, id, signal, xmiIdentifier, { heading: false }) } : null;
}

/**
 * "Views" section of the details of an element or a relationship (API-4):
 * the views that show it, from one request, filled in when the answer is there.
 */
export function viewsShowingBox(kind, id, signal) {
  const box = h('div', {}, h('p', { class: 'muted' }, t('Loading…')));
  const load = async () => {
    try {
      const views = await state.store.viewsShowing(kind, id, { signal });
      if (signal?.aborted) return;
      box.replaceChildren(views.length
        ? h('ul', { class: 'rels' }, views.map(v => h('li', {}, '🖼 ', viewLink(v, () => select('view', v.id)))))
        : h('p', { class: 'muted' }, t('Not shown in any view.')));
    } catch (err) {
      if (!isAbort(err)) box.replaceChildren(errorBox(err, () => { box.replaceChildren(h('p', { class: 'muted' }, t('Loading…'))); load(); }, { compact: true }));
    }
  };
  load();
  return box;
}

export function propsTable(props) {
  if (!props?.length) return h('p', { class: 'muted' }, t('No properties.'));
  return h('table', {}, props.map(p => h('tr', {}, h('th', {}, p.propertyDefinitionName || `#${p.propertyDefinitionId}`), h('td', {}, p.value, p.lang ? h('span', { class: 'muted' }, ` [${p.lang}]`) : ''))));
}

export function kv(rows) {
  return h('table', {}, rows.filter(([, v]) => v != null && v !== '').map(([k, v]) => h('tr', {}, h('th', {}, k), h('td', {}, v))));
}

export function relList(rels, dir) {
  if (!rels.length) return h('p', { class: 'muted' }, t('None.'));
  // the row is the relationship (context menu); the other end's link is that element
  return h('ul', { class: 'rels' }, rels.map(r => ctx(h('li', {},
    h('span', { class: 'glyph', title: r.type }, relBadge(r), ' ', (dir === 'out' ? '' : '← ') + r.type + (dir === 'out' ? ' →' : '')),
    h('span', {}, dir === 'out' ? endpointLink(r.targetElementId, r.targetRelationshipId) : endpointLink(r.sourceElementId, r.sourceRelationshipId),
      r.name ? h('span', { class: 'muted' }, ` (${r.name})`) : '', ' ', ctx(link('ⓘ', () => select('relationship', r.id)), 'relationship', r.id),
      onDiagramMark(dir === 'out' ? r.targetElementId : r.sourceElementId))), 'relationship', r.id)));
}

/**
 * 2.28.0: "on diagram" after a related element that the diagram shown draws; diagram.js syncOnDiagram keeps it
 * current. 2.30.0: a click on it brings the element into view in the diagram and marks it; an element not drawn
 * has "add to diagram" instead, while a generated diagram (or none) is shown.
 */
function onDiagramMark(elementId) {
  if (elementId == null) return null;
  const shown = onDiagram(elementId);
  return h('span', { class: 'on-diagram-marks' },
    h('button', { type: 'button', class: 'on-diagram', 'data-on-diagram': elementId, hidden: !shown,
      title: t('This element is in the diagram shown: click to show it there'),
      onclick: ev => { ev.stopPropagation(); showOnDiagram(elementId); } }, t('on diagram')),
    h('button', { type: 'button', class: 'add-to-diagram', 'data-add-to-diagram': elementId, hidden: shown || !canAddToDiagram(),
      title: t('Add this element to the diagram shown'),
      onclick: ev => { ev.stopPropagation(); addToDiagram(elementId); } }, t('add to diagram')));
}

/** 2.30.0: the documentation, also when there is none (it says so). */
function docSection(text) {
  return [h('h3', {}, t('Documentation')), text ? h('div', { class: 'doc' }, text) : h('p', { class: 'muted doc-empty' }, t('No documentation.'))];
}

/**
 * Show the details of `sel`. EN-2: the requests of the previous details are
 * cancelled; a failure becomes an error box with Retry. Never rejects.
 */
export async function renderDetails(sel) {
  const signal = startJob('details');
  // EN-4: a link followed inside the details (a related element, a view) takes the focus to what it opened
  const fromDetails = $('#details').contains(document.activeElement) && document.activeElement !== $('#details');
  try {
    await detailsContent(sel, signal);
    if (fromDetails && !signal.aborted) {
      const heading = $('#details h2');
      if (heading) { heading.tabIndex = -1; heading.focus(); }
    }
  } catch (e) {
    if (isAbort(e) || signal.aborted) return;
    console.error(e);
    fill($('#details'), errorBox(e, () => renderDetails(sel)));
  }
}

export async function detailsContent(sel, signal) {
  const d = $('#details');
  const s = state.store;
  if (!s || !sel) { fill(d, h('div', { class: 'placeholder' }, t('Select an item in the tree.'))); return; }

  if (sel.kind === 'element') {
    // UP-3: the element complete, and its relationships with their other ends
    const [, rels] = await Promise.all([s.ensure({ elements: [sel.id] }, { signal }), s.relationshipsOf(sel.id, { signal })]);
    const e = s.element(sel.id);
    if (!e) { fill(d, h('p', { class: 'muted' }, t('Element #{id} not found.', { id: sel.id }))); return; }
    const folder = folderLine('element', e.id, signal);
    fill(d,
      h('div', { class: 'kind' }, typeBadge(e.type), `${prettyType(e.type)} · ${layerOf(e.type).label}`),
      h('h2', {}, e.name || h('span', { class: 'muted' }, t('(unnamed)'))),
      folder.line,
      h('div', { class: 'actions' }, actionButtons(actionContext('element', e), { replace: { 'show-in-folders': folder.button } })),
      editForm('element', e), // BR-11 (2.23.0): with ✎ Edit on
      detailTabs([
        { id: 'properties', label: t('Properties'), content: [
          docSection(e.documentation),
          h('h3', {}, t('Attributes')),
          kv([[t('ID'), e.id], [t('XMI identifier'), e.xmiIdentifier], [t('Type'), e.type]]),
          h('h3', {}, t('Properties')), propsTable(e.properties),
          h('h3', {}, t('Views')), viewsShowingBox('element', e.id, signal),
        ] },
        { id: 'relationships', label: t('Relationships ({n})', { n: rels.outgoing.length + rels.incoming.length }), content: [
          h('h3', {}, t('Outgoing relationships ({n})', { n: rels.outgoing.length })), relList(rels.outgoing, 'out'),
          h('h3', {}, t('Incoming relationships ({n})', { n: rels.incoming.length })), relList(rels.incoming, 'in'),
        ] },
        { id: 'impact', label: t('Impact analysis'), content: () => impactBox(e) },
        historyTab('element', e.id, signal, e.xmiIdentifier),
      ]),
    );
    return;
  }

  if (sel.kind === 'folder') {
    const f = s.folders?.byId.get(sel.id);
    if (!f) { fill(d, h('p', { class: 'muted' }, t('Folder #{id} not found.', { id: sel.id }))); return; }
    const c = s.folderCounts(f.id);
    const subfolders = (f.children || []).filter(isFolder);
    const direct = await s.folderItems(f.id, { signal }); // what is filed in the folder itself (BL-49)
    // HLP-7: the counts come with the folder tree; what is filed below the folder is asked for when it is needed
    const typesBox = h('div', {}, h('p', { class: 'muted' }, t('Loading…')));
    const loadTypes = async () => {
      try {
        const byType = {};
        for (const e of await s.folderElements(f.id, { signal })) byType[e.type] = (byType[e.type] || 0) + 1;
        if (signal.aborted) return;
        typesBox.replaceChildren(h('table', {}, Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([ty, n]) => h('tr', {},
          h('th', {}, typeBadge(ty), ' ', prettyType(ty)), h('td', {}, n)))));
      } catch (err) {
        if (!isAbort(err)) typesBox.replaceChildren(errorBox(err, () => { typesBox.replaceChildren(h('p', { class: 'muted' }, t('Loading…'))); loadTypes(); }, { compact: true }));
      }
    };
    fill(d,
      h('div', { class: 'kind' }, '📁 ' + t('Folder')),
      h('h2', {}, f.label || t('(folder)')),
      h('p', {}, folderPathLinks(s.folderPath(f.id).slice(0, -1))),
      h('div', { class: 'actions' }, actionButtons(actionContext('folder', f))),
      h('h3', {}, t('Contents')),
      kv([
        [t('Sub-folders'), t('{direct} direct · {total} total', { direct: subfolders.length, total: c.folders })],
        [t('Elements'), t('{direct} direct · {total} incl. sub-folders', { direct: direct.elements.length, total: c.elements })],
        [t('Relationships'), t('{direct} direct · {total} incl. sub-folders', { direct: direct.relationships.length, total: c.relationships })],
        [t('Views'), t('{direct} direct · {total} incl. sub-folders', { direct: direct.views.length, total: c.views })],
      ]),
      subfolders.length ? [h('h3', {}, t('Sub-folders')), h('ul', { class: 'rels' }, subfolders.map(sf => {
        const sc = s.folderCounts(sf.id);
        return h('li', {}, '📁 ', ctx(link(sf.label || t('(folder)'), () => select('folder', sf.id)), 'folder', sf.id),
          h('span', { class: 'muted' }, ' ' + t('{elements} el · {relationships} rel', { elements: sc.elements, relationships: sc.relationships })));
      }))] : null,
      c.elements ? [h('h3', {}, t('Element types')), typesBox] : null,
    );
    if (c.elements) loadTypes();
    return;
  }

  if (sel.kind === 'relationship') {
    // UP-3: the relationship complete, with its ends, and the relationships attached to it
    const [attached] = await Promise.all([s.attachedTo(sel.id, { signal }), s.ensure({ relationships: [sel.id] }, { signal })]);
    const r = s.relationship(sel.id);
    if (!r) { fill(d, h('p', { class: 'muted' }, t('Relationship #{id} not found.', { id: sel.id }))); return; }
    const folder = folderLine('relationship', r.id, signal);
    fill(d,
      h('div', { class: 'kind' }, relBadge(r), t('{type} relationship', { type: r.type })),
      h('h2', {}, r.name || s.relationshipLabel(r)),
      folder.line,
      h('div', { class: 'actions' }, actionButtons(actionContext('relationship', r, { attached }), { replace: { 'show-in-folders': folder.button } })),
      editForm('relationship', r),
      detailTabs([
        { id: 'properties', label: t('Properties'), content: [
          docSection(r.documentation),
          h('h3', {}, t('Endpoints')),
          h('table', {},
            h('tr', {}, h('th', {}, t('Source')), h('td', {}, endpointLink(r.sourceElementId, r.sourceRelationshipId), onDiagramMark(r.sourceElementId))),
            h('tr', {}, h('th', {}, t('Target')), h('td', {}, endpointLink(r.targetElementId, r.targetRelationshipId), onDiagramMark(r.targetElementId)))),
          h('h3', {}, t('Attributes')),
          kv([[t('ID'), r.id], [t('XMI identifier'), r.xmiIdentifier], [t('Type'), r.type], [t('Access type'), r.accessType], [t('Influence modifier'), r.influenceModifier], [t('Directed'), r.isDirected == null ? null : String(r.isDirected)]]),
          h('h3', {}, t('Properties')), propsTable(r.properties),
          h('h3', {}, t('Views')), viewsShowingBox('relationship', r.id, signal),
        ] },
        { id: 'relationships', label: t('Relationships ({n})', { n: attached.length }), content: [
          h('h3', {}, t('Relationships attached to this relationship ({n})', { n: attached.length })),
          attached.length ? h('ul', { class: 'rels' }, attached.map(a => {
            const otherIsSource = a.targetRelationshipId === r.id;
            return ctx(h('li', {},
              h('span', { class: 'glyph', title: a.type }, relBadge(a), ' ', otherIsSource ? `← ${a.type}` : `${a.type} →`),
              h('span', {}, otherIsSource ? endpointLink(a.sourceElementId, a.sourceRelationshipId) : endpointLink(a.targetElementId, a.targetRelationshipId),
                a.name ? h('span', { class: 'muted' }, ` (${a.name})`) : '', ' ', ctx(link('ⓘ', () => select('relationship', a.id)), 'relationship', a.id))), 'relationship', a.id);
          })) : h('p', { class: 'muted' }, t('None.')),
        ] },
        historyTab('relationship', r.id, signal, r.xmiIdentifier),
      ]),
    );
    return;
  }

  if (sel.kind === 'view') {
    const v = s.view(sel.id);
    if (!v) { fill(d, h('p', { class: 'muted' }, t('View #{id} not found.', { id: sel.id }))); return; }
    // BR-8, API-10: the drill-down links from this view and to it, from one request
    const linksBox = h('div', {}, h('p', { class: 'muted' }, t('Loading…')));
    const linkedFromBox = h('div', {}, h('p', { class: 'muted' }, t('Loading…')));
    const created = isCreated(v); // BR-25: made through the API, not filed in the source's folders
    const folder = created ? { line: null, button: null } : folderLine('view', v.id, signal);
    fill(d,
      h('div', { class: 'kind' }, isRecipe(v) ? '📜 ' + t('Recipe') : created ? '✎ ' + t('Created view') : '🖼 ' + t('View')),
      h('h2', {}, v.name),
      h('p', { class: 'muted origin' }, originText(v)),
      folder.line,
      lostBox(v),
      h('div', { class: 'actions' }, actionButtons(actionContext('view', v, { open: { label: t('Show view'), run: () => showView(v.id) } }), { replace: { 'show-in-folders': folder.button } })),
      detailTabs([
        { id: 'properties', label: t('Properties'), content: [
          docSection(v.documentation),
          h('h3', {}, t('Attributes')),
          kv([[t('ID'), v.id], [t('XMI identifier'), v.xmiIdentifier], [t('Type'), v.type], [t('Viewpoint'), v.viewpoint], [t('Viewpoint ref'), v.viewpointRef],
            [t('Recipe'), isRecipe(v) ? h('code', { class: 'recipe' }, v.recipe) : null],
            // 2.31.0: who made a created view or recipe, and when
            [t('Created by'), created ? v.createdBy || t('(unknown)') : null],
            [t('Created on'), created && v.createdAt ? new Date(v.createdAt + (v.createdAt.endsWith('Z') ? '' : 'Z')).toLocaleString() : null]]),
          h('h3', {}, t('Properties')), propsTable(v.properties),
          h('h3', {}, t('Links to views')), linksBox,
          h('h3', {}, t('Linked from')), linkedFromBox,
        ] },
        historyTab('view', v.id, signal, v.xmiIdentifier),
      ]),
    );
    const loadLinks = async () => {
      try {
        const { outgoing, incoming } = await s.viewLinks(v.id, { signal });
        if (signal.aborted) return;
        const open = id => (state.diagramDef?.kind === 'view' && state.diagramDef.id === v.id ? drillToView(id) : select('view', id, { fromTree: true }));
        linksBox.replaceChildren(outgoing.length
          ? h('ul', { class: 'rels' }, outgoing.map(l => h('li', {}, '↗ ',
            ctx(link(l.targetViewName || `#${l.targetViewId}`, () => open(l.targetViewId)), 'view', l.targetViewId),
            l.label && l.label !== l.targetViewName ? h('span', { class: 'muted' }, ` (“${l.label}”)`) : '')))
          : h('p', { class: 'muted' }, t('This view has no drill-down links.')));
        // a view that links here several times is listed once
        const from = [...new Map(incoming.map(l => [l.sourceViewId, l])).values()];
        linkedFromBox.replaceChildren(from.length
          ? h('ul', { class: 'rels' }, from.map(l => h('li', {}, '↙ ', viewLink(s.view(l.sourceViewId) || { id: l.sourceViewId, name: l.sourceViewName }, () => select('view', l.sourceViewId, { fromTree: true })))))
          : h('p', { class: 'muted' }, t('No view links here.')));
      } catch (e) {
        if (isAbort(e)) return;
        linkedFromBox.replaceChildren();
        linksBox.replaceChildren(errorBox(e, () => { linksBox.replaceChildren(h('p', { class: 'muted' }, t('Loading…'))); loadLinks(); }, { compact: true }));
      }
    };
    loadLinks();
    return;
  }

  if (sel.kind === 'model') {
    const m = s.model;
    const box = h('div', {}, h('p', { class: 'muted' }, t('Loading…')));
    fill(d,
      h('div', { class: 'kind' }, '🗂 ' + t('Model')),
      h('h2', {}, m.name),
      h('div', { class: 'actions' }, actionButtons(actionContext('model', m))), // 2.30.0: Rename model…
      detailTabs([
        { id: 'properties', label: t('Properties'), content: [
          docSection(m.documentation),
          h('h3', {}, t('Attributes')),
          kv([[t('ID'), m.id], [t('XMI identifier'), m.xmiIdentifier], [t('Version'), m.version], [t('Master'), masterText(m)], [t('Elements'), s.stats.elements.total], [t('Relationships'), s.stats.relationships.total], [t('Views'), s.stats.views.total]]),
          state.link ? [h('h3', {}, t('Linked file')), linkStateList(state.link), h('div', { class: 'actions' },
            may('write') ? h('button', { onclick: () => updateFromLink() }, t('Update from file')) : null,
            h('button', { onclick: () => openLinkDialog('model') }, t('Linked file…')))] : null,
          h('h3', {}, t('Elements per layer')),
          h('table', {}, LAYERS.map(l => [l, s.stats.elements.byLayer[l.api] ?? 0]).filter(([, n]) => n)
            .map(([l, n]) => h('tr', {}, h('th', {}, h('span', { class: 'badge', style: `background:${l.color}` }, l.label.slice(0, 4)), ' ', l.label), h('td', {}, n)))),
          box,
        ] },
        historyTab('model', null, signal),
      ]),
    );
    const loadMore = async () => {
      try {
        const [props, meta] = await Promise.all([api.modelProperties(s.id, { signal }), api.metadata(s.id, { signal })]);
        box.replaceChildren(h('h3', {}, t('Model properties')), propsTable(props), h('h3', {}, t('Metadata')), metadataBlock(meta));
      } catch (e) {
        if (!isAbort(e)) box.replaceChildren(errorBox(e, () => { box.replaceChildren(h('p', { class: 'muted' }, t('Loading…'))); loadMore(); }, { compact: true }));
      }
    };
    await loadMore();
    return;
  }

  if (sel.kind === 'type') {
    const list = await s.elementsOfType(sel.type, { signal });
    fill(d, 
      h('div', { class: 'kind' }, typeBadge(sel.type), t('Element type · {layer}', { layer: layerOf(sel.type).label })),
      h('h2', {}, prettyType(sel.type)),
      h('p', {}, t('{n} element(s).', { n: list.length })),
      h('div', { class: 'actions' }, actionButtons(actionContext('type', { type: sel.type }, { ids: list.map(e => e.id) }))),
    );
    return;
  }

  if (sel.kind === 'layer') {
    const layer = LAYERS.find(l => l.key === sel.key);
    if (!layer) return;
    const ids = await layerElementIds(layer.key, { signal });
    fill(d,
      h('div', { class: 'kind' }, h('span', { class: 'badge', style: `background:${layer.color}` }, layer.label.slice(0, 4)), ' ' + t('Layer')),
      h('h2', {}, layer.label),
      h('p', {}, t('{n} element(s).', { n: ids.length })),
      h('div', { class: 'actions' }, actionButtons(actionContext('layer', { key: layer.key }, { ids }))),
      h('h3', {}, t('Element types')),
      h('table', {}, typesOfLayer(layer.key).map(ty => [ty, s.stats.elements.byType[ty] ?? 0]).filter(([, n]) => n)
        .map(([ty, n]) => h('tr', {}, h('th', {}, typeBadge(ty), ' ', link(prettyType(ty), () => selectType(ty))), h('td', {}, n)))),
    );
    return;
  }

  if (sel.kind === 'reltype') {
    const rels = await relTypeList(sel.type, { signal });
    const ends = await relTypeEndIds(sel.type, { signal });
    const name = sel.type === '@rel' ? t('Relationships connected to relationships') : t('{type} relationships', { type: sel.type });
    fill(d,
      h('div', { class: 'kind' }, sel.type === '@rel' ? '⤷' : relBadge(sel.type), ' ' + t('Relationship type')),
      h('h2', {}, name),
      h('p', {}, t('{n} relationship(s) between {m} element(s).', { n: rels.length, m: ends.length })),
      h('div', { class: 'actions' }, actionButtons(actionContext('reltype', { type: sel.type }, { rels, ends }))),
    );
    return;
  }

  if (sel.kind === 'propdefs') {
    fill(d, h('div', { class: 'placeholder' }, t('Loading…')));
    const defs = await api.propertyDefinitions(s.id, { signal });
    fill(d, h('div', { class: 'kind' }, '🏷 ' + t('Property definitions')), h('h2', {}, t('{n} definitions', { n: defs.length })),
      h('table', {}, h('tr', {}, h('th', {}, t('Name')), h('td', {}, h('strong', {}, t('Data type · XMI id'))), h('td', {}, h('strong', {}, t('Elements')))),
        defs.map(p => {
          const name = p.name || p.xmiIdentifier;
          return h('tr', {}, h('th', {}, link(name, () => selectInfo({ kind: 'property', name }))),
            h('td', {}, `${p.dataType} · ${p.xmiIdentifier}`), h('td', {}, String(s.propertyIndex.get(name)?.count ?? 0)));
        })));
    return;
  }

  if (sel.kind === 'property') {
    fill(d, h('div', { class: 'placeholder' }, t('Loading…')));
    const name = sel.name;
    const def = (await api.propertyDefinitions(s.id, { signal })).find(p => (p.name || p.xmiIdentifier) === name);
    const used = s.propertyIndex.get(name);
    const values = [...(used?.valueCounts ?? [])];
    fill(d,
      h('div', { class: 'kind' }, '🏷 ' + t('Property')),
      h('h2', {}, name),
      h('div', { class: 'actions' }, actionButtons(actionContext('property', { name }))),
      h('h3', {}, t('Attributes')),
      kv([[t('Data type'), def?.dataType], [t('XMI identifier'), def?.xmiIdentifier],
        [t('Elements with it'), used?.count ?? 0], [t('Different values'), used?.distinctValues ?? 0],
        [t('Languages'), used?.langs.size ? [...used.langs].join(', ') : null]]),
      values.length ? [
        h('h3', {}, t('Values')),
        h('p', { class: 'muted' }, t('Click a value to find the items that have it; right-click it in the tree to filter diagrams by it.')),
        h('table', {}, values.map(([value, n]) => h('tr', {},
          h('th', {}, link(value === '' ? t('(empty)') : value, () => findWithProperty(name, value))), h('td', {}, String(n))))),
        used.distinctValues > values.length ? h('p', { class: 'muted' }, t('… and {n} more values', { n: used.distinctValues - values.length })) : null,
      ] : h('p', { class: 'muted' }, t('No element has this property.')),
    );
    return;
  }

  if (sel.kind === 'metadata') {
    fill(d, h('div', { class: 'placeholder' }, t('Loading…')));
    const meta = await api.metadata(s.id, { signal });
    fill(d, h('div', { class: 'kind' }, 'ℹ ' + t('Metadata')), h('h2', {}, t('Model metadata')), metadataBlock(meta));
  }
}

export function metadataBlock(meta) {
  if (!meta?.length) return h('p', { class: 'muted' }, t('No metadata blocks.'));
  return h('div', {}, meta.flatMap(b => [h('p', {}, h('strong', {}, b.schemaName || 'schemaInfo'), b.schemaVersion ? ` ${b.schemaVersion}` : ''), h('pre', {}, b.content)]));
}
