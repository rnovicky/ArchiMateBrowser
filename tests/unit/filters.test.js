import { describe, test, assert } from '../harness.js';
import { DiagramFilter, VIEWPOINTS } from '../../js/filters.js';
import { ELEMENT_TYPES, RELATIONSHIP_TYPES } from '../../js/archimate.js';

describe('filters', () => {
  test('the default filter encodes to an empty string and lets everything through', () => {
    const f = new DiagramFilter();
    assert.ok(f.isDefault());
    assert.equal(f.encode(), '');
    assert.ok(f.elementOk({ type: 'Goal' }) && f.relOk({ type: 'Flow' }));
  });

  test('viewpoint presets encode as vp:<key> and round-trip', () => {
    for (const key of Object.keys(VIEWPOINTS).filter(k => k !== 'all')) {
      const f = DiagramFilter.fromViewpoint(key);
      assert.equal(f.matchingViewpoint(), key);
      assert.equal(f.encode(), `vp:${key}`);
      assert.equal(DiagramFilter.decode(f.encode()).encode(), `vp:${key}`);
    }
  });

  test('custom filters use the shorter of the shown / hidden lists', () => {
    const hideFlow = new DiagramFilter(ELEMENT_TYPES, RELATIONSHIP_TYPES.filter(t => t !== 'Flow'));
    assert.equal(hideFlow.encode(), 'xr:Flow');
    assert.ok(!hideFlow.relOk({ type: 'Flow' }) && hideFlow.relOk({ type: 'Serving' }));
    const onlyTwo = new DiagramFilter(['ApplicationComponent', 'DataObject'], RELATIONSHIP_TYPES);
    assert.equal(onlyTwo.encode(), 'ie:ApplicationComponent.DataObject');
    const back = DiagramFilter.decode('ie:ApplicationComponent.DataObject~xr:Flow');
    assert.deepEqual(back.elementTypes, new Set(['ApplicationComponent', 'DataObject']));
    assert.ok(!back.relTypes.has('Flow'));
    assert.equal(back.hiddenCount(), ELEMENT_TYPES.length - 2 + 1);
  });

  test('hide rules (2.17.0): matching, encoding, a copy keeps them', () => {
    const f = new DiagramFilter().withRule({ type: 'Flow', source: 'Node', target: 'Node' }).withRule({ source: 'ApplicationService' });
    assert.equal(f.withRule({ type: 'Flow', source: 'Node', target: 'Node' }).hidden.length, 2, 'the same rule once');
    const types = { 1: 'Node', 2: 'Node', 3: 'Device', 4: 'ApplicationService' };
    const typeOf = id => types[id];
    const rel = (type, s, t, extra = {}) => ({ type, sourceElementId: s, targetElementId: t, ...extra });
    assert.equal(f.relOk(rel('Flow', 1, 2), typeOf), false, 'Flow from Node to Node');
    assert.equal(f.relOk(rel('Flow', 1, 3), typeOf), true, 'to a Device it stays');
    assert.equal(f.relOk(rel('Serving', 4, 1), typeOf), false, 'anything from an Application Service');
    assert.equal(f.relOk(rel('Flow', 1, 2)), true, "without the ends' types the rules are not checked");
    assert.equal(f.isDefault(), false);
    assert.equal(f.matchingViewpoint(), null);
    assert.equal(f.encode(), 'hr:Flow-Node-Node.*-ApplicationService-*');
    const back = DiagramFilter.decode(f.encode());
    assert.deepEqual(back.hidden, f.hidden);
    assert.deepEqual(back.copy().hidden, f.hidden);
    const onRel = new DiagramFilter().withRule({ type: 'Association', target: 'Relationship' });
    assert.equal(onRel.relOk(rel('Association', 1, null, { targetRelationshipId: 9 }), typeOf), false, 'an end that is a relationship');
    assert.deepEqual(DiagramFilter.decode('hr:NoType-Nothing-*').hidden, [], 'nothing known: no rule');
  });

  test('unknown types in a link are ignored', () => {
    const f = DiagramFilter.decode('ie:NotAType.Goal');
    assert.deepEqual(f.elementTypes, new Set(['Goal']));
  });
});
