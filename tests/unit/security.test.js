// EN-3: security headers of serve.py (the test server reuses its handler) and API key storage.

import { describe, test, assert } from '../harness.js';
import { settings, saveSettings, migrateToV2, DEFAULTS } from '../../js/config.js';

const SETTINGS = 'archixmi-browser-settings';
const SESSION_KEY = 'archixmi-browser-api-key';

describe('settings: from /api/v1 to /api/v2 (UP-1)', () => {
  const LAYOUTS = 'archixmi-manual-layouts';
  const keep = [SETTINGS, LAYOUTS];
  const withStorage = fn => {
    const before = keep.map(k => [k, localStorage.getItem(k)]);
    try { fn(); } finally {
      for (const [k, v] of before) { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); }
      for (const k of Object.keys(localStorage)) if (k.startsWith('archixmi-basket:') && k.includes('mig-test')) localStorage.removeItem(k);
    }
  };

  test('the default base is /api/v2', () => assert.equal(DEFAULTS.apiBase, '/api/v2'));

  test('a stored /api/v1 base moves to /api/v2, and the baskets and manual layouts stored under it follow', () => withStorage(() => {
    localStorage.setItem(SETTINGS, JSON.stringify({ lang: 'en', apiBase: 'http://host:8000/api/v1' }));
    localStorage.setItem('archixmi-basket:http://host:8000/api/v1:mig-test', '["id-a"]');
    localStorage.setItem(LAYOUTS, JSON.stringify({ 'http://host:8000/api/v1|mig-test|nb~1~6': { t: 1 }, 'other|x': { t: 2 } }));
    assert.equal(migrateToV2().apiBase, 'http://host:8000/api/v2');
    assert.equal(JSON.parse(localStorage.getItem(SETTINGS)).apiBase, 'http://host:8000/api/v2', 'saved, so it happens once');
    assert.equal(localStorage.getItem('archixmi-basket:http://host:8000/api/v2:mig-test'), '["id-a"]');
    assert.equal(localStorage.getItem('archixmi-basket:http://host:8000/api/v1:mig-test'), null);
    assert.deepEqual(Object.keys(JSON.parse(localStorage.getItem(LAYOUTS))), ['http://host:8000/api/v2|mig-test|nb~1~6', 'other|x']);
  }));

  test('nothing stored: the old default base is assumed for baskets; another base is left alone', () => withStorage(() => {
    localStorage.setItem(SETTINGS, JSON.stringify({ lang: 'en' }));
    localStorage.setItem('archixmi-basket:/api/v1:mig-test', '["id-b"]');
    assert.equal(migrateToV2().apiBase, '/api/v2');
    assert.equal(localStorage.getItem('archixmi-basket:/api/v2:mig-test'), '["id-b"]');
    localStorage.setItem(SETTINGS, JSON.stringify({ lang: 'en', apiBase: 'https://example.org/custom' }));
    assert.equal(migrateToV2().apiBase, 'https://example.org/custom');
    localStorage.setItem(SETTINGS, JSON.stringify({ lang: 'en', apiBase: '/api/v2' }));
    assert.equal(migrateToV2().apiBase, '/api/v2');
  }));
});

describe('security', () => {
  test('the app is served with a strict Content-Security-Policy and related headers', async () => {
    const res = await fetch('../index.html');
    const csp = res.headers.get('Content-Security-Policy') || '';
    const dir = Object.fromEntries(csp.split(';').map(d => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
    assert.deepEqual(dir['script-src'], ["'self'"], 'scripts only from this server: no inline code, no eval');
    assert.deepEqual(dir['object-src'], ["'none'"]);
    assert.deepEqual(dir['frame-ancestors'], ["'self'"]);
    assert.includes(dir['connect-src'], 'https://www.plantuml.com', 'the default PlantUML server');
    assert.includes(dir['img-src'], 'blob:', 'PNG export');
    assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(res.headers.get('Referrer-Policy'), 'no-referrer');
  });

  test('/__proxy/info tells the app which origins the policy allows', async () => {
    const info = await fetch('/__proxy/info').then(r => r.json());
    assert.deepEqual(info.csp, { allow: ['https://www.plantuml.com'] });
  });

  test('API key: session storage only unless "Remember" is ticked', () => {
    const before = { apiKey: settings.apiKey, apiKeyRemember: settings.apiKeyRemember };
    try {
      saveSettings({ apiKey: 'k-session', apiKeyRemember: false });
      assert.equal(JSON.parse(localStorage.getItem(SETTINGS)).apiKey, '', 'not in localStorage');
      assert.equal(sessionStorage.getItem(SESSION_KEY), 'k-session');
      assert.equal(settings.apiKey, 'k-session', 'still used on this page');
      saveSettings({ apiKey: 'k-remembered', apiKeyRemember: true });
      assert.equal(JSON.parse(localStorage.getItem(SETTINGS)).apiKey, 'k-remembered');
      assert.equal(sessionStorage.getItem(SESSION_KEY), null);
    } finally {
      saveSettings(before);
      sessionStorage.removeItem(SESSION_KEY);
    }
  });
});
