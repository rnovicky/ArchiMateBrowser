// API reachability (EN-2). api.js reports the outcome of every request; a
// network failure or a gateway error (502/503/504, e.g. serve.py's proxy when
// the API is down) marks the API as down. While down, `/health` is polled with
// a growing interval; the first good answer (or any successful request) marks
// it up again and notifies the listeners, so panes can retry what failed.
// `/health` is a real check: the API answers 503 there while its database is
// down (BL-6), so "healthy" means that requests for data will work.
// No DOM here: the app draws the banner from the state it is given.

const FIRST_DELAY = 3000;
const MAX_DELAY = 30000;

let probe = null;
let down = false;
let message = '';
let delay = FIRST_DELAY;
let timer = null;
let nextCheck = 0;
let checking = false;
const changeListeners = new Set();
const restoreListeners = new Set();

/** True for errors that mean "the API (or the network) is not reachable", as opposed to a refused request. */
export function isConnectionError(e) {
  return !!e && !isAbort(e) && (e.status === 0 || e.status === 502 || e.status === 503 || e.status === 504);
}

/** True for a request cancelled with an AbortController (EN-2): never shown as an error. */
export function isAbort(e) {
  return e?.name === 'AbortError' || e?.code === 'ABORTED';
}

/** Current state: { down, message, nextCheck (ms timestamp), checking }. */
export function connectionState() {
  return { down, message, nextCheck, checking };
}

/** probe: async () => anything (throws when the API is not healthy), usually api.health. */
export function initConnection({ probe: p }) {
  probe = p;
  window.addEventListener('offline', () => markDown(null));
  window.addEventListener('online', () => { if (down) checkNow(); });
}

/** fn(state) on every change of the state (also each poll). Returns an unsubscribe function. */
export function onConnectionChange(fn) {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

/** fn() once the API is reachable again after being down. */
export function onRestored(fn) {
  restoreListeners.add(fn);
  return () => restoreListeners.delete(fn);
}

/** Called by api.js after every request: an error object, or null for success. */
export function reportResult(err) {
  if (err == null) { if (down) markUp(); return; }
  if (isConnectionError(err)) markDown(err.message);
}

/** Check `/health` now (the banner's "Retry now"). */
export async function checkNow() {
  if (!probe || checking) return;
  clearTimeout(timer);
  checking = true;
  emit();
  let ok = false;
  try { await probe(); ok = true; } catch { /* still down */ }
  checking = false;
  if (ok) { markUp(); return; }
  if (down) schedule(Math.min(delay * 2, MAX_DELAY));
  else emit();
}

function markDown(msg) {
  const wasDown = down;
  down = true;
  if (msg != null || !message) message = msg || '';
  if (!wasDown) {
    schedule(FIRST_DELAY);
  } else {
    emit();
  }
}

function markUp() {
  if (!down) return;
  down = false;
  message = '';
  clearTimeout(timer);
  timer = null;
  nextCheck = 0;
  emit();
  for (const fn of [...restoreListeners]) {
    try { fn(); } catch (e) { console.error(e); }
  }
}

function schedule(ms) {
  delay = ms;
  clearTimeout(timer);
  nextCheck = Date.now() + ms;
  timer = setTimeout(checkNow, ms);
  emit();
}

function emit() {
  const st = connectionState();
  for (const fn of [...changeListeners]) {
    try { fn(st); } catch (e) { console.error(e); }
  }
}

/** Test hook: back to the initial state (no timers, not down). */
export function resetConnection() {
  clearTimeout(timer);
  timer = null;
  down = false;
  message = '';
  delay = FIRST_DELAY;
  nextCheck = 0;
  checking = false;
  emit();
}
