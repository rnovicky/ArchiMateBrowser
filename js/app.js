// ArchiMate Browser — main application wiring.
// The code lives in js/app/*.js (EN-6); this file wires it to the page, in the order it starts.

import { api, isAbort, isOffline, olderThan } from './api.js';
import { initConnection, onConnectionChange, onRestored, checkNow } from './connection.js';
import { settings, saveSettings } from './config.js';
import { t, localizeStatic } from './i18n.js';
import { initPanes, paneClosed, setPaneClosed, toggleFullScreen } from './panes.js';
import { DRAG_TYPE } from './tree.js';
import { csvText, csvFile } from './csv.js';
import { loadSprites } from './archimate.js';
import { plantumlUrl } from './plantuml.js';
import { svgToString, svgToPng } from './viewsvg.js';
import { moveInMenu, moveInSubmenu } from './menu.js';
import { basketKey, updateBasket } from './app/basket.js';
import { renderDetails } from './app/details.js';
import {
  addToDiagram, dragSource, drawGenerated, exploreFrom, makeDraggable, plantumlPlaceholder, resetDiagram,
  setTab, updateToolbar,
} from './app/diagram.js';
import {
  clearHighlight, closeNodeMenu, impactPathEntries, markElements, nodeMenu, openBasketMenu, openFilterChipMenu, openPlantUmlMenu,
  openTitleMenu, openTreeMenu, withContextMenu,
} from './app/menus.js';
import {
  apiErrorText, checkCspNotes, closeSearch, linkFailed, linkStateList, linkedNew, loadLink, loadModels,
  browseLinkFiles, createNewModel, openDeleteModel, openImport, openNewModel, openLinkDialog, openSettings, previewReplace, refreshModels, runImport, runSearch, setupMenuButton,
  updateFromLink, updateModelButtons,
} from './app/models.js';
import { setupSignIn } from './app/signin.js';
import { setupChangeBar } from './app/history.js';
import {
  drillToView, filterPanel, filtersToDefault, optionsToDefault, renderDef, showElements, showNeighbourhood, updateDefaultButtons,
  updateFilterButton, updateLayoutButton,
} from './app/panels.js';
import { openLandscape, openMatrix, openQualityReport } from './app/reports.js';
import { openRecipeScript } from './app/scriptdialog.js';
import { applyHash, modelMatches, modelsOfLink, readHash, resolveHash, select, writeHash } from './app/routing.js';
import {
  PANELS, askExportOpenLines, diagramContent, elementFolders, elementRow, pngStatus, propertiesObject, setSectionCollapsed,
  showPane, showPanel, switchModel,
} from './app/shell.js';
import { $, state } from './app/state.js';
import { docPanel, installNewTabClicks } from './app/tabs.js';
import { installKeys } from './app/keys.js';
import { openPalette } from './app/palette.js';
import { initEditMode, setEditMode } from './app/editing.js';
import { NEW_PREFIX, createElementAt, installPalette, pointOf } from './app/toolbox.js';
import { exportOffline, setupOffline } from './app/offline.js';
import { RENDER_MODE, download, errorMessage, may, renderBanner, retryOnRestore, safeName, status } from './app/ui.js';
import { installRender } from './app/render.js';

localizeStatic(); // EN-7: index.html in the UI language, before anything is rendered into it
setupOffline(); // 2.20.0: an offline copy says so and hides what needs the API

onRestored(() => {
  const due = [...retryOnRestore].filter(x => x.el.isConnected);
  retryOnRestore.clear();
  if (status.last && $('#status').classList.contains('error')) status('');
  due.forEach(x => x.retry());
});

// Clicks in the PlantUML panel: select the clicked element/relationship, or
// toggle fit-to-width vs. actual size when clicking empty space.
$('#tab-plantuml').addEventListener('click', ev => {
  const hit = ev.target.closest('[data-element], [data-relationship], [data-view]');
  if (hit?.dataset.view) drillToView(Number(hit.dataset.view));
  else if (hit?.dataset.element) select('element', Number(hit.dataset.element));
  else if (hit?.dataset.relationship) select('relationship', Number(hit.dataset.relationship));
  else if (ev.target.closest('svg, img')) $('#tab-plantuml').classList.toggle('fit');
});
// CM-2: the menus of what was drawn, as in the native diagram
$('#tab-plantuml').addEventListener('contextmenu', ev => {
  if (!state.store || !ev.target.closest('svg')) return;
  ev.preventDefault();
  openPlantUmlMenu(ev.target.closest('[data-element], [data-relationship], [data-view]'), ev);
});

// CM-10 (2.18.0): a long press opens the menu on a touch screen, where no right button is (iOS Safari sends
// no contextmenu of its own; where the browser does, its own one comes first and this one is not sent)
{
  const LONG_PRESS_MS = 550, SLACK = 10;
  let press = null;
  const cancel = () => { if (press) clearTimeout(press.timer); press = null; };
  document.addEventListener('pointerdown', ev => {
    cancel();
    if (ev.pointerType !== 'touch' || !ev.isPrimary) return;
    const target = ev.target;
    press = {
      x: ev.clientX, y: ev.clientY,
      timer: setTimeout(() => {
        press = null;
        target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: ev.clientX, clientY: ev.clientY }));
        // the click that ends the press must not act as well
        document.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); }, { capture: true, once: true });
      }, LONG_PRESS_MS),
    };
  }, true);
  document.addEventListener('pointermove', ev => {
    if (press && Math.hypot(ev.clientX - press.x, ev.clientY - press.y) > SLACK) cancel();
  }, true);
  for (const type of ['pointerup', 'pointercancel']) document.addEventListener(type, cancel, true);
  document.addEventListener('contextmenu', ev => { if (ev.isTrusted) cancel(); }, true);
}

{
  const pane = $('#tab-layout');
  const accepts = e => !!state.store && [...e.dataTransfer.types].includes(DRAG_TYPE);
  pane.addEventListener('dragover', e => {
    if (!accepts(e)) return;
    e.preventDefault(); // allow the drop
    e.dataTransfer.dropEffect = 'copy';
    pane.classList.add('drop-target');
  });
  pane.addEventListener('dragleave', e => { if (!pane.contains(e.relatedTarget)) pane.classList.remove('drop-target'); });
  pane.addEventListener('drop', async e => {
    pane.classList.remove('drop-target');
    if (!accepts(e)) return;
    e.preventDefault();
    const payload = e.dataTransfer.getData(DRAG_TYPE); // read before awaiting: the DataTransfer is emptied after the event
    if (payload.startsWith(NEW_PREFIX)) { // 2.24.0: a type from the palette, a new element there
      createElementAt(payload.slice(NEW_PREFIX.length), pointOf(e));
      return;
    }
    if (payload.startsWith('view:')) status(t('Loading the view…'));
    let source;
    try { source = await dragSource(payload); } catch (err) { status(err.message, true); return; }
    const { ids, label, shape } = source;
    // drop point in diagram coordinates (only meaningful on a generated diagram)
    let at = null;
    const svg = state.gen && state.layout?.svg;
    const m = svg?.getScreenCTM();
    if (m) {
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
      at = { x: p.x, y: p.y };
    }
    addToDiagram(ids, { at, label, shape });
  });
}

{
  const pane = $('#details');
  const open = (t, at) => {
    const [kind, idStr] = t.dataset.ctx.split(':');
    const extra = kind === 'element' ? impactPathEntries(t) : [];
    const focusBack = t.matches('a') ? t : t.querySelector('a') || pane;
    return openTreeMenu({ kind, id: Number(idStr) }, { label: t.textContent.trim() }, at, focusBack, { extra });
  };
  pane.addEventListener('contextmenu', ev => {
    const t = ev.target.closest('[data-ctx]');
    if (t && pane.contains(t) && open(t, { x: ev.clientX, y: ev.clientY })) ev.preventDefault();
  });
  pane.addEventListener('keydown', ev => {
    if (!(ev.key === 'ContextMenu' || (ev.key === 'F10' && ev.shiftKey))) return;
    const t = ev.target.closest?.('[data-ctx]');
    if (!t) return;
    const r = t.getBoundingClientRect();
    if (open(t, { x: r.left + 8, y: r.bottom + 2 })) ev.preventDefault();
  });
}

{
  const panel = $('#type-filter-panel');
  panel.addEventListener('contextmenu', ev => {
    const t = ev.target.closest('[data-filter]');
    if (!t || !panel.contains(t)) return;
    ev.preventDefault();
    openFilterChipMenu(t.dataset.filter, { x: ev.clientX, y: ev.clientY });
  });
}

withContextMenu($('#diagram-title'), openTitleMenu);
$('#diagram-title').tabIndex = 0;
withContextMenu($('#view-trail'), openTitleMenu);

document.addEventListener('keydown', ev => {
  // Escape: clear a highlighted path, then the multi-selection (not while typing or in a menu/dialog)
  if (ev.key !== 'Escape' || nodeMenu || ev.target.closest?.('input, textarea, select, dialog')) return;
  if (state.highlight) clearHighlight();
  else if (state.marked.size) markElements([], 'set');
});

document.addEventListener('pointerdown', ev => { if (nodeMenu && !nodeMenu.contains(ev.target)) closeNodeMenu(); }, true);
document.addEventListener('wheel', ev => { if (nodeMenu && !nodeMenu.contains(ev.target)) closeNodeMenu(); }, { capture: true, passive: true });
document.addEventListener('keydown', ev => {
  if (!nodeMenu) return;
  if (ev.key === 'Escape') { ev.preventDefault(); closeNodeMenu({ restoreFocus: true }); return; }
  if (ev.key === 'Tab') { ev.preventDefault(); return; } // keep focus in the menu
  if (moveInSubmenu(nodeMenu, ev)) return; // CM-10: → and ←
  moveInMenu(nodeMenu, ev); // UX-6: ↑/↓ (wrapping), Home, End
});

$('#btn-options-default').addEventListener('click', optionsToDefault);
$('#btn-filters-default').addEventListener('click', filtersToDefault);
$('#settings-form').plantumlServer.addEventListener('input', checkCspNotes);
$('#settings-form').apiBase.addEventListener('input', checkCspNotes);

// a request or image the CSP blocked: say why instead of failing silently
document.addEventListener('securitypolicyviolation', ev => {
  let origin = ev.blockedURI;
  try { origin = new URL(ev.blockedURI).origin; } catch { /* 'inline', 'eval' … */ }
  console.warn('CSP blocked', ev.violatedDirective, ev.blockedURI);
  status(t('Blocked by the server\'s security policy: {origin}. Start the server with --csp-allow {origin}.', { origin }), true);
});


$('#settings-dialog').addEventListener('close', () => {
  if ($('#settings-dialog').returnValue !== 'save') return;
  const f = $('#settings-form');
  const apiChanged = f.apiBase.value.trim() !== settings.apiBase || f.apiKey.value.trim() !== settings.apiKey;
  const langChanged = f.lang.value !== (settings.lang || '');
  const pumlChanged = f.plantumlLegend.checked !== !!settings.plantumlLegend || f.plantumlSketch.checked !== !!settings.plantumlSketch;
  saveSettings({
    lang: f.lang.value,
    apiBase: f.apiBase.value.trim(), apiKey: f.apiKey.value.trim(), apiKeyRemember: f.apiKeyRemember.checked,
    plantumlServer: f.plantumlServer.value.trim(),
    plantumlLegend: f.plantumlLegend.checked, plantumlSketch: f.plantumlSketch.checked,
    wholeModelMax: Math.max(0, Math.min(5000, Math.round(Number(f.wholeModelMax.value) || 0))), // 2.28.0
  });
  // a different language reloads the page (the URL hash keeps the model, selection and diagram)
  if (langChanged) { writeHash(); location.reload(); return; }
  // only a different API needs a reload
  if (!apiChanged && state.store) {
    if (pumlChanged && state.diagramDef) { renderDef(state.diagramDef); return; } // PU-5: the PlantUML source again
    if (state.diagram && !state.diagram.pumlRequested && state.tab !== 'plantuml') plantumlPlaceholder(); // new server name in the notice
    return;
  }
  loadModels();
});

// A preview (and its confirm button) belongs to the file and choice it was made for.
$('#import-form').addEventListener('change', () => {
  $('#import-result').textContent = '';
  $('#import-result').className = 'dialog-result';
});

$('#import-form').addEventListener('submit', ev => {
  if (ev.submitter?.value !== 'import') return; // "Close"
  ev.preventDefault(); // keep the dialog open while importing
  const form = $('#import-form');
  const file = form.file.files[0];
  if (!file) return;
  if (form.replace.checked) previewReplace(file);
  else runImport(file);
});

// the Delete button only enables when the typed name matches exactly
$('#delete-form').confirmName.addEventListener('input', e => {
  $('#btn-delete-run').disabled = !state.store || e.target.value !== state.store.model.name;
});

$('#delete-form').addEventListener('submit', async ev => {
  if (ev.submitter?.value !== 'delete') return; // "Cancel"
  ev.preventDefault();
  const s = state.store;
  if (!s || $('#delete-form').confirmName.value !== s.model.name) return;
  const out = $('#delete-result');
  const btn = $('#btn-delete-run');
  btn.disabled = true;
  out.className = 'dialog-result';
  out.textContent = t('Deleting…');
  try {
    const key = basketKey();
    // T7 of the multi-user epic: only the model as this page has it; an API before 3.12.0 would refuse the
    // header when called directly (CORS), and ignores it through the proxy
    const checked = state.apiVersion && !olderThan(state.apiVersion, '3.12.0');
    await api.deleteModel(s.id, { revision: checked ? s.model.revision : undefined });
    try { localStorage.removeItem(key); } catch { /* ignore */ }
    out.className = 'dialog-result ok';
    out.textContent = t('Deleted “{name}”.', { name: s.model.name });
    state.store = null;
    resetDiagram();
    history.replaceState(null, '', '#');
    setTimeout(() => { $('#delete-dialog').close(); loadModels(); }, 700);
  } catch (e) {
    out.className = 'dialog-result error';
    out.textContent = e.status === 412
      ? t('The model was changed since this page loaded it, by {who}. Nothing was deleted: refresh it and look at the changes first.',
        { who: e.lastChange?.user || t('someone') })
      : apiErrorText(e);
    btn.disabled = false;
  }
});

$('#btn-import').addEventListener('click', openImport);
$('#btn-new-model').addEventListener('click', openNewModel); // 2.28.0
$('#new-model-form').addEventListener('submit', ev => {
  if (ev.submitter?.value !== 'create') return;
  ev.preventDefault();
  createNewModel();
});

$('#btn-linked-file').addEventListener('click', () => openLinkDialog('model'));
$('#btn-link-browse').addEventListener('click', () => browseLinkFiles()); // 2.28.0
$('#btn-link-update').addEventListener('click', () => updateFromLink());
$('#btn-link-new').addEventListener('click', () => { $('#import-dialog').close(); openLinkDialog('new'); });
$('#btn-link-now').addEventListener('click', async () => {
  const btn = $('#btn-link-now');
  btn.disabled = true;
  await updateFromLink({ out: $('#link-result') });
  btn.disabled = false;
  if (state.link) $('#link-state').replaceWith(Object.assign(linkStateList(state.link), { id: 'link-state' }));
});
$('#btn-link-remove').addEventListener('click', async () => {
  const store = state.store;
  const out = $('#link-result');
  try {
    await api.deleteLink(store.id);
    out.className = 'dialog-result ok';
    out.textContent = t('Unlinked. The model stays as it is and can be changed again.');
    $('#btn-link-remove').hidden = true;
    $('#btn-link-now').hidden = true;
    $('#btn-link-save').textContent = t('link::Link');
    $('#link-state').replaceChildren();
    await loadLink(store);
  } catch (e) {
    out.className = 'dialog-result error';
    out.textContent = apiErrorText(e);
  }
});
$('#link-form').addEventListener('submit', async ev => {
  if (ev.submitter?.value !== 'save') return;
  ev.preventDefault(); // the dialog stays open for the result
  const form = ev.target;
  const out = $('#link-result');
  const btn = $('#btn-link-save');
  const body = { path: form.path.value.trim(), intervalMinutes: form.interval.value ? Number(form.interval.value) : null };
  const store = state.store;
  const same = form.dataset.mode === 'model' && state.link?.path === body.path;
  btn.disabled = true;
  out.className = 'dialog-result';
  out.textContent = same ? t('Saving…') : t('Archi converts the file and the API imports it… this takes a few seconds.');
  // BL-57: also when the model was changed here (asked first, in linkFailed)
  const linkIt = async (o = {}) => {
    if (form.dataset.mode === 'new') {
      linkedNew(await api.createLinkedModel(body, o));
      return;
    }
    await api.putLink(store.id, body, o);
    if (same) {
      await loadLink(store); // the saved link is shown before "Saved." is
      $('#link-state').replaceWith(Object.assign(linkStateList(state.link), { id: 'link-state' }));
    }
    out.className = 'dialog-result ok';
    out.textContent = same ? t('Saved.') : t('Linked. The model was updated from the file.');
    if (!same) {
      history.replaceState(null, '', `#model=${store.id}`);
      loadModels();
    }
    $('#btn-link-save').textContent = t('Save');
    $('#btn-link-remove').hidden = false;
    $('#btn-link-now').hidden = !may('write');
  };
  try {
    await linkIt();
  } catch (e) {
    linkFailed(e, body, linkIt);
  } finally {
    btn.disabled = false;
  }
});

$('#btn-export-archimate').addEventListener('click', async () => {
  if (!state.store) return;
  const { id, model } = state.store;
  status(t('Exporting… Archi converts the model, which takes a few seconds.'));
  try {
    const res = await api.exportModel(id, { format: 'archimate' });
    download(safeName(model.name) + '.archimate', await res.blob());
    const open = Number(res.headers.get('X-Open-Lines') || 0);
    status(open ? t('Export downloaded, without {n} lines without ends (Archi refuses them).', { n: open }) : t('Export downloaded.'));
  } catch (e) { status(e.message, true); }
});
$('#btn-export-sqlite').addEventListener('click', async () => {
  if (!state.store) return;
  const { id, model } = state.store;
  status(t('Exporting…'));
  try {
    const res = await api.exportModel(id, { format: 'sqlite' });
    download(safeName(model.name) + '.sqlite', await res.blob());
    status(t('Export downloaded.'));
  } catch (e) { status(e.message, true); }
});
$('#btn-export-offline').addEventListener('click', exportOffline); // 2.20.0
$('#btn-delete-model').addEventListener('click', openDeleteModel);
$('#btn-refresh').addEventListener('click', () => refreshModels());
// ALT-4: the reports of API 3.6.0
$('#btn-report-quality').addEventListener('click', openQualityReport);
$('#btn-report-matrix').addEventListener('click', openMatrix);
$('#btn-report-landscape').addEventListener('click', openLandscape);
$('#btn-recipe-script').addEventListener('click', openRecipeScript); // 2.33.0
$('#btn-report-close').addEventListener('click', () => $('#report-dialog').close());
setupMenuButton($('#btn-model-menu'), $('#model-menu'));
setupMenuButton($('#btn-who'), $('#who-menu'));
setupSignIn();
setupChangeBar();
setupMenuButton($('#btn-share-menu'), $('#share-menu'));
setupMenuButton($('#btn-view-menu'), $('#view-menu'));

for (const section of document.querySelectorAll('.side-section')) {
  setSectionCollapsed(section, !!settings.sideCollapsed?.[section.dataset.section], { remember: false });
  section.querySelector('.side-toggle').addEventListener('click', () => setSectionCollapsed(section, !section.classList.contains('collapsed')));
}

for (const [key, [button, panel]] of Object.entries(PANELS)) {
  $(button).addEventListener('click', () => showPanel($(panel).hidden ? key : null)); // the open one closes
}

showPane('tree');
for (const b of document.querySelectorAll('#pane-switch [role=tab]')) b.addEventListener('click', () => showPane(b.dataset.pane));

// ================================================================ wiring

$('#btn-settings').addEventListener('click', openSettings);
$('#model-select').addEventListener('change', e => switchModel(e.target.value));
$('#search-form').addEventListener('submit', e => { e.preventDefault(); runSearch($('#search-input').value); });
$('#btn-search-close').addEventListener('click', closeSearch);

for (const b of document.querySelectorAll('#view-menu [data-tab]')) b.addEventListener('click', () => setTab(b.dataset.tab));

$('#opt-direction').value = settings.plantumlDirection;
$('#opt-depth').value = String(settings.neighbourDepth);
$('#opt-direction').addEventListener('change', e => {
  saveSettings({ plantumlDirection: e.target.value });
  updateDefaultButtons();
  if (!state.diagram) return;
  // generated diagrams: new ELK layout + PlantUML source; stored views keep their own layout
  // (since 2.27.0 a stored view's PlantUML source follows its own arrangement, top to bottom: PU-3)
  if (state.diagramDef && state.diagramDef.kind !== 'view') renderDef(state.diagramDef);
});
$('#opt-depth').addEventListener('change', e => {
  const depth = Number(e.target.value);
  saveSettings({ neighbourDepth: depth });
  updateDefaultButtons();
  // re-render the current neighbourhood diagram with the new depth (depth 0 = "just these elements")
  if (state.diagramDef?.kind === 'neighbourhood' && state.diagramDef.depth > 0) renderDef({ ...state.diagramDef, depth });
});

$('#opt-follow').value = settings.neighbourDirection || 'both';
$('#opt-follow').addEventListener('change', e => {
  saveSettings({ neighbourDirection: e.target.value });
  updateDefaultButtons();
  if (state.diagramDef?.kind === 'neighbourhood' && state.diagramDef.depth > 0) renderDef({ ...state.diagramDef, dir: e.target.value });
  else if (state.diagramDef?.kind === 'explore' && state.gen) drawGenerated(state.layout?.view()); // "+N" for the new direction (state.counts has both)
});

updateFilterButton();
updateLayoutButton();

$('#btn-link').addEventListener('click', async () => {
  writeHash();
  try { await navigator.clipboard.writeText(location.href); status(t('Link to this diagram copied.')); } catch { status(t('Copy failed — copy the address bar instead.'), true); }
});

$('#btn-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(state.diagram.source); status(t('PlantUML source copied.')); } catch { setTab('source'); $('#source').select(); }
});
$('#btn-dl-puml').addEventListener('click', () => download(safeName(state.diagram.title) + '.puml', state.diagram.source, 'text/plain'));
$('#btn-dl-svg').addEventListener('click', async () => {
  // native diagram unless the PlantUML tab is in front
  if (state.tab !== 'plantuml' && state.layout) {
    // the whole diagram, whatever is zoomed into
    download(safeName(state.diagram.title) + '.svg', svgToString(state.layout.svg, { bounds: state.layout.bounds() }), 'image/svg+xml');
    return;
  }
  if (!state.diagram?.url) return;
  try {
    const blob = await fetch(state.diagram.url).then(r => { if (!r.ok) throw new Error(r.statusText); return r.blob(); });
    download(safeName(state.diagram.title) + '.svg', blob);
  } catch {
    window.open(state.diagram.url, '_blank', 'noopener'); // server without CORS: let the user save it
  }
});
$('#btn-dl-png').addEventListener('click', async () => {
  const name = safeName(state.diagram?.title) + '.png';
  // native diagram (LV-3): rasterized in the browser, nothing is sent anywhere
  if (state.tab !== 'plantuml' && state.layout) {
    status(t('Creating PNG…'));
    try {
      const png = await svgToPng(state.layout.svg, { bounds: state.layout.bounds(), scale: 2 });
      download(name, png.blob);
      status(pngStatus(png, false));
    } catch (e) { status(e.message, true); }
    return;
  }
  // PlantUML tab: the server's own PNG (it has already received this source for the SVG)
  if (!state.diagram?.url) return;
  const url = await plantumlUrl(state.diagram.source, 'png');
  try {
    const blob = await fetch(url).then(r => { if (!r.ok) throw new Error(r.statusText); return r.blob(); });
    download(name, blob);
  } catch {
    window.open(url, '_blank', 'noopener'); // server without CORS: let the user save it
  }
});
$('#btn-open').addEventListener('click', () => window.open(state.diagram.url, '_blank', 'noopener'));

// ---------------------------------------------------------------- copy image, CSV and JSON of the diagram

/** Copy image: the PNG of Download .png in the clipboard (PlantUML's own PNG when PlantUML is shown). */
$('#btn-copy-png').addEventListener('click', async () => {
  let made = null;
  // the clipboard is asked at once, with a promise of the image: browsers allow it only during the click
  const blob = (async () => {
    if (state.tab !== 'plantuml' && state.layout) {
      made = await svgToPng(state.layout.svg, { bounds: state.layout.bounds(), scale: 2 });
      return made.blob;
    }
    const res = await fetch(await plantumlUrl(state.diagram.source, 'png'));
    if (!res.ok) throw new Error(res.statusText);
    return new Blob([await res.blob()], { type: 'image/png' });
  })();
  status(t('Creating PNG…'));
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    await blob; // done by now in browsers, which wait for it; for the size in the status line
    status(made ? pngStatus(made, true) : t('Image copied.'));
  } catch (e) {
    status(t('The image could not be copied ({message}). Use Download .png instead.', { message: e.message }), true);
  }
});

/** Download elements as CSV: one row per element, semicolon-separated, UTF-8 with BOM (for Excel). */
$('#btn-dl-csv').addEventListener('click', async () => {
  try {
    const s = state.store;
    const [content, folders] = await Promise.all([diagramContent(), elementFolders()]);
    const rows = content.elements.map(id => s.element(id)).filter(Boolean).map(e => elementRow(e, folders));
    const columns = ['id', 'xmiIdentifier', 'type', 'layer', 'name', 'documentation', 'folder', 'properties'];
    const table = [columns, ...rows.map(r => columns.map(c => (c === 'properties' ? JSON.stringify(r.properties) : r[c])))];
    download(safeName(`${state.diagram?.title || 'diagram'} elements`) + '.csv', csvFile(csvText(table)), 'text/csv');
    status(t('{n} element(s) downloaded as CSV.', { n: rows.length }));
  } catch (e) { status(errorMessage(e), true); }
});

/** Download as JSON: what the diagram shows, with attributes and properties (no coordinates). */
$('#btn-dl-json').addEventListener('click', async () => {
  try {
    const s = state.store, def = state.diagramDef, m = s.model;
    const [content, folders] = await Promise.all([diagramContent(), elementFolders()]);
    writeHash();
    const viewId = def.kind === 'view' ? def.id : def.notes?.view;
    const v = viewId != null ? s.view(viewId) : null;
    const fadedE = content.faded?.elements || new Set(), fadedR = content.faded?.relationships || new Set();
    const relEnd = (elementId, relationshipId) => (elementId != null
      ? { element: elementId, name: s.element(elementId)?.name ?? null }
      : { relationship: relationshipId });
    const data = {
      diagram: {
        title: state.diagram?.title ?? null, kind: def.kind, link: location.href,
        model: { id: m.id, xmiIdentifier: m.xmiIdentifier, name: m.name },
        view: v ? { id: v.id, xmiIdentifier: v.xmiIdentifier, name: v.name, viewpoint: v.viewpoint ?? null } : null,
        filters: { types: state.filter.encode() || null, property: state.props.describeFilter() || null },
        exported: new Date().toISOString(),
      },
      elements: content.elements.map(id => s.element(id)).filter(Boolean)
        .map(e => ({ ...elementRow(e, folders), ...(fadedE.has(e.id) ? { faded: true } : {}) })),
      relationships: content.relationships.map(id => s.relationship(id)).filter(Boolean).map(r => ({
        id: r.id, xmiIdentifier: r.xmiIdentifier, type: r.type, name: r.name ?? null, documentation: r.documentation ?? null,
        source: relEnd(r.sourceElementId, r.sourceRelationshipId), target: relEnd(r.targetElementId, r.targetRelationshipId),
        ...(r.accessType ? { accessType: r.accessType } : {}), ...(r.isDirected != null ? { isDirected: r.isDirected } : {}),
        ...(r.influenceModifier ? { influenceModifier: r.influenceModifier } : {}),
        properties: propertiesObject(r), ...(fadedR.has(r.id) ? { faded: true } : {}),
      })),
      notes: content.notes, groups: content.groups, viewLinks: content.viewLinks, lines: content.lines,
    };
    download(safeName(state.diagram?.title || 'diagram') + '.json', JSON.stringify(data, null, 2), 'application/json');
    status(t('Diagram downloaded as JSON: {n} element(s), {m} relationship(s).', { n: data.elements.length, m: data.relationships.length }));
  } catch (e) { status(errorMessage(e), true); }
});
$('#btn-rerender').addEventListener('click', () => {
  // edited source can only be rendered by PlantUML (explicit user action)
  state.diagram.source = $('#source').value;
  state.diagram.pumlRequested = false;
  setTab('plantuml');
});

$('#btn-basket-render').addEventListener('click', () => showElements([...state.basket], t('Basket ({n} elements)', { n: state.basket.size })));
$('#btn-basket-expand').addEventListener('click', () => showNeighbourhood([...state.basket], t('basket ({n} elements)', { n: state.basket.size })));
$('#btn-basket-explore').addEventListener('click', () => exploreFrom([...state.basket]));
makeDraggable($('#basket-label'), 'basket'); // draggable only while the basket has elements (updateBasket)
withContextMenu($('#basket-label'), openBasketMenu);
$('#btn-basket-clear').addEventListener('click', () => {
  if (state.basket.size > 5 && !confirm(t('Remove all {n} elements from the basket?', { n: state.basket.size }))) return;
  state.basket.clear();
  updateBasket();
  if (state.selection?.kind === 'element') renderDetails(state.selection);
});

$('#btn-export').addEventListener('click', async () => {
  if (!state.store) return;
  const { id, model } = state.store;
  status(t('Exporting…'));
  try {
    const check = await api.exportCheck(id);
    let omit = false;
    if (check.openLines.length) {
      const choice = await askExportOpenLines(check);
      if (!choice) { status(t('Export cancelled.')); return; }
      omit = choice === 'omit';
      status(t('Exporting…'));
    }
    const res = await api.exportModel(id, omit ? { omitOpenLines: true } : null);
    download(safeName(model.name) + '.xml', await res.blob());
    status(omit ? t('Export downloaded, without {n} connections.', { n: check.omitted }) : t('Export downloaded.'));
  } catch (e) { status(e.message, true); }
});

// deep links / manual hash edits (writeHash uses replaceState, which does not fire this)
window.addEventListener('hashchange', async ev => {
  // the link that was opened, from the event: by the time it is handled, a writeHash() of something still
  // loading may have replaced the address with the state of before (2.17.1; it made tests fail now and then)
  const hash = readHash(ev.newURL);
  const current = state.store?.model;
  // another model, or an identifier that several models share (the user picks one)
  if (!current || (hash.model && hash.model !== String(current.id)
    && (!modelMatches(hash.model, current) || modelsOfLink(hash.model).length > 1))) { loadModels(); return; }
  try {
    applyHash(await resolveHash(hash));
  } catch (e) {
    if (!isAbort(e)) status(errorMessage(e), true);
  }
});

// EN-2: API reachability banner; failed requests nobody handled (menu actions, drops) end up in the status line
initConnection({ probe: () => api.health() });
onConnectionChange(renderBanner);
$('#btn-api-retry').addEventListener('click', () => checkNow());
window.addEventListener('unhandledrejection', ev => {
  if (isAbort(ev.reason)) { ev.preventDefault(); return; }
  if (ev.reason && 'status' in ev.reason) status(errorMessage(ev.reason), true);
});

initPanes($('main.layout'), $('.tree-pane'), $('.details-pane')); // EN-7: resizable panes
// 2.28.0: close the side panes, full screen
const syncPaneToggles = () => {
  $('#btn-pane-tree').setAttribute('aria-pressed', String(paneClosed('tree')));
  $('#btn-pane-details').setAttribute('aria-pressed', String(paneClosed('details')));
  $('#btn-fullscreen').setAttribute('aria-pressed', String(!!document.fullscreenElement));
};
$('#btn-pane-tree').addEventListener('click', () => setPaneClosed('tree'));
$('#btn-pane-details').addEventListener('click', () => setPaneClosed('details'));
$('#btn-fullscreen').addEventListener('click', () => toggleFullScreen());
$('#btn-fullscreen').hidden = !document.fullscreenEnabled;
document.addEventListener('panes-changed', syncPaneToggles);
syncPaneToggles();
// BR-15: the first tab's panel takes the start hint; Ctrl- and middle-clicks open diagrams in new tabs
docPanel(state.doc).append(...document.querySelectorAll('#tab-layout > .placeholder'));
installNewTabClicks();
installKeys();
$('#btn-palette').addEventListener('click', openPalette); // CM-11: the commands (Ctrl+K)
initEditMode(); // BR-11 (2.23.0): ✎ Edit, per browser tab
installPalette(); // BR-11 step 2 (2.24.0): the palette's clicks in the diagram
$('#btn-edit-mode').addEventListener('click', () => setEditMode(!state.editMode));
// an offline copy sends nothing to a PlantUML server
// RN-1: render mode draws the native diagram (and sends nothing to a PlantUML server)
setTab(!RENDER_MODE && ['layout', 'plantuml', 'source'].includes(settings.diagramTab) && !(isOffline() && settings.diagramTab === 'plantuml') ? settings.diagramTab : 'layout');
updateBasket();
updateToolbar();
updateModelButtons();
// sprites first (badges and diagrams use them), then the model; a missing manifest just means text-only badges
// RN-1 (2.29.0): in render mode the MCP server says which model and diagram (js/app/render.js)
loadSprites().then(() => { filterPanel.redraw(); if (RENDER_MODE) installRender(); else loadModels(); });
