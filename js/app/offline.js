// ArchiMate Browser: offline copies (2.20.0). "Share as offline copy…" makes one HTML file that shows the
// open model in any desktop browser, read-only and without the API (js/offline/); an offline copy says
// what it is in a banner, and hides what needs the API (the `online-only` elements, css/app.css).

import { api, isOffline, olderThan } from '../api.js';
import { t } from '../i18n.js';
import { offlinePage } from '../offline/package.js';
import { APP_VERSION } from '../version.js';
import { $, state } from './state.js';
import { download, h, safeName, status } from './ui.js';

/** In an offline copy: the banner with the model, its revision, when and by whom it was taken. */
export function setupOffline() {
  if (!isOffline()) return;
  document.body.classList.add('offline');
  const { snapshot } = globalThis.ARCHIXMI_OFFLINE;
  const when = new Date(snapshot.exportedAt);
  const date = Number.isNaN(when.getTime()) ? snapshot.exportedAt
    : when.toLocaleString(document.documentElement.lang || undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const banner = $('#offline-banner');
  const part = partName(snapshot);
  banner.textContent = (part
    ? t('Offline copy of part of “{name}”: {part}. Revision {revision}, taken on {date}. Read-only: changes made since are not in it.',
      { name: snapshot.model.name, part, revision: snapshot.model.revision, date })
    : snapshot.exportedBy
    ? t('Offline copy of “{name}”, revision {revision}, taken on {date} by {who}. Read-only: changes made since are not in it.',
      { name: snapshot.model.name, revision: snapshot.model.revision, date, who: snapshot.exportedBy })
    : t('Offline copy of “{name}”, revision {revision}, taken on {date}. Read-only: changes made since are not in it.',
      { name: snapshot.model.name, revision: snapshot.model.revision, date }));
  banner.hidden = false;
}

/** BR-24 (2.27.0): what part of the model a copy holds (API 3.19.0: `scope`), in words; null for all of it. */
function partName(snapshot) {
  const scope = snapshot.scope;
  if (!scope) return null;
  const parts = [];
  const find = nodes => {
    for (const n of nodes || []) {
      if (n.id === scope.folderId) return n;
      const hit = find(n.children);
      if (hit) return hit;
    }
    return null;
  };
  if (scope.folderId != null) parts.push(t('the folder “{name}”', { name: find(snapshot.organizations)?.label ?? `#${scope.folderId}` }));
  for (const id of scope.viewIds || []) {
    parts.push(t('the view “{name}”', { name: snapshot.views.find(v => v.id === id)?.name ?? `#${id}` }));
  }
  return parts.join(', ');
}

/** The parts of the open model a copy can be made of now: the selected folder, the open view (API 3.19.0). */
function partsOffered() {
  if (!state.apiVersion || olderThan(state.apiVersion, '3.19.0')) return [];
  const s = state.store, parts = [];
  if (state.selection?.kind === 'folder') {
    const label = s.folders?.byId.get(state.selection.id)?.label;
    if (label != null) parts.push({ scope: { folder: state.selection.id }, label: t('The folder “{name}” and what is in it', { name: label }), name: label });
  }
  if (state.diagramDef?.kind === 'view' && s.view(state.diagramDef.id)) {
    const name = s.view(state.diagramDef.id).name;
    parts.push({ scope: { view: state.diagramDef.id }, label: t('The view “{name}” and what it shows', { name }), name });
  }
  return parts;
}

/**
 * BR-24 (2.27.0): what the copy is made of and with, asked before it is made: all of the model or a part
 * (the selected folder, the open view), and a password (optional, typed twice).
 * Resolves to { password, part } (part null: the whole model) or null (cancelled).
 */
export function askOfflineOptions() {
  return new Promise(resolve => {
    const parts = partsOffered();
    const choice = parts.length ? h('fieldset', { class: 'offline-part' }, h('legend', {}, t('What')),
      h('label', { class: 'check' }, h('input', { type: 'radio', name: 'part', value: '', checked: true }), h('span', {}, t('The whole model'))),
      parts.map((p, i) => h('label', { class: 'check' }, h('input', { type: 'radio', name: 'part', value: String(i) }), h('span', {}, p.label)))) : null;
    const pw = h('input', { type: 'password', name: 'password', autocomplete: 'new-password' });
    const again = h('input', { type: 'password', name: 'again', autocomplete: 'new-password' });
    const wrong = h('small', { class: 'warn', hidden: true }, t('The two passwords differ.'));
    const dialog = h('dialog', { id: 'offline-dialog' }, h('form', { method: 'dialog' },
      h('h2', {}, t('Share as offline copy')),
      h('p', { class: 'muted' }, t('One HTML file that shows the model in a browser without the API: read-only, a snapshot of now.')),
      choice,
      h('label', {}, t('Password (optional)'), pw,
        h('small', {}, t('With a password, the model in the file is encrypted, and the copy asks for the password when it is opened. Tell it to the people you give the file to; it cannot be recovered.'))),
      h('label', {}, t('Password again'), again),
      wrong,
      h('menu', {}, h('button', { value: 'cancel', formnovalidate: true }, t('Cancel')),
        h('button', { value: 'ok', class: 'primary' }, t('Make the copy')))));
    dialog.querySelector('form').addEventListener('submit', ev => {
      if (ev.submitter?.value === 'ok' && pw.value !== again.value) { ev.preventDefault(); wrong.hidden = false; again.select(); }
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      const picked = dialog.querySelector('input[name=part]:checked')?.value;
      resolve(dialog.returnValue === 'ok' ? { password: pw.value, part: picked ? parts[Number(picked)] : null } : null);
    }, { once: true });
    document.body.append(dialog);
    dialog.showModal();
  });
}

/** "Share as offline copy…": the open model as one HTML file, downloaded. */
export async function exportOffline() {
  const store = state.store;
  if (!store) return;
  const options = await askOfflineOptions();
  if (!options) return;
  const steps = { code: t('the Browser'), icons: t('the icons'), page: t('the page') };
  try {
    status(t('Making the offline copy: the model…'));
    const snapshot = options.part ? await api.snapshotOf(store.id, options.part.scope) : await api.snapshot(store.id);
    const html = await offlinePage(snapshot, {
      version: APP_VERSION, password: options.password,
      onProgress: step => status(t('Making the offline copy: {what}…', { what: steps[step] || step })),
    });
    const name = `${safeName(`${snapshot.model.name}${options.part ? ` - ${options.part.name}` : ''} offline ${snapshot.exportedAt.slice(0, 10)}`)}.html`;
    download(name, html, 'text/html');
    status(t('Offline copy saved as {name} ({size} MB): it opens in Chrome or Edge, without the API.',
      { name, size: (html.length / 1e6).toFixed(1) }) + (options.password ? ' ' + t('It asks for the password.') : ''));
  } catch (e) {
    console.error(e);
    status(t('The offline copy could not be made: {message}', { message: e.message }), true);
  }
}
