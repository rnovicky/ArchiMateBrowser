// Minimal test harness (EN-1): no dependencies, runs in the browser.
//
//   describe('store', () => {
//     test('loads elements', async () => { assert.equal(store.elements.size, 244); });
//   });
//
// test() bodies may be async. skip(reason) inside a test marks it skipped.

const registered = []; // { suite, name, fn, timeout }
let currentSuite = '';

export function describe(name, fn) {
  const prev = currentSuite;
  currentSuite = prev ? `${prev} › ${name}` : name;
  try { fn(); } finally { currentSuite = prev; }
}

export function test(name, fn, { timeout = 20000 } = {}) {
  registered.push({ suite: currentSuite, name, fn, timeout });
}

class Skip extends Error {}
export function skip(reason) { throw new Skip(reason); }

class AssertionError extends Error {}

const show = v => {
  if (v instanceof Set) return `Set(${JSON.stringify([...v])})`;
  if (v instanceof Map) return `Map(${JSON.stringify([...v])})`;
  try { return JSON.stringify(v); } catch { return String(v); }
};

function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (a instanceof Set && b instanceof Set) return a.size === b.size && [...a].every(x => b.has(x));
  if (a instanceof Map && b instanceof Map) return a.size === b.size && [...a].every(([k, v]) => b.has(k) && deepEqual(v, b.get(k)));
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every(k => deepEqual(a[k], b[k]));
  }
  return false;
}

const fail = (msg, extra) => { throw new AssertionError(extra ? `${msg}: ${extra}` : msg); };

export const assert = {
  ok: (v, msg = 'expected a truthy value') => { if (!v) fail(msg, show(v)); },
  equal: (actual, expected, msg = 'not equal') => { if (!Object.is(actual, expected)) fail(msg, `got ${show(actual)}, expected ${show(expected)}`); },
  deepEqual: (actual, expected, msg = 'not deep-equal') => { if (!deepEqual(actual, expected)) fail(msg, `got ${show(actual)}, expected ${show(expected)}`); },
  includes: (haystack, needle, msg = 'missing') => {
    const has = typeof haystack === 'string' ? haystack.includes(needle) : haystack instanceof Set || haystack instanceof Map ? haystack.has(needle) : [...haystack].includes(needle);
    if (!has) fail(msg, `${show(needle)} not in ${show(typeof haystack === 'string' ? haystack.slice(0, 400) : haystack)}`);
  },
  notIncludes: (haystack, needle, msg = 'unexpected') => {
    const has = typeof haystack === 'string' ? haystack.includes(needle) : haystack instanceof Set || haystack instanceof Map ? haystack.has(needle) : [...haystack].includes(needle);
    if (has) fail(msg, `${show(needle)} should not be in ${show(typeof haystack === 'string' ? haystack.slice(0, 400) : haystack)}`);
  },
  match: (str, re, msg = 'no match') => { if (!re.test(String(str))) fail(msg, `${show(str)} !~ ${re}`); },
  throws: async (fn, msg = 'expected an exception') => {
    try { await fn(); } catch { return; }
    fail(msg);
  },
};

/** Poll until cond() returns a truthy value (returned), or fail after `timeout` ms. */
/** `what` names what is waited for in the failure; a function is asked at the time of failure (it can describe the state). */
export async function waitFor(cond, { timeout = 15000, interval = 50, what = 'condition' } = {}) {
  const t0 = performance.now();
  let last;
  for (;;) {
    try { last = await cond(); if (last) return last; } catch (e) { last = e; }
    if (performance.now() - t0 > timeout) fail(`timed out waiting for ${typeof what === 'function' ? what() : what}`, last instanceof Error ? last.message : '');
    await new Promise(r => setTimeout(r, interval));
  }
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Run the registered tests in order (optionally only those whose "suite › name"
 * contains `filter`). onResult(result) is called after each test.
 * @returns {Promise<{passed, failed, skipped, total, ms, tests}>}
 */
export async function run({ filter = '', onResult = () => {} } = {}) {
  const t0 = performance.now();
  const tests = [];
  for (const t of registered) {
    const full = `${t.suite} › ${t.name}`;
    if (filter && !full.toLowerCase().includes(filter.toLowerCase())) continue;
    const s = performance.now();
    let status = 'pass', error = null;
    try {
      await Promise.race([
        Promise.resolve().then(t.fn),
        new Promise((_, rej) => setTimeout(() => rej(new AssertionError(`timed out after ${t.timeout} ms`)), t.timeout)),
      ]);
    } catch (e) {
      if (e instanceof Skip) { status = 'skip'; error = e.message; } else { status = 'fail'; error = e instanceof AssertionError ? e.message : `${e.name}: ${e.message}\n${e.stack || ''}`; }
    }
    const r = { suite: t.suite, name: t.name, status, error, ms: Math.round(performance.now() - s) };
    tests.push(r);
    onResult(r);
  }
  const count = st => tests.filter(r => r.status === st).length;
  return { passed: count('pass'), failed: count('fail'), skipped: count('skip'), total: tests.length, ms: Math.round(performance.now() - t0), tests };
}
