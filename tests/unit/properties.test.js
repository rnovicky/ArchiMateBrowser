import { describe, test, assert } from '../harness.js';
import { propertyValue, colourScale, PropertyOptions, parsePropertyQuery, searchParams, propertyIndexFrom, NOT_SET } from '../../js/properties.js';

const item = props => ({ properties: props.map(([name, value, lang = null]) => ({ propertyDefinitionName: name, value, lang })) });

describe('properties', () => {
  test('propertyValue prefers the requested language, then no language, then the first value', () => {
    const it = item([['label', 'Zákazník', 'cs'], ['label', 'Customer', 'en'], ['owner', 'Sales']]);
    assert.equal(propertyValue(it, 'label', 'en'), 'Customer');
    assert.equal(propertyValue(it, 'label', 'de'), 'Zákazník');
    assert.equal(propertyValue(item([['x', 'a', 'cs'], ['x', 'b']]), 'x', 'de'), 'b');
    assert.equal(propertyValue(it, 'missing'), undefined);
  });

  test('colourScale: categorical colours, numeric ramp, and a "not set" entry', () => {
    const cat = colourScale(['b', 'a', undefined, 'a']);
    assert.ok(!cat.numeric);
    assert.deepEqual(cat.legend.map(([, v]) => v), ['a', 'b', NOT_SET]);
    assert.ok(cat.colour('a') !== cat.colour('b'));
    const num = colourScale(['10', '2', '30']);
    assert.ok(num.numeric);
    assert.deepEqual(num.legend.map(([, v]) => v), ['2', '10', '30'], 'numeric order');
    assert.equal(num.colour('30'), '#fd8d3c', 'the largest value gets the darkest colour');
  });

  test('filters: has / missing / eq / contains / ne (case-insensitive)', () => {
    const e = item([['lifecycle', 'Current']]), none = item([]);
    const ok = (op, value, x) => new PropertyOptions({ filterName: 'lifecycle', filterOp: op, filterValue: value }).elementOk(x);
    assert.deepEqual([ok('has', '', e), ok('has', '', none)], [true, false]);
    assert.deepEqual([ok('missing', '', e), ok('missing', '', none)], [false, true]);
    assert.deepEqual([ok('eq', 'current', e), ok('eq', 'cur', e)], [true, false]);
    assert.deepEqual([ok('contains', 'URR', e), ok('contains', 'x', e)], [true, false]);
    assert.deepEqual([ok('ne', 'current', e), ok('ne', 'planned', e), ok('ne', 'current', none)], [false, true, true]);
  });

  test('options round-trip through the link encoding (special characters too)', () => {
    const o = new PropertyOptions({ label: 'owner', colour: 'life cycle', filterName: 'a.b', filterOp: 'eq', filterValue: 'x.y~z', lang: 'cs' });
    const back = PropertyOptions.decode(o.encode());
    const fields = x => ({ label: x.label, colour: x.colour, filterName: x.filterName, filterOp: x.filterOp, filterValue: x.filterValue, lang: x.lang });
    assert.deepEqual(fields(back), fields(o));
    assert.equal(PropertyOptions.decode('f:owner.eq.a.b').filterValue, 'a.b', 'older links with dots in the value still decode');
    assert.ok(new PropertyOptions().isDefault());
  });

  test('search syntax @name, @name=value, @name~text, @name!', () => {
    const pick = q => { const p = parsePropertyQuery(q); return p && [p.filterName, p.filterOp, p.filterValue]; };
    assert.deepEqual(pick('@owner'), ['owner', 'has', '']);
    assert.deepEqual(pick('@ owner = Sales'), ['owner', 'eq', 'Sales']);
    assert.deepEqual(pick('@owner~sal'), ['owner', 'contains', 'sal']);
    assert.deepEqual(pick('@owner!'), ['owner', 'missing', '']);
    assert.equal(parsePropertyQuery('owner'), null);
  });

  test('a property search as the parameters of the API (HLP-9)', () => {
    const params = q => searchParams(parsePropertyQuery(q));
    assert.deepEqual(params('@owner'), { property: 'owner', propertyOp: 'exists', propertyValue: undefined });
    assert.deepEqual(params('@owner=Sales'), { property: 'owner', propertyOp: 'eq', propertyValue: 'Sales' });
    assert.deepEqual(params('@owner~sal'), { property: 'owner', propertyOp: 'contains', propertyValue: 'sal' });
    assert.deepEqual(params('@owner!'), { property: 'owner', propertyOp: 'missing', propertyValue: undefined });
  });

  test('the API\'s property index as the panel wants it', () => {
    const idx = propertyIndexFrom([{ name: 'owner', count: 3, values: [{ value: 'IT', count: 2 }, { value: 'Sales', count: 1 }], langs: ['cs'] }]);
    assert.deepEqual([...idx.keys()], ['owner']);
    assert.equal(idx.get('owner').count, 3);
    assert.deepEqual(idx.get('owner').values, new Set(['IT', 'Sales']));
    assert.deepEqual(idx.get('owner').langs, new Set(['cs']));
    assert.deepEqual([...idx.get('owner').valueCounts], [['IT', 2], ['Sales', 1]], 'how many elements have each value');
    assert.equal(idx.get('owner').distinctValues, 2);
    assert.equal(propertyIndexFrom(null).size, 0);
  });

  test('decorate: label line, colour and legend', () => {
    const els = [{ name: 'A', ...item([['owner', 'IT']]) }, { name: 'B', ...item([]) }];
    const d = new PropertyOptions({ label: 'owner', colour: 'owner' }).decorate(els);
    assert.equal(d.extraLabel(els[0]), 'owner: IT');
    assert.equal(d.extraLabel(els[1]), null);
    assert.equal(d.legendTitle, 'owner');
    assert.deepEqual(d.legend.map(([, v]) => v), ['IT', NOT_SET]);
  });
});
