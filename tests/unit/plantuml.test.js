import { describe, test, assert } from '../harness.js';
import { encodePlantUml, plantumlUrl, diagramFromElements, diagramFromView, parseSvg, annotateSvg, fetchPlantUmlSvg, LONG_URL } from '../../js/plantuml.js';
import { settings } from '../../js/config.js';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';

/** Inverse of plantuml.js encode64 + raw deflate, to check the encoding round-trips. */
async function decodePlantUml(s) {
  const bytes = [];
  for (let i = 0; i < s.length; i += 4) {
    const [c1, c2, c3, c4] = [...s.slice(i, i + 4)].map(c => ALPHABET.indexOf(c));
    bytes.push((c1 << 2) | (c2 >> 4), ((c2 & 0xf) << 4) | (c3 >> 2), ((c3 & 0x3) << 6) | c4);
  }
  // trailing padding bytes are ignored by the inflater only after the end of the stream: decompress leniently
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  writer.write(new Uint8Array(bytes)).catch(() => {});
  writer.close().catch(() => {});
  const chunks = [];
  const reader = ds.readable.getReader();
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); } } catch { /* padding after the end of the stream */ }
  return new TextDecoder().decode(new Uint8Array(chunks.flatMap(c => [...c])));
}

const el = (id, type, name) => ({ id, type, name, properties: [] });
const rel = (id, type, s, t, extra = {}) => ({ id, type, sourceElementId: s, targetElementId: t, sourceRelationshipId: null, targetRelationshipId: null, ...extra });

describe('plantuml', () => {
  describe('encoding', () => {
    test('round-trips text, including Czech characters and newlines', async () => {
      const text = '@startuml\nBob -> Alice : Příliš žluťoučký kůň\n@enduml';
      const enc = await encodePlantUml(text);
      assert.match(enc, /^[0-9A-Za-z\-_]+$/, 'URL-safe alphabet only');
      assert.equal(await decodePlantUml(enc), text);
    });

    test('server URL: <server>/<format>/<encoded>', async () => {
      const url = await plantumlUrl('@startuml\n@enduml', 'png');
      assert.match(url, /\/png\/[0-9A-Za-z\-_]+$/);
    });
  });

  describe('diagramFromElements', () => {
    test('maps element types to stdlib macros and escapes labels', () => {
      const { source, refs } = diagramFromElements({
        elements: [el(1, 'BusinessActor', 'Say "hi"\nnext\\line'), el(2, 'AndJunction', ''), el(3, 'ApplicationComponent', 'ERP')],
        relationships: [], title: 'T',
      });
      assert.includes(source, `Business_Actor(e1, "Say 'hi'\\nnext/line")`);
      assert.includes(source, 'Junction_And(e2, "")');
      assert.includes(source, 'Application_Component(e3, "ERP")');
      assert.includes(source, 'title T');
      assert.match(source, /^@startuml\n!include <archimate\/Archimate>/);
      assert.match(source, /@enduml$/);
      assert.deepEqual(refs.entities, { e1: 1, e2: 2, e3: 3 });
    });

    test('relationship macros: access direction, directed association; missing ends are skipped and counted', () => {
      const { source, refs } = diagramFromElements({
        elements: [el(1, 'ApplicationComponent', 'A'), el(2, 'DataObject', 'D')],
        relationships: [rel(10, 'Access', 1, 2, { accessType: 'Write' }), rel(11, 'Association', 1, 2, { isDirected: true, name: 'uses' }), rel(12, 'Serving', 1, 99)],
      });
      assert.includes(source, 'Rel_Access_w(e1, e2, "")');
      assert.includes(source, 'Rel_Association_dir(e1, e2, "uses")');
      assert.notIncludes(source, 'e99');
      assert.includes(source, "' 1 relationship(s) not drawn");
      assert.deepEqual(refs.links, [{ from: 'e1', to: 'e2', id: 10 }, { from: 'e1', to: 'e2', id: 11 }]);
    });

    test('a relationship on a relationship (BR-6) is split at a helper dot', () => {
      const { source, refs } = diagramFromElements({
        elements: [el(1, 'BusinessActor', 'A'), el(2, 'ApplicationService', 'S'), el(3, 'BusinessProcess', 'P')],
        relationships: [rel(20, 'Serving', 2, 3), { ...rel(21, 'Association', 1, null), targetRelationshipId: 20 }],
      });
      assert.includes(source, 'circle #666666 " " as r20');
      assert.includes(source, 'e2 -- r20');
      assert.includes(source, 'r20 --> e3');
      assert.includes(source, 'Rel_Association(e1, r20, "")');
      assert.deepEqual(refs.relEntities, { r20: 20 });
    });

    test('nesting: children inside their parent block; nested relationships not drawn as lines', () => {
      const nesting = { parentOf: new Map([[2, 1]]), nestedRelIds: new Set([30]), ancestorEdgeIds: new Set() };
      const { source } = diagramFromElements({
        elements: [el(1, 'ApplicationComponent', 'Parent'), el(2, 'ApplicationComponent', 'Child')],
        relationships: [rel(30, 'Composition', 1, 2)], nesting,
      });
      // PU-4 (2.27.0): a container shows its type by the sprite
      assert.match(source, /rectangle "Parent" <<\$archimate\/application-component>> as e1 #b5ffff \{\n {2}Application_Component\(e2, "Child"\)\n\}/);
      assert.notIncludes(source, 'Rel_Composition');
    });

    test('colour decoration uses the stereotype form and adds a legend', () => {
      const deco = { extraLabel: e => `owner: ${e.name}`, colour: () => '#ff0000', legend: [['#ff0000', 'X']], legendTitle: 'owner' };
      const { source } = diagramFromElements({ elements: [el(1, 'BusinessActor', 'A')], relationships: [], deco });
      assert.includes(source, 'archimate #ff0000 "A\\n<size:9><i>owner: A</i></size>" <<business-actor>> as e1');
      assert.includes(source, 'legend right');
    });
  });

  describe('diagramFromView', () => {
    test('containers, drill-down cards, labels and connections', () => {
      const elements = new Map([[1, el(1, 'BusinessActor', 'A')], [2, el(2, 'BusinessRole', 'R')]]);
      const nodes = [
        { id: 1, type: 'Container', label: 'Group', sortOrder: 0, children: [{ id: 2, type: 'Element', elementRefId: 1, sortOrder: 0, children: [] }, { id: 3, type: 'Element', elementRefId: 2, sortOrder: 1, children: [] }] },
        { id: 4, type: 'Label', label: 'Go there', viewRefId: 7, sortOrder: 1, children: [] },
        { id: 5, type: 'Label', label: 'Note', sortOrder: 2, children: [] },
      ];
      const { source, refs } = diagramFromView({
        view: { name: 'V' }, nodes, connections: [{ id: 1, sourceNodeId: 2, targetNodeId: 3, relationshipRefId: 9, sortOrder: 0 }, { id: 2, sourceNodeId: 2, targetNodeId: 5, sortOrder: 1 }],
        elementById: id => elements.get(id), relationshipById: id => (id === 9 ? rel(9, 'Assignment', 1, 2) : null),
      });
      assert.includes(source, 'rectangle "Group" <<Grouping>> as n1 #line.dashed {');
      assert.includes(source, 'card "↗ Go there" as n4');
      assert.includes(source, 'card "Note" as n5');
      assert.includes(source, 'Rel_Assignment(n2, n3, "")');
      assert.includes(source, 'n2 .. n5');
      assert.deepEqual(refs.viewEntities, { n4: 7 });
      assert.deepEqual(refs.entities, { n2: 1, n3: 2 });
    });
  });

  describe('2.27.0: PU-2 to PU-5', () => {
    const elements = new Map([[1, el(1, 'BusinessActor', 'A')], [2, el(2, 'BusinessRole', 'R')], [3, el(3, 'ApplicationComponent', 'C')]]);
    const view = nodes => diagramFromView({
      view: { name: 'V' }, nodes, connections: [], elementById: id => elements.get(id), relationshipById: () => null,
    }).source;
    const node = (id, ref, x, y, extra = {}) => ({ id, type: 'Element', elementRefId: ref, x, y, w: 120, h: 55, sortOrder: id, children: [], ...extra });

    test('PU-3: the view\'s rows and order as hidden links, top to bottom whatever the direction setting', () => {
      const saved = settings.plantumlDirection;
      settings.plantumlDirection = 'LR';
      try {
        // a row of two (y 10 and 20: the same row), a third below
        const source = view([node(3, 3, 50, 200), node(2, 2, 300, 20), node(1, 1, 50, 10)]);
        assert.includes(source, 'top to bottom direction');
        assert.includes(source, 'n1 -[hidden]right- n2');
        assert.includes(source, 'n1 -[hidden]down- n3');
        assert.notIncludes(source, 'n2 -[hidden]right- n3');
      } finally { settings.plantumlDirection = saved; }
    });

    test('PU-3: siblings inside a container are arranged among themselves', () => {
      const source = view([{ id: 9, type: 'Container', label: 'G', x: 0, y: 0, w: 500, h: 300, sortOrder: 0,
        children: [node(1, 1, 300, 50), node(2, 2, 20, 50)] }]);
      assert.includes(source, 'n2 -[hidden]right- n1');
    });

    test('PU-5: the view\'s own fill, line and text colours; a colour by property wins', () => {
      const style = { fillColor: { r: 255, g: 0, b: 0 }, lineColor: { r: 0, g: 0, b: 255 }, font: { color: { r: 0, g: 128, b: 0 } } };
      assert.includes(view([node(1, 1, 0, 0, { style })]), 'archimate #ff0000;line:0000ff;text:008000 "A" <<business-actor>> as n1');
      const deco = { colour: () => '#123456', extraLabel: null, legend: null };
      const source = diagramFromView({ view: { name: 'V' }, nodes: [node(1, 1, 0, 0, { style })], connections: [],
        elementById: id => elements.get(id), relationshipById: () => null, deco }).source;
      assert.includes(source, 'archimate #123456 "A" <<business-actor>> as n1');
      assert.includes(view([node(1, 1, 0, 0)]), 'Business_Actor(n1, "A")', 'no colours: the macro');
    });

    test('PU-5: the legend of element types and the hand-drawn look are settings', () => {
      const saved = { ...settings };
      try {
        settings.plantumlLegend = true;
        settings.plantumlSketch = true;
        const source = view([node(1, 1, 0, 0), node(2, 3, 200, 0)]);
        assert.includes(source, '!option handwritten true');
        assert.match(source, /legend right\n<b>Element types<\/b>\n<\$archimate\/application-component> Application Component\n<\$archimate\/business-actor> Business Actor\nendlegend/);
        settings.plantumlLegend = false;
        settings.plantumlSketch = false;
        const plain = view([node(1, 1, 0, 0)]);
        assert.notIncludes(plain, 'handwritten');
        assert.notIncludes(plain, 'Element types');
      } finally { Object.assign(settings, saved); }
    });

    test('PU-5: one legend with the colours of a property and the element types (PlantUML draws only the last one)', () => {
      const saved = settings.plantumlLegend;
      settings.plantumlLegend = true;
      try {
        const deco = { extraLabel: null, colour: () => '#ff0000', legend: [['#ff0000', 'X']], legendTitle: 'owner' };
        const { source } = diagramFromElements({ elements: [el(1, 'BusinessActor', 'A'), el(2, 'Grouping', 'G')], relationships: [], deco });
        assert.equal(source.match(/^legend /gm).length, 1);
        assert.match(source, /legend right\n<b>owner<\/b>\n<back:#ff0000> {6}<\/back> X\n \n<b>Element types<\/b>\n<\$archimate\/business-actor> Business Actor\nendlegend/);
        assert.notIncludes(source, '$archimate/grouping', 'no sprite for a grouping');
      } finally { settings.plantumlLegend = saved; }
    });

    test('PU-3: a relationship goes the way it goes in the view: sideways within a row, else up or down', () => {
      const els = new Map([[1, el(1, 'BusinessActor', 'A')], [2, el(2, 'BusinessRole', 'B')], [3, el(3, 'BusinessProcess', 'C')]]);
      const rels2 = new Map([[11, rel(11, 'Assignment', 1, 2)], [12, rel(12, 'Serving', 3, 1)]]);
      const { source } = diagramFromView({
        view: { name: 'V' },
        nodes: [node(1, 1, 0, 0), node(2, 2, 300, 20), node(3, 3, 100, 200)],
        connections: [{ id: 1, sourceNodeId: 1, targetNodeId: 2, relationshipRefId: 11, sortOrder: 0 }, { id: 2, sourceNodeId: 3, targetNodeId: 1, relationshipRefId: 12, sortOrder: 1 }],
        elementById: id => els.get(id), relationshipById: id => rels2.get(id),
      });
      assert.includes(source, 'Rel_Assignment_Right(n1, n2, "")');
      assert.includes(source, 'Rel_Serving_Up(n3, n1, "")');
    });

    test('PU-2: a long diagram goes by POST: to <server>/svg, else to /render (PicoWeb), else by GET; a short one by GET', async () => {
      const svg = () => new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml' } });
      const png = () => new Response('PNG', { headers: { 'Content-Type': 'image/png' } });
      const calls = [];
      const server = answers => async (url, init) => { calls.push([url, init?.method || 'GET', init?.body]); return answers(url, init); };
      // plantuml-server: the text at <server>/svg
      await fetchPlantUmlSvg('https://p.example/plantuml/svg/SHORT', { source: '@startuml\n@enduml', fetchFn: server(svg) });
      const long = 'https://p.example/plantuml/svg/' + 'x'.repeat(LONG_URL);
      await fetchPlantUmlSvg(long, { source: 'the source', fetchFn: server(svg) });
      assert.deepEqual(calls, [
        ['https://p.example/plantuml/svg/SHORT', 'GET', undefined],
        ['https://p.example/plantuml/svg', 'POST', 'the source'],
      ]);
      // PicoWeb: a POST to /svg ends as a fixed PNG; JSON at /render answers
      calls.length = 0;
      await fetchPlantUmlSvg(long, { source: 'the source', fetchFn: server(url => (url.endsWith('/render') ? svg() : png())) });
      assert.deepEqual(calls.map(c => c.slice(0, 2)), [['https://p.example/plantuml/svg', 'POST'], ['https://p.example/render', 'POST']]);
      assert.deepEqual(JSON.parse(calls[1][2]), { source: 'the source', options: ['-tsvg'] });
      // neither: the long GET
      calls.length = 0;
      await fetchPlantUmlSvg(long, { source: 'the source', fetchFn: server((url, init) => (init?.method ? png() : svg())) });
      assert.deepEqual(calls.map(c => c[1]), ['POST', 'POST', 'GET']);
    });
  });

  describe('inlined SVG', () => {
    const svgText = `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">
      <script>alert(2)</script>
      <g class="entity" data-qualified-name="e1" id="ent1"><rect/></g>
      <g class="entity" data-qualified-name="x.e2" id="ent2"><rect/></g>
      <g class="link" data-entity-1="ent1" data-entity-2="ent2"><path d="M0,0 L1,1"/></g>
      <a href="javascript:alert(3)"><text>x</text></a>
    </svg>`;

    test('parseSvg removes scripts, event handlers and javascript: links', () => {
      const svg = parseSvg(svgText);
      assert.equal(svg.querySelector('script'), null);
      assert.equal(svg.getAttribute('onload'), null);
      assert.equal(svg.querySelector('a').getAttribute('href'), null);
    });

    test('annotateSvg maps entities and links back to the model', () => {
      const svg = parseSvg(svgText);
      const mapped = annotateSvg(svg, { entities: { e1: 11, e2: 12 }, links: [{ from: 'e1', to: 'e2', id: 77 }] });
      assert.equal(mapped, 3);
      assert.equal(svg.querySelector('#ent1').dataset.element, '11');
      assert.equal(svg.querySelector('g.link').dataset.relationship, '77');
      assert.ok(svg.querySelector('g.link .puml-hit'), 'wide hit path added');
    });
  });
});
