// Property-aware display options (BR-7): show a property in diagram labels,
// colour elements by a property value (with legend), filter elements by a
// property, and pick the preferred language of multi-language values.

import { t } from './i18n.js';

/** Legend text for elements without the property (compare legend entries with this, not with a literal). */
export const NOT_SET = t('(not set)');

/**
 * Value of the named property on an item (element/relationship/view), or
 * undefined. With several values (multi-language) the preferred `lang` wins,
 * then a value without lang, then the first one.
 */
export function propertyValue(item, name, lang = '') {
  const vals = (item?.properties || []).filter(p => p.propertyDefinitionName === name);
  if (!vals.length) return undefined;
  return (vals.find(p => lang && p.lang === lang) || vals.find(p => !p.lang) || vals[0]).value;
}

/**
 * The API's index of the properties in use (GET …/properties/index, HLP-9) as
 * the panel wants it: name -> { count, values: Set, langs: Set, valueCounts, distinctValues }, by name.
 * `valueCounts`: value -> how many elements have it, most frequent first (the API's order);
 * `distinctValues` may be more than the values listed, when the API cut the list.
 */
export function propertyIndexFrom(entries) {
  return new Map((entries || []).map(e => [e.name, {
    count: e.count,
    values: new Set(e.values.map(v => v.value)),
    langs: new Set(e.langs),
    valueCounts: new Map(e.values.map(v => [v.value, v.count])),
    distinctValues: e.distinctValues ?? e.values.length,
  }]));
}

// `api`: the `propertyOp` of the API's lists and search that means the same
export const FILTER_OPS = {
  has: { label: t('is set'), needsValue: false, api: 'exists' },
  missing: { label: t('is not set'), needsValue: false, api: 'missing' },
  eq: { label: t('equals'), needsValue: true, api: 'eq' },
  contains: { label: t('contains'), needsValue: true, api: 'contains' },
  ne: { label: t('does not equal'), needsValue: true, api: 'ne' },
};

// Light, distinguishable fills that keep black text readable.
const PALETTE = ['#8ecae6', '#ffd166', '#95d5b2', '#f4a6a6', '#cdb4db', '#f9c74f', '#a3c4f3', '#ffb4a2', '#b5e48c', '#e9c46a', '#90dbf4', '#f1c0e8'];
const MISSING = '#e6e6e6';

/** Colour mapping for a set of values: categorical, or a light→orange ramp when all are numeric. */
export function colourScale(values) {
  const distinct = [...new Set(values.filter(v => v !== undefined && v !== ''))];
  const numeric = distinct.length > 1 && distinct.every(v => v.trim() !== '' && !isNaN(Number(v)));
  const map = new Map();
  if (numeric) {
    const nums = distinct.map(Number);
    const min = Math.min(...nums), max = Math.max(...nums);
    const lerp = (a, b, t) => Math.round(a + (b - a) * t);
    for (const v of distinct) {
      const t = max === min ? 1 : (Number(v) - min) / (max - min);
      // #fff5eb -> #fd8d3c
      map.set(v, `#${[lerp(0xff, 0xfd, t), lerp(0xf5, 0x8d, t), lerp(0xeb, 0x3c, t)].map(c => c.toString(16).padStart(2, '0')).join('')}`);
    }
    distinct.sort((a, b) => Number(a) - Number(b));
  } else {
    distinct.sort((a, b) => a.localeCompare(b));
    distinct.forEach((v, i) => map.set(v, PALETTE[i % PALETTE.length]));
  }
  const legend = distinct.map(v => [map.get(v), v]);
  if (values.some(v => v === undefined || v === '')) legend.push([MISSING, NOT_SET]);
  return { colour: v => (v === undefined || v === '' ? MISSING : map.get(v)), legend, numeric, reused: !numeric && distinct.length > PALETTE.length };
}

export class PropertyOptions {
  constructor({ label = '', colour = '', filterName = '', filterOp = 'has', filterValue = '', lang = '' } = {}) {
    Object.assign(this, { label, colour, filterName, filterOp, filterValue, lang });
  }

  isDefault() { return !this.label && !this.colour && !this.filterName && !this.lang; }
  hasFilter() { return !!this.filterName; }

  /** Does the element pass the property filter? */
  elementOk = el => {
    if (!this.filterName) return true;
    const v = propertyValue(el, this.filterName, this.lang);
    const want = this.filterValue.toLowerCase();
    switch (this.filterOp) {
      case 'missing': return v === undefined;
      case 'eq': return v !== undefined && v.toLowerCase() === want;
      case 'contains': return v !== undefined && v.toLowerCase().includes(want);
      case 'ne': return v === undefined || v.toLowerCase() !== want;
      default: return v !== undefined;
    }
  };

  describeFilter() {
    if (!this.filterName) return '';
    const op = FILTER_OPS[this.filterOp] || FILTER_OPS.has;
    return `${this.filterName} ${op.label}${op.needsValue ? ` “${this.filterValue}”` : ''}`;
  }

  /**
   * Decoration hooks for the diagram generators, computed for the items about
   * to be drawn: extra label line, fill colour, legend.
   */
  decorate(items) {
    const d = { extraLabel: null, colour: null, legend: null, legendTitle: null, reused: false };
    if (this.label) {
      d.extraLabel = el => {
        const v = propertyValue(el, this.label, this.lang);
        return v === undefined ? null : `${this.label}: ${v}`;
      };
    }
    if (this.colour) {
      const scale = colourScale(items.map(el => propertyValue(el, this.colour, this.lang)));
      d.colour = el => scale.colour(propertyValue(el, this.colour, this.lang));
      d.legend = scale.legend;
      d.legendTitle = this.colour;
      d.reused = scale.reused;
    }
    return d;
  }

  /** URL encoding: 'l:<name>~c:<name>~f:<name>.<op>.<value>~g:<lang>' (each part URI-encoded). */
  encode() {
    // '.' separates name/op/value and '~' the parts; encodeURIComponent leaves both as they are
    const e = s => encodeURIComponent(s).replace(/\./g, '%2E').replace(/~/g, '%7E');
    const parts = [];
    if (this.label) parts.push(`l:${e(this.label)}`);
    if (this.colour) parts.push(`c:${e(this.colour)}`);
    if (this.filterName) parts.push(`f:${e(this.filterName)}.${this.filterOp}.${e(this.filterValue)}`);
    if (this.lang) parts.push(`g:${e(this.lang)}`);
    return parts.join('~');
  }

  static decode(str) {
    const o = new PropertyOptions();
    const d = s => { try { return decodeURIComponent(s); } catch { return s; } };
    for (const part of (str || '').split('~')) {
      const i = part.indexOf(':');
      if (i < 0) continue;
      const k = part.slice(0, i), v = part.slice(i + 1);
      if (k === 'l') o.label = d(v);
      if (k === 'c') o.colour = d(v);
      if (k === 'g') o.lang = d(v);
      if (k === 'f') {
        const [name, op, ...rest] = v.split('.');
        o.filterName = d(name);
        o.filterOp = FILTER_OPS[op] ? op : 'has';
        o.filterValue = d(rest.join('.'));
      }
    }
    return o;
  }
}

/**
 * The syntax of a property search: "@name" (is set), "@name=value" (equals),
 * "@name~text" (contains), "@name!" (not set). Returns null if `q` is not a
 * property query. The API does the searching (see searchParams()).
 */
export function parsePropertyQuery(q) {
  const m = /^@\s*([^=~!]+?)\s*(?:(=|~)\s*(.*)|(!))?$/.exec(q.trim());
  if (!m) return null;
  const [, name, sym, value, bang] = m;
  return new PropertyOptions({
    filterName: name,
    filterOp: bang ? 'missing' : sym === '=' ? 'eq' : sym === '~' ? 'contains' : 'has',
    filterValue: value || '',
  });
}

/**
 * 2.28.0: a property search with AND and OR, "@Owner=Sales AND @Cost OR @Status!": groups of conditions,
 * AND binding tighter than OR (no parentheses). AND and OR are written in capitals, so that "Sales and
 * Marketing" stays a value. Returns [[PropertyOptions, …], …], or null if `q` is not a property search.
 */
export function parsePropertySearch(q) {
  const groups = q.trim().split(/\s+OR\s+/).map(g => g.split(/\s+AND\s+/).map(parsePropertyQuery));
  return groups.every(g => g.every(Boolean)) ? groups : null;
}

/** The groups of parsePropertySearch as the API's `properties` (API 3.20.0): JSON, [[{ name, op, value }]]. */
export function searchConditions(groups) {
  return JSON.stringify(groups.map(g => g.map(o => {
    const op = FILTER_OPS[o.filterOp] || FILTER_OPS.has;
    return { name: o.filterName, op: op.api, ...(op.needsValue ? { value: o.filterValue } : {}) };
  })));
}

/** The groups in words: "Owner equals Sales AND Cost is set OR Status is not set". */
export function describeConditions(groups) {
  return groups.map(g => g.map(o => o.describeFilter()).join(' AND ')).join(' OR ');
}

/** The condition of `options` (a PropertyOptions with a filter) as the API's property parameters. */
export function searchParams(options) {
  const op = FILTER_OPS[options.filterOp] || FILTER_OPS.has;
  return { property: options.filterName, propertyOp: op.api, propertyValue: op.needsValue ? options.filterValue : undefined };
}

// ------------------------------------------------------------------ panel UI

function h(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k in e && typeof v === 'boolean') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) e.append(c instanceof Node ? c : String(c));
  return e;
}

/** A select of the property names of the index (with their counts); `emptyLabel` for none. */
function propertySelect(idx, value, onchange, emptyLabel, aria) {
  return h('select', { 'aria-label': aria, onchange },
    h('option', { value: '', selected: !value }, emptyLabel),
    [...idx.keys()].map(n => h('option', { value: n, selected: n === value }, `${n} (${idx.get(n).count})`)),
    value && !idx.has(value) ? h('option', { value, selected: true }, t('{name} (not in model)', { name: value })) : null);
}

/**
 * The display options of the Layout tab: a property in the labels, and colours by a property.
 * They apply to stored views too. `onChange(options)` is called after each edit.
 */
export function propertyDisplayRow(o, idx, onChange) {
  idx = idx || new Map();
  const commit = patch => onChange(new PropertyOptions({ ...o, ...patch }));
  return h('div', { class: 'filter-row' },
    h('strong', {}, t('Properties')),
    idx.size ? null : h('span', { class: 'muted' }, t('This model has no element properties.')),
    h('label', { class: 'field' }, t('Label'), propertySelect(idx, o.label, e => commit({ label: e.target.value }), t('none'), t('Show property in labels'))),
    h('label', { class: 'field' }, t('Colour by'), propertySelect(idx, o.colour, e => commit({ colour: e.target.value }), t('layer (default)'), t('Colour elements by property'))));
}

/**
 * Renders the property filter of the Filters tab, with the preferred language of the
 * values. `getIndex()` returns the property index of the current model
 * (propertyIndexFrom()); `onChange(options)` is called after each edit.
 */
export function renderPropertyPanel(container, getOptions, getIndex, onChange) {
  const draw = () => {
    const o = getOptions();
    const idx = getIndex() || new Map();
    const langs = [...new Set([...idx.values()].flatMap(e => [...e.langs]))].sort();
    const commit = patch => { onChange(new PropertyOptions({ ...o, ...patch })); draw(); };
    const nameSelect = (value, onchange, emptyLabel, aria) => propertySelect(idx, value, onchange, emptyLabel, aria);

    const valueList = h('datalist', { id: 'prop-filter-values' },
      [...(idx.get(o.filterName)?.values || [])].slice(0, 200).map(v => h('option', { value: v })));
    const op = FILTER_OPS[o.filterOp] || FILTER_OPS.has;
    let debounce;

    container.replaceChildren(
      h('div', { class: 'filter-row' },
        h('strong', {}, t('Only where')),
        nameSelect(o.filterName, e => commit({ filterName: e.target.value }), t('— no property filter —'), t('Property filter')),
        o.filterName ? h('select', { 'aria-label': t('Operator'), onchange: e => commit({ filterOp: e.target.value }) },
          Object.entries(FILTER_OPS).map(([k, v]) => h('option', { value: k, selected: k === o.filterOp }, v.label))) : null,
        o.filterName && op.needsValue ? h('input', {
          type: 'text', value: o.filterValue, list: 'prop-filter-values', placeholder: t('value'), 'aria-label': t('Property value'),
          oninput: e => { clearTimeout(debounce); debounce = setTimeout(() => onChange(new PropertyOptions({ ...o, filterValue: e.target.value })), 400); },
          onchange: e => commit({ filterValue: e.target.value }),
        }) : null,
        valueList,
        // the preferred language of multi-language values, for the filter, labels and colours
        langs.length ? h('label', { class: 'field' }, t('Language'), h('select', { onchange: e => commit({ lang: e.target.value }) },
          h('option', { value: '', selected: !o.lang }, t('any')),
          langs.map(l => h('option', { value: l, selected: l === o.lang }, l)))) : null,
        h('span', { class: 'muted' }, t('Tip: search “@name=value”, “@name~text”, “@name” or “@name!” to find items by property; join conditions with AND and OR.'))),
    );
  };
  draw();
  return { redraw: draw };
}
