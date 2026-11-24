// The browser's version number (2.7.0 onwards): js/version.js and CHANGELOG.md agree.

import { describe, test, assert } from '../harness.js';
import { APP_VERSION } from '../../js/version.js';

describe('version', () => {
  test('is a version number', () => {
    assert.ok(/^\d+\.\d+\.\d+$/.test(APP_VERSION), APP_VERSION);
  });

  test('is the first release in CHANGELOG.md', async () => {
    const changelog = await fetch('/CHANGELOG.md').then(r => r.text());
    const first = changelog.split(/\r?\n/).find(line => line.startsWith('## '));
    assert.equal(first?.slice(3).split(' ')[0], APP_VERSION);
  });
});
