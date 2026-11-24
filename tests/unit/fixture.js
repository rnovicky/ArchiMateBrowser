// The fixture model (tests/fixture/model.json) loaded through the real API
// client and ModelStore. The test server (tests/test_server.py) imports it
// into a real API, which gives every item a database id of its own; the
// helpers here turn the numbers of the fixture into those ids.

import { api } from '../../js/api.js';
import { ModelStore } from '../../js/store.js';

const ids = await fetch('/__test/ids.json').then(r => r.json());
const fx = ids.fixture;

/** Id of the fixture model. */
export const M = fx.model;
/** Id of relationship `n` of the fixture (101 …). */
export const R = n => fx.relationships[`id-r${n}`];
/** Id of view `n` of the fixture (1 … 3). */
export const V = n => fx.views[`id-v${n}`];
/** Id of the fixture's folder with this label. */
export const F = label => fx.folders[label];

const e = n => fx.elements[`id-e${n}`];
/** Element ids of the fixture, by name. */
export const E = {
  customer: e(1), role: e(2), orderHandling: e(3), invoice: e(4), orderService: e(5), erp: e(6), billingModule: e(7), billingService: e(8),
  invoiceData: e(9), junction: e(10), server: e(11), gateway: e(12), finance: e(13), orphan: e(14),
};

/**
 * The API's synthetic test model, imported next to the fixture: { model, elements,
 * relationships, views } with ids by XMI identifier ('app-erp', 'v-overview' …),
 * and folders by label. It has what the fixture lacks: views in folders,
 * connections on connections, property values in several languages.
 */
export const SYN = ids.synthetic;

let loading = null, loadingSynthetic = null;

/** A loaded ModelStore of the synthetic model (loaded once). */
export function syntheticStore() {
  loadingSynthetic ??= (async () => {
    const store = new ModelStore(await api.getModel(SYN.model));
    await store.load();
    return store;
  })();
  return loadingSynthetic;
}

/** A loaded ModelStore of the fixture model (loaded once). */
export function fixtureStore() {
  loading ??= (async () => {
    const store = new ModelStore(await api.getModel(M));
    await store.load();
    return store;
  })();
  return loading;
}
