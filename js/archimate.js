// ArchiMate 3.x metadata: layers, element types, colours, PlantUML macro names.
// Element/relationship type names match the ElementType / RelationshipType enums
// of the ArchiMateAPI OpenAPI spec (xmi_oas.json).

// `api`: the name of the layer in the API (its `layers` filters, `stats.elements.byLayer`).
// `key` is this app's own name, which is also part of shared links, so it stays as it is.
export const LAYERS = [
  { key: 'strategy',       api: 'Strategy',                label: 'Strategy',                   color: '#f5deaa' },
  { key: 'business',       api: 'Business',                label: 'Business',                   color: '#ffffb5' },
  { key: 'application',    api: 'Application',             label: 'Application',                color: '#b5ffff' },
  { key: 'technology',     api: 'Technology',              label: 'Technology',                 color: '#c9e7b7' },
  { key: 'physical',       api: 'Physical',                label: 'Physical',                   color: '#c9e7b7' },
  { key: 'motivation',     api: 'Motivation',              label: 'Motivation',                 color: '#ccccff' },
  { key: 'implementation', api: 'ImplementationMigration', label: 'Implementation & Migration', color: '#ffe0e0' },
  { key: 'other',          api: 'Other',                   label: 'Other',                      color: '#ffffff' },
];

// type -> [layer, PlantUML macro, short badge text]
const T = {
  Resource: ['strategy', 'Strategy_Resource', 'Res'],
  Capability: ['strategy', 'Strategy_Capability', 'Cap'],
  CourseOfAction: ['strategy', 'Strategy_CourseOfAction', 'CoA'],
  ValueStream: ['strategy', 'Strategy_ValueStream', 'VS'],

  BusinessActor: ['business', 'Business_Actor', 'Act'],
  BusinessRole: ['business', 'Business_Role', 'Role'],
  BusinessCollaboration: ['business', 'Business_Collaboration', 'Col'],
  BusinessInterface: ['business', 'Business_Interface', 'If'],
  BusinessProcess: ['business', 'Business_Process', 'Proc'],
  BusinessFunction: ['business', 'Business_Function', 'Fn'],
  BusinessInteraction: ['business', 'Business_Interaction', 'Int'],
  BusinessEvent: ['business', 'Business_Event', 'Evt'],
  BusinessService: ['business', 'Business_Service', 'Svc'],
  BusinessObject: ['business', 'Business_Object', 'Obj'],
  Contract: ['business', 'Business_Contract', 'Ctr'],
  Representation: ['business', 'Business_Representation', 'Rep'],
  Product: ['business', 'Business_Product', 'Prod'],

  ApplicationComponent: ['application', 'Application_Component', 'Cmp'],
  ApplicationCollaboration: ['application', 'Application_Collaboration', 'Col'],
  ApplicationInterface: ['application', 'Application_Interface', 'If'],
  ApplicationFunction: ['application', 'Application_Function', 'Fn'],
  ApplicationInteraction: ['application', 'Application_Interaction', 'Int'],
  ApplicationProcess: ['application', 'Application_Process', 'Proc'],
  ApplicationEvent: ['application', 'Application_Event', 'Evt'],
  ApplicationService: ['application', 'Application_Service', 'Svc'],
  DataObject: ['application', 'Application_DataObject', 'Data'],

  Node: ['technology', 'Technology_Node', 'Node'],
  Device: ['technology', 'Technology_Device', 'Dev'],
  SystemSoftware: ['technology', 'Technology_SystemSoftware', 'SW'],
  TechnologyCollaboration: ['technology', 'Technology_Collaboration', 'Col'],
  TechnologyInterface: ['technology', 'Technology_Interface', 'If'],
  Path: ['technology', 'Technology_Path', 'Path'],
  CommunicationNetwork: ['technology', 'Technology_CommunicationNetwork', 'Net'],
  TechnologyFunction: ['technology', 'Technology_Function', 'Fn'],
  TechnologyProcess: ['technology', 'Technology_Process', 'Proc'],
  TechnologyInteraction: ['technology', 'Technology_Interaction', 'Int'],
  TechnologyEvent: ['technology', 'Technology_Event', 'Evt'],
  TechnologyService: ['technology', 'Technology_Service', 'Svc'],
  Artifact: ['technology', 'Technology_Artifact', 'Art'],

  Equipment: ['physical', 'Physical_Equipment', 'Eq'],
  Facility: ['physical', 'Physical_Facility', 'Fac'],
  DistributionNetwork: ['physical', 'Physical_DistributionNetwork', 'Dist'],
  Material: ['physical', 'Physical_Material', 'Mat'],

  Stakeholder: ['motivation', 'Motivation_Stakeholder', 'Stk'],
  Driver: ['motivation', 'Motivation_Driver', 'Drv'],
  Assessment: ['motivation', 'Motivation_Assessment', 'Ass'],
  Goal: ['motivation', 'Motivation_Goal', 'Goal'],
  Outcome: ['motivation', 'Motivation_Outcome', 'Out'],
  Principle: ['motivation', 'Motivation_Principle', 'Prn'],
  Requirement: ['motivation', 'Motivation_Requirement', 'Req'],
  Constraint: ['motivation', 'Motivation_Constraint', 'Cns'],
  Meaning: ['motivation', 'Motivation_Meaning', 'Mng'],
  Value: ['motivation', 'Motivation_Value', 'Val'],

  WorkPackage: ['implementation', 'Implementation_WorkPackage', 'WP'],
  Deliverable: ['implementation', 'Implementation_Deliverable', 'Dlv'],
  ImplementationEvent: ['implementation', 'Implementation_Event', 'Evt'],
  Plateau: ['implementation', 'Implementation_Plateau', 'Plt'],
  Gap: ['implementation', 'Implementation_Gap', 'Gap'],

  Grouping: ['other', 'Grouping', 'Grp'],
  Location: ['other', 'Other_Location', 'Loc'],
  AndJunction: ['other', 'Junction_And', 'And'],
  OrJunction: ['other', 'Junction_Or', 'Or'],
};

export const ELEMENT_TYPES = Object.keys(T);

export const RELATIONSHIP_TYPES = [
  'Composition', 'Aggregation', 'Assignment', 'Realization', 'Serving', 'Access',
  'Influence', 'Triggering', 'Flow', 'Specialization', 'Association',
];

const LAYER_BY_KEY = Object.fromEntries(LAYERS.map(l => [l.key, l]));

export function layerOf(type) {
  return LAYER_BY_KEY[(T[type] || ['other'])[0]];
}

export function typesOfLayer(layerKey) {
  return ELEMENT_TYPES.filter(t => T[t][0] === layerKey);
}

export function elementColor(type) {
  if (type === 'WorkPackage' || type === 'Deliverable' || type === 'ImplementationEvent') return '#ffe0e0';
  if (type === 'Plateau' || type === 'Gap') return '#e0ffe0';
  if (type === 'Location') return '#fbb875';
  return layerOf(type).color;
}

export function elementBadge(type) {
  return (T[type] || [null, null, '?'])[2];
}

// ---------------------------------------------------------------- sprites
// Icons extracted from inputs/archi_sprites.svg by tools/extract_sprites.py
// into img/sprites/ (see img/sprites/index.html). Element types use the
// layer-specific variants; relationships use the relationship sprites.

// 2.20.0: an offline copy carries the icons (js/offline/package.js); there this module is a Blob URL, and
// a path relative to it means nothing
const OFFLINE = globalThis.ARCHIXMI_OFFLINE;
export const SPRITE_DIR = OFFLINE ? '' : new URL('../img/sprites/', import.meta.url).href; // relative to this module, for any page

const ELEMENT_SPRITES = {
  Resource: 'strategy-resource', Capability: 'strategy-capability', CourseOfAction: 'strategy-course-of-action', ValueStream: 'strategy-valuestream',
  BusinessActor: 'business-actor', BusinessRole: 'business-role', BusinessCollaboration: 'business-collaboration', BusinessInterface: 'business-interface',
  BusinessProcess: 'business-process', BusinessFunction: 'business-function', BusinessInteraction: 'business-interaction', BusinessEvent: 'business-event',
  BusinessService: 'business-service', BusinessObject: 'business-object', Contract: 'business-contract', Representation: 'business-representation', Product: 'business-product',
  ApplicationComponent: 'application-component', ApplicationCollaboration: 'application-collaboration', ApplicationInterface: 'application-interface',
  ApplicationFunction: 'application-function', ApplicationInteraction: 'application-interaction', ApplicationProcess: 'application-process',
  ApplicationEvent: 'application-event', ApplicationService: 'application-service', DataObject: 'application-data-object',
  Node: 'technology-node', Device: 'technology-device', SystemSoftware: 'technology-system-software', TechnologyCollaboration: 'technology-collaboration',
  TechnologyInterface: 'technology-interface', Path: 'technology-path', CommunicationNetwork: 'technology-communication-network',
  TechnologyFunction: 'technology-function', TechnologyProcess: 'technology-process', TechnologyInteraction: 'technology-interaction',
  TechnologyEvent: 'technology-event', TechnologyService: 'technology-service', Artifact: 'technology-artifact',
  Equipment: 'physical-equipment', Facility: 'physical-facility', DistributionNetwork: 'technology-distribution-network', Material: 'physical-material',
  Stakeholder: 'motivation-stakeholder', Driver: 'motivation-driver', Assessment: 'motivation-assessment', Goal: 'motivation-goal',
  Outcome: 'motivation-outcome', Principle: 'motivation-principle', Requirement: 'motivation-requirement', Constraint: 'motivation-constraint',
  Meaning: 'motivation-meaning', Value: 'motivation-value',
  WorkPackage: 'implementation-workpackage', Deliverable: 'implementation-deliverable', ImplementationEvent: 'implementation-event',
  Plateau: 'implementation-plateau', Gap: 'implementation-gap',
  Grouping: 'other-grouping', Location: 'other-location', AndJunction: 'junction-and', OrJunction: 'junction-or',
};

const RELATIONSHIP_SPRITES = {
  Composition: 'composition', Aggregation: 'aggregation', Assignment: 'assignment', Realization: 'realisation',
  Serving: 'serving', Access: 'access', Influence: 'influence', Triggering: 'triggering', Flow: 'flow',
  Specialization: 'specialization', Association: 'association',
};

// File extension per sprite (vector sprites are .svg, a few are .png); filled by loadSprites().
let spriteFiles = null;
let spriteData = null;

/**
 * Load img/sprites/sprites.json once: file names for <img> badges and the
 * inline path data/data URIs used to embed icons in diagram SVGs (so
 * exported SVG files stay self-contained).
 */
export async function loadSprites() {
  try {
    const manifest = OFFLINE ? OFFLINE.sprites : await fetch(SPRITE_DIR + 'sprites.json').then(r => (r.ok ? r.json() : null));
    spriteData = manifest?.sprites || {};
  } catch {
    spriteData = {}; // no sprites: badges fall back to text only
  }
  spriteFiles = Object.fromEntries(Object.entries(spriteData).map(([k, v]) => [k, v.file]));
}

/** Sprite name of an element type or relationship ({type, isDirected}); null if none. */
export function spriteName(typeOrRel) {
  if (typeof typeOrRel === 'object' && typeOrRel) {
    if (typeOrRel.type === 'Association' && typeOrRel.isDirected) return 'association-unidirect';
    return RELATIONSHIP_SPRITES[typeOrRel.type] || null;
  }
  return ELEMENT_SPRITES[typeOrRel] || RELATIONSHIP_SPRITES[typeOrRel] || null;
}

/** URL of the sprite file for an element type / relationship type / relationship, or null. */
export function spriteUrl(typeOrRel) {
  const name = spriteName(typeOrRel);
  const file = name && spriteFiles?.[name];
  if (!file) return null;
  return OFFLINE ? OFFLINE.spriteFiles?.[file] ?? null : SPRITE_DIR + file;
}

/** Inline data of a sprite: { viewBox, d } for vector sprites, { dataUri, width, height } for PNG ones. */
export function spriteInline(typeOrRel) {
  const name = spriteName(typeOrRel);
  return (name && spriteData?.[name]) || null;
}

export function plantumlMacro(type) {
  return (T[type] || [null, null])[1];
}

// Sprite stereotypes used inside the stdlib macros (extracted from
// stdlib/archimate/Archimate.puml). Needed to draw an element with a custom
// fill colour: `archimate #color "label" <<stereotype>> as alias`.
const STEREOTYPE_EXCEPTIONS = {
  DataObject: 'application-dataobject', Contract: 'business-contract', Representation: 'business-representation',
  Product: 'business-product', Node: 'technology-node', Device: 'technology-device', SystemSoftware: 'technology-systemsoftware',
  Path: 'technology-path', CommunicationNetwork: 'technology-communicationnetwork', Artifact: 'technology-artifact',
  Equipment: 'technology-equipment', Facility: 'technology-facility', DistributionNetwork: 'technology-distributionnetwork',
  Material: 'technology-material', ImplementationEvent: 'implementation-event', Grouping: 'grouping', Location: 'location',
};

/** e.g. BusinessActor -> "business-actor", Capability -> "strategy-capability"; null for junctions. */
export function plantumlStereotype(type) {
  if (type === 'AndJunction' || type === 'OrJunction') return null;
  if (STEREOTYPE_EXCEPTIONS[type]) return STEREOTYPE_EXCEPTIONS[type];
  const macro = plantumlMacro(type); // e.g. Business_Actor, Strategy_CourseOfAction
  if (!macro) return null;
  const [prefix, rest] = macro.split('_');
  return `${prefix.toLowerCase()}-${rest.toLowerCase()}`;
}

/** Human-readable type name: "BusinessActor" -> "Business Actor". */
export function prettyType(type) {
  return String(type || '').replace(/([a-z])([A-Z])/g, '$1 $2');
}

export function relationshipMacro(rel) {
  if (rel.type === 'Access') {
    return { Read: 'Rel_Access_r', Write: 'Rel_Access_w', ReadWrite: 'Rel_Access_rw' }[rel.accessType] || 'Rel_Access';
  }
  if (rel.type === 'Association' && rel.isDirected) return 'Rel_Association_dir';
  return 'Rel_' + rel.type;
}

/** Arrow glyph used in the tree / details panel for a relationship type. */
export function relationshipGlyph(type) {
  return {
    Composition: '◆—', Aggregation: '◇—', Assignment: '●→', Realization: '-▷',
    Serving: '—>', Access: '··>', Influence: '-->', Triggering: '—▶',
    Flow: '-▶', Specialization: '—▷', Association: '——',
  }[type] || '—';
}
