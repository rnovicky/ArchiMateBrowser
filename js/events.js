// ArchiMate Browser: the API's change events (MU-14, 2.26.0; API 3.17.0, its EPIC_STAGE3_DECISIONS.md).
// GET /api/v2/events is a text/event-stream that stays open. EventSource cannot send the X-API-Key header,
// so the stream is read with fetch and parsed here (U5). A dropped stream is opened again with the last
// event id, and the API sends what came since (U6). No DOM here: js/app/history.js decides what to show.

import { api } from './api.js';

const RETRY = 3000;        // ms before opening a dropped stream again (the API's `retry` overrides it)
const MAX_RETRY = 60000;   // ms at most between attempts while the API cannot be reached
const REFUSED_RETRY = 60;  // s before trying again after a 503 without Retry-After

/**
 * Splits the text of an event stream into events. `text`: what came, after what was left over the last
 * time. Returns { events: [{ id, event, data }], rest, retry }: `data` parsed as JSON when it is JSON,
 * `rest` the start of an event not complete yet, `retry` a reconnection time the stream asked for (ms).
 * Comments (keep-alive lines) are left out.
 */
export function parseEvents(text) {
  const blocks = text.replace(/\r\n?/g, '\n').split('\n\n');
  const rest = blocks.pop();
  const events = [];
  let retry;
  for (const block of blocks) {
    const event = { event: 'message' };
    const data = [];
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      let value = colon < 0 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'data') data.push(value);
      else if (field === 'event') event.event = value;
      else if (field === 'id') event.id = value;
      else if (field === 'retry' && /^\d+$/.test(value)) retry = Number(value);
    }
    if (!data.length) continue;
    const text = data.join('\n');
    try { event.data = JSON.parse(text); } catch { event.data = text; }
    events.push(event);
  }
  return { events, rest, retry };
}

const sleep = (ms, signal) => new Promise(resolve => {
  const timer = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
});

/**
 * The change events of one model (and the changes of any model as a whole), for as long as it runs.
 * onEvent({ id, event, data }): 'ready', 'change' and 'reset' events. onState(state, status): 'open' when
 * the stream answers; 'down' while it cannot be had (the caller polls meanwhile), with the HTTP status;
 * 'off' when the API has no events for this page (404, 401, 403): it is not tried again.
 */
export class ChangeStream {
  constructor({ model, onEvent, onState }) {
    this.model = model;
    this.onEvent = onEvent;
    this.onState = onState;
    this.lastId = null;
    this.retry = RETRY;
    this.controller = new AbortController();
  }

  start() {
    this.run();
    return this;
  }

  stop() {
    this.controller.abort();
  }

  get stopped() {
    return this.controller.signal.aborted;
  }

  async run() {
    const signal = this.controller.signal;
    let failures = 0;
    while (!this.stopped) {
      let res;
      try {
        res = await api.events({ model: this.model, after: this.lastId ?? undefined }, { signal });
      } catch {
        if (this.stopped) return;
        this.onState('down', 0);
        await sleep(Math.min(this.retry * 2 ** failures++, MAX_RETRY), signal);
        continue;
      }
      if (!res.ok) {
        res.body?.cancel().catch(() => {});
        if (res.status !== 503 && res.status !== 502 && res.status !== 504) {
          this.onState('off', res.status);
          return;
        }
        this.onState('down', res.status);
        const after = Number(res.headers.get('Retry-After')) || REFUSED_RETRY;
        await sleep(after * 1000, signal);
        continue;
      }
      failures = 0;
      this.onState('open', res.status);
      await this.read(res);
      if (this.stopped) return;
      this.onState('down', 0); // dropped: the API restarted, a proxy cut it, the laptop slept
      await sleep(this.retry, signal);
    }
  }

  async read(res) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const stop = () => reader.cancel().catch(() => {});
    this.controller.signal.addEventListener('abort', stop, { once: true });
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        const parsed = parseEvents(buffer + decoder.decode(value, { stream: true }));
        buffer = parsed.rest;
        if (parsed.retry) this.retry = parsed.retry;
        for (const event of parsed.events) {
          if (event.id != null && /^\d+$/.test(event.id)) this.lastId = Number(event.id);
          if (event.event === 'reset') this.lastId = null;
          try { this.onEvent(event); } catch (e) { console.error(e); }
        }
      }
    } catch {
      // the connection broke, or stop() cancelled it
    } finally {
      this.controller.signal.removeEventListener('abort', stop);
    }
  }
}
