// The graph rules asked of the API (js/graph.js): requests from the app's
// terms, answers in the shape the app draws. Until 2.8.0 every answer was also
// compared with the browser's own rule code (UP-5); that code went in phase 4.

import { describe, test, assert } from '../harness.js';
import { settings } from '../../js/config.js';
import { api, askStats } from '../../js/api.js';
import * as graph from '../../js/graph.js';
import { DiagramFilter } from '../../js/filters.js';
import { PropertyOptions } from '../../js/properties.js';
import { ELEMENT_TYPES, RELATIONSHIP_TYPES } from '../../js/archimate.js';
import { DEFAULT_TYPES } from '../../js/impact.js';
import { fixtureStore, syntheticStore, E, R, F, SYN } from './fixture.js';

const set = (...xs) => new Set(xs);
const ids = rels => rels.map(r => r.id).sort((a, b) => a - b);
const rids = (...ns) => ns.map(R).sort((a, b) => a - b);
const without = (all, ...xs) => all.filter(t => !xs.includes(t));

/** Run `fn` with the nesting settings as given. */
async function compared(fn, { nest = false, assignment = false, groupingOnly = false } = {}) {
  const before = { nestGenerated: settings.nestGenerated, nestAssignment: settings.nestAssignment, nestGroupingOnly: settings.nestGroupingOnly };
  Object.assign(settings, { nestGenerated: nest, nestAssignment: assignment, nestGroupingOnly: groupingOnly });
  try {
    return await fn();
  } finally {
    Object.assign(settings, before);
  }
}

describe('graph helpers', () => {
  test('the app\'s filters as request properties', () => {
    assert.deepEqual(graph.filterParams(new DiagramFilter(), new PropertyOptions()), {});
    const f = new DiagramFilter(['Goal', 'Node'], without(RELATIONSHIP_TYPES, 'Flow'));
    const params = graph.filterParams(f, new PropertyOptions({ filterName: 'owner', filterOp: 'ne', filterValue: 'IT' }));
    assert.deepEqual(params.elementTypes, ['Goal', 'Node']);
    assert.equal(params.relationshipTypes.length, RELATIONSHIP_TYPES.length - 1);
    assert.deepEqual(params.property, { name: 'owner', op: 'ne', value: 'IT' });
    assert.deepEqual(graph.filterParams(null, new PropertyOptions({ filterName: 'owner', filterOp: 'has' })).property, { name: 'owner', op: 'exists' });
    assert.deepEqual(graph.filterParams(null, new PropertyOptions({ filterName: 'owner', filterOp: 'missing', filterValue: 'x' })).property, { name: 'owner', op: 'missing' });
    assert.equal(graph.apiLayer('implementation'), 'ImplementationMigration');
  });

  test('neighbourhood (HLP-1): direction, junctions, relationship ends, depth', async () => {
    const s = await fixtureStore();
    await compared(async () => {
      const near = await graph.neighbourhood(s, { seeds: [E.erp], depth: 1 });
      assert.deepEqual(near.ids, set(E.erp, E.billingModule, E.junction, E.gateway, E.server, E.finance));
      assert.equal(near.relationships.length, 7);
      assert.ok(near.relationships.every(r => r === s.relationship(r.id)), 'the loaded relationship objects');
      assert.deepEqual(near.filtered, { elements: 0, relationships: 0 });
      assert.equal(near.nesting, null, 'nesting is off');
      assert.deepEqual((await graph.neighbourhood(s, { seeds: [E.erp], depth: 1, direction: 'out' })).ids, set(E.erp, E.billingModule, E.junction, E.gateway));
      assert.deepEqual((await graph.neighbourhood(s, { seeds: [E.erp], depth: 1, direction: 'in' })).ids, set(E.erp, E.server, E.finance));
      assert.deepEqual((await graph.neighbourhood(s, { seeds: [E.customer], depth: 1 })).ids, set(E.customer, E.role, E.billingService, E.orderHandling, E.orderService));
      assert.deepEqual((await graph.neighbourhood(s, { seeds: [E.erp], depth: 0 })).ids, set(E.erp));
      const d2 = await graph.neighbourhood(s, { seeds: [E.erp], depth: 2 });
      assert.ok(d2.ids.has(E.billingService) && d2.ids.has(E.invoiceData) && !d2.ids.has(E.orphan));
    });
  });

  test('neighbourhood: type and property filters (GAP-1), and what they left out (GAP-9)', async () => {
    const s = await fixtureStore();
    await compared(async () => {
      const noComponents = new DiagramFilter(without(ELEMENT_TYPES, 'ApplicationComponent'), RELATIONSHIP_TYPES);
      const a = await graph.neighbourhood(s, { seeds: [E.erp], depth: 1, filter: noComponents });
      assert.deepEqual(a.ids, set(E.erp, E.junction, E.server, E.finance));
      assert.deepEqual(a.filtered.elements, 2);
      const noFlow = new DiagramFilter(ELEMENT_TYPES, without(RELATIONSHIP_TYPES, 'Flow'));
      const b = await graph.neighbourhood(s, { seeds: [E.erp], depth: 1, filter: noFlow });
      assert.deepEqual(b.ids, set(E.erp, E.billingModule, E.server, E.finance));
      const planned = new PropertyOptions({ filterName: 'lifecycle', filterOp: 'eq', filterValue: 'PLANNED' });
      const c = await graph.neighbourhood(s, { seeds: [E.erp], depth: 2, props: planned });
      assert.deepEqual(c.ids, set(E.erp, E.billingModule), 'nothing behind an element the filter leaves out');
      const notSet = new PropertyOptions({ filterName: 'lifecycle', filterOp: 'missing' });
      assert.deepEqual((await graph.neighbourhood(s, { seeds: [E.erp], depth: 1, props: notSet })).ids, set(E.erp, E.junction, E.gateway, E.server, E.finance).has(E.gateway)
        ? set(E.erp, E.junction, E.server, E.finance) : set());
    });
  });

  test('subgraph (HLP-2): the sets, the closure over relationships on relationships, left-out relationships (GAP-4)', async () => {
    const s = await fixtureStore();
    await compared(async () => {
      const three = [E.customer, E.orderHandling, E.billingService];
      assert.deepEqual(ids((await graph.subgraph(s, { elementIds: three })).relationships), rids(108, 115));
      assert.deepEqual(ids((await graph.subgraph(s, { elementIds: [E.customer, E.orderHandling] })).relationships), []);
      const noServing = new DiagramFilter(ELEMENT_TYPES, without(RELATIONSHIP_TYPES, 'Serving'));
      assert.deepEqual(ids((await graph.subgraph(s, { elementIds: three }, { filter: noServing })).relationships), []);
      const hidden = await graph.subgraph(s, { elementIds: three }, { exclude: [R(108)] });
      assert.deepEqual(ids(hidden.relationships), [], 'what is attached to a left-out relationship goes with it');
      assert.deepEqual(hidden.filtered, { elements: 0, relationships: 2 });

      const folder = await graph.subgraph(s, { folderId: F('Application') });
      assert.deepEqual(folder.ids, set(E.billingModule, E.billingService, E.invoiceData, E.erp, E.junction, E.gateway));
      const type = await graph.subgraph(s, { elementType: 'ApplicationComponent' });
      assert.deepEqual(type.ids, set(E.erp, E.billingModule, E.gateway));
      assert.deepEqual(ids(type.relationships), rids(106, 116));
      const layer = await graph.subgraph(s, { layer: 'business' });
      assert.deepEqual(layer.ids, set(E.customer, E.role, E.orderHandling, E.invoice, E.orderService));
      const flows = await graph.subgraph(s, { relationshipType: 'Flow' });
      assert.deepEqual(flows.ids, set(E.erp, E.junction, E.billingModule, E.gateway));
      assert.deepEqual(ids(flows.relationships), rids(110, 111, 112), 'only the type asked for');
      const onRel = await graph.subgraph(s, { onRelationships: true });
      assert.deepEqual(onRel.ids, set(E.customer, E.billingService, E.orderHandling));
      assert.deepEqual(ids(onRel.relationships), rids(108, 115));
      assert.deepEqual((await graph.subgraph(s, { elementIds: [] })).ids, set(), 'an empty diagram');
    });
  });

  test('nesting comes with the answer (HLP-2), for a set and for a neighbourhood', async () => {
    const s = await fixtureStore();
    await compared(async () => {
      const near = await graph.neighbourhood(s, { seeds: [E.erp, E.customer], depth: 1 });
      assert.equal(near.nesting.parentOf.get(E.billingModule), E.erp);
      assert.ok(near.nesting.nestedRelIds.has(R(106)));
      assert.ok(!near.nesting.parentOf.has(E.role), 'Assignment is not nested by default');
      const none = await graph.neighbourhood(s, { seeds: [E.erp], depth: 1, nesting: false });
      assert.equal(none.nesting, null, 'not asked for');
    }, { nest: true });
    await compared(async () => {
      const near = await graph.subgraph(s, { elementIds: [E.erp, E.customer, E.role, E.billingModule] });
      assert.equal(near.nesting.parentOf.get(E.role), E.customer, 'Assignment too, when the setting says so');
      assert.equal(near.nesting.parentOf.get(E.billingModule), E.erp);
    }, { nest: true, assignment: true });
  });

  test('nesting only inside a Grouping (API 2.9.0)', async () => {
    const s = await syntheticStore();
    const core = ['grp-core', 'app-erp', 'app-erp-billing', 'app-erp-stock', 'app-kafka'].map(x => SYN.elements[x]);
    await compared(async () => {
      const set = await graph.subgraph(s, { elementIds: core });
      assert.deepEqual([...set.nesting.parentOf].sort((a, b) => a[0] - b[0]),
        [[SYN.elements['app-erp'], SYN.elements['grp-core']], [SYN.elements['app-kafka'], SYN.elements['grp-core']]].sort((a, b) => a[0] - b[0]));
      assert.ok(!set.nesting.parentOf.has(SYN.elements['app-erp-billing']), 'ERP is not a container here');
      await graph.neighbourhood(s, { seeds: [SYN.elements['grp-core']], depth: 2 });
    }, { nest: true, groupingOnly: true });
    await compared(async () => {
      const set = await graph.subgraph(s, { elementIds: core });
      assert.equal(set.nesting.parentOf.get(SYN.elements['app-erp-billing']), SYN.elements['app-erp'], 'everywhere: ERP contains its parts');
    }, { nest: true });
  });

  test('impact and dependencies (HLP-3): levels, what to draw, CSV', async () => {
    const s = await fixtureStore();
    const levels = a => Object.fromEntries([...a.results.values()].map(r => [r.id, r.level]));
    await compared(async () => {
      const a = await graph.impact(s, [E.billingService], { types: DEFAULT_TYPES });
      assert.deepEqual(levels(a), { [E.orderHandling]: 1, [E.orderService]: 2, [E.customer]: 3, [E.role]: 4 });
      assert.deepEqual([a.maxLevel, a.truncated], [4, false]);
      assert.deepEqual(a.results.get(E.orderHandling), { id: E.orderHandling, level: 1, via: R(108), from: E.billingService });
      assert.equal(a.relationships, undefined, 'not asked for');
      const d = levels(await graph.impact(s, [E.erp], { direction: 'dependencies', types: DEFAULT_TYPES }));
      assert.deepEqual([d[E.billingModule], d[E.server], d[E.invoiceData]], [1, 1, 2]);
      assert.deepEqual(levels(await graph.impact(s, [E.erp], { types: ['Flow'] })), { [E.junction]: 1, [E.billingModule]: 1, [E.gateway]: 1 });
      const cut = await graph.impact(s, [E.billingService], { types: DEFAULT_TYPES, maxDepth: 2 });
      assert.deepEqual([levels(cut), cut.truncated], [{ [E.orderHandling]: 1, [E.orderService]: 2 }, true]);
      const several = levels(await graph.impact(s, [E.billingService, E.orderService], { types: DEFAULT_TYPES }));
      assert.deepEqual([several[E.orderHandling], several[E.customer], several[E.orderService]], [1, 1, undefined]);

      const drawn = await graph.impact(s, [E.billingService], { types: DEFAULT_TYPES, draw: true });
      assert.deepEqual(ids(drawn.relationships), rids(101, 103, 104, 108), 'the relationships walked along');
    });
    await compared(async () => {
      const drawn = await graph.impact(s, [E.erp], { direction: 'dependencies', types: DEFAULT_TYPES, draw: true });
      assert.equal(drawn.nesting.parentOf.get(E.billingModule), E.erp);
    }, { nest: true });
    const csv = (await graph.impactCsv(s, [E.billingService], { types: DEFAULT_TYPES })).split('\r\n');
    assert.equal(csv[0], '"level";"name";"type";"layer";"via relationship";"from";"xmi identifier"', 'the browser asks for the semicolon (API 3.2.0)');
    assert.equal(csv[1], '"1";"Order Handling";"Business Process";"Business";"Serving";"Billing Service";"id-e3"');
    assert.equal(csv.length, 5);
  });

  test('expansion counts and hidden neighbours (HLP-5)', async () => {
    const s = await fixtureStore();
    await compared(async () => {
      const counts = await graph.expansionCounts(s, [E.erp, E.server], [E.erp, E.server]);
      assert.equal(counts.get(E.erp).total, 4);
      assert.deepEqual([counts.get(E.erp).out, counts.get(E.erp).in], [3, 1]);
      assert.deepEqual(counts.get(E.erp).byType.find(x => x.type === 'Flow'), { type: 'Flow', direction: 'out', count: 3 });
      assert.equal(counts.get(E.server).total, 0);
      assert.equal((await graph.expansionCounts(s, [], [])).size, 0, 'nothing to ask');
      assert.deepEqual(await graph.hiddenNeighbours(s, E.erp, [E.erp, E.server]), set(E.billingModule, E.junction, E.gateway, E.finance));
      assert.deepEqual(await graph.hiddenNeighbours(s, E.erp, [E.erp], { type: 'Serving' }), set(E.server));
      assert.deepEqual(await graph.hiddenNeighbours(s, E.erp, [E.erp], { type: 'Flow', direction: 'in' }), set());
      const noFlow = new DiagramFilter(ELEMENT_TYPES, without(RELATIONSHIP_TYPES, 'Flow'));
      assert.deepEqual(await graph.hiddenNeighbours(s, E.erp, [E.erp], { type: 'Flow', filter: noFlow }), set(), 'a type the filter hides');
    });
  });

  test('paths (HLP-4): shortest first, elements in the order of the path', async () => {
    const s = await fixtureStore();
    const found = await graph.paths(s, E.erp, E.gateway);
    assert.equal(found.paths[0].length, 2);
    assert.deepEqual([found.paths[0].elements[0], found.paths[0].elements.at(-1)], [E.erp, E.gateway]);
    assert.equal(found.paths[0].relationships.length, 2);
    assert.ok(found.paths.every((p, i) => !i || p.length >= found.paths[i - 1].length));
    assert.deepEqual((await graph.paths(s, E.erp, E.orphan)).paths, []);
    assert.equal((await graph.paths(s, E.erp, E.gateway, { k: 1 })).paths.length, 1);
  });

  test('answers of the POST helpers are kept with their ETag and reused (UP-4, HLP-0)', async () => {
    const s = await fixtureStore();
    const body = { seeds: [E.finance], depth: 1 };
    const first = await api.graph.neighbourhood(s.id, body);
    const kept = askStats().kept;
    const again = await api.graph.neighbourhood(s.id, { seeds: [E.finance], depth: 1 });
    assert.ok(again === first, 'the kept answer: the API said 304 Not Modified');
    assert.equal(askStats().kept, kept, 'nothing new was kept');
    const other = await api.graph.neighbourhood(s.id, { seeds: [E.finance], depth: 2 });
    assert.ok(other !== first);
    assert.equal(askStats().kept, kept + 1);
    // the CSV of the same question is another answer
    const text = await api.graph.impactCsv(s.id, { start: [E.finance] });
    assert.equal(typeof text, 'string');
    assert.ok((await api.graph.impact(s.id, { start: [E.finance] })).results, 'JSON for the same body');
  });

});
