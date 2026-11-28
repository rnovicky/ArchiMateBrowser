// ArchiMate Browser: Tree specs: what the model tree, the basket and the search results show.
// Part of js/app.js until 2026-10-24 (EN-6); app.js wires it to the page.

import { api } from '../api.js';
import { t } from '../i18n.js';
import { isFolder } from '../store.js';
import { isCreated } from '../viewcontent.js';
import { LAYERS, RELATIONSHIP_TYPES, typesOfLayer, elementColor, elementBadge, prettyType, relationshipGlyph, spriteUrl } from '../archimate.js';
import { state } from './state.js';

// ================================================================ tree specs

/**
 * An element as a tree row: `n↗ m↙` from its relationship counts (HLP-6) where they are
 * known; without them the row can be opened anyway and asks for its relationships then.
 */
export function elementSpec(e, { prefix, sub } = {}) {
  const degree = e.degree ?? state.store.degree(e.id);
  const nOut = degree?.outgoing ?? 0, nIn = degree?.incoming ?? 0;
  return {
    label: (prefix ? prefix + ' ' : '') + (e.name || t('(unnamed {type})', { type: prettyType(e.type) })),
    muted: !e.name,
    badge: elementBadge(e.type),
    sprite: spriteUrl(e.type),
    color: elementColor(e.type),
    sub: sub ?? (nOut + nIn ? `${nOut}↗ ${nIn}↙` : ''),
    title: `${prettyType(e.type)}${(e.properties || []).map(p => `\n${p.propertyDefinitionName}: ${p.value}`).join('')}`
      + `${e.documentation ? '\n\n' + e.documentation : ''}`,
    key: `e:${e.id}`,
    data: { kind: 'element', id: e.id },
    loadChildren: !degree || nOut + nIn ? async () => relatedSpecs(e.id) : undefined,
  };
}

/** Children of an element node: its relationships, each leading to the element on the other end. */
export async function relatedSpecs(elementId) {
  const s = state.store;
  const { outgoing, incoming } = await s.relationshipsOf(elementId);
  // the elements at the other ends, with their own counts
  await s.ensure({ elements: [...outgoing.map(r => r.targetElementId), ...incoming.map(r => r.sourceElementId)] }, { degree: true });
  const specs = [];
  const add = (r, dir) => {
    const otherEl = dir === 'out' ? r.targetElementId : r.sourceElementId;
    const otherRel = dir === 'out' ? r.targetRelationshipId : r.sourceRelationshipId;
    const arrow = dir === 'out' ? `${r.type} →` : `← ${r.type}`;
    if (otherEl != null && s.element(otherEl)) {
      specs.push({ ...elementSpec(s.element(otherEl)), icon: dir === 'out' ? '↗' : '↙', sub: arrow, title: `${arrow} ${r.name || ''}` });
    } else if (otherRel != null && s.relationship(otherRel)) {
      // BR-6: the other end is a relationship; show it as an expandable relationship node
      specs.push({ ...relationshipSpec(s.relationship(otherRel)), icon: dir === 'out' ? '↗' : '↙', sub: t('{arrow} relationship', { arrow }), title: t('{type} attached to a relationship', { type: r.type }) });
    } else {
      specs.push({ icon: dir === 'out' ? '↗' : '↙', label: s.endpointName(otherEl, otherRel), sub: arrow, data: { kind: 'relationship', id: r.id } });
    }
  };
  for (const r of outgoing) add(r, 'out');
  for (const r of incoming) add(r, 'in');
  return specs;
}

export function relationshipSpec(r) {
  const s = state.store;
  return {
    icon: '⇢',
    iconSrc: spriteUrl(r),
    label: r.name ? `${r.name}: ${s.relationshipLabel(r)}` : s.relationshipLabel(r),
    title: `${r.type}${r.accessType ? ' (' + r.accessType + ')' : ''}`,
    key: `r:${r.id}`,
    data: { kind: 'relationship', id: r.id },
    loadChildren: async () => {
      const ends = [[r.sourceElementId, r.sourceRelationshipId], [r.targetElementId, r.targetRelationshipId]];
      const [attached] = await Promise.all([
        s.attachedTo(r.id),
        s.ensure({ elements: ends.map(([e]) => e), relationships: ends.map(([, x]) => x) }, { degree: true }),
      ]);
      const out = [];
      for (const [eid, rid, tag] of [[r.sourceElementId, r.sourceRelationshipId, t('source')], [r.targetElementId, r.targetRelationshipId, t('target')]]) {
        if (eid != null && s.element(eid)) out.push(elementSpec(s.element(eid), { sub: tag }));
        else if (rid != null && s.relationship(rid)) out.push({ ...relationshipSpec(s.relationship(rid)), sub: t('{end} (relationship)', { end: tag }) });
      }
      // BR-6: relationships whose source/target is this relationship
      for (const a of attached) out.push({ ...relationshipSpec(a), icon: '⤷', sub: t('attached {type}', { type: a.type }) });
      return out;
    },
  };
}

export function nodeSpecs(nodes) {
  const s = state.store;
  return [...nodes].sort((a, b) => a.sortOrder - b.sortOrder).map(n => {
    const kids = n.children || [];
    const el = n.elementRefId != null ? s.element(n.elementRefId) : null;
    const base = el ? elementSpec(el, { sub: '' }) : {
      icon: n.type === 'Label' ? '🏷' : '▭',
      label: n.label || `(${n.type})`,
      muted: !n.label,
      data: undefined,
    };
    if (n.label && el) base.label = n.label;
    if (!el && n.viewRefId != null && s.view(n.viewRefId)) {
      // BR-8: drill-down reference; selecting it opens the referenced view
      const target = s.view(n.viewRefId);
      return {
        icon: '↗', label: n.label || target.name, sub: t('view link'), title: t('Opens view: {name}', { name: target.name }),
        data: { kind: 'view', id: target.id, drill: true }, children: kids.length ? nodeSpecs(kids) : undefined,
      };
    }
    return { ...base, children: kids.length ? nodeSpecs(kids) : undefined, loadChildren: undefined };
  });
}

/** A stored view as a tree row; its children are the nodes of the view. A created view (BR-25) has a pencil. */
export function viewSpec(v) {
  const s = state.store;
  // 2.30.0: a recipe has no drawing: no nodes below it; opening it draws its diagram
  if (v.recipe != null) {
    return {
      key: `v:${v.id}`, icon: '📜', label: v.name, sub: '',
      title: [t('Recipe: drawn again from the model whenever it is opened'), t('Created by {who}', { who: v.createdBy || t('(unknown)') }),
        v.documentation || ''].filter(Boolean).join('\n\n'),
      data: { kind: 'view', id: v.id },
    };
  }
  return {
    key: `v:${v.id}`, icon: isCreated(v) ? '✎' : '🖼', label: v.name, sub: v.viewpoint || '',
    title: [isCreated(v) ? t('Created view by {who}', { who: v.createdBy || t('(unknown)') }) : '', v.documentation || ''].filter(Boolean).join('\n\n'),
    data: { kind: 'view', id: v.id },
    loadChildren: async () => nodeSpecs((await s.viewContent(v.id)).nodes),
  };
}

/**
 * Folder tree specs (BR-9): sub-folders first (in model order), then the elements, relationships and
 * views filed in the folder (API-11), each kind in the folder's order. The folder tree holds folders
 * only (BL-49); what is filed in a folder is asked for when it is opened (`folder`; none at the top).
 */
export async function orgSpecs(items, folder = null) {
  const s = state.store;
  const subfolders = items.filter(isFolder).sort((a, b) => a.sortOrder - b.sortOrder).map(folderSpec);
  if (folder == null) return subfolders;
  const filed = await s.folderItems(folder.id);
  return [...subfolders, ...filed.elements.map(e => elementSpec(e)), ...filed.relationships.map(relationshipSpec), ...filed.views.map(viewSpec)];
}

export function folderSpec(o) {
  const c = state.store.folderCounts(o.id);
  const parts = [c.elements && t('{n} el', { n: c.elements }), c.relationships && t('{n} rel', { n: c.relationships }),
    c.views && t('{n} view|{n} views', { n: c.views })].filter(Boolean);
  return {
    key: `f:${o.id}`, icon: '📁', label: o.label || t('(folder)'), muted: !o.label,
    sub: parts.join(' · ') || t('empty'),
    title: t('{elements} element(s), {relationships} relationship(s), {views} view(s) incl. sub-folders', { elements: c.elements, relationships: c.relationships, views: c.views }),
    data: { kind: 'folder', id: o.id },
    loadChildren: c.folders + c.elements + c.relationships + c.views ? async () => orgSpecs(o.children || [], o) : undefined,
  };
}

export function buildTree(store) {
  const s = store;
  const m = s.model;

  // API-5: which layers, types and relationship types exist, and how many of each, come from the API's statistics
  const st = s.stats;
  const layerSpecs = LAYERS.map(layer => {
    const types = typesOfLayer(layer.key).filter(t => st.elements.byType[t]);
    if (!types.length) return null;
    return {
      key: `l:${layer.key}`, badge: layer.label.slice(0, 4), color: layer.color, label: layer.label, sub: String(st.elements.byLayer[layer.api] ?? 0),
      data: { kind: 'layer', key: layer.key },
      children: types.map(t => ({
        key: `t:${t}`, badge: elementBadge(t), sprite: spriteUrl(t), color: elementColor(t), label: prettyType(t), sub: String(st.elements.byType[t]),
        data: { kind: 'type', type: t },
        loadChildren: async () => (await s.elementsOfType(t)).map(e => elementSpec(e)),
      })),
    };
  }).filter(Boolean);

  const relTypeSpecs = RELATIONSHIP_TYPES.filter(t => st.relationships.byType[t])
    .map(t => ({
      key: `rt:${t}`, icon: '⇢', iconSrc: spriteUrl(t), label: t, sub: String(st.relationships.byType[t]), title: relationshipGlyph(t),
      data: { kind: 'reltype', type: t },
      loadChildren: async () => (await s.relationshipsOfType(t)).map(relationshipSpec).sort((a, b) => a.label.localeCompare(b.label)),
    }));
  if (st.relationships.onRelationships) {
    // BR-6: a cross-type group for relationships that attach to other relationships
    relTypeSpecs.push({
      key: 'rt:@rel', icon: '⤷', label: t('Connected to relationships'), sub: String(st.relationships.onRelationships),
      title: t('Relationships whose source or target is another relationship'),
      data: { kind: 'reltype', type: '@rel' },
      loadChildren: async () => (await s.relationshipsOnRelationships()).map(relationshipSpec).sort((a, b) => a.label.localeCompare(b.label)),
    });
  }

  return [{
    key: 'm', icon: '🗂', label: m.name, sub: m.version ? `v${m.version}` : '', expanded: true,
    data: { kind: 'model', id: m.id },
    children: [
      {
        key: 'folders', icon: '📁', label: t('Folders'), title: t('Organization tree (<organizations>)'),
        sub: st.organizations.folders ? String(st.organizations.folders) : '', data: { kind: 'whole' },
        loadChildren: async () => {
          const { roots } = await s.loadFolders();
          return roots.length ? orgSpecs(roots) : [{ label: t('No folders in this model'), muted: true }];
        },
      },
      { key: 'elements', icon: '◧', label: t('Elements'), sub: String(st.elements.total), children: layerSpecs, data: { kind: 'whole' } },
      { key: 'relationships', icon: '⇢', label: t('Relationships'), sub: String(st.relationships.total), children: relTypeSpecs },
      {
        key: 'views', icon: '🖼', label: t('Views'), sub: String(st.views.total),
        children: viewsSpecs(s.views),
      },
      {
        icon: '🏷', label: t('Property definitions'), data: { kind: 'propdefs' },
        loadChildren: async () => (await api.propertyDefinitions(s.id)).map(p => propertySpec(s, p)),
      },
      { icon: 'ℹ', label: t('Metadata'), data: { kind: 'metadata' } },
    ],
  }];
}

/**
 * The model's views, all directly under Views (2.31.0): those of its source in the model's order, then the created
 * views and recipes by name. Each kind has its icon (🖼, ✎, 📜); who made a created one is in its details.
 */
export function viewsSpecs(views) {
  const source = views.filter(v => !isCreated(v));
  const created = views.filter(isCreated).sort((a, b) => a.name.localeCompare(b.name));
  return [...source, ...created].map(viewSpec).concat((state.store?.liveScripts || []).map(liveScriptSpec));
}

/**
 * 2.35.0 (API 3.26.0): a live recipe template. It makes no views: opened, it lists the diagrams its script makes from
 * the model as it is now, each drawn when chosen.
 */
export function liveScriptSpec(x) {
  return {
    key: `ls:${x.id}`, icon: '🔁', label: x.name, sub: t('live'),
    title: t('Live template: its diagrams are worked out from the model whenever it is opened'),
    data: { kind: 'livescript', id: x.id, name: x.name },
    loadChildren: async () => {
      const r = await api.recipeScripts.expand(state.store.id, x.id);
      if (!r.ok) return [{ label: t('{n} error(s): the model no longer fits the template; open its script', { n: r.errors.length }), muted: true, title: r.errors.map(e => `${e.line}: ${e.message}`).join('\n') }];
      if (!r.recipes.length) return [{ label: t('No diagram: nothing matches now'), muted: true }];
      return r.recipes.map(p => ({
        key: `lr:${x.id}:${p.key}`, icon: '📜', label: p.name, sub: p.element ? prettyType(p.element.type) : '',
        title: [t('Drawn from the model as it is now'), p.documentation || ''].filter(Boolean).join('\n\n'),
        data: { kind: 'liverecipe', scriptId: x.id, recipe: p.recipe, name: p.name },
      }));
    },
  };
}

/**
 * A property definition in the tree, with the values elements give it below: from the API's
 * index (HLP-9), most frequent first, each with the number of elements that have it.
 */
export function propertySpec(s, p) {
  const name = p.name || p.xmiIdentifier;
  const used = s.propertyIndex.get(name);
  const values = [...(used?.valueCounts ?? [])].map(([value, n]) => ({
    key: `pv:${value}`, icon: '=', label: value === '' ? t('(empty)') : value, sub: String(n),
    data: { kind: 'propvalue', name, value },
    title: t('Right-click: only elements where {name} = “{value}”', { name, value }),
  }));
  if (used && used.distinctValues > values.length) {
    values.push({ label: t('… and {n} more values', { n: used.distinctValues - values.length }), muted: true });
  }
  return {
    key: `p:${name}`, icon: '·', label: name, sub: p.dataType, data: { kind: 'property', name },
    title: t('Right-click: colour or label diagrams by this property, filter by it'),
    children: values.length ? values : undefined,
  };
}
