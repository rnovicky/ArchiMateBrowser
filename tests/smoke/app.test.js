// Smoke tests (EN-1): the whole app in an iframe, talking through the test
// server to a real API that holds the fixture model. Each test opens the app
// fresh at a URL (hash) and drives it like a user: clicks, right-clicks,
// typing, then checks what is on screen.

import { describe, test as harnessTest, assert, sleep, waitFor } from '../harness.js';
import { APP_VERSION } from '../../js/version.js';
import { MIN_API_VERSION } from '../../js/api.js';
import { E, M, V, F, R, SYN } from '../unit/fixture.js';
import { DRAG_TYPE } from '../../js/tree.js';

// the app loads, lays out (ELK) and redraws: allow more than the default 20 s per test
const test = (name, fn) => harnessTest(name, fn, { timeout: 60000 });
// 2.29.0: the tests' own writes stand for someone else, who does not check what they change (If-Match: *); the
// test API refuses a change that says no version (REQUIRE_IF_MATCH=true, tests/test_server.py)
const ANY_VERSION = { 'If-Match': '*' };

const SETTINGS = 'archixmi-browser-settings';

/**
 * Change how the API behind the test server answers; setApi({}) restores it.
 * { down } unreachable (502), { delay } slow (EN-2), { role: 'reader' } the proxy
 * uses the reader key (API-8), { old } like an API before 2.0.0, { version } /health
 * reports this version (UP-1).
 */
const setApi = state => fetch('/__test/api', { method: 'POST', body: JSON.stringify(state) });


/** What the details pane shows, for a failure message: its heading, its buttons, the link. */
function detailsState(app, what) {
  const buttons = app.$$('#details button').map(b => b.textContent).join(', ');
  return `${what} (details: “${app.$('#details h2')?.textContent ?? '–'}”; buttons: ${buttons || 'none'}; status: “${app.$('#status')?.textContent}”; hash: ${app.win.location.hash})`;
}

/**
 * Open the app at `hash` with `settings` (merged into the defaults); resolves once the model
 * named `model` is loaded (null: do not wait).
 * Browser storage starts empty unless `keepStorage` (e.g. to check what the app remembered).
 * `page`: another page of the app, such as an offline copy served by the test server (2.20.0).
 */
const offlineCopies = {};

/**
 * An offline copy of a model (2.20.0), made as "Share as offline copy" makes it and saved by the test
 * server, which serves it at the returned path; run_tests.py also opens it from disk. Made once per name.
 */
function offlineCopy(modelId, name, { password = '', scope = '' } = {}) {
  offlineCopies[name] ??= (async () => {
    const { offlinePage } = await import('../../js/offline/package.js');
    const snapshot = await fetch(`/api/v2/models/${modelId}/snapshot${scope}`).then(r => r.json());
    const html = await offlinePage(snapshot, { version: APP_VERSION, password });
    const res = await fetch(`/__test/offline-copy?name=${name}`, { method: 'POST', body: html });
    assert.equal(res.status, 200, 'saved by the test server');
    return `/__test/offline/${name}`;
  })();
  return offlineCopies[name];
}

async function openApp(hash = '', settings = {}, { keepStorage = false, model = 'Fixture Model', page = '../index.html' } = {}) {
  if (!keepStorage) {
    for (const k of Object.keys(localStorage)) if (k.startsWith('archixmi-')) localStorage.removeItem(k);
    for (const k of Object.keys(sessionStorage)) if (k.startsWith('archixmi-')) sessionStorage.removeItem(k); // open tabs (BR-15)
  }
  const current = keepStorage ? JSON.parse(localStorage.getItem(SETTINGS) || '{}') : {};
  localStorage.setItem(SETTINGS, JSON.stringify({ ...current, lang: 'en', ...settings }));
  document.querySelector('#app-frame')?.remove();
  const frame = document.createElement('iframe');
  frame.id = 'app-frame';
  frame.src = `${page}${hash}`;
  document.body.append(frame);
  await new Promise(r => frame.addEventListener('load', r, { once: true }));
  const win = frame.contentWindow, doc = frame.contentDocument;
  const $ = sel => doc.querySelector(sel);
  const $$ = sel => [...doc.querySelectorAll(sel)];
  // the model tree's root row appears once the model is loaded (the status line may already show something else)
  if (model) await waitFor(() => $$('#tree .tree-row .tree-label').some(l => l.textContent === model), { what: 'model loaded' });
  const menu = () => ($('.node-menu') ? [...doc.querySelectorAll('.node-menu button:not(.menu-new-tab)')].map(b => b.textContent) : null);
  const ctx = (el, dx = 10, dy = 5) => {
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + dx, clientY: r.top + dy }));
  };
  const clickMenu = label => {
    const b = [...doc.querySelectorAll('.node-menu button')].find(x => x.textContent.startsWith(label));
    assert.ok(b, `menu item "${label}" in ${JSON.stringify(menu())}`);
    b.click();
  };
  const treeRow = label => $$('#tree .tree-row').find(r => r.querySelector('.tree-label')?.textContent === label);
  const diagramNodes = () => $$('#tab-layout .v-node[data-element]');
  const errors = [];
  win.addEventListener('error', e => errors.push(e.message));
  win.addEventListener('unhandledrejection', e => errors.push(String(e.reason?.message || e.reason)));
  doc.addEventListener('securitypolicyviolation', e => errors.push(`CSP blocked ${e.violatedDirective}: ${e.blockedURI}`)); // EN-3
  return { frame, win, doc, $, $$, menu, ctx, clickMenu, treeRow, diagramNodes, errors };
}

describe('smoke', () => {
  test('loads the fixture model: status, tree, details', async () => {
    const app = await openApp(`#model=${M}`);
    assert.equal(app.$('#status').textContent, '244 elements · 16 relationships · 3 views');
    assert.equal(app.treeRow('Fixture Model') != null, true);
    assert.includes(app.$('#details').textContent, 'Small model for the ArchiMate Browser tests.');
    assert.deepEqual(app.errors, []);
  });

  test('tree: layers, types, lazy element lists with "show more" paging', async () => {
    const app = await openApp(`#model=${M}`);
    app.treeRow('Elements').querySelector('.tree-toggle').click();
    await waitFor(() => app.treeRow('Application'), { what: 'layer rows' });
    app.treeRow('Application').querySelector('.tree-toggle').click();
    await waitFor(() => app.treeRow('Data Object'), { what: 'type rows' });
    app.treeRow('Data Object').querySelector('.tree-toggle').click();
    await waitFor(() => app.$$('#tree .tree-more button').length, { what: '"show more" after 200 rows' });
    assert.match(app.$('#tree .tree-more button').textContent, /Show 31 more/);
  });

  test('neighbourhood diagram from a link: laid out with ELK, info line, junction passed through', async () => {
    const app = await openApp(`#model=${M}&d=nb~1~${E.erp}`);
    await waitFor(() => app.diagramNodes().length === 6, { what: '6 elements drawn', timeout: 20000 });
    assert.equal(app.$('#diagram-title').textContent, 'Neighbourhood of ERP (depth 1)');
    assert.match(app.$('#diagram-info').textContent, /^6 elements · 7 relationships/);
    assert.deepEqual(app.errors, []);
  });

  test('diagram link with a filter: hidden relationship types are not followed', async () => {
    const app = await openApp(`#model=${M}&d=nb~1~${E.erp}&f=xr:Flow`);
    await waitFor(() => app.diagramNodes().length === 4, { what: '4 elements without Flow', timeout: 20000 });
    assert.match(app.$('#btn-filters').textContent, /Filters: Custom/);
  });

  test('stored view: nesting, note, and drill-down with breadcrumbs', async () => {
    const app = await openApp(`#model=${M}&view=${V(1)}`);
    await waitFor(() => app.$('#tab-layout .v-drill'), { what: 'view drawn' });
    assert.equal(app.$('#diagram-title').textContent, 'View: Overview');
    assert.equal(app.diagramNodes().length, 5);
    app.$('#tab-layout .v-drill').dispatchEvent(new app.win.MouseEvent('click', { bubbles: true }));
    await waitFor(() => app.$('#diagram-title').textContent === 'View: Application Detail', { what: 'drilled into view 2' });
    assert.includes(app.$('#view-trail').textContent, 'Overview');
    assert.equal(app.diagramNodes().length, 6);
  });

  test('accessibility (EN-4): the tree, the diagram and the details from the keyboard', async () => {
    const app = await openApp(`#model=${M}&view=${V(1)}`);
    await waitFor(() => app.$('#tab-layout .v-drill'), { what: 'view drawn' });
    const key = (el, k, extra = {}) => el.dispatchEvent(new app.win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }));

    // the tree: levels, positions, the selected row as the active descendant
    const tree = app.$('#tree [role=tree]');
    assert.equal(tree.getAttribute('aria-label'), 'Model');
    const roots = app.$$('#tree [role=tree] > li[role=treeitem]');
    assert.equal(roots[0].getAttribute('aria-level'), '1');
    const kids = await waitFor(() => { const k = app.$$('#tree [role=tree] > li > ul > li[role=treeitem]'); return k.length > 1 && k; },
      { what: 'the branches below the model' });
    assert.deepEqual(kids.map(li => li.getAttribute('aria-level')), kids.map(() => '2'));
    assert.equal(kids[1].getAttribute('aria-posinset'), '2');
    assert.equal(kids[0].getAttribute('aria-setsize'), String(kids.length));
    tree.focus();
    key(tree, 'End');
    const last = app.$(`#${tree.getAttribute('aria-activedescendant')}`);
    assert.equal(last.getAttribute('aria-selected'), 'true');
    key(tree, 'Home');
    assert.equal(tree.getAttribute('aria-activedescendant'), roots[0].id);
    const named = app.$(`#${roots[0].getAttribute('aria-labelledby').split(' ')[0]}`).textContent;
    assert.ok(named, 'a row is named by its label');

    // the diagram: one tab stop, the arrow keys move between elements, Enter shows the details
    const svg = app.$('#tab-layout .v-node[data-element]').ownerSVGElement;
    assert.equal(svg.getAttribute('tabindex'), '0');
    svg.focus();
    key(svg, 'ArrowRight');
    const first = app.doc.activeElement;
    assert.ok(first.matches('.v-node[data-element]'), 'an element has the focus');
    assert.includes(first.getAttribute('aria-label'), ', ');
    key(first, 'ArrowRight');
    key(app.doc.activeElement, 'ArrowDown');
    const node = app.doc.activeElement;
    assert.ok(node.matches('.v-node[data-element]'));
    const name = node.getAttribute('aria-label').split(', ')[0];
    key(node, 'Enter');
    await waitFor(() => app.$('#details h2')?.textContent === name, { what: 'the details of the focused element' });
    key(node, 'F10', { shiftKey: true });
    await waitFor(() => app.menu(), { what: 'its menu from the keyboard' });
    app.doc.dispatchEvent(new app.win.KeyboardEvent('keydown', { key: 'Escape' }));
    key(node, 'Escape');
    assert.equal(app.doc.activeElement, svg, 'Escape gives the focus back to the drawing');

    // the details: a link followed there takes the focus to what it opened
    // in the tab shown (2.19.0): a link of a hidden tab cannot take the focus
    const rel = await waitFor(() => app.$('#details .detail-panel:not([hidden]) ul.rels a'), { what: 'a link in the details' });
    rel.focus();
    rel.click();
    await waitFor(() => app.doc.activeElement === app.$('#details h2') && app.$('#details h2').textContent !== name,
      { what: 'the focus on the new heading' });
    assert.deepEqual(app.errors, []);
  });

  test('filters in a stored view: what they leave out is faded, the layout stays', async () => {
    // the Overview holds a business actor, role and process (Assignments between them) and ERP with the Billing Module (Composition)
    const app = await openApp(`#model=${M}&view=${V(1)}`, { filter: 'xe:BusinessRole~xr:Composition' });
    await waitFor(() => app.$('#tab-layout .v-drill'), { what: 'view drawn' });
    assert.equal(app.diagramNodes().length, 5, 'every element is still drawn');
    const faded = () => app.$$('#tab-layout .v-node.v-faded').map(g => g.querySelector('title').textContent.split('\n')[0]);
    assert.deepEqual(faded(), ['Customer Role']);
    assert.equal(app.$$('#tab-layout .v-conn.v-faded').length, 4, 'both lines of the role, the Composition, and the line from the note to the role');
    assert.includes(app.$('#diagram-info').textContent, 'faded by the filters: 1 element(s), 1 relationship(s)');
    // no filter: nothing faded, without reloading the page
    app.$('#btn-filters').click();
    const preset = app.$('#type-filter-panel select[data-filter=viewpoint]');
    preset.value = 'all';
    preset.dispatchEvent(new app.win.Event('change'));
    await waitFor(() => !app.$('#diagram-info').textContent.includes('faded'), { what: 'the filter removed' });
    await waitFor(() => app.$('#tab-layout .v-drill') && !app.$('#tab-layout .v-faded'), { what: 'nothing faded' });
    assert.equal(app.$('#diagram-title').textContent, 'View: Overview');
    assert.deepEqual(app.errors, []);
  });

  test('collapse in a diagram (CM-13): keep the way to the selected element, or collapse around it; Back undoes it', async () => {
    const app = await openApp(`#model=${M}&d=nb~1~${E.erp}`);
    await waitFor(() => app.diagramNodes().length === 6, { what: 'the neighbourhood of ERP', timeout: 20000 });
    const node = id => app.$(`#tab-layout .v-node[data-element="${id}"]`);
    const shown = () => app.diagramNodes().map(g => Number(g.dataset.element)).sort((a, b) => a - b);
    // the server is selected; ERP folds away everything else around it
    node(E.server).dispatchEvent(new app.win.MouseEvent('click', { bubbles: true }));
    app.ctx(node(E.erp));
    const keep = app.menu().find(l => l.startsWith('Collapse, keeping the way to'));
    assert.ok(keep, `menu: ${JSON.stringify(app.menu())}`);
    assert.includes(keep, '4', 'four elements fold away');
    app.clickMenu('Collapse, keeping the way to');
    await waitFor(() => app.diagramNodes().length === 2, { what: 'collapsed to ERP and the server' });
    assert.deepEqual(shown(), [E.erp, E.server].sort((a, b) => a - b));
    assert.includes(app.$('#status').textContent, '4 elements folded away');
    assert.includes(app.win.location.hash, 'd=ex~');
    // Back brings them back
    (await waitFor(() => app.$$('#tab-layout .layout-tools button').find(b => b.textContent === '← Back'), { what: 'Back button' })).click();
    await waitFor(() => app.diagramNodes().length === 6, { what: 'back' });
    // on the selected element itself: everything around it
    node(E.erp).dispatchEvent(new app.win.MouseEvent('click', { bubbles: true }));
    app.ctx(node(E.erp));
    app.clickMenu('Collapse around this element');
    await waitFor(() => app.diagramNodes().length === 1, { what: 'collapsed around ERP' });
    // nothing left to collapse: the entry is there, but disabled
    app.ctx(node(E.erp));
    const entry = [...app.doc.querySelectorAll('.node-menu button')].find(b => b.textContent.startsWith('Collapse around this element'));
    assert.ok(entry && entry.disabled, 'disabled with nothing to fold away');
    app.doc.dispatchEvent(new app.win.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.deepEqual(app.errors, []);
  });

  test('notes in an editable copy of a view (CM-14): kept with their lines, movable, hideable, in the link', async () => {
    let app = await openApp(`#model=${M}&view=${V(1)}`);
    await waitFor(() => app.$('#tab-layout .v-drill'), { what: 'view drawn' });
    const svg = () => app.$('#tab-layout .v-node')?.ownerSVGElement;
    app.ctx(svg(), 3, 3);
    app.clickMenu('Editable copy (keeps the arrangement)');
    const note = () => app.$('#tab-layout .v-node[data-note]');
    const noteLines = () => app.$$('#tab-layout .v-conn:not([data-relationship])');
    await waitFor(() => note() && app.$('#diagram-info').textContent.includes('1 note'), { what: 'the copy with its note' });
    assert.includes(note().textContent, 'A note about the overview');
    assert.equal(noteLines().length, 1, 'the line from the note to Customer Role');
    assert.equal(noteLines()[0].dataset.tgt, `e${E.role}`);
    assert.match(app.win.location.hash, /d=ex~[^&]*~id-v1\.id-n8/);
    // the note moves, and its line with it
    const box = () => { const r = note().getBBox(); return { x: Math.round(r.x), y: Math.round(r.y) }; };
    const path = () => noteLines()[0].querySelector('path').getAttribute('d');
    const before = box(), linePath = path();
    const start = note().getBoundingClientRect();
    const pe = (target, type, d) => target.dispatchEvent(new app.win.PointerEvent(type, {
      bubbles: true, cancelable: true, button: 0, pointerId: 9, clientX: start.left + 10 + d, clientY: start.top + 10 + d,
    }));
    pe(note().querySelector('.v-note-box'), 'pointerdown', 0);
    pe(svg(), 'pointermove', 40);
    pe(svg(), 'pointermove', 80);
    pe(svg(), 'pointerup', 80);
    await waitFor(() => box().x !== before.x, { what: 'the note moved' });
    assert.ok(box().x > before.x && box().y > before.y);
    assert.ok(path() !== linePath, 'the line follows');
    // hiding Customer Role takes the line, the note stays
    app.ctx(app.$(`#tab-layout .v-node[data-element="${E.role}"]`));
    app.clickMenu('Hide from diagram');
    // (while the layout runs, the diagram shows a placeholder: wait for the redrawn diagram)
    await waitFor(() => app.diagramNodes().length && !app.$(`#tab-layout .v-node[data-element="${E.role}"]`), { what: 'Customer Role hidden' });
    assert.ok(note(), 'the note stays');
    assert.equal(noteLines().length, 0, 'its line went with the element');
    const back = async () => (await waitFor(() => app.$$('#tab-layout .layout-tools button').find(b => b.textContent === '← Back'), { what: 'Back' })).click();
    await back();
    await waitFor(() => noteLines().length === 1, { what: 'the line back' });
    // Hide note, and Back
    app.ctx(note());
    app.clickMenu('Hide note');
    await waitFor(() => app.diagramNodes().length && !note(), { what: 'the note hidden' });
    assert.equal(noteLines().length, 0);
    assert.ok(!/id-n8/.test(app.win.location.hash), 'not in the link any more');
    await back();
    await waitFor(() => note() && noteLines().length === 1, { what: 'the note back' });
    // the link brings the note (and where it was moved to)
    const link = app.win.location.hash;
    app = await openApp(link, {}, { keepStorage: false });
    await waitFor(() => app.$('#tab-layout .v-node[data-note]') && app.$$('#tab-layout .v-conn:not([data-relationship])').length === 1, { what: 'the note from the link' });
    assert.deepEqual(app.errors, []);
  });

  test('a view: the same actions in the tree and in the opened view; the automatic layout keeps its notes', async () => {
    const app = await openApp(`#model=${M}&view=${V(1)}`);
    await waitFor(() => app.$('#tab-layout .v-drill'), { what: 'view drawn' });
    const actions = ['Automatic layout of its elements', 'Editable copy (keeps the arrangement)', 'Add its elements to basket'];
    // the opened view's menu
    app.ctx(app.$('#tab-layout .v-node').ownerSVGElement, 3, 3);
    const inView = app.menu();
    app.doc.dispatchEvent(new app.win.KeyboardEvent('keydown', { key: 'Escape' }));
    // the view in the tree
    app.treeRow('Views').querySelector('.tree-toggle').click();
    const row = await waitFor(() => app.treeRow('Overview'), { what: 'view row' });
    app.ctx(row);
    const inTree = app.menu();
    const after = (list, first) => list.slice(list.indexOf(first) + 1, list.indexOf(first) + 1 + actions.length);
    assert.deepEqual(after(inView, 'View details'), actions);
    assert.deepEqual(after(inTree, 'Open view (and details)'), actions);
    // the automatic layout keeps the note and its line
    app.clickMenu('Automatic layout of its elements');
    await waitFor(() => app.$('#tab-layout .v-node[data-note]') && app.$('#diagram-info').textContent.includes('1 note'), { what: 'the layout with its note' });
    assert.equal(app.$$('#tab-layout .v-conn:not([data-relationship])').length, 1, 'the line from the note');
    assert.match(app.win.location.hash, /d=el~[^&]*~id-v1\.id-n8/);
    // hiding the note keeps the diagram an automatic layout of the elements
    app.ctx(app.$('#tab-layout .v-node[data-note]'));
    app.clickMenu('Hide note');
    await waitFor(() => app.diagramNodes().length && !app.$('#tab-layout .v-node[data-note]'), { what: 'the note hidden' });
    assert.match(app.win.location.hash, /d=el~/);
    assert.deepEqual(app.errors, []);
  });

  test('Share: copy the image, download the elements as CSV and the diagram as JSON', async () => {
    const app = await openApp(`#model=${M}&view=${V(1)}`);
    await waitFor(() => app.$('#tab-layout .v-drill'), { what: 'view drawn' });
    // downloads are caught; object URLs stay real, since the PNG is made through one
    const saved = [];
    const realUrl = app.win.URL.createObjectURL.bind(app.win.URL);
    app.win.URL.createObjectURL = blob => { saved.push(blob); return realUrl(blob); };
    app.win.HTMLAnchorElement.prototype.click = function () {};
    const next = async (button, what) => { const n = saved.length; app.$(button).click(); await waitFor(() => saved.length > n, { what }); return saved[saved.length - 1].text(); };

    // CSV: the five elements of the Overview, semicolon-separated, UTF-8 with BOM
    const csv = await next('#btn-dl-csv', 'the CSV');
    const head = new Uint8Array(await saved[saved.length - 1].slice(0, 3).arrayBuffer());
    assert.deepEqual([...head], [0xEF, 0xBB, 0xBF], 'UTF-8 with BOM (Blob.text() drops it)');
    assert.ok(csv.startsWith('"id";"xmiIdentifier";"type";"layer";"name";"documentation";"folder";"properties"'), csv.slice(0, 120));
    const rows = csv.split('\r\n');
    assert.equal(rows.length, 6, 'header and five elements');
    const erp = rows.find(r => r.includes('"ERP"')).split(';').map(c => c.slice(1, -1).replace(/""/g, '"'));
    assert.deepEqual(erp.slice(2, 5), ['ApplicationComponent', 'Application', 'ERP']);
    assert.equal(erp[6], 'Application', 'its folder');
    assert.deepEqual(JSON.parse(erp[7]), { lifecycle: 'current', owner: 'IT', cost: '120' });
    assert.includes(app.$('#status').textContent, '5 element(s) downloaded as CSV');

    // JSON: everything the view shows
    const json = JSON.parse(await next('#btn-dl-json', 'the JSON'));
    assert.equal(json.diagram.kind, 'view');
    assert.equal(json.diagram.view.name, 'Overview');
    assert.equal(json.diagram.model.name, 'Fixture Model');
    assert.equal(json.elements.length, 5);
    assert.equal(json.relationships.length, 3);
    const comp = json.relationships.find(r => r.type === 'Composition');
    assert.deepEqual([comp.source.name, comp.target.name], ['ERP', 'Billing Module']);
    assert.deepEqual(json.notes.map(n => n.text), ['A note about the overview']);
    assert.deepEqual(json.groups.map(g => [g.label, g.elements.length]), [['Business', 3]]);
    assert.deepEqual(json.viewLinks.map(l => l.viewName), ['Application Detail']);
    assert.deepEqual(json.lines, [{ from: { note: 'id-n8' }, to: { element: E.role } }]);
    assert.ok(!('x' in json.elements[0]), 'no coordinates');

    // the basket's CSV has the same format
    app.ctx(app.$(`#tab-layout .v-node[data-element="${E.erp}"]`));
    app.clickMenu('Add to basket');
    await waitFor(() => app.$('#basket-count').textContent === '1', { what: 'ERP in the basket' });
    app.ctx(app.$('#basket-label'));
    const basketCsv = await (async () => { const n = saved.length; app.clickMenu('Download as CSV'); await waitFor(() => saved.length > n, { what: 'the basket CSV' }); return saved[saved.length - 1].text(); })();
    assert.equal(basketCsv, '"name";"type";"layer";"xmi identifier"\r\n"ERP";"Application Component";"Application";"id-e6"');

    // Copy image: a PNG in the clipboard
    let copied = null;
    Object.defineProperty(app.win.navigator, 'clipboard', { configurable: true, value: { write: async items => { copied = items; } } });
    assert.equal(app.$('#btn-copy-png').disabled, false, 'offered');
    app.$('#btn-copy-png').click();
    await waitFor(() => !app.$('#status').textContent.startsWith('Creating PNG'), { what: 'the copy done' });
    assert.match(app.$('#status').textContent, /^Image copied \(\d+×\d+ px/);
    assert.deepEqual(copied[0].types, ['image/png']);
    assert.ok((await copied[0].getType('image/png')).size > 1000, 'a real PNG');
    // … also from the diagram's context menu (2.16.0)
    copied = null;
    app.ctx(app.$('#tab-layout .v-node').ownerSVGElement, 3, 3);
    app.clickMenu('Copy image');
    await waitFor(() => copied, { what: 'copied from the context menu' });
    assert.deepEqual(copied[0].types, ['image/png']);

    // an editable copy: its notes and lines come from the diagram itself
    app.ctx(app.$('#tab-layout .v-node').ownerSVGElement, 3, 3);
    app.clickMenu('Editable copy (keeps the arrangement)');
    await waitFor(() => app.$('#tab-layout .v-node[data-note]'), { what: 'the editable copy' });
    const copy = JSON.parse(await next('#btn-dl-json', 'the JSON of the copy'));
    assert.equal(copy.diagram.kind, 'explore');
    assert.equal(copy.diagram.view.name, 'Overview', 'the view the notes come from');
    assert.equal(copy.elements.length, 5);
    assert.deepEqual(copy.notes.map(n => [n.xmiIdentifier, n.text]), [['id-n8', 'A note about the overview']]);
    assert.deepEqual(copy.lines, [{ from: { note: 'id-n8' }, to: { element: E.role } }]);
    assert.deepEqual(app.errors, []);
  });

  test('context menus: tree element, diagram element (explorer), relationship line, background', async () => {
    const app = await openApp(`#model=${M}&d=nb~1~${E.erp}`);
    await waitFor(() => app.diagramNodes().length === 6, { what: 'diagram', timeout: 20000 });
    app.ctx(app.$(`#tab-layout .v-node[data-element="${E.erp}"]`));
    assert.ok(app.menu().some(l => l.startsWith('Hide from diagram')), 'Hide from diagram (with its key, Del)');
    assert.includes(app.menu(), 'Impact analysis (what is affected)');
    app.doc.dispatchEvent(new app.win.KeyboardEvent('keydown', { key: 'Escape' }));
    app.ctx(app.$('#tab-layout .v-conn[data-relationship] path'), 1, 1);
    await waitFor(() => app.menu()?.some(l => l.startsWith('Highlight')), { what: 'relationship menu' }); // after its attached relationships are asked for (UP-3)
    app.doc.dispatchEvent(new app.win.KeyboardEvent('keydown', { key: 'Escape' }));
    app.ctx(app.$('#tab-layout svg.view-svg'), 3, 3);
    assert.includes(app.menu(), 'Fit to window');
    app.doc.dispatchEvent(new app.win.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.equal(app.$('.node-menu'), null, 'Escape closes the menu');
  });

  test('BR-15: diagrams in tabs: duplicate, switch, a filter per tab, close, Ctrl- and middle-click, restored after a reload', async () => {
    let app = await openApp(`#model=${M}&d=nb~1~${E.erp}`);
    const panels = () => app.$$('#tab-layout .doc-panel');
    const shown = () => panels().find(p => !p.hidden);
    const tabs = () => app.$$('#doc-tabs .doc-tab');
    const nodesIn = p => p?.querySelectorAll('.v-node[data-element]').length ?? 0;
    await waitFor(() => nodesIn(shown()) === 6, { what: 'diagram', timeout: 20000 });
    assert.ok(!app.$('#doc-tabs').hidden && tabs().length === 1, 'one diagram: its tab is shown (2.16.0)');
    assert.equal(tabs()[0].querySelector('.doc-tab-close'), null, 'the only tab cannot be closed');
    // the same diagram in a second tab
    app.ctx(shown().querySelector('svg.view-svg'), 3, 3);
    app.clickMenu('Duplicate in a new tab');
    await waitFor(() => tabs().length === 2 && nodesIn(shown()) === 6, { what: 'the copy in a second tab', timeout: 20000 });
    const [first, second] = panels();
    assert.ok(first.hidden && !second.hidden, 'the new tab is shown');
    assert.equal(nodesIn(first), 6, 'the first keeps its drawing');
    assert.equal(tabs()[1].getAttribute('aria-selected'), 'true');
    // a filter in the second tab only
    app.win.location.hash = `#model=${M}&d=nb~1~${E.erp}&f=xr:Flow`;
    await waitFor(() => app.$('#btn-filters').textContent.startsWith('Filters:'), { what: 'a filter in the second tab' });
    tabs()[0].click();
    await waitFor(() => app.$('#btn-filters').textContent === 'Filters', { what: 'the first tab without it' });
    assert.ok(!panels()[0].hidden && panels()[1].hidden);
    assert.ok(!app.win.location.hash.includes('f='), 'the link is the tab shown');
    assert.equal(nodesIn(shown()), 6, 'switching does not draw again');
    tabs()[1].click();
    await waitFor(() => app.$('#btn-filters').textContent.startsWith('Filters:'), { what: 'the second tab with its filter' });
    // close it (after a question, 2.19.0)
    tabs()[1].querySelector('.doc-tab-close').click();
    await waitFor(() => app.$('#confirm-dialog').open, { what: 'the question' });
    app.$('#btn-confirm-ok').click();
    await waitFor(() => tabs().length === 1 && panels().length === 1, { what: 'one tab left' });
    assert.equal(app.$('#btn-filters').textContent, 'Filters');
    // Ctrl-click on a menu entry: the neighbourhood of ERP in a new tab
    app.ctx(shown().querySelector(`.v-node[data-element="${E.erp}"]`));
    const entry = app.$$('.node-menu button').find(b => b.textContent.startsWith('Neighbourhood diagram'));
    entry.dispatchEvent(new app.win.MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
    await waitFor(() => tabs().length === 2 && nodesIn(shown()) > 0, { what: 'a new tab by Ctrl-click', timeout: 20000 });
    // middle-click on a button of the details pane
    app.win.location.hash = `#model=${M}&element=${E.billingModule}`;
    const button = await waitFor(() => app.$$('#details button').find(b => b.textContent === 'Neighbourhood diagram'), { what: 'details' });
    button.dispatchEvent(new app.win.MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
    await waitFor(() => tabs().length === 3 && app.$('#diagram-title').textContent.includes('Billing Module'), { what: 'a new tab by middle-click', timeout: 20000 });
    // a reload brings the tabs back; the others are drawn when they are shown
    app = await openApp(app.win.location.hash, {}, { keepStorage: true });
    await waitFor(() => tabs().length === 3 && nodesIn(shown()) > 0, { what: 'three tabs again', timeout: 20000 });
    assert.equal(tabs()[2].getAttribute('aria-selected'), 'true', 'the tab of the link is shown');
    assert.equal(panels().length, 1, 'the others are not drawn yet');
    tabs()[0].click();
    await waitFor(() => nodesIn(shown()) === 6, { what: 'the first tab drawn when shown', timeout: 20000 });
    assert.deepEqual(app.errors, []);
  });

  test('2.20.0: "Share as offline copy" downloads one HTML file of the model', async () => {
    const app = await openApp(`#model=${M}`);
    const saved = [];
    app.win.URL.createObjectURL = blob => { saved.push(blob); return 'blob:x'; };
    app.win.HTMLAnchorElement.prototype.click = function () { saved.name = this.download; };
    const button = app.$('#btn-export-offline');
    assert.equal(button.hidden, false, 'offered with API 3.14.0');
    button.click();
    // 2.27.0: a dialog first, for a password (none here)
    const dialog = await waitFor(() => app.$('#offline-dialog')?.open && app.$('#offline-dialog'), { what: 'the options' });
    dialog.querySelector('button[value=ok]').click();
    await waitFor(() => saved.length, { what: () => `the offline copy (status: ${app.$('#status').textContent})`, timeout: 30000 });
    assert.match(saved.name, /^Fixture_Model_offline_\d{4}-\d{2}-\d{2}\.html$/);
    const html = await saved[0].text();
    assert.ok(html.startsWith('<!doctype html>'));
    assert.includes(html, '<title>Fixture Model (offline copy)</title>');
    assert.includes(html, '<body class="offline">');
    assert.match(html, /<script id="archixmi-snapshot" type="application\/octet-stream">[A-Za-z0-9+/=]{100,}<\/script>/);
    assert.notIncludes(html, '<script type="module"', 'the app is started by import(), not by a module script');
    assert.match(app.$('#status').textContent, /^Offline copy saved as Fixture_Model_offline_/);
    assert.deepEqual(app.errors, []);
  });

  test('2.20.0: an offline copy shows the model without the API, and hides what needs it', async () => {
    const page = await offlineCopy(M, 'fixture.html');
    await offlineCopy(SYN.model, 'synthetic.html'); // for run_tests.py, which opens both from disk
    let app = await openApp(`#model=${M}&element=${E.erp}&d=nb~1~${E.erp}`, {}, { page });
    // hidden by the offline rule: inside an `online-only` element that the copy does not show
    const offlineHidden = el => { const o = el?.closest('.online-only'); return !!o && app.win.getComputedStyle(o).display === 'none'; };
    assert.match(app.$('#offline-banner').textContent, /^Offline copy of “Fixture Model”, revision \d+, taken on .+ by default\. Read-only/);
    assert.equal(app.$('#offline-banner').hidden, false);
    for (const id of ['#btn-who', '#btn-import', '#btn-export', '#btn-export-offline', '#btn-refresh', '#btn-delete-model', '#btn-linked-file']) {
      assert.ok(offlineHidden(app.$(id)), `${id} is not offered`);
    }
    assert.ok(offlineHidden(app.$('#view-menu [data-tab=plantuml]')), 'nothing is sent to a PlantUML server');
    assert.ok(offlineHidden(app.$('#settings-form [name=apiBase]')), 'no API to set');
    assert.equal(offlineHidden(app.$('#btn-report-quality')), false, 'the reports are offered');
    // the neighbourhood of ERP, as online
    await waitFor(() => app.diagramNodes().length === 6, { what: 'the neighbourhood of ERP', timeout: 20000 });
    await waitFor(() => app.$('#details h2')?.textContent === 'ERP', { what: 'the details of ERP' });
    assert.deepEqual(app.$$('#details .detail-tabs [role=tab]').map(b => b.textContent.replace(/ \(\d+\)$/, '')),
      ['Properties', 'Relationships', 'Impact analysis'], 'no History: an offline copy has no record of changes');
    app.$('#details [data-tab="impact"]').click();
    await waitFor(() => /element\(s\) over/.test(app.$('#details .impact-box')?.textContent || ''), { what: 'the impact analysis' });
    // expand an element (+N), then Back
    const before = app.diagramNodes().length;
    const pill = await waitFor(() => app.$('#tab-layout .v-more'), { what: 'a +N badge' });
    pill.dispatchEvent(new app.win.MouseEvent('click', { bubbles: true }));
    await waitFor(() => app.diagramNodes().length > before, { what: 'expanded', timeout: 20000 });
    // search
    app.$('#search-input').value = 'bill';
    app.$('#search-form').requestSubmit();
    await waitFor(() => app.$$('#search-tree .tree-label').some(l => l.textContent === 'Billing Module'), { what: 'a search result' });
    // a stored view
    app.win.location.hash = `#model=${M}&view=${V(1)}`;
    await waitFor(() => app.$('#diagram-title').textContent.includes('Overview') && app.diagramNodes().length > 0, { what: 'the stored view', timeout: 20000 });
    // the folders in the tree
    const folders = app.treeRow('Folders');
    assert.ok(folders, 'the Folders branch');
    // a report
    app.$('#btn-report-quality').click();
    await waitFor(() => app.$('#report-dialog')?.open && /Elements in no view/.test(app.$('#report-dialog').textContent), { what: 'the quality report', timeout: 20000 });
    app.$('#report-dialog').close();
    // nothing went to the network but the page itself
    const requests = app.win.performance.getEntriesByType('resource').map(r => r.name).filter(n => /\/api\/|\/health/.test(n));
    assert.deepEqual(requests, [], 'no request reached the API');
    assert.deepEqual(app.errors, []);
    // a reload keeps the copy's diagram (the link is the page's own hash)
    app = await openApp(app.win.location.hash, {}, { page, keepStorage: true });
    await waitFor(() => app.diagramNodes().length > 0, { what: 'the view again after a reload', timeout: 20000 });
    assert.deepEqual(app.errors, []);
  });

  test('2.21.0 (CM-11): the details offer the actions of the menus, in their order; the commands (Ctrl+K)', async () => {
    const app = await openApp(`#model=${M}&element=${E.billingModule}`);
    await waitFor(() => app.$('#details h2')?.textContent === 'Billing Module', { what: 'element details' });
    const buttons = () => app.$$('#details .actions button').filter(b => !b.hidden).map(b => b.firstChild.textContent);
    const inOrder = (some, all, what) => {
      const at = some.map(l => all.indexOf(l));
      assert.ok(at.every(i => i >= 0) && at.every((i, k) => !k || i > at[k - 1]), `${what}: ${JSON.stringify(some)} in ${JSON.stringify(all)}`);
    };
    // an element: its menu (from a link in the details) and its buttons once it is shown
    const link = app.$(`#details a[data-ctx="element:${E.erp}"]`);
    app.ctx(link);
    const menu = app.menu();
    app.doc.dispatchEvent(new app.win.KeyboardEvent('keydown', { key: 'Escape' }));
    link.click();
    await waitFor(() => app.$('#details h2')?.textContent === 'ERP' && !app.$('#details .actions button:last-child').hidden, { what: 'ERP with its folder' });
    assert.deepEqual(buttons(), ['Neighbourhood diagram', 'Explore', 'Add to new diagram', 'Add to basket', 'Show in tree (by type)', 'Show in folders']);
    inOrder(buttons(), menu, 'the element');
    // a relationship: the same
    app.win.location.hash = `#model=${M}&relationship=${R(108)}`;
    await waitFor(() => /Serving relationship/.test(app.$('#details .kind')?.textContent || ''), { what: 'relationship details' });
    // (filed in no folder: no "Show in folders")
    assert.deepEqual(buttons(), ['Diagram of both ends', 'Neighbourhood diagram', 'Show the 1 relationship attached to it', 'Add both ends to basket', 'Show in tree']);

    // the commands: Ctrl+K, also while typing in the search
    const key = (target, k, opts = {}) => target.dispatchEvent(new app.win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
    key(app.$('#search-input'), 'k', { ctrlKey: true });
    const dialog = app.$('#palette-dialog');
    assert.ok(dialog?.open, 'the commands');
    const input = () => dialog.querySelector('input'); // made again each time the commands open
    const rows = () => [...dialog.querySelectorAll('#palette-list li[role=option] .palette-label')].map(l => l.textContent);
    const type = text => { input().value = text; input().dispatchEvent(new app.win.Event('input')); };
    assert.equal(rows()[0], 'Serving: Billing Service → Order Handling', 'what is selected comes first');
    type('billing mod');
    await waitFor(() => rows().includes('Billing Module'), { what: 'the search' });
    dialog.querySelectorAll('#palette-list li')[rows().indexOf('Billing Module')].click();
    await waitFor(() => rows().includes('Neighbourhood diagram'), { what: 'its actions' });
    assert.equal(dialog.querySelector('.palette-crumb').textContent, 'Billing Module');
    inOrder(['Details', 'Neighbourhood diagram', 'Impact analysis (what is affected)', 'Add to basket', 'Copy name'], rows(), 'the actions in the commands');
    // Backspace in the empty field goes back to the search
    key(input(), 'Backspace');
    await waitFor(() => !dialog.querySelector('.palette-crumb').textContent, { what: 'back to the search' });
    type('billing mod');
    await waitFor(() => rows().includes('Billing Module'), { what: 'the search again' });
    dialog.querySelectorAll('#palette-list li')[rows().indexOf('Billing Module')].click();
    await waitFor(() => rows().includes('Neighbourhood diagram'), { what: 'its actions again' });
    type('neighbour');
    assert.deepEqual(rows(), ['Neighbourhood diagram', 'Neighbourhood with relationship types…']); // 2.33.0: the second
    key(input(), 'Enter');
    assert.ok(!dialog.open, 'closed when an action runs');
    await waitFor(() => app.diagramNodes().length > 1 && /Billing Module/.test(app.$('#diagram-title')?.textContent || ''), { what: 'the diagram', timeout: 20000 });
    // commands of the diagram, filtered by words; the button opens them too
    app.$('#btn-palette').click();
    assert.ok(dialog.open);
    type('fit');
    assert.deepEqual(rows(), ['Fit to window']);
    type('select all');
    key(input(), 'Enter');
    await waitFor(() => app.$$('#tab-layout .v-node.marked').length === app.diagramNodes().length, { what: 'all selected from the commands' });
    // the list of keys comes from the same actions
    key(app.doc.body, '?');
    assert.includes(app.$('#keys-dialog').textContent, 'Commands: find an item');
    app.$('#keys-dialog').close();
    assert.deepEqual(app.errors, []);
  });

  test('2.19.0: closing a tab asks; Delete hides, Backspace goes back, Ctrl+A selects; hide rules by element types; +N in every diagram', async () => {
    const app = await openApp(`#model=${M}&d=nb~1~${E.orderHandling}`);
    const nodes = () => app.$$('#tab-layout .doc-panel:not([hidden]) .v-node[data-element]');
    await waitFor(() => nodes().length === 5, { what: 'the neighbourhood of Order Handling', timeout: 20000 });
    assert.ok(app.$$('#tab-layout .v-more').length > 0, 'a neighbourhood diagram shows its +N too');
    // a rule from the Filters tab with the types of both ends: Serving from Application Service to Business Process
    app.$('#btn-filters').click();
    const [type, source, target] = await waitFor(() => { const s = app.$$('#filter-panel .filter-rules select'); return s.length === 3 && s; }, { what: 'the rule lists' });
    assert.ok(source.querySelectorAll('optgroup').length >= 6, 'the element types by layer');
    const pick = (sel, value) => { sel.value = value; assert.equal(sel.value, value, `${value} offered`); };
    pick(type, 'Serving');
    pick(source, 'ApplicationService');
    pick(target, 'BusinessProcess');
    app.$$('#filter-panel .filter-rules button').find(b => b.textContent === 'Hide').click();
    const chip = await waitFor(() => app.$('#filter-panel .chip.rule'), { what: 'the rule' });
    assert.equal(chip.firstChild.textContent, 'Serving: Application Service → Business Process');
    await waitFor(() => !app.$(`#tab-layout [data-relationship="${R(108)}"]`) && nodes().length === 4, { what: 'Billing Service left out', timeout: 20000 });
    chip.querySelector('button').click();
    await waitFor(() => nodes().length === 5, { what: 'shown again', timeout: 20000 });
    // Delete hides the selected element, Backspace brings it back
    const key = (k, opts = {}) => app.doc.body.dispatchEvent(new app.win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
    app.$(`#tab-layout .v-node[data-element="${E.invoice}"]`).dispatchEvent(new app.win.MouseEvent('click', { bubbles: true }));
    await waitFor(() => app.$('#details h2')?.textContent === 'Invoice', { what: 'Invoice selected' });
    key('Delete');
    await waitFor(() => nodes().length === 4 && !app.$(`#tab-layout .v-node[data-element="${E.invoice}"]`), { what: 'Invoice hidden', timeout: 20000 });
    assert.match(app.$('#status').textContent, /hidden; Backspace/);
    key('Backspace');
    await waitFor(() => nodes().length === 5, { what: 'Back', timeout: 20000 });
    key('a', { ctrlKey: true });
    await waitFor(() => app.$$('#tab-layout .v-node.marked').length === 5, { what: 'all selected' });
    key('Escape');
    await waitFor(() => !app.$$('#tab-layout .v-node.marked').length, { what: 'the selection cleared' });
    // the keys of a text field stay its own
    app.$('#search-input').dispatchEvent(new app.win.KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
    await sleep(300);
    assert.equal(nodes().length, 5);
    key('?');
    assert.ok(app.$('#keys-dialog')?.open, 'the list of keys');
    assert.includes(app.$('#keys-dialog').textContent, 'Hide the selected elements');
    app.$('#keys-dialog').close();
    // closing a tab with a diagram asks first
    app.ctx(app.$('#tab-layout .doc-panel:not([hidden]) svg.view-svg'), 3, 3);
    assert.ok(app.menu().some(l => l.startsWith('Keyboard shortcuts')), 'the list in the diagram menu');
    app.clickMenu('Duplicate in a new tab');
    const tabs = () => app.$$('#doc-tabs .doc-tab');
    await waitFor(() => tabs().length === 2 && nodes().length === 5, { what: 'a second tab', timeout: 20000 });
    tabs()[1].querySelector('.doc-tab-close').click();
    await waitFor(() => app.$('#confirm-dialog').open, { what: 'the question' });
    assert.match(app.$('#confirm-text').textContent, /^Close the diagram “Neighbourhood of Order Handling/);
    app.$('#confirm-dialog').close('cancel');
    await sleep(200);
    assert.equal(tabs().length, 2, 'kept');
    tabs()[1].dispatchEvent(new app.win.KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
    await waitFor(() => app.$('#confirm-dialog').open, { what: 'the question for Delete' });
    app.$('#btn-confirm-ok').click();
    await waitFor(() => tabs().length === 1, { what: 'closed' });
    assert.deepEqual(app.errors, []);
  });

  test('2.19.0: the details in tabs; the folder under the name; the tab shown stays for the next item', async () => {
    const app = await openApp(`#model=${M}&element=${E.billingModule}`);
    await waitFor(() => app.$('#details h2')?.textContent === 'Billing Module', { what: 'element details' });
    const tabs = () => app.$$('#details .detail-tabs [role=tab]').map(b => b.textContent);
    const active = () => app.$('#details .detail-tabs .active')?.textContent;
    assert.deepEqual(tabs(), ['Properties', 'Relationships (5)', 'Impact analysis', 'History']);
    assert.equal(active(), 'Properties');
    const line = await waitFor(() => { const l = app.$('#details .folder-line'); return !l.hidden && l; }, { what: 'the folder' });
    assert.equal(app.$('#details h2').nextElementSibling, line, 'just below the name');
    assert.equal(line.querySelector('.folder-path').textContent, 'Application›Billing');
    const buttons = app.$$('#details .actions button').filter(b => !b.hidden).map(b => b.textContent);
    assert.deepEqual(buttons.slice(-2), ['Show in tree (by type)', 'Show in folders']);
    assert.equal(app.$('#details .impact-box'), null, 'the analysis waits until it is looked at');
    assert.includes(app.$('#detail-panel-properties').textContent, 'XMI identifier');
    assert.includes(app.$('#detail-panel-relationships').textContent, 'Outgoing relationships');
    app.$('#details [data-tab="impact"]').click();
    await waitFor(() => /element\(s\) over/.test(app.$('#details .impact-box')?.textContent || ''), { what: 'the impact analysis' });
    assert.ok(app.$('#detail-panel-properties').hidden);
    // the next element opens on the same tab
    app.win.location.hash = `#model=${M}&element=${E.erp}`;
    await waitFor(() => app.$('#details h2')?.textContent === 'ERP' && app.$('#details .impact-box'), { what: 'ERP on the Impact analysis tab' });
    assert.equal(active(), 'Impact analysis');
    // ← and → move between the tabs
    app.$('#details .detail-tabs .active').dispatchEvent(new app.win.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    assert.match(active(), /^Relationships \(\d+\)$/);
    // a relationship: the relationships attached to it; no impact analysis
    app.win.location.hash = `#model=${M}&relationship=${R(108)}`;
    await waitFor(() => /Serving relationship/.test(app.$('#details .kind')?.textContent || ''), { what: 'relationship details' });
    assert.deepEqual(tabs(), ['Properties', 'Relationships (1)', 'History']);
    assert.equal(active(), 'Relationships (1)');
    assert.includes(app.$('#detail-panel-relationships').textContent, 'complains about');
    assert.includes(app.$('#detail-panel-properties').textContent, 'Source');
    // the model: its properties and its recent changes
    app.treeRow('Fixture Model').click();
    await waitFor(() => app.$('#details h2')?.textContent === 'Fixture Model', { what: 'model details' });
    assert.deepEqual(tabs(), ['Properties', 'History']);
    assert.deepEqual(app.errors, []);
  });

  test('2.18.0: menus on the PlantUML drawing (CM-2); a long press opens a menu on a touch screen (CM-10)', async () => {
    const app = await openApp(`#model=${M}&d=nb~1~${E.erp}`);
    const conn = await waitFor(() => app.$('#tab-layout .v-conn[data-relationship]'), { what: 'diagram', timeout: 20000 });
    const relId = conn.dataset.relationship;
    // the PlantUML panel as plantuml.js leaves it: groups that carry the ids
    const panel = app.$('#tab-plantuml');
    panel.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="none"/>
      <g data-element="${E.erp}"><rect x="10" y="10" width="80" height="40"/></g>
      <g data-relationship="${relId}"><path d="M50 50 L50 150" stroke="black"/></g></svg>`;
    const right = el => el.dispatchEvent(new app.win.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    right(panel.querySelector('[data-element] rect'));
    await waitFor(() => app.menu()?.includes('Neighbourhood diagram'), { what: 'the element menu' });
    app.doc.dispatchEvent(new app.win.KeyboardEvent('keydown', { key: 'Escape' }));
    right(panel.querySelector('[data-relationship] path'));
    await waitFor(() => app.menu()?.some(l => l.startsWith('Diagram filter: hide')), { what: 'the relationship menu' });
    app.doc.dispatchEvent(new app.win.KeyboardEvent('keydown', { key: 'Escape' }));
    right(panel.querySelector('svg > rect'));
    await waitFor(() => app.menu()?.includes('Copy link'), { what: 'the diagram menu on empty space' });
    app.doc.dispatchEvent(new app.win.KeyboardEvent('keydown', { key: 'Escape' }));
    // a long press on a row of the tree
    const row = app.treeRow('Fixture Model');
    const r = row.getBoundingClientRect();
    const touch = type => row.dispatchEvent(new app.win.PointerEvent(type, {
      bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true, clientX: r.left + 10, clientY: r.top + 5 }));
    touch('pointerdown');
    await sleep(200);
    assert.equal(app.menu(), null, 'not yet');
    await waitFor(() => app.menu(), { what: 'the menu after a long press', timeout: 2000 });
    touch('pointerup');
    app.doc.dispatchEvent(new app.win.KeyboardEvent('keydown', { key: 'Escape' }));
    // a short tap opens nothing
    touch('pointerdown');
    await sleep(100);
    touch('pointerup');
    await sleep(700);
    assert.equal(app.menu(), null, 'a tap is a tap');
    assert.deepEqual(app.errors, []);
  });

  test("2.17.0: hide rules from a relationship's menu and the Filters tab; the model as an SQLite database", async () => {
    const app = await openApp(`#model=${M}&d=nb~1~${E.erp}`);
    const conns = () => app.$$('#tab-layout .doc-panel:not([hidden]) .v-conn[data-relationship]');
    await waitFor(() => app.diagramNodes().length === 6 && conns().length, { what: 'diagram', timeout: 20000 });
    const before = conns().length;
    app.ctx(conns()[0].querySelector('path'), 1, 1);
    const entry = await waitFor(() => app.menu()?.find(l => l.startsWith('Diagram filter: hide ')), { what: 'the relationship menu' });
    assert.ok(entry, 'offered on a relationship');
    app.clickMenu('Diagram filter: hide ');
    await waitFor(() => conns().length < before, { what: 'the relationship left out', timeout: 20000 });
    assert.match(app.win.location.hash, /f=hr%3A|f=hr:/, 'the rule is in the link');
    app.$('#btn-filters').click();
    const chip = await waitFor(() => app.$('#filter-panel .chip.rule'), { what: 'the rule in the Filters tab' });
    assert.equal(`Diagram filter: hide ${chip.firstChild.textContent}`, entry);
    chip.querySelector('button').click();
    await waitFor(() => conns().length === before, { what: 'shown again', timeout: 20000 });
    // the SQLite database
    const saved = [];
    app.win.URL.createObjectURL = blob => { saved.push(blob); return 'blob:x'; };
    app.win.HTMLAnchorElement.prototype.click = function () {};
    assert.equal(app.$('#btn-export-sqlite').hidden, false);
    app.$('#btn-export-sqlite').click();
    await waitFor(() => saved.length, { what: 'the database downloaded', timeout: 10000 });
    assert.equal(await saved[0].slice(0, 15).text(), 'SQLite format 3');
    assert.deepEqual(app.errors, []);
  });

  test('2.16.0: an entry that opens a diagram has an "in a new diagram" button; add to diagram then makes a new one', async () => {
    const app = await openApp(`#model=${M}&d=nb~1~${E.erp}`);
    const tabs = () => app.$$('#doc-tabs .doc-tab');
    const nodes = () => app.$$('#tab-layout .doc-panel:not([hidden]) .v-node[data-element]');
    await waitFor(() => nodes().length === 6, { what: 'diagram', timeout: 20000 });
    app.ctx(app.$(`#tab-layout .v-node[data-element="${E.erp}"]`));
    const variant = app.$$('.node-menu .menu-row').find(r => r.textContent.startsWith('Neighbourhood diagram'))?.querySelector('.menu-new-tab');
    assert.ok(variant, 'the variant is next to the entry');
    assert.equal(variant.getAttribute('aria-label'), 'Neighbourhood diagram — in a new diagram');
    variant.click();
    await waitFor(() => tabs().length === 2 && nodes().length > 0, { what: 'the neighbourhood in a second tab', timeout: 20000 });
    assert.equal(tabs()[1].getAttribute('aria-selected'), 'true');
    // a generated diagram is shown: "Add all to diagram" in a new diagram does not add to it
    const shownBefore = nodes().length;
    app.ctx(app.$(`#tab-layout .doc-panel:not([hidden]) .v-node[data-element="${E.erp}"]`));
    app.clickMenu('Add to basket');
    await waitFor(() => app.$('#basket-count').textContent === '1', { what: 'ERP in the basket' });
    app.ctx(app.$('#basket-label'));
    app.$$('.node-menu .menu-row').find(r => r.textContent.startsWith('Add all to diagram')).querySelector('.menu-new-tab').click();
    await waitFor(() => tabs().length === 3 && nodes().length === 1, { what: 'ERP alone in a third tab', timeout: 20000 });
    tabs()[1].click();
    await waitFor(() => nodes().length === shownBefore, { what: 'the second tab unchanged' });
    assert.deepEqual(app.errors, []);
  });

  test('BR-15: a diagram still loading lands in its own tab when another tab is shown meanwhile', async () => {
    const app = await openApp(`#model=${M}&d=nb~1~${E.erp}`);
    const panels = () => app.$$('#tab-layout .doc-panel');
    const tabs = () => app.$$('#doc-tabs .doc-tab');
    const nodesIn = p => p?.querySelectorAll('.v-node[data-element]').length ?? 0;
    await waitFor(() => nodesIn(panels()[0]) === 6, { what: 'diagram', timeout: 20000 });
    const title = app.$('#diagram-title').textContent, hash = app.win.location.hash;
    // Ctrl-click: a new tab starts loading the neighbourhood of another element; the first tab is shown again at once
    app.ctx(panels()[0].querySelector(`.v-node[data-element]:not([data-element="${E.erp}"])`));
    const entry = app.$$('.node-menu button').find(b => b.textContent.startsWith('Neighbourhood diagram'));
    entry.dispatchEvent(new app.win.MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
    assert.equal(tabs().length, 2, 'the new tab is there at once');
    tabs()[0].click();
    await waitFor(() => nodesIn(panels()[1]) > 0, { what: 'the second tab drawn while hidden', timeout: 20000 });
    assert.ok(panels()[1].hidden && !panels()[0].hidden, 'the first tab stays shown');
    assert.equal(nodesIn(panels()[0]), 6, 'and keeps its drawing');
    assert.equal(app.$('#diagram-title').textContent, title, 'and its title');
    assert.equal(app.win.location.hash, hash, 'and its link');
    tabs()[1].click();
    await waitFor(() => app.$('#diagram-title').textContent !== title, { what: 'the title of the second tab when shown' });
    assert.deepEqual(app.errors, []);
  });

  test('explorer: +N expands an element, ← Back restores the previous step', async () => {
    const app = await openApp(`#model=${M}&d=ex~${E.erp}~${E.erp}`);
    await waitFor(() => app.$(`#tab-layout .v-more[data-expand="${E.erp}"]`), { what: '+N badge', timeout: 20000 });
    assert.equal(app.$(`#tab-layout .v-more[data-expand="${E.erp}"] text`).textContent, '+5');
    app.$(`#tab-layout .v-more[data-expand="${E.erp}"]`).dispatchEvent(new app.win.MouseEvent('click', { bubbles: true }));
    await waitFor(() => app.diagramNodes().length === 6, { what: 'expanded to 6', timeout: 20000 });
    const back = await waitFor(() => app.$$('#tab-layout .layout-tools button').find(b => b.textContent === '← Back'), { what: 'Back button' });
    back.click();
    await waitFor(() => app.diagramNodes().length === 1, { what: 'back to 1', timeout: 20000 });
    // Follow: the badge counts in the new direction (it threw before 2026-10-20)
    const badge = () => app.$(`#tab-layout .v-more[data-expand="${E.erp}"] text`)?.textContent;
    app.$('#opt-follow').value = 'in';
    app.$('#opt-follow').dispatchEvent(new app.win.Event('change'));
    await waitFor(() => badge() !== '+5', { what: 'the incoming count' });
    app.$('#opt-follow').value = 'both';
    app.$('#opt-follow').dispatchEvent(new app.win.Event('change'));
    await waitFor(() => badge() === '+5', { what: 'both directions again' });
    assert.deepEqual(app.errors, []);
  });

  test('basket: add from the details pane, persisted per model, diagram of basket', async () => {
    let app = await openApp(`#model=${M}&element=${E.billingModule}`);
    await waitFor(() => app.$('#details h2')?.textContent === 'Billing Module', { what: 'element details' });
    [...app.doc.querySelectorAll('#details button')].find(b => b.textContent === 'Add to basket').click();
    assert.equal(app.$('#basket-count').textContent, '1');
    const stored = Object.keys(localStorage).filter(k => k.startsWith('archixmi-basket:'));
    assert.equal(stored.length, 1);
    assert.deepEqual(JSON.parse(localStorage.getItem(stored[0])), [`id-e${E.billingModule}`], 'stored by XMI identifier');
    // a new page load restores it
    app = await openApp(`#model=${M}`, {}, { keepStorage: true });
    await waitFor(() => app.$('#basket-count').textContent === '1', { what: 'basket restored' });
    assert.includes(app.$('#basket-items').textContent, 'Billing Module');
    app.$('#btn-basket-render').click();
    await waitFor(() => app.diagramNodes().length === 1, { what: 'diagram of basket', timeout: 20000 });
  });

  test('search: results with headings and a menu for all results', async () => {
    const app = await openApp(`#model=${M}`);
    app.$('#search-input').value = 'bill';
    app.$('#search-form').requestSubmit();
    await waitFor(() => app.$$('#search-tree .tree-row').length > 2, { what: 'search results' });
    const labels = app.$$('#search-tree .tree-row .tree-label').map(l => l.textContent);
    assert.includes(labels, 'Billing Module');
    assert.includes(labels, 'Billing Service');
    app.ctx(app.$$('#search-tree .tree-row').find(r => r.querySelector('.tree-label').textContent === 'Elements'));
    assert.includes(app.menu(), 'Diagram of the results');
  });

  test('multi-selection: Ctrl-click in the diagram, selection bar and menu', async () => {
    const app = await openApp(`#model=${M}&d=nb~1~${E.erp}`);
    await waitFor(() => app.diagramNodes().length === 6, { what: 'diagram', timeout: 20000 });
    for (const id of [E.erp, E.server]) app.$(`#tab-layout .v-node[data-element="${id}"]`).dispatchEvent(new app.win.MouseEvent('click', { bubbles: true, ctrlKey: true }));
    assert.equal(app.$('#multi-bar strong').textContent, '2 selected');
    app.ctx(app.$(`#tab-layout .v-node[data-element="${E.server}"]`));
    assert.includes(app.menu(), 'Impact analysis of all of them');
    app.doc.body.click(); // close the menu

    // dragging one of the selected elements moves all of them; the others stay
    const node = id => app.$(`#tab-layout .v-node[data-element="${id}"]`);
    const at = id => { const r = node(id).getBBox(); return { x: Math.round(r.x), y: Math.round(r.y) }; }; // diagram units: the fitted view rescales
    const other = app.diagramNodes().map(g => Number(g.dataset.element)).find(id => id !== E.erp && id !== E.server);
    const before = Object.fromEntries([E.erp, E.server, other].map(id => [id, at(id)]));
    const svg = node(E.erp).ownerSVGElement;
    const start = node(E.erp).getBoundingClientRect();
    const pe = (target, type, dx) => target.dispatchEvent(new app.win.PointerEvent(type, {
      bubbles: true, cancelable: true, button: 0, pointerId: 7, clientX: start.left + 20 + dx, clientY: start.top + 20 + dx,
    }));
    pe(node(E.erp).firstElementChild, 'pointerdown', 0);
    pe(svg, 'pointermove', 30);
    pe(svg, 'pointermove', 60);
    pe(svg, 'pointerup', 60);
    await waitFor(() => at(E.erp).x !== before[E.erp].x, { what: 'redrawn after the drop' });
    const shift = id => ({ x: at(id).x - before[id].x, y: at(id).y - before[id].y });
    assert.ok(shift(E.erp).x > 10 && shift(E.erp).y > 10, `ERP moved: ${JSON.stringify(shift(E.erp))}`);
    assert.deepEqual(shift(E.server), shift(E.erp), 'the other selected element moved with it');
    assert.deepEqual(shift(other), { x: 0, y: 0 }, 'an element that is not selected stayed');
    assert.deepEqual(app.errors, []);
  });

  test('Czech UI: static page, menus and plurals', async () => {
    const app = await openApp(`#model=${M}&d=nb~1~${E.erp}`, { lang: 'cs' });
    assert.equal(app.$('#btn-filters').textContent, 'Filtry');
    assert.equal(app.doc.documentElement.lang, 'cs');
    assert.equal(app.$('#status').textContent, 'prvků: 244 · vztahů: 16 · pohledů: 3');
    assert.equal(app.$('#basket-label').textContent, 'Košík: 0 prvků');
    await waitFor(() => app.diagramNodes().length === 6, { what: 'diagram', timeout: 20000 });
    assert.equal(app.$('#diagram-title').textContent, 'Okolí: ERP (hloubka 1)');
    app.ctx(app.$(`#tab-layout .v-node[data-element="${E.erp}"]`));
    assert.ok(app.menu().some(l => l.startsWith('Skrýt z diagramu')), 'Skrýt z diagramu');
  });

  test('API down: error with Retry in the diagram pane, banner, automatic recovery', async () => {
    const app = await openApp(`#model=${M}`);
    await setApi({ down: true });
    try {
      app.treeRow('Views').querySelector('.tree-toggle').click();
      (await waitFor(() => app.treeRow('Overview'), { what: 'view row' })).click();
      await waitFor(() => app.$('#tab-layout .pane-error'), { what: 'error state in the diagram pane' });
      assert.equal(app.$('#diagram-title').textContent, 'View: Overview');
      assert.ok(app.$$('#tab-layout .pane-error button').some(b => b.textContent === 'Retry'), 'Retry button');
      await waitFor(() => !app.$('#api-banner').hidden, { what: 'API-down banner' });
      assert.equal(app.$('#api-banner-title').textContent, 'The API is not reachable.');
      assert.match(app.$('#api-banner-next').textContent, /Next check in \d+ s\.|Checking…/);
    } finally {
      await setApi({});
    }
    // the banner polls /health; once it answers, the failed view loads by itself
    await waitFor(() => app.$('#api-banner').hidden, { what: 'banner gone', timeout: 10000 });
    await waitFor(() => app.diagramNodes().length === 5, { what: 'view drawn after recovery' });
    assert.deepEqual(app.errors, []);
  });

  test('API down: search shows an error with Retry; Retry works once it is back', async () => {
    const app = await openApp(`#model=${M}`);
    await setApi({ down: true });
    try {
      app.$('#search-input').value = 'bill';
      app.$('#search-form').requestSubmit();
      await waitFor(() => app.$('#search-tree .pane-error'), { what: 'search error' });
    } finally {
      await setApi({});
    }
    app.$$('#search-tree .pane-error button').find(b => b.textContent === 'Retry').click();
    await waitFor(() => app.$$('#search-tree .tree-row .tree-label').some(l => l.textContent === 'Billing Module'), { what: 'results after Retry' });
  });

  test('cancellation: a slow view is dropped when another one is chosen', async () => {
    const app = await openApp(`#model=${M}`);
    app.treeRow('Views').querySelector('.tree-toggle').click();
    await waitFor(() => app.treeRow('Overview'), { what: 'view rows' });
    await setApi({ delay: 700 });
    try {
      app.treeRow('Overview').click(); // slow …
      await new Promise(r => setTimeout(r, 100));
      app.treeRow('Application Detail').click(); // … and replaced before it arrives
      await waitFor(() => app.diagramNodes().length === 6, { what: 'second view drawn', timeout: 10000 });
      await new Promise(r => setTimeout(r, 900)); // the first one would have arrived by now
      assert.equal(app.$('#diagram-title').textContent, 'View: Application Detail');
      assert.equal(app.diagramNodes().length, 6);
    } finally {
      await setApi({});
    }
    assert.deepEqual(app.errors, []);
  });

  test('Settings: warns when the PlantUML server is not allowed by the security policy', async () => {
    const app = await openApp(`#model=${M}`);
    app.$('#btn-settings').click();
    await waitFor(() => app.$('#settings-dialog').open, { what: 'settings dialog' });
    const f = app.$('#settings-form');
    assert.equal(app.$('#plantuml-csp-note').hidden, true, 'the default server is allowed');
    f.plantumlServer.value = 'http://127.0.0.1:8088';
    f.plantumlServer.dispatchEvent(new app.win.Event('input'));
    assert.equal(app.$('#plantuml-csp-note').hidden, false);
    assert.includes(app.$('#plantuml-csp-note').textContent, '--csp-allow http://127.0.0.1:8088');
    f.apiBase.value = '/api/v2';
    f.apiBase.dispatchEvent(new app.win.Event('input'));
    assert.equal(app.$('#api-csp-note').hidden, true, 'the proxy (same origin) is always allowed');
    app.$('#settings-dialog').close('cancel');
  });

  test('PNG export and the ELK worker work under the CSP', async () => {
    const app = await openApp(`#model=${M}&d=nb~1~${E.erp}`);
    await waitFor(() => app.diagramNodes().length === 6, { what: 'diagram (ELK worker)', timeout: 20000 });
    app.win.HTMLAnchorElement.prototype.click = () => {}; // don't actually save a file
    app.$('#btn-dl-png').click();
    await waitFor(() => /PNG downloaded/.test(app.$('#status').textContent), { what: 'PNG created', timeout: 20000 });
    assert.deepEqual(app.errors, []);
  });

  // ---------------------------------------------------------------- API v2 (PLAN.md, phase 1)

  test('search (API-6): the groups of the v2 answer, best match first, with the number of hits', async () => {
    const app = await openApp(`#model=${M}`);
    app.$('#search-input').value = 'bill';
    app.$('#search-form').requestSubmit();
    await waitFor(() => app.$('#search-title').textContent === 'Search: “bill” — 3 hits', { what: 'title with the totals' });
    const groups = app.$$('#search-tree .tree-row').map(r => [r.querySelector('.tree-label').textContent, r.querySelector('.tree-sub')?.textContent])
      .filter(([label]) => label === 'Elements' || label === 'Relationships');
    assert.deepEqual(groups, [['Elements', '2'], ['Relationships', '1']]);
    assert.deepEqual(app.errors, []);
  });

  test('folders (API-11): a view filed in a folder is a view row, counted in its folder, and opens the view', async () => {
    const app = await openApp(`#model=${SYN.model}`, {}, { model: 'Synthetic Test Model' });
    const open = async label => {
      (await waitFor(() => app.treeRow(label), { what: `row ${label}` })).querySelector('.tree-toggle').click();
    };
    await open('Folders');
    // "Views" is also the name of the tree group: take the folder, which comes first
    const folder = await waitFor(() => app.$$('#tree .tree-row').find(r => r.querySelector('.tree-label')?.textContent === 'Views' && /3 views/.test(r.textContent)), { what: 'folder Views with its count' });
    folder.querySelector('.tree-toggle').click();
    await open('Overviews');
    const row = await waitFor(() => app.treeRow('Overview'), { what: 'the filed view' });
    assert.equal(app.$$('#tree .tree-row .tree-label').filter(l => l.textContent === '(folder)').length, 0, 'no unnamed folders');
    row.click();
    await waitFor(() => app.$('#diagram-title').textContent === 'View: Overview', { what: 'view opened from the folder' });
    assert.deepEqual(app.errors, []);
  });

  test('changes made elsewhere (MU-13) and the record of changes (MU-17): a bar, the history, Refresh', async () => {
    const send = async (method, path, body) => (await fetch(`/api/v2${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...ANY_VERSION }, body: body ? JSON.stringify(body) : undefined })).json();
    const made = await send('POST', '/models', { xmiIdentifier: 'id-change-test', name: 'Change Test' });
    try {
      const actor = await send('POST', `/models/${made.id}/elements`, { xmiIdentifier: 'id-ct-a', type: 'BusinessActor', name: 'Clerk' });
      const app = await openApp(`#model=${made.id}`, { changeCheckSeconds: 1 }, { model: 'Change Test' });
      assert.equal(app.$('#change-bar').hidden, true, 'nothing changed yet');
      await send('PUT', `/models/${made.id}/elements/${actor.id}`, { name: 'Senior clerk' });
      await waitFor(() => !app.$('#change-bar').hidden, { what: 'the change bar', timeout: 8000 });
      await waitFor(() => /1 change\(s\) by default/.test(app.$('#change-bar-msg').textContent), { what: 'who changed it' });
      app.$('#btn-change-show').click();
      const recent = await waitFor(() => app.$('#details .history'), { what: 'the recent changes of the model' });
      assert.includes(recent.textContent, 'name: “Clerk” → “Senior clerk”');
      app.$('#btn-change-refresh').click();
      await waitFor(() => app.$('#change-bar').hidden && app.treeRow('Change Test'), { what: 'reloaded' });
      app.win.location.hash = `#model=${made.id}&element=id-ct-a`;
      const history = await waitFor(() => app.$('#details h2')?.textContent === 'Senior clerk' && app.$('#details .history'),
        { what: 'the history of the element' });
      assert.equal(history.querySelectorAll('li').length, 2, 'created and changed');
      assert.includes(history.textContent, 'created');
      await new Promise(r => setTimeout(r, 1500));
      assert.equal(app.$('#change-bar').hidden, true, 'no bar for the revision now loaded');
      assert.deepEqual(app.errors, []);
    } finally {
      await fetch(`/api/v2/models/${made.id}`, { method: 'DELETE', headers: ANY_VERSION });
    }
  });

  test('sign in (MU-4): without a key the page asks for one; the user works as themselves and signs out', async () => {
    let app = await openApp(`#model=${M}`);
    assert.equal(app.$('#btn-who').textContent, 'default (admin)', 'the key the proxy adds');
    assert.includes(app.$('#who-text').textContent, 'Working with the key of the server');
    assert.equal(app.$('#btn-signout').hidden, true, 'nothing to sign out of');
    const post = async (path, body) => (await fetch(`/api/v2${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...ANY_VERSION }, body: JSON.stringify(body) })).json();
    const user = await post('/admin/users', { name: 'browser-tester', role: 'editor', displayName: 'Browser Tester' });
    const { key } = await post(`/admin/users/${user.id}/keys`, { label: 'Browser' });
    await setApi({ role: 'none' });
    try {
      app = await openApp(`#model=${M}`, {}, { model: null });
      await waitFor(() => app.$('#signin-dialog').open, { what: 'the sign-in dialog' });
      assert.includes(app.$('#signin-why').textContent, 'needs a key');
      assert.equal(app.$('#btn-who').textContent, 'Sign in');
      const form = app.$('#signin-form');
      form.key.value = 'not-a-key';
      form.requestSubmit(app.$('#btn-signin-run'));
      await waitFor(() => app.$('#signin-result.error'), { what: 'a wrong key refused' });
      assert.includes(app.$('#signin-result').textContent, 'invalid API key');
      form.key.value = key;
      form.requestSubmit(app.$('#btn-signin-run'));
      await waitFor(() => app.treeRow('Fixture Model'), { what: 'the model loaded with the key of the user' });
      assert.equal(app.$('#signin-dialog').open, false);
      assert.equal(app.$('#btn-who').textContent, 'Browser Tester (editor)');
      assert.includes(app.$('#who-text').textContent, 'with the key “Browser”');
      assert.equal(app.$('#btn-import').hidden, true, 'an editor is not offered Import');
      app.$('#btn-signout').click();
      await waitFor(() => app.$('#signin-dialog').open, { what: 'asked again after signing out' });
      assert.equal(app.$('#btn-who').textContent, 'Sign in');
    } finally {
      await setApi({});
      await fetch(`/api/v2/admin/users/${user.id}`, { method: 'DELETE', headers: ANY_VERSION });
    }
    assert.deepEqual(app.errors, []);
  });

  test('roles (API-8): a reader key is not offered Import and Delete; a refused request says why', async () => {
    let app = await openApp(`#model=${M}`);
    assert.equal(app.$('#btn-import').hidden, false, 'the admin key may import');
    assert.equal(app.$('#btn-delete-model').hidden, false);
    await setApi({ role: 'reader' });
    try {
      app = await openApp(`#model=${M}`);
      await waitFor(() => app.$('#btn-import').hidden && app.$('#btn-delete-model').hidden, { what: 'buttons hidden for a reader' });
      assert.equal(app.$('#btn-export').hidden, false, 'reading stays possible');
      // the delete dialog cannot be reached any more; ask the API directly, as a stale page would
      const res = await fetch(`/api/v2/models/${M}`, { method: 'DELETE', headers: ANY_VERSION });
      assert.equal(res.status, 403);
    } finally {
      await setApi({});
    }
    assert.deepEqual(app.errors, []);
  });

  test('import (BL-4), replace with a preview (BL-33, BL-34) and delete: warnings and changes are listed; the model opens, is reloaded and can be deleted', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.opengroup.org/xsd/archimate/3.0/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" identifier="id-import-test" version="1.0">
  <name xml:lang="en">Import Test</name>
  <elements><element identifier="e-a" xsi:type="BusinessActor"><name xml:lang="en">Actor</name></element></elements>
  <organizations><item><label xml:lang="en">Odd</label><item identifierRef="n-a"/></item></organizations>
  <views><diagrams><view identifier="v-a" xsi:type="Diagram"><name xml:lang="en">A view</name>
    <node identifier="n-a" xsi:type="Element" elementRef="e-a" x="10" y="10" w="120" h="55"/></view></diagrams></views>
</model>`;
    const app = await openApp(`#model=${M}`);
    app.$('#btn-import').click();
    await waitFor(() => app.$('#import-dialog').open, { what: 'import dialog' });
    const files = new app.win.DataTransfer();
    files.items.add(new app.win.File([xml], 'import-test.xml', { type: 'application/xml' }));
    app.$('#import-form').file.files = files.files;
    app.$('#import-form').requestSubmit(app.$('#btn-import-run'));
    const out = await waitFor(() => app.$('#import-result.warn'), { what: 'import result with warnings' });
    assert.includes(out.textContent, 'Imported “Import Test” as model #');
    assert.includes(out.textContent, 'The API left out 1 item or reference of the file:');
    assert.includes(out.textContent, "• Organization identifierRef 'n-a' not found");
    assert.equal(app.$('#import-dialog').open, true, 'stays open so the list can be read');
    app.$('#import-dialog').close('cancel');
    await waitFor(() => app.treeRow('Import Test'), { what: 'the imported model opened' });
    assert.equal(app.$('#status').textContent, '1 elements · 0 relationships · 1 views');

    // BL-33, BL-34: the same file again is refused; the dialog offers to replace the model,
    // shows what would change (a dry run, nothing stored) and replaces only when confirmed
    const choose = content => {
      const list = new app.win.DataTransfer();
      list.items.add(new app.win.File([content], 'import-test.xml', { type: 'application/xml' }));
      app.$('#import-form').file.files = list.files;
    };
    app.$('#btn-import').click();
    await waitFor(() => app.$('#import-dialog').open, { what: 'import dialog again' });
    assert.equal(app.$('#import-form').replace.checked, false, 'replacing is not the default');
    choose(xml);
    app.$('#import-form').requestSubmit(app.$('#btn-import-run'));
    const replaceButton = await waitFor(() => app.$('#btn-import-replace'), { what: 'the offer to replace' });
    assert.includes(app.$('#import-result').textContent, 'A model with the same identifier already exists');
    replaceButton.click();
    let confirm = await waitFor(() => app.$('#btn-import-confirm'), { what: 'the preview' });
    assert.includes(app.$('#import-result').textContent, 'Replacing “Import Test” (model #');
    assert.includes(app.$('#import-result').textContent, 'Elements: 0 added, 0 removed, 1 kept');
    assert.includes(app.$('#import-result').textContent, 'Nothing has been changed yet.');
    assert.equal(app.$('#import-form').replace.checked, true);
    const modelId = Number(app.$('#model-select').value);
    const revision = async () => (await (await fetch(`/api/v2/models/${modelId}`)).json()).revision;
    assert.equal(await revision(), 0, 'the preview stored nothing');
    confirm.click();
    let done = await waitFor(() => /Replaced “Import Test”/.test(app.$('#import-result').textContent) && app.$('#import-result'), { what: 'replaced' });
    assert.includes(done.textContent, 'Elements: 0 added, 0 removed, 1 kept');
    assert.equal(await revision(), 1);
    app.$('#import-dialog').close('cancel');
    await waitFor(() => app.$('#status').textContent === '1 elements · 0 relationships · 1 views', { what: 'reloaded' });

    // a new version of the file, with the box ticked: the preview lists the changes; the model is changed by
    // someone else before the confirmation, so the replace is refused (412); a new preview, then the replace
    const v2 = xml.replace('<name xml:lang="en">Import Test</name>', '<name xml:lang="en">Import Test v2</name>')
      .replace('</element></elements>', '</element><element identifier="e-b" xsi:type="BusinessRole"><name xml:lang="en">Role</name></element></elements>');
    app.$('#btn-import').click();
    await waitFor(() => app.$('#import-dialog').open, { what: 'import dialog a third time' });
    app.$('#import-form').replace.checked = true;
    choose(v2);
    app.$('#import-form').requestSubmit(app.$('#btn-import-run'));
    confirm = await waitFor(() => app.$('#btn-import-confirm'), { what: 'the preview of v2' });
    let preview = app.$('#import-result').textContent;
    assert.includes(preview, 'Elements: 1 added, 0 removed, 1 kept');
    assert.includes(preview, 'Added elements:\n• Role (Business Role) · e-b', 'by name and type (BR-16, API 3.10.0)');
    const [actor] = (await (await fetch(`/api/v2/models/${modelId}/elements`)).json()).items;
    const put = await fetch(`/api/v2/models/${modelId}/elements/${actor.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', ...ANY_VERSION }, body: JSON.stringify({ name: 'Actor, renamed' }),
    });
    assert.equal(put.status, 200);
    confirm.click();
    await waitFor(() => app.$('#import-result.error'), { what: 'the replace refused' });
    assert.includes(app.$('#import-result').textContent, 'The model was changed after the check');
    assert.equal(await revision(), 2, 'only the rename happened');
    app.$('#import-form').requestSubmit(app.$('#btn-import-run'));
    confirm = await waitFor(() => app.$('#btn-import-confirm'), { what: 'a new preview' });
    assert.includes(app.$('#import-result').textContent, 'Changed elements:\n• Actor (Business Actor) · e-a: name “Actor, renamed” → “Actor”',
      'the rename made meanwhile is undone by the replace, and the preview says so (BR-16)');
    confirm.click();
    done = await waitFor(() => /Replaced “Import Test v2”/.test(app.$('#import-result').textContent) && app.$('#import-result'), { what: 'replaced by v2' });
    assert.includes(done.textContent, 'Elements: 1 added, 0 removed, 1 kept');
    assert.includes(done.textContent, 'Views: 0 added, 0 removed, 1 kept');
    app.$('#import-dialog').close('cancel');
    await waitFor(() => app.$('#status').textContent === '2 elements · 0 relationships · 1 views', { what: 'v2 opened' });
    assert.equal(app.$('#model-select').selectedOptions[0].textContent, 'Import Test v2');

    // … and delete it again
    app.$('#btn-delete-model').click();
    await waitFor(() => app.$('#delete-dialog').open, { what: 'delete dialog' });
    app.$('#delete-form').confirmName.value = 'Import Test v2';
    app.$('#delete-form').confirmName.dispatchEvent(new app.win.Event('input'));
    app.$('#delete-form').requestSubmit(app.$('#btn-delete-run'));
    await waitFor(() => app.treeRow('Fixture Model'), { what: 'back on the first model', timeout: 10000 });
    assert.deepEqual([...app.$('#model-select').options].map(o => o.textContent), ['Fixture Model', 'Synthetic Test Model']);
    assert.deepEqual(app.errors, []);
  });

  test('refresh (BR-21): a model and an element made elsewhere appear, from the model menu and the tree', async () => {
    const app = await openApp(`#model=${M}`);
    const post = (path, body) => fetch(`/api/v2${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ANY_VERSION }, body: JSON.stringify(body) });
    const made = await (await post('/models', { xmiIdentifier: 'id-refresh-test', name: 'Refresh Test' })).json();
    try {
      assert.ok(![...app.$('#model-select').options].some(o => o.textContent === 'Refresh Test'), 'not there before');
      app.$('#btn-refresh').click();
      await waitFor(() => [...app.$('#model-select').options].some(o => o.textContent === 'Refresh Test'), { what: 'the new model listed' });
      await waitFor(() => app.treeRow('Fixture Model'), { what: 'the open model again' });
      app.$('#model-select').value = String(made.id);
      app.$('#model-select').dispatchEvent(new app.win.Event('change'));
      await waitFor(() => app.treeRow('Refresh Test') && /^0 elements/.test(app.$('#status').textContent), { what: 'the new model opened' });
      assert.equal((await post(`/models/${made.id}/elements`, { xmiIdentifier: 'id-r1', type: 'BusinessActor', name: 'Clerk' })).status, 201);
      app.ctx(app.treeRow('Refresh Test'));
      app.clickMenu('Refresh');
      await waitFor(() => /^1 elements/.test(app.$('#status').textContent), { what: 'the element counted after the refresh' });
      assert.equal(app.$('#model-select').value, String(made.id), 'the same model stays open');
    } finally {
      await fetch(`/api/v2/models/${made.id}`, { method: 'DELETE', headers: ANY_VERSION });
    }
    assert.deepEqual(app.errors, []);
  });

  test('delete model (T7, API 3.12.0): refused when someone changed the model after the page loaded it', async () => {
    const post = (path, body) => fetch(`/api/v2${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ANY_VERSION }, body: JSON.stringify(body) });
    const made = await (await post('/models', { xmiIdentifier: 'id-delete-check', name: 'Delete Check' })).json();
    try {
      const app = await openApp(`#model=${made.id}`, {}, { model: 'Delete Check' });
      await waitFor(() => app.treeRow('Delete Check') && /^0 elements/.test(app.$('#status').textContent), { what: 'the model opened' });
      assert.equal((await post(`/models/${made.id}/elements`, { xmiIdentifier: 'id-d1', type: 'BusinessActor', name: 'Clerk' })).status, 201);
      app.$('#btn-delete-model').click();
      await waitFor(() => app.$('#delete-dialog').open, { what: 'delete dialog' });
      app.$('#delete-form').confirmName.value = 'Delete Check';
      app.$('#delete-form').confirmName.dispatchEvent(new app.win.Event('input'));
      app.$('#delete-form').requestSubmit(app.$('#btn-delete-run'));
      const out = await waitFor(() => app.$('#delete-result').classList.contains('error') && app.$('#delete-result'), { what: 'refused' });
      assert.includes(out.textContent, 'The model was changed since this page loaded it, by default. Nothing was deleted');
      assert.equal((await fetch(`/api/v2/models/${made.id}`)).status, 200, 'the model is still there');
      assert.equal(app.$('#btn-delete-run').disabled, false);
      app.$('#delete-dialog').close('cancel');
      assert.deepEqual(app.errors, []);
    } finally {
      await fetch(`/api/v2/models/${made.id}`, { method: 'DELETE', headers: ANY_VERSION });
    }
  });

  test('models that share an identifier (API 2.10.0): import a copy, replace one of them, a link asks which one', async () => {
    const file = name => `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.opengroup.org/xsd/archimate/3.0/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" identifier="id-copies" version="1.0">
  <name xml:lang="en">${name}</name>
  <elements><element identifier="e-a" xsi:type="ApplicationComponent"><name xml:lang="en">Alpha</name></element></elements>
</model>`;
    const fd = new FormData();
    fd.append('file', new Blob([file('Copy Test')], { type: 'application/xml' }), 'copies.xml');
    const original = (await (await fetch('/api/v2/models/import', { method: 'POST', body: fd })).json()).model.id;
    let copy = null, linked = null;
    try {
      let app = await openApp(`#model=${M}`);
      const choose = content => {
        const list = new app.win.DataTransfer();
        list.items.add(new app.win.File([content], 'copies.xml', { type: 'application/xml' }));
        app.$('#import-form').file.files = list.files;
      };
      // a copy of the file (another name, the same identifier) is refused, and can be imported as a separate model
      app.$('#btn-import').click();
      choose(file('Copy Test 2'));
      app.$('#import-form').requestSubmit(app.$('#btn-import-run'));
      const asNew = await waitFor(() => app.$('#btn-import-new'), { what: 'the offer to import a copy' });
      assert.includes(app.$('#import-result').textContent, `A model with the same identifier already exists: Copy Test (model #${original}, revision 0).`);
      assert.ok(app.$('#btn-import-replace'), 'replacing is offered too');
      asNew.click();
      await waitFor(() => /Imported “Copy Test 2” as model #\d+/.test(app.$('#import-result').textContent), { what: 'the copy imported' });
      copy = Number(app.$('#import-result').textContent.match(/#(\d+)/)[1]);
      assert.ok(copy !== original);
      await waitFor(() => app.$('#model-select').value === String(copy) && app.treeRow('Copy Test 2'), { what: 'the copy opened' });
      // its links name it by id: the identifier names two models now
      await waitFor(() => app.win.location.hash.includes(`model=${copy}`), { what: 'the copy by id in the hash' });

      // the original file again, to replace: two models have its identifier, the one with its name comes first
      app.$('#btn-import').click();
      app.$('#import-form').replace.checked = true;
      choose(file('Copy Test'));
      app.$('#import-form').requestSubmit(app.$('#btn-import-run'));
      await waitFor(() => app.$$('#import-result button.import-replace').length === 2, { what: 'one button per model' });
      assert.includes(app.$('#import-result').textContent, '2 models with the identifier of this file are there already:');
      assert.deepEqual(app.$$('#import-result button.import-replace').map(b => [Number(b.dataset.model), b.textContent]),
        [[original, `Replace “Copy Test” (#${original})`], [copy, `Replace “Copy Test 2” (#${copy})`]]);
      app.$('#btn-import-replace').click();
      const confirm = await waitFor(() => app.$('#btn-import-confirm'), { what: 'the preview' });
      assert.includes(app.$('#import-result').textContent, `Replacing “Copy Test” (model #${original})`);
      confirm.click();
      await waitFor(() => /Replaced “Copy Test”/.test(app.$('#import-result').textContent), { what: 'replaced' });
      const revision = async id => (await (await fetch(`/api/v2/models/${id}`)).json()).revision;
      assert.deepEqual([await revision(original), await revision(copy)], [1, 0]);
      app.$('#import-dialog').close('cancel');

      // a link by the identifier names both: the user picks one
      app = await openApp('#model=id-copies', {}, { model: null });
      await waitFor(() => app.$('#choose-model-dialog').open, { what: 'which model?' });
      assert.includes(app.$('#choose-model-text').textContent, 'an identifier that 2 models share');
      const options = app.$$('#choose-model-list button');
      assert.deepEqual(options.map(b => b.textContent), [`Copy Test (model #${original}, revision 1)`, `Copy Test 2 (model #${copy}, revision 0)`]);
      options[1].click();
      await waitFor(() => app.treeRow('Copy Test 2'), { what: 'the picked model opened' });
      await waitFor(() => app.win.location.hash.includes(`model=${copy}`), { what: 'written again by id' });
      // cancelled: the oldest
      app = await openApp('#model=id-copies', {}, { model: null });
      await waitFor(() => app.$('#choose-model-dialog').open, { what: 'which model? again' });
      app.$('#choose-model-dialog').close('cancel');
      await waitFor(() => app.treeRow('Copy Test'), { what: 'the oldest opened' });

      // linking a file with that identifier: link one of them, or import a separate model
      const path = (await (await fetch('/__test/linked-file?name=Copies.archimate', { method: 'POST', body: file('Copy Test 3') })).json()).path;
      app.$('#btn-import').click();
      app.$('#btn-link-new').click();
      app.$('#link-form').path.value = path;
      app.$('#link-form').requestSubmit(app.$('#btn-link-save'));
      await waitFor(() => app.$$('#link-result button.link-candidate').length === 2, { what: 'the models to link' });
      assert.includes(app.$('#link-result').textContent, 'The file holds a model that is there already');
      app.$('#btn-link-as-new').click();
      await waitFor(() => /Imported “Copy Test 3” as model #\d+ and linked it to the file/.test(app.$('#link-result').textContent), { what: 'linked as a separate model' });
      linked = Number(app.$('#link-result').textContent.match(/#(\d+)/)[1]);
      assert.ok(![original, copy].includes(linked));
      app.$('#link-dialog').close();
      assert.deepEqual(app.errors, []);
    } finally {
      for (const id of [original, copy, linked]) if (id) await fetch(`/api/v2/models/${id}`, { method: 'DELETE', headers: ANY_VERSION });
    }
  });

  test('menus of the page: model actions and export open, move with the keyboard and close with Escape', async () => {
    const app = await openApp(`#model=${SYN.model}`, {}, { model: 'Synthetic Test Model' });
    const trigger = app.$('#btn-model-menu'), menu = app.$('#model-menu');
    assert.equal(menu.hidden, true);
    trigger.click();
    assert.equal(menu.hidden, false);
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    assert.equal(app.doc.activeElement, app.$('#btn-refresh'), 'the first item has the focus');
    const key = k => app.doc.activeElement.dispatchEvent(new app.win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    key('ArrowDown');
    assert.equal(app.doc.activeElement, app.$('#btn-new-model'), 'New model… (2.28.0), then Import model…');
    key('ArrowDown');
    assert.equal(app.doc.activeElement, app.$('#btn-import'));
    key('End');
    assert.equal(app.doc.activeElement, app.$('#btn-delete-model'));
    key('ArrowDown');
    assert.equal(app.doc.activeElement, app.$('#btn-refresh'), 'wraps around');
    key('Escape');
    assert.equal(menu.hidden, true);
    assert.equal(app.doc.activeElement, trigger, 'Escape returns to the button');
    // a click outside closes it
    trigger.click();
    app.$('#tree').dispatchEvent(new app.win.PointerEvent('pointerdown', { bubbles: true }));
    assert.equal(menu.hidden, true);
    // Share: disabled without a diagram; with one, Copy link and the downloads work from the menu
    assert.equal(app.$('#btn-share-menu').disabled, true, 'nothing to share yet');
    app.win.location.hash = `#model=${SYN.model}&d=ty~ApplicationComponent`;
    await waitFor(() => app.diagramNodes().length > 0, { what: 'type diagram' });
    await waitFor(() => !app.$('#btn-share-menu').disabled, { what: 'share enabled' });
    app.$('#btn-share-menu').click();
    assert.equal(app.$('#share-menu').hidden, false);
    assert.equal(app.$('#model-menu').hidden, true, 'one menu at a time');
    assert.equal(app.$('#btn-link').disabled, false);
    assert.equal(app.$('#btn-dl-svg').disabled, false);
    assert.ok(app.$('#share-menu').contains(app.$('#btn-link')), 'Copy link is in the Share menu');
    // ⋮ next to it: Diagram, PlantUML or Source, the one shown ticked
    const view = () => app.$$('#view-menu [role=menuitemradio]').map(b => `${b.textContent}:${b.getAttribute('aria-checked')}`);
    assert.deepEqual(view(), ['Diagram:true', 'PlantUML:false', 'Source:false']);
    app.$('#btn-view-menu').click();
    assert.equal(app.$('#view-menu').hidden, false);
    assert.equal(app.$('#share-menu').hidden, true);
    assert.equal(app.doc.activeElement.textContent, 'Diagram', 'the radio items take the focus');
    app.$('#view-menu [data-tab=source]').click();
    assert.equal(app.$('#view-menu').hidden, true, 'a choice closes the menu');
    assert.equal(app.$('#tab-source').hidden, false);
    assert.equal(app.$('#tab-layout').hidden, true);
    assert.deepEqual(view(), ['Diagram:false', 'PlantUML:false', 'Source:true']);
    app.$('#view-menu [data-tab=layout]').click();
    assert.equal(app.$('#tab-layout').hidden, false);
    // the model's details: metadata blocks are shown as such (they were printed as "[object …]")
    app.treeRow('Synthetic Test Model').click();
    await waitFor(() => /Dublin Core/.test(app.$('#details').textContent), { what: 'model metadata' });
    assert.equal(/\[object /.test(app.$('#details').textContent), false);
    assert.deepEqual(app.errors, []);
  });

  test('links and moved elements by XMI identifier (BR-17), folders by path (BR-18): they survive a replace that gives everything new ids', async () => {
    const file = (extra, extraFolder = '') => `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.opengroup.org/xsd/archimate/3.0/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" identifier="id-br17" version="1.0">
  <name xml:lang="en">Refs Test</name>
  <elements>${extra}
    <element identifier="e-a" xsi:type="ApplicationComponent"><name xml:lang="en">Alpha</name></element>
    <element identifier="e-b" xsi:type="ApplicationService"><name xml:lang="en">Beta</name></element>
  </elements>
  <relationships><relationship identifier="r-ab" source="e-a" target="e-b" xsi:type="Realization"/></relationships>
  <organizations>${extraFolder}<item><label xml:lang="en">Apps</label><item><label xml:lang="en">Core / main</label><item identifierRef="e-a"/></item></item></organizations>
</model>`;
    const send = async (xml, query = '') => {
      const fd = new FormData();
      fd.append('file', new Blob([xml], { type: 'application/xml' }), 'refs.xml');
      const res = await fetch(`/api/v2/models/import${query}`, { method: 'POST', body: fd });
      assert.ok(res.ok, `import ${res.status}`);
      return (await res.json()).model;
    };
    const model = await send(file(''));
    const idsOf = async () => Object.fromEntries((await (await fetch(`/api/v2/models/${model.id}/elements`)).json()).items.map(e => [e.xmiIdentifier, e.id]));
    const before = await idsOf();
    try {
      // a link written with ids, as before BR-17, opens and is written again with XMI identifiers
      let app = await openApp(`#model=${model.id}&element=${before['e-a']}&d=nb~1~${before['e-a']}`, {}, { model: 'Refs Test' });
      await waitFor(() => app.diagramNodes().length === 2, { what: 'neighbourhood of Alpha' });
      await waitFor(() => app.win.location.hash.includes('d=nb~1~e-a'), { what: 'hash with references' });
      assert.includes(app.win.location.hash, 'model=id-br17');
      assert.includes(app.win.location.hash, 'element=e-a');
      // moved elements: a pinned Beta arrives with a link, is stored, and is written with its identifier
      app = await openApp(`#model=id-br17&d=nb~1~e-a&m=TB.n0!!ee-b.400.300`, {}, { model: 'Refs Test' });
      await waitFor(() => app.diagramNodes().length === 2, { what: 'the linked diagram' });
      await waitFor(() => /m=TB\.n0!!ee-b\.400\.300/.test(app.win.location.hash), { what: 'the pin in the hash' });
      const stored = JSON.parse(localStorage.getItem('archixmi-manual-layouts') || '{}');
      const key = Object.keys(stored).find(k => k.includes('|nb~1~e-a|'));
      assert.ok(key, `stored by reference: ${Object.keys(stored).join(', ')}`);
      assert.equal(stored[key].p, 'ee-b.400.300');

      // a new version of the file, with an element first: every element gets a new id
      const folderId = async () => (await (await fetch(`/api/v2/models/${model.id}/organizations`)).json())
      .find(o => o.label === 'Apps').children.find(o => o.label === 'Core / main').id;
    const folderBefore = await folderId();
    // BR-18: a folder without an identifier is named by its path of labels
    const app0 = await openApp(`#model=id-br17&folder=${folderBefore}&d=fo~${folderBefore}`, {}, { keepStorage: true, model: 'Refs Test' });
    await waitFor(() => app0.diagramNodes().length === 1, { what: 'folder diagram' });
    await waitFor(() => app0.win.location.hash.includes('d=fo~@Apps:Core*20*2F*20main'), { what: 'folder path in the hash' });
    assert.includes(app0.win.location.hash, 'folder=@Apps:Core*20*2F*20main');
    await send(file('<element identifier="e-new" xsi:type="Node"><name xml:lang="en">New</name></element>',
      '<item><label xml:lang="en">Zero</label></item>'), '?replace=true');
    assert.ok(await folderId() !== folderBefore, 'the folder has a new id');
      const after = await idsOf();
      assert.ok(after['e-a'] !== before['e-a'] && after['e-b'] !== before['e-b'], `new ids: ${JSON.stringify({ before, after })}`);

      // the same link (and the stored pin) still work
      app = await openApp(`#model=id-br17&element=e-a&d=nb~1~e-a`, {}, { keepStorage: true, model: 'Refs Test' });
      await waitFor(() => app.diagramNodes().length === 2, { what: 'neighbourhood of Alpha after the replace' });
      assert.deepEqual(app.diagramNodes().map(n => Number(n.dataset.element)).sort(), [after['e-a'], after['e-b']].sort());
      await waitFor(() => app.$('#details h2')?.textContent === 'Alpha', { what: 'Alpha selected' });
      await waitFor(() => /m=TB\.n0!!ee-b\.400\.300/.test(app.win.location.hash), { what: 'the stored pin found again' });

      // the folder link too
      app = await openApp('#model=id-br17&folder=@Apps:Core*20*2F*20main&d=fo~@Apps:Core*20*2F*20main', {}, { model: 'Refs Test' });
      await waitFor(() => app.diagramNodes().length === 1, { what: 'folder diagram after the replace' });
      await waitFor(() => app.$('#details h2')?.textContent === 'Core / main', { what: 'the folder selected' });

      // what the model no longer has is left out, and said
      app.win.location.hash = '#model=id-br17&d=el~e-a.e-gone';
      await waitFor(() => /1 item of the link is not in this model any more/.test(app.$('#status').textContent), { what: 'the missing item' });
      await waitFor(() => app.diagramNodes().length === 1, { what: 'Alpha alone' });
      assert.deepEqual(app.errors, []);
    } finally {
      await fetch(`/api/v2/models/${model.id}`, { method: 'DELETE', headers: ANY_VERSION });
    }
  });

  test('export of a model with lines without ends (BL-41): asks, and can leave them out', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.opengroup.org/xsd/archimate/3.0/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" identifier="id-bl41" version="1.0">
  <name xml:lang="en">Open Lines Test</name>
  <elements><element identifier="e-a" xsi:type="ApplicationComponent"><name xml:lang="en">Alpha</name></element></elements>
  <views><diagrams><view identifier="v-1" xsi:type="Diagram"><name xml:lang="en">Lines</name>
    <node identifier="n-a" x="20" y="20" w="120" h="55" xsi:type="Element" elementRef="e-a"/>
    <connection identifier="l-free" xsi:type="Line"><bendpoint x="20" y="200"/><bendpoint x="300" y="200"/></connection>
    <connection identifier="l-on-free" xsi:type="Line" source="n-a" target="l-free"/>
  </view></diagrams></views>
</model>`;
    const fd = new FormData();
    fd.append('file', new Blob([xml], { type: 'application/xml' }), 'lines.xml');
    const imported = await fetch('/api/v2/models/import', { method: 'POST', body: fd });
    assert.equal(imported.status, 201);
    const { model } = await imported.json();
    try {
      const app = await openApp(`#model=${model.id}`, {}, { model: 'Open Lines Test' });
      // capture the downloads instead of saving them
      const saved = [];
      app.win.URL.createObjectURL = blob => { saved.push(blob); return 'about:blank'; };
      app.win.HTMLAnchorElement.prototype.click = function () {};
      const exportWith = async choice => {
        app.$('#btn-export').click();
        await waitFor(() => app.$('#export-dialog').open, { what: 'the export dialog' });
        app.$('#export-dialog').close(choice);
      };
      await exportWith('cancel');
      await waitFor(() => app.$('#status').textContent === 'Export cancelled.', { what: 'cancelled' });
      assert.equal(saved.length, 0);
      assert.includes(app.$('#export-text').textContent, 'The model has 1 line without ends.');
      assert.includes(app.$('#export-text').textContent, 'connections that end on them: 2 in all');
      assert.deepEqual(app.$$('#export-lines li').map(li => li.textContent), ['Lines: l-free (no source and no target)']);

      await exportWith('all');
      await waitFor(() => saved.length === 1, { what: 'the full export' });
      assert.includes(await saved[0].text(), 'identifier="l-free"');
      assert.equal(app.$('#status').textContent, 'Export downloaded.');

      await exportWith('omit');
      await waitFor(() => saved.length === 2, { what: 'the export without the lines' });
      const omitted = await saved[1].text();
      assert.ok(!omitted.includes('l-free') && omitted.includes('n-a'), 'both lines left out, the node kept');
      assert.equal(app.$('#status').textContent, 'Export downloaded, without 2 connections.');
      assert.deepEqual(app.errors, []);
    } finally {
      await fetch(`/api/v2/models/${model.id}`, { method: 'DELETE', headers: ANY_VERSION });
    }
  });

  test('linked model (BR-20): link a file on the server, update from it, change the interval, unlink; export .archimate', async () => {
    // The test server's API converts ".archimate" files with a stand-in for Archi that copies them,
    // so these files hold exchange XML.
    const file = name => `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.opengroup.org/xsd/archimate/3.0/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" identifier="id-br20" version="1.0">
  <name xml:lang="en">Linked Test</name>
  <elements><element identifier="e-a" xsi:type="ApplicationComponent"><name xml:lang="en">${name}</name></element></elements>
</model>`;
    const put = async xml => (await (await fetch('/__test/linked-file?name=Linked.archimate', { method: 'POST', body: xml })).json()).path;
    const path = await put(file('Alpha'));
    let modelId = null;
    try {
      const app = await openApp(`#model=${M}`);
      // from the import dialog: link a file on the server
      app.$('#btn-import').click();
      app.$('#btn-link-new').click();
      assert.equal(app.$('#import-dialog').open, false);
      assert.equal(app.$('#link-dialog').open, true);
      assert.equal(app.$('#link-title').textContent, 'Link a file on the server');
      const form = app.$('#link-form');
      form.path.value = path;
      form.requestSubmit(app.$('#btn-link-save'));
      await waitFor(() => /Imported “Linked Test” as model #\d+ and linked it to the file/.test(app.$('#link-result').textContent), { what: 'linked' });
      modelId = Number(app.$('#link-result').textContent.match(/#(\d+)/)[1]);
      app.$('#link-dialog').close();
      await waitFor(() => app.$('#model-select').value === String(modelId) && app.$('#status').textContent.startsWith('1 elements'), { what: 'the linked model opened' });
      await waitFor(() => !app.$('#btn-link-update').hidden, { what: 'Update from file offered' });

      // the model's details show the link
      await waitFor(() => app.$('#details').textContent.includes('Linked file'), { what: 'the link in the details' });
      assert.includes(app.$('#details .link-state').textContent, 'Linked.archimate');
      assert.includes(app.$('#details .link-state').textContent, 'by hand only');

      // update: nothing changed; then a new version of the file
      app.$('#btn-link-update').click();
      await waitFor(() => app.$('#status').textContent === 'The file has not changed since the last update.', { what: 'unchanged' });
      await put(file('Alpha, version 2'));
      app.$('#btn-link-update').click();
      await waitFor(() => /Updated “Linked Test” \(model #\d+\) from the file/.test(app.$('#status').textContent) || app.$('#status').textContent === '1 elements · 0 relationships · 0 views', { what: 'updated' });
      const names = async () => (await (await fetch(`/api/v2/models/${modelId}/elements`)).json()).items.map(e => e.name);
      await waitFor(async () => (await names())[0] === 'Alpha, version 2', { what: 'the new name' });

      // read-only while linked
      const [element] = (await (await fetch(`/api/v2/models/${modelId}/elements`)).json()).items;
      const edit = await fetch(`/api/v2/models/${modelId}/elements/${element.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', ...ANY_VERSION }, body: JSON.stringify({ name: 'Edited' }),
      });
      assert.equal(edit.status, 409);
      // BR-11 (2.23.0): and so the Browser offers no editing, and says why
      assert.equal(app.$('#btn-edit-mode').disabled, true);
      assert.includes(app.$('#btn-edit-mode').title, 'linked to a file');

      // the dialog: change the interval
      await waitFor(() => !app.$('#btn-linked-file').hidden, { what: 'Linked file… offered' });
      app.$('#btn-linked-file').click();
      assert.equal(app.$('#link-title').textContent, 'Linked file');
      assert.equal(app.$('#link-form').path.value, path);
      assert.equal(app.$('#btn-link-save').textContent, 'Save');
      app.$('#link-form').interval.value = '15';
      app.$('#link-form').requestSubmit(app.$('#btn-link-save'));
      await waitFor(() => app.$('#link-result').textContent === 'Saved.', { what: 'saved' });
      assert.includes(app.$('#link-state').textContent, 'every 15 min');
      assert.includes(app.$('#link-state').textContent, 'Next check');

      // export .archimate (the stand-in for Archi copies the exchange file)
      const saved = [];
      app.win.URL.createObjectURL = blob => { saved.push(blob); return 'about:blank'; };
      app.win.HTMLAnchorElement.prototype.click = function () {};

      // unlink: the model stays and can be changed again
      app.$('#btn-link-remove').click();
      await waitFor(() => app.$('#link-result').textContent.startsWith('Unlinked.'), { what: 'unlinked' });
      assert.equal((await fetch(`/api/v2/models/${modelId}/link`)).status, 404);
      app.$('#link-dialog').close();
      await waitFor(() => app.$('#btn-link-update').hidden, { what: 'Update from file gone' });
      app.$('#btn-export-archimate').click();
      await waitFor(() => saved.length === 1, { what: 'the .archimate export' });
      assert.includes(await saved[0].text(), 'Alpha, version 2');
      assert.equal(app.$('#status').textContent, 'Export downloaded.');
      assert.deepEqual(app.errors, []);
    } finally {
      if (modelId) await fetch(`/api/v2/models/${modelId}`, { method: 'DELETE', headers: ANY_VERSION });
    }
  });

  test('search results belong to their model: another model closes them, also a search still on its way', async () => {
    const app = await openApp(`#model=${M}`);
    await waitFor(() => app.$('#status').textContent.includes('elements'), { what: 'fixture model' });
    const search = q => { app.$('#search-input').value = q; app.$('#search-form').requestSubmit(); };
    search('billing');
    await waitFor(() => !app.$('#search-results').hidden && app.$('#search-tree').textContent.includes('Billing Module'), { what: 'results' });
    const switchTo = id => {
      app.$('#model-select').value = String(id);
      app.$('#model-select').dispatchEvent(new app.win.Event('change'));
    };
    switchTo(SYN.model);
    await waitFor(() => app.$('#status').textContent.startsWith('30 elements'), { what: 'the synthetic model' });
    assert.equal(app.$('#search-results').hidden, true, 'the fixture model\'s results are gone');
    assert.equal(app.$('#search-input').value, '');
    assert.ok(!app.$('#search-tree').textContent.includes('Billing Module'), 'nor are they kept in the list');
    // a search sent just before another model is chosen does not show up there
    await setApi({ delay: 600 });
    try {
      search('erp');
      switchTo(M);
    } finally {
      await setApi({});
    }
    await waitFor(() => app.$('#model-select').value === String(M) && app.$('#status').textContent.includes('elements'), { what: 'back to the fixture model' });
    await new Promise(r => setTimeout(r, 800));
    assert.equal(app.$('#search-results').hidden, true, 'the late answer was dropped');
    assert.deepEqual(app.errors, []);
  });

  test('property definitions: values in the tree, a value\'s menu, the property\'s details, clickable definitions', async () => {
    const app = await openApp(`#model=${SYN.model}`, {}, { model: 'Synthetic Test Model' });
    await waitFor(() => app.treeRow('Property definitions'), { what: 'the tree' });
    app.treeRow('Property definitions').querySelector('.tree-toggle').click();
    await waitFor(() => app.treeRow('Owner'), { what: 'the definitions' });
    // the values elements give a property, most frequent first, with their counts (the API's index)
    app.treeRow('Owner').querySelector('.tree-toggle').click();
    const values = () => [...app.treeRow('Owner').closest('li').querySelectorAll(':scope > ul .tree-row')]
      .map(r => `${r.querySelector('.tree-label').textContent} ${r.querySelector('.tree-sub')?.textContent ?? ''}`.trim());
    await waitFor(() => values().length > 0, { what: 'the values of Owner' });
    assert.deepEqual(values().slice(0, 2), ['Finance 3', 'Sales 2']);
    assert.equal(values().length, 4);

    // the property's menu no longer lists values; a value's menu filters by it
    app.ctx(app.treeRow('Owner'));
    assert.ok(!app.menu().some(l => l.startsWith('Only where')), JSON.stringify(app.menu()));
    assert.ok(app.menu().includes('Only elements where it is set7'), 'with the number of elements that have it');
    app.doc.dispatchEvent(new app.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    app.ctx(app.treeRow('Finance'));
    assert.ok(app.menu().some(l => l.startsWith('Only elements where Owner = “Finance”')), JSON.stringify(app.menu()));
    app.clickMenu('Only elements where Owner = “Finance”');
    app.ctx(app.treeRow('Finance'));
    assert.ok(app.menu().some(l => l.startsWith('Remove the property filter')), 'the filter is set');
    assert.equal([...app.doc.querySelectorAll('.node-menu button')].find(b => b.textContent.startsWith('Only elements where Owner')).disabled, true);
    app.doc.dispatchEvent(new app.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    // selecting the property (or a value) shows its details
    app.treeRow('Owner').click();
    await waitFor(() => app.$('#details h2')?.textContent === 'Owner', { what: 'the details of Owner' });
    const details = app.$('#details').textContent;
    for (const part of ['Data type', 'string', 'Elements with it', 'Different values', 'Values', 'Finance CZ']) assert.includes(details, part);
    // a value in the details finds the items that have it
    [...app.$$('#details a')].find(a => a.textContent === 'Sales').click();
    await waitFor(() => !app.$('#search-results').hidden && app.$('#search-input').value === '@Owner=Sales', { what: 'the search for Sales' });

    // the overview of the definitions: each name leads to its details
    app.treeRow('Property definitions').click();
    await waitFor(() => app.$('#details h2')?.textContent === '3 definitions', { what: 'the overview' });
    [...app.$$('#details a')].find(a => a.textContent === 'Cost').click();
    await waitFor(() => app.$('#details h2')?.textContent === 'Cost', { what: 'the details of Cost' });
    assert.deepEqual(app.errors, []);
  });

  test('nesting in the Layout tab (off, everywhere, only inside a Grouping, Assignment), carried in links', async () => {
    const core = ['grp-core', 'app-erp', 'app-erp-billing', 'app-erp-stock', 'app-kafka'].map(x => SYN.elements[x]).join('.');
    const app = await openApp(`#model=${SYN.model}&d=el~${core}`, {}, { model: 'Synthetic Test Model' });
    await waitFor(() => app.diagramNodes().length === 5, { what: 'the five elements' });
    assert.equal(app.$('#settings-form').nestGenerated, undefined, 'no longer in Settings');
    app.$('#btn-layout').click();
    const radio = value => app.$(`#layout-panel input[name=layout-nesting][value=${value}]`);
    const assignment = () => app.$('#layout-panel input[name=layout-nesting-assignment]');
    assert.equal(radio('off').checked, true);
    assert.equal(assignment().disabled, true, 'Assignment only with nesting');
    const nested = n => waitFor(() => app.$('#diagram-info').textContent.includes(`${n} relationship(s) shown as nesting`), { what: `${n} nested` });
    // everywhere: Core Systems around ERP and Kafka, ERP around its parts
    radio('all').click();
    await nested(4);
    assert.includes(app.win.location.hash, 'n=1');
    // only inside a Grouping: ERP's parts are lines again
    radio('grouping').click();
    await nested(2);
    assert.includes(app.win.location.hash, 'n=3');
    assignment().click();
    await waitFor(() => app.win.location.hash.includes('n=4'), { what: 'and Assignment' });
    assert.equal(radio('grouping').checked, true);
    radio('off').click();
    await waitFor(() => app.win.location.hash.includes('n=0') && !app.$('#diagram-info').textContent.includes('shown as nesting'), { what: 'off' });
    // a link brings its nesting
    const linked = await openApp(`#model=${SYN.model}&d=el~${core}&n=3`, {}, { model: 'Synthetic Test Model', keepStorage: true });
    await waitFor(() => linked.$('#diagram-info').textContent.includes('2 relationship(s) shown as nesting'), { what: 'the link\'s nesting' });
    linked.$('#btn-layout').click();
    assert.equal(linked.$('#layout-panel input[name=layout-nesting][value=grouping]').checked, true);
    assert.deepEqual([...app.errors, ...linked.errors], []);
  });

  test('Label and Colour by in the Layout tab: for generated diagrams and stored views', async () => {
    const core = ['grp-core', 'app-erp', 'app-erp-billing', 'app-erp-stock', 'app-kafka'].map(x => SYN.elements[x]).join('.');
    const app = await openApp(`#model=${SYN.model}&d=el~${core}`, {}, { model: 'Synthetic Test Model' });
    await waitFor(() => app.diagramNodes().length === 5, { what: 'the five elements' });
    app.$('#btn-filters').click();
    assert.ok(!app.$('#filter-panel').textContent.includes('Colour by'), 'no longer in the Filters tab');
    assert.ok(app.$('#filter-panel').textContent.includes('Only where'), 'the property filter stays there');
    app.$('#btn-layout').click();
    const select = aria => app.$(`#layout-panel select[aria-label="${aria}"]`);
    assert.ok(select('Colour elements by property') && select('Show property in labels'), 'both in the Layout tab');
    select('Colour elements by property').value = 'Cost';
    select('Colour elements by property').dispatchEvent(new app.win.Event('change'));
    await waitFor(() => app.$('#diagram-info').textContent.includes('coloured by “Cost”'), { what: 'coloured' });
    assert.equal(app.$('#btn-layout').textContent, 'Layout: colour: Cost');
    assert.equal(app.$('#btn-filters').textContent, 'Filters');
    assert.equal(select('Colour elements by property').value, 'Cost', 'the panel is drawn again with the choice');
    select('Show property in labels').value = 'Owner';
    select('Show property in labels').dispatchEvent(new app.win.Event('change'));
    await waitFor(() => app.$('#btn-layout').textContent === 'Layout: colour: Cost · label: Owner', { what: 'label too' });
    // a stored view is coloured as well
    app.win.location.hash = `#model=${SYN.model}&view=${SYN.views['v-overview']}`;
    await waitFor(() => app.$('#diagram-title').textContent.startsWith('View:'), { what: 'the stored view', timeout: 8000 });
    await waitFor(() => app.$('#diagram-info').textContent.includes('coloured by “Cost”'), { what: 'the stored view coloured', timeout: 5000 });
    assert.deepEqual(app.errors, []);
  });

  test('Set to default in the Options, Filters and Layout tabs: each resets only its own settings', async () => {
    const stored = () => JSON.parse(localStorage.getItem(SETTINGS));
    const app = await openApp(`#model=${M}`, {
      plantumlDirection: 'LR', neighbourDepth: 2, neighbourDirection: 'out', filter: 'xr:Flow',
      propertyOptions: 'l:cost~c:cost~f:lifecycle.eq.CURRENT~g:cs', nestGenerated: true, layoutPrefs: 's0.6_t7_la_pa_ro_h1',
    });
    const button = id => app.$(`#btn-${id}-default`);
    // Options
    app.$('#btn-options').click();
    assert.equal(button('options').disabled, false);
    button('options').click();
    assert.deepEqual([app.$('#opt-direction').value, app.$('#opt-depth').value, app.$('#opt-follow').value], ['TB', '1', 'both']);
    assert.deepEqual([stored().plantumlDirection, stored().neighbourDepth, stored().neighbourDirection], ['TB', 1, 'both']);
    assert.equal(button('options').disabled, true);
    // Filters: types, property filter and language; Label and Colour by stay
    app.$('#btn-filters').click();
    assert.equal(button('filters').disabled, false);
    button('filters').click();
    assert.equal(app.$('#btn-filters').textContent, 'Filters');
    assert.equal(stored().filter, '');
    assert.equal(stored().propertyOptions, 'l:cost~c:cost');
    assert.equal(button('filters').disabled, true);
    // Layout: preset, nesting, Label and Colour by
    app.$('#btn-layout').click();
    assert.match(app.$('#btn-layout').textContent, /^Layout: Compact · colour: cost · label: cost$/);
    assert.equal(button('layout').disabled, false);
    button('layout').click();
    await waitFor(() => app.$('#btn-layout').textContent === 'Layout', { what: 'the Layout tab at its defaults' });
    assert.deepEqual([stored().layoutPrefs, stored().nestGenerated, stored().propertyOptions], ['', false, '']);
    assert.equal(app.$('#layout-panel input[name=layout-nesting][value=off]').checked, true);
    assert.equal(button('layout').disabled, true);
    // a change enables the button again
    app.$('#btn-options').click();
    app.$('#opt-depth').value = '3';
    app.$('#opt-depth').dispatchEvent(new app.win.Event('change'));
    assert.equal(button('options').disabled, false);
    assert.deepEqual(app.errors, []);
  });

  test('another model: a property filter, label or colour on a property it does not have is removed', async () => {
    const stored = () => JSON.parse(localStorage.getItem(SETTINGS)).propertyOptions;
    let app = await openApp(`#model=${M}`, { propertyOptions: 'l:lifecycle~c:lifecycle~f:lifecycle.eq.CURRENT' });
    assert.match(app.$('#btn-filters').textContent, /lifecycle/);
    app.$('#model-select').value = String(SYN.model);
    app.$('#model-select').dispatchEvent(new app.win.Event('change'));
    await waitFor(() => app.$('#status').textContent.includes('removed, this model has no such property'), { what: 'the options removed' });
    assert.includes(app.$('#status').textContent, 'property filter on “lifecycle”, label “lifecycle”, colour by “lifecycle”');
    assert.equal(app.$('#btn-filters').textContent, 'Filters');
    assert.equal(app.$('#btn-layout').textContent, 'Layout');
    assert.equal(stored(), '');
    // only what is missing goes, also for the model opened first: elements of the synthetic model have Cost, not lifecycle
    app = await openApp(`#model=${SYN.model}`, { propertyOptions: 'l:Cost~c:lifecycle' }, { model: 'Synthetic Test Model' });
    await waitFor(() => app.$('#status').textContent.includes('removed, this model has no such property: colour by “lifecycle”'), { what: 'the colour removed' });
    assert.equal(stored(), 'l:Cost', 'the label on a property the model has stays');
    // the fixture model names it "cost": the label goes there; with nothing left, the next model removes nothing
    app.$('#model-select').value = String(M);
    app.$('#model-select').dispatchEvent(new app.win.Event('change'));
    await waitFor(() => app.$('#status').textContent.includes('removed, this model has no such property: label “Cost”'), { what: 'the label removed' });
    app.$('#model-select').value = String(SYN.model);
    app.$('#model-select').dispatchEvent(new app.win.Event('change'));
    await waitFor(() => app.$('#status').textContent.startsWith('30 elements'), { what: 'the synthetic model again' });
    assert.ok(!app.$('#status').textContent.includes('removed'));
    assert.deepEqual(app.errors, []);
  });

  test('empty basket hint (UX-5) and options that do not change the diagram shown (UX-4)', async () => {
    const app = await openApp(`#model=${M}`);
    const shown = sel => app.$(sel).offsetParent !== null;
    assert.ok(app.$('#basket').classList.contains('empty'));
    assert.ok(shown('#basket-hint'), 'the hint');
    assert.equal(shown('#btn-basket-render'), false, 'no disabled buttons');
    app.win.location.hash = `#model=${M}&element=${E.erp}`;
    const add = await waitFor(() => app.$$('#details button').find(b => b.textContent === 'Add to basket'), { what: () => detailsState(app, 'Add to basket') });
    add.click();
    await waitFor(() => !app.$('#basket').classList.contains('empty'), { what: 'basket filled' });
    assert.ok(shown('#btn-basket-render'));
    assert.equal(shown('#basket-hint'), false);

    const inactive = sel => app.$(sel).closest('label').classList.contains('inactive');
    assert.deepEqual(['#opt-direction', '#opt-depth', '#opt-follow'].map(inactive), [false, false, false], 'no diagram: nothing marked');
    app.win.location.hash = `#model=${M}&d=v~${V(1)}`;
    await waitFor(() => inactive('#opt-direction'), { what: 'a stored view' });
    assert.includes(app.$('#opt-direction').closest('label').title, 'stored view keeps its own layout');
    assert.equal(app.$('#opt-depth').disabled, false, 'still usable for the next neighbourhood diagram');
    app.win.location.hash = `#model=${M}&d=nb~1~${E.erp}`;
    await waitFor(() => !inactive('#opt-direction') && !inactive('#opt-depth') && !inactive('#opt-follow'), { what: 'a neighbourhood' });
    assert.equal(app.$('#opt-follow').closest('label').title, 'Which relationships the neighbourhood walk follows from each element', 'its own tooltip back');
    app.win.location.hash = `#model=${M}&d=ty~ApplicationComponent`;
    await waitFor(() => inactive('#opt-depth') && inactive('#opt-follow') && !inactive('#opt-direction'), { what: 'a type diagram' });
    assert.deepEqual(app.errors, []);
  });

  test('narrow windows (UX-1, UX-2): one pane at a time, the diagram options behind a button', async () => {
    const app = await openApp(`#model=${M}`);
    app.frame.style.width = '600px';
    const display = sel => app.win.getComputedStyle(app.$(sel)).display;
    await waitFor(() => display('#pane-switch') !== 'none', { what: 'the pane switcher' });
    assert.equal(app.doc.body.dataset.pane, 'tree');
    assert.deepEqual(['.tree-pane', '.diagram-pane', '.details-pane'].map(display).map(d => d !== 'none'), [true, false, false]);
    // an item picked in the tree shows its details
    app.treeRow('Fixture Model').click();
    await waitFor(() => app.doc.body.dataset.pane === 'details', { what: 'details pane' });
    assert.ok(display('.details-pane') !== 'none', '.details-pane shown');
    // a diagram brings its pane forward
    app.win.location.hash = `#model=${M}&d=nb~1~${E.erp}`;
    await waitFor(() => app.doc.body.dataset.pane === 'diagram' && app.diagramNodes().length > 0, { what: 'diagram pane' });
    assert.equal(display('.tree-pane'), 'none');
    // the switcher
    app.$('#pane-switch [data-pane=tree]').click();
    assert.equal(app.$('#pane-switch [data-pane=tree]').getAttribute('aria-selected'), 'true');
    assert.ok(display('.tree-pane') !== 'none', '.tree-pane shown');
    app.$('#pane-switch [data-pane=diagram]').click();
    // Options is a tab as on wide screens
    assert.ok(display('#btn-options') !== 'none', '#btn-options shown');
    // wide again: all three panes
    app.frame.style.width = '2000px';
    await waitFor(() => display('#pane-switch') === 'none', { what: 'wide again' });
    assert.deepEqual(['.tree-pane', '.diagram-pane', '.details-pane'].map(display).map(d => d !== 'none'), [true, true, true]);
    assert.deepEqual(app.errors, []);
  });

  test('Options, Filters and Layout are tabs: one panel at a time, the open one highlighted, the same on any width', async () => {
    const app = await openApp(`#model=${M}&d=nb~1~${E.erp}`);
    await waitFor(() => app.diagramNodes().length > 0, { what: 'diagram' });
    const state = () => ['options', 'filters', 'layout'].map(k => {
      const [b, panel] = { options: ['#btn-options', '#diagram-options'], filters: ['#btn-filters', '#filter-panel'], layout: ['#btn-layout', '#layout-panel'] }[k];
      return `${k}:${app.$(b).getAttribute('aria-selected')}/${app.$(panel).hidden ? 'hidden' : 'shown'}`;
    }).join(' ');
    assert.equal(state(), 'options:false/hidden filters:false/hidden layout:false/hidden');
    app.$('#btn-options').click();
    assert.equal(state(), 'options:true/shown filters:false/hidden layout:false/hidden');
    assert.ok(app.$('#diagram-options').contains(app.$('#opt-depth')), 'the generation options are in the Options panel');
    assert.equal(app.win.getComputedStyle(app.$('#btn-options')).color, 'rgb(255, 255, 255)', 'the open tab is highlighted');
    app.$('#btn-filters').click();
    assert.equal(state(), 'options:false/hidden filters:true/shown layout:false/hidden');
    app.$('#btn-layout').click();
    assert.equal(state(), 'options:false/hidden filters:false/hidden layout:true/shown');
    assert.ok(app.$('#layout-panel').textContent.includes('Preset'), 'the layout panel is drawn when opened');
    app.$('#btn-layout').click();
    assert.equal(state(), 'options:false/hidden filters:false/hidden layout:false/hidden', 'the open one closes');
    // a narrow window shows the same three tabs
    app.frame.style.width = '600px';
    await waitFor(() => app.win.getComputedStyle(app.$('#pane-switch')).display !== 'none', { what: 'narrow' });
    app.$('#pane-switch [data-pane=diagram]').click();
    assert.ok(['#btn-options', '#btn-filters', '#btn-layout'].every(b => app.$(b).offsetParent !== null), 'the same tabs');
    app.$('#btn-options').click();
    assert.equal(state(), 'options:true/shown filters:false/hidden layout:false/hidden');
    assert.deepEqual(app.errors, []);
  });

  test('left pane: basket, search results and model tree, each collapsible (remembered) and scrolling on its own', async () => {
    const app = await openApp(`#model=${M}&element=${E.erp}`);
    const sections = () => app.$$('.tree-pane > .side-section').map(x => x.dataset.section);
    assert.deepEqual(sections(), ['basket', 'search', 'tree']);
    assert.ok(app.$('#search-results').hidden, 'no results yet');
    // the basket lists its elements as rows
    const add = await waitFor(() => app.$$('#details button').find(b => b.textContent === 'Add to basket'), { what: () => detailsState(app, 'Add to basket') });
    add.click();
    await waitFor(() => app.$$('#basket-items [role=treeitem] [role=treeitem]').length === 1, { what: 'one basket row' });
    assert.ok(app.$('.tree-pane #basket'), 'the basket is in the left pane');
    assert.deepEqual([app.$('#basket-label'), app.$('#basket-count')].map(x => app.win.getComputedStyle(x).fontWeight), ['700', '700'], '"Basket: N elements" all in bold');
    // as in the tree and the search results: an "Elements" group, rows with the relationship counts and a sub-tree
    const rows = () => app.$$('#basket-items .tree-row');
    const [groupRow, erpRow] = rows();
    assert.equal(groupRow.querySelector('.tree-label').textContent, 'Elements');
    assert.equal(groupRow.querySelector('.tree-sub').textContent, '1');
    assert.equal(erpRow.querySelector('.tree-label').textContent, 'ERP');
    assert.match(erpRow.querySelector('.tree-sub').textContent, /\d+↗ \d+↙/);
    erpRow.querySelector('.tree-toggle').click();
    await waitFor(() => rows().length > 2, { what: 'the relationships of ERP below it' });
    // the group's menu acts on the whole basket; the buttons stay
    app.ctx(groupRow);
    await waitFor(() => app.menu()?.length, { what: 'basket menu' });
    for (const item of ['Diagram of basket', 'Diagram with neighbours', 'Explore', 'Copy names', 'Clear basket']) assert.includes(app.menu(), item);
    app.doc.dispatchEvent(new app.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.ok(['#btn-basket-render', '#btn-basket-expand', '#btn-basket-explore', '#btn-basket-clear'].every(b => app.$(b).offsetParent !== null), 'the buttons stay');
    // an element row has the element's menu, as in the tree
    app.ctx(rows()[1]);
    await waitFor(() => app.menu()?.length, { what: 'element menu' });
    assert.includes(app.menu(), 'Remove from basket');
    app.doc.dispatchEvent(new app.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    // a search shows its results between the basket and the tree; Close hides them
    app.$('#search-input').value = 'billing';
    app.$('#search-form').requestSubmit();
    await waitFor(() => !app.$('#search-results').hidden && /hits/.test(app.$('#search-title').textContent), { what: 'results' });
    assert.equal(app.$('#btn-search-close').textContent, 'Close');
    for (const sel of ['#basket-body', '#search-tree', '#tree']) {
      assert.equal(app.win.getComputedStyle(app.$(sel)).overflowY, 'auto', `${sel} scrolls on its own`);
    }
    // collapse the tree; remembered across a reload
    const tree = app.$('.tree-section');
    tree.querySelector('.side-toggle').click();
    assert.ok(tree.classList.contains('collapsed'));
    assert.equal(tree.querySelector('.side-toggle').getAttribute('aria-expanded'), 'false');
    assert.equal(app.$('#tree').offsetParent, null, 'the tree is folded away');
    const again = await openApp(`#model=${M}`, {}, { keepStorage: true });
    assert.ok(again.$('.tree-section').classList.contains('collapsed'), 'remembered');
    again.$('.tree-section .side-toggle').click();
    assert.equal(again.$('.tree-section').classList.contains('collapsed'), false);
    // a collapsed result section opens again for a new search
    again.$('#search-input').value = 'erp';
    again.$('#search-form').requestSubmit();
    await waitFor(() => !again.$('#search-results').hidden, { what: 'results' });
    again.$('#search-results .side-toggle').click();
    again.$('#search-input').value = 'billing';
    again.$('#search-form').requestSubmit();
    await waitFor(() => !again.$('#search-results').classList.contains('collapsed'), { what: 'expanded for new results' });
    again.$('#btn-search-close').click();
    assert.ok(again.$('#search-results').hidden);
    assert.deepEqual(again.errors, []);
  });

  test('search result groups (elements, relationships, views) drag into the diagram; basket rows remove with × or Delete', async () => {
    const app = await openApp(`#model=${M}`);
    const search = async q => {
      app.$('#search-input').value = q;
      app.$('#search-form').requestSubmit();
      await waitFor(() => app.$('#search-title').textContent.includes(`“${q}”`) && /hits/.test(app.$('#search-title').textContent), { what: `results of ${q}` });
    };
    const groupRow = label => app.$$('#search-tree .tree-row').find(r => r.querySelector('.tree-label')?.textContent === label);
    const drop = row => {
      const dt = new app.win.DataTransfer();
      row.dispatchEvent(new app.win.DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      const pane = app.$('#tab-layout');
      pane.dispatchEvent(new app.win.DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      pane.dispatchEvent(new app.win.DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      return dt;
    };
    const shown = () => app.diagramNodes().map(n => Number(n.dataset.element)).sort((a, b) => a - b);
    // the Elements group: the found elements, as "Diagram of the results"
    await search('billing');
    assert.ok(groupRow('Elements').draggable, 'the Elements group can be dragged');
    assert.match(drop(groupRow('Elements')).getData('application/x-archixmi-ref'), /^found:/);
    await waitFor(() => shown().length === 2, { what: 'the two found elements' });
    assert.deepEqual(shown(), [E.billingModule, E.billingService].sort((a, b) => a - b));
    // the Relationships group: the ends of the found relationships, as "Diagram of their ends"
    await search('bills');
    assert.ok(groupRow('Relationships').draggable);
    drop(groupRow('Relationships'));
    await waitFor(() => shown().includes(E.orderHandling), { what: 'the other end of “bills” added' });
    assert.ok(shown().includes(E.billingService));
    assert.equal(groupRow('Views').draggable, false, 'no views to drag');
    // the Views group: the elements shown in the found views, as "Diagram of their elements"
    await search('detail');
    assert.ok(groupRow('Views').draggable);
    drop(groupRow('Views'));
    const inView = (await (await fetch(`/api/v2/models/${M}/views/${V(2)}/elements?limit=1000`)).json()).items.map(e => e.id);
    assert.ok(inView.length > 0);
    await waitFor(() => inView.every(id => shown().includes(id)), { what: 'the elements of “Application Detail” added' });

    // basket rows: × (shown on hover and on the selected row) and the Delete key
    app.win.location.hash = `#model=${M}&element=${E.erp}`;
    const add = async () => {
      const b = await waitFor(() => app.$$('#details button').find(x => x.textContent === 'Add to basket'), { what: () => detailsState(app, 'Add to basket') });
      b.click();
      await waitFor(() => app.$$('#basket-items [role=treeitem] [role=treeitem]').length === 1, { what: 'in the basket' });
    };
    await add();
    const row = () => app.$$('#basket-items [role=treeitem] [role=treeitem] > .tree-row')[0];
    const x = row().querySelector('.tree-action');
    assert.equal(x.textContent, '×');
    assert.equal(app.win.getComputedStyle(x).display, 'none', 'hidden until hover');
    assert.equal(x.title, 'Remove ERP from basket');
    row().click();
    assert.ok(app.win.getComputedStyle(row().querySelector('.tree-action')).display !== 'none', 'shown on the selected row');
    row().querySelector('.tree-action').click();
    await waitFor(() => app.$('#basket').classList.contains('empty'), { what: 'removed by ×' });
    await add();
    row().click();
    app.$('#basket-items .tree').dispatchEvent(new app.win.KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    await waitFor(() => app.$('#basket').classList.contains('empty'), { what: 'removed by Delete' });
    assert.deepEqual(app.errors, []);
  });

  test('Clear diagram: on the diagram, after a confirmation', async () => {
    const app = await openApp(`#model=${M}&d=nb~1~${E.erp}`);
    await waitFor(() => app.diagramNodes().length > 0, { what: 'diagram' });
    const clear = app.$('#tab-layout .layout-tools [data-tool=clear]');
    assert.ok(clear, 'with the tools on the diagram');
    assert.equal(app.$('.toolbar #btn-clear'), null, 'no longer in the toolbar');
    clear.click();
    assert.equal(app.$('#confirm-dialog').open, true);
    assert.includes(app.$('#confirm-text').textContent, 'Are you sure');
    app.$('#confirm-dialog').close('cancel');
    await new Promise(r => setTimeout(r, 50));
    assert.ok(app.diagramNodes().length > 0, 'Cancel keeps the diagram');
    app.$('#tab-layout .layout-tools [data-tool=clear]').click();
    app.$('#btn-confirm-ok').click();
    await waitFor(() => app.diagramNodes().length === 0 && app.win.location.hash.includes('d=ex~~'), { what: 'cleared' });
    assert.equal(app.$('#tab-layout .layout-tools [data-tool=clear]')?.disabled ?? true, true, 'nothing left to clear');
    assert.deepEqual(app.errors, []);
  });

  test('context menus: ↑/↓ wrap around, Home and End (UX-6)', async () => {
    const app = await openApp(`#model=${M}`);
    app.ctx(app.treeRow('Fixture Model'));
    await waitFor(() => app.menu()?.length, { what: 'model menu' });
    const items = app.$$('.node-menu [role=menuitem]').filter(b => !b.disabled);
    const key = k => app.doc.dispatchEvent(new app.win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    assert.equal(app.doc.activeElement, items[0]);
    key('End');
    assert.equal(app.doc.activeElement, items.at(-1));
    key('ArrowDown');
    assert.equal(app.doc.activeElement, items[0], 'wraps around');
    key('ArrowUp');
    assert.equal(app.doc.activeElement, items.at(-1));
    key('Home');
    assert.equal(app.doc.activeElement, items[0]);
    key('Escape');
    assert.equal(app.$('.node-menu'), null);
  });

  test('Settings (UP-1): shows the versions of the browser and the API; a stored /api/v1 base was moved to /api/v2', async () => {
    const app = await openApp(`#model=${M}`, { apiBase: '/api/v1' });
    assert.equal(JSON.parse(localStorage.getItem(SETTINGS)).apiBase, '/api/v2');
    app.$('#btn-settings').click();
    await waitFor(() => app.$('#settings-dialog').open, { what: 'settings dialog' });
    assert.equal(app.$('#settings-form').apiBase.value, '/api/v2');
    const note = () => app.$('#api-version-note').textContent;
    await waitFor(() => /Connected to ArchiMate API \d+\.\d+\.\d+/.test(note()), { what: 'API version' });
    assert.ok(note().startsWith(`ArchiMate Browser ${APP_VERSION}. `), note());
    app.$('#settings-dialog').close('cancel');
  });

  test('an API older than 2.0.0 (UP-1): the error says which version is needed', async () => {
    await setApi({ old: true });
    try {
      const app = await openApp(`#model=${M}`, {}, { model: null });
      const box = await waitFor(() => app.$('#tree .pane-error'), { what: 'error in the tree pane' });
      assert.includes(box.textContent, `This browser needs ArchiMate API ${MIN_API_VERSION} or later`);
      assert.includes(app.$('#status').textContent, 'does not serve /api/v2');
    } finally {
      await setApi({});
    }
  });

  test('an API that lacks what this browser uses (UP-1): refused at once, with both versions named', async () => {
    await setApi({ version: '2.0.0' });
    try {
      const app = await openApp(`#model=${M}`, {}, { model: null });
      const box = await waitFor(() => app.$('#tree .pane-error'), { what: 'error in the tree pane' });
      assert.includes(box.textContent, `This browser needs ArchiMate API ${MIN_API_VERSION} or later; the API in use is version 2.0.0.`);
      assert.equal(app.treeRow('Fixture Model'), undefined, 'no model is opened');
    } finally {
      await setApi({});
    }
  });

  // ---------------------------------------------------------------- API v2 (PLAN.md, phase 2)

  test('element details: its folder and the views that show it are there without asking (API-4, HLP-7)', async () => {
    const app = await openApp(`#model=${M}&element=${E.billingModule}`);
    await waitFor(() => app.$('#details h2')?.textContent === 'Billing Module', { what: 'element details' });
    await waitFor(() => app.$('#details .folder-path')?.textContent === 'Application›Billing', { what: 'folder path' });
    const views = await waitFor(() => { const v = app.$$('#details ul.rels li').filter(li => li.textContent.startsWith('🖼')); return v.length === 2 && v; }, { what: 'views showing the element' });
    assert.deepEqual(views.map(li => li.textContent.trim()), ['🖼 Overview', '🖼 Application Detail']);
    assert.equal(app.$$('#details button').some(b => /Find views/.test(b.textContent)), false, 'no button to scan the views any more');
    assert.deepEqual(app.errors, []);
  });

  test('relationship details: the views that show it (API-4)', async () => {
    const app = await openApp(`#model=${M}&element=${E.erp}`);
    await waitFor(() => app.$('#details h2')?.textContent === 'ERP', { what: 'element details' });
    // the composition ERP -> Billing Module, from the list of outgoing relationships
    const row = app.$$('#details ul.rels li').find(li => /Composition/.test(li.textContent));
    [...row.querySelectorAll('a')].find(a => a.textContent === 'ⓘ').click();
    await waitFor(() => /Composition relationship/.test(app.$('#details .kind')?.textContent || ''), { what: 'relationship details' });
    await waitFor(() => app.$$('#details ul.rels li').filter(li => li.textContent.startsWith('🖼')).length === 2, { what: 'views showing the relationship' });
  });

  test('view details: links to views and from views, from one request (API-10)', async () => {
    let app = await openApp(`#model=${M}&view=${V(1)}`);
    await waitFor(() => app.$$('#details ul.rels li').some(li => li.textContent.startsWith('↗ Application Detail')), { what: 'link to view 2' });
    assert.includes(app.$('#details').textContent, 'No view links here.');
    app = await openApp(`#model=${M}&view=${V(2)}`);
    await waitFor(() => app.$$('#details ul.rels li').some(li => li.textContent.startsWith('↙ Overview')), { what: 'linked from view 1' });
    assert.includes(app.$('#details').textContent, 'This view has no drill-down links.');
    assert.equal(app.$$('#details button').some(b => /Find views/.test(b.textContent)), false);
    assert.deepEqual(app.errors, []);
  });

  test('search (API-6): views are found; a long list comes a page at a time', async () => {
    const app = await openApp(`#model=${M}`);
    const search = async (q, title) => {
      app.$('#search-input').value = q;
      app.$('#search-form').requestSubmit();
      await waitFor(() => app.$('#search-title').textContent === title, { what: `"${title}"` });
    };
    const rows = () => app.$$('#search-tree .tree-row .tree-label').map(l => l.textContent);
    await search('detail', 'Search: “detail” — 1 hits');
    app.$$('#search-tree .tree-row').find(r => r.querySelector('.tree-label').textContent === 'Views').querySelector('.tree-toggle').click();
    await waitFor(() => rows().includes('Application Detail'), { what: 'the view among the results' });

    await search('filler', 'Search: “filler” — first 50 of 230 hits');
    assert.deepEqual(rows().filter(l => l.startsWith('Filler')).slice(0, 2), ['Filler 001', 'Filler 002'], 'by name');
    const more = () => app.$$('#search-tree .tree-row').find(r => /^Show \d+ more of 230$/.test(r.querySelector('.tree-label').textContent));
    assert.equal(more().querySelector('.tree-label').textContent, 'Show 50 more of 230');
    more().click();
    await waitFor(() => rows().filter(l => l.startsWith('Filler')).length === 100, { what: 'the second page' });
    assert.equal(app.$('#search-title').textContent, 'Search: “filler” — first 100 of 230 hits');
    assert.includes(rows(), 'Filler 100');
    assert.deepEqual(app.errors, []);
  });

  test('search: where the text was found when not in the name; the best match comes first', async () => {
    const app = await openApp(`#model=${M}`);
    app.$('#search-input').value = 'buys';
    app.$('#search-form').requestSubmit();
    const row = await waitFor(() => app.$$('#search-tree .tree-row').find(r => r.querySelector('.tree-label').textContent === 'Customer'), { what: 'hit in the documentation' });
    assert.equal(row.querySelector('.tree-sub').textContent, 'in the documentation');
    app.$('#search-input').value = 'customer';
    app.$('#search-form').requestSubmit();
    await waitFor(() => app.$('#search-title').textContent === 'Search: “customer” — 2 hits', { what: 'two hits' });
    const hits = app.$$('#search-tree .tree-row .tree-label').map(l => l.textContent).filter(l => l.startsWith('Customer'));
    assert.deepEqual(hits, ['Customer', 'Customer Role'], 'the exact name before the name that starts with it');
  });

  test('property search (HLP-9): done by the API, with all four forms, on elements, relationships and views', async () => {
    let app = await openApp(`#model=${M}`);
    const search = async (q, title) => {
      app.$('#search-input').value = q;
      app.$('#search-form').requestSubmit();
      await waitFor(() => app.$('#search-title').textContent === title, { what: `"${title}"` });
      return app.$$('#search-tree .tree-row .tree-label').map(l => l.textContent);
    };
    assert.includes(await search('@lifecycle=CURRENT', 'Property search: lifecycle equals “CURRENT” — 2 hits'), 'Order Handling');
    assert.includes(await search('@lifecycle~depr', 'Property search: lifecycle contains “depr” — 1 hits'), 'Payment Gateway');
    assert.includes(await search('@cost', 'Property search: cost is set — 2 hits'), 'ERP');
    await search('@lifecycle!', 'Property search: lifecycle is not set — 259 hits'); // 240 elements, 16 relationships, 3 views

    // the synthetic model has properties on a relationship and on views
    app = await openApp(`#model=${SYN.model}`, {}, { model: 'Synthetic Test Model' });
    await search('@Owner~arch', 'Property search: Owner contains “arch” — 1 hits');
    app.$$('#search-tree .tree-row').find(r => r.querySelector('.tree-label').textContent === 'Views').querySelector('.tree-toggle').click();
    await waitFor(() => app.$$('#search-tree .tree-row .tree-label').some(l => l.textContent === 'Overview'), { what: 'the view found by its property' });
    await search('@Owner=integration', 'Property search: Owner equals “integration” — 1 hits');
    assert.deepEqual(app.errors, []);
  });

  test('folder details and folder diagram (HLP-7): counts from the tree, contents from the API', async () => {
    const app = await openApp(`#model=${M}&d=fo~${F('Application')}`);
    await waitFor(() => app.diagramNodes().length === 6, { what: 'the six elements of the folder and its sub-folder', timeout: 20000 });
    assert.equal(app.$('#diagram-title').textContent, 'Folder: Application');
    app.treeRow('Folders').querySelector('.tree-toggle').click();
    const row = await waitFor(() => app.$$('#tree .tree-row').find(r => r.querySelector('.tree-label')?.textContent === 'Application' && /6 el/.test(r.textContent)), { what: 'folder row with its count' });
    row.click();
    await waitFor(() => app.$('#details h2')?.textContent === 'Application', { what: 'folder details' });
    assert.includes(app.$('#details').textContent, '3 direct · 6 incl. sub-folders');
    await waitFor(() => /Application Component\s*3/.test(app.$('#details').textContent), { what: 'element types of the folder' });
    [...app.doc.querySelectorAll('#details button')].find(b => b.textContent === 'Add elements to basket 6').click(); // 2.21.0: named as in its menu, with the number
    await waitFor(() => app.$('#basket-count').textContent === '6', { what: 'the folder in the basket' });
    assert.deepEqual(app.errors, []);
  });

  test('stored view with connections on connections (API-9): all seven lines are drawn', async () => {
    const app = await openApp(`#model=${SYN.model}&view=${SYN.views['v-overview']}`, {}, { model: 'Synthetic Test Model' });
    await waitFor(() => app.$$('#tab-layout .v-conn').length === 7, { what: 'seven connections' });
    assert.equal(app.$$('#tab-layout .v-conn[data-tgt-connection]').length, 2);
    assert.match(app.$('#diagram-info').textContent, /^12 nodes · 7 connections/);
    assert.deepEqual(app.errors, []);
  });

  // ---------------------------------------------------------------- API v2 (PLAN.md, phase 3)

  test('impact diagram and impact box (HLP-3): analysed by the API', async () => {
    const app = await openApp(`#model=${M}&element=${E.billingService}&d=im~${E.billingService}~i~5`);
    await waitFor(() => app.diagramNodes().length === 5, { what: 'the start and the four elements it affects', timeout: 20000 });
    assert.equal(app.$('#diagram-title').textContent, 'Impact of Billing Service');
    assert.match(app.$('#diagram-info').textContent, /^4 element\(s\) over 4 level\(s\) · depth ≤ 5 · via /);
    (await waitFor(() => app.$('#details [data-tab="impact"]'), { what: 'the Impact analysis tab' })).click(); // 2.19.0
    await waitFor(() => /4 element\(s\) over 4 level\(s\)\./.test(app.$('#details .impact-box')?.textContent || ''), { what: 'impact box in the details' });
    assert.deepEqual(app.$$('#details .impact-level').map(l => l.textContent), ['Level 1 (1)', 'Level 2 (1)', 'Level 3 (1)', 'Level 4 (1)']);
    assert.includes(app.$('#details .impact-list').textContent, 'Order Handling');
    // a smaller depth asks again
    const depth = app.$$('#details .impact-box select')[1];
    depth.value = '2';
    depth.dispatchEvent(new app.win.Event('change'));
    await waitFor(() => /2 element\(s\) over 2 level\(s\) — more beyond depth 2\./.test(app.$('#details .impact-box').textContent), { what: 'depth 2' });
    assert.deepEqual(app.errors, []);
  });

  test('diagrams of a set (HLP-2): a layer, a relationship type, relationships on relationships', async () => {
    let app = await openApp(`#model=${M}&d=la~business`);
    await waitFor(() => app.diagramNodes().length === 5, { what: 'the five business elements', timeout: 20000 });
    assert.equal(app.$('#diagram-title').textContent, 'Business layer');
    app = await openApp(`#model=${M}&d=rt~Flow`);
    await waitFor(() => app.diagramNodes().length === 4, { what: 'the ends of the three flows', timeout: 20000 });
    assert.match(app.$('#diagram-info').textContent, /^4 elements · 3 relationships/);
    app = await openApp(`#model=${M}&d=rt~@rel`);
    await waitFor(() => app.diagramNodes().length === 3, { what: 'the ends of the relationship on a relationship', timeout: 20000 });
    assert.match(app.$('#diagram-info').textContent, /^3 elements · 2 relationships/);
    assert.deepEqual(app.errors, []);
  });

  test('a property filter is applied by the API while it walks (GAP-1); what it hides is counted (GAP-9)', async () => {
    // lifecycle = planned: of the ERP's neighbours only the Billing Module; the junction fails, so nothing behind it is reached
    const app = await openApp(`#model=${M}&d=nb~1~${E.erp}&p=f:lifecycle.eq.planned`);
    await waitFor(() => app.diagramNodes().length === 2, { what: 'ERP and the Billing Module', timeout: 20000 });
    assert.match(app.$('#diagram-info').textContent, /hides 4 element\(s\) and 0 relationship\(s\)/);
    assert.deepEqual(app.errors, []);
  });

  test('nesting comes with the diagram (HLP-2): the Billing Module inside the ERP', async () => {
    const app = await openApp(`#model=${M}&d=nb~1~${E.erp}`, { nestGenerated: true });
    await waitFor(() => app.diagramNodes().length === 6, { what: 'diagram', timeout: 20000 });
    await waitFor(() => /1 relationship\(s\) shown as nesting/.test(app.$('#diagram-info').textContent), { what: 'nesting noted in the info line' });
    assert.equal(app.$(`#tab-layout .v-conn[data-relationship="${R(106)}"]`), null, 'the composition is not drawn as a line');
    assert.deepEqual(app.errors, []);
  });

  test('explorer steps (HLP-5, HLP-1): the +N of every element from one request; a typed step from the menu', async () => {
    const app = await openApp(`#model=${M}&d=ex~${E.erp}~${E.erp}`);
    await waitFor(() => app.$(`#tab-layout .v-more[data-expand="${E.erp}"]`), { what: '+N badge', timeout: 20000 });
    app.ctx(app.$(`#tab-layout .v-node[data-element="${E.erp}"]`));
    const entries = app.menu();
    assert.ok(entries.some(l => l.startsWith('Show all related')) && entries.some(l => l.startsWith('Flow →')), JSON.stringify(entries));
    app.clickMenu('Flow →');
    // the flow leads through the junction to the Billing Module and the Payment Gateway
    await waitFor(() => app.diagramNodes().length === 4, { what: 'ERP, junction and the two elements behind it', timeout: 20000 });
    await waitFor(() => app.$(`#tab-layout .v-more[data-expand="${E.erp}"] text`)?.textContent === '+2', { what: 'two left to show: the server and the capability' });
    assert.deepEqual(app.errors, []);
  });

  test('paths between two elements (HLP-4): from the element menus, and by link', async () => {
    let app = await openApp(`#model=${M}&d=nb~1~${E.erp}`);
    await waitFor(() => app.diagramNodes().length === 6, { what: 'diagram', timeout: 20000 });
    app.ctx(app.$(`#tab-layout .v-node[data-element="${E.erp}"]`));
    app.clickMenu('Paths from here…');
    assert.includes(app.$('#status').textContent, 'Paths from ERP');
    app.ctx(app.$(`#tab-layout .v-node[data-element="${E.gateway}"]`));
    app.clickMenu('Paths from ERP to here');
    await waitFor(() => app.$('#diagram-title').textContent === 'Paths: ERP → Payment Gateway', { what: 'paths diagram' });
    // ERP -Flow-> junction -Flow-> gateway, and ERP -Composition-> Billing Module <-Triggering- gateway: both two long
    await waitFor(() => app.diagramNodes().length === 4, { what: 'the elements on the paths', timeout: 20000 });
    assert.match(app.$('#diagram-info').textContent, /^\d paths, the shortest 2 relationship\(s\) long/);
    assert.includes(app.win.location.hash, 'd=pa~id-e6~id-e12', 'BR-17: written with XMI identifiers');

    // a path over a relationship that ends on a relationship: Customer -Association-> (Billing Service -Serving-> Order Handling)
    app = await openApp(`#model=${M}&d=pa~${E.customer}~${E.billingService}`);
    await waitFor(() => app.$('#diagram-title').textContent === 'Paths: Customer → Billing Service', { what: 'paths diagram from a link' });
    await waitFor(() => app.$(`#tab-layout .v-conn[data-relationship="${R(115)}"]`), { what: 'the association on the serving relationship is drawn', timeout: 20000 });
    assert.ok(app.$(`#tab-layout .v-conn[data-relationship="${R(108)}"]`), 'with the relationship it ends on');

    app = await openApp(`#model=${M}&d=nb~1~${E.erp}`);
    await waitFor(() => app.diagramNodes().length === 6, { what: 'diagram', timeout: 20000 });
    app.win.location.hash = `#model=${M}&d=pa~${E.erp}~${E.orphan}`;
    await waitFor(() => /No path of up to 6 relationships between ERP and Orphan Goal/.test(app.$('#status').textContent), { what: 'no path' });
    assert.equal(app.diagramNodes().length, 6, 'the diagram stays');
    assert.deepEqual(app.errors, []);
  });

  test('add a view\'s elements to the basket (HLP-7): from the API, without loading the view', async () => {
    const app = await openApp(`#model=${M}`);
    app.treeRow('Views').querySelector('.tree-toggle').click();
    app.ctx(await waitFor(() => app.treeRow('Application Detail'), { what: 'view row' }));
    app.clickMenu('Add its elements to basket');
    await waitFor(() => app.$('#basket-count').textContent === '6', { what: 'six elements in the basket' });
  });

  test('no request of the whole test run went to /api/v1', async () => {
    const state = await fetch('/__test/api').then(r => r.json());
    assert.equal(state.v1Requests, 0);
  });

  test('resizable panes: drag the tree border, width remembered', async () => {
    const app = await openApp(`#model=${M}`);
    const [left] = app.$$('.pane-splitter');
    const tree = app.$('.tree-pane');
    const w0 = tree.offsetWidth, r = left.getBoundingClientRect();
    const pe = (type, x) => left.dispatchEvent(new app.win.PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 200, button: 0, pointerId: 5 }));
    pe('pointerdown', r.left + 3); pe('pointermove', r.left + 63); pe('pointerup', r.left + 63);
    assert.equal(tree.offsetWidth, w0 + 60);
    assert.equal(JSON.parse(localStorage.getItem(SETTINGS)).paneWidths.tree, w0 + 60);
  });

  // ---------------------------------------------------------------- reports (ALT-4, API 3.6.0)

  test('quality report (HLP-10): a section per check; an item selects its element and closes the report', async () => {
    const app = await openApp(`#model=${M}`);
    app.$('#btn-report-quality').click();
    await waitFor(() => app.$$('#report-body .report-check').length === 9, { what: 'nine checks' });
    assert.ok(app.$('#report-dialog').open);
    assert.includes(app.$('#report-title').textContent, 'Quality report: Fixture Model');
    const noView = app.$$('#report-body .report-check')[0];
    assert.includes(noView.querySelector('summary').textContent, 'Elements in no view');
    assert.ok(Number(noView.querySelector('.count').textContent) > 0);
    // the fixture's 230 filler elements fill the first places of the lists; any of them will do
    const first = noView.querySelector('.report-list .linklike');
    const name = first.textContent;
    first.click();
    await waitFor(() => !app.$('#report-dialog').open && app.$('#details').textContent.includes(name), { what: 'selected' });
    assert.deepEqual(app.errors, []);
  });

  test('quality report (API 3.7.0, BL-51): a relationship ArchiMate does not allow, named with the types of its ends', async () => {
    const app = await openApp(`#model=${SYN.model}`, {}, { model: 'Synthetic Test Model' });
    app.$('#btn-report-quality').click();
    const check = await waitFor(() => app.$$('#report-body .report-check')
      .find(c => c.querySelector('summary').textContent.includes('Relationships ArchiMate does not allow')), { what: 'the check' });
    assert.equal(check.querySelector('.count').textContent, '1', 'the Influence from a goal onto an Association');
    const item = check.querySelector('.report-list li');
    assert.match(item.textContent, /^Influence: .+ → \[Association.*\] Goal → relationship$/);
    item.querySelector('.linklike').click();
    await waitFor(() => !app.$('#report-dialog').open && app.$('#details').textContent.includes('Influence relationship'), { what: 'its details' });
    assert.deepEqual(app.errors, []);
  });

  test('relationship matrix (HLP-11): direct and along a path; a cell lists its paths and draws them', async () => {
    const app = await openApp(`#model=${M}`);
    app.$('#btn-report-matrix').click();
    await waitFor(() => app.$('#report-body form'), { what: 'matrix form' });
    const form = app.$('#report-body form');
    form.rows.value = 'type:ApplicationComponent';
    form.columns.value = 'type:BusinessProcess';
    form.requestSubmit();  // direct Serving, outgoing: no component serves a process directly
    await waitFor(() => app.$('#report-body .report-result').textContent.includes('No element of the rows'), { what: 'empty matrix' });
    form.mode.value = 'path';
    form.mode.dispatchEvent(new app.win.Event('change'));  // Realization →, then Serving →
    form.requestSubmit();
    const count = await waitFor(() => app.$('#report-body .report-count'), { what: 'a cell' });
    assert.equal(count.textContent, '1');
    assert.deepEqual(app.$$('#report-body .report-matrix tbody th').map(th => th.textContent), ['Billing Module']);
    count.click();
    await waitFor(() => app.$('.report-cell-detail').textContent, { what: 'the paths of the cell' });
    assert.includes(app.$('.report-cell-detail').textContent, 'Billing Module —Realization→ Billing Service —Serving→ Order Handling');
    app.$('.report-cell-detail .report-diagram').click();
    await waitFor(() => app.diagramNodes().length === 3, { what: '3 elements drawn' });
    assert.ok(!app.$('#report-dialog').open);
    assert.deepEqual(app.errors, []);
  });

  test('landscape map (HLP-12): nested boxes, a sub-element only under its parent, coloured by a property', async () => {
    const app = await openApp(`#model=${M}`);
    app.$('#btn-report-landscape').click();
    await waitFor(() => app.$('#report-body form'), { what: 'landscape form' });
    const form = app.$('#report-body form');
    form.roots.value = 'type:ApplicationComponent';
    form.colour.value = 'lifecycle';
    form.requestSubmit();
    await waitFor(() => app.$('#report-body .landscape'), { what: 'the map' });
    const tops = app.$$('#report-body .landscape > .landscape-box > .landscape-head .linklike').map(b => b.textContent);
    assert.deepEqual(tops, ['ERP', 'Payment Gateway']);  // Billing Module is below ERP, not on top as well
    const erp = app.$('#report-body .landscape > .landscape-box');
    assert.deepEqual([...erp.querySelectorAll('.landscape-children .linklike')].map(b => b.textContent), ['Billing Module']);
    assert.includes(app.$('#report-body .legend').textContent, 'lifecycle');
    assert.includes(app.$('#report-body .legend').textContent, 'current');
    assert.deepEqual(app.errors, []);
  });

  test('2.22.0 (BR-25): a diagram saved as a view, edited, renamed and deleted; source views and readers cannot', async () => {
    const created = () => fetch(`/api/v2/models/${M}/views?origin=created`).then(r => r.json());
    const named = async value => {
      const dialog = await waitFor(() => app.$('#view-name-dialog')?.open && app.$('#view-name-dialog'), { what: 'the name dialog' });
      const input = dialog.querySelector('input');
      input.value = value;
      dialog.querySelector('button[value=ok]').click();
    };
    let app = await openApp(`#model=${M}&d=nb~1~${E.erp}`);
    await waitFor(() => app.diagramNodes().length === 6, { what: '6 elements drawn', timeout: 20000 });
    app.$('#tab-layout [data-tool="save-view"]').click();
    await named('Smoke view');
    await waitFor(() => app.$('#diagram-title').textContent === '✎ View: Smoke view', { what: 'the saved view shown', timeout: 20000 });
    await waitFor(() => app.diagramNodes().length === 6, { what: 'its 6 elements, as stored' });
    const where = () => Object.fromEntries(app.diagramNodes().map(n => { const b = n.getBBox(); return [n.dataset.element, [Math.round(b.x), Math.round(b.y)]]; }));
    const stored = where();
    let views = (await created()).items;
    assert.deepEqual(views.map(v => v.name), ['Smoke view']);
    const id = views[0].id;
    // 2.31.0: directly under Views, with its pencil
    await waitFor(() => app.treeRow('Smoke view'), { what: 'under Views in the tree' });
    const level = label => Number(app.treeRow(label).closest('li').getAttribute('aria-level'));
    assert.equal(level('Smoke view'), level('Views') + 1, 'directly under Views');
    assert.equal(app.treeRow('Smoke view').querySelector('.tree-icon').textContent, '✎');
    try {
      // its details: what it is, and what may be done with it
      app.win.location.hash = `#model=${M}&view=${id}`;
      await waitFor(() => app.$('#details h2')?.textContent === 'Smoke view', { what: 'its details' });
      assert.equal(app.$('#details .kind').textContent, '✎ Created view');
      assert.match(app.$('#details .origin').textContent, /^Created by /);
      const buttons = () => app.$$('#details .actions button').map(b => b.firstChild.textContent);
      assert.ok(['Edit view', 'Rename…', 'Delete…'].every(b => buttons().includes(b)), JSON.stringify(buttons()));
      assert.ok(!buttons().includes('Show in folders'), 'not filed in folders');

      // edit: the elements where the view has them; hide one, Save
      app.$$('#details .actions button').find(b => b.firstChild.textContent === 'Edit view').click();
      await waitFor(() => app.$('#tab-layout .edit-bar') && app.diagramNodes().length === 6, { what: 'the view as a diagram, with the bar', timeout: 20000 });
      assert.includes(app.$('#tab-layout .edit-bar').textContent, 'Editing view “Smoke view”');
      await waitFor(() => JSON.stringify(where()) === JSON.stringify(stored), { what: `each element where the view has it: ${JSON.stringify(where())} vs ${JSON.stringify(stored)}` });
      assert.equal(app.$('#tab-layout [data-tool="save-view"]'), null, 'Save goes into the view');
      const junction = app.diagramNodes().find(n => n.dataset.element === String(E.junction)) || app.diagramNodes().at(-1);
      app.ctx(junction);
      app.clickMenu('Hide from diagram');
      await waitFor(() => app.diagramNodes().length === 5, { what: 'one hidden', timeout: 20000 });
      await waitFor(() => app.$('#tab-layout .edit-bar'), { what: 'still editing' });
      app.$('#tab-layout .edit-bar [data-edit="save"]').click();
      await waitFor(() => app.$('#diagram-title').textContent === '✎ View: Smoke view' && !app.$('#tab-layout .edit-bar'), { what: 'saved and shown', timeout: 20000 });
      await waitFor(() => app.diagramNodes().length === 5, { what: '5 stored' });
      views = (await created()).items;
      assert.equal(views[0].contentRevision, 2);

      // rename
      app.win.location.hash = `#model=${M}&view=${id}`;
      await waitFor(() => app.$$('#details .actions button').some(b => b.firstChild.textContent === 'Rename…'), { what: 'details again' });
      app.$$('#details .actions button').find(b => b.firstChild.textContent === 'Rename…').click();
      await named('Smoke view 2');
      await waitFor(() => app.treeRow('Smoke view 2'), { what: 'renamed in the tree' });

      // a source view: not edited; 2.31.0 (API 3.23.0): renamed and deleted on a model mastered here
      app.win.location.hash = `#model=${M}&view=${V(1)}`;
      await waitFor(() => app.$('#details .kind')?.textContent === '🖼 View', { what: 'a source view' });
      assert.equal(app.$('#details .origin').textContent, "From the model's source");
      assert.ok(!buttons().includes('Edit view'), JSON.stringify(buttons()));
      assert.ok(['Rename…', 'Delete…'].every(b => buttons().includes(b)), JSON.stringify(buttons()));
      assert.deepEqual(app.errors, []);

      // a reader key: sees it, may not change it, and saves no diagram
      await setApi({ role: 'reader' });
      try {
        app = await openApp(`#model=${M}&view=${id}`);
        await waitFor(() => app.$('#details h2')?.textContent === 'Smoke view 2', { what: 'its details for a reader' });
        assert.ok(!buttons().some(b => ['Edit view', 'Rename…', 'Delete…'].includes(b)), JSON.stringify(buttons()));
        app.win.location.hash = `#model=${M}&d=nb~1~${E.erp}`;
        await waitFor(() => app.diagramNodes().length === 6, { what: 'a diagram for a reader', timeout: 20000 });
        assert.equal(app.$('#tab-layout [data-tool="save-view"]'), null);
      } finally {
        await setApi({});
      }

      // delete, after asking
      app = await openApp(`#model=${M}&view=${id}`);
      await waitFor(() => app.$$('#details .actions button').some(b => b.firstChild.textContent === 'Delete…'), { what: 'details for deleting' });
      app.$$('#details .actions button').find(b => b.firstChild.textContent === 'Delete…').click();
      await waitFor(() => app.$('#confirm-dialog').open, { what: 'asked first' });
      app.$('#btn-confirm-ok').click();
      await waitFor(() => !app.treeRow('Smoke view 2'), { what: 'gone from the tree' });
      assert.equal((await created()).total, 0);
      assert.deepEqual(app.errors, []);
    } finally {
      for (const v of (await created()).items) await fetch(`/api/v2/models/${M}/views/${v.id}`, { method: 'DELETE', headers: ANY_VERSION });
    }
  });

  test('2.22.1: a proposed view (a link with vn=, propose_view of the MCP server) is saved under its name', async () => {
    const created = () => fetch(`/api/v2/models/${M}/views?origin=created`).then(r => r.json());
    const app = await openApp(`#model=${M}&d=el~${E.erp}.${E.billingModule}.${E.billingService}&vn=Billing%20overview`);
    try {
      const bar = await waitFor(() => app.$('#tab-layout .edit-bar'), { what: 'the bar of a proposed view', timeout: 20000 });
      assert.includes(bar.textContent, 'Proposed view “Billing overview”');
      assert.equal(app.$('#tab-layout [data-tool="save-view"]'), null, 'the bar has the button');
      assert.match(app.win.location.hash, /vn=Billing/, 'the link keeps the name');
      bar.querySelector('[data-edit="save-proposal"]').click();
      const dialog = await waitFor(() => app.$('#view-name-dialog')?.open && app.$('#view-name-dialog'), { what: 'the name dialog' });
      assert.equal(dialog.querySelector('input').value, 'Billing overview');
      dialog.querySelector('button[value=ok]').click();
      await waitFor(() => app.$('#diagram-title').textContent === '✎ View: Billing overview', { what: 'saved and shown', timeout: 20000 });
      assert.deepEqual((await created()).items.map(v => v.name), ['Billing overview']);
      assert.notIncludes(app.win.location.hash, "vn=", "a saved view is no longer a proposal");
      assert.deepEqual(app.errors, []);
    } finally {
      for (const v of (await created()).items) await fetch(`/api/v2/models/${M}/views/${v.id}`, { method: 'DELETE', headers: ANY_VERSION });
    }
  });

  test('2.23.0 (BR-11): with Edit on, an element is renamed, documented and given a property; a save in between is not lost', async () => {
    const base = `/api/v2/models/${M}`;
    const element = () => fetch(`${base}/elements/${E.orphan}`).then(r => r.json());
    const original = await element();
    const send = (method, path, body) => fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...ANY_VERSION }, body: JSON.stringify(body) });
    try {
      const app = await openApp(`#model=${M}&element=${E.orphan}`);
      await waitFor(() => app.$('#details h2')?.textContent === 'Orphan Goal', { what: 'its details' });
      const btn = await waitFor(() => !app.$('#btn-edit-mode').hidden && app.$('#btn-edit-mode'), { what: 'the Edit switch' });
      assert.equal(btn.disabled, false, 'the fixture is mastered here');
      assert.equal(app.$('#edit-form'), null, 'off by default');
      assert.match(btn.title, /^Editing is off\. Click to turn on editing/);
      btn.click();
      let form = await waitFor(() => app.$('#edit-form'), { what: 'the form' });
      assert.equal(btn.getAttribute('aria-pressed'), 'true');
      assert.match(btn.title, /^Editing is on: .* Click to turn it off\.$/, 'said in the tooltip (2.25.1)');
      assert.notIncludes(app.$('#status').textContent, 'Editing is', 'not in the status line');
      form.querySelector('[name=name]').value = 'Orphan renamed';
      form.querySelector('[name=documentation]').value = 'Nobody points here.';
      form.querySelector('[name=newName]').value = 'Reviewer';
      form.querySelector('[name=newValue]').value = 'Ana';
      form.querySelector('[data-edit=save]').click();
      await waitFor(() => app.$('#details h2')?.textContent === 'Orphan renamed', { what: 'saved and shown' });
      let now = await element();
      assert.equal(now.documentation, 'Nobody points here.');
      assert.deepEqual(now.properties.map(x => [x.propertyDefinitionName, x.value]), [['Reviewer', 'Ana']]);
      await waitFor(() => app.treeRow('Orphan renamed') || true, { what: 'the tree' });

      // someone else renames it meanwhile; my documentation is saved anyway, their name stays
      form = await waitFor(() => app.$('#edit-form'), { what: 'the form again' });
      assert.equal((await send('PUT', `/elements/${E.orphan}`, { name: 'Their name' })).status, 200);
      form.querySelector('[name=documentation]').value = 'Mine.';
      form.querySelector('[data-edit=save]').click();
      await waitFor(() => app.$('#edit-form .edit-result [data-edit=mine]'), { what: 'the conflict, with the choices' });
      assert.includes(app.$('#edit-form .edit-result').textContent, 'Someone saved this in between');
      app.$('#edit-form .edit-result [data-edit=mine]').click();
      await waitFor(() => app.$('#details h2')?.textContent === 'Their name', { what: 'saved on top of theirs' });
      now = await element();
      assert.deepEqual([now.name, now.documentation], ['Their name', 'Mine.']);

      // the record of changes has it; a name is put back into the form from there
      app.$('#details [data-tab="history"]')?.click();
      const back = await waitFor(() => app.$('#details [data-put-back]'), { what: 'Put back in the history' });
      back.click(); // the newest: my documentation, whose earlier value comes back
      assert.equal(app.$('#edit-form [name=documentation]').value, 'Nobody points here.');

      // off again: no form
      btn.click();
      await waitFor(() => !app.$('#edit-form'), { what: 'the form gone' });
      assert.deepEqual(app.errors, []);
    } finally {
      const fresh = await element();
      await fetch(`${base}/changes`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ANY_VERSION }, body: JSON.stringify({ operations: [
        { op: 'updateElement', element: { id: E.orphan }, name: original.name, documentation: original.documentation ?? null, expectedVersion: '*' },
        ...fresh.properties.filter(x => x.propertyDefinitionName === 'Reviewer').map(() => ({ op: 'removeProperty', owner: { kind: 'element', id: E.orphan }, name: 'Reviewer', expectedVersion: '*' })),
      ] }) });
    }
  });

  test('2.23.0 (BL-57): replacing a model changed here asks first and says what it undoes', async () => {
    const xml = name => `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.opengroup.org/xsd/archimate/3.0/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" identifier="id-bl57-test" version="1.0">
  <name xml:lang="en">${name}</name>
  <elements><element identifier="e-a" xsi:type="BusinessActor"><name xml:lang="en">Actor</name></element></elements>
</model>`;
    const imported = await fetch('/api/v2/models/import', { method: 'POST', body: (() => { const f = new FormData(); f.append('file', new Blob([xml('Undo Test')]), 'undo.xml'); return f; })() }).then(r => r.json());
    const id = imported.model.id;
    try {
      const [actor] = (await fetch(`/api/v2/models/${id}/elements`).then(r => r.json())).items;
      await fetch(`/api/v2/models/${id}/elements/${actor.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...ANY_VERSION }, body: JSON.stringify({ name: 'Edited here' }) });
      const app = await openApp(`#model=${id}`, {}, { model: 'Undo Test' });
      await waitFor(() => /changed 1 time\(s\) since its last import/.test(app.$('#details').textContent), { what: 'the master in the details' });
      app.$('#btn-import').click();
      const input = app.$('#import-form').file;
      const dt = new app.win.DataTransfer();
      dt.items.add(new app.win.File([xml('Undo Test')], 'undo.xml', { type: 'application/xml' }));
      input.files = dt.files;
      app.$('#import-form').replace.checked = true;
      app.$('#import-form').requestSubmit(app.$('#btn-import-run'));
      const confirm = await waitFor(() => app.$('#btn-import-confirm'), { what: 'the preview' });
      assert.includes(app.$('#import-result').textContent, 'It undoes 1 change(s) made here since the last import');
      assert.equal(confirm.textContent, 'Replace the model, undoing 1 change(s)');
      confirm.click();
      await waitFor(() => /Replaced “Undo Test”/.test(app.$('#import-result').textContent), { what: 'replaced', timeout: 20000 });
      const [again] = (await fetch(`/api/v2/models/${id}/elements`).then(r => r.json())).items;
      assert.equal(again.name, 'Actor', 'the change made here is undone, as asked');
      assert.deepEqual(app.errors, []);
    } finally {
      await fetch(`/api/v2/models/${id}`, { method: 'DELETE', headers: ANY_VERSION });
    }
  });

  test('2.23.0 (BR-11): a relationship is renamed with Edit on; its types are those ArchiMate allows between its ends', async () => {
    const url = `/api/v2/models/${M}/relationships/${R(108)}`;
    const original = await fetch(url).then(r => r.json());
    try {
      const app = await openApp(`#model=${M}&relationship=${R(108)}`);
      await waitFor(() => /Serving relationship/.test(app.$('#details .kind')?.textContent || ''), { what: 'its details' });
      (await waitFor(() => !app.$('#btn-edit-mode').hidden && app.$('#btn-edit-mode'), { what: 'the switch' })).click();
      const form = await waitFor(() => app.$('#edit-form'), { what: 'the form' });
      const types = await waitFor(() => (form.querySelectorAll('[name=type] option').length > 1) && [...form.querySelectorAll('[name=type] option')].map(o => o.value),
        { what: 'the allowed types' });
      assert.ok(types.includes('Serving') && types.includes('Association') && !types.includes('Composition'), JSON.stringify(types));
      form.querySelector('[name=name]').value = 'bills monthly';
      form.querySelector('[data-edit=save]').click();
      await waitFor(() => app.$('#details h2')?.textContent === 'bills monthly', { what: 'saved' });
      assert.equal((await fetch(url).then(r => r.json())).name, 'bills monthly');
      assert.deepEqual(app.errors, []);
    } finally {
      await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...ANY_VERSION }, body: JSON.stringify({ name: original.name }) });
    }
  });

  test('2.24.0 (BR-11 step 2): the palette creates elements (click, then a place; or drag) and relationships (connect, then an allowed type)', async () => {
    const base = `/api/v2/models/${M}`;
    const made = [];
    const byName = async name => (await fetch(`${base}/elements?name=${encodeURIComponent(name)}`).then(r => r.json())).items.filter(e => e.name === name);
    try {
      const app = await openApp(`#model=${M}&d=nb~1~${E.erp}`);
      await waitFor(() => app.diagramNodes().length === 6, { what: '6 elements drawn', timeout: 20000 });
      assert.equal(app.$('#tab-layout .palette-strip'), null, 'no palette without Edit');
      (await waitFor(() => !app.$('#btn-edit-mode').hidden && app.$('#btn-edit-mode'), { what: 'the switch' })).click();
      const strip = await waitFor(() => app.$('#tab-layout .palette-strip'), { what: 'the palette', timeout: 20000 });
      assert.equal(strip.querySelectorAll('[data-new-element]').length, 62, 'every element type');
      assert.equal(strip.querySelectorAll('[data-new-relationship]').length, 11, 'every relationship type');
      assert.ok([...strip.querySelectorAll('[data-new-element] img')].length === 62, 'each with its sprite');
      const filter = strip.querySelector('.palette-filter');
      filter.value = 'service';
      filter.dispatchEvent(new app.win.Event('input'));
      const shown = [...app.$('#tab-layout .palette-strip').querySelectorAll('[data-new-element]')].map(b => b.dataset.newElement);
      assert.ok(shown.length > 2 && shown.every(x => /Service/.test(x)), JSON.stringify(shown));

      // click a type, then a place
      app.$('#tab-layout .palette-strip [data-new-element="ApplicationService"]').click();
      const svg = app.$$('#tab-layout svg').find(x => !x.closest('.minimap')); // the diagram, not the overview map
      const r = svg.getBoundingClientRect();
      svg.dispatchEvent(new app.win.MouseEvent('click', { bubbles: true, cancelable: true, clientX: r.left + r.width - 40, clientY: r.top + r.height - 40 }));
      let dialog = await waitFor(() => app.$('#new-name-dialog')?.open && app.$('#new-name-dialog'), { what: 'the name' });
      dialog.querySelector('input').value = 'Smoke service';
      dialog.querySelector('button[value=ok]').click();
      await waitFor(() => app.$('#details h2')?.textContent === 'Smoke service', { what: 'created and selected', timeout: 20000 });
      await waitFor(() => app.diagramNodes().length === 7, { what: 'drawn in the diagram', timeout: 20000 });
      const [service] = await byName('Smoke service');
      made.push(service.id);
      assert.equal(service.type, 'ApplicationService');

      // connect: the source, the target, then only the types ArchiMate allows
      app.$('#tab-layout .palette-strip [data-connect]').click();
      const node = id => app.$(`#tab-layout .v-node[data-element="${id}"]`);
      node(service.id).dispatchEvent(new app.win.MouseEvent('click', { bubbles: true, cancelable: true }));
      node(E.erp).dispatchEvent(new app.win.MouseEvent('click', { bubbles: true, cancelable: true }));
      const serving = await waitFor(() => {
        const b = app.$('#tab-layout .palette-strip [data-new-relationship="Serving"]');
        return b && app.$('#tab-layout .palette-strip [data-new-relationship="Composition"]').disabled && b;
      }, { what: 'the allowed types' });
      assert.equal(serving.disabled, false);
      serving.click();
      await waitFor(() => /Serving relationship/.test(app.$('#details .kind')?.textContent || ''), { what: 'the relationship created and selected', timeout: 20000 });
      const rels = (await fetch(`${base}/relationships?sourceElementId=${service.id}`).then(r => r.json())).items;
      assert.deepEqual(rels.map(x => [x.type, x.targetElementId]), [['Serving', E.erp]]);
      await waitFor(() => app.$(`#tab-layout [data-relationship="${rels[0].id}"]`), { what: 'drawn', timeout: 20000 });

      // drag a type onto the diagram; one of the same name is named first
      const drop = async name => {
        const dt = new app.win.DataTransfer();
        dt.setData(DRAG_TYPE, 'new:BusinessActor');
        const pane = app.$('#tab-layout');
        // 2.27.0: onto the middle of ERP, which the layout would never leave covered: pinned there, it stays
        const target = node(E.erp).getBoundingClientRect();
        const at = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: target.left + target.width / 2, clientY: target.top + target.height / 2 };
        pane.dispatchEvent(new app.win.DragEvent('dragover', at));
        pane.dispatchEvent(new app.win.DragEvent('drop', at));
        const d = await waitFor(() => app.$('#new-name-dialog')?.open && app.$('#new-name-dialog'), { what: 'the name of the dropped type' });
        d.querySelector('input').value = name;
        d.querySelector('button[value=ok]').click();
      };
      await drop('Smoke actor');
      await waitFor(() => app.$('#details h2')?.textContent === 'Smoke actor', { what: 'dropped and created', timeout: 20000 });
      made.push((await byName('Smoke actor'))[0].id);
      const middle = el => { const b = el.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; };
      const actorNode = await waitFor(() => node(made[1]), { what: 'the actor drawn', timeout: 20000 });
      const [ax, ay] = middle(actorNode), [ex, ey] = middle(node(E.erp));
      assert.ok(Math.abs(ax - ex) < 3 && Math.abs(ay - ey) < 3, `exactly where it was dropped: ${[ax, ay]} against ${[ex, ey]}`);
      await drop('Smoke actor');
      await waitFor(() => app.$('#confirm-dialog').open, { what: 'asked about the twin' });
      assert.includes(app.$('#confirm-text').textContent, 'There is a Business Actor “Smoke actor” already');
      app.$('#btn-confirm-ok').click();
      await waitFor(async () => (await byName('Smoke actor')).length === 2, { what: 'created anyway' });
      made.push(...(await byName('Smoke actor')).map(e => e.id).filter(id => !made.includes(id)));
      assert.deepEqual(app.errors, []);
    } finally {
      for (const id of made) await fetch(`${base}/elements/${id}?cascade=true`, { method: 'DELETE', headers: ANY_VERSION });
    }
  });

  test('2.29.0: the test API requires a version with every change (REQUIRE_IF_MATCH), so these tests show that the app sends one', async () => {
    const strict = (await (await fetch('/__test/api')).json()).requireIfMatch;
    const me = await (await fetch('/api/v2/auth/me')).json();
    assert.equal(me.requireIfMatch, strict, 'GET /auth/me says it (API 3.21.0)');
    if (!strict) return; // ARCHIMATE_TEST_REQUIRE_IF_MATCH=false
    const url = `/api/v2/models/${M}/elements/${E.orphan}`;
    const element = await (await fetch(url)).json();
    // (nothing is changed: a change of the fixture model here would reach the tests after this one)
    const put = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Not taken' }) });
    assert.equal(put.status, 428, 'a change that says no version');
    assert.equal((await (await fetch(url)).json()).version, element.version, 'nothing changed');
  });

  test('2.25.0 (BR-11 step 3): folders made, renamed, moved and deleted, an element filed, an element and a relationship deleted after asking', async () => {
    const base = `/api/v2/models/${M}`;
    const json = (method, path, body) => fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...ANY_VERSION }, body: body && JSON.stringify(body) })
      .then(r => (r.status === 204 ? null : r.json()));
    const made = await json('POST', '/changes', { operations: [
      { op: 'createElement', ref: 'x', type: 'BusinessActor', name: 'Smoke doomed' },
      { op: 'createRelationship', type: 'Assignment', source: { elementRef: 'x' }, target: { elementId: E.role } },
      { op: 'createRelationship', ref: 'y', type: 'Association', source: { elementId: E.customer }, target: { elementId: E.role } },
    ] });
    const [x, xr, y] = made.results.map(r => r.id);
    const view = await json('POST', '/views', { name: 'Smoke view', content: { nodes: [{ ref: 'a', elementId: x, x: 10, y: 10, w: 120, h: 55 }] } });
    let folderId = null;
    try {
      const app = await openApp(`#model=${M}&folder=${F('Application')}`);
      await waitFor(() => app.$('#details h2')?.textContent === 'Application', { what: 'the folder' });
      (await waitFor(() => !app.$('#btn-edit-mode').hidden && app.$('#btn-edit-mode'), { what: 'the switch' })).click();
      const button = label => waitFor(() => app.$$('#details .actions button').find(b => b.firstChild.textContent === label), { what: `the button ${label}` });
      const named = async value => {
        const d = await waitFor(() => (app.$('#folder-name-dialog')?.open && app.$('#folder-name-dialog')), { what: 'the folder name' });
        d.querySelector('input').value = value;
        d.querySelector('button[value=ok]').click();
      };
      const choose = async text => {
        const d = await waitFor(() => (app.$('#folder-choice-dialog')?.open && app.$('#folder-choice-dialog')), { what: 'the folder choice' });
        const select = d.querySelector('select');
        const option = [...select.options].find(o => o.textContent === text);
        assert.ok(option, `${text} in ${[...select.options].map(o => o.textContent)}`);
        select.value = option.value;
        d.querySelector('button[value=ok]').click();
      };

      // a folder: made in Application, renamed, moved to the top
      (await button('New folder…')).click();
      await named('Smoke folder');
      await waitFor(() => app.$('#details h2')?.textContent === 'Smoke folder', { what: 'the new folder' });
      folderId = Number(new URLSearchParams(app.win.location.hash.slice(1)).get('folder')) || null;
      (await button('Rename…')).click();
      await named('Smoke folder 2');
      await waitFor(() => app.$('#details h2')?.textContent === 'Smoke folder 2', { what: 'renamed' });
      (await button('Move to…')).click();
      await choose('(the top level)');
      await waitFor(async () => (await json('GET', '/organizations', null)).some(f => f.label === 'Smoke folder 2'), { what: 'at the top level' });
      folderId = (await json('GET', '/organizations', null)).find(f => f.label === 'Smoke folder 2').id;

      // the element filed in it
      app.win.location.hash = `#model=${M}&element=${x}`;
      await waitFor(() => app.$('#details h2')?.textContent === 'Smoke doomed', { what: 'the element' });
      (await button('File in folder…')).click();
      await choose('Smoke folder 2');
      await waitFor(async () => (await json('GET', `/elements/${x}/folder`, null)).at(-1)?.label === 'Smoke folder 2', { what: 'filed' });

      // the folder deleted: its contents go to Business first
      // the app may still write the element's link after its last action: set the folder's until it shows
      await waitFor(() => {
        if (!app.win.location.hash.includes(`folder=${folderId}`)) app.win.location.hash = `#model=${M}&folder=${folderId}`;
        return app.$('#details h2')?.textContent === 'Smoke folder 2';
      }, { what: 'the folder again' });
      (await button('Delete…')).click();
      await choose('Business');
      await waitFor(async () => !(await json('GET', '/organizations', null)).some(f => f.label === 'Smoke folder 2'), { what: 'deleted' });
      folderId = null;
      assert.equal((await json('GET', `/elements/${x}/folder`, null)).at(-1)?.label, 'Business', 'its contents moved, not deleted');

      // the element deleted, after a question that says what goes with it
      app.win.location.hash = `#model=${M}&element=${x}`;
      await waitFor(() => app.$('#details h2')?.textContent === 'Smoke doomed', { what: 'the element again' });
      (await button('Delete…')).click();
      await waitFor(() => app.$('#confirm-dialog').open, { what: 'asked first' });
      const asked = app.$('#confirm-text').textContent;
      assert.includes(asked, 'cannot be undone');
      assert.includes(asked, '1 relationship(s) go with it');
      assert.includes(asked, 'Smoke view');
      app.$('#btn-confirm-ok').click();
      await waitFor(async () => (await fetch(`${base}/elements/${x}`)).status === 404, { what: 'the element gone' });
      assert.equal((await fetch(`${base}/relationships/${xr}`)).status, 404, 'its relationship with it');
      // the app is done only when it says so: until then it may still select the model, over the next step
      await waitFor(() => /^Deleted Smoke doomed/.test(app.$('#status').textContent), { what: 'the delete reported' });

      // a relationship
      app.win.location.hash = `#model=${M}&relationship=${y}`;
      await waitFor(() => /Association relationship/.test(app.$('#details .kind')?.textContent || ''), { what: 'the relationship' });
      (await button('Delete…')).click();
      await waitFor(() => app.$('#confirm-dialog').open, { what: 'asked first' });
      app.$('#btn-confirm-ok').click();
      await waitFor(async () => (await fetch(`${base}/relationships/${y}`)).status === 404, { what: 'the relationship gone' });
      assert.deepEqual(app.errors, []);
    } finally {
      await fetch(`${base}/elements/${x}?cascade=true`, { method: 'DELETE', headers: ANY_VERSION });
      await fetch(`${base}/relationships/${y}`, { method: 'DELETE', headers: ANY_VERSION });
      await fetch(`${base}/views/${view.id}`, { method: 'DELETE', headers: ANY_VERSION });
      if (folderId) await fetch(`${base}/changes`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ANY_VERSION }, body: JSON.stringify({ operations: [{ op: 'deleteFolder', folder: { id: folderId }, expectedVersion: '*', moveContentsTo: { id: F('Business') } }] }) });
    }
  });

  test('2.26.0 (MU-14): with the change events the bar comes without polling, the list of models follows, a deleted model is said', async () => {
    const send = async (method, path, body) => {
      const r = await fetch(`/api/v2${path}`, { method, headers: { 'Content-Type': 'application/json', ...ANY_VERSION }, body: body ? JSON.stringify(body) : undefined });
      return r.status === 204 ? null : r.json();
    };
    const made = await send('POST', '/models', { xmiIdentifier: 'id-events-test', name: 'Events Test' });
    let other = null;
    try {
      const actor = await send('POST', `/models/${made.id}/elements`, { xmiIdentifier: 'id-ev-a', type: 'BusinessActor', name: 'Clerk' });
      const app = await openApp(`#model=${made.id}`, { changeCheckSeconds: 0 }, { model: 'Events Test' });
      await new Promise(r => setTimeout(r, 500)); // the stream opens
      assert.equal(app.$('#change-bar').hidden, true, 'nothing changed yet');
      await send('PUT', `/models/${made.id}/elements/${actor.id}`, { name: 'Senior clerk' });
      await waitFor(() => !app.$('#change-bar').hidden, { what: 'the bar, from the event (no polling)', timeout: 4000 });
      await waitFor(() => /1 change\(s\) by default/.test(app.$('#change-bar-msg').textContent), { what: 'who changed it, from the event' });
      app.$('#btn-change-dismiss').click();

      other = await send('POST', '/models', { xmiIdentifier: 'id-events-other', name: 'Made Elsewhere' });
      await waitFor(() => [...app.$('#model-select').options].some(o => o.textContent === 'Made Elsewhere'), { what: 'the new model in the list', timeout: 4000 });
      assert.equal(app.$('#model-select').value, String(made.id), 'the open model stays chosen');
      assert.equal(app.$('#change-bar').hidden, true, 'another model: no bar');

      await send('DELETE', `/models/${made.id}`);
      await waitFor(() => !app.$('#change-bar').hidden && /deleted elsewhere/.test(app.$('#change-bar-msg').textContent), { what: 'the model deleted', timeout: 4000 });
      assert.deepEqual(app.errors, []);
    } finally {
      await fetch(`/api/v2/models/${made.id}`, { method: 'DELETE', headers: ANY_VERSION });
      if (other) await fetch(`/api/v2/models/${other.id}`, { method: 'DELETE', headers: ANY_VERSION });
    }
  });

  test('2.27.0 (CM-10): more than six relationship types go into a submenu, opened by a click or →, closed by ←', async () => {
    const erp = SYN.elements['app-erp'];
    const app = await openApp(`#model=${SYN.model}&d=ex~${erp}~${erp}`, {}, { model: 'Synthetic Test Model' });
    const node = await waitFor(() => app.$(`#tab-layout .v-node[data-element="${erp}"]`), { what: 'ERP drawn', timeout: 20000 });
    await new Promise(r => setTimeout(r, 300)); // the counts of the menu arrive with the diagram
    app.ctx(node);
    const opener = await waitFor(() => app.$('.node-menu .submenu-opener'), { what: 'the submenu item' });
    assert.includes(opener.textContent, 'Show by relationship type');
    const group = app.$('.node-menu .submenu');
    assert.equal(group.hidden, true, 'closed at first');
    assert.ok(group.querySelectorAll('[role=menuitem]').length > 6, 'the types are in it');
    opener.click();
    assert.equal(group.hidden, false, 'opened by a click');
    assert.equal(opener.getAttribute('aria-expanded'), 'true');
    assert.ok(app.$('.node-menu'), 'the menu stays open');
    opener.click();
    assert.equal(group.hidden, true, 'closed again');
    // the keyboard: → opens it and goes to its first item, ← goes back
    opener.focus();
    app.doc.dispatchEvent(new app.win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    assert.equal(group.hidden, false, 'opened by →');
    assert.equal(app.doc.activeElement, group.querySelector('[role=menuitem]'), 'on its first type');
    app.doc.dispatchEvent(new app.win.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    assert.equal(group.hidden, true, 'closed by ←');
    assert.equal(app.doc.activeElement, opener, 'back on the item');
    // a type from it expands the diagram
    opener.click();
    const before = app.diagramNodes().length;
    group.querySelector('[role=menuitem]:not(:disabled)').click();
    await waitFor(() => !app.$('.node-menu'), { what: 'the menu closed by the action' });
    assert.ok(app.diagramNodes().length >= before);
    assert.deepEqual(app.errors, []);
  });

  test('2.27.0 (BR-24): an offline copy with a password: the model encrypted in the file, opened after the password', async () => {
    // the dialog: the two passwords must agree
    let app = await openApp(`#model=${M}`);
    const saved = [];
    app.win.URL.createObjectURL = blob => { saved.push(blob); return 'blob:x'; };
    app.win.HTMLAnchorElement.prototype.click = function () { saved.name = this.download; };
    app.$('#btn-export-offline').click();
    const dialog = await waitFor(() => app.$('#offline-dialog')?.open && app.$('#offline-dialog'), { what: 'the options' });
    dialog.querySelector('[name=password]').value = 'secret one';
    dialog.querySelector('[name=again]').value = 'secret two';
    dialog.querySelector('button[value=ok]').click();
    assert.equal(dialog.open, true, 'not made while the passwords differ');
    assert.equal(dialog.querySelector('.warn').hidden, false);
    dialog.querySelector('[name=again]').value = 'secret one';
    dialog.querySelector('button[value=ok]').click();
    await waitFor(() => saved.length, { what: 'the protected copy', timeout: 30000 });
    const html = await saved[0].text();
    assert.includes(html, '<title>ArchiMate model (offline copy, password)</title>', 'the title names no model');
    assert.notIncludes(html, 'Fixture Model (offline copy)');
    assert.match(html, /<script id="archixmi-snapshot" type="application\/octet-stream" data-sealed="[^"]+">/);
    assert.includes(app.$('#status').textContent, 'It asks for the password.');

    // opened: a wrong password is refused, the right one shows the model
    const page = await offlineCopy(M, 'protected.html', { password: 'secret one' });
    app = await openApp(`#model=${M}`, {}, { page, model: null });
    const form = await waitFor(() => app.$('.offline-password'), { what: 'the password form', timeout: 20000 });
    assert.equal(app.$('#offline-banner').hidden, true, 'nothing shown yet');
    form.querySelector('[name=password]').value = 'wrong';
    form.querySelector('button').click();
    await waitFor(() => !form.querySelector('.offline-password-wrong').hidden, { what: 'refused', timeout: 20000 });
    form.querySelector('[name=password]').value = 'secret one';
    form.querySelector('button').click();
    await waitFor(() => app.$$('#tree .tree-row .tree-label').some(l => l.textContent === 'Fixture Model'), { what: 'the model', timeout: 30000 });
    assert.equal(app.$('.offline-password'), null, 'the form is gone');
    assert.match(app.$('#offline-banner').textContent, /^Offline copy of “Fixture Model”/);
    assert.deepEqual(app.errors, []);
  });

  test('2.27.0 (BR-24): an offline copy of a part of the model: the selected folder', async () => {
    // the dialog offers the selected folder and the open view (API 3.19.0)
    let app = await openApp(`#model=${M}&folder=${F('Application')}`);
    await waitFor(() => app.$('#details h2')?.textContent === 'Application', { what: 'the folder selected' });
    const saved = [];
    app.win.URL.createObjectURL = blob => { saved.push(blob); return 'blob:x'; };
    app.win.HTMLAnchorElement.prototype.click = function () { saved.name = this.download; };
    app.$('#btn-export-offline').click();
    const dialog = await waitFor(() => app.$('#offline-dialog')?.open && app.$('#offline-dialog'), { what: 'the options' });
    const offered = [...dialog.querySelectorAll('.offline-part label')].map(l => l.textContent);
    assert.equal(offered[0], 'The whole model');
    assert.ok(offered.includes('The folder “Application” and what is in it'), JSON.stringify(offered));
    dialog.querySelector('.offline-part input[value="0"]').checked = true;
    dialog.querySelector('button[value=ok]').click();
    await waitFor(() => saved.length, { what: 'the copy of the folder', timeout: 30000 });
    assert.match(saved.name, /^Fixture_Model_-_Application_offline_/);

    // opened: the banner names the part, the tree holds it
    const page = await offlineCopy(M, 'part.html', { scope: `?folder=${F('Application')}` });
    app = await openApp(`#model=${M}`, {}, { page });
    assert.match(app.$('#offline-banner').textContent, /^Offline copy of part of “Fixture Model”: the folder “Application”\. Revision/);
    assert.deepEqual(app.errors, []);
  });

  test('2.27.2: a drill-down link of a partial copy to a view it does not hold says so', async () => {
    const page = await offlineCopy(M, 'part-view.html', { scope: `?view=${V(1)}` });
    const app = await openApp(`#model=${M}&view=${V(1)}`, {}, { page });
    const drill = await waitFor(() => app.$('#tab-layout .v-drill'), { what: 'view drawn' });
    assert.includes(drill.querySelector('title').textContent, 'Opens view: a view not in this offline copy');
    drill.dispatchEvent(new app.win.MouseEvent('click', { bubbles: true }));
    await waitFor(() => app.$('#status').textContent.startsWith('The view this link opens is not in this offline copy'), { what: 'the message' });
    assert.equal(app.$('#status').classList.contains('error'), false, 'a note, not an error');
    assert.equal(app.$('#diagram-title').textContent, 'View: Overview');
    assert.deepEqual(app.errors, []);
  });

  test('2.28.0: arrowheads of their own per drawing: a second tab does not take them from the first', async () => {
    const app = await openApp(`#model=${M}&d=nb~1~${E.erp}`);
    const panels = () => app.$$('#tab-layout .doc-panel');
    const shown = () => panels().find(p => !p.hidden);
    await waitFor(() => shown()?.querySelectorAll('.v-node[data-element]').length === 6, { what: 'diagram', timeout: 20000 });
    app.ctx(shown().querySelector('svg.view-svg'), 3, 3);
    app.clickMenu('Duplicate in a new tab');
    await waitFor(() => panels().length === 2 && shown()?.querySelectorAll('.v-node[data-element]').length === 6, { what: 'the second tab', timeout: 20000 });
    const ids = app.$$('#tab-layout marker').map(m => m.id);
    assert.equal(new Set(ids).size, ids.length, 'every marker id once in the page');
    const svg = shown().querySelector('svg.view-svg');
    const refs = [...svg.querySelectorAll('[marker-end], [marker-start]')]
      .flatMap(p => ['marker-end', 'marker-start'].map(a => p.getAttribute(a)).filter(Boolean));
    assert.ok(refs.length, 'the drawing has arrowheads');
    for (const ref of refs) {
      const id = ref.slice(5, -1);
      assert.ok(svg.querySelector(`marker[id="${id}"]`), `${ref} is a marker of the same drawing`);
    }
    assert.deepEqual(app.errors, []);
  });

  test('2.28.0: New model… with Archi\'s folders; the History tab shows older changes on request', async () => {
    const app = await openApp(`#model=${M}`);
    app.$('#btn-new-model').click();
    const form = app.$('#new-model-form');
    assert.ok(app.$('#new-model-dialog').open);
    form.name.value = 'Empty Model 2.28';
    form.requestSubmit(app.$('#btn-new-model-create'));
    await waitFor(() => app.treeRow('Empty Model 2.28'), { what: 'the new model opened', timeout: 20000 });
    const id = (await (await fetch('/api/v2/models')).json()).items.find(m => m.name === 'Empty Model 2.28').id;
    try {
      assert.equal(app.$('#status').textContent, 'Model “Empty Model 2.28” created.');
      const folders = (await (await fetch(`/api/v2/models/${id}/organizations`)).json()).map(f => f.label);
      assert.deepEqual(folders, ['Strategy', 'Business', 'Application', 'Technology & Physical', 'Motivation',
        'Implementation & Migration', 'Other', 'Relations', 'Views']);
      // 60 changes: the History tab of the model shows 50, then the rest on request
      const operations = Array.from({ length: 51 }, (_, i) => ({ op: 'createElement', type: 'BusinessActor', name: `Actor ${i}` }));
      const res = await fetch(`/api/v2/models/${id}/changes`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ANY_VERSION }, body: JSON.stringify({ operations }) });
      assert.equal(res.status, 200, await res.text());
      app.win.location.hash = '';
      app.win.location.hash = `#model=${id}`;
      await waitFor(() => app.$('#details [data-tab="history"]'), { what: 'the model details' });
      app.$('#details [data-tab="history"]').click();
      const rows = () => app.$$('#details .history li').length;
      await waitFor(() => rows() === 50, { what: 'the first page' });
      const more = app.$('#details [data-history-more]');
      const total = 51 + 9 + 1; // the elements, the folders, the model
      assert.equal(more.textContent, `Show ${total - 50} older changes`);
      more.click();
      await waitFor(() => rows() === total, { what: 'the older changes' });
      assert.equal(app.$('#details [data-history-more]'), null, 'nothing more');
      assert.includes(app.$('#details .history-more').textContent, `${total} of ${total} changes shown.`);
    } finally {
      await fetch(`/api/v2/models/${id}`, { method: 'DELETE', headers: ANY_VERSION });
    }
    assert.deepEqual(app.errors, []);
  });

  test('2.28.0: the link dialog picks the file from the folders the server allows', async () => {
    const path = (await (await fetch('/__test/linked-file?name=Picked.archimate', { method: 'POST', body: '<x/>' })).json()).path;
    const app = await openApp(`#model=${M}`);
    app.$('#btn-import').click();
    app.$('#btn-link-new').click();
    assert.ok(!app.$('#btn-link-browse').hidden, 'Browse… with API 3.20.0 and an admin key');
    app.$('#btn-link-browse').click();
    const folder = await waitFor(() => app.$('#link-picker li[data-folder] button'), { what: 'the allowed folder' });
    folder.click();
    const file = await waitFor(() => app.$$('#link-picker li[data-file]').find(li => li.dataset.file === path), { what: 'the file' });
    assert.ok(app.$('#link-picker .link-picker-up'), 'a way back up');
    file.querySelector('button').click();
    assert.equal(app.$('#link-form').path.value, path);
    assert.ok(app.$('#link-picker').hidden);
    app.$('#link-dialog').close();
    assert.deepEqual(app.errors, []);
  });

  test('2.28.0: a diagram of the whole model from Folders or Elements, up to the setting\'s number of elements', async () => {
    let app = await openApp(`#model=${M}`, { wholeModelMax: 100 });
    app.ctx(app.treeRow('Elements'));
    assert.deepEqual(app.menu(), ['A diagram of the whole model is offered up to 100 elements (Settings)']);
    app = await openApp(`#model=${SYN.model}`, {}, { model: 'Synthetic Test Model' });
    app.ctx(app.treeRow('Folders'));
    await waitFor(() => app.menu()?.includes('Diagram of the whole model'), { what: 'the entry' });
    app.clickMenu('Diagram of the whole model');
    await waitFor(() => app.$('#diagram-title').textContent === 'The whole model', { what: 'the diagram', timeout: 30000 });
    await waitFor(() => app.diagramNodes().length > 0, { what: 'drawn', timeout: 30000 });
    assert.includes(app.win.location.hash, 'd=wm');
    assert.deepEqual(app.errors, []);
  });

  test('2.28.0: collapse and show one level; ← Back brings the diagram back', async () => {
    const app = await openApp(`#model=${M}&d=nb~2~${E.erp}`);
    await waitFor(() => app.diagramNodes().length > 6, { what: 'depth 2', timeout: 20000 });
    const before = app.diagramNodes().length;
    app.ctx(app.$(`#tab-layout .v-node[data-element="${E.erp}"]`));
    app.clickMenu('Collapse and show one level');
    await waitFor(() => app.diagramNodes().length === 6, { what: 'ERP and its direct neighbours', timeout: 20000 });
    assert.match(app.$('#status').textContent, /^ERP: \d+ element\(s\) folded away, \d+ shown; ← Back undoes it\.$/);
    (await waitFor(() => app.$$('#tab-layout .layout-tools button').find(b => b.textContent === '← Back'), { what: 'Back' })).click();
    await waitFor(() => app.diagramNodes().length === before, { what: 'back', timeout: 20000 });
    assert.deepEqual(app.errors, []);
  });

  test('2.28.0: property search with AND and OR', async () => {
    const app = await openApp(`#model=${SYN.model}`, {}, { model: 'Synthetic Test Model' });
    const search = async (q, title) => {
      app.$('#search-input').value = q;
      app.$('#search-form').requestSubmit();
      await waitFor(() => app.$('#search-title').textContent === title, { what: `"${title}"` });
      return app.$$('#search-tree .tree-row .tree-label').map(l => l.textContent);
    };
    const and = await search('@Owner=Finance AND @Cost', 'Property search: Owner equals “Finance” AND Cost is set — 2 hits');
    assert.ok(and.includes('ERP') && and.includes('Kafka'), JSON.stringify(and));
    const or = await search('@Go-live OR @Cost=300', 'Property search: Go-live is set OR Cost equals “300” — 2 hits');
    assert.ok(or.includes('ERP') && or.includes('Web Shop'), JSON.stringify(or));
    await search('@Owner=Sales and Marketing', 'Property search: Owner equals “Sales and Marketing” — 0 hits');
    assert.deepEqual(app.errors, []);
  });

  test('2.28.0: the side panes close and open again, remembered', async () => {
    let app = await openApp(`#model=${M}`);
    const layout = app.$('main.layout');
    app.$('#btn-pane-tree').click();
    assert.ok(layout.classList.contains('tree-closed'));
    assert.equal(app.win.getComputedStyle(app.$('.tree-pane')).display, 'none');
    assert.equal(app.$('#btn-pane-tree').getAttribute('aria-pressed'), 'true');
    app.$('#btn-pane-details').click();
    assert.equal(app.win.getComputedStyle(app.$('.details-pane')).display, 'none');
    assert.ok(app.$('.diagram-pane').getBoundingClientRect().width > layout.getBoundingClientRect().width - 20, 'the diagram takes the width');
    app = await openApp(`#model=${M}`, {}, { keepStorage: true });
    assert.ok(app.$('main.layout').classList.contains('tree-closed') && app.$('main.layout').classList.contains('details-closed'), 'remembered');
    app.$('#btn-pane-tree').click();
    app.$('#btn-pane-details').click();
    assert.ok(app.win.getComputedStyle(app.$('.tree-pane')).display !== 'none', 'the tree open again');
    assert.ok(app.win.getComputedStyle(app.$('.details-pane')).display !== 'none', 'the details open again');
    assert.deepEqual(app.errors, []);
  });

  test('2.28.0: the Relationships tab marks the related elements on the diagram', async () => {
    const app = await openApp(`#model=${M}&d=nb~1~${E.erp}&element=${E.erp}`);
    await waitFor(() => app.diagramNodes().length === 6, { what: 'diagram', timeout: 20000 });
    await waitFor(() => app.$('#details h2')?.textContent === 'ERP', { what: 'ERP details' });
    app.$('#details [data-tab="relationships"]').click();
    const marks = () => app.$$('#detail-panel-relationships [data-on-diagram]');
    await waitFor(() => marks().length, { what: 'marks' });
    const shown = new Set(app.diagramNodes().map(n => Number(n.dataset.element)));
    for (const m of marks()) assert.equal(!m.hidden, shown.has(Number(m.dataset.onDiagram)), `element ${m.dataset.onDiagram}`);
    assert.ok(marks().some(m => !m.hidden), 'some are on the diagram');
    assert.equal(marks().find(m => !m.hidden).textContent, 'on diagram');
    // another diagram: the marks follow it
    app.win.location.hash = `#model=${M}&d=ty~Node&element=${E.erp}`;
    await waitFor(() => app.$('#diagram-title').textContent.startsWith('All Node'), { what: 'another diagram', timeout: 20000 });
    await waitFor(() => marks().length && marks().every(m => m.hidden === !app.diagramNodes().some(n => n.dataset.element === m.dataset.onDiagram)),
      { what: 'the marks of the new diagram' });
    assert.deepEqual(app.errors, []);
  });

  test('2.28.0: Filters → element types: all or none for one layer', async () => {
    const app = await openApp(`#model=${M}`);
    app.$('#btn-filters').click();
    const group = () => app.$('#type-filter-panel fieldset[data-filter-group="business"]');
    const checked = () => [...group().querySelectorAll('input[type=checkbox]')].map(c => c.checked);
    assert.ok(checked().every(Boolean), 'all shown by default');
    group().querySelector('[data-group-none]').click();
    await waitFor(() => checked().every(c => !c), { what: 'none of the business types' });
    assert.ok([...app.$('#type-filter-panel fieldset[data-filter-group="application"]').querySelectorAll('input')].every(c => c.checked), 'other layers stay');
    group().querySelector('[data-group-all]').click();
    await waitFor(() => checked().every(Boolean), { what: 'all again' });
    assert.deepEqual(app.errors, []);
  });

  test('2.29.0: render mode draws the diagram of a link and hands it over as SVG and PNG (RN-1)', async () => {
    const app = await openApp('', {}, { model: null, page: '../index.html?render' });
    await waitFor(() => app.doc.documentElement.dataset.render === 'ready', { what: 'render mode ready' });
    const r = app.win.archiRender;
    assert.equal(r.version, APP_VERSION);
    assert.equal(app.$$('#tree .tree-row').length, 0, 'no model opened by itself');
    // a stored view
    const view = await r.draw(`http://example.invalid/#model=${M}&d=v~${V(1)}`);
    assert.ok(view.title.startsWith('View: ') && view.width > 0 && view.height > 0, JSON.stringify(view));
    const svg = r.svg();
    assert.ok(svg.startsWith('<svg') && svg.includes('<style>') && !svg.includes('var(--'), 'a standalone SVG');
    // a generated diagram, left to right
    const nb = await r.draw(`#model=${M}&d=nb~1~${E.erp}`, { direction: 'LR' });
    assert.ok(nb.title.includes('ERP') && nb.info.includes('elements'), JSON.stringify(nb));
    const png = await r.png(1);
    assert.equal(png.width, nb.width);
    assert.equal(app.win.atob(png.base64).slice(1, 4), 'PNG');
    const tb = await r.draw(`model=${M}&d=nb~1~${E.erp}`);
    assert.ok(tb.width !== nb.width || tb.height !== nb.height, 'top to bottom again: what a link leaves out is the default');
    // what cannot be drawn says why
    const refusal = async (link, text) => {
      try { await r.draw(link); } catch (e) { assert.ok(e.message.includes(text), e.message); return; }
      assert.ok(false, `${link} was drawn`);
    };
    await refusal(`#model=${M}&d=v~id-no-such-view`, 'not in the model');
    await refusal('#model=no-such-model&d=v~1', 'No model');
    await refusal(`#model=${M}`, 'no diagram');
    assert.deepEqual(app.errors, ['1 item of the link is not in this model any more.'], 'only the status of the missing view');
  });

  // ---------------------------------------------------------------- 2.30.0

  const nameDialog = async (app, value) => {
    const dialog = await waitFor(() => app.$('#view-name-dialog')?.open && app.$('#view-name-dialog'), { what: 'the name dialog' });
    dialog.querySelector('input').value = value;
    dialog.querySelector('button[value=ok]').click();
  };
  const viewsApi = (path, method = 'GET', body) => fetch(`/api/v2/models/${M}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...ANY_VERSION }, body: body ? JSON.stringify(body) : undefined });

  test('2.30.0: documentation shown also when empty; "on diagram" and "add to diagram" on related elements and a relationship\'s ends', async () => {
    const app = await openApp(`#model=${M}&d=el~${E.erp}&element=${E.erp}`);
    await waitFor(() => app.diagramNodes().length === 1, { what: 'ERP alone', timeout: 20000 });
    await waitFor(() => app.$('#details h2')?.textContent === 'ERP', { what: 'ERP details' });
    // the documentation heading is there, with or without a text
    const docHeading = () => app.$$('#details h3').some(x => x.textContent === 'Documentation');
    assert.ok(docHeading(), 'Documentation section of ERP');
    // related elements: none is drawn, so each offers "add to diagram"
    app.$('#details [data-tab="relationships"]').click();
    const adds = () => app.$$('#detail-panel-relationships [data-add-to-diagram]').filter(b => !b.hidden);
    await waitFor(() => adds().length > 0, { what: '"add to diagram" buttons' });
    assert.equal(app.$$('#detail-panel-relationships [data-on-diagram]').filter(b => !b.hidden).length, 0, 'nothing on the diagram yet');
    const added = Number(adds()[0].dataset.addToDiagram);
    adds()[0].click();
    await waitFor(() => app.diagramNodes().some(n => Number(n.dataset.element) === added), { what: 'the related element added', timeout: 20000 });
    const mark = () => app.$(`#detail-panel-relationships [data-on-diagram="${added}"]`);
    await waitFor(() => mark() && !mark().hidden, { what: 'it is "on diagram" now' });
    assert.ok(app.$(`#detail-panel-relationships [data-add-to-diagram="${added}"]`).hidden, '"add to diagram" gone for it');
    // a click on "on diagram" marks the element in the diagram and makes it flash
    mark().click();
    const node = () => app.diagramNodes().find(n => Number(n.dataset.element) === added);
    await waitFor(() => node().classList.contains('marked') && node().classList.contains('v-flash'), { what: 'marked and flashing' });
    assert.equal(app.$('#details h2').textContent, 'ERP', 'the details stay');
    // a relationship's ends carry the same marks
    const rel = (await (await viewsApi('/relationships?limit=1000')).json()).items
      .find(r => r.sourceElementId === E.erp && r.targetElementId === added || r.targetElementId === E.erp && r.sourceElementId === added);
    if (rel) {
      app.win.location.hash = `#model=${M}&d=el~${E.erp}.${added}&relationship=${rel.id}`;
      await waitFor(() => app.$$('#details table [data-on-diagram]').length === 2, { what: 'both ends marked in the relationship details', timeout: 20000 });
      await waitFor(() => app.$$('#details table [data-on-diagram]').every(b => !b.hidden), { what: 'both ends on the diagram' });
    }
    // an element without documentation says so
    const els = (await (await viewsApi('/elements?limit=1000')).json()).items;
    const bare = els.find(e => !e.documentation);
    app.win.location.hash = `#model=${M}&element=${bare.id}`;
    await waitFor(() => app.$('#details .doc-empty'), { what: '"No documentation."' });
    assert.equal(app.$('#details .doc-empty').textContent, 'No documentation.');
    assert.deepEqual(app.errors, []);
  });

  test('2.30.0: the model is renamed (admin)', async () => {
    const app = await openApp(`#model=${M}`);
    try {
      await waitFor(() => app.$('#details .kind')?.textContent.includes('Model'), { what: 'model details' });
      const rename = () => app.$$('#details .actions button').find(b => b.textContent === 'Rename model…');
      await waitFor(rename, { what: 'Rename model…' });
      rename().click();
      await nameDialog(app, 'Fixture Model renamed');
      await waitFor(() => app.treeRow('Fixture Model renamed'), { what: 'the new name in the tree' });
      assert.equal(app.$('#model-select').selectedOptions[0].textContent, 'Fixture Model renamed');
      assert.equal((await (await viewsApi('')).json()).name, 'Fixture Model renamed');
      assert.deepEqual(app.errors, []);
    } finally {
      await viewsApi('', 'PUT', { name: 'Fixture Model' });
    }
  });

  test('2.30.0: a diagram saved as a recipe: in the tree, opened again, saved into, renamed and deleted', async () => {
    let app = await openApp(`#model=${M}&d=nb~1~${E.erp}`);
    const recipes = async () => (await (await viewsApi('/views?origin=created&limit=1000')).json()).items.filter(v => v.recipe != null);
    try {
      await waitFor(() => app.diagramNodes().length === 6, { what: '6 elements drawn', timeout: 20000 });
      const button = () => app.$('#tab-layout [data-tool="save-recipe"]');
      assert.equal(button().textContent, 'Save as recipe…');
      button().click();
      await nameDialog(app, 'Smoke recipe');
      await waitFor(async () => (await recipes()).length === 1, { what: 'the recipe stored' });
      const [stored] = await recipes();
      assert.equal(stored.name, 'Smoke recipe');
      assert.ok(stored.recipe.startsWith(`d=nb~1~`) && !stored.recipe.includes('model='), stored.recipe);
      await waitFor(() => app.treeRow('Smoke recipe'), { what: 'under Views in the tree' });
      assert.equal(app.treeRow('Smoke recipe').querySelector('.tree-icon').textContent, '📜');
      await waitFor(() => button().textContent === 'Save recipe “Smoke recipe”', { what: 'the diagram now saves into it' });

      // another diagram, then the recipe from the tree: its diagram again
      app.win.location.hash = `#model=${M}&d=el~${E.erp}`;
      await waitFor(() => app.diagramNodes().length === 1, { what: 'another diagram', timeout: 20000 });
      app.treeRow('Smoke recipe').querySelector('.tree-label').click();
      await waitFor(() => app.diagramNodes().length === 6, { what: 'the recipe drawn again', timeout: 20000 });
      await waitFor(() => app.$('#details .kind')?.textContent === '📜 Recipe', { what: 'its details' });
      const buttons = () => app.$$('#details .actions button').map(b => b.firstChild.textContent);
      assert.ok(['Rename…', 'Delete…'].every(b => buttons().includes(b)), JSON.stringify(buttons()));
      assert.ok(!buttons().includes('Edit view') && !buttons().includes('Add its elements to basket'), JSON.stringify(buttons()));
      // the tree's menu offers rename and delete too
      app.ctx(app.treeRow('Smoke recipe'));
      await waitFor(() => app.menu(), { what: 'the menu' });
      assert.ok(['Rename…', 'Delete…'].every(x => app.menu().includes(x)), JSON.stringify(app.menu()));
      app.doc.body.dispatchEvent(new app.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      // rename
      app.$$('#details .actions button').find(b => b.firstChild.textContent === 'Rename…').click();
      await nameDialog(app, 'Smoke recipe 2');
      await waitFor(() => app.treeRow('Smoke recipe 2'), { what: 'renamed in the tree' });
      // delete
      app.$$('#details .actions button').find(b => b.firstChild.textContent === 'Delete…').click();
      const ok = await waitFor(() => app.$('#confirm-dialog')?.open && app.$('#btn-confirm-ok'), { what: 'asked first' });
      ok.click();
      await waitFor(async () => (await recipes()).length === 0, { what: 'deleted' });
      await waitFor(() => !app.treeRow('Smoke recipe 2'), { what: 'gone from the tree' });
      assert.deepEqual(app.errors, []);
    } finally {
      for (const v of await recipes()) await viewsApi(`/views/${v.id}`, 'DELETE');
    }
  });

  test('2.31.0: every view directly under Views; who made a created one in its details; a source view renamed, and deleted after a warning', async () => {
    const created = await (await viewsApi('/views', 'POST', { name: 'By someone', recipe: `d=nb~1~${E.erp}` })).json();
    const app = await openApp(`#model=${M}&view=${created.id}`);
    try {
      await waitFor(() => app.treeRow('By someone'), { what: 'the recipe in the tree' });
      const level = label => app.treeRow(label).closest('li').getAttribute('aria-level');
      assert.equal(level('By someone'), String(Number(level('Views')) + 1), 'directly under Views');
      assert.ok(!app.treeRow('Created views') && !app.treeRow('Recipes'), 'no groups');
      // its details name who made it
      await waitFor(() => app.$('#details .kind')?.textContent === '📜 Recipe', { what: 'its details' });
      const rows = Object.fromEntries(app.$$('#details table tr').map(r => [r.querySelector('th')?.textContent, r.querySelector('td')?.textContent]));
      assert.equal(rows['Created by'], created.createdBy);
      assert.ok(rows['Created on'], JSON.stringify(rows));

      // a view of the model's source: renamed
      const source = V(2);
      const before = (await (await viewsApi(`/views/${source}`)).json()).name;
      app.win.location.hash = `#model=${M}&view=${source}`;
      await waitFor(() => app.$('#details h2')?.textContent === before, { what: 'the source view' });
      const button = label => app.$$('#details .actions button').find(b => b.firstChild.textContent === label);
      await waitFor(() => button('Rename…'), { what: 'Rename…' });
      button('Rename…').click();
      await nameDialog(app, 'Renamed source view');
      await waitFor(() => app.treeRow('Renamed source view'), { what: 'renamed in the tree' });
      assert.equal((await (await viewsApi(`/views/${source}`)).json()).name, 'Renamed source view');
      // delete asks first and says that it came with the file; cancelled here (the other tests need the view)
      button('Delete…').click();
      const dialog = await waitFor(() => app.$('#confirm-dialog')?.open && app.$('#confirm-dialog'), { what: 'asked first' });
      assert.includes(app.$('#confirm-text').textContent, "came with the model's file");
      dialog.close('');
      await sleep(200);
      assert.equal((await viewsApi(`/views/${source}`)).status, 200, 'not deleted');
      assert.deepEqual(app.errors, []);
      await viewsApi(`/views/${source}`, 'PUT', { name: before });
    } finally {
      await viewsApi(`/views/${created.id}`, 'DELETE');
    }
  });

  test('2.30.0: a diagram saved as a view keeps its orthogonal lines (attachment points)', async () => {
    const created = async () => (await (await viewsApi('/views?origin=created&limit=1000')).json()).items;
    const app = await openApp(`#model=${M}&d=nb~1~${E.erp}`);
    try {
      await waitFor(() => app.diagramNodes().length === 6, { what: '6 elements drawn', timeout: 20000 });
      app.$('#tab-layout [data-tool="save-view"]').click();
      await nameDialog(app, 'Orthogonal view');
      await waitFor(() => app.$('#diagram-title').textContent === '✎ View: Orthogonal view', { what: 'the saved view shown', timeout: 20000 });
      const [v] = (await created()).filter(x => x.name === 'Orthogonal view');
      const content = await (await viewsApi(`/views/${v.id}/content`)).json();
      const rels = content.connections.filter(c => c.relationshipRefId != null && c.sourceNodeId != null && c.targetNodeId != null);
      assert.ok(rels.length && rels.every(c => c.sourceAttachment && c.targetAttachment), 'each line keeps where it meets its boxes');
      // as drawn: every segment of every line is horizontal or vertical
      const slanted = [];
      for (const path of app.$$('#tab-layout .v-conn path:not(.v-hit)')) {
        const pts = [...path.getAttribute('d').matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map(m => [Number(m[1]), Number(m[2])]);
        for (let i = 1; i < pts.length; i++) {
          if (Math.abs(pts[i][0] - pts[i - 1][0]) > 1 && Math.abs(pts[i][1] - pts[i - 1][1]) > 1) slanted.push(path.getAttribute('d'));
        }
      }
      assert.deepEqual(slanted, [], 'no slanted segments');
      assert.deepEqual(app.errors, []);
    } finally {
      for (const v of (await created()).filter(x => x.name === 'Orthogonal view')) await viewsApi(`/views/${v.id}`, 'DELETE');
    }
  });

  // ---------------------------------------------------------------- 2.32.0

  test('2.32.0: the models in the model list by name', async () => {
    const app = await openApp(`#model=${M}`);
    const names = app.$$('#model-select option').map(o => o.textContent);
    assert.ok(names.length >= 2, JSON.stringify(names));
    const sorted = [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
    assert.deepEqual(names, sorted);
    assert.equal(app.$('#model-select').selectedOptions[0].textContent, 'Fixture Model', 'the open model stays selected');
  });

  test('2.32.0: Layout → Relationship names: hidden in every diagram and in its export, shown again', async () => {
    // Billing Service "bills" Order Handling: a named relationship
    const app = await openApp(`#model=${M}&d=el~${E.billingService}.${E.orderHandling}`);
    await waitFor(() => app.diagramNodes().length === 2, { what: 'the diagram', timeout: 20000 });
    const labels = () => app.$$('#tab-layout .v-conn-label');
    const visible = () => labels().filter(l => app.win.getComputedStyle(l).display !== 'none').length;
    const exported = async () => {
      const { svgToString } = await import('../../js/viewsvg.js');
      const layout = app.win.document.querySelector('#tab-layout svg.view-svg');
      return (svgToString(layout).match(/v-conn-label/g) || []).length - 1; // the export's own style names it once
    };
    assert.ok(labels().length > 0, 'the fixture has named relationships here');
    assert.equal(visible(), labels().length);
    app.$('#btn-layout').click();
    const box = await waitFor(() => app.$('#layout-panel #opt-rel-labels'), { what: 'the checkbox' });
    assert.equal(box.checked, true, 'shown by default');
    box.click();
    await waitFor(() => visible() === 0, { what: 'names hidden' });
    assert.equal(await exported(), 0, 'and left out of Download .svg');
    assert.equal(JSON.parse(app.win.localStorage.getItem(SETTINGS)).hideRelLabels, true, 'remembered');
    assert.equal(app.$('#btn-layout-default').disabled, false, 'Set to default offered');
    // a stored view too
    app.win.location.hash = `#model=${M}&view=${V(1)}`;
    await waitFor(() => app.$('#diagram-title').textContent.startsWith('View: '), { what: 'a stored view', timeout: 20000 });
    await waitFor(() => app.$('#tab-layout svg.view-svg')?.hasAttribute('data-hide-rel-labels'), { what: 'hidden there too' });
    // shown again by Set to default
    app.$('#btn-layout-default').click();
    await waitFor(() => !app.$('#tab-layout svg.view-svg').hasAttribute('data-hide-rel-labels'), { what: 'shown again' });
    assert.equal(app.$('#layout-panel #opt-rel-labels').checked, true);
    assert.deepEqual(app.errors, []);
  });

  // 2.33.0 (API 3.24.0): around ERP (fixture): Composition → Billing Module, Flow → junction → Billing Module and
  // Payment Gateway, Server —Serving→ ERP, Finance —Association→ ERP
  test('2.33.0: a neighbourhood with relationship types per direction, from a link', async () => {
    const app = await openApp(`#model=${M}&d=nb~1~${E.erp}~b~~Composition`);
    await waitFor(() => app.diagramNodes().length === 4, { what: 'every incoming, outgoing only Composition', timeout: 20000 });
    assert.equal(app.$('#diagram-title').textContent, 'Neighbourhood of ERP (depth 1) — incoming: all types · outgoing: Composition');
    assert.match(app.win.location.hash, /d=nb~1~[^&]+~b~~Composition(&|$)/, 'the link keeps the types');
    // one direction only: the types of the other are not in the link
    app.win.location.hash = `#model=${M}&d=nb~1~${E.erp}~o~~Flow`;
    await waitFor(() => app.diagramNodes().length === 4 && /outgoing: Flow$/.test(app.$('#diagram-title').textContent),
      { what: 'outgoing Flow only: through the junction', timeout: 20000 });
    assert.ok(!/incoming/.test(app.$('#diagram-title').textContent));
    assert.deepEqual(app.errors, []);
  });

  test('2.33.0: Neighbourhood with relationship types… asks for the types of each direction', async () => {
    const app = await openApp(`#model=${M}&d=nb~1~${E.erp}`);
    await waitFor(() => app.diagramNodes().length === 6, { what: 'the neighbourhood', timeout: 20000 });
    app.ctx(app.$(`#tab-layout .v-node[data-element="${E.erp}"]`));
    await waitFor(() => app.menu()?.includes('Neighbourhood with relationship types…'), { what: 'the element menu' });
    app.clickMenu('Neighbourhood with relationship types…');
    const dialog = await waitFor(() => app.$('#walk-dialog[open]'), { what: 'the dialog' });
    const side = key => dialog.querySelector(`[data-walk=${key}]`);
    const radio = (key, v) => side(key).querySelector(`[name=walk-${key}-all][value=${v}]`);
    const tick = (key, types) => side(key).querySelectorAll('[data-walk-type]').forEach(i => { i.checked = types.includes(i.value); });
    // nothing ticked: refused with a message
    radio('in', 'some').click(); tick('in', []);
    dialog.querySelector('button[value=ok]').click();
    assert.ok(dialog.open, 'still open');
    assert.match(dialog.querySelector('.error').textContent, /at least one relationship type/);
    // incoming only Serving, outgoing only Flow
    tick('in', ['Serving']);
    radio('out', 'some').click(); tick('out', ['Flow']);
    dialog.querySelector('button[value=ok]').click();
    await waitFor(() => !app.$('#walk-dialog'), { what: 'closed' });
    await waitFor(() => app.diagramNodes().length === 5 && /incoming: Serving · outgoing: Flow$/.test(app.$('#diagram-title').textContent),
      { what: 'ERP, Server, the junction, Billing Module, Payment Gateway', timeout: 20000 });
    assert.match(app.win.location.hash, /~b~Serving~Flow(&|$)/);
    assert.deepEqual(JSON.parse(app.win.localStorage.getItem(SETTINGS)).neighbourWalk.out.types, ['Flow'], 'remembered');
    assert.deepEqual(app.errors, []);
  });

  // 2.33.0 (API 3.24.0): recipe scripts, from the model's menu
  test('2.33.0: Recipe script…: check shows the errors by line, then makes the recipes; a second check finds them unchanged', async () => {
    const app = await openApp(`#model=${M}`);
    assert.equal(app.$('#btn-recipe-script').hidden, false, 'in the ⋮ menu of the model list too');
    app.ctx(app.treeRow('Fixture Model'));
    await waitFor(() => app.menu()?.includes('Recipe script…'), { what: 'the model menu' });
    app.clickMenu('Recipe script…');
    const dialog = await waitFor(() => app.$('#script-dialog[open]'), { what: 'the dialog' });
    const editor = dialog.querySelector('#script-text');
    const button = what => dialog.querySelector(`[data-script=${what}]`);
    const type = text => { editor.value = text; editor.dispatchEvent(new app.win.Event('input', { bubbles: true })); };
    assert.match(editor.value, /^script "Service reviews"/, 'an example to start from');
    // an error: its line, a suggestion, and a click that selects the line
    type('script "Smoke"\nfor each ApplicationComponnt where @lifecycle\n  diagram "{name}"\n    neighbourhood\n');
    button('check').click();
    const line = await waitFor(() => dialog.querySelector('.script-problems [data-line="2"]'), { what: 'the error of line 2' });
    assert.match(line.parentElement.textContent, /did you mean ApplicationComponent/);
    assert.ok(button('run').disabled, 'nothing to run with errors');
    line.click();
    assert.equal(editor.value.slice(editor.selectionStart, editor.selectionEnd), 'for each ApplicationComponnt where @lifecycle');
    // fixed: three components with a lifecycle, and one more diagram
    type('script "Smoke"\nfor each ApplicationComponent where @lifecycle\n  diagram "Around {name}"\n    neighbourhood depth 1\n'
      + 'diagram "ERP impact"\n  impact of "ERP" depth 2\n');
    assert.ok(button('run').disabled, 'checked first');
    button('check').click();
    await waitFor(() => /4 recipe\(s\): 4 new/.test(dialog.querySelector('.script-summary')?.textContent || ''), { what: 'the report' });
    const names = () => [...dialog.querySelectorAll('.script-table tbody tr td:nth-child(2)')].map(td => td.textContent);
    assert.deepEqual(names(), ['Around Billing Module', 'Around ERP', 'Around Payment Gateway', 'ERP impact']);
    assert.equal(button('run').textContent, 'Create / update (4)');
    button('run').click();
    await waitFor(() => /^“Smoke”: Done: 4 made/.test(dialog.querySelector('.script-summary')?.textContent || ''), { what: 'made' });
    assert.match(app.$('#status').textContent, /Recipe script “Smoke”: 4 made, 0 updated, 0 deleted\./);
    const views = (await (await fetch(`/api/v2/models/${M}/views?limit=200`)).json()).items.filter(v => v.script === 'Smoke');
    assert.equal(views.length, 4);
    // checked again: unchanged
    button('check').click();
    await waitFor(() => /4 unchanged/.test(dialog.querySelector('.script-summary')?.textContent || ''), { what: 'unchanged' });
    assert.ok(button('run').disabled, 'nothing to do');
    // Show draws one in a new tab
    const tabs = app.$$('#doc-tabs [role=tab]').length;
    [...dialog.querySelectorAll('.script-table tbody tr')].find(tr => tr.textContent.includes('Around ERP')).querySelector('button').click();
    await waitFor(() => !app.$('#script-dialog'), { what: 'closed' });
    await waitFor(() => /Neighbourhood of ERP/.test(app.$('#diagram-title').textContent), { what: 'the diagram', timeout: 20000 });
    assert.equal(app.$$('#doc-tabs [role=tab]').length, tabs + 1, 'in a new tab');
    // the view says where it came from
    app.win.location.hash = `#model=${M}&view=${views.find(v => v.name === 'ERP impact').id}`;
    await waitFor(() => /made by the recipe script “Smoke”/.test(app.$('#details').textContent), { what: 'its origin' });
    for (const v of views) await fetch(`/api/v2/models/${M}/views/${v.id}`, { method: 'DELETE', headers: ANY_VERSION });
    assert.deepEqual(app.errors, []);
  });

  // 2.34.0 (API 3.25.0): a recipe edited as a script; a recipe made by a script opens its kept script
  const scriptButton = (app, label) => app.$$('#details .actions button').find(b => b.firstChild.textContent === label);
  const scriptDialogParts = dialog => ({
    editor: dialog.querySelector('#script-text'),
    button: what => dialog.querySelector(`[data-script=${what}]`),
    summary: () => dialog.querySelector('.script-summary')?.textContent || '',
    type(text) { this.editor.value = text; this.editor.dispatchEvent(new dialog.ownerDocument.defaultView.Event('input', { bubbles: true })); },
  });

  test('2.34.0: Edit as script…: a recipe as script lines, checked and saved back into it', async () => {
    const created = await (await viewsApi('/views', 'POST', { name: 'Edit me', recipe: `d=nb~1~${E.erp}&n=0` })).json();
    try {
      const app = await openApp(`#model=${M}&view=${created.id}`);
      const edit = await waitFor(() => scriptButton(app, 'Edit as script…'), { what: 'Edit as script…' });
      edit.click();
      const dialog = await waitFor(() => app.$('#script-dialog[open] #script-text') && app.$('#script-dialog'), { what: 'the dialog' });
      const d = scriptDialogParts(dialog);
      assert.equal(d.editor.value, 'diagram "Edit me"\n  neighbourhood of "ERP" depth 1\n');
      d.button('check').click();
      await waitFor(() => /nothing to save/.test(d.summary()), { what: 'the same recipe' });
      assert.ok(d.button('save').disabled, 'nothing to save');
      d.type('diagram "Edit me"\n  neighbourhood of "ERP" depth 2\n  layout readable\n');
      assert.ok(d.button('save').disabled, 'checked first');
      d.button('check').click();
      await waitFor(() => /Saving changes: what it draws\./.test(d.summary()), { what: 'the change' });
      d.button('save').click();
      await waitFor(() => /Saved\./.test(d.summary()), { what: 'saved' });
      assert.match(app.$('#status').textContent, /Recipe “Edit me” saved\./);
      const view = await (await viewsApi(`/views/${created.id}`)).json();
      assert.match(view.recipe, /^d=nb~2~[^&]+&lo=s1\.6_t20_la_pa_ro_h1&n=0$/);
      assert.deepEqual(app.errors, []);
    } finally {
      await viewsApi(`/views/${created.id}`, 'DELETE');
    }
  });

  test('2.34.0: a recipe made by a script: Edit as script… opens the kept script at its diagram, or detaches it', async () => {
    const script = 'script "Smoke edit"\n\ndiagram "Smoke made"\n  impact of "ERP" depth 2\n';
    const ran = await (await fetch(`/api/v2/models/${M}/recipe-scripts/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ script }) })).json();
    const viewId = ran.recipes[0].viewId;
    try {
      const app = await openApp(`#model=${M}&view=${viewId}`);
      (await waitFor(() => scriptButton(app, 'Edit as script…'), { what: 'Edit as script…' })).click();
      let dialog = await waitFor(() => app.$('#script-dialog.script-choice[open]'), { what: 'the choice' });
      assert.match(dialog.textContent, /made by the recipe script “Smoke edit”/);
      [...dialog.querySelectorAll('button')].find(b => b.textContent === 'Open the script').click();
      dialog = await waitFor(() => app.$('#script-dialog[open]:not(.script-choice) #script-text') && app.$('#script-dialog'), { what: 'the script' });
      const d = scriptDialogParts(dialog);
      assert.equal(d.editor.value, script, 'the kept text');
      assert.equal(d.editor.value.slice(d.editor.selectionStart, d.editor.selectionEnd), 'diagram "Smoke made"', 'at its diagram');
      await waitFor(() => [...dialog.querySelectorAll('.script-kept option')].some(o => o.textContent === 'Smoke edit (1 recipes)'), { what: 'the kept scripts' });
      [...dialog.querySelectorAll('button')].find(b => b.textContent === 'Close').click();
      // detached: edited alone, and no longer the script's
      (await waitFor(() => scriptButton(app, 'Edit as script…'), { what: 'Edit as script… again' })).click();
      dialog = await waitFor(() => app.$('#script-dialog.script-choice[open]'), { what: 'the choice again' });
      [...dialog.querySelectorAll('button')].find(b => b.textContent === 'Detach and edit…').click();
      dialog = await waitFor(() => app.$('#script-dialog[open] #script-text') && app.$('#script-dialog'), { what: 'the recipe' });
      const r = scriptDialogParts(dialog);
      assert.match(dialog.querySelector('.script-note').textContent, /detaches this recipe from the recipe script “Smoke edit”/);
      r.button('check').click();
      await waitFor(() => /saving detaches it from its script/.test(r.summary()), { what: 'only the detaching' });
      r.button('save').click();
      await waitFor(() => /Saved\./.test(r.summary()), { what: 'saved' });
      assert.equal((await (await viewsApi(`/views/${viewId}`)).json()).script, null);
      assert.deepEqual(app.errors, []);
    } finally {
      await viewsApi(`/views/${viewId}`, 'DELETE');
      if (ran.storedScriptId) await viewsApi(`/recipe-scripts/${ran.storedScriptId}`, 'DELETE');
    }
  });
});
