// The offline copy's stand-in of the API (js/offline/, 2.20.0) against the real API: the same questions
// about the two test models, the same answers. The questions are the ones the Browser asks, made from
// the models' own items (every element, view, folder, type …), with the variants its options give.

import { describe, test, assert } from '../harness.js';
import { offlineFetch } from '../../js/offline/standin.js';
import { M, SYN } from './fixture.js';

const BASE = '/api/v2';

async function answer(fetcher, method, path, { query = null, body = undefined, accept = 'application/json' } = {}) {
  const url = new URL(BASE + path, location.href);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
  const init = { method, headers: { Accept: accept, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetcher(url.href, init);
  const text = await res.text();
  let data = text;
  if (!accept.includes('csv')) { try { data = JSON.parse(text); } catch { /* not JSON */ } }
  return { status: res.status, data };
}

/** The first place where two JSON values differ, as "path: a ≠ b", or null. */
function difference(a, b, path = '') {
  if (Object.is(a, b)) return null;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path || '(top)'}: ${a.length} items ≠ ${b.length}`;
    for (let i = 0; i < a.length; i++) { const d = difference(a[i], b[i], `${path}[${i}]`); if (d) return d; }
    return null;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (!(k in a)) return `${path}.${k}: missing in the API's answer`;
      if (!(k in b)) return `${path}.${k}: missing in the stand-in's`;
      const d = difference(a[k], b[k], `${path}.${k}`);
      if (d) return d;
    }
    return null;
  }
  const show = v => (typeof v === 'string' ? JSON.stringify(v.length > 120 ? v.slice(0, 120) + '…' : v) : JSON.stringify(v));
  return `${path || '(top)'}: API ${show(a)} ≠ stand-in ${show(b)}`;
}

const models = {};

/** Both ways of asking about one model: the real API, and a stand-in made from its snapshot. */
async function both(modelId) {
  models[modelId] ??= (async () => {
    const snapshot = await fetch(`${BASE}/models/${modelId}/snapshot`).then(r => r.json());
    return { snapshot, standIn: offlineFetch(snapshot, { base: BASE }) };
  })();
  return models[modelId];
}

/** Ask both every question of `cases` ([method, path, options]); fails with the first differences. */
async function compare(modelId, cases) {
  const { standIn } = await both(modelId);
  const wrong = [];
  let answered = 0;
  for (const [method, path, options = {}] of cases) {
    const [api, mine] = await Promise.all([answer(fetch, method, path, options), answer(standIn, method, path, options)]);
    const what = `${method} ${path}${options.query ? '?' + new URLSearchParams(options.query) : ''}${options.body ? ' ' + JSON.stringify(options.body).slice(0, 160) : ''}`;
    if (api.status !== mine.status) wrong.push(`${what}\n    status: API ${api.status} ≠ stand-in ${mine.status} ${JSON.stringify(mine.data).slice(0, 160)}`);
    else if (api.status < 300) { answered++; const d = difference(api.data, mine.data); if (d) wrong.push(`${what}\n    ${d}`); }
    if (wrong.length >= 6) break;
  }
  assert.ok(!wrong.length, `${wrong.length} answer(s) differ (of ${cases.length}):\n  ${wrong.join('\n  ')}`);
  // what was compared is what the API answered, not two refusals
  assert.ok(answered > 0 && answered >= cases.length * 0.8, `only ${answered} of ${cases.length} questions were answered`);
  return cases.length;
}

const LAYERS = ['Strategy', 'Business', 'Application', 'Technology', 'Physical', 'Motivation', 'ImplementationMigration', 'Other'];

for (const [label, id] of [['fixture', M], ['synthetic', SYN.model]]) {
  describe(`offline stand-in (${label} model)`, () => {
    const m = `/models/${id}`;
    const data = async () => (await both(id)).snapshot;

    test('model, statistics, properties, metadata', async () => {
      await compare(id, [
        ['GET', m], ['GET', `${m}/stats`], ['GET', `${m}/properties/index`, { query: { owner: 'element', maxValues: 1000 } }],
        ['GET', `${m}/property-definitions`], ['GET', `${m}/properties`], ['GET', `${m}/metadata`], ['GET', '/models/999999'],
      ]);
      // the API lists every model; an offline copy has its own only
      const { standIn } = await both(id);
      const listed = await answer(standIn, 'GET', '/models', { query: { limit: 1000, offset: 0 } });
      const model = await answer(fetch, 'GET', m);
      assert.deepEqual(listed.data, { items: [model.data], total: 1, limit: 1000, offset: 0 });
    });

    test('elements: by type, by ids, by name, by property, pages', async () => {
      const s = await data();
      const types = [...new Set(s.elements.map(e => e.type))];
      const someIds = s.elements.filter((_, i) => i % 3 === 0).map(e => e.id);
      const names = s.elements.map(e => e.name).filter(Boolean).slice(0, 5).map(n => n.slice(1, 4));
      const props = s.propertyIndex.map(p => p.name);
      return compare(id, [
        ['GET', `${m}/elements`, { query: { limit: 1000, offset: 0, include: 'degree' } }],
        ['GET', `${m}/elements`, { query: { limit: 7, offset: 3 } }],
        ...types.map(type => ['GET', `${m}/elements`, { query: { type, include: 'degree', limit: 1000, offset: 0 } }]),
        ['GET', `${m}/elements`, { query: { ids: someIds.join(','), include: 'degree', limit: 1000, offset: 0 } }],
        ...names.map(name => ['GET', `${m}/elements`, { query: { name } }]),
        ...props.flatMap(property => [['GET', `${m}/elements`, { query: { property } }],
          ['GET', `${m}/elements`, { query: { property, propertyValue: s.propertyIndex.find(p => p.name === property).values[0]?.value ?? 'x' } }],
          ['GET', `${m}/elements`, { query: { property, propertyOp: 'missing' } }]]),
      ]);
    });

    test('relationships: with their ends, by type and ends, of an element, on relationships', async () => {
      const s = await data();
      const types = [...new Set(s.relationships.map(r => r.type))];
      const withEnds = q => ['GET', `${m}/relationships`, { query: { ...q, include: 'ends', limit: 1000, offset: 0 } }];
      return compare(id, [
        withEnds({}), withEnds({ onRelationship: 'true', sort: 'ends' }), withEnds({ onRelationship: 'false' }),
        ...types.map(type => withEnds({ type, sort: 'ends' })),
        ...s.elements.flatMap(e => [withEnds({ sourceElementId: e.id }), withEnds({ targetElementId: e.id })]),
        ...s.relationships.flatMap(r => [withEnds({ sourceRelationshipId: r.id }), withEnds({ targetRelationshipId: r.id })]),
        withEnds({ ids: s.relationships.slice(0, 5).map(r => r.id).join(',') }),
        ['GET', `${m}/relationships/${s.relationships[0].id}`],
      ]);
    });

    test('views: list, content, elements, links; the views of an element and of a relationship', async () => {
      const s = await data();
      return compare(id, [
        ['GET', `${m}/views`, { query: { limit: 1000, offset: 0 } }],
        ...s.views.flatMap(v => [
          ['GET', `${m}/views/${v.id}`],
          ['GET', `${m}/views/${v.id}/content`, { query: { include: 'concepts', fields: 'full' } }],
          ['GET', `${m}/views/${v.id}/content`],
          ['GET', `${m}/views/${v.id}/elements`, { query: { positions: 'true', limit: 1000, offset: 0 } }],
          ['GET', `${m}/views/${v.id}/links`],
        ]),
        ...s.elements.map(e => ['GET', `${m}/elements/${e.id}/views`, { query: { limit: 1000, offset: 0 } }]),
        ...s.relationships.map(r => ['GET', `${m}/relationships/${r.id}/views`, { query: { limit: 1000, offset: 0 } }]),
      ]);
    });

    test('folders: the tree, contents, where an item is filed', async () => {
      const s = await data();
      const folders = [];
      const walk = list => list.forEach(o => { if (o.refElementId == null && o.refRelationshipId == null && o.refViewId == null) { folders.push(o.id); walk(o.children); } });
      walk(s.organizations);
      return compare(id, [
        ['GET', `${m}/organizations`, { query: { counts: 'true', foldersOnly: 'true' } }],
        ['GET', `${m}/organizations`, { query: { counts: 'true' } }],
        ['GET', `${m}/organizations`],
        ...folders.flatMap(f => ['elements', 'relationships', 'views'].flatMap(kinds => [
          ['GET', `${m}/organizations/${f}/contents`, { query: { recursive: 'false', order: 'model', kinds, limit: 1000, offset: 0 } }],
          ['GET', `${m}/organizations/${f}/contents`, { query: { recursive: 'true', order: 'name', kinds, limit: 1000, offset: 0 } }],
        ])),
        ...s.elements.map(e => ['GET', `${m}/elements/${e.id}/folder`]),
        ...s.relationships.map(r => ['GET', `${m}/relationships/${r.id}/folder`]),
        ...s.views.map(v => ['GET', `${m}/views/${v.id}/folder`]),
      ]);
    });

    test('search: words, parts of names, documentation, property values, the property forms, pages', async () => {
      const s = await data();
      const words = new Set();
      for (const e of [...s.elements, ...s.views]) {
        for (const w of (e.name || '').split(/[\s\-_.([]+/)) if (w.length > 2) { words.add(w); words.add(w.slice(0, 3)); words.add(w.slice(1, 4).toUpperCase()); }
      }
      const docs = s.elements.map(e => e.documentation).filter(Boolean).map(d => d.split(/\s+/)[1] || d.slice(0, 4));
      const all = { kinds: 'elements,relationships,views', in: 'name,documentation,properties', limit: 50, offset: 0, include: 'degree' };
      const props = s.propertyIndex;
      return compare(id, [
        ...[...words].slice(0, 60).map(q => ['GET', `${m}/search`, { query: { q, ...all } }]),
        ...docs.slice(0, 10).map(q => ['GET', `${m}/search`, { query: { q } }]),
        ['GET', `${m}/search`, { query: { q: 'a', ...all, limit: 3, offset: 2 } }],
        ['GET', `${m}/search`, { query: { q: '' } }],
        ...props.flatMap(p => [
          ['GET', `${m}/search`, { query: { property: p.name, kinds: 'elements,relationships,views' } }],
          ['GET', `${m}/search`, { query: { property: p.name, propertyValue: p.values[0]?.value ?? '', kinds: 'elements,relationships,views' } }],
          ['GET', `${m}/search`, { query: { q: (p.values[0]?.value ?? 'x').slice(0, 3), in: 'properties', property: p.name } }],
          ...['contains', 'gt', 'lt', 'ne'].map(propertyOp => ['GET', `${m}/search`, { query: { property: p.name, propertyOp, propertyValue: p.values[0]?.value ?? '1' } }]),
          ['GET', `${m}/search`, { query: { property: p.name, propertyOp: 'missing', kinds: 'elements' } }],
        ]),
        ['GET', `${m}/search`, { query: { q: 'e', elementTypes: 'ApplicationComponent,Node', layers: 'Application', kinds: 'elements' } }],
        ['GET', `${m}/search`, { query: { q: 'e', relationshipTypes: 'Serving,Flow', kinds: 'relationships' } }],
        // API 3.20.0: several conditions, AND within a group, OR between groups; and what is refused
        ...(props.length >= 2 ? [
          [[{ name: props[0].name }, { name: props[1].name }]],
          [[{ name: props[0].name, op: 'eq', value: props[0].values[0]?.value ?? '' }], [{ name: props[1].name, op: 'missing' }]],
          [[{ name: props[1].name, op: 'contains', value: (props[1].values[0]?.value ?? 'x').slice(0, 2) }, { name: props[0].name, op: 'ne', value: 'x' }]],
        ] : []).map(groups => ['GET', `${m}/search`, { query: { properties: JSON.stringify(groups), kinds: 'elements,relationships,views' } }]),
        ['GET', `${m}/search`, { query: { properties: 'not json' } }],
        ['GET', `${m}/search`, { query: { properties: '[[]]' } }],
        ['GET', `${m}/search`, { query: { properties: '[[{"name":"x","extra":1}]]' } }],
      ]);
    });

    test('resolve: identifiers and folder paths', async () => {
      const s = await data();
      const xmi = [...s.elements.slice(0, 5), ...s.relationships.slice(0, 3), ...s.views].map(o => o.xmiIdentifier);
      const paths = [];
      const walk = (list, above) => list.forEach(o => { if (o.label != null) { paths.push([...above, o.label]); walk(o.children, [...above, o.label]); } });
      walk(s.organizations, []);
      return compare(id, [
        ['POST', `${m}/resolve`, { body: { xmiIdentifiers: [...xmi, 'no-such-id'] } }],
        ['POST', `${m}/resolve`, { body: { folderPaths: [...paths, ['No such folder']] } }],
        ['POST', `${m}/resolve`, { body: { xmiIdentifiers: xmi.slice(0, 2), folderPaths: paths.slice(0, 2) } }],
      ]);
    });

    // ---- the graph helpers, with the variants the Browser's options give

    const full = { fields: 'full', include: ['filtered', 'degree'] };
    const nest = [{ types: ['Composition', 'Aggregation'] }, { types: ['Composition', 'Aggregation', 'Assignment'], containerTypes: ['Grouping'] }];
    const filterVariants = s => {
      const types = [...new Set(s.elements.map(e => e.type))];
      const relTypes = [...new Set(s.relationships.map(r => r.type))];
      const someRel = s.relationships.find(r => r.sourceElementId != null && r.targetElementId != null);
      const type = id => s.elements.find(e => e.id === id)?.type;
      const prop = s.propertyIndex[0];
      return [
        {}, { elementTypes: types.slice(0, Math.ceil(types.length / 2)) }, { relationshipTypes: relTypes.slice(1) },
        { layers: ['Business', 'Application'] },
        someRel ? { hideRelationships: [{ type: someRel.type, sourceType: type(someRel.sourceElementId), targetType: type(someRel.targetElementId) }] } : {},
        { hideRelationships: [{ sourceType: 'Relationship' }, { type: relTypes[0] }] },
        prop ? { property: { name: prop.name, op: 'exists' } } : {},
        prop ? { property: { name: prop.name, op: 'eq', value: prop.values[0].value } } : {},
      ];
    };

    test('neighbourhood: every element, depths, directions, filters, nesting', async () => {
      const s = await data();
      const cases = [];
      for (const e of s.elements) cases.push(['POST', `${m}/graph/neighbourhood`, { body: { seeds: [e.id], depth: 1, direction: 'both', ...full } }]);
      for (const e of s.elements.slice(0, 8)) {
        for (const direction of ['out', 'in']) cases.push(['POST', `${m}/graph/neighbourhood`, { body: { seeds: [e.id], depth: 2, direction, ...full } }]);
        for (const f of filterVariants(s)) cases.push(['POST', `${m}/graph/neighbourhood`, { body: { seeds: [e.id], depth: 2, ...f, ...full } }]);
        for (const n of nest) cases.push(['POST', `${m}/graph/neighbourhood`, { body: { seeds: [e.id], depth: 3, nesting: n, ...full } }]);
      }
      cases.push(['POST', `${m}/graph/neighbourhood`, { body: { seeds: s.elements.slice(0, 4).map(e => e.id), depth: 2 } }]);
      cases.push(['POST', `${m}/graph/neighbourhood`, { body: { seeds: [999999], depth: 1 } }]);
      return compare(id, cases);
    });

    test('subgraph: every way of naming the set, filters, exclusions, nesting', async () => {
      const s = await data();
      const folders = [];
      const walk = list => list.forEach(o => { if (o.refElementId == null && o.refRelationshipId == null && o.refViewId == null) { folders.push(o.id); walk(o.children); } });
      walk(s.organizations);
      const sets = [
        { elementIds: s.elements.map(e => e.id) }, { elementIds: s.elements.slice(2, 9).map(e => e.id) },
        ...folders.map(folderId => ({ folderId })),
        ...[...new Set(s.elements.map(e => e.type))].map(elementType => ({ elementType })),
        ...LAYERS.map(layer => ({ layer })),
        ...s.views.map(v => ({ viewId: v.id })),
        ...[...new Set(s.relationships.map(r => r.type))].map(relationshipType => ({ relationshipType })),
        { onRelationships: true },
        { allElements: true }, // API 3.20.0
      ];
      const cases = sets.map(set => ['POST', `${m}/graph/subgraph`, { body: { ...set, ...full } }]);
      for (const f of filterVariants(s)) cases.push(['POST', `${m}/graph/subgraph`, { body: { elementIds: s.elements.map(e => e.id), ...f, ...full } }]);
      for (const n of nest) cases.push(['POST', `${m}/graph/subgraph`, { body: { elementIds: s.elements.map(e => e.id), nesting: n, ...full } }]);
      cases.push(['POST', `${m}/graph/subgraph`, { body: { elementIds: s.elements.map(e => e.id), excludeRelationshipIds: s.relationships.slice(0, 3).map(r => r.id), ...full } }]);
      cases.push(['POST', `${m}/graph/subgraph`, { body: { elementIds: s.elements.slice(0, 5).map(e => e.id) } }]);
      return compare(id, cases);
    });

    test('impact: every element both ways, types, depth, the relationships to draw, nesting, CSV', async () => {
      const s = await data();
      const cases = [];
      for (const e of s.elements) {
        for (const direction of ['impact', 'dependencies']) cases.push(['POST', `${m}/graph/impact`, { body: { start: [e.id], direction, maxDepth: 5, fields: 'full', include: ['relationships'] } }]);
      }
      for (const e of s.elements.slice(0, 6)) {
        cases.push(['POST', `${m}/graph/impact`, { body: { start: [e.id], relationshipTypes: ['Serving', 'Flow', 'Association'], maxDepth: 2 } }]);
        cases.push(['POST', `${m}/graph/impact`, { body: { start: [e.id], maxDepth: 1, nesting: nest[0], include: ['relationships'], fields: 'full' } }]);
        cases.push(['POST', `${m}/graph/impact`, { body: { start: [e.id], maxDepth: 5, csvDelimiter: ';' }, accept: 'text/csv' }]);
        cases.push(['POST', `${m}/graph/impact`, { body: { start: [e.id], elementTypes: ['ApplicationComponent', 'BusinessProcess', 'Node'] } }]);
      }
      cases.push(['POST', `${m}/graph/impact`, { body: { start: s.elements.slice(0, 3).map(e => e.id), direction: 'dependencies' } }]);
      return compare(id, cases);
    });

    test('expansion counts and paths', async () => {
      const s = await data();
      const all = s.elements.map(e => e.id);
      const cases = [
        ['POST', `${m}/graph/expansion-counts`, { body: { elementIds: all, visibleIds: all.slice(0, 5), direction: 'both' } }],
        ['POST', `${m}/graph/expansion-counts`, { body: { elementIds: all, visibleIds: [], direction: 'out' } }],
        ['POST', `${m}/graph/expansion-counts`, { body: { elementIds: all.slice(0, 6), visibleIds: all.slice(3, 9), direction: 'in', byType: false } }],
        ...filterVariants(s).map(f => ['POST', `${m}/graph/expansion-counts`, { body: { elementIds: all, visibleIds: all.slice(0, 3), ...f } }]),
      ];
      for (let i = 0; i + 1 < s.elements.length && i < 12; i++) {
        for (let j = s.elements.length - 1; j > i && j > s.elements.length - 4; j--) {
          cases.push(['GET', `${m}/graph/paths`, { query: { from: all[i], to: all[j], k: 3, maxLength: 6 } }]);
        }
        cases.push(['GET', `${m}/graph/paths`, { query: { from: all[i], to: all[i + 1], k: 5, maxLength: 4, direction: 'directed' } }]);
      }
      return compare(id, cases);
    });

    test('reports: quality, matrix (direct and along paths, CSV), landscape hierarchy', async () => {
      const s = await data();
      const types = [...new Set(s.elements.map(e => e.type))];
      const relTypes = [...new Set(s.relationships.map(r => r.type))];
      const folders = [];
      const walk = list => list.forEach(o => { if (o.refElementId == null && o.refRelationshipId == null && o.refViewId == null) { folders.push(o.id); walk(o.children); } });
      walk(s.organizations);
      const sets = [
        { layer: 'Application' }, { layer: 'Business' }, { elementTypes: types.slice(0, 4) }, { elementType: types[0] },
        { elementIds: s.elements.slice(0, 8).map(e => e.id) }, ...folders.slice(0, 3).map(folderId => ({ folderId })),
        ...s.views.slice(0, 2).map(v => ({ viewId: v.id })),
        ...(s.propertyIndex[0] ? [{ layer: 'Application', property: { name: s.propertyIndex[0].name } }] : []),
      ];
      const vias = [
        {}, { direction: 'out' }, { direction: 'in', types: relTypes.slice(0, 2) },
        { path: [{ direction: 'any' }, { direction: 'any' }] },
        { path: [{ direction: 'out', types: ['Serving', 'Flow'] }, { direction: 'any' }], intermediateTypes: [['ApplicationComponent', 'ApplicationService', 'BusinessProcess']] },
        { path: [{ direction: 'any' }, { direction: 'any' }, { direction: 'any' }] },
      ];
      const cases = [
        ['GET', `${m}/analysis/quality`, { query: { limit: 200 } }],
        ['GET', `${m}/analysis/quality`, { query: { limit: 2, offset: 1, checks: 'elementsInNoView,duplicateNames' } }],
      ];
      for (const rows of sets.slice(0, 6)) {
        for (const via of vias) cases.push(['POST', `${m}/graph/matrix`, { body: { rows, columns: { layer: 'Business' }, via } }]);
      }
      cases.push(['POST', `${m}/graph/matrix`, { body: { rows: { layer: 'Application' }, columns: { layer: 'Application' }, includeEmpty: true, sort: 'count' } }]);
      cases.push(['POST', `${m}/graph/matrix`, { body: { rows: { elementTypes: types }, columns: { elementTypes: types }, details: false, sort: 'id' } }]);
      for (const csvLayout of ['grid', 'list']) {
        for (const csvLabels of ['name', 'name+type', 'xmi']) {
          cases.push(['POST', `${m}/graph/matrix`, { body: { rows: { elementTypes: types }, columns: { elementTypes: types }, csvLayout, csvLabels, csvDelimiter: ';' }, accept: 'text/csv' }]);
        }
      }
      const nestings = [
        undefined, [{ type: 'Composition', direction: 'out' }, { type: 'Aggregation', direction: 'out' }, { type: 'Realization', direction: 'in' }],
        [{ type: 'Assignment', direction: 'out' }], [{ type: 'Serving', direction: 'in' }, { type: 'Flow', direction: 'out' }],
      ];
      for (const roots of sets) {
        for (const nesting of nestings) {
          cases.push(['POST', `${m}/graph/hierarchy`, { body: { roots, ...(nesting ? { nesting } : {}), maxDepth: 3, properties: s.propertyIndex.slice(0, 2).map(p => p.name) } }]);
        }
      }
      cases.push(['POST', `${m}/graph/hierarchy`, { body: { roots: { elementTypes: types }, topLevelOnly: false, maxDepth: 1, counts: false } }]);
      cases.push(['POST', `${m}/graph/hierarchy`, { body: { roots: { elementTypes: types }, childTypes: types.slice(0, 5), maxDepth: 6, lang: 'cs', properties: s.propertyIndex.map(p => p.name) } }]);
      return compare(id, cases);
    });

    test('what an offline copy cannot do is refused', async () => {
      const { standIn } = await both(id);
      const write = await answer(standIn, 'POST', `${m}/elements`, { body: { type: 'BusinessActor', name: 'x', xmiIdentifier: 'x' } });
      assert.equal(write.status, 403);
      assert.match(write.data.message, /offline copy/);
      const other = await answer(standIn, 'GET', `${m}/history`);
      assert.equal(other.status, 404);
    });
  });
}

describe('offline copy with a password (2.27.0, BR-24)', () => {
  test('seal and openSealed: the bytes back with the password, refused with another', async () => {
    const { seal, openSealed } = await import('../../js/offline/package.js');
    const bytes = new TextEncoder().encode('Příliš žluťoučký kůň');
    const { meta, data } = await seal(bytes, 'heslo');
    assert.equal(meta.iterations, 600000);
    assert.ok(!atob(data).includes('kůň'));
    assert.equal(new TextDecoder().decode(await openSealed(data, meta, 'heslo')), 'Příliš žluťoučký kůň');
    let refused = false;
    try { await openSealed(data, meta, 'Heslo'); } catch { refused = true; }
    assert.ok(refused, 'a wrong password is refused');
    const again = await seal(bytes, 'heslo');
    assert.ok(again.meta.salt !== meta.salt && again.data !== data, 'a new salt and iv each time');
  });
});
