// UI translation (EN-7): English source strings are the keys; other languages
// map them in a dictionary (js/i18n-cs.js). Missing entries fall back to English.
//
//   t('Diagram of basket')
//   t('Added {name} next to {other}.', { name, other })      placeholders
//   t('{n} element|{n} elements', { n })                       plural: English "one|other";
//                                                               a Czech entry is [one, few (2–4), many]
//   t('selection::Clear')                                      context prefix: same English word,
//                                                               different translation (shown without the prefix)
//
// Model content (element, relationship, view and folder names, property values)
// is never translated, nor are ArchiMate concept names (element/relationship
// types, layers, viewpoints), which Czech EA practice keeps in English.

import { settings } from './config.js';
import { CS } from './i18n-cs.js';

export const LANGUAGES = { en: 'English', cs: 'Čeština' };
const DICTIONARIES = { cs: CS };

/** The UI language: the setting, or (empty setting) the browser's language if supported. */
export const lang = (() => {
  const want = settings.lang || (navigator.language || 'en').slice(0, 2).toLowerCase();
  return LANGUAGES[want] ? want : 'en';
})();
document.documentElement.lang = lang;

const dict = DICTIONARIES[lang] || null;

/** Plural form index: English 0 = one, 1 = other; Czech 0 = 1, 1 = 2–4, 2 = 0 / 5+ / fractions. */
export function pluralIndex(n, forms) {
  const x = Math.abs(Number(n));
  if (forms === 2) return x === 1 ? 0 : 1;
  if (x === 1) return 0;
  if (Number.isInteger(x) && x >= 2 && x <= 4) return 1;
  return 2;
}

/** Translate `text` (an English source string) and fill `{placeholders}` from `vars`. */
export function t(text, vars = null) {
  let s = dict?.[text];
  if (Array.isArray(s)) s = s[Math.min(s.length - 1, pluralIndex(vars?.n, s.length))];
  if (s == null) {
    s = text.replace(/^[\w-]+::/, ''); // a context prefix ('selection::Clear') only disambiguates the key
    if (s.includes('|') && vars && 'n' in vars) s = s.split('|')[pluralIndex(vars.n, 2)] ?? s;
  }
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}

/**
 * Translate the static page (index.html) once at start-up: text nodes and the
 * title / placeholder / aria-label attributes whose whole (trimmed) text is a
 * dictionary key. Safe there because the static page holds no model content.
 */
export function localizeStatic(root = document.body) {
  if (!dict) return;
  document.title = t(document.title);
  // sentences with inline markup: data-i18n="<key>" replaces the element's HTML (dictionary text is trusted)
  for (const el of root.querySelectorAll('[data-i18n]')) {
    const v = dict[el.dataset.i18n];
    if (typeof v === 'string') el.innerHTML = v;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const raw = n.nodeValue, key = raw.trim().replace(/\s+/g, ' ');
    if (key && typeof dict[key] === 'string') n.nodeValue = raw.replace(raw.trim(), dict[key]);
  }
  for (const el of root.querySelectorAll('[title], [placeholder], [aria-label]')) {
    for (const a of ['title', 'placeholder', 'aria-label']) {
      const v = el.getAttribute(a)?.trim().replace(/\s+/g, ' ');
      if (v && typeof dict[v] === 'string') el.setAttribute(a, dict[v]);
    }
  }
}
