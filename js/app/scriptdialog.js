// 2.33.0 (API 3.24.0): recipe scripts. A script makes the recipes of many diagrams at once ("a diagram for each
// business service with Status XY"); the API reads it (POST …/recipe-scripts/check, a dry run) and makes and updates
// the recipes (…/run). This dialog edits a script, shows what checking it found (every error by line, the recipes it
// would make: new, changed, unchanged, obsolete) and runs it. The language: the API's RECIPE_SCRIPTS.md.

import { api, isOffline, olderThan } from '../api.js';
import { t } from '../i18n.js';
import { ownChange } from './history.js';
import { tree } from './models.js';
import { applyHash, modelRef, resolveHash } from './routing.js';
import { $, state } from './state.js';
import { inNewTab } from './tabs.js';
import { buildTree } from './treespecs.js';
import { errorMessage, h, may, status } from './ui.js';
import { canWrite } from './views.js';

export const SCRIPTS_NEED = '3.24.0';
export const LANGUAGE_URL = 'https://github.com/rnovicky/ArchiMateAPI/blob/main/RECIPE_SCRIPTS.md';

/** May this page check recipe scripts: an API that has them, not an offline copy. Running them needs canWrite too. */
export const canScripts = () => !isOffline() && !!state.apiVersion && !olderThan(state.apiVersion, SCRIPTS_NEED);
const canRun = () => canScripts() && canWrite() && may('write');

const EXAMPLE = `script "Service reviews"

defaults
  layout readable
  hide Junction

for each BusinessService where @Status = "XY"
  diagram "Service: {name}"
    neighbourhood depth 1
      incoming all
      outgoing Serving, Realization
`;

// The draft of each model's script, in this browser only (an unsent draft); the last report while the page is open.
const draftKey = modelId => `archixmi-recipe-script-${modelId}`;
const readDraft = modelId => { try { return localStorage.getItem(draftKey(modelId)); } catch { return null; } };
const saveDraft = (modelId, text) => { try { localStorage.setItem(draftKey(modelId), text); } catch { /* not kept */ } };
const lastReport = new Map(); // modelId -> { text, report }

const STATUS_LABEL = () => ({ new: t('new'), changed: t('changed'), unchanged: t('unchanged'), obsolete: t('obsolete') });
const CHANGE_LABEL = () => ({ name: t('name'), documentation: t('documentation'), recipe: t('what it draws') });

/** Open the recipe script dialog for the model shown. */
export function openRecipeScript() {
  const s = state.store;
  if (!s || !canScripts()) {
    status(t('Recipe scripts need ArchiMate API {version} or later.', { version: SCRIPTS_NEED }), true);
    return;
  }
  const modelId = s.id;
  const editor = h('textarea', {
    id: 'script-text', spellcheck: false, autocomplete: 'off', wrap: 'off', rows: 18,
    'aria-label': t('Recipe script'), 'aria-describedby': 'script-help',
  });
  editor.value = readDraft(modelId) ?? EXAMPLE;
  const gutter = h('pre', { class: 'script-gutter', 'aria-hidden': 'true' });
  const results = h('div', { class: 'script-results', role: 'region', 'aria-live': 'polite', 'aria-label': t('What checking the script found') });
  const deleteObsolete = h('input', { type: 'checkbox', id: 'script-delete-obsolete' });
  const runButton = h('button', { type: 'button', class: 'primary', 'data-script': 'run', disabled: true }, t('Create / update'));
  const checkButton = h('button', { type: 'button', 'data-script': 'check' }, t('Check'));
  const obsoleteLabel = h('label', { class: 'inline', hidden: true }, deleteObsolete, h('span', {}, t('Also delete the obsolete recipes')));
  let report = null, checkedText = null, busy = false;

  const numbers = () => {
    const n = editor.value.split('\n').length;
    gutter.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n');
    gutter.scrollTop = editor.scrollTop;
  };
  const goToLine = line => {
    const lines = editor.value.split('\n');
    const start = lines.slice(0, line - 1).reduce((sum, l) => sum + l.length + 1, 0);
    editor.focus();
    editor.setSelectionRange(start, start + (lines[line - 1] || '').length);
    const lineHeight = editor.scrollHeight / Math.max(1, lines.length);
    editor.scrollTop = Math.max(0, (line - 4) * lineHeight);
  };
  const stale = () => checkedText !== editor.value;
  const syncButtons = () => {
    const todo = report?.ok ? report.counts.new + report.counts.changed + (deleteObsolete.checked ? report.counts.obsolete : 0) : 0;
    runButton.disabled = busy || !report?.ok || stale() || !todo || !canRun();
    runButton.textContent = report?.ok && !stale() && todo
      ? t('Create / update ({n})', { n: todo }) : t('Create / update');
    runButton.title = !canRun() ? t('Your key may read only: checking works, running needs a key that may write')
      : stale() && report ? t('The script changed since it was checked: check it again') : '';
    checkButton.disabled = busy;
    obsoleteLabel.hidden = !(report?.ok && report.counts.obsolete);
  };

  const preview = recipe => {
    dialog.close();
    inNewTab(async () => {
      try {
        const resolved = await resolveHash({ model: modelRef(s.model), ...Object.fromEntries(new URLSearchParams(recipe)) });
        if (resolved.d) applyHash(resolved);
        else status(t('What this recipe draws is not in the model.'), true);
      } catch (e) { status(errorMessage(e), true); }
    });
  };

  const show = (r, { ran = false } = {}) => {
    report = r;
    const L = STATUS_LABEL(), C = CHANGE_LABEL();
    const problem = (p, kind) => h('li', { class: `script-${kind}` },
      h('button', { type: 'button', class: 'link', 'data-line': p.line, onclick: () => goToLine(p.line) },
        p.column ? t('line {line}, column {column}', { line: p.line, column: p.column }) : t('line {line}', { line: p.line })),
      ': ', p.message);
    const summary = r.ok
      ? (ran ? t('Done: {new} made, {changed} updated, {unchanged} unchanged.', r.counts)
        : t('{total} recipe(s): {new} new, {changed} changed, {unchanged} unchanged.', { total: r.recipes.length, ...r.counts }))
      : t('{n} error(s): nothing is made until they are fixed.', { n: r.errors.length });
    const rows = r.recipes.map(x => h('tr', { 'data-status': x.status },
      h('td', {}, h('span', { class: `script-badge ${x.status}` }, L[x.status])),
      h('td', {}, x.name, x.changes?.length ? h('small', { class: 'muted' }, ' (' + x.changes.map(c => C[c] || c).join(', ') + ')') : null),
      h('td', { class: 'muted' }, x.element ? `${x.element.type}` : ''),
      h('td', {}, h('button', { type: 'button', class: 'link', title: t('Draw it in a new tab'), onclick: () => preview(x.recipe) }, t('Show')))));
    const obsolete = (r.obsolete || []).map(o => h('li', {}, h('span', { class: 'script-badge obsolete' }, o.deleted ? t('deleted') : L.obsolete), ' ', o.name));
    results.replaceChildren(...[
      h('p', { class: r.ok ? 'script-summary' : 'script-summary bad' }, (r.script ? `“${r.script}”: ` : '') + summary),
      r.errors.length ? h('ul', { class: 'script-problems' }, r.errors.map(p => problem(p, 'error'))) : null,
      r.warnings.length ? h('details', { open: true }, h('summary', {}, t('Warnings ({n})', { n: r.warnings.length })),
        h('ul', { class: 'script-problems' }, r.warnings.map(p => problem(p, 'warning')))) : null,
      rows.length ? h('table', { class: 'script-table' },
        h('thead', {}, h('tr', {}, h('th', {}, t('Status')), h('th', {}, t('Name')), h('th', {}, t('For')), h('th', {}, ''))),
        h('tbody', {}, rows)) : null,
      obsolete.length ? h('div', {},
        h('p', {}, t('Made by an earlier run, no longer made by the script ({n}):', { n: obsolete.length })),
        h('ul', { class: 'script-obsolete' }, obsolete)) : null,
    ].filter(Boolean));
    syncButtons();
  };

  const check = async () => {
    if (busy) return;
    busy = true; syncButtons();
    const text = editor.value;
    saveDraft(modelId, text);
    results.replaceChildren(h('p', { class: 'muted' }, t('Checking…')));
    try {
      const r = await api.recipeScripts.check(modelId, text);
      checkedText = text;
      lastReport.set(modelId, { text, report: r });
      show(r);
    } catch (e) {
      results.replaceChildren(h('p', { class: 'script-summary bad', role: 'alert' }, errorMessage(e)));
    } finally { busy = false; syncButtons(); }
  };

  const run = async () => {
    if (busy || runButton.disabled) return;
    busy = true; syncButtons();
    const text = editor.value;
    try {
      const r = await api.recipeScripts.run(modelId, text, { deleteObsolete: deleteObsolete.checked });
      checkedText = null; // what is in the model changed: check again before the next run
      lastReport.delete(modelId);
      await s.reloadViews();
      ownChange();
      tree?.setRoots(buildTree(s));
      show(r, { ran: true });
      const deleted = (r.obsolete || []).filter(o => o.deleted).length;
      status(t('Recipe script “{name}”: {new} made, {changed} updated, {deleted} deleted.',
        { name: r.script, new: r.counts.new, changed: r.counts.changed, deleted }));
    } catch (e) {
      if (e.code === 'SCRIPT_ERRORS' && e.details) show(e.details);
      else results.replaceChildren(h('p', { class: 'script-summary bad', role: 'alert' }, errorMessage(e)));
    } finally { busy = false; syncButtons(); }
  };

  checkButton.addEventListener('click', check);
  runButton.addEventListener('click', run);
  deleteObsolete.addEventListener('change', syncButtons);
  editor.addEventListener('input', () => { numbers(); syncButtons(); });
  editor.addEventListener('scroll', () => { gutter.scrollTop = editor.scrollTop; });
  editor.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); check(); }
    if (ev.key === 'Tab' && !ev.shiftKey && !ev.ctrlKey && !ev.altKey) { // two spaces: indentation is meaningful here
      ev.preventDefault();
      editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end');
      numbers(); syncButtons();
    }
  });

  const dialog = h('dialog', { id: 'script-dialog', 'aria-labelledby': 'script-title' },
    h('h2', { id: 'script-title' }, t('Recipe script: {model}', { model: s.model.name })),
    h('p', { id: 'script-help', class: 'muted' },
      t('A script makes the recipes of many diagrams at once, e.g. one for each business service with a property. Check shows what it would make; nothing changes until Create / update.') + ' ',
      h('a', { href: LANGUAGE_URL, target: '_blank', rel: 'noopener' }, t('The language')), ' · ',
      h('button', { type: 'button', class: 'link', onclick: () => { editor.value = EXAMPLE; numbers(); syncButtons(); editor.focus(); } }, t('Example')),
      ' · ', h('kbd', {}, 'Ctrl+Enter'), ' ', t('checks')),
    h('div', { class: 'script-editor' }, gutter, editor),
    h('div', { class: 'script-actions' }, checkButton, runButton, obsoleteLabel,
      h('span', { class: 'grow' }),
      h('button', { type: 'button', onclick: () => dialog.close() }, t('Close'))),
    results);
  $('#script-dialog')?.remove();
  document.body.append(dialog);
  dialog.addEventListener('close', () => { saveDraft(modelId, editor.value); dialog.remove(); }, { once: true });
  numbers();
  const kept = lastReport.get(modelId);
  if (kept && kept.text === editor.value) { checkedText = kept.text; show(kept.report); } else syncButtons();
  dialog.showModal();
  editor.focus();
}
