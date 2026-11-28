// 2.33.0 (API 3.24.0): recipe scripts. A script makes the recipes of many diagrams at once ("a diagram for each
// business service with Status XY"); the API reads it (POST …/recipe-scripts/check, a dry run) and makes and updates
// the recipes (…/run). This dialog edits a script, shows what checking it found (every error by line, the recipes it
// would make: new, changed, unchanged, obsolete) and runs it. The language: the API's RECIPE_SCRIPTS.md.
//
// 2.34.0 (API 3.25.0): every run keeps the script's text with the model, so a kept script is opened from the list in
// the dialog; and a single recipe is edited as the script of one diagram (openRecipeAsScript, "Edit as script…").
//
// 2.35.0 (API 3.26.0): a script is kept as a live template (its diagrams worked out whenever it is opened in the tree);
// the editor (scripteditor.js) colours the script, checks it a moment after typing stops and completes words.
//
// 2.36.0: the dialog keeps its size whatever checking finds (its edge drags it bigger or smaller, a bar between the
// script and the results moves the split; both remembered in this browser); "Delete its diagrams…" deletes all the
// recipes a script made (API 3.28.0).

import { api, isOffline, olderThan } from '../api.js';
import { t } from '../i18n.js';
import { askConfirm } from './diagram.js';
import { ownChange } from './history.js';
import { canLiveTemplates, tree } from './models.js';
import { scriptEditor } from './scripteditor.js';
import { applyHash, modelRef, resolveHash } from './routing.js';
import { $, state } from './state.js';
import { inNewTab } from './tabs.js';
import { buildTree } from './treespecs.js';
import { errorMessage, h, may, status } from './ui.js';
import { canWrite, isRecipe, openLiveRecipe } from './views.js';

export const SCRIPTS_NEED = '3.24.0';
export const EDIT_NEED = '3.25.0';
export const DELETE_RECIPES_NEED = '3.28.0';
export const LANGUAGE_URL = 'https://github.com/rnovicky/ArchiMateAPI/blob/main/RECIPE_SCRIPTS.md';

/** May this page check recipe scripts: an API that has them, not an offline copy. Running them needs canWrite too. */
export const canScripts = () => !isOffline() && !!state.apiVersion && !olderThan(state.apiVersion, SCRIPTS_NEED);
/** 2.34.0: kept scripts and recipes edited as scripts (API 3.25.0). */
export const canEditScripts = () => canScripts() && !olderThan(state.apiVersion, EDIT_NEED);
/** 2.34.0: "Edit as script…" for a recipe. */
export const canEditAsScript = view => canEditScripts() && isRecipe(view);
const canRun = () => canScripts() && canWrite() && may('write');
/** 2.36.0: deleting all the recipes of a script at once (API 3.28.0). */
export const canDeleteScriptRecipes = () => canScripts() && !olderThan(state.apiVersion, DELETE_RECIPES_NEED) && canRun();

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

/** A problem of a check, its line a button that selects it. */
const problemItem = (p, kind, goToLine) => h('li', { class: `script-${kind}` },
  h('button', { type: 'button', class: 'link', 'data-line': p.line, onclick: () => goToLine(p.line) },
    p.column ? t('line {line}, column {column}', { line: p.line, column: p.column }) : t('line {line}', { line: p.line })),
  ': ', p.message);

/** A recipe drawn in a new tab, with the model shown. */
function previewRecipe(s, recipe, dialog) {
  dialog.close();
  inNewTab(async () => {
    try {
      const resolved = await resolveHash({ model: modelRef(s.model), ...Object.fromEntries(new URLSearchParams(recipe)) });
      if (resolved.d) applyHash(resolved);
      else status(t('What this recipe draws is not in the model.'), true);
    } catch (e) { status(errorMessage(e), true); }
  });
}

// 2.36.0: the size of the script dialog and the height of its results, in this browser only
const SIZE_KEY = 'archixmi-script-dialog';
const readSize = () => { try { return JSON.parse(localStorage.getItem(SIZE_KEY) || '{}') || {}; } catch { return {}; } };
const saveSize = patch => { try { localStorage.setItem(SIZE_KEY, JSON.stringify({ ...readSize(), ...patch })); } catch { /* not kept */ } };

/**
 * A script dialog of a fixed size: what checking finds scrolls in the results instead of growing the dialog. Its edge
 * (the corner) resizes it; the bar above the results moves the split between the script and them.
 */
function sized(dialog, results) {
  dialog.classList.add('script-sized');
  const saved = readSize();
  if (saved.w) dialog.style.width = `${saved.w}px`;
  if (saved.h) dialog.style.height = `${saved.h}px`;
  if (saved.r) results.style.flexBasis = `${saved.r}px`;
  const bar = h('div', { class: 'script-split', role: 'separator', 'aria-orientation': 'horizontal', tabindex: '0',
    title: t('Drag to give the script or the results more room'), 'aria-label': t('Split between the script and the results') });
  const setResults = px => {
    const room = dialog.clientHeight - 220; // the editor keeps some lines
    const r = Math.round(Math.max(40, Math.min(px, Math.max(40, room))));
    results.style.flexBasis = `${r}px`;
    saveSize({ r });
  };
  bar.addEventListener('pointerdown', e => {
    e.preventDefault();
    bar.setPointerCapture(e.pointerId);
    const startY = e.clientY, start = results.getBoundingClientRect().height;
    const move = ev => setResults(start + startY - ev.clientY);
    const up = () => { bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
  });
  bar.addEventListener('keydown', e => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    setResults(results.getBoundingClientRect().height + (e.key === 'ArrowUp' ? 24 : -24));
  });
  results.before(bar);
  // the dialog's own size is kept when the user dragged its edge (not when the window made it smaller)
  let dragging = false;
  dialog.addEventListener('pointerdown', e => { dragging = e.target === dialog; });
  window.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    saveSize({ w: Math.round(dialog.offsetWidth), h: Math.round(dialog.offsetHeight) });
  });
  return dialog;
}

function showDialog(dialog, onClose) {
  $('#script-dialog')?.remove();
  document.body.append(dialog);
  dialog.addEventListener('close', () => { onClose?.(); dialog.remove(); }, { once: true });
  dialog.showModal();
}

async function afterWrite(s, { views = true } = {}) {
  if (views) await s.reloadViews();
  if (canLiveTemplates()) await s.loadLiveScripts().catch(() => { /* listed when they can be read */ });
  ownChange();
  tree?.setRoots(buildTree(s));
}

/**
 * Open the recipe script dialog for the model shown. 2.34.0: `text` opens a kept script (instead of the draft),
 * `line` selects a line of it.
 */
export function openRecipeScript({ text = null, line = null } = {}) {
  const s = state.store;
  if (!s || !canScripts()) {
    status(t('Recipe scripts need ArchiMate API {version} or later.', { version: SCRIPTS_NEED }), true);
    return;
  }
  const modelId = s.id;
  const results = h('div', { class: 'script-results', role: 'region', 'aria-live': 'polite', 'aria-label': t('What checking the script found') });
  const deleteObsolete = h('input', { type: 'checkbox', id: 'script-delete-obsolete' });
  const runButton = h('button', { type: 'button', class: 'primary', 'data-script': 'run', disabled: true }, t('Create / update'));
  const checkButton = h('button', { type: 'button', 'data-script': 'check' }, t('Check'));
  // 2.35.0 (API 3.26.0): kept as a live template instead of making recipes
  const liveButton = h('button', { type: 'button', 'data-script': 'live', disabled: true, hidden: !canLiveTemplates(),
    title: t('Keep the script as a live template: no recipes are made; in the tree it lists its diagrams as the model is whenever it is opened') },
  t('Keep as live template'));
  const obsoleteLabel = h('label', { class: 'inline', hidden: true }, deleteObsolete, h('span', {}, t('Also delete the obsolete recipes')));
  let report = null, checkedText = null, busy = false;

  const stale = () => checkedText !== ed.editor.value;
  const syncButtons = () => {
    const todo = report?.ok ? report.counts.new + report.counts.changed + (deleteObsolete.checked ? report.counts.obsolete : 0) : 0;
    runButton.disabled = busy || !report?.ok || stale() || !todo || !canRun();
    runButton.textContent = report?.ok && !stale() && todo
      ? t('Create / update ({n})', { n: todo }) : t('Create / update');
    runButton.title = !canRun() ? t('Your key may read only: checking works, running needs a key that may write')
      : stale() && report ? t('The script changed since it was checked: check it again') : '';
    checkButton.disabled = busy;
    liveButton.disabled = busy || !report?.ok || stale() || !canRun();
    obsoleteLabel.hidden = !(report?.ok && report.counts.obsolete);
  };
  const ed = scriptEditor(text ?? readDraft(modelId) ?? EXAMPLE,
    { onChange: () => syncButtons(), onCheck: () => check(), onAutoCheck: () => check({ auto: true }) });

  const show = (r, { ran = false } = {}) => {
    report = r;
    ed.markErrors(r.errors);
    const L = STATUS_LABEL(), C = CHANGE_LABEL();
    const summary = r.ok
      ? (ran ? t('Done: {new} made, {changed} updated, {unchanged} unchanged.', r.counts)
        : t('{total} recipe(s): {new} new, {changed} changed, {unchanged} unchanged.', { total: r.recipes.length, ...r.counts }))
      : t('{n} error(s): nothing is made until they are fixed.', { n: r.errors.length });
    const rows = r.recipes.map(x => h('tr', { 'data-status': x.status },
      h('td', {}, h('span', { class: `script-badge ${x.status}` }, L[x.status])),
      h('td', {}, x.name, x.changes?.length ? h('small', { class: 'muted' }, ' (' + x.changes.map(c => C[c] || c).join(', ') + ')') : null),
      h('td', { class: 'muted' }, x.element ? `${x.element.type}` : ''),
      h('td', {}, h('button', { type: 'button', class: 'link', title: t('Draw it in a new tab'), onclick: () => previewRecipe(s, x.recipe, dialog) }, t('Show')))));
    const obsolete = (r.obsolete || []).map(o => h('li', {}, h('span', { class: 'script-badge obsolete' }, o.deleted ? t('deleted') : L.obsolete), ' ', o.name));
    results.replaceChildren(...[
      h('p', { class: r.ok ? 'script-summary' : 'script-summary bad' }, (r.script ? `“${r.script}”: ` : '') + summary),
      r.errors.length ? h('ul', { class: 'script-problems' }, r.errors.map(p => problemItem(p, 'error', ed.goToLine))) : null,
      r.warnings.length ? h('details', { open: true }, h('summary', {}, t('Warnings ({n})', { n: r.warnings.length })),
        h('ul', { class: 'script-problems' }, r.warnings.map(p => problemItem(p, 'warning', ed.goToLine)))) : null,
      rows.length ? h('table', { class: 'script-table' },
        h('thead', {}, h('tr', {}, h('th', {}, t('Status')), h('th', {}, t('Name')), h('th', {}, t('For')), h('th', {}, ''))),
        h('tbody', {}, rows)) : null,
      obsolete.length ? h('div', {},
        h('p', {}, t('Made by an earlier run, no longer made by the script ({n}):', { n: obsolete.length })),
        h('ul', { class: 'script-obsolete' }, obsolete)) : null,
    ].filter(Boolean));
    syncButtons();
  };

  const check = async ({ auto = false } = {}) => {
    if (busy || (auto && !stale())) return;
    busy = true; syncButtons();
    const value = ed.editor.value;
    saveDraft(modelId, value);
    if (!auto) results.replaceChildren(h('p', { class: 'muted' }, t('Checking…')));
    try {
      const r = await api.recipeScripts.check(modelId, value);
      if (auto && value !== ed.editor.value) return; // typed on meanwhile: the next check comes
      checkedText = value;
      lastReport.set(modelId, { text: value, report: r });
      show(r);
    } catch (e) {
      results.replaceChildren(h('p', { class: 'script-summary bad', role: 'alert' }, errorMessage(e)));
    } finally { busy = false; syncButtons(); }
  };

  const keepLive = async () => {
    if (busy || liveButton.disabled) return;
    busy = true; syncButtons();
    try {
      const r = await api.recipeScripts.keep(modelId, ed.editor.value, { live: true });
      await afterWrite(s, { views: false });
      loadKept();
      results.replaceChildren(h('p', { class: 'script-summary' },
        t('“{name}” kept as a live template: {n} diagram(s) now. It is under Views in the tree.', { name: r.name, n: r.diagrams })));
      status(t('Live template “{name}” kept.', { name: r.name }));
    } catch (e) {
      if (e.code === 'SCRIPT_ERRORS' && e.details) show(e.details);
      else results.replaceChildren(h('p', { class: 'script-summary bad', role: 'alert' }, errorMessage(e)));
    } finally { busy = false; syncButtons(); }
  };

  const run = async () => {
    if (busy || runButton.disabled) return;
    busy = true; syncButtons();
    const value = ed.editor.value;
    try {
      const r = await api.recipeScripts.run(modelId, value, { deleteObsolete: deleteObsolete.checked });
      checkedText = null; // what is in the model changed: check again before the next run
      lastReport.delete(modelId);
      await afterWrite(s);
      show(r, { ran: true });
      loadKept(); // the run kept the text (API 3.25.0)
      const deleted = (r.obsolete || []).filter(o => o.deleted).length;
      status(t('Recipe script “{name}”: {new} made, {changed} updated, {deleted} deleted.',
        { name: r.script, new: r.counts.new, changed: r.counts.changed, deleted }));
    } catch (e) {
      if (e.code === 'SCRIPT_ERRORS' && e.details) show(e.details);
      else results.replaceChildren(h('p', { class: 'script-summary bad', role: 'alert' }, errorMessage(e)));
    } finally { busy = false; syncButtons(); }
  };

  // 2.34.0 (API 3.25.0): the scripts kept with the model, each as its last run left it
  const kept = h('select', { class: 'script-kept', 'aria-label': t('Kept scripts'), hidden: !canEditScripts(),
    title: t('Every run keeps the script with the model; open one to change it and run it again') });
  const loadKept = async () => {
    if (!canEditScripts()) return;
    try {
      const list = await api.recipeScripts.list(modelId);
      kept.replaceChildren(h('option', { value: '' }, list.length ? t('Open a kept script…') : t('No kept scripts yet')),
        ...list.map(x => h('option', { value: x.id ?? '', disabled: !x.stored },
          !x.stored ? t('{name} (text not kept)', { name: x.name }) : x.live ? t('{name} (live template)', { name: x.name })
            : t('{name} ({n} recipes)', { name: x.name, n: x.recipes }))));
      kept.disabled = !list.some(x => x.stored);
    } catch { kept.hidden = true; }
  };
  // 2.36.0 (API 3.28.0): all the recipes of the script in the editor, or of a kept one, deleted at once
  const deleteButton = h('button', { type: 'button', 'data-script': 'delete-recipes', hidden: !canDeleteScriptRecipes(),
    title: t('Delete all the diagrams (recipes) the script of this name made, e.g. after running a wrong script') },
  t('Delete its diagrams…'));
  deleteButton.addEventListener('click', async () => {
    const name = report?.script || scriptName(ed.editor.value);
    if (!name) { status(t('The script has no script line: it has no name, so it made no recipes.'), true); return; }
    if (await deleteScriptRecipes(s, name)) {
      checkedText = null; lastReport.delete(modelId);
      results.replaceChildren();
      report = null; syncButtons();
      loadKept();
    }
  });
  kept.addEventListener('change', async () => {
    const id = kept.value;
    kept.value = '';
    if (!id) return;
    try {
      const script = await api.recipeScripts.get(modelId, id);
      if (ed.editor.value.trim() && ed.editor.value !== script.text
        && !await askConfirm(t('Replace the script in the editor with the kept script “{name}”?', { name: script.name }), t('Replace'))) return;
      ed.setText(script.text);
      results.replaceChildren();
      report = null; syncButtons();
      ed.editor.focus();
    } catch (e) { status(errorMessage(e), true); }
  });

  checkButton.addEventListener('click', () => check());
  runButton.addEventListener('click', run);
  liveButton.addEventListener('click', keepLive);
  deleteObsolete.addEventListener('change', syncButtons);

  const dialog = h('dialog', { id: 'script-dialog', 'aria-labelledby': 'script-title' },
    h('h2', { id: 'script-title' }, t('Recipe script: {model}', { model: s.model.name })),
    h('p', { id: 'script-help', class: 'muted' },
      t('A script makes the recipes of many diagrams at once, e.g. one for each business service with a property. Check shows what it would make; nothing changes until Create / update.') + ' ',
      h('a', { href: LANGUAGE_URL, target: '_blank', rel: 'noopener' }, t('The language')), ' · ',
      h('button', { type: 'button', class: 'link', onclick: () => { ed.setText(EXAMPLE); ed.editor.focus(); } }, t('Example')),
      ' · ', h('kbd', {}, 'Ctrl+Enter'), ' ', t('checks')),
    h('div', { class: 'script-top' }, deleteButton, kept),
    ed.box,
    h('div', { class: 'script-actions' }, checkButton, runButton, liveButton, obsoleteLabel,
      h('span', { class: 'grow' }),
      h('button', { type: 'button', onclick: () => dialog.close() }, t('Close'))),
    results);
  sized(dialog, results);
  showDialog(dialog, () => saveDraft(modelId, ed.editor.value));
  loadKept();
  const last = lastReport.get(modelId);
  if (last && last.text === ed.editor.value) { checkedText = last.text; show(last.report); } else syncButtons();
  if (line) ed.goToLine(line); else ed.editor.focus();
}

// ================================================================ one recipe as a script (2.34.0, API 3.25.0)

/** "Edit as script…": a recipe written as the script of one diagram, checked and saved back into it. */
export async function openRecipeAsScript(viewId) {
  const s = state.store, view = s?.view(viewId);
  if (!s || !view || !canEditAsScript(view)) {
    status(t('Editing a recipe as a script needs ArchiMate API {version} or later.', { version: EDIT_NEED }), true);
    return;
  }
  let answer;
  try {
    answer = await api.recipeScripts.ofView(s.id, viewId);
  } catch (e) { status(errorMessage(e), true); return; }
  const by = answer.madeBy;
  if (by && !await chooseForScriptMade(s, view, by)) return;
  editRecipe(s, view, answer, { detach: !!by });
}

/** A recipe made by a recipe script: open the script (resolves false), or detach and edit the recipe (true). */
function chooseForScriptMade(s, view, by) {
  return new Promise(resolve => {
    let detach = false;
    const openScript = async () => {
      try {
        const script = await api.recipeScripts.get(s.id, by.storedScriptId);
        dialog.close();
        openRecipeScript({ text: script.text, line: by.line });
      } catch (e) { status(errorMessage(e), true); }
    };
    const dialog = h('dialog', { id: 'script-dialog', class: 'script-choice', 'aria-labelledby': 'script-title' },
      h('h2', { id: 'script-title' }, t('Edit “{name}”', { name: view.name })),
      h('p', {}, t('This recipe was made by the recipe script “{script}”. Its next run sets back what is changed here: change the script instead.', { script: by.script })),
      by.storedScriptId == null ? h('p', { class: 'muted' }, t('The script’s text is not kept with the model (it last ran before ArchiMate API 3.25.0); open it where it was written, or detach the recipe.')) : null,
      h('div', { class: 'script-actions' },
        h('button', { type: 'button', class: 'primary', disabled: by.storedScriptId == null, onclick: openScript },
          by.forEach ? t('Open the script (its for each)') : t('Open the script')),
        h('button', { type: 'button', title: t('Edit this recipe alone; the script no longer updates or deletes it'),
          onclick: () => { detach = true; dialog.close(); } }, t('Detach and edit…')),
        h('span', { class: 'grow' }),
        h('button', { type: 'button', onclick: () => dialog.close() }, t('Cancel'))));
    showDialog(dialog, () => resolve(detach));
  });
}

function editRecipe(s, view, answer, { detach }) {
  const results = h('div', { class: 'script-results', role: 'region', 'aria-live': 'polite', 'aria-label': t('What checking the script found') });
  const gaps = answer.gaps?.length ? h('details', { class: 'script-gaps', open: answer.script == null },
    h('summary', {}, answer.script == null ? t('A script cannot describe this recipe') : t('Left out of the script ({n})', { n: answer.gaps.length })),
    h('ul', {}, answer.gaps.map(g => h('li', {}, g)))) : null;
  const close = h('button', { type: 'button', onclick: () => dialog.close() }, t('Close'));
  const head = h('h2', { id: 'script-title' }, t('Recipe as script: {name}', { name: view.name }));
  if (answer.script == null) {
    const dialog = h('dialog', { id: 'script-dialog', class: 'script-choice', 'aria-labelledby': 'script-title' }, head, gaps,
      h('div', { class: 'script-actions' }, h('span', { class: 'grow' }), close));
    showDialog(dialog);
    return;
  }
  const saveButton = h('button', { type: 'button', class: 'primary', 'data-script': 'save', disabled: true }, t('Save'));
  const checkButton = h('button', { type: 'button', 'data-script': 'check' }, t('Check'));
  const showButton = h('button', { type: 'button', 'data-script': 'show', disabled: true, title: t('Draw it in a new tab') }, t('Show'));
  let report = null, checkedText = null, busy = false, version = view.version;
  const keepDocumentation = !answer.documentationInScript;

  const stale = () => checkedText !== ed.editor.value;
  const syncButtons = () => {
    const todo = report?.ok && (report.changes.length || detach);
    saveButton.disabled = busy || !report?.ok || stale() || !todo || !canRun();
    saveButton.title = !canRun() ? t('Your key may read only: checking works, saving needs a key that may write')
      : stale() && report ? t('The script changed since it was checked: check it again') : '';
    showButton.disabled = busy || !report?.ok || stale();
    checkButton.disabled = busy;
  };
  const ed = scriptEditor(answer.script,
    { onChange: () => syncButtons(), onCheck: () => check(), onAutoCheck: () => check({ auto: true }) });
  const note = detach ? h('p', { class: 'script-note' }, t('Saving detaches this recipe from the recipe script “{script}”: its runs no longer update or delete it.', { script: view.script })) : null;

  const show = (r, { saved = false } = {}) => {
    report = r;
    ed.markErrors(r.errors);
    const C = CHANGE_LABEL();
    const summary = !r.ok ? t('{n} error(s): nothing is saved until they are fixed.', { n: r.errors.length })
      : saved ? (r.changed ? t('Saved.') : t('Nothing to save.'))
        : r.changes.length ? t('Saving changes: {what}.', { what: r.changes.map(c => C[c] || c).join(', ') })
          : detach ? t('The recipe stays as it is; saving detaches it from its script.') : t('The recipe says this already: nothing to save.');
    results.replaceChildren(...[
      h('p', { class: r.ok ? 'script-summary' : 'script-summary bad' }, summary),
      r.errors.length ? h('ul', { class: 'script-problems' }, r.errors.map(p => problemItem(p, 'error', ed.goToLine))) : null,
      r.warnings.length ? h('ul', { class: 'script-problems' }, r.warnings.map(p => problemItem(p, 'warning', ed.goToLine))) : null,
    ].filter(Boolean));
    syncButtons();
  };

  const check = async ({ auto = false } = {}) => {
    if (busy || (auto && !stale())) return;
    busy = true; syncButtons();
    const value = ed.editor.value;
    if (!auto) results.replaceChildren(h('p', { class: 'muted' }, t('Checking…')));
    try {
      const r = await api.recipeScripts.checkView(s.id, view.id, value, { keepDocumentation });
      if (auto && value !== ed.editor.value) return;
      checkedText = value;
      show(r);
    } catch (e) {
      results.replaceChildren(h('p', { class: 'script-summary bad', role: 'alert' }, errorMessage(e)));
    } finally { busy = false; syncButtons(); }
  };

  const save = async () => {
    if (busy || saveButton.disabled) return;
    busy = true; syncButtons();
    try {
      const r = await api.recipeScripts.saveView(s.id, view.id,
        { script: ed.editor.value, keepDocumentation, detach, expectedVersion: version });
      await afterWrite(s);
      version = s.view(view.id)?.version ?? null;
      detach = false;
      if (note) note.hidden = true;
      show({ ...r, changes: [] }, { saved: true });
      checkedText = ed.editor.value;
      status(t('Recipe “{name}” saved.', { name: r.recipe?.name ?? view.name }));
    } catch (e) {
      if (e.code === 'SCRIPT_ERRORS' && e.details) show(e.details);
      else results.replaceChildren(h('p', { class: 'script-summary bad', role: 'alert' }, errorMessage(e)));
    } finally { busy = false; syncButtons(); }
  };

  checkButton.addEventListener('click', () => check());
  saveButton.addEventListener('click', save);
  showButton.addEventListener('click', () => report?.recipe && previewRecipe(s, report.recipe.recipe, dialog));

  const dialog = h('dialog', { id: 'script-dialog', 'aria-labelledby': 'script-title' },
    head,
    h('p', { id: 'script-help', class: 'muted' },
      t('What the recipe draws, its filters and options, as script lines. Check shows what saving would change; the recipe keeps its place and links.') + ' ',
      h('a', { href: LANGUAGE_URL, target: '_blank', rel: 'noopener' }, t('The language')), ' · ',
      h('kbd', {}, 'Ctrl+Enter'), ' ', t('checks')),
    note,
    gaps,
    ed.box,
    h('div', { class: 'script-actions' }, checkButton, saveButton, showButton, h('span', { class: 'grow' }), close),
    results);
  sized(dialog, results);
  showDialog(dialog);
  syncButtons();
  ed.editor.focus();
}

// ================================================================ deleting a script's recipes (2.36.0, API 3.28.0)

/** The name on the script line of a text, or null. */
export function scriptName(text) {
  const m = /^[ \t]*script[ \t]+"((?:[^"\\]|\\.)*)"/m.exec(text || '');
  return m ? m[1].replace(/\\(.)/g, '$1') : null;
}

/**
 * Delete all the recipes the script `name` made, after a confirmation that lists them. Resolves true when deleted.
 * The script's kept text stays (a run of it makes them again) unless "also forget" is ticked.
 */
export async function deleteScriptRecipes(s, name) {
  const views = s.views.filter(v => v.script === name);
  if (!views.length) { status(t('The script “{name}” made no diagrams that are still its own.', { name }), true); return false; }
  const forget = h('input', { type: 'checkbox', id: 'script-forget' });
  const ok = await new Promise(resolve => {
    let yes = false;
    const shown = views.slice(0, 12);
    const dialog = h('dialog', { id: 'script-delete-dialog', 'aria-labelledby': 'script-delete-title' },
      h('h2', { id: 'script-delete-title' }, t('Delete the diagrams of “{name}”', { name })),
      h('p', {}, t('Delete the {n} diagram(s) (recipes) the recipe script “{name}” made? This cannot be undone; recipes detached from the script stay.', { n: views.length, name })),
      h('ul', { class: 'script-obsolete' }, shown.map(v => h('li', {}, v.name)),
        views.length > shown.length ? h('li', { class: 'muted' }, t('… and {n} more', { n: views.length - shown.length })) : null),
      h('label', { class: 'inline' }, forget, h('span', {}, t('Also forget the script’s kept text'))),
      h('div', { class: 'script-actions' },
        h('button', { type: 'button', class: 'danger', 'data-script': 'confirm-delete', onclick: () => { yes = true; dialog.close(); } },
          t('Delete {n} diagram(s)', { n: views.length })),
        h('span', { class: 'grow' }),
        h('button', { type: 'button', onclick: () => dialog.close() }, t('Cancel'))));
    // the confirmation goes over the script dialog, which stays open
    document.body.append(dialog);
    dialog.addEventListener('close', () => { dialog.remove(); resolve(yes); }, { once: true });
    dialog.showModal();
  });
  if (!ok) return false;
  try {
    const r = await api.recipeScripts.deleteRecipes(s.id, name, { forget: forget.checked });
    await afterWrite(s);
    status(t('Recipe script “{name}”: {n} diagram(s) deleted.', { name, n: r.deleted.length }));
    return true;
  } catch (e) { status(errorMessage(e), true); return false; }
}

// ================================================================ live templates in the tree (2.35.0, API 3.26.0)

/** The menu of a live template in the tree: its script, and deleting it. */
export function liveScriptEntries(data) {
  const s = state.store;
  return [
    { label: t('Open its script…'), action: async () => {
      try { openRecipeScript({ text: (await api.recipeScripts.get(s.id, data.id)).text }); } catch (e) { status(errorMessage(e), true); }
    } },
    { label: t('Delete live template…'), disabled: !canRun(), action: async () => {
      if (!await askConfirm(t('Delete the live template “{name}”? It made no views; only its script goes.', { name: data.name }), t('Delete'))) return;
      try {
        await api.recipeScripts.remove(s.id, data.id);
        await afterWrite(s, { views: false });
        status(t('Live template “{name}” deleted.', { name: data.name }));
      } catch (e) { status(errorMessage(e), true); }
    } },
  ];
}

/** The menu of an entry of a live template: its diagram, here or in a new tab. */
export function liveRecipeEntries(data) {
  return [
    { newTab: true, label: t('Open diagram'), action: () => openLiveRecipe(data.recipe, data.name) },
  ];
}
