// Layout options of generated diagrams (LV-6): presets, spacing and ELK
// strategies, editable in the Layout panel and carried in diagram links (`lo=`).

import { t } from './i18n.js';

export const PRESETS = {
  compact: { label: t('Compact'), spacing: 0.6, thoroughness: 7, title: t('Tight spacing: more fits on screen') },
  balanced: { label: t('Balanced'), spacing: 1, thoroughness: 7, title: t('Default spacing') },
  readable: { label: t('Readable'), spacing: 1.6, thoroughness: 20, title: t('Generous spacing and more effort on fewer crossings') },
};

/** Choices of the panel's selects; 'auto' = size-dependent defaults of elklayout.js. */
export const LAYERING = {
  auto: t('Auto (bounded width up to 150 elements)'),
  COFFMAN_GRAHAM: t('Bounded width (Coffman-Graham)'),
  NETWORK_SIMPLEX: t('Shortest edges (network simplex)'),
  LONGEST_PATH: t('Longest path (fewest layers)'),
};
export const PLACEMENT = {
  auto: t('Auto (by size)'),
  NETWORK_SIMPLEX: t('Straight edges (network simplex)'),
  BRANDES_KOEPF: t('Balanced (Brandes-Köpf)'),
  LINEAR_SEGMENTS: t('Linear segments (fast)'),
};
export const ROUTING = {
  ORTHOGONAL: t('Orthogonal'),
  POLYLINE: t('Polyline'),
  SPLINES: t('Curved (splines)'),
};

const CODES = { // short URL codes
  layering: { auto: 'a', COFFMAN_GRAHAM: 'c', NETWORK_SIMPLEX: 'n', LONGEST_PATH: 'l' },
  placement: { auto: 'a', NETWORK_SIMPLEX: 'n', BRANDES_KOEPF: 'b', LINEAR_SEGMENTS: 'l' },
  routing: { ORTHOGONAL: 'o', POLYLINE: 'p', SPLINES: 's' },
};
const decodeCode = (table, c, dflt) => Object.keys(table).find(k => table[k] === c) ?? dflt;

const clampSpacing = v => Math.max(0.4, Math.min(2.5, Math.round((Number(v) || 1) * 10) / 10));

export class LayoutPrefs {
  constructor({ spacing = 1, thoroughness = 7, layering = 'auto', placement = 'auto', routing = 'ORTHOGONAL', hubs = true } = {}) {
    this.spacing = clampSpacing(spacing);
    this.thoroughness = Math.max(1, Math.min(50, Math.round(Number(thoroughness) || 7)));
    this.layering = LAYERING[layering] ? layering : 'auto';
    this.placement = PLACEMENT[placement] ? placement : 'auto';
    this.routing = ROUTING[routing] ? routing : 'ORTHOGONAL';
    this.hubs = hubs !== false;
  }

  with(patch) { return new LayoutPrefs({ ...this, ...patch }); }

  /** Preset whose values all match, or null (= custom). */
  preset() {
    const rest = this.layering === 'auto' && this.placement === 'auto' && this.routing === 'ORTHOGONAL' && this.hubs;
    if (!rest) return null;
    return Object.keys(PRESETS).find(k => PRESETS[k].spacing === this.spacing && PRESETS[k].thoroughness === this.thoroughness) || null;
  }

  static fromPreset(key) {
    const p = PRESETS[key] || PRESETS.balanced;
    return new LayoutPrefs({ spacing: p.spacing, thoroughness: p.thoroughness });
  }

  isDefault() { return this.preset() === 'balanced'; }

  describe() {
    const p = this.preset();
    return p ? PRESETS[p].label : t('Custom');
  }

  /** e.g. "s1.6_t20_la_pa_ro_h1"; '' for the defaults. */
  encode() {
    if (this.isDefault()) return '';
    return [`s${this.spacing}`, `t${this.thoroughness}`, `l${CODES.layering[this.layering]}`, `p${CODES.placement[this.placement]}`,
      `r${CODES.routing[this.routing]}`, `h${this.hubs ? 1 : 0}`].join('_');
  }

  static decode(str) {
    const o = {};
    for (const part of String(str || '').split('_')) {
      const k = part[0], v = part.slice(1);
      if (k === 's') o.spacing = Number(v);
      if (k === 't') o.thoroughness = Number(v);
      if (k === 'l') o.layering = decodeCode(CODES.layering, v, 'auto');
      if (k === 'p') o.placement = decodeCode(CODES.placement, v, 'auto');
      if (k === 'r') o.routing = decodeCode(CODES.routing, v, 'ORTHOGONAL');
      if (k === 'h') o.hubs = v !== '0';
    }
    return new LayoutPrefs(o);
  }
}
