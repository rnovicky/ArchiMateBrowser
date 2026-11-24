// MU-14 (2.26.0): the API's change events (API 3.17.0): the stream parser, and the stream against the real API
// through the test server's proxy, which must pass it on as it comes.
import { describe, test, assert } from '../harness.js';
import { ChangeStream, parseEvents } from '../../js/events.js';
import { api, isOwnRequest } from '../../js/api.js';

const waitFor = async (fn, what, timeout = 6000) => {
  const end = Date.now() + timeout;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise(r => setTimeout(r, 50));
  }
};

describe('change events (2.26.0)', () => {
  test('the parser: events, comments, a part left for the next piece, retry', () => {
    const { events, rest, retry } = parseEvents(
      'retry: 3000\n\nid: 41\nevent: ready\ndata: {"lastId":41}\n\n: keep-alive\n\nid: 42\nevent: change\r\ndata: {"a":\r\ndata: 1}\n\nid: 43\nevent: chan');
    assert.equal(retry, 3000);
    assert.deepEqual(events, [
      { event: 'ready', id: '41', data: { lastId: 41 } },
      { event: 'change', id: '42', data: { a: 1 } },
    ]);
    assert.equal(rest, 'id: 43\nevent: chan');
    const next = parseEvents(rest + 'ge\ndata: plain text\n\n');
    assert.deepEqual(next.events, [{ event: 'change', id: '43', data: 'plain text' }]);
    assert.equal(next.rest, '');
  });

  test('a write of this page carries a request id, and its change event is known as its own', async () => {
    const made = await fetch('/api/v2/models', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ xmiIdentifier: `id-ev-${Date.now()}`, name: 'Events unit' }) }).then(r => r.json());
    const seen = [];
    const states = [];
    const stream = new ChangeStream({ model: made.id, onEvent: e => seen.push(e), onState: s => states.push(s) }).start();
    try {
      await waitFor(() => seen.some(e => e.event === 'ready'), 'ready');
      assert.equal(states[0], 'open');
      await api.changes(made.id, { operations: [{ op: 'createElement', type: 'BusinessActor', name: 'Mine' }] });
      const change = await waitFor(() => seen.find(e => e.event === 'change'), 'the change event');
      assert.equal(change.data.name, 'Mine');
      assert.ok(isOwnRequest(change.data.requestId), `own request ${change.data.requestId}`);
      assert.equal(stream.lastId, Number(change.id));

      await fetch(`/api/v2/models/${made.id}/changes`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operations: [{ op: 'createElement', type: 'BusinessActor', name: 'Theirs' }] }) });
      const theirs = await waitFor(() => seen.find(e => e.data?.name === 'Theirs'), 'the other change');
      assert.ok(!isOwnRequest(theirs.data.requestId), 'made elsewhere');
    } finally {
      stream.stop();
      await fetch(`/api/v2/models/${made.id}`, { method: 'DELETE', headers: { 'If-Match': '*' } }); // someone else (2.29.0)
    }
  });
});
