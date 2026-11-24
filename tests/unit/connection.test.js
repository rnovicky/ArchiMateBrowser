// EN-2: API reachability (connection.js) and request cancellation (api.js).

import { describe, test, assert } from '../harness.js';
import {
  initConnection, reportResult, onRestored, onConnectionChange, connectionState, checkNow, resetConnection, isAbort, isConnectionError,
} from '../../js/connection.js';
import { api, ApiError } from '../../js/api.js';
import { M } from './fixture.js';

/** Make the API behind the test server unreachable (502) and/or slow. */
const setApi = (state) => fetch('/__test/api', { method: 'POST', body: JSON.stringify(state) });

describe('connection', () => {
  test('classifies errors: unreachable vs refused vs cancelled', () => {
    assert.ok(isConnectionError(new ApiError(0, 'NETWORK', 'x')));
    assert.ok(isConnectionError(new ApiError(502, 'BAD_GATEWAY', 'x')));
    assert.ok(isConnectionError(new ApiError(503, 'HTTP_503', 'x')));
    assert.ok(!isConnectionError(new ApiError(404, 'NOT_FOUND', 'x')));
    assert.ok(!isConnectionError(new ApiError(401, 'HTTP_401', 'x')));
    assert.ok(!isConnectionError(new ApiError(0, 'ABORTED', 'x')), 'a cancelled request is not an outage');
    assert.ok(isAbort(new ApiError(0, 'ABORTED', 'x')));
    assert.ok(isAbort(new DOMException('stop', 'AbortError')));
  });

  test('down on a gateway error, polls /health, restored on success', async () => {
    let healthy = false, probes = 0, restored = 0;
    initConnection({ probe: async () => { probes++; if (!healthy) throw new Error('down'); } });
    const offRestored = onRestored(() => restored++);
    const states = [];
    const offChange = onConnectionChange(st => states.push(st.down));
    try {
      resetConnection();
      reportResult(new ApiError(404, 'NOT_FOUND', 'no'));
      assert.equal(connectionState().down, false, 'a 404 is not an outage');
      reportResult(new ApiError(502, 'BAD_GATEWAY', 'gateway'));
      assert.equal(connectionState().down, true);
      assert.equal(connectionState().message, 'gateway');
      assert.ok(connectionState().nextCheck > Date.now(), 'next health check scheduled');
      await checkNow();
      assert.equal(probes, 1);
      assert.equal(connectionState().down, true, 'still down while /health fails');
      healthy = true;
      await checkNow();
      assert.equal(connectionState().down, false);
      assert.equal(restored, 1);
      // any successful request also ends the outage
      reportResult(new ApiError(0, 'NETWORK', 'offline'));
      reportResult(null);
      assert.equal(connectionState().down, false);
      assert.equal(restored, 2);
      assert.ok(states.includes(true) && states.at(-1) === false);
    } finally {
      offRestored();
      offChange();
      resetConnection();
    }
  });
});

describe('api: cancellation and outages', () => {
  test('an aborted request rejects with ABORTED and is not reported as an outage', async () => {
    resetConnection();
    await setApi({ delay: 500 });
    try {
      const ac = new AbortController();
      const p = api.search(M, 'bill', { signal: ac.signal });
      setTimeout(() => ac.abort(), 50);
      let err = null;
      try { await p; } catch (e) { err = e; }
      assert.ok(err, 'rejected');
      assert.equal(err.code, 'ABORTED');
      assert.equal(connectionState().down, false);
    } finally {
      await setApi({});
    }
  });

  test('a 502 from the proxy marks the API down; the next good answer restores it', async () => {
    resetConnection();
    initConnection({ probe: () => api.health() });
    await setApi({ down: true });
    try {
      let err = null;
      try { await api.listModels(); } catch (e) { err = e; }
      assert.equal(err?.status, 502);
      assert.equal(connectionState().down, true);
      await assert.throws(() => api.health(), '/health fails too');
    } finally {
      await setApi({});
    }
    await checkNow();
    assert.equal(connectionState().down, false);
    resetConnection();
  });

  test('signals reach paged list requests (store.load)', async () => {
    const ac = new AbortController();
    ac.abort();
    let err = null;
    try { await api.listElements(M, {}, { signal: ac.signal }); } catch (e) { err = e; }
    assert.ok(isAbort(err));
  });

  test('down again right after coming back: the first check comes as soon as ever (BL-6)', () => {
    // /health is a real check now (503 while the database is down), so there is no flapping to damp
    initConnection({ probe: async () => {} });
    try {
      resetConnection();
      reportResult(new ApiError(502, 'BAD_GATEWAY', 'gateway'));
      const first = connectionState().nextCheck - Date.now();
      reportResult(null);
      reportResult(new ApiError(502, 'BAD_GATEWAY', 'gateway'));
      const again = connectionState().nextCheck - Date.now();
      assert.ok(Math.abs(again - first) < 500, `first check after ${first} ms, then after ${again} ms`);
    } finally {
      resetConnection();
    }
  });

  test('/health: version and API versions; a failing check rejects (BL-6)', async () => {
    const hl = await api.health();
    assert.equal(hl.status, 'ok');
    assert.match(hl.version, /^\d+\.\d+\.\d+/);
    assert.includes(hl.apiVersions, 'v2');
  });

  test('auth/me (API-8): the admin key of the tests may import and delete; the reader key may only read', async () => {
    const admin = await api.me();
    assert.equal(admin.role, 'admin');
    assert.deepEqual(admin.permissions, ['read', 'write', 'import', 'deleteModel']);
    await setApi({ role: 'reader' });
    try {
      const reader = await api.me();
      assert.equal(reader.role, 'reader');
      assert.deepEqual(reader.permissions, ['read']);
      let err = null;
      try { await api.deleteModel(999999); } catch (e) { err = e; }
      assert.equal(err?.status, 403, 'refused by its role before the model is even looked up');
    } finally {
      await setApi({});
    }
  });
});
