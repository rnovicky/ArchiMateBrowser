// Diagram filters (BR-3): which element and relationship types appear in
// generated diagrams (neighbourhood, basket, element type). Stored views keep
// what they show and where; what does not pass is drawn faint there.

import { LAYERS, ELEMENT_TYPES, RELATIONSHIP_TYPES, typesOfLayer, prettyType, elementColor, spriteUrl } from './archimate.js';
import { t as tr } from './i18n.js'; // `t` names a type in the loops below

/** Sprite on a small chip in the type's layer colour (relationships: light grey). */
function sprite(type) {
  const src = spriteUrl(type);
  if (!src) return null;
  const bg = ELEMENT_TYPES.includes(type) ? elementColor(type) : '#f1f3f5';
  return h('span', { class: 'sprite-chip', style: `background:${bg}` }, h('img', { class: 'sprite', src, alt: '' }));
}

const ALL_REL = RELATIONSHIP_TYPES;
const CONNECTORS = ['Grouping', 'Location', 'AndJunction', 'OrJunction'];
const layer = key => typesOfLayer(key);

/**
 * Viewpoint presets, simplified from the ArchiMate 3.1 basic viewpoints
 * (element sets only approximate the specification's tables).
 */
export const VIEWPOINTS = {
  all: { label: tr('All (no filter)'), elements: ELEMENT_TYPES, relationships: ALL_REL }, // the others are ArchiMate viewpoint names
  organization: {
    label: 'Organization',
    elements: ['BusinessActor', 'BusinessRole', 'BusinessCollaboration', 'BusinessInterface', ...CONNECTORS],
    relationships: ALL_REL,
  },
  businessProcessCooperation: {
    label: 'Business Process Cooperation',
    elements: [...layer('business'), 'ApplicationComponent', 'ApplicationService', 'ApplicationInterface', 'ApplicationProcess', 'DataObject', ...CONNECTORS],
    relationships: ALL_REL,
  },
  applicationCooperation: {
    label: 'Application Cooperation',
    elements: [...layer('application'), ...CONNECTORS],
    relationships: ALL_REL,
  },
  applicationUsage: {
    label: 'Application Usage',
    elements: [
      'BusinessActor', 'BusinessRole', 'BusinessCollaboration', 'BusinessProcess', 'BusinessFunction', 'BusinessInteraction', 'BusinessEvent', 'BusinessObject',
      'ApplicationComponent', 'ApplicationCollaboration', 'ApplicationInterface', 'ApplicationProcess', 'ApplicationFunction', 'ApplicationInteraction', 'ApplicationEvent', 'ApplicationService', 'DataObject',
      ...CONNECTORS,
    ],
    relationships: ALL_REL,
  },
  technologyUsage: {
    label: 'Technology Usage',
    elements: [
      'BusinessProcess', 'BusinessFunction', 'BusinessInteraction', 'BusinessEvent',
      'ApplicationComponent', 'ApplicationProcess', 'ApplicationFunction', 'ApplicationInteraction', 'ApplicationEvent', 'DataObject',
      ...layer('technology'), ...CONNECTORS,
    ],
    relationships: ALL_REL,
  },
  layered: {
    label: 'Layered (core layers)',
    elements: [...layer('business'), ...layer('application'), ...layer('technology'), ...layer('physical'), ...CONNECTORS],
    relationships: ALL_REL,
  },
  informationStructure: {
    label: 'Information Structure',
    elements: ['BusinessObject', 'Contract', 'Representation', 'DataObject', 'Artifact', 'Meaning', 'Grouping', 'AndJunction', 'OrJunction'],
    relationships: ['Composition', 'Aggregation', 'Realization', 'Specialization', 'Association', 'Access'],
  },
  motivation: {
    label: 'Motivation',
    elements: [...layer('motivation'), 'BusinessActor', 'BusinessRole', ...CONNECTORS],
    relationships: ['Composition', 'Aggregation', 'Realization', 'Influence', 'Association', 'Specialization'],
  },
  strategy: {
    label: 'Strategy',
    elements: [...layer('strategy'), 'Outcome', ...CONNECTORS],
    relationships: ALL_REL,
  },
  implementationMigration: {
    label: 'Implementation & Migration',
    elements: [...layer('implementation'), 'BusinessActor', 'BusinessRole', 'Location', 'Grouping', 'AndJunction', 'OrJunction'],
    relationships: ALL_REL,
  },
};

/** A hide rule's end that is a relationship, not an element. */
export const REL_END = 'Relationship';

export class DiagramFilter {
  /**
   * `hidden` (2.17.0): hide rules, [{ type, source, target }], each a relationship type and the element types
   * of its ends (REL_END: a relationship), null for any; a relationship that matches one is left out.
   */
  constructor(elements = ELEMENT_TYPES, relationships = ALL_REL, hidden = []) {
    this.elementTypes = new Set(elements);
    this.relTypes = new Set(relationships);
    this.hidden = hidden.map(r => ({ type: r.type || null, source: r.source || null, target: r.target || null }));
  }

  /** A copy to change. */
  copy() { return new DiagramFilter([...this.elementTypes], [...this.relTypes], this.hidden); }

  /** The filter with one more hide rule (none when it has it already). */
  withRule(rule) {
    const f = this.copy();
    if (!f.hidden.some(r => sameRule(r, rule))) f.hidden.push({ type: rule.type || null, source: rule.source || null, target: rule.target || null });
    return f;
  }

  static fromViewpoint(key) {
    const vp = VIEWPOINTS[key] || VIEWPOINTS.all;
    return new DiagramFilter(vp.elements, vp.relationships);
  }

  elementOk = el => this.elementTypes.has(el.type);
  /** `typeOf(elementId)`: the type of an end, for the hide rules (without it they are not checked). */
  relOk = (rel, typeOf = null) => this.relTypes.has(rel.type) && !(typeOf && this.hidden.some(r => ruleHides(r, rel, typeOf)));

  isDefault() {
    return this.elementTypes.size === ELEMENT_TYPES.length && this.relTypes.size === ALL_REL.length && !this.hidden.length;
  }

  hiddenCount() {
    return (ELEMENT_TYPES.length - this.elementTypes.size) + (ALL_REL.length - this.relTypes.size) + this.hidden.length;
  }

  /** Key of the viewpoint preset this filter equals, or null (custom). */
  matchingViewpoint() {
    if (this.hidden.length) return null;
    const same = (set, list) => set.size === new Set(list).size && list.every(t => set.has(t));
    return Object.keys(VIEWPOINTS).find(k => same(this.elementTypes, VIEWPOINTS[k].elements) && same(this.relTypes, VIEWPOINTS[k].relationships)) || null;
  }

  /**
   * Compact, URL-safe encoding: '' for no filter, 'vp:<key>' for a preset,
   * otherwise per kind the shorter of the shown ('ie'/'ir') or hidden
   * ('xe'/'xr') type lists, e.g. 'ie:ApplicationComponent.DataObject~xr:Flow'.
   */
  encode() {
    if (this.isDefault()) return '';
    const vp = this.matchingViewpoint();
    if (vp) return `vp:${vp}`;
    const part = (all, set, inc, exc) => {
      const shown = all.filter(t => set.has(t)), hidden = all.filter(t => !set.has(t));
      if (!hidden.length) return null;
      return shown.length < hidden.length ? `${inc}:${shown.join('.')}` : `${exc}:${hidden.join('.')}`;
    };
    // hide rules: 'hr:Flow-Node-Node.*-ApplicationService-*' ('*' for any)
    const rules = this.hidden.length ? `hr:${this.hidden.map(r => [r.type, r.source, r.target].map(x => x || '*').join('-')).join('.')}` : null;
    return [part(ELEMENT_TYPES, this.elementTypes, 'ie', 'xe'), part(ALL_REL, this.relTypes, 'ir', 'xr'), rules].filter(Boolean).join('~');
  }

  static decode(str) {
    if (!str) return new DiagramFilter();
    if (str.startsWith('vp:')) return DiagramFilter.fromViewpoint(str.slice(3));
    const f = new DiagramFilter();
    for (const part of str.split('~')) {
      const [kind, list = ''] = part.split(':');
      const types = list ? list.split('.') : [];
      if (kind === 'ie') f.elementTypes = new Set(types.filter(t => ELEMENT_TYPES.includes(t)));
      if (kind === 'ir') f.relTypes = new Set(types.filter(t => ALL_REL.includes(t)));
      if (kind === 'xe') types.forEach(t => f.elementTypes.delete(t));
      if (kind === 'xr') types.forEach(t => f.relTypes.delete(t));
      if (kind === 'hr') {
        const end = x => (x === REL_END || ELEMENT_TYPES.includes(x) ? x : null);
        for (const code of types) {
          const [type, source, target] = code.split('-').map(x => (x === '*' ? null : x));
          const rule = { type: ALL_REL.includes(type) ? type : null, source: end(source), target: end(target) };
          if (rule.type || rule.source || rule.target) f.hidden.push(rule);
        }
      }
    }
    return f;
  }
}

const sameRule = (a, b) => (a.type || null) === (b.type || null) && (a.source || null) === (b.source || null) && (a.target || null) === (b.target || null);

function endIs(wanted, elementId, relationshipId, typeOf) {
  if (!wanted) return true;
  if (wanted === REL_END) return relationshipId != null;
  return elementId != null && typeOf(elementId) === wanted;
}

function ruleHides(rule, rel, typeOf) {
  return (!rule.type || rel.type === rule.type)
    && endIs(rule.source, rel.sourceElementId, rel.sourceRelationshipId, typeOf)
    && endIs(rule.target, rel.targetElementId, rel.targetRelationshipId, typeOf);
}

/** A hide rule as text: "Flow: Node → Node", "any: Application Service → any". */
export function ruleText(rule) {
  const end = x => (!x ? tr('any') : x === REL_END ? tr('a relationship') : prettyType(x));
  return `${rule.type || tr('any')}: ${end(rule.source)} → ${end(rule.target)}`;
}

// ------------------------------------------------------------------ panel UI

/**
 * 2.17.0: the hide rules: one chip per rule (× removes it) and three lists to make one, a relationship type
 * and the element types of its source and target, each "any" by default.
 */
function hideRulesRow(f, clone, commit) {
  const select = (label, options) => h('select', { 'aria-label': label },
    h('option', { value: '' }, tr('any')), options);
  const endOptions = () => [
    h('option', { value: REL_END }, tr('a relationship')),
    LAYERS.map(l => h('optgroup', { label: l.label }, typesOfLayer(l.key).map(t => h('option', { value: t }, prettyType(t))))),
  ];
  const type = select(tr('Relationship type'), RELATIONSHIP_TYPES.map(t => h('option', { value: t }, t)));
  const source = select(tr('Source element type'), endOptions());
  const target = select(tr('Target element type'), endOptions());
  const add = h('button', {
    type: 'button',
    onclick: () => {
      const rule = { type: type.value || null, source: source.value || null, target: target.value || null };
      if (rule.type || rule.source || rule.target) commit(f.withRule(rule));
    },
  }, tr('Hide'));
  const chips = f.hidden.map((rule, i) => h('span', { class: 'chip rule', 'data-filter': `rule:${i}` }, ruleText(rule),
    h('button', {
      type: 'button', class: 'link', title: tr('Show them again'), 'aria-label': tr('Remove the rule {rule}', { rule: ruleText(rule) }),
      onclick: () => { const nf = clone(); nf.hidden.splice(i, 1); commit(nf); },
    }, '×')));
  return h('div', { class: 'filter-row filter-rules' },
    h('strong', { title: tr('Relationships of a type between elements of given types, e.g. Flow from Node to Node') }, tr('Hide relationships')),
    chips, type, h('span', {}, tr('from')), source, h('span', {}, tr('to')), target, add);
}

function h(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k in e && typeof v === 'boolean') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  // flat to any depth: the hide rules' lists nest the layers' groups (2.19.0: only "any" was left of them)
  for (const c of children.flat(Infinity)) if (c != null && c !== false) e.append(c instanceof Node ? c : String(c));
  return e;
}

/**
 * Renders the filter editor into `container`. `getFilter()` returns the
 * current DiagramFilter; `onChange(filter)` is called after every edit.
 * `saved()` lists the user's saved filters ({name, code}, CM-7), offered after the presets.
 * Chips carry `data-filter` ("layer:<key>", "el:<type>", "rel:<type>", "viewpoint")
 * for the app's context menu.
 */
export function renderFilterPanel(container, getFilter, onChange, { saved = () => [] } = {}) {
  const draw = () => {
    const f = getFilter();
    const vp = f.matchingViewpoint();
    const typesOpen = !!container.querySelector('details.filter-types')?.open;
    const commit = nf => { onChange(nf); draw(); };
    const clone = () => f.copy();
    const mine = saved();
    const code = f.encode();
    const savedIdx = vp ? -1 : mine.findIndex(s => s.code === code);

    const preset = h('select', {
      'aria-label': tr('Viewpoint preset'), 'data-filter': 'viewpoint', title: tr('Right-click for saved filters'),
      onchange: e => {
        const v = e.target.value;
        if (v.startsWith('saved:')) { const s = mine[Number(v.slice(6))]; if (s) commit(DiagramFilter.decode(s.code)); } else if (v) commit(DiagramFilter.fromViewpoint(v));
      },
    },
    vp || savedIdx >= 0 ? null : h('option', { value: '', selected: true }, tr('Custom')),
    Object.entries(VIEWPOINTS).map(([k, v]) => h('option', { value: k, selected: k === vp }, v.label)),
    mine.length ? h('optgroup', { label: tr('Saved filters') },
      mine.map((s, i) => h('option', { value: `saved:${i}`, selected: i === savedIdx }, s.name))) : null);

    const layerChips = LAYERS.map(l => {
      const types = typesOfLayer(l.key);
      const on = types.filter(t => f.elementTypes.has(t)).length;
      const cb = h('input', {
        type: 'checkbox', checked: on === types.length,
        onchange: e => { const nf = clone(); for (const t of types) e.target.checked ? nf.elementTypes.add(t) : nf.elementTypes.delete(t); commit(nf); },
      });
      cb.indeterminate = on > 0 && on < types.length;
      return h('label', { class: 'chip', title: tr('{on}/{total} types shown; right-click for “only this”', { on, total: types.length }), 'data-filter': `layer:${l.key}` },
        cb, h('span', { class: 'swatch', style: `background:${l.color}` }), l.label);
    });

    // 2.28.0: all / none for the types of one layer
    const layerTypes = (key, on) => () => {
      const nf = clone();
      for (const t of typesOfLayer(key)) on ? nf.elementTypes.add(t) : nf.elementTypes.delete(t);
      commit(nf);
    };
    const typeGroups = LAYERS.map(l => h('fieldset', { 'data-filter-group': l.key },
      h('legend', {}, l.label, ' ',
        h('button', { type: 'button', class: 'link', 'data-group-all': l.key, title: tr('Show every type of this layer'), onclick: layerTypes(l.key, true) }, tr('all')),
        ' / ',
        h('button', { type: 'button', class: 'link', 'data-group-none': l.key, title: tr('Show no type of this layer'), onclick: layerTypes(l.key, false) }, tr('none'))),
      typesOfLayer(l.key).map(t => h('label', { class: 'chip small', 'data-filter': `el:${t}` },
        h('input', { type: 'checkbox', checked: f.elementTypes.has(t), onchange: e => { const nf = clone(); e.target.checked ? nf.elementTypes.add(t) : nf.elementTypes.delete(t); commit(nf); } }),
        sprite(t) || h('span', { class: 'swatch', style: `background:${elementColor(t)}` }), prettyType(t)))));

    const relChips = RELATIONSHIP_TYPES.map(t => h('label', { class: 'chip', 'data-filter': `rel:${t}` },
      h('input', { type: 'checkbox', checked: f.relTypes.has(t), onchange: e => { const nf = clone(); e.target.checked ? nf.relTypes.add(t) : nf.relTypes.delete(t); commit(nf); } }),
      sprite(t), t));

    const all = (what, on) => () => {
      const nf = clone();
      if (what === 'el') nf.elementTypes = new Set(on ? ELEMENT_TYPES : []);
      else nf.relTypes = new Set(on ? RELATIONSHIP_TYPES : []);
      commit(nf);
    };

    container.replaceChildren(
      h('div', { class: 'filter-row' },
        h('strong', { 'data-filter': 'viewpoint' }, tr('Viewpoint')), preset,
        h('button', { type: 'button', onclick: () => commit(new DiagramFilter()), disabled: f.isDefault() }, tr('Reset')),
        h('span', { class: 'muted' }, tr('Applies to neighbourhood, basket and type diagrams; focus elements are always shown.'))),
      h('div', { class: 'filter-row' },
        h('strong', {}, tr('Layers')), layerChips,
        h('button', { type: 'button', class: 'link', onclick: all('el', true) }, tr('all')),
        h('button', { type: 'button', class: 'link', onclick: all('el', false) }, tr('none'))),
      h('details', { class: 'filter-types', open: typesOpen }, h('summary', {}, tr('Element types ({on}/{total})', { on: f.elementTypes.size, total: ELEMENT_TYPES.length })),
        h('div', { class: 'filter-type-grid' }, typeGroups)),
      h('div', { class: 'filter-row' },
        h('strong', {}, tr('Relationships')), relChips,
        h('button', { type: 'button', class: 'link', onclick: all('rel', true) }, tr('all')),
        h('button', { type: 'button', class: 'link', onclick: all('rel', false) }, tr('none'))),
      hideRulesRow(f, clone, commit),
    );
  };
  draw();
  return { redraw: draw };
}
