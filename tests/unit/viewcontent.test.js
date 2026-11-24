// BR-25 (2.22.0): the content of a created view (js/viewcontent.js), and that the API takes it (API 3.15.0, BL-56).
import { describe, test, assert } from '../harness.js';
import { contentOfLayout, contentOfView, isCreated } from '../../js/viewcontent.js';
import { api } from '../../js/api.js';
import { M, E, R } from './fixture.js';

/** A generated diagram as elklayout.js draws it: a box with a child, a note, a relationship in halves through a dot. */
function layout(e = { a: 1, b: 2, c: 3 }, r = { ab: 11, onAb: 12 }) {
  return {
    nodes: [
      { id: `e${e.a}`, x: -40, y: 10, w: 300, h: 200, elementRefId: e.a, children: [
        { id: `e${e.b}`, x: -20, y: 60, w: 120.4, h: 55, elementRefId: e.b, children: [] },
        { id: `r${r.ab}`, x: 140, y: 80, w: 8, h: 8, dotRelationshipId: r.ab },
      ] },
      { id: `e${e.c}`, x: 400, y: 300, w: 120, h: 55, elementRefId: e.c, children: [] },
      { id: 'nnote-1', x: 10, y: 400, w: 185, h: 80, type: 'Label', label: 'A note', noteRef: 'note-1' },
    ],
    connections: [
      { id: `x${r.ab}a`, sourceNodeId: `e${e.b}`, targetNodeId: `r${r.ab}`, relationshipRefId: r.ab, half: 'first',
        points: [{ x: 100, y: 87 }, { x: 144, y: 84 }] },
      { id: `x${r.ab}b`, sourceNodeId: `r${r.ab}`, targetNodeId: `e${e.c}`, relationshipRefId: r.ab, half: 'second',
        points: [{ x: 144, y: 84 }, { x: 460, y: 84 }, { x: 460, y: 300 }] },
      { id: `x${r.onAb}`, sourceNodeId: `e${e.a}`, targetNodeId: `r${r.ab}`, relationshipRefId: r.onAb,
        points: [{ x: 110, y: 210 }, { x: 144, y: 88 }] },
      { id: 'lline-1', sourceNodeId: 'nnote-1', targetNodeId: `e${e.c}`, type: 'Line', points: [{ x: 100, y: 400 }, { x: 460, y: 355 }] },
    ],
  };
}

describe('viewcontent (BR-25)', () => {
  test('a generated diagram becomes nodes and connections: nesting kept, dots left out, halves joined', () => {
    const c = contentOfLayout(layout());
    assert.deepEqual(c.nodes.map(n => [n.ref, n.parentRef ?? null, n.type]), [
      ['e1', null, 'Element'], ['e2', 'e1', 'Element'], ['e3', null, 'Element'], ['nnote-1', null, 'Label']]);
    assert.ok(c.nodes.every(n => n.x >= 0 && n.y >= 0), 'moved right: nothing left of 0');
    assert.equal(c.nodes[0].x, 20, 'the leftmost node at the margin');
    assert.equal(c.nodes[1].w, 120, 'whole numbers');
    const [first, second, line] = c.connections;
    assert.deepEqual([first.ref, first.sourceRef, first.targetRef], ['x11', 'e2', 'e3'], 'one connection through the dot');
    assert.equal(first.bendpoints.length, 2, 'the dot and the corner');
    assert.deepEqual([second.sourceRef, second.targetRef], ['e1', 'x11'], 'ends on the connection of relationship 11, after it');
    assert.deepEqual([line.type, line.sourceRef, line.targetRef], ['Line', 'nnote-1', 'e3']);
  });

  test('a stored view becomes the same content again', () => {
    const view = {
      nodes: [{ id: 5, type: 'Element', x: 10, y: 10, w: 200, h: 100, elementRefId: 1, sortOrder: 0, children: [
        { id: 6, type: 'Element', x: 20, y: 40, w: 120, h: 55, elementRefId: 2, sortOrder: 0, children: [] }] },
      { id: 7, type: 'Label', x: 300, y: 10, w: 90, h: 30, label: 'Opens', viewRefId: 9, sortOrder: 1, children: [] }],
      connections: [
        { id: 21, type: 'Relationship', sourceNodeId: null, sourceConnectionId: 20, targetNodeId: 7, relationshipRefId: 4, bendpoints: [], sortOrder: 1 },
        { id: 20, type: 'Relationship', sourceNodeId: 5, targetNodeId: 6, relationshipRefId: 3, bendpoints: [{ x: 1, y: 2 }], sortOrder: 0 },
        { id: 22, type: 'Line', sourceNodeId: 7, targetNodeId: null, targetConnectionId: null, bendpoints: [] },
      ],
    };
    const c = contentOfView(view);
    assert.deepEqual(c.nodes.map(n => [n.ref, n.parentRef ?? null]), [['n5', null], ['n6', 'n5'], ['n7', null]]);
    assert.equal(c.nodes[2].viewId, 9, 'a drill-down link is kept');
    assert.deepEqual(c.connections.map(x => [x.ref, x.sourceRef, x.targetRef]), [['c20', 'n5', 'n6'], ['c21', 'c20', 'n7']],
      'the one on a connection after it; the line without an end left out');
    assert.equal(isCreated({ origin: 'created' }), true);
    assert.equal(isCreated({ origin: 'source' }) || isCreated({}), false);
  });

  test('the API takes the content, gives it back, and refuses to change a source view', async () => {
    // the ERP with the billing module in it, the billing service; relationship 107 (module → service) through a dot
    const shown = layout({ a: E.erp, b: E.billingModule, c: E.billingService }, { ab: R(107), onAb: -1 });
    shown.connections = shown.connections.filter(c => c.relationshipRefId !== -1);
    const content = contentOfLayout(shown);
    let view = null;
    try {
      view = await api.createView(M, { name: 'Unit test view', content });
      assert.equal(view.origin, 'created');
      assert.equal(view.contentRevision, 1);
      const stored = await api.viewContent(M, view.id);
      assert.equal(stored.connections.length, 2, 'the relationship and the line of the note');
      assert.equal(stored.nodes[0].children.length, 1, 'the module inside the ERP');
      const again = await api.putViewContent(M, view.id, contentOfView(stored), { version: view.version });
      assert.equal(again.view.contentRevision, 2, 'sent back as it was');
      const stale = await api.putViewContent(M, view.id, contentOfView(stored), { version: view.version }).catch(e => e);
      assert.equal(stale.status, 412, 'someone saved it in between');
    } finally {
      if (view) await api.deleteView(M, view.id, { version: '*' }); // cleaning up: whatever it is now (2.29.0)
    }
  });
});
