import { describe, test, assert } from '../harness.js';
import { api, PAGE_SIZE, MIN_API_VERSION, olderThan } from '../../js/api.js';
import { ModelStore, isFolder } from '../../js/store.js';
import { fixtureStore, syntheticStore, E, R, V, F, M, SYN } from './fixture.js';

const ids = rels => rels.map(r => r.id).sort((a, b) => a - b);
const rids = (...ns) => ns.map(R).sort((a, b) => a - b);
const set = (...xs) => new Set(xs);

describe('store', () => {
  test('opening a model loads no element and no relationship (UP-6); a type is asked for when needed', async () => {
    const s = new ModelStore(await api.getModel(M));
    await s.load();
    assert.deepEqual([s.elements.size, s.relationships.size], [0, 0]);
    assert.deepEqual(s.views.map(v => v.name), ['Overview', 'Application Detail', 'Empty View']);
    assert.equal((await s.elementsOfType('DataObject')).length, 231);
    const apps = await s.elementsOfType('ApplicationComponent');
    assert.equal(apps[0].name, 'Billing Module', 'sorted by name');
    assert.deepEqual(s.degree(E.erp), { outgoing: 2, incoming: 2 }, 'with their relationship counts (HLP-6)');
    assert.equal(s.elements.size, 231 + apps.length, 'only these are cached');
  });

  test('ensure (UP-3, HLP-8): by ids, complete; a relationship with its ends; unknown ids stay unknown', async () => {
    const s = new ModelStore(await api.getModel(M));
    await s.load();
    s.remember({ elements: [{ id: E.erp, type: 'ApplicationComponent', name: 'ERP' }] }); // a summary
    await s.ensure({ elements: [E.erp, E.customer, 999999], relationships: [R(115)] });
    assert.ok(Array.isArray(s.element(E.erp).properties), 'a summary is replaced by the complete element');
    assert.ok(Array.isArray(s.element(E.customer).properties));
    assert.equal(s.element(999999), undefined);
    assert.ok(s.missing.has('e999999'), 'and is not asked for again');
    assert.equal(s.relationshipLabel(s.relationship(R(115))), 'Customer → [Serving bills: Billing Service → Order Handling]',
      'the ends, and the ends of an end that is a relationship, are cached with it');
    s.remember({ elements: [{ id: E.erp, name: 'ERP' }] });
    assert.ok(Array.isArray(s.element(E.erp).properties), 'a summary that comes later does not replace it');
    const before = s.elements.size;
    await s.ensure({ elements: [E.erp] });
    assert.equal(s.elements.size, before, 'what is cached is not asked for');
  });

  test('paging (API-1): pages of 1000; every page is fetched, in order, and progress is reported', async () => {
    assert.equal(PAGE_SIZE, 1000, 'the largest page the API accepts');
    const progress = [];
    const els = await api.listElements(M, {}, { pageSize: 50, onProgress: (n, total) => progress.push([n, total]) });
    assert.equal(els.length, 244, 'five pages of 50');
    assert.deepEqual(els.map(x => x.id), (await api.listElements(M)).map(x => x.id), 'same order as one page');
    assert.deepEqual(progress.at(-1), [244, 244]);
    assert.equal((await api.listElements(M, {}, { pageSize: 244 })).length, 244, 'exactly one page');
    await assert.throws(() => api.listElements(M, {}, { pageSize: PAGE_SIZE + 1 }), 'the API refuses a larger page');
  });

  test('statistics (API-5): the counts the tree and the status line show come from the API', async () => {
    const s = await fixtureStore();
    assert.equal(s.stats.elements.total, 244);
    assert.equal(s.stats.elements.byType.DataObject, 231);
    assert.equal(s.stats.elements.byLayer.Application, 235);
    assert.equal(s.stats.relationships.total, 16);
    assert.deepEqual([s.stats.relationships.byType.Flow, s.stats.relationships.onRelationships], [3, 1]);
    assert.deepEqual([s.stats.views.total, s.stats.organizations.folders], [3, 4]);
  });

  test('the API version this browser needs', async () => {
    assert.equal(MIN_API_VERSION, '2.10.0');
    assert.deepEqual(['2.0.0', '2.9.9', '1.9.9', '2.10.0', '2.10.1', '2.11.0', '3.0.0'].map(v => olderThan(v)), [true, true, true, false, false, false, false]);
    assert.equal(olderThan((await api.health()).version), false, 'the API under test is new enough');
  });

  test('the relationships of an element, of a type, on relationships (BR-6), each with its ends', async () => {
    const s = await fixtureStore();
    const { outgoing, incoming } = await s.relationshipsOf(E.erp);
    assert.deepEqual([ids(outgoing), ids(incoming)], [rids(106, 110), rids(113, 114)]);
    assert.ok(outgoing.every(r => s.element(r.targetElementId)), 'the other ends are cached');
    assert.deepEqual(ids(await s.attachedTo(R(108))), rids(115));
    assert.deepEqual(ids(await s.relationshipsOnRelationships()), rids(115));
    assert.deepEqual(ids(await s.relationshipsOfType('Flow')), ids((await api.listRelationships(M, { type: 'Flow' }))));
    assert.equal(s.endpointName(null, R(108)), '[Serving bills: Billing Service → Order Handling]');
    assert.equal(s.relationshipLabel(s.relationship(R(115))), 'Customer → [Serving bills: Billing Service → Order Handling]');
  });

  test('folders (HLP-7): counts with the tree; contents and paths asked of the API', async () => {
    const s = await fixtureStore();
    const app = F('Application');
    assert.deepEqual(s.folderCounts(app), { elements: 6, relationships: 0, views: 0, folders: 1 });
    assert.deepEqual(s.folderCounts(F('Relations')), { elements: 0, relationships: 3, views: 0, folders: 0 });
    assert.deepEqual(s.folderCounts(999999), { elements: 0, relationships: 0, views: 0, folders: 0 }, 'not a folder');
    assert.deepEqual(new Set(await s.folderElementIds(app, true)), set(E.billingModule, E.billingService, E.invoiceData, E.erp, E.junction, E.gateway));
    assert.deepEqual(new Set(await s.folderElementIds(app, false)), set(E.erp, E.junction, E.gateway));
    assert.deepEqual((await s.folderElements(app, { recursive: false, order: 'model' })).map(e => e.id), [E.erp, E.junction, E.gateway], 'in the order of the file');
    assert.deepEqual((await s.folderElements(app)).map(e => e.name), ['Billing Module', 'Billing Service', 'ERP', 'Invoice Data', 'Payment Gateway', null], 'by name, the unnamed junction last');
    assert.deepEqual((await s.folderPathOf('element', E.billingModule)).map(f => f.label), ['Application', 'Billing']);
    assert.deepEqual((await s.folderPathOf('relationship', R(101))).map(f => f.label), ['Relations']);
    assert.equal(await s.folderPathOf('element', E.orphan), null);
    assert.deepEqual(s.folderPath(F('Billing')).map(f => f.label), ['Application', 'Billing'], 'the path of a folder is read from the tree');
  });

  test('folders (BL-49): the tree holds folders only; what is filed in one is asked for when needed', async () => {
    const s = await fixtureStore();
    const items = [];
    const walk = list => list.forEach(o => { items.push(o); walk(o.children || []); });
    walk(s.folders.roots);
    assert.ok(items.length && items.every(isFolder), 'no element, relationship or view in the tree');
    const app = await s.folderItems(F('Application'));
    assert.deepEqual(app.elements.map(e => e.id), [E.erp, E.junction, E.gateway], 'the folder itself, in its order');
    assert.ok(app.elements.every(e => Array.isArray(e.properties) && e.degree), 'cached complete, with their counts');
    assert.deepEqual((await s.folderItems(F('Relations'))).relationships.length, 3);
    const folders = await s.elementFolders();
    assert.deepEqual(folders.get(E.billingModule), ['Application', 'Billing'], 'for the exports: where every element is filed');
    assert.equal(folders.get(E.orphan), undefined);
  });

  test('folders (API-11): a filed view is an item of its folder, not a folder', async () => {
    const s = await syntheticStore();
    const views = SYN.folders.Views, overview = SYN.views['v-overview'], order = SYN.views['v-order'];
    assert.equal(s.folders.byId.size, Object.keys(SYN.folders).length, 'only real folders are folders');
    assert.equal(s.stats.organizations.folders, Object.keys(SYN.folders).length);
    assert.deepEqual(s.folderCounts(views), { elements: 0, relationships: 0, views: 3, folders: 3 });
    assert.deepEqual((await s.folderPathOf('view', overview)).map(f => f.label), ['Views', 'Overviews']);
    assert.deepEqual((await s.folderPathOf('view', order)).map(f => f.label), ['Views', 'Details', 'Process']);
    assert.equal(await s.folderPathOf('view', SYN.views['v-empty']), null, 'a view in no folder');
    assert.deepEqual(await s.folderElementIds(views, true), [], 'views are not elements');
  });

  test('views: nested node tree in one request (API-2), where something is shown (API-4), links (API-10)', async () => {
    const s = await fixtureStore();
    const { nodes, connections } = await s.viewContent(V(1));
    assert.equal(nodes.length, 4);
    assert.equal(nodes[0].children.length, 3);
    assert.equal(connections.length, 4, 'three relationships and the line from the note');
    assert.deepEqual((await s.viewsShowing('element', E.billingModule)).map(v => [v.id, v.name]), [[V(1), 'Overview'], [V(2), 'Application Detail']]);
    assert.deepEqual((await s.viewsShowing('element', E.orphan)), []);
    assert.deepEqual((await s.viewsShowing('relationship', R(106))).map(v => v.id), [V(1), V(2)]);
    const out = await s.viewLinks(V(1));
    assert.deepEqual(out.outgoing.map(l => [l.targetViewId, l.targetViewName, l.label]), [[V(2), 'Application Detail', 'Application Detail']]);
    assert.deepEqual(out.incoming, []);
    assert.deepEqual((await s.viewLinks(V(2))).incoming.map(l => [l.sourceViewId, l.sourceViewName]), [[V(1), 'Overview']]);
  });

  test('the elements of a view with their place there (HLP-7)', async () => {
    const s = await fixtureStore();
    const shape = await s.viewElementPositions(V(1));
    assert.deepEqual(new Set(shape.keys()), set(E.customer, E.role, E.orderHandling, E.erp, E.billingModule));
    assert.deepEqual(shape.get(E.erp), { x: 460, y: 20 });
    assert.equal((await s.viewElementPositions(V(3))).size, 0, 'the empty view');
  });

  test('property index (HLP-9): from the API, as the panel wants it', async () => {
    const s = await fixtureStore();
    assert.deepEqual([...s.propertyIndex.keys()], ['cost', 'lifecycle', 'owner']);
    assert.deepEqual([...(await syntheticStore()).propertyIndex.get('Owner').langs], ['cs', 'en']);
    assert.equal(s.propertyIndex.get('lifecycle').count, 4);
    assert.deepEqual(s.propertyIndex.get('lifecycle').values, set('current', 'planned', 'to-be-deprecated'));
  });
});
