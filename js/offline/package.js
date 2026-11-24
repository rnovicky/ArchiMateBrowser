// Offline copy (2.20.0): the page of an offline copy, one HTML file that a browser opens from disk
// (file://), without a server: the Browser's own code, stylesheet and markup, ELK, the ArchiMate icons
// and one model's snapshot.
//
// A page opened from disk cannot load its modules from files, fetch, or start a worker from a file.
// So the modules travel in the page, gzipped, and its start script makes a Blob URL of each and an
// import map that names them (`archixmi/js/…`; the relative imports are rewritten to those names);
// modules loaded so stay modules, with their cycles and live bindings. ELK's worker and the icons
// become Blob and data: URLs the same way (window.ARCHIXMI_OFFLINE; archimate.js, elklayout.js). The
// app is started by import() from that script: Chrome runs no inline module script in such a page.
//
// The page is assembled from the files the Browser is served from, at the moment of the export, so a
// copy is always made of the version that made it.
//
// 2.27.0 (BR-24): with a password, the model's data is encrypted in the file (AES-GCM, its key derived from
// the password with PBKDF2-SHA-256), and the page asks for the password before it shows anything. The
// Browser's code stays readable: it is the same for every copy. The page's title then names no model.

const PREFIX = 'archixmi/';

/** `from '…'`, `import '…'`, `import('…')` with a relative specifier. */
const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"\n]+)\2/g;

/** A module's source with its relative imports named for the import map; `found` gets each module named. */
export function rewriteImports(source, path, found) {
  return source.replace(SPECIFIER, (_, head, quote, spec) => {
    const target = new URL(spec, `http://x/${path}`).pathname.slice(1);
    found(target);
    return `${head}${quote}${PREFIX}${target}${quote}`;
  });
}

async function gzipBytes(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function base64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const gzipBase64 = async text => base64(await gzipBytes(text));

// PBKDF2 rounds for the key of a password (OWASP's figure for SHA-256 in 2023): a guess costs as much
const ITERATIONS = 600000;

/** BR-24 (2.27.0): bytes encrypted with a password: { salt, iv, iterations } (base64) and the data, base64. */
export async function seal(bytes, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, material,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  return { meta: { salt: base64(salt), iv: base64(iv), iterations: ITERATIONS }, data: base64(data) };
}

/**
 * The bytes `seal` encrypted, or a rejection for a wrong password. Self-contained: the offline page's start
 * script carries it as text (boot), and the tests call it.
 */
export async function openSealed(data, meta, password) {
  const bytes = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: bytes(meta.salt), iterations: meta.iterations, hash: 'SHA-256' },
    material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(meta.iv) }, key, bytes(data)));
}

function dataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Text inside an inline <script> or <style> must not close it. */
const inline = (text, tag) => text.replace(new RegExp(`</${tag}`, 'gi'), `<\\/${tag}`);
const escapeHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * Runs first in the offline page: unpacks the code and the snapshot, then starts the app. A sealed snapshot
 * (2.27.0) is opened with the password asked for in a form of its own; `openSealed` is package.js's.
 */
function boot(openSealed) {
  const gunzip = async bytes => {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(stream).text());
  };
  const unpack = id => gunzip(Uint8Array.from(atob(document.getElementById(id).textContent), c => c.charCodeAt(0)));
  const ask = (data, meta) => new Promise(resolve => {
    const form = document.createElement('form');
    form.className = 'offline-password';
    form.innerHTML = '<p><strong>This offline copy is protected by a password.</strong></p>'
      + '<label>Password <input type="password" name="password" autocomplete="current-password" autofocus></label> '
      + '<button type="submit">Open</button><p class="offline-password-wrong" hidden>Wrong password.</p>';
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      form.querySelector('button').disabled = true;
      try {
        const bytes = await openSealed(data, meta, form.password.value);
        form.remove();
        resolve(gunzip(bytes));
      } catch {
        form.querySelector('.offline-password-wrong').hidden = false;
        form.querySelector('button').disabled = false;
        form.password.select();
      }
    });
    document.body.prepend(form);
    form.password.focus();
  });
  const snapshotOf = () => {
    const el = document.getElementById('archixmi-snapshot');
    return el.dataset.sealed ? ask(el.textContent.trim(), JSON.parse(el.dataset.sealed)) : unpack('archixmi-snapshot');
  };
  const url = (text, type) => URL.createObjectURL(new Blob([text], { type }));
  (async () => {
    const [bundle, snapshot] = await Promise.all([unpack('archixmi-bundle'), snapshotOf()]);
    const imports = {};
    for (const [path, source] of Object.entries(bundle.modules)) imports[`archixmi/${path}`] = url(source, 'text/javascript');
    const map = document.createElement('script');
    map.type = 'importmap';
    map.textContent = JSON.stringify({ imports });
    document.head.append(map);
    window.ARCHIXMI_OFFLINE = {
      snapshot, sprites: bundle.sprites, spriteFiles: bundle.spriteFiles,
      elkWorkerUrl: url(bundle.elkWorker, 'text/javascript'), madeWith: bundle.version,
    };
    await import('archixmi/js/app.js');
  })().catch(e => {
    const box = document.createElement('div');
    box.className = 'offline-failed';
    box.textContent = `This offline copy could not start in this browser (${e.message}). Open it in a current Chrome or Edge.`;
    document.body.prepend(box);
    console.error(e);
  });
}

/**
 * The offline page of a model, as HTML text. `snapshot`: GET …/snapshot (API 3.14.0). `root`: where the
 * Browser's files are served (its folder). `onProgress(text)` says what it is doing.
 */
export async function offlinePage(snapshot, { root = new URL('../../', import.meta.url), version = '', onProgress = null, password = '' } = {}) {
  const get = async (path, as = 'text') => {
    const res = await fetch(new URL(path, root), { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${path}: ${res.status} ${res.statusText}`);
    return as === 'blob' ? res.blob() : res.text();
  };

  onProgress?.('code');
  const modules = {};
  const todo = ['js/app.js'];
  while (todo.length) {
    const path = todo.pop();
    if (path in modules) continue;
    modules[path] = null; // taken, before its imports are followed
    const source = await get(path);
    modules[path] = rewriteImports(source, path, target => { if (!(target in modules)) todo.push(target); });
  }

  onProgress?.('icons');
  const sprites = JSON.parse(await get('img/sprites/sprites.json'));
  const spriteFiles = {};
  for (const { file } of Object.values(sprites.sprites || {})) {
    if (file && !(file in spriteFiles)) spriteFiles[file] = await dataUrl(await get(`img/sprites/${file}`, 'blob'));
  }

  onProgress?.('page');
  const [css, page, elkApi, elkWorker] = await Promise.all([
    get('css/app.css'), get('index.html'), get('vendor/elk/elk-api.js'), get('vendor/elk/elk-worker.min.js'),
  ]);
  const bundle = await gzipBase64(JSON.stringify({ modules, sprites, spriteFiles, elkWorker, version }));
  const sealed = password ? await seal(await gzipBytes(JSON.stringify(snapshot)), password) : null;
  const data = sealed ? sealed.data : await gzipBase64(JSON.stringify(snapshot));

  // index.html's own markup: its head without the stylesheet and scripts, its body without the scripts
  const head = page.slice(page.indexOf('<head>') + 6, page.indexOf('</head>'))
    .replace(/<link rel="stylesheet"[^>]*>\s*/g, '').replace(/<title>[\s\S]*?<\/title>/, '');
  const body = page.slice(page.indexOf('<body>') + 6, page.indexOf('</body>')).replace(/<script\b[\s\S]*?<\/script>\s*/g, '');
  const title = sealed ? 'ArchiMate model (offline copy, password)' : `${snapshot.model.name} (offline copy)`;
  return `<!doctype html>
<html lang="en">
<head>${head.trimEnd()}
  <title>${escapeHtml(title)}</title>
  <meta name="generator" content="ArchiMate Browser ${escapeHtml(version)}, offline copy (2.20.0)">
  <style>${inline(css, 'style')}</style>
</head>
<body class="offline">${body.trimEnd()}
  <script id="archixmi-bundle" type="application/octet-stream">${bundle}</script>
  <script id="archixmi-snapshot" type="application/octet-stream"${sealed ? ` data-sealed="${escapeHtml(JSON.stringify(sealed.meta))}"` : ''}>${data}</script>
  <script>${inline(elkApi, 'script')}</script>
  <script>(${boot.toString()})(${openSealed.toString()});</script>
</body>
</html>
`;
}
