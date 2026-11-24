import { describe, test, assert } from '../harness.js';
import { pathTo, encodeTypes, decodeTypes, DEFAULT_TYPES } from '../../js/impact.js';

describe('impact analysis', () => {
  test('pathTo: from a reached element back to the start, as the API answered it', () => {
    // the shape of graph.impact()'s results: id -> { id, level, via, from }
    const results = new Map([[3, { id: 3, level: 1, via: 30, from: 1 }], [5, { id: 5, level: 2, via: 50, from: 3 }],
                             [7, { id: 7, level: 3, via: 70, from: 5 }]]);
    assert.deepEqual(pathTo({ results }, 7).map(st => [st.from, st.id]), [[1, 3], [3, 5], [5, 7]]);
    assert.deepEqual(pathTo({ results }, 9), []);
  });

  test('relationship types in links: defaults encode to an empty string', () => {
    assert.equal(encodeTypes(DEFAULT_TYPES), '');
    assert.deepEqual(decodeTypes(''), DEFAULT_TYPES);
    assert.deepEqual(decodeTypes(encodeTypes(['Flow', 'Serving'])), ['Flow', 'Serving']);
    assert.deepEqual(decodeTypes('Flow.Bogus'), ['Flow']);
  });
});
