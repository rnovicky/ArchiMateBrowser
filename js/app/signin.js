// ArchiMate Browser: signing in with one's own API key, and who is signed in (MU-4, 2.13.0).
// The key is the one of Settings → Connection; this is the shorter way to it.

import { api } from '../api.js';
import { settings, saveSettings } from '../config.js';
import { t } from '../i18n.js';
import { loadModels, me } from './models.js';
import { $ } from './state.js';
import { errorMessage, status } from './ui.js';

const ROLE = { reader: () => t('reader'), editor: () => t('editor'), admin: () => t('admin') };

/** The top bar's button: who is signed in, or *Sign in*; its menu says with which key. */
export function updateWho() {
  const button = $('#btn-who');
  const signedOut = !me;
  const who = me ? me.displayName || me.name : '';
  const role = me ? (ROLE[me.role]?.() ?? me.role) : '';
  button.textContent = signedOut ? t('Sign in') : `${who} (${role})`;
  button.classList.toggle('signed-out', signedOut);
  $('#who-text').textContent = signedOut ? t('Not signed in.')
    : settings.apiKey
      ? (me.keyLabel ? t('Signed in as {name} ({role}) with the key “{label}”.', { name: who, role, label: me.keyLabel })
        : t('Signed in as {name} ({role}).', { name: who, role }))
      : t('Working with the key of the server ({name}, {role}). Sign in to work as yourself.', { name: who, role });
  $('#btn-signout').hidden = !settings.apiKey;
  $('#btn-signin').textContent = settings.apiKey ? t('Sign in with another key…') : t('Sign in…');
}

/** The sign-in dialog; `why` is shown above the field (e.g. why the API refused the key). */
export function openSignIn(why = '') {
  const dialog = $('#signin-dialog');
  if (dialog.open) return;
  const form = $('#signin-form');
  form.reset();
  form.remember.checked = !!settings.apiKeyRemember;
  $('#signin-why').textContent = why;
  $('#signin-why').hidden = !why;
  const out = $('#signin-result');
  out.textContent = '';
  out.className = 'dialog-result';
  dialog.showModal();
  form.key.focus();
}

async function signIn(ev) {
  if (ev.submitter?.value === 'cancel') return; // Cancel closes the dialog as usual
  ev.preventDefault();
  const form = $('#signin-form');
  const key = form.key.value.trim();
  if (!key) return;
  const before = { apiKey: settings.apiKey, apiKeyRemember: settings.apiKeyRemember };
  const out = $('#signin-result');
  $('#btn-signin-run').disabled = true;
  saveSettings({ apiKey: key, apiKeyRemember: form.remember.checked });
  try {
    const who = await api.me();
    $('#signin-dialog').close('ok');
    status(t('Signed in as {name}.', { name: who.displayName || who.name }));
    await loadModels();
  } catch (e) {
    saveSettings(before); // the key that did not work is not kept
    out.className = 'dialog-result error';
    out.textContent = errorMessage(e);
  } finally {
    $('#btn-signin-run').disabled = false;
  }
}

export async function signOut() {
  saveSettings({ apiKey: '' });
  status(t('Signed out.'));
  await loadModels();
}

/** Wires the dialog and the menu's buttons (once, from app.js). */
export function setupSignIn() {
  $('#signin-form').addEventListener('submit', signIn);
  $('#btn-signin').addEventListener('click', () => openSignIn());
  $('#btn-signout').addEventListener('click', () => signOut());
}
