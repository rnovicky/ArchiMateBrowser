// 2.35.0: the recipe script language as the Browser's editor needs it (scripteditor.js): the coloured HTML of a line
// and the words to complete. No page needed (tests/unit/scriptlang.test.js). The tokens follow the API's
// app/services/recipe_script/syntax.py; the language: its RECIPE_SCRIPTS.md.

import { ELEMENT_TYPES, RELATIONSHIP_TYPES, LAYERS } from './archimate.js';
import { VIEWPOINTS } from './filters.js';

export const KEYWORDS = [
  'script', 'defaults', 'diagram', 'for', 'each', 'where', 'max', 'in', 'folder', 'layer', 'and', 'or', 'not', 'name',
  'type', 'contains', 'element', 'neighbourhood', 'impact', 'dependencies', 'of', 'depth', 'incoming', 'outgoing', 'both',
  'via', 'elements', 'paths', 'from', 'to', 'all', 'relationships', 'whole', 'model', 'it', 'hide', 'show', 'only',
  'viewpoint', 'label', 'colour', 'by', 'language', 'nesting', 'on', 'off', 'with', 'assignment', 'groupings', 'layout',
  'compact', 'balanced', 'readable', 'lines', 'orthogonal', 'polyline', 'splines', 'bundle', 'spacing', 'effort',
  'documentation', 'any', 'relationship',
];
const KEYWORD_SET = new Set([...KEYWORDS, 'neighborhood', 'color']);
const TYPES = [...ELEMENT_TYPES, 'Junction', ...RELATIONSHIP_TYPES];
const TYPE_SET = new Set(TYPES.map(x => x.toLowerCase()));
const LAYER_KEYS = LAYERS.map(l => l.key);
// Statements that open a block (the editor indents the next line): the next line is indented under them
export const OPENS_BLOCK = /^(for\s+each\b|diagram\b|defaults\b|neighbou?rhood\b)/i;
const COMPLETE_MAX = 8;

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const span = (cls, text) => `<span class="sh-${cls}">${esc(text)}</span>`;

/** One line as coloured HTML. */
export function highlightLine(line) {
  if (/^\s*#/.test(line)) return span('comment', line);
  let out = '', i = 0;
  while (i < line.length) {
    const ch = line[i], rest = line.slice(i);
    let m;
    if (ch === '#' && (i + 1 === line.length || /[\s#]/.test(line[i + 1]))) { out += span('comment', rest); break; }
    if (ch === '"' || ch === "'" || ch === '“' || ch === '„') {
      const close = { '"': '"', "'": "'", '“': '”', '„': '“' }[ch];
      let j = i + 1;
      while (j < line.length && !(line[j] === close || (close !== "'" && close !== '"' && line[j] === '"'))) j += line[j] === '\\' ? 2 : 1;
      out += span('string', line.slice(i, j + 1));
      i = j + 1;
      continue;
    }
    if ((m = /^@(?:"[^"]*"?|'[^']*'?|[\w.-]*)/.exec(rest))) { out += span('prop', m[0]); i += m[0].length; continue; }
    if ((m = /^#[^\s,()]+/.exec(rest))) { out += span('ref', m[0]); i += m[0].length; continue; }
    if ((m = /^\d+(?:\.\d+)?/.exec(rest))) { out += span('number', m[0]); i += m[0].length; continue; }
    if ((m = /^[\p{L}_][\p{L}\d_-]*/u.exec(rest))) {
      const w = m[0].toLowerCase();
      out += KEYWORD_SET.has(w) ? span('kw', m[0]) : TYPE_SET.has(w) ? span('type', m[0]) : esc(m[0]);
      i += m[0].length;
      continue;
    }
    out += esc(ch);
    i += 1;
  }
  return out;
}

/** What completion offers for the word before the caret (`prefix`), and whether it follows '@'. */
export function completions(prefix, { prop = false, properties = [] } = {}) {
  const low = prefix.toLowerCase();
  if (prop) {
    return properties.filter(p => p.toLowerCase().startsWith(low) && p !== prefix).slice(0, COMPLETE_MAX)
      .map(p => ({ label: `@${p}`, insert: /^[\w.-]+$/.test(p) ? p : `"${p}"` }));
  }
  const viewpoints = Object.entries(VIEWPOINTS).filter(([k]) => k !== 'all').map(([, v]) => v.label);
  const pool = [...KEYWORDS, ...TYPES, ...LAYER_KEYS];
  const words = [...new Set(pool)].filter(w => w.toLowerCase().startsWith(low) && w !== prefix);
  words.sort((a, b) => a.length - b.length || a.localeCompare(b));
  const vps = low.length >= 2 ? viewpoints.filter(v => v.toLowerCase().startsWith(low)).map(v => ({ label: `"${v}"`, insert: `"${v}"` })) : [];
  const room = COMPLETE_MAX - Math.min(vps.length, 3); // viewpoints keep a few places
  return [...words.slice(0, room).map(w => ({ label: w, insert: w })), ...vps].slice(0, COMPLETE_MAX);
}

