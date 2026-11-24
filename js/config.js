// User settings, persisted in localStorage (per browser).

const KEY = 'archixmi-browser-settings';

export const DEFAULTS = {
  // Relative URL = same origin; the bundled server/serve.py proxies /api/* to the API.
  apiBase: '/api/v2',
  apiKey: '',
  apiKeyRemember: false, // EN-3: false = the key lives in sessionStorage only (gone when the browser closes)
  changeCheckSeconds: 15, // MU-13 (2.14.0): how often the open model is checked for changes made elsewhere; 0 = never
  plantumlServer: 'https://www.plantuml.com/plantuml',
  plantumlDirection: 'TB', // TB | LR
  plantumlLegend: false, // PU-5 (2.27.0): a legend of the element types in PlantUML diagrams
  plantumlSketch: false, // PU-5 (2.27.0): PlantUML diagrams drawn as by hand
  neighbourDepth: 1,
  wholeModelMax: 300, // 2.28.0: a diagram of the whole model is offered up to this many elements
  filter: '', // DiagramFilter.encode() of the last used diagram filter
  neighbourDirection: 'both', // both | out | in
  propertyOptions: '', // PropertyOptions.encode() of the last used property display options
  impact: null, // { direction, depth, types } of the impact-analysis panel (BR-12)
  diagramTab: 'layout', // layout (native Diagram, default) | plantuml | source
  nestGenerated: false, // LV-5: draw Composition/Aggregation as nested boxes in generated diagrams
  nestAssignment: false, // LV-5: … and Assignment too
  nestGroupingOnly: false, // only a Grouping contains others (API 2.9.0, nesting.containerTypes)
  layoutPrefs: '', // LV-6: LayoutPrefs.encode() of the Layout panel ('' = Balanced preset)
  minimap: true, // LV-3: overview map in the Diagram tab while zoomed in
  savedFilters: [], // CM-7: [{ name, code: DiagramFilter.encode() }] offered after the viewpoint presets
  basketSort: 'name', // CM-8: basket chips by name | type | added
  lang: '', // EN-7: UI language en | cs ('' = the browser's language if supported, else English)
  paneWidths: null, // EN-7: { tree, details } in px (null = default widths)
  paneClosed: null, // 2.28.0: { tree, details }: true for a closed side pane
};

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

// UP-1: the browser needs /api/v2. A base URL saved while it used /api/v1 is
// moved over, and with it what is stored per API (baskets, manual layouts),
// so nothing the user saved is lost. Without a stored base the default of
// that time, /api/v1, is what the stored baskets and layouts are filed under.
const V1 = /\/api\/v1\/?$/;
const BASKET = 'archixmi-basket:';
const LAYOUTS = 'archixmi-manual-layouts';

/** Returns the stored settings, moved from /api/v1 to /api/v2 if needed (exported for the tests). */
export function migrateToV2() {
  const s = read();
  const old = s.apiBase ?? '/api/v1';
  if (typeof old !== 'string' || !V1.test(old)) return s;
  const base = old.replace(V1, '/api/v2');
  const hadBase = s.apiBase != null;
  s.apiBase = base;
  try {
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith(`${BASKET}${old}:`)) continue;
      const moved = `${BASKET}${base}:${k.slice(BASKET.length + old.length + 1)}`;
      if (localStorage.getItem(moved) == null) localStorage.setItem(moved, localStorage.getItem(k));
      localStorage.removeItem(k);
    }
    const layouts = JSON.parse(localStorage.getItem(LAYOUTS) || 'null');
    if (layouts && Object.keys(layouts).some(k => k.startsWith(`${old}|`))) {
      const moved = Object.entries(layouts).map(([k, v]) => [k.startsWith(`${old}|`) ? base + k.slice(old.length) : k, v]);
      localStorage.setItem(LAYOUTS, JSON.stringify(Object.fromEntries(moved)));
    }
    if (hadBase) localStorage.setItem(KEY, JSON.stringify(s));
  } catch { /* storage unavailable: the new base still applies to this page load */ }
  return s;
}

// EN-3: an API key typed into Settings is kept in sessionStorage unless
// "Remember" is ticked, so it does not stay on disk after the browser closes.
// (Best of all is no key in the browser: serve.py injects it.)
const SESSION_KEY = 'archixmi-browser-api-key';

function sessionKey(value) {
  try {
    if (value === undefined) return sessionStorage.getItem(SESSION_KEY) || '';
    if (value) sessionStorage.setItem(SESSION_KEY, value);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch { /* storage unavailable */ }
  return value;
}

function stored() {
  const s = migrateToV2();
  if (s.apiKeyRemember === undefined) s.apiKeyRemember = !!s.apiKey; // a key saved before EN-3 stays remembered
  if (!s.apiKeyRemember) s.apiKey = sessionKey();
  return s;
}

export const settings = { ...DEFAULTS, ...stored() };

export function saveSettings(patch) {
  Object.assign(settings, patch);
  const persisted = { ...settings };
  if (!settings.apiKeyRemember) {
    sessionKey(settings.apiKey || '');
    persisted.apiKey = '';
  } else {
    sessionKey('');
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(persisted));
  } catch {
    /* storage unavailable: settings live for this page load only */
  }
}
