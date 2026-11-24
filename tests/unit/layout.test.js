// Layout: options, manual positions, collapse and the ELK layout itself. What a diagram holds, and
// its nesting, come from the API (graph.test.js).

import { describe, test, assert } from '../harness.js';
import { LayoutPrefs, PRESETS } from '../../js/layoutprefs.js';
import { encodeManual, decodeManual, applyPins, positionsOf, findNode, isManual, emptyManual } from '../../js/manual.js';
import { collapseAround } from '../../js/explorer.js';
import { layoutElements } from '../../js/elklayout.js';
import * as graph from '../../js/graph.js';
import { settings } from '../../js/config.js';
import { fixtureStore, E, R } from './fixture.js';

const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (c, p) => c.x >= p.x && c.y >= p.y && c.x + c.w <= p.x + p.w && c.y + c.h <= p.y + p.h;

describe('layout', () => {
  describe('layout options', () => {
    test('defaults encode to an empty string; custom options round-trip', () => {
      assert.equal(new LayoutPrefs().encode(), '');
      const lp = LayoutPrefs.fromPreset('readable').with({ routing: 'SPLINES', hubs: false, layering: 'LONGEST_PATH' });
      assert.equal(lp.encode(), 's1.6_t20_ll_pa_rs_h0');
      assert.deepEqual({ ...LayoutPrefs.decode(lp.encode()) }, { ...lp });
      assert.equal(LayoutPrefs.fromPreset('compact').preset(), 'compact');
      assert.equal(lp.preset(), null, 'custom');
    });

    test('out-of-range and unknown values are clamped / ignored', () => {
      const lp = LayoutPrefs.decode('s9_t999_lx_pq_rz');
      assert.equal(lp.spacing, 2.5);
      assert.equal(lp.thoroughness, 50);
      assert.equal(lp.layering, 'auto');
      assert.equal(lp.routing, 'ORTHOGONAL');
      assert.ok(Object.keys(PRESETS).length === 3);
    });
  });

  describe('manual positions', () => {
    test('link encoding round-trips hints and pins', () => {
      const m = { hints: new Map([['e1', { x: 10, y: -20 }]]), pins: new Map([['e2', { x: 5, y: 6 }], ['r7', { x: 1, y: 2 }]]) };
      const s = encodeManual(m, 'TB.n1');
      assert.equal(s, 'TB.n1!e1.10.-20!e2.5.6_r7.1.2');
      const back = decodeManual(s);
      assert.equal(back.signature, 'TB.n1');
      assert.deepEqual(back.manual.hints, m.hints);
      assert.deepEqual(back.manual.pins, m.pins);
      assert.ok(!isManual(emptyManual()) && isManual(m));
    });

    test('pinning a container moves its children; a moved child grows its container', () => {
      const layout = {
        nodes: [{ id: 'e1', x: 0, y: 0, w: 200, h: 120, children: [{ id: 'e2', x: 20, y: 40, w: 100, h: 50, children: [] }] }, { id: 'e3', x: 300, y: 0, w: 100, h: 50, children: [] }],
        connections: [{ id: 'x9', sourceNodeId: 'e2', targetNodeId: 'e3', points: [{ x: 120, y: 65 }, { x: 300, y: 25 }] }],
      };
      const moved = applyPins(layout, new Map([['e1', { x: 50, y: 10 }]]));
      assert.deepEqual(positionsOf(moved.nodes).get('e2'), { x: 70, y: 50 }, 'child moved with its container');
      const grown = applyPins(layout, new Map([['e2', { x: 150, y: 100 }]]));
      assert.ok(inside(findNode(grown.nodes, 'e2'), findNode(grown.nodes, 'e1')), 'container grew around the child');
      assert.equal(layout.nodes[0].x, 0, 'the input layout is not changed');
    });
  });

  test('collapse (CM-13): fold away what hangs off an element, keep the way to the selected one', () => {
    const run = (edges, at, toward, ids = [...new Set(edges.flat())]) => [...collapseAround({ ids, edges, at, toward })].sort();
    // S - A - X - B - C, X - D: X keeps its way to S (A); B, C and D fold away
    const tree = [['S', 'A'], ['A', 'X'], ['X', 'B'], ['B', 'C'], ['X', 'D']];
    assert.deepEqual(run(tree, 'X', 'S'), ['B', 'C', 'D']);
    // on the selected element itself: everything connected to it
    assert.deepEqual(run(tree, 'S', 'S'), ['A', 'B', 'C', 'D', 'X']);
    // nothing selected: the same as on the element itself
    assert.deepEqual(run(tree, 'X', null), ['A', 'B', 'C', 'D', 'S']);
    // a loop: B is still connected to S another way, so it stays (and so does C)
    assert.deepEqual(run([...tree, ['C', 'S']], 'X', 'S'), ['D']);
    // two equally short ways to S: both stay
    assert.deepEqual(run([['X', 'A'], ['A', 'S'], ['X', 'B'], ['B', 'S'], ['X', 'D']], 'X', 'S'), ['D']);
    // what is not connected to X is left alone
    assert.deepEqual(run([['X', 'A'], ['S', 'T'], ['E', 'F']], 'X', 'S'), ['A']);
    assert.deepEqual(run([['S', 'A'], ['E', 'F']], 'S', 'S'), ['A']);
    // an element without relationships, or one not in the diagram: nothing
    assert.deepEqual(run([['S', 'A']], 'Z', 'S', ['S', 'A', 'Z']), []);
    assert.deepEqual(run([['S', 'A']], 'Q', 'S'), []);
  });

  describe('ELK layout', () => {
    test('lays out a neighbourhood: every node placed, no overlaps, every relationship routed', async () => {
      const s = await fixtureStore();
      const { ids, relationships } = await graph.neighbourhood(s, { seeds: [E.erp], depth: 1, nesting: false });
      const elements = [...ids].map(id => s.element(id));
      const { nodes, connections } = await layoutElements({ elements, relationships, focus: new Set([E.erp]) });
      assert.equal(nodes.length, ids.size);
      for (const n of nodes) assert.ok([n.x, n.y, n.w, n.h].every(Number.isFinite), `${n.id} has a position`);
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) assert.ok(!overlap(nodes[i], nodes[j]), `${nodes[i].id} overlaps ${nodes[j].id}`);
      assert.deepEqual(new Set(connections.map(c => c.relationshipRefId)), new Set(relationships.map(r => r.id)));
      assert.ok(connections.every(c => c.points.length >= 2));
      assert.ok(nodes.find(n => n.id === `e${E.erp}`).focus);
    }, { timeout: 30000 });

    test('nested layout: children inside their container; helper dot for a relationship on a relationship', async () => {
      const s = await fixtureStore();
      const before = settings.nestGenerated;
      settings.nestGenerated = true;
      const { ids, relationships, nesting } = await graph.subgraph(s,
        { elementIds: [E.customer, E.orderHandling, E.billingService, E.erp, E.billingModule] }).finally(() => { settings.nestGenerated = before; });
      const elements = [...ids].map(id => s.element(id));
      const { nodes, connections } = await layoutElements({ elements, relationships, nesting, direction: 'LR' });
      const erp = findNode(nodes, `e${E.erp}`), billing = findNode(nodes, `e${E.billingModule}`);
      assert.ok(erp.children.some(c => c.id === billing.id), 'Billing Module nested in ERP');
      assert.ok(inside(billing, erp), 'and drawn inside it');
      assert.ok(findNode(nodes, `r${R(108)}`)?.dotRelationshipId === R(108), 'helper dot for relationship 108');
      assert.deepEqual(connections.filter(c => c.relationshipRefId === R(108)).map(c => c.half).sort(), ['first', 'second']);
    }, { timeout: 30000 });
  });
});
