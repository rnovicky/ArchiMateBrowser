// EN-1 type check: every ElementType / RelationshipType / AccessType / NodeType
// of the API's OpenAPI spec (ArchiMateAPI/xmi_oas.json, served read-only by the
// test server) is mapped by the browser, and the browser knows no extra types.

import { describe, test, assert, skip } from '../harness.js';
import {
  ELEMENT_TYPES, RELATIONSHIP_TYPES, LAYERS, layerOf, typesOfLayer, plantumlMacro, plantumlStereotype, elementBadge,
  spriteName, relationshipMacro, relationshipGlyph, elementColor,
} from '../../js/archimate.js';
import { PROPAGATION, DEFAULT_TYPES } from '../../js/impact.js';
import { VIEWPOINTS } from '../../js/filters.js';
import { NESTING_TYPES } from '../../js/nesting.js';

let oas = null;
async function enums() {
  if (!oas) {
    const res = await fetch('/__test/oas.json');
    if (!res.ok) skip('xmi_oas.json not available (ArchiMateAPI not next to the browser folder)');
    oas = (await res.json()).components.schemas;
  }
  return oas;
}

describe('archimate types vs. xmi_oas.json', () => {
  test('every ElementType is mapped (layer, PlantUML macro, stereotype, badge, sprite), and no extra types', async () => {
    const api = (await enums()).ElementType.enum;
    const missing = api.filter(t => !ELEMENT_TYPES.includes(t));
    assert.deepEqual(missing, [], 'element types of the API not in archimate.js');
    const extra = ELEMENT_TYPES.filter(t => !api.includes(t));
    assert.deepEqual(extra, [], 'element types in archimate.js unknown to the API');
    for (const t of api) {
      assert.ok(layerOf(t), `${t}: no layer`);
      assert.ok(plantumlMacro(t), `${t}: no PlantUML macro`);
      assert.ok(elementBadge(t) && elementBadge(t) !== '?', `${t}: no badge`);
      assert.ok(spriteName(t), `${t}: no sprite`);
      assert.match(elementColor(t), /^#[0-9a-f]{6}$/i, `${t}: colour`);
      if (!/Junction$/.test(t)) assert.ok(plantumlStereotype(t), `${t}: no PlantUML stereotype`);
    }
  });

  test('every element type belongs to exactly one layer', () => {
    const all = LAYERS.flatMap(l => typesOfLayer(l.key));
    assert.equal(all.length, ELEMENT_TYPES.length);
    assert.equal(new Set(all).size, ELEMENT_TYPES.length);
  });

  test('every RelationshipType is mapped (macro, glyph, sprite, impact propagation), and no extra types', async () => {
    const api = (await enums()).RelationshipType.enum;
    assert.deepEqual(api.filter(t => !RELATIONSHIP_TYPES.includes(t)), [], 'relationship types of the API not in archimate.js');
    assert.deepEqual(RELATIONSHIP_TYPES.filter(t => !api.includes(t)), [], 'relationship types in archimate.js unknown to the API');
    for (const t of api) {
      assert.equal(relationshipMacro({ type: t }), `Rel_${t}`, `${t}: macro`);
      assert.ok(relationshipGlyph(t) !== '—' || t === 'Association', `${t}: glyph`);
      assert.ok(spriteName({ type: t }), `${t}: sprite`);
      assert.ok(PROPAGATION[t], `${t}: impact propagation`);
    }
  });

  test('every AccessType has its PlantUML macro', async () => {
    const api = (await enums()).AccessType.enum;
    const macros = Object.fromEntries(api.map(a => [a, relationshipMacro({ type: 'Access', accessType: a })]));
    assert.deepEqual(macros, { Access: 'Rel_Access', Read: 'Rel_Access_r', Write: 'Rel_Access_w', ReadWrite: 'Rel_Access_rw' });
  });

  test('NodeType values are the ones the view renderer handles', async () => {
    assert.deepEqual([...(await enums()).NodeType.enum].sort(), ['Container', 'Element', 'Label']);
  });

  test('viewpoint presets, impact defaults and nesting use known types only', () => {
    for (const [k, vp] of Object.entries(VIEWPOINTS)) {
      assert.deepEqual(vp.elements.filter(t => !ELEMENT_TYPES.includes(t)), [], `viewpoint ${k}: element types`);
      assert.deepEqual(vp.relationships.filter(t => !RELATIONSHIP_TYPES.includes(t)), [], `viewpoint ${k}: relationship types`);
    }
    assert.deepEqual(DEFAULT_TYPES.filter(t => !RELATIONSHIP_TYPES.includes(t)), []);
    assert.deepEqual(NESTING_TYPES.filter(t => !RELATIONSHIP_TYPES.includes(t)), []);
  });
});
