import { describe, test, assert } from '../harness.js';
import { t, pluralIndex, lang } from '../../js/i18n.js';
import { CS } from '../../js/i18n-cs.js';

describe('i18n', () => {
  test('the test page runs in English', () => assert.equal(lang, 'en'));

  test('placeholders are filled; unknown ones stay', () => {
    assert.equal(t('Added {name} next to {other}.', { name: 'A', other: 'B' }), 'Added A next to B.');
    assert.equal(t('Hello {who}', {}), 'Hello {who}');
  });

  test('English plurals from "one|other" keys', () => {
    assert.equal(t('{n} element|{n} elements', { n: 1 }), '1 element');
    assert.equal(t('{n} element|{n} elements', { n: 0 }), '0 elements');
    assert.equal(t('{n} element|{n} elements', { n: 7 }), '7 elements');
  });

  test('a context prefix is not shown', () => assert.equal(t('selection::Clear'), 'Clear'));

  test('Czech plural forms: 1 / 2–4 / 0, 5+ and fractions', () => {
    assert.deepEqual([1, 2, 3, 4, 5, 0, 11, 22, 1.5].map(n => pluralIndex(n, 3)), [0, 1, 1, 1, 2, 2, 2, 2, 2]);
    assert.deepEqual([1, 2, 0].map(n => pluralIndex(n, 2)), [0, 1, 1]);
  });

  test('Czech dictionary: plural entries have three forms, placeholders match the English key', () => {
    const ph = s => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
    const bad = [];
    for (const [key, val] of Object.entries(CS)) {
      if (key.startsWith('html.')) continue;
      const forms = Array.isArray(val) ? val : [val];
      if (Array.isArray(val) && val.length !== 3) bad.push(`${key}: ${val.length} forms`);
      if (Array.isArray(val) && !key.includes('|')) bad.push(`${key}: plural entry for a key without "|"`);
      const want = ph(key.split('|').pop());
      for (const f of forms) if (ph(f) !== want) bad.push(`${key}: placeholders {${ph(f)}} vs {${want}}`);
    }
    assert.deepEqual(bad, []);
  });

  test('every t() key in js/*.js has a Czech entry', async () => {
    const files = ['app.js', 'api.js', 'archimate.js', 'config.js', 'elklayout.js', 'explorer.js', 'filters.js', 'impact.js', 'layoutprefs.js',
      'manual.js', 'nesting.js', 'panes.js', 'plantuml.js', 'properties.js', 'store.js', 'tree.js', 'viewsvg.js',
      // EN-6: what was app.js
      'app/basket.js', 'app/details.js', 'app/diagram.js', 'app/menus.js', 'app/models.js', 'app/panels.js',
      'app/reports.js', 'app/routing.js', 'app/shell.js', 'app/state.js', 'app/tabs.js', 'app/treespecs.js', 'app/ui.js',
      'app/actions.js', 'app/history.js', 'app/keys.js', 'app/offline.js', 'app/palette.js', 'app/views.js', 'viewcontent.js', 'app/editing.js', 'app/toolbox.js', 'app/manage.js'];
    const call = /(?<![\w.$])(?:t|tr)\(\s*'((?:[^'\\]|\\.)*)'/g;
    const missing = [];
    for (const f of files) {
      const src = await fetch(`../js/${f}`).then(r => r.text());
      for (const m of src.matchAll(call)) {
        const key = m[1].replace(/\\'/g, "'").replace(/\\n/g, '\n');
        if (!(key in CS)) missing.push(`${f}: ${key}`);
      }
    }
    assert.deepEqual(missing, [], 'add these to js/i18n-cs.js');
  });

  test('every data-i18n key of index.html has a Czech entry', async () => {
    const html = await fetch('../index.html').then(r => r.text());
    const keys = [...html.matchAll(/data-i18n="([^"]+)"/g)].map(m => m[1]);
    assert.ok(keys.length > 0);
    assert.deepEqual(keys.filter(k => !(k in CS)), []);
  });
});
