// 2.33.0 (API 3.24.0): a neighbourhood that follows chosen relationship types against and along their direction,
// at every step, e.g. "every incoming relationship, outgoing only Serving and Realization". The dialog asks for
// the depth and the types of each direction; the diagram is an ordinary neighbourhood (nb~… with the types).

import { settings, saveSettings } from '../config.js';
import { t } from '../i18n.js';
import { RELATIONSHIP_TYPES } from '../archimate.js';
import { relBadge } from './details.js';
import { canWalkTypes, renderDef } from './panels.js';
import { $ } from './state.js';
import { h, status } from './ui.js';

const FIRST = { depth: 1, in: { on: true, all: true, types: [] }, out: { on: true, all: false, types: ['Serving', 'Realization'] } };

/** The last choice, remembered in this browser. */
function lastChoice() {
  const c = settings.neighbourWalk;
  if (!c || typeof c !== 'object') return structuredClone(FIRST);
  const side = (s, dflt) => ({
    on: s?.on ?? dflt.on, all: s?.all ?? dflt.all,
    types: Array.isArray(s?.types) ? s.types.filter(x => RELATIONSHIP_TYPES.includes(x)) : dflt.types,
  });
  return { depth: [1, 2, 3].includes(c.depth) ? c.depth : 1, in: side(c.in, FIRST.in), out: side(c.out, FIRST.out) };
}

/** One direction: followed or not, every type or the ones ticked. */
function sideBox(key, label, choice) {
  const c = choice[key];
  const name = `walk-${key}`;
  const chips = h('div', { class: 'walk-types', role: 'group', 'aria-label': t('{direction}: relationship types', { direction: label }) },
    RELATIONSHIP_TYPES.map(rt => h('label', { class: 'chip small' },
      h('input', { type: 'checkbox', value: rt, checked: c.types.includes(rt), 'data-walk-type': key }), relBadge(rt), rt)));
  const sync = box => {
    const on = box.querySelector(`[name=${name}-on]`).checked;
    const all = box.querySelector(`[name=${name}-all][value=all]`).checked;
    box.querySelectorAll('input:not([name$="-on"])').forEach(i => { i.disabled = !on; });
    chips.querySelectorAll('input').forEach(i => { i.disabled = !on || all; });
    chips.classList.toggle('inactive', !on || all);
  };
  const box = h('fieldset', { class: 'walk-side', 'data-walk': key },
    h('legend', {}, h('label', { class: 'inline' },
      h('input', { type: 'checkbox', name: `${name}-on`, checked: c.on, onchange: () => sync(box) }), label)),
    h('label', { class: 'inline' }, h('input', { type: 'radio', name: `${name}-all`, value: 'all', checked: c.all, onchange: () => sync(box) }), t('all types')),
    h('label', { class: 'inline' }, h('input', { type: 'radio', name: `${name}-all`, value: 'some', checked: !c.all, onchange: () => sync(box) }), t('only these:')),
    chips);
  sync(box);
  return box;
}

function readSide(dialog, key) {
  const box = dialog.querySelector(`[data-walk=${key}]`);
  return {
    on: box.querySelector(`[name=walk-${key}-on]`).checked,
    all: box.querySelector(`[name=walk-${key}-all][value=all]`).checked,
    types: [...box.querySelectorAll('[data-walk-type]:checked')].map(i => i.value),
  };
}

/** The neighbourhood definition of a choice, or a reason why there is none. */
export function walkDef(ids, label, choice) {
  const { in: i, out: o } = choice;
  if (!i.on && !o.on) return { error: t('Choose incoming or outgoing relationships, or both.') };
  if ((i.on && !i.all && !i.types.length) || (o.on && !o.all && !o.types.length)) return { error: t('Tick at least one relationship type, or choose “all types”.') };
  const dir = i.on && o.on ? 'both' : i.on ? 'in' : 'out';
  return {
    def: {
      kind: 'neighbourhood', seeds: [...ids], depth: choice.depth, dir, label,
      ...(i.on && !i.all ? { inTypes: i.types } : {}), ...(o.on && !o.all ? { outTypes: o.types } : {}),
    },
  };
}

/** Ask for the depth and the relationship types of each direction, then draw the neighbourhood of `ids`. */
export function askNeighbourhoodWalk(ids, label, { newTab = false } = {}) {
  if (!canWalkTypes()) {
    status(t('A neighbourhood with relationship types per direction needs ArchiMate API 3.24.0 or later.'), true);
    return;
  }
  const choice = lastChoice();
  const error = h('p', { class: 'error', role: 'alert', hidden: true });
  const depth = h('select', { 'aria-label': t('Depth') }, [1, 2, 3].map(n => h('option', { value: n, selected: n === choice.depth }, n)));
  const dialog = h('dialog', { id: 'walk-dialog', 'aria-labelledby': 'walk-title' },
    h('form', { method: 'dialog' },
      h('h2', { id: 'walk-title' }, t('Neighbourhood with relationship types: {name}', { name: label })),
      h('label', { class: 'inline' }, t('Depth'), ' ', depth),
      h('small', {}, t('The types are followed at every step; the diagram shows every relationship among the elements reached.')),
      sideBox('in', t('Incoming relationships'), choice),
      sideBox('out', t('Outgoing relationships'), choice),
      error,
      h('menu', {},
        h('button', { value: 'cancel', formnovalidate: true }, t('Cancel')),
        h('button', { value: 'ok', class: 'primary' }, t('Show diagram')))));
  $('#walk-dialog')?.remove();
  document.body.append(dialog);
  const read = () => ({ depth: Number(depth.value), in: readSide(dialog, 'in'), out: readSide(dialog, 'out') });
  dialog.querySelector('button[value=ok]').addEventListener('click', ev => {
    const res = walkDef(ids, label, read());
    if (res.error) { ev.preventDefault(); error.textContent = res.error; error.hidden = false; }
  });
  dialog.addEventListener('close', () => {
    if (dialog.returnValue === 'ok') {
      const c = read();
      const res = walkDef(ids, label, c);
      if (res.def) { saveSettings({ neighbourWalk: c }); renderDef(res.def, { newTab }); }
    }
    dialog.remove();
  }, { once: true });
  dialog.showModal();
}
