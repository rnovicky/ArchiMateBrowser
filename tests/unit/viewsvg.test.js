import { describe, test, assert } from '../harness.js';
import { renderViewSvg, svgToString, svgToPng, wrap } from '../../js/viewsvg.js';
import { loadSprites } from '../../js/archimate.js';
import { diagramFromView } from '../../js/plantuml.js';
import { fixtureStore, syntheticStore, E, V, SYN } from './fixture.js';

async function renderView(viewId, extra = {}) {
  const s = await fixtureStore();
  await loadSprites();
  const { nodes, connections } = await s.viewContent(V(viewId));
  const layout = renderViewSvg({
    nodes, connections, elementById: id => s.element(id), relationshipById: id => s.relationship(id), viewName: id => s.view(id)?.name, ...extra,
  });
  // the renderer measures the SVG on screen (zoom, area selection): put it in the page while testing
  const host = document.createElement('div');
  host.style.cssText = 'width:800px;height:500px;position:absolute;left:-10000px;top:0';
  host.append(layout.svg);
  layout.svg.style.cssText = 'width:100%;height:100%';
  document.body.append(host);
  return { layout, host, s };
}

describe('view renderer', () => {
  test('draws element nodes, containers, labels, the drill-down box and connections', async () => {
    const { layout, host } = await renderView(1);
    const svg = layout.svg;
    assert.equal(svg.querySelectorAll('.v-node').length, 8);
    assert.equal(svg.querySelectorAll('.v-node[data-element]').length, 5);
    assert.ok(svg.querySelector(`.v-drill[data-view="${V(2)}"]`), 'drill-down link to view 2');
    assert.equal(svg.querySelectorAll('.v-conn[data-relationship]').length, 3);
    assert.includes(svg.textContent, 'A note about the overview');
    host.remove();
  });

  test('clicks select; Ctrl-click and Shift-drag mark (CM-6); right-click opens the menus', async () => {
    const calls = [];
    const { layout, host } = await renderView(1, {
      onSelect: (k, id) => calls.push(['select', k, id]), onMark: (ids, mode) => calls.push(['mark', ids, mode]),
      onNodeMenu: id => calls.push(['menu', id]), onOpenView: id => calls.push(['open', id]),
    });
    const svg = layout.svg;
    const customer = svg.querySelector(`.v-node[data-element="${E.customer}"]`);
    customer.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    customer.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    customer.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    svg.querySelector('.v-drill').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    // area selection over the whole drawing
    const r = svg.getBoundingClientRect();
    const pe = (type, x, y) => svg.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 3, shiftKey: true }));
    pe('pointerdown', r.left + 1, r.top + 1); pe('pointermove', r.left + 20, r.top + 20); pe('pointermove', r.right - 1, r.bottom - 1); pe('pointerup', r.right - 1, r.bottom - 1);
    assert.deepEqual(calls.slice(0, 4), [['select', 'element', E.customer], ['mark', [E.customer], 'toggle'], ['menu', E.customer], ['open', V(2)]]);
    const band = calls.find(c => c[0] === 'mark' && c[2] === 'add');
    assert.ok(band, 'area selection reported');
    assert.deepEqual(new Set(band[1]), new Set([E.customer, E.role, E.orderHandling, E.erp, E.billingModule]));
    host.remove();
  });

  test('connections that end on connections (API-9): drawn to the middle of the line they end on', async () => {
    const s = await syntheticStore();
    await loadSprites();
    const { nodes, connections } = await s.viewContent(SYN.views['v-overview']);
    const { svg } = renderViewSvg({ nodes, connections, elementById: id => s.element(id), relationshipById: id => s.relationship(id), viewName: id => s.view(id)?.name });
    // seven connections, all drawn
    assert.equal(svg.querySelectorAll('.v-conn').length, 7);
    const conn = xmi => {
      const c = connections.find(x => x.xmiIdentifier === xmi);
      const points = svg.querySelector(`.v-conn[data-connection="${c.id}"] path`).getAttribute('d').slice(1).split(' L').map(p => p.split(',').map(Number));
      return { c, points };
    };
    const middle = pts => {
      const len = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
      let rest = len.reduce((a, b) => a + b, 0) / 2;
      for (let i = 0; i < len.length; i++) { if (rest <= len[i]) return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * rest / len[i], pts[i][1] + (pts[i + 1][1] - pts[i][1]) * rest / len[i]]; rest -= len[i]; }
      return pts.at(-1);
    };
    const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.01;
    const flow = conn('c-ov-shop-kafka'), assoc = conn('c-ov-req-flow'), influence = conn('c-ov-goal-assoc');
    assert.equal(flow.points.length, 4, 'two bendpoints');
    assert.equal(assoc.c.targetConnectionId, flow.c.id);
    assert.ok(near(assoc.points.at(-1), middle(flow.points)), 'the association ends on the middle of the flow');
    // a chain: the influence ends on the association, which itself ends on a connection
    assert.equal(influence.c.targetConnectionId, assoc.c.id);
    assert.ok(near(influence.points.at(-1), middle(assoc.points)), 'the influence ends on the middle of the association');
    assert.equal(svg.querySelectorAll('.v-conn[data-tgt-connection]').length, 2);
  });

  test('connections on connections in the PlantUML export of a view: a helper dot on the line', async () => {
    const s = await syntheticStore();
    const { nodes, connections } = await s.viewContent(SYN.views['v-overview']);
    const { source, refs } = diagramFromView({ view: s.view(SYN.views['v-overview']), nodes, connections, elementById: id => s.element(id), relationshipById: id => s.relationship(id), viewName: id => s.view(id)?.name });
    const id = xmi => connections.find(x => x.xmiIdentifier === xmi).id;
    const flow = id('c-ov-shop-kafka'), assoc = id('c-ov-req-flow');
    assert.includes(source, `circle #666666 " " as c${flow}`);
    assert.includes(source, `circle #666666 " " as c${assoc}`);
    assert.equal(source.split('circle #666666').length - 1, 2, 'a dot only for the two connections that others end on');
    assert.deepEqual(refs.relEntities, { [`c${flow}`]: SYN.relationships['r-flow-shop-kafka'], [`c${assoc}`]: SYN.relationships['r-assoc-req-flow'] });
    // the flow in two halves through its dot; the association from the requirement to the flow's dot, through its own
    const links = refs.links.map(l => `${l.from}>${l.to}`);
    assert.ok(links.some(l => l.endsWith(`>c${flow}`)) && links.some(l => l.startsWith(`c${flow}>`)));
    assert.includes(links, `c${assoc}>c${flow}`);
    assert.ok(links.some(l => l.endsWith(`>c${assoc}`) && !l.startsWith('c')), 'the influence from the goal ends on the dot of the association');
  });

  test('zoom, fit and view state', async () => {
    const { layout, host } = await renderView(2);
    const full = layout.view();
    layout.zoom(0.5);
    assert.ok(Math.abs(layout.view().w - full.w / 2) < 0.01);
    layout.fit();
    assert.deepEqual(layout.view(), full);
    host.remove();
  });

  test('fit never enlarges: a small diagram keeps the standard element size; a large one is shrunk', async () => {
    const s = await fixtureStore();
    const one = { id: 'n1', elementId: E.erp, x: 0, y: 0, w: 120, h: 55, children: [] };
    const frames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const render = async (nodes, w, h) => {
      const layout = renderViewSvg({ nodes, connections: [], elementById: id => s.element(id), relationshipById: () => null });
      const host = document.createElement('div');
      host.style.cssText = `width:${w}px;height:${h}px;position:absolute;left:-10000px;top:0`;
      host.append(layout.svg);
      layout.svg.style.cssText = 'width:100%;height:100%';
      document.body.append(host);
      await frames(); // the renderer fits once it knows its size on screen
      return { layout, host };
    };
    const width = layout => layout.svg.querySelector('.v-node').getBoundingClientRect().width;
    // one element in a large pane: shown at its own size (120 px), in the middle
    let { layout, host } = await render([one], 1200, 800);
    assert.ok(Math.abs(width(layout) - 120) < 0.5, `standard size, got ${width(layout)}`);
    const v = layout.view();
    assert.ok(Math.abs(v.w - 1200) < 0.5 && Math.abs(v.h - 800) < 0.5, '1 unit = 1 px');
    assert.ok(Math.abs(v.x + v.w / 2 - 60) < 0.5 && Math.abs(v.y + v.h / 2 - 27.5) < 0.5, 'centred');
    // the pane grows while fitted: the element keeps its size
    host.style.width = '1600px';
    await frames();
    assert.ok(Math.abs(layout.view().w - 1600) < 0.5);
    assert.ok(Math.abs(width(layout) - 120) < 0.5);
    // zoomed in by the user: allowed beyond the standard size; Fit goes back to it
    layout.zoom(0.5);
    assert.ok(Math.abs(width(layout) - 240) < 1);
    layout.fit();
    assert.ok(Math.abs(width(layout) - 120) < 0.5);
    host.remove();
    // a diagram larger than the pane is shrunk to fit, as before
    const many = Array.from({ length: 20 }, (_, i) => ({ ...one, id: `n${i}`, x: i * 160 }));
    ({ layout, host } = await render(many, 800, 500));
    assert.ok(width(layout) < 120, `shrunk, got ${width(layout)}`);
    const b = layout.bounds(), w = layout.view();
    assert.ok(Math.abs(w.w - b.w) < 0.5 || Math.abs(w.h - b.h) < 0.5, 'the whole diagram, touching one side');
    host.remove();
  });

  test('SVG export: whole diagram, styles inlined, no UI state', async () => {
    const { layout, host } = await renderView(2);
    layout.svg.querySelector('.v-node').classList.add('diagram-selected', 'marked');
    layout.zoom(0.25);
    const text = svgToString(layout.svg, { bounds: layout.bounds() });
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    assert.equal(doc.querySelector('parsererror'), null, 'well-formed');
    assert.notIncludes(text, 'diagram-selected');
    assert.notIncludes(text, 'marked');
    assert.notIncludes(text, 'var(--');
    assert.includes(text, '<style>');
    assert.equal(doc.documentElement.getAttribute('width'), String(Math.ceil(layout.bounds().w)));
    host.remove();
  });

  test('PNG export rasterises the whole diagram at 2×', async () => {
    const { layout, host } = await renderView(2);
    const png = await svgToPng(layout.svg, { bounds: layout.bounds(), scale: 2 });
    assert.equal(png.blob.type, 'image/png');
    assert.equal(png.width, Math.round(layout.bounds().w * 2));
    host.remove();
  });

  test('label wrapping', () => {
    assert.deepEqual(wrap('Customer Account Statements', 10), ['Customer', 'Account', 'Statements']);
    assert.deepEqual(wrap('', 10), []);
  });
});
