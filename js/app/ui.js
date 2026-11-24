// ArchiMate Browser: Status line, errors, retry and cancellation (EN-2).
// Part of js/app.js until 2026-10-24 (EN-6); app.js wires it to the page.

import { api, ApiError, isConnectionError, MIN_API_VERSION, olderThan } from '../api.js';
import { settings } from '../config.js';
import { t } from '../i18n.js';
import { me, openSettings } from './models.js';
import { openSignIn } from './signin.js';
import { $ } from './state.js';

// ================================================================ render mode

/**
 * RN-1 (2.29.0): the page was opened as `…/?render` by the MCP server to make images of diagrams
 * (js/app/render.js): no model is opened at start, nothing asks questions, and errors are reported as events.
 */
export const RENDER_MODE = new URLSearchParams(location.search).has('render');

// ================================================================ status

export function status(msg, isError = false) {
  const s = $('#status');
  status.last = msg || '';
  s.textContent = msg || '';
  s.classList.toggle('error', isError);
  if (isError && RENDER_MODE) document.dispatchEvent(new CustomEvent('archi-render-error', { detail: String(msg || '') }));
}

export function h(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) e.append(c instanceof Node ? c : String(c));
  return e;
}

export function download(name, content, type) {
  const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }));
  const a = h('a', { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const safeName = s => String(s || 'diagram').replace(/[^\w.-]+/g, '_').slice(0, 80);

// ================================================================ errors, retry, cancellation (EN-2)

/**
 * One cancellable job per slot ('details', 'view', 'search', 'model'):
 * starting a new one aborts the requests of the previous one, so quick clicks
 * neither waste requests nor let a slow, older answer overwrite a newer one.
 */
export const jobs = {};
export function startJob(slot) {
  jobs[slot]?.abort();
  return (jobs[slot] = new AbortController()).signal;
}
export function cancelJob(slot) {
  jobs[slot]?.abort();
  delete jobs[slot];
}
export const may = permission => !me || (me.permissions || []).includes(permission);

export function errorMessage(e) {
  // 2.13.0: the API says why (unknown, revoked, expired, the user disabled); the way on is to sign in
  if (e?.status === 401) return t('The ArchiMate API refused the key: {message} Sign in with your key.', { message: e.message || t('API key missing or invalid.') });
  if (e?.status === 403) return forbiddenText();
  return e?.message || String(e);
}

/** 403: the key is valid, but its role does not allow the request (API-8). */
export function forbiddenText() {
  return me?.role
    ? t('The API key in use has the role “{role}”, which does not allow this. Use another key in Settings.', { role: me.role })
    : t('The API key in use does not allow this. Use another key in Settings.');
}

/**
 * UP-1: this browser needs /api/v2 as API 2.10.0 serves it (MIN_API_VERSION).
 * Returns an error that says so when `health`, the answer of `/health`, shows
 * an older API, else null. An API before 2.0.0 reports no version at all.
 */
export function apiTooOld(health) {
  if (!health || !/\/api\/v2\/?$/.test(settings.apiBase)) return null;
  const vars = { need: MIN_API_VERSION, version: health.version };
  if (!health.version || !(health.apiVersions || []).includes('v2')) {
    return new ApiError(404, 'API_TOO_OLD', t('This browser needs ArchiMate API {need} or later; the API in use is older and does not serve /api/v2.', vars));
  }
  return olderThan(health.version) ? new ApiError(404, 'API_TOO_OLD', t('This browser needs ArchiMate API {need} or later; the API in use is version {version}.', vars)) : null;
}

export const retryOnRestore = new Set(); // { el, retry } of error boxes shown because the API was unreachable

/**
 * Error state of a pane or section: the message, a Retry button and, for
 * 401, Sign in (2.13.0), for 403, Open settings. When the cause was an unreachable API, the retry
 * also runs by itself once the API is back (if the box is still shown).
 */
export function errorBox(e, retry, { compact = false } = {}) {
  const entry = { retry, el: null };
  const box = h('div', { class: 'pane-error' + (compact ? ' compact' : ''), role: 'alert' },
    h('p', {}, errorMessage(e)),
    h('div', { class: 'actions' },
      retry ? h('button', { type: 'button', class: compact ? null : 'primary', onclick: () => { retryOnRestore.delete(entry); retry(); } }, t('Retry')) : null,
      e?.status === 401 ? h('button', { type: 'button', onclick: () => openSignIn() }, t('Sign in…'))
        : e?.status === 403 ? h('button', { type: 'button', onclick: openSettings }, t('Open settings')) : null));
  if (retry && isConnectionError(e)) { entry.el = box; retryOnRestore.add(entry); }
  return box;
}

/** The API-down banner (EN-2), drawn from connection.js's state; the countdown ticks every second. */
export let bannerTick = null;
export function renderBanner(st) {
  const b = $('#api-banner');
  clearInterval(bannerTick);
  bannerTick = null;
  b.hidden = !st.down;
  if (!st.down) return;
  const offline = navigator.onLine === false;
  $('#api-banner-title').textContent = offline ? t('You are offline.') : t('The API is not reachable.');
  $('#api-banner-msg').textContent = offline ? '' : st.message;
  $('#btn-api-retry').disabled = st.checking;
  const next = $('#api-banner-next');
  const tick = () => {
    next.textContent = st.checking ? t('Checking…') : t('Next check in {n} s.', { n: Math.max(0, Math.ceil((st.nextCheck - Date.now()) / 1000)) });
  };
  tick();
  if (!st.checking) bannerTick = setInterval(tick, 1000);
}
