// BR-17: XMI identifiers as tokens of links and stored layouts (js/refs.js), and the API's
// look-up of them (BL-35).
import { describe, test, assert } from '../harness.js';
import { escapeRef, unescapeRef, isId, tokenFor, isPath, pathToken, labelsOf } from '../../js/refs.js';
import { api } from '../../js/api.js';
import { M, E, R, V, F, SYN } from './fixture.js';

describe('refs', () => {
  test('Archi identifiers stay readable; other characters are escaped and come back', () => {
    assert.equal(escapeRef('id-3f2a9c'), 'id-3f2a9c');
    for (const x of ['a.b_c~d!e', 'with space', 'Účtování', 'x*y', 'id-é-ü-€', '_under', 'semi;colon%']) {
      const token = escapeRef(x);
      assert.ok(/^[A-Za-z0-9*-]+$/.test(token), `token of ${x}: ${token}`);
      assert.equal(unescapeRef(token), x);
    }
    assert.equal(escapeRef('a.b'), 'a*2Eb');
  });

  test('a token of digits is an id; an identifier of digits is written as the id', () => {
    assert.equal(isId('123'), true);
    assert.equal(isId('id-1'), false);
    assert.equal(isId('12a'), false);
    assert.equal(tokenFor(5, 'id-e5'), 'id-e5');
    assert.equal(tokenFor(5, '777'), '5', 'digits would read as an id');
    assert.equal(tokenFor(5, null), '5');
    assert.equal(tokenFor(5, ''), '5');
  });

  test('the API turns identifiers of every kind into ids (BL-35)', async () => {
    const res = await api.resolve(M, { xmiIdentifiers: ['id-e6', 'id-r101', 'id-v1', 'nope'] });
    assert.deepEqual(res.items, {
      'id-e6': { kind: 'element', id: E.erp },
      'id-r101': { kind: 'relationship', id: R(101) },
      'id-v1': { kind: 'view', id: V(1) },
    });
    assert.deepEqual(res.notFound, ['nope']);
    const other = await api.resolve(SYN.model, { xmiIdentifiers: ['id-e6', 'app-erp'] });
    assert.deepEqual(Object.keys(other.items), ['app-erp'], 'per model');
  });
});

describe('refs: folder paths (BR-18)', () => {
  test('a path of labels as a token and back', () => {
    const token = pathToken(['Application', 'ERP domain', 'a:b@c']);
    assert.equal(token, '@Application:ERP*20domain:a*3Ab*40c');
    assert.ok(isPath(token));
    assert.equal(isPath('id-1'), false);
    assert.equal(isId(token), false);
    assert.deepEqual(labelsOf(token), ['Application', 'ERP domain', 'a:b@c']);
  });

  test('the API finds folders by path (BL-40)', async () => {
    const res = await api.resolve(M, { folderPaths: [['Application', 'Billing'], ['Business'], ['Application', 'Gone']] });
    assert.deepEqual(res.folderPaths, [F('Billing'), F('Business'), null]);
  });
});
