// ArchiMate Browser: render mode (RN-1, 2.29.0), for the MCP server's images of diagrams.
//
// The MCP server's diagram_image tool starts a Browser server of its own and opens `…/?render` in a
// browser without a window (see the MCP server's app/render.py). The page then opens no model by itself
// and offers window.archiRender:
//
//   await archiRender.draw(link, { direction })  draws the diagram of a Browser link (or its #hash):
//                                                 { title, width, height, info }; throws with the reason
//   archiRender.svg()                             the diagram drawn as a standalone SVG (Download .svg)
//   await archiRender.png(scale)                  … as PNG: { base64, width, height, scale } (Download .png)
//
// Messages are for the MCP server, so they are in English. The drawing is the Browser's own: a stored view
// as it is stored, a generated diagram with the filters, nesting and layout options of the link.

import { api } from '../api.js';
import { settings, saveSettings } from '../config.js';
import { LayoutPrefs } from '../layoutprefs.js';
import { svgToPng, svgToString } from '../viewsvg.js';
import { APP_VERSION } from '../version.js';
import { openModel } from './models.js';
import { setLayoutPrefs } from './panels.js';
import { applyHash, modelsOfLink, resolveHash } from './routing.js';
import { state } from './state.js';
import { apiTooOld, errorMessage } from './ui.js';

/** After the drawing appears, how long it must stay the last one (an explorer's +N counts draw it again). */
const SETTLE_MS = 300;

let busy = null; // the draw() running: one at a time

/** The models of the API and its version (as loadModels() gets them, without opening one). */
async function connect() {
  const [models, health] = await Promise.all([api.listModels(), api.health().catch(() => null)]);
  const old = apiTooOld(health);
  if (old) throw old;
  state.apiVersion = health?.version || null;
  state.models = models;
  return models;
}

/** Resolves when a diagram has been drawn and stayed for SETTLE_MS; rejects with the first error. */
function waitForDrawing() {
  let done, fail, timer = null;
  const promise = new Promise((resolve, reject) => { done = resolve; fail = reject; });
  const drawn = () => { clearTimeout(timer); timer = setTimeout(done, SETTLE_MS); };
  const failed = ev => fail(new Error(ev.detail || 'The diagram could not be drawn.'));
  document.addEventListener('archi-render-drawn', drawn);
  document.addEventListener('archi-render-error', failed);
  const stop = () => {
    clearTimeout(timer);
    document.removeEventListener('archi-render-drawn', drawn);
    document.removeEventListener('archi-render-error', failed);
  };
  return { promise: promise.finally(stop), stop };
}

/** The parameters of a link's hash: a whole URL, '#model=…' or 'model=…'. */
function hashOf(link) {
  const text = String(link || '');
  return Object.fromEntries(new URLSearchParams(text.includes('#') ? text.slice(text.indexOf('#') + 1) : text));
}

async function drawLink(link, { direction = null } = {}) {
  const hash = hashOf(link);
  if (!hash.model) throw new Error('The link names no model (model=).');
  if (!hash.d && !hash.view) throw new Error('The link names no diagram (d= or view=).');
  if (direction && !['TB', 'LR'].includes(direction)) throw new Error('direction is TB or LR.');

  // the list again every time: a model made or changed since the last image is found as it is now
  const models = await connect();
  const found = modelsOfLink(hash.model, models);
  if (!found.length) throw new Error(`No model ${hash.model} in the API.`);
  if (found.length > 1) throw new Error(`${found.length} models share the identifier ${hash.model}: name the model by its id.`);
  const model = found[0];

  // what a link leaves out is the default, not what an earlier image used
  saveSettings({ plantumlDirection: direction || 'TB' });
  if (!hash.lo && !hash.m && state.layoutPrefs.encode() !== '') setLayoutPrefs(LayoutPrefs.decode(''), { rerender: false });
  if (hash.d && !/^[0-4]$/.test(hash.n || '')) hash.n = '0';

  const wait = waitForDrawing();
  try {
    // opened again after a change (another revision), so that the image shows the model as it is
    if (state.store?.id !== model.id || state.store.model.revision !== model.revision) {
      history.replaceState(null, '', '#model=' + encodeURIComponent(hash.model)); // openModel() reads the hash
      await openModel(model, { model: hash.model });
      if (state.store?.id !== model.id) throw new Error(`The model ${model.name} could not be opened.`);
    }
    const resolved = await resolveHash(hash);
    if ((hash.d && !resolved.d) || (hash.view && !resolved.view)) throw new Error('What the link draws is not in the model.');
    applyHash(resolved);
    await wait.promise;
  } catch (e) {
    wait.stop();
    throw e instanceof Error ? e : new Error(errorMessage(e));
  }
  if (!state.layout) throw new Error('Nothing was drawn.');
  const b = state.layout.bounds();
  return { title: state.diagram?.title || '', width: Math.ceil(b.w), height: Math.ceil(b.h), info: state.doc.info || '' };
}

/** Draw a link's diagram; one at a time (a second call waits for the first). */
async function draw(link, options = {}) {
  while (busy) await busy.catch(() => {});
  busy = drawLink(link, options);
  try {
    return await busy;
  } finally {
    busy = null;
  }
}

function svg() {
  if (!state.layout) throw new Error('No diagram has been drawn.');
  return svgToString(state.layout.svg, { bounds: state.layout.bounds() });
}

async function png(scale = 2) {
  if (!state.layout) throw new Error('No diagram has been drawn.');
  const out = await svgToPng(state.layout.svg, { bounds: state.layout.bounds(), scale: Math.max(0.1, Math.min(4, Number(scale) || 2)) });
  const bytes = new Uint8Array(await out.blob.arrayBuffer());
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { base64: btoa(text), width: out.width, height: out.height, scale: out.scale };
}

/** Offer window.archiRender; the page says it is ready with <html data-render="ready">. */
export function installRender() {
  window.archiRender = Object.freeze({ version: APP_VERSION, draw, svg, png });
  document.documentElement.dataset.render = 'ready';
  document.title = `ArchiMate Browser ${APP_VERSION} (render mode)`;
  if (settings.diagramTab !== 'layout') saveSettings({ diagramTab: 'layout' });
}
