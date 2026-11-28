// Test page (tests/index.html): imports all test files, runs them and shows the
// results. With ?report=1 (run_tests.py) the results are also POSTed to the
// test server. ?filter=<text> runs a subset.

import { run } from './harness.js';

const TEST_FILES = [
  './unit/archimate.test.js', // EN-1: every ElementType/RelationshipType of xmi_oas.json is mapped
  './unit/i18n.test.js',
  './unit/plantuml.test.js',
  './unit/store.test.js',
  './unit/graph.test.js', // phase 3: the API's graph helpers, compared with the browser's own rule code
  './unit/filters.test.js',
  './unit/properties.test.js',
  './unit/impact.test.js',
  './unit/layout.test.js',
  './unit/viewsvg.test.js',
  './unit/scriptlang.test.js', // 2.35.0: colouring and completion of recipe scripts
  './unit/connection.test.js', // EN-2
  './unit/security.test.js', // EN-3
  './unit/refs.test.js', // BR-17
  './unit/version.test.js',
  './unit/a11y.test.js', // EN-4
  './unit/offline.test.js', // 2.20.0: the offline copy's stand-in, answer by answer against the real API
  './unit/viewcontent.test.js', // 2.22.0 (BR-25): created views
  './unit/events.test.js', // 2.26.0 (MU-14): the API's change events
  './smoke/app.test.js',
];

const params = new URLSearchParams(location.search);
const filter = params.get('filter') || '';
document.querySelector('[name=filter]').value = filter;

const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const out = document.querySelector('#results');
const summary = document.querySelector('#summary');

async function main() {
  // the app modules read their settings at import time: start from the defaults, in English
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('archixmi-')) localStorage.removeItem(k);
    localStorage.setItem('archixmi-browser-settings', JSON.stringify({ lang: 'en' }));
  } catch { /* storage unavailable: defaults apply anyway */ }
  const loadErrors = [];
  for (const f of TEST_FILES) {
    try { await import(f); } catch (e) { loadErrors.push({ suite: f, name: 'load', status: 'fail', error: `${e.name}: ${e.message}`, ms: 0 }); }
  }
  loadErrors.forEach(show);
  const res = await run({ filter, onResult: show });
  res.tests.unshift(...loadErrors);
  res.failed += loadErrors.length;
  res.total += loadErrors.length;
  summary.textContent = `${res.passed} passed, ${res.failed} failed, ${res.skipped} skipped (${res.total} tests, ${(res.ms / 1000).toFixed(1)} s)`;
  summary.className = res.failed ? 'fail' : 'pass';
  document.title = `${res.failed ? '✗' : '✓'} ${summary.textContent}`;
  if (params.get('report')) {
    await fetch('/__test/results', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(res) });
  }
}

function show(r) {
  out.insertAdjacentHTML('beforeend', `<div class="r ${r.status}"><span class="s">${r.status.toUpperCase()}</span>`
    + `<span class="suite">${esc(r.suite)} › </span>${esc(r.name)} <span class="suite">(${r.ms} ms)</span>`
    + `${r.error ? `<pre>${esc(r.error)}</pre>` : ''}</div>`);
}

main().catch(async e => {
  summary.textContent = `Runner error: ${e.message}`;
  summary.className = 'fail';
  if (params.get('report')) {
    await fetch('/__test/results', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passed: 0, failed: 1, skipped: 0, total: 1, ms: 0, tests: [{ suite: 'runner', name: 'error', status: 'fail', error: e.stack || e.message, ms: 0 }] }) });
  }
});
