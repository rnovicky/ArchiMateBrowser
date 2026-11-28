# Plan: upgrading ArchiMate Browser to API v2

* **Goal:** the browser uses `/api/v2` of ArchiMate API 2.0.0, and the
  model logic it computes itself today moves to the API. The browser asked
  for every one of these API changes for that purpose
  (the API's `API_IMPROVEMENTS.md`); this plan is the other half of that work.
* **Written 2026-10-11** from the browser as handed over (`HANDOFF.md`, 91
  tests) and the API at its tag `v2.0.0` in `../ArchiMateAPI`.
* **Status as of 2026-11-28:** 2.35.0, for API 3.26.0: recipes (2.30.0), recipe scripts (2.33.0), a
  recipe edited as a script and kept scripts (2.34.0), live templates and a better script editor
  (2.35.0). What is open is listed in [Open ideas and tasks](#open-ideas-and-tasks-as-of-2026-11-28).
* **Status as of 2026-10-24: the plan is done.** All five phases are
  finished (version 2.9.0): the browser is a v2 client, the API answers
  every question about the model, and a model is loaded on demand. It needs
  API 2.10.0 (`MIN_API_VERSION`; 3.5.0 for the smaller folder tree, 3.6.0
  for the reports, 3.7.0 for the check of relationships not allowed) and has
  164 tests (2.10.0). `app.js` is split into `js/app/`
  (EN-6). Further work is in `IMPROVEMENTS.md`. The history below is from
  2026-10-11 to 2026-10-15.
* **Status as of 2026-10-11:** the decisions are taken (see
  [Decisions](#decisions)). **Phases 1, 2 and 3 are done,** on API 2.2.0.
  Since 2026-10-14 the import dialog can also replace a model, after a
  preview of the changes (API 2.3.0 and 2.4.0, BL-33, BL-34), and links name
  items by XMI identifier, and folders by their path, so they survive a
  replace (BR-17, BR-18; API 2.5.0 and 2.6.0, `resolve`), so the browser
  needs API 2.6.0; the export asks before writing lines without ends
  (API 2.7.0, BL-41), and it reads and writes Archi's files and shows and
  updates linked models (API 2.8.0, BL-42, BR-20), so it needs 2.8.0. `HANDOFF.md` was retired the
  same day; README, this plan and `IMPROVEMENTS.md` hold what it said.
  The browser is a v2 client, and the API decides everything about the
  model: searches, look-ups, and what belongs to a diagram. Its 171 tests
  run against the real API. Phases 4 and 5 followed on 2026-10-24 (2.9.0).
* **The rule for both projects** (decided 2026-10-11): the browser and the
  API stay two separate projects and are kept in line. The API helps the
  browser wherever it can, and is changed or extended for that when needed.
  The browser uses the API and keeps workarounds to a minimum.
* **Sources:**
  * The API's `API_IMPROVEMENTS.md`, appendix B: what the browser should change per
    item.
  * `IMPROVEMENTS.md` §1 and §1a: the workarounds the browser has today.
  * `../ArchiMateAPI/CHANGELOG.md` and `PLAN.md`: what the API really
    built, and where it differs from the specification.

## Open ideas and tasks (as of 2026-11-28)

What is unfinished or undecided for the Browser. The ideas shared with the API
and the MCP server (the reporting tool, PostgreSQL, the multi-user epic, the
recipe scripts' open items R1 to R8) are in the API's PLAN.md, section *Open
ideas and tasks*. Remove an entry when it is done or dropped.

**Backlog** (details in [IMPROVEMENTS.md](IMPROVEMENTS.md)): BR-10 very large
models; CM-12 open in a new browser tab; PU-1 a self-hosted PlantUML renderer
by default; PU-6 PlantUML in the browser; SP-1 sharper relationship sprites;
LV-7 to LV-10 very large layouts and ELK issues; ALT-3, ALT-5, ALT-6 other
renderers and a draw.io export; EN-5 the proxy's connection pooling; EN-8
optional Node.js tooling; BR-15 phase 4 (drag onto a tab, preview tabs).

**From the recipe scripts** (API PLAN.md R4, R5, R7, R8): forgetting a kept
script's text, live templates in offline copies, a zip of a script's images,
completion of element names and folder paths in the editor.

**Tests still to do by hand** (`../todo.txt`): the submenus (CM-10) with the
keyboard; an offline copy in Firefox.

## How to track progress

* Every row of the tracker has an ID. Rows that adopt an API item keep that
  item's ID (`API-n`, `HLP-n`). Work that belongs to the upgrade itself has
  the prefix `UP-`. API changes that this plan asks for have the prefix
  `GAP-`.
* **Status:** `todo`, `doing`, `done`, `dropped`.
* An item is done when the old code path is gone (not only bypassed), the
  tests pass, and `README.md`, `IMPROVEMENTS.md` and the Czech strings are
  updated, as `HANDOFF.md` §6 asks.
* When an item is finished, change its row here in the same change.
* The browser is a git repository since 2026-10-11 (its first commit is the
  state as handed over). One commit per finished step; the API has its own
  repository next to it.

## Where the browser stands

The browser loads **every element and every relationship** of a model when
the model is opened (`ModelStore.load`), builds an index in memory, and
answers everything from it. The API is used as a data source only.

| What | Today |
| --- | --- |
| API base | `/api/v1`; 15 endpoints, all plain lists and single objects |
| Model data in memory | all elements, all relationships, the view list, the folder tree; view contents on demand |
| Uses of the in-memory model | 127 places in `js/app.js`; `store.element(id)` alone 62 times, always synchronous |
| Model rules written in JavaScript | neighbourhood, relationships of a set, impact analysis, expansion counts, nesting, folder index, property index and filter, property search, "views containing", "views linking here" |
| Tests | 91 (`test.bat`): unit tests of those rules, and smoke tests of the whole app, against a Python test server that answers `/api/v1` from `tests/fixture/model.json` |

Checked here on 2026-10-11, before any change: **87 pass, 4 are skipped.**
The four are the type check against `xmi_oas.json`; they were skipped
because the browser looked for the API in `..\ArchiMateAPI` and the folder
here is `..\ArchiMateAPI`. The table above describes that starting
point; the result of phase 1 is under [Phases](#phases).

## What v2 gives the browser

From the API's changelog, in the browser's terms:

* **Three responses changed shape:** the connections of a view (now an
  envelope with `total`), the search (ranked, paged per kind), the import
  (`{ model, warnings }`).
* **One request instead of many:** a whole view (`…/content`), the views
  that show an element or relationship, the links between views.
* **The model's rules as endpoints:** `graph/neighbourhood`,
  `graph/subgraph` (with nesting), `graph/impact` (JSON and CSV),
  `graph/expansion-counts`, `graph/paths`.
* **Folders and properties:** counts in the folder tree, contents and path
  of a folder item, the elements of a view, the property index, property
  filters on the lists.
* **No need to load everything:** statistics, `ids=` on the lists,
  `include=degree`, `ETag` with `304` per model revision.
* **Operation:** a `reader` role and `auth/me`, CORS, a `/health` that
  really checks the database, fast `localhost`.

The helpers return what the browser computes today. The API was tested
against this browser's own code: 300 neighbourhoods, 194 impact analyses,
the expansion counts of every element, nesting, folder contents and the
property index gave equal results on a shared test model
(`../ArchiMateAPI/tests/fixtures/parity/`).

## Findings

Things found while reading both sides. They shape the phases below.

* **F1: the hard part is not the helpers, it is `store.element(id)`.** The
  helpers can replace the rule code in a few places each. But almost every
  part of the UI looks elements and relationships up synchronously in the
  full in-memory model: tree rows, details, menus, titles, labels. As long
  as the whole model is loaded, calling a helper saves no load and adds a
  request. The gain comes only when the full load goes away, and for that
  every one of those look-ups needs the item to be in memory already. The
  plan therefore introduces a cache with an explicit "make sure these ids
  are loaded" step (UP-3) before it removes the full load (UP-6).
* **F2: the upgrade can be done in two honest steps.** First switch to v2
  and move the rules, with the full load still in place; then remove the
  full load. The first step alone meets "the logic lives in the API". The
  second is what makes large models possible (backlog item BR-10) and is
  the larger change. Decision D2 asks whether both are wanted now.
* **F3: while both exist, they can check each other.** In the first step
  the browser still has its own results. A development switch can compare
  each helper's answer with the local one and report a difference
  (UP-5). That is a far stronger test than any fixture, on any model the
  user opens, and it costs little. It disappears with the local code.
* **F4: the test server speaks v1 and knows no helpers.**
  `tests/test_server.py` answers `/api/v1` from a JSON fixture with a few
  simple list and look-up handlers. To serve v2 it would need the search ranking, five
  graph helpers and the folder helpers: the model rules written a third
  time, which is what this upgrade removes. See decision D3.
* **F5: seven things the browser does have no v2 endpoint.** They are the
  `GAP-` rows of the tracker. Each has a workaround; three of them
  (GAP-1, GAP-2, GAP-7) change what the user sees if the API is not
  extended.
* **F6: some logic should stay in the browser.** It works on what is drawn,
  not on the model, and moving it would add requests for nothing: layout
  (ELK), rendering, manual positions, PlantUML source, colour scales,
  position hints for the explorer, and *Highlight path* (CM-9), which
  follows the relationships on the screen. *Highlight path* reads the
  in-memory model today and must be changed to read the drawn set.
* **F7: nesting is a borderline case.** `computeNesting` needs only the
  elements and relationships of the diagram, which the browser has after
  any helper call. The API offers it (`"nesting"` in a subgraph request)
  and gives the same result. Using the API's keeps one definition of the
  rule; keeping the local one saves a field in the request and works with
  relationships the user has hidden (GAP-4). The plan uses the API's and
  handles hidden relationships as GAP-4 describes.
* **F8: the layer keys differ.** The browser says `implementation`, in
  lower case; the API says `ImplementationMigration`, as its specification
  does. One mapping in `js/archimate.js`.
* **F9: stored settings point at v1.** `apiBase` is saved in the browser's
  local storage. A user who opened Settings once has `/api/v1` stored, and
  a new default would not reach them. UP-1 migrates the stored value.
* **F10: the browser cannot cache a POST.** Four helpers use `POST`. The
  browser's HTTP cache ignores `ETag` on those, so `HLP-0` needs a small
  cache in `js/api.js` (key: path and body; value: `ETag` and response)
  that sends `If-None-Match` itself.
* **F11: the API's parity test reads this browser's rule code.**
  `../ArchiMateAPI/tests/fixtures/parity/build_parity.py` runs
  `js/store.js`, `impact.js`, `explorer.js` and `nesting.js` to produce the
  expected results. When the upgrade deletes those functions, that program
  can no longer run. Its output is committed, so the API's tests keep
  passing; only regenerating it stops working. See decision D5.
* **F12: views in folders are new for the browser.** v2 stores them
  (API-11). The browser treats every folder item that references neither
  an element nor a relationship as a folder, so today it would show each
  filed view as an empty, unnamed folder. This has to be fixed in the
  first phase, not later.
* **F13: `HANDOFF.md` forbids changing the API folder.** That rule came
  from a session in which the API belonged to someone else. The GAP rows
  need API changes. See decision D1.
* **F14: the copies of the specification differ from the API's by one
  status note** that the API side added at the top. The texts are otherwise
  the same.
* **F15: what the browser stores is filed under the API's base URL** (found
  in phase 1). Baskets and manual layouts have the base URL in their storage
  key, so a new default base alone would have hidden every saved basket and
  layout. The migration of UP-1 moves them along with the setting.
* **F16: the proxy reported a browser that had gone away as an unreachable
  API** (found in phase 1). `serve.py` relayed the API's answer inside the
  `try` that catches connection errors, so a request the browser had
  cancelled was answered, and logged, as `502`. Nobody saw the answer, but
  the log was misleading. Fixed.

## Tracker

`Size`: S = up to half a day, M = one to two days, L = more.

### The upgrade itself

| ID | Item | Size | Phase | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| UP-1 | API location and version: find the API folder under either name; default base `/api/v2`; migrate a stored `/api/v1`; show the API version from `/health` in Settings | S | 1 | done | F9, F15. Also: a clear message for an API older than 2.0.0; `.env` of the browser for a reader key |
| UP-2 | Tests against the real API | M | 1 | done | Decision D3. The fixture is imported as an exchange file, next to the API's synthetic model |
| UP-3 | Model cache with `ensure(ids)`: elements, relationships and views by id, filled from every response; look-ups stay synchronous | M | 4 | done | F1. 2.9.0: `ModelStore.ensure`, `remember` and the kept lists; see the result of phase 4 |
| UP-4 | Response cache with `ETag` and `If-None-Match`, also for POST | S | 3 | done | F10. `ask()` in `js/api.js`: the last 300 answers of the POST helpers. GET answers are revalidated by the browser itself |
| UP-5 | Comparison mode: each helper's answer checked against the local computation, differences reported | S | 3 | done | F3. Removed in phase 4 (2.8.0), with the local rule code |
| UP-6 | Remove the full model load and the rule code it served | L | 4 | done | F2, decision D2. The rule code went in 2.8.0 (`ModelStore.neighbourhood` and the walks of the store, `analyse`, the local hidden neighbours, `computeNesting`, the comparison mode and its tests), the full load in 2.9.0 |
| UP-7 | Documentation: README (data loading, endpoints used, tests), `IMPROVEMENTS.md` §1 and §1a marked resolved, `HANDOFF.md` | S | every phase, 5 | done | `HANDOFF.md` retired 2026-10-14; the rest in phase 5 |

### API items to adopt

| ID | What changes in the browser | Replaces | Size | Phase | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| API-1 | Page with `limit=1000` | `limit = 200` in `api.getAll` | S | 1 | done | |
| API-2 | Read `items` of the connections envelope; `store.viewContent` uses `…/content` | bare-array paging loop; two requests per view | S | 1, 2 | done | Without `include=concepts` for now: see the result of phase 2 |
| API-3 | Document running without the proxy; keep `serve.py` as the default | – | S | 5 | done | README, *Running without the proxy*; tried with a plain static server |
| API-4 | The details of an element and of a relationship list the views that show it, from `…/elements/{id}/views` and `…/relationships/{id}/views` | `viewsContaining`, `loadAllViews`, the *Find views* button | S | 2 | done | Loaded with the details; no button any more. New for relationships |
| API-5 | Counts for the tree, the status line, the model details and the delete dialog from `…/stats` | counting the loaded maps | S | 2 | done | Needed by UP-6 |
| API-6 | New search: groups per kind, ranking, *more…* per group, views as results, property searches through the API | `runSearch`, client-side property search | M | 1, 2 | done | A hit outside the name says where it was found |
| API-7 | Proxy default may be `localhost` again | – | S | 5 | done | Kept at `127.0.0.1`, by choice: see the result of phase 5 |
| API-8 | Ask `auth/me`; hide *Import* and *Delete model* without the permission; recommend a reader key in `start.bat` | always shown | S | 1 | done | `403` names the role of the key. A reader key goes into `.env` of the browser folder |
| API-9 | Draw connections that end on connections in stored views | not drawn | M | 2 | done | `viewsvg.js`: such an end lies on the middle of the other line. PlantUML export of a view: a helper dot |
| API-10 | *Links to views* and *Linked from* in the view details from `…/views/{id}/links` | `viewLinks`, `viewsLinkingTo`, the *Find views linking here* button | S | 2 | done | One request for both directions |
| API-11 | Views inside folders: tree rows, counts, folder details | filed views shown as unnamed folders (F12) | S | 1 | done | Done completely in phase 1. The folder of a view is in its details since phase 2 |
| API-12 | Nothing | – | – | – | dropped | The API did not implement it, by decision |
| BL-4 | Show the import warnings in the import dialog | – | S | 1 | done | The dialog stays open when there are warnings |
| BL-6 | `/health` answers `503` when the database is down: simplify the outage banner | back-off for a flapping banner | S | 1 | done | `js/connection.js` |
| HLP-0 | see UP-4 | – | – | 3 | done | |
| HLP-1 | Neighbourhood diagrams, what expanding an element adds, where an added element goes | `ModelStore.neighbourhood` | M | 3 | done | With the property filter (GAP-1), the hidden counts (GAP-9) and nesting (API 2.2.0) |
| HLP-2 | Diagrams of a set: basket, selection, folder, type, layer, relationship type, explorer steps; nesting | `relationshipsForDiagram`, `relationshipsAmong`, `computeNesting` | M | 3 | done | F7. Sets by `layer`, `relationshipType`, `onRelationships` (GAP-2, GAP-3), `excludeRelationshipIds` (GAP-4) |
| HLP-3 | Impact diagram, impact box in the details pane, CSV | `analyse`, `toCsv` | M | 3 | done | The relationships to draw and the nesting come with the answer (API 2.2.0). `pathTo` stays: it reads the answer |
| HLP-4 | New: paths between two elements | – | M | 3 | done | Decision D6. From the element menus, the selection menu and by link |
| HLP-5 | Explorer "+N" badges and the per-type menu | `hiddenNeighbours`, `hiddenByType` | S | 3 | done | One request per diagram for all its elements |
| HLP-6 | `n↗ m↙` and the expand arrow from `include=degree` | counting `outgoing` / `incoming` | S | 4 | done | 2.9.0. Every element the tree shows is asked for with its counts |
| HLP-7 | Folder counts, contents and paths; *add a view's elements* | the counting and the item index of `loadFolders`; `folderElementIds`, `folderPathOf`, `viewElementPositions` computed locally | M | 2 | done | The tree with `counts=true` is still loaded with the model: it is what the *Folders* branch shows. GAP-5 (`order=model`) is used in phase 4 |
| HLP-8 | Fetch by `ids=` | part of the full load | S | 4 | done | 2.9.0, by `ensure`: 500 ids per request |
| HLP-9 | Property panel from `…/properties/index`; property searches through the API | `indexProperties`, the property search over all loaded items | M | 2 | done | The property *filter of a diagram* is still applied locally; it moves with the graph rules (phase 3, GAP-1) |
| HLP-10 – HLP-12 | Nothing yet | – | – | – | – | Not built in the API; planned there for after 2.0.0 |

### Gaps: what the browser does and v2 cannot answer

Each row says what happens without an API change, and what the change
would be. **Decided 2026-10-11: all of them are closed in the API.** GAP-1 to GAP-9
were, in release 2.1.0 (there: BL-22 to BL-30; GAP-3 and GAP-4 both in the
subgraph request), and GAP-10 and GAP-11, found later, in release 2.2.0
(BL-32, BL-31); the column
*Without an API change* is kept as the reason, not as the plan. The API side
numbers its backlog `BL-n`; these become `BL-22` and following there.

| ID | Gap | Without an API change | Wanted in the API | Needed for |
| --- | --- | --- | --- | --- |
| GAP-1 | **Property filter in the graph helpers.** A diagram filter can include a property condition (`Owner = Finance`). The browser applies it while walking: an element that fails is not passed through. The helpers filter by type and layer only. | Filter the helper's result afterwards. Elements *behind* a filtered-out element then appear, where today they do not. Or keep the local walk for diagrams with a property filter. | `property`, `propertyValue`, `propertyOp` in the filter of `neighbourhood`, `subgraph` and `expansion-counts`. The condition code exists (`app/services/predicates.py`). | Phase 3 |
| GAP-2 | **Relationships that end on a relationship, as a list.** The tree has a group *Connected to relationships*, with a diagram. The relationship list can filter by one given end, not by "any end is a relationship". | The group needs every relationship loaded, or is dropped. The count is in `…/stats`. | `onRelationship=true` on `GET …/relationships`. | Phase 3 |
| GAP-3 | **A subgraph of a layer.** A layer diagram needs all elements of several types. `subgraph` takes one `elementType`. | Ask the search for `layers=X` without `q` (paged, 1000 per request), then `subgraph` with the ids. Two or more requests; correct. | `elementTypes` and `layers` as ways to name the set in `subgraph`. | Phase 3 |
| GAP-4 | **Hidden relationships in an explorer diagram.** The user can hide single relationships; nesting must then ignore them. `subgraph` filters by type, not by id. | Drop the hidden ones from the response in the browser. If a hidden relationship was used for nesting, ask again without nesting and compute it locally, or accept that hiding a nesting relationship has no effect on nesting. | `excludeRelationshipIds` in `subgraph`. | Phase 3 |
| GAP-5 | **Model order of folder items.** The tree lists a folder's items in the order of the file. `…/contents` orders by name; the folder tree gives the order but only ids. | Read the order from `GET …/organizations` and the names with `ids=`. Two requests per opened folder; correct. | `order=model` on `…/contents`, or names in the tree's leaves. | Phase 2 |
| GAP-6 | **What a view shows, in one request.** Drawing a stored view needs the type and name of every element and the type of every relationship. `…/content` has ids. | Three requests: `…/content`, `…/views/{id}/elements`, and `…/relationships?ids=`. | `include=concepts` on `…/content`, adding the referenced elements and relationships as summaries. | Phase 2 |
| GAP-7 | **Property search with *contains* and *is not set* on views.** `@name~value` and `@name!` work on elements, relationships and views today. The search knows *has* and *equals*; the lists know all operations, but the views list has no property filter. | Elements and relationships through the lists; views are left out of these two searches. | `propertyOp` in the search, or the property filter on `GET …/views`. | Phase 2 |

| GAP-8 | **Relationship rows sorted by label.** The tree sorts the relationships of a type by "source → target". The API cannot sort a list by the names of the ends, and does not return those names. | Rows in the API's order, by id; the names of the ends by a second request with `ids=`. | `include=ends` on `GET …/relationships` (type and name of both ends in each item) and `sort=label`. | Phase 4 |
| GAP-11 | **Nesting and the relationships to draw, from every helper.** `nesting` existed in the subgraph request only, so a neighbourhood or impact diagram with nested boxes needed a second request; an impact answer named the relationships walked along, not which of them have both ends in the result. Found in phase 3. | A second request, and a local rule. | `nesting` in `neighbourhood` and `impact`; `include: ["relationships"]` in `impact`. | Phase 3 |
| GAP-10 | **The concepts of a view with their properties.** A stored view can be labelled and coloured by a property of its elements. `include=concepts` returns summaries, without properties. Found in phase 2. | The elements by `ids=` in a second request. | `fields=full` with `include=concepts` on `…/content`. | Phase 4 |
| GAP-9 | **Hidden counts in the diagram's info line.** "The filter hides n elements and m relationships" needs the unfiltered result as well. | A second request per diagram while a filter is active. | The graph helpers report how many elements and relationships the filter left out (`filtered: { elements, relationships }`). | Phase 3 |

GAP-8 and GAP-9 were first listed as differences to accept. Under the rule
above they are gaps like the others.

## Phases

Each phase ends with the app working and `test.bat` green. Phases 1 to 3
keep the full model load, so the app behaves as today throughout.

### Phase 1: on v2, nothing else changes

The smallest change that makes the browser a v2 client.

1. **UP-1.** API folder under either name; base `/api/v2`; migration of the
   stored setting.
2. **UP-2.** The test harness, as decided in D3. Done first, so every later
   step is tested against real v2 answers.
3. **API-1, API-2 (envelope), API-6 (shape only), BL-4.** The three changed
   responses, and paging with 1000. The search keeps its present look: two
   groups, the first page of each.
4. **API-11, no regression (F12).** A folder item that references a view is
   not a folder.
5. **API-8, BL-6.** `auth/me`, hidden admin actions, `403` message; the
   simpler outage banner.

**Exit:** all present tests pass against v2; a model opens and every
feature of today works; no request goes to `/api/v1`.

**Result (2026-10-11):** done. The exit conditions hold: 106 tests pass (91
before, 15 new), and the last of them asserts that no request of the whole
run went to `/api/v1`.

* **UP-1.** `start.bat`, the tests and the help texts find the API under
  either folder name. The default base is `/api/v2`. A stored `/api/v1`
  base is changed when the page loads, and the baskets and manual layouts
  stored under it are moved along (F15). *Settings* shows the version of
  the API. An API older than 2.0.0 gives a message that says so.
* **UP-2.** `tests/test_server.py` starts the real API on a temporary
  SQLite database and proxies to it. It can also make the API look
  unreachable, slow, older than 2.0.0, or use a reader key.
* **API-1, API-2, API-6, BL-4.** Pages of 1000; the connections envelope;
  the search reads the groups of the new response; the import dialog lists
  the warnings and stays open when there are any.
* **API-11.** A filed view is a view row in its folder, is counted there
  and in the folder details, and opens the view.
* **API-8, BL-6.** `auth/me` decides whether *Import* and *Delete model*
  are offered; a `403` names the role of the key. The back-off for a
  flapping banner is gone, because `/health` now fails while the database
  is down.

Where the result differs from the plan:

* **The tests use the browser's fixture, not only the synthetic model.**
  Decision D3 expected the fixture ids in the tests to change to those of
  the synthetic model. Instead the fixture is turned into an exchange file
  (`tests/fixture_xml.py`) and imported into the test API next to the
  synthetic model. The 91 existing tests keep their model and their
  expected values, which were checked by hand once; only their ids go
  through look-up helpers now. The synthetic model is used where the
  fixture has no case: views in folders today, connections on connections
  and properties with languages later.
* **Without the API folder no test runs**, not even the pure unit tests:
  the run stops with exit code 2 and says what is missing. Running a part
  without the API would need a second mode of the test page for little
  gain.
* **API-11 was done completely** in phase 1 instead of in two steps.
* **Import and delete are tested for real now.** The old test server was
  read-only; against the real API a test imports a file with a warning and
  deletes the model again.

What phase 1 did beyond its list:

* A `.env` in the browser folder for a reader key (`ARCHIXMI_API_KEY`),
  which `start.bat` prefers to the admin key of the API's `.env`.
* The proxy no longer reports a cancelled browser request as `502` (F16).
* The paging loop got its own test with a small page size, since 244
  elements no longer fill a page of 1000.

### API 2.1.0: the gaps

**Done (2026-10-11),** as the API's `PLAN.md` records. Two things came out
differently from what the rows above asked for, and the browser follows
the API: a subgraph names a layer with `layer` (one), and `elementTypes` and
`layers` are filters there as in the other helpers; and the diagrams "all
relationships of a type" and "connected to relationships", which the gap
list had missed, are the sets `relationshipType` and `onRelationships`.

In the API project, before phase 2. GAP-5, GAP-6 and GAP-7 are needed for
phase 2, the rest for phases 3 and 4; they are small and related, so they
go into one release. Each gets a row in the API's `PLAN.md` and
`IMPROVEMENTS.md` (`BL-22` and following), tests on SQLite and MariaDB, and
an entry in the OpenAPI description and the changelog, as the API's own
rules ask. The browser then requires API 2.1.0 and says so when it meets an
older one, the way it does for 2.0.0 now.

### Phase 2: single look-ups and searches

Everything that today loads all views, or filters all elements, for one
answer. No graph rules yet.

1. **API-2 (`content`)** with `include=concepts` (GAP-6).
2. **API-4, API-10.** *Find views*, *Links to views*, *Find views linking
   here*.
3. **API-6 (rest), HLP-9.** Search groups with ranking, paging and views;
   `@`-searches through the API; the property panel from the index.
4. **HLP-7, API-11 (shown).** Folder counts, contents, paths; views in the
   folder tree; *add a view's elements* from `…/views/{id}/elements`.
5. **API-5.** Status line and tree counts from `…/stats`.
6. **API-9.** Connections on connections in stored views.

**Exit:** `loadAllViews`, `viewsContaining`, `viewsLinkingTo`,
`loadFolders`, `indexProperties` and the client-side property search are
deleted. Opening the details of an element or a view sends a fixed, small
number of requests.

**Result (2026-10-11):** done, on API 2.1.0. 123 tests pass (106 before).
Checked by hand on the real model as well: it opens, the search, a stored
view, the folder of a view and the links between views work, with no error
in the console.

* **Deleted:** `loadAllViews`, `viewsContaining`, `viewsLinkingTo`, the
  local `viewLinks`, `indexProperties`, the property search over the loaded
  items, and the counting and item index of `loadFolders`.
* **The details of an element** send two more requests: its folder, and the
  views that show it. **Of a view:** its folder and its links. Both used to
  need a click that loaded every view of the model.
* **Search:** three groups, the API's ranking, 50 hits per group with *Show
  more*, views as results. A property search (`@name…`) is one request to
  the same endpoint, with `propertyOp` of API 2.1.0, and finds views and
  relationships too.
* **Folders:** the counts come with the tree; the elements below a folder
  and the folder of an item are asked for when needed.
* **Stored views** come from `…/content`, one request instead of two, and
  draw connections that end on connections.
* **The browser needs API 2.1.0** and refuses an older one at once, naming
  both versions.

Where the result differs from the plan:

* **`loadFolders` is not deleted, but reduced.** The folder tree is what the
  *Folders* branch shows, so it is still fetched with the model, now with
  the API's counts. Kept from it are only the folders and their parents.
  What the plan meant to remove is gone: counting, and the index of where
  every item is filed.
* **`…/content` is used without `include=concepts`.** A stored view can show
  a property in its labels and colour by it, so the renderer needs the
  properties of the elements, and the summaries of `concepts` do not have
  them. While all elements are loaded this costs nothing. For phase 4 it is
  a new gap: GAP-10 below.
* **No button for *Find views*.** One request is cheap enough to send with
  the details, so the lists are simply there.
* **The property condition compares every value.** With several values of a
  property, for example one per language, the browser's search used to
  compare the value in the preferred language. The API's rule is that one
  matching value is enough, and the browser adopts it for searches.
* **Positions of a view's elements** come from the API as stored. The local
  code also repaired files whose child nodes have positions relative to
  their parent; that repair still applies when a view is drawn, but not to
  *add to diagram in their arrangement*. The exchange format asks for
  absolute positions, and the API's import does not change them.

Found on the way:

* **GAP-10: the concepts of a view with their properties.** Wanted in the
  API before phase 4: `fields=full` together with `include=concepts` on
  `…/content`, as the graph helpers have it.
* **Sorted by name, the API puts items without a name last;** the browser
  put them first. Seen in the list of a folder's elements. The API's order
  is kept.

### Phase 3: the graph rules

1. **UP-4, UP-5.** The response cache, and the comparison mode.
2. **HLP-1, HLP-5, HLP-2, HLP-3,** in this order: each replaces one group
   of functions, and each is run with the comparison mode on the real model
   before the local code is touched.
3. **GAP-1, GAP-2, GAP-3, GAP-4, GAP-9** through the API changes of 2.1.0.
4. **HLP-4:** *Path to…* in the element menu, drawn as a diagram (D6).
5. *Highlight path* reads the drawn relationships (F6).

**Exit:** with the comparison mode on, every diagram kind opened on the
real model reports no difference. The local rule functions are still
there, unused except by that mode.

**Result (2026-10-11):** done, on API 2.2.0. 140 tests pass (123 before).

The exit condition holds, and more strictly than by opening diagrams by
hand. With the comparison mode on, a script asked for the following on the
real model, about 6,000 requests, and **not one answer differed** from the
browser's own computation:

* for each of the 1,057 elements: its neighbourhood at depth 1, at depth 2
  with a type filter, at depth 2 in one direction, its impact and its
  dependencies, each with the relationships to draw and the nesting;
* the expansion counts of every element, with and without a filter;
* the diagram of every element type, every layer, every relationship type
  (also with a filter), the relationships on relationships, every folder,
  and a set of 400 given elements;
* neighbourhoods with a property filter, for three properties.

The same check runs in the tests: on the whole synthetic model in a unit
test, and in every smoke test.

* **`js/graph.js`** is the one place that asks the graph helpers. It turns
  the app's filter, property options and nesting setting into a request,
  and the answer into what the app draws.
* **`renderDef` is asynchronous.** A neighbourhood, a set, an impact
  analysis or the paths are one request, then one for the "+N" counts of
  the elements about to be drawn, then the layout. A newer diagram cancels
  one still on its way.
* **The explorer** reads its badges and its menu per relationship type from
  those counts; a step asks the API what it adds.
* **The impact box** in the details asks the API; the CSV is the API's.
* **Paths** (HLP-4) are in: *Paths from here…* and *Paths from … to here*
  in the element menu, *Paths between the two* for two selected elements,
  and `d=pa~from~to` in a link.
* **Highlight path** follows the relationships of the diagram, read from
  what is drawn (F6).
* **Answers of the POST helpers are kept** with their `ETag` (UP-4).

Where the result differs from the plan:

* **Another API release was needed, 2.2.0** (GAP-11). The plan had the
  browser ask a neighbourhood and then, for nesting, a subgraph; and it had
  not seen that an impact diagram must know which of the relationships
  walked along to draw. Both are now part of the one answer.
* **Some small rules on loaded data stay until phase 4,** because they are
  look-ups, not graph questions, and go away with the full load: the ends
  of one relationship (`dragElementIds`), the elements of a type or layer
  for a menu or a drag, the relationships of an element in the tree and the
  details, and the position hint for an explorer step, which looks at the
  relationship between two elements.
* **A property filter compares every value of the property** in diagrams
  too now, as in searches since phase 2. The comparison mode can therefore
  report a difference for a filter by *contains* or *equals* on a property
  that has values in several languages; that is the one known case, and the
  API's answer is the intended one.
* **Elements of a diagram come in the API's order,** by id (for a
  neighbourhood by distance, then id), where the browser used the order of
  its own walk. Diagrams of given elements keep the given order, so an
  explorer step leaves the rest in place. An automatic layout can
  therefore differ from before in the order of siblings.
* **The 400-element question is asked after the answer is there,** since
  the size is not known before.

### Phase 4: without the full load

A separate step, started once phase 3 is in use (decision D2).

0. **What phase 3 left** (see its result): the look-ups on loaded data
   named there. In the API they need nothing new, except perhaps the ends
   of a relationship for the explorer's position hint, which the
   neighbourhood answer of a step already contains.
1. **UP-3.** The cache with `ensure(ids)`; every entry point of the UI
   (a tree row opening, the details pane, a diagram, a menu) first ensures
   the ids it will show.
2. **HLP-6, HLP-8.** Tree rows per type from the paged list with
   `include=degree`; missing items by `ids=`.
3. **UP-6.** `ModelStore.load` fetches the model, the statistics and the
   view list only. The rule functions, the adjacency index and the
   comparison mode are deleted; their unit tests go with them (decision D5
   for the parity export).
4. Opening a model and expanding a type are measured on the real model and
   recorded here.

**Exit:** opening a model sends a number of requests that does not depend
on the model's size. No code in `js/` walks relationships of the model.

**Result (2026-10-24):** done in 2.8.0 (the rule code) and 2.9.0 (the full
load), on API 3.6.0 without a change to it. 163 tests pass.

The exit condition holds: opening a model sends four requests (the view
list, the statistics, the property index and the folders), and nothing in
`js/` walks the relationships of the model. Measured on the real model
(1,057 elements, 1,480 relationships), in the API's process:

| | Requests | Time | Data |
| --- | --- | --- | --- |
| Opening, 2.8.0 (every element and relationship, the full folder tree) | 8 | 353 ms | 1,276 KB |
| Opening, 2.9.0 | 4 | 189 ms | 62 KB |
| Opening the largest type (186 elements, with their counts) | 1 | 26 ms | 49 KB |
| The details of an element with many relationships (the element, its relationships with their ends) | 3 | 44 ms | 23 KB |

* **`ModelStore` is a cache** (UP-3): `remember()` keeps what an answer
  brings, merged, so a summary never replaces a complete item;
  `ensure({ elements, relationships })` asks for what is missing by
  `ids=` (HLP-8), relationships with `include=ends`, and remembers ids the
  model does not have. The lists a page needs (the elements of a type, the
  relationships of a type, of an element, attached to a relationship, on
  relationships, what is filed in a folder) are asked for once and kept.
* **The entry points make sure first:** the details pane, a diagram
  definition (a link or the basket may name elements not cached),
  *Add to diagram*, the explorer, the tree rows, the menus of a
  relationship and of the type, layer and relationship-type rows, the
  search (its hits come with their counts and ends), the basket, the
  reports, the exports. A menu that has to ask first opens when the
  answer is there.
* **The graph helpers return complete items** (`fields=full`) with their
  counts, so a drawn element has what labels and colours by property need;
  a stored view comes with its elements and relationships complete
  (`include=concepts&fields=full`, GAP-10). The impact analysis and the
  paths name what they reach by id; their elements and relationships are
  asked for before the answer is used.
* **Tree rows** show `n↗ m↙` from `include=degree` (HLP-6), and the
  relationships of a type come ordered by their ends (`sort=ends`, GAP-8).

Where the result differs from the plan:

* **The folder tree is loaded without its items** (`foldersOnly`, API 3.5.0,
  BL-49). With them it was 595 of the 617 KB still loaded when the elements
  and relationships no longer were. A folder's items are asked for when its
  row opens or its details show, each kind in the folder's order
  (`order=model`, GAP-5): elements, then relationships, then views, where
  the tree before mixed them in the order of the file. Items filed at the
  top level, outside any folder, are no longer shown in the *Folders*
  branch. The folder column of the exports reads the full tree once, when
  an export needs it.
* **The basket** stores XMI identifiers, as before; they are resolved by
  the API (BL-35) when the model opens, so the basket appears a moment
  after the tree.
* **The position hint of an explorer step** reads the relationships of the
  grown diagram, which the step asks for anyway (the same question as the
  diagram that follows, answered from the kept answer), where it read all
  relationships of the element.

### Phase 5: finish

1. **UP-7.** README: *Data loading*, *API endpoints used*, *Tests*;
   `IMPROVEMENTS.md` §1 and §1a rewritten as "resolved by v2", BR-10
   updated. (`HANDOFF.md` was retired on 2026-10-14.)
2. **API-3, API-7.** How to run without the proxy; the `localhost` note.
3. The Czech strings for everything new; the i18n test already fails on a
   missing one.

**Result (2026-10-24):** done, in 2.9.0.

* **UP-7.** The README describes loading on demand (*Data loading*), every
  endpoint the browser uses with its parameters, and the tests.
  `IMPROVEMENTS.md` §1 and §1a are rewritten as the record of what API v2
  resolved; BR-10 keeps only the virtualised tree.
* **API-3.** The README has *Running without the proxy*: `CORS_ORIGINS` in
  the API, any static server, the API base URL and key in *Settings*, and
  what the proxy no longer gives (the security headers, the key kept out
  of the page). Tried with `python -m http.server` and the API on another
  port: the model, the tree, the details and a diagram, every request
  straight to the API, the preflight requests answered by it.
* **API-7.** The proxy's default stays `http://127.0.0.1:8000`. `localhost`
  would be as fast only with the API's normal run (`python -m app`, which
  listens on `127.0.0.1` and `::1`); its development run with reload
  listens on IPv4 only, where `localhost` costs about 2 s per request on
  Windows. `127.0.0.1` is fast with both, so nothing is gained by changing
  it; the README explains the difference.
* **Czech strings:** nothing new on the page. Thirteen translations that
  nothing used any more are removed: those of the full load, the comparison
  mode and the folder items of the tree, and older ones of features gone
  before. The i18n test checks that every key used has one.

## Decisions

All taken on 2026-10-11, as recommended.

| # | Question | Decision |
| --- | --- | --- |
| D1 | `HANDOFF.md` says never to change the API folder. Does that still hold here, where both are developed together? | No. The API is changed whenever the browser would otherwise need a workaround. The two stay separate projects, each with its own repository, tests and documentation. |
| D2 | Stop after phase 3 (rules in the API, full load kept), or go on to phase 4 (no full load)? | Go on, as a separate step after phase 3 is in use. |
| D3 | How do the browser's tests get v2 answers? | From the real API, started on a temporary database. Done in phase 1; see its result for the one difference (the fixture is kept). |
| D4 | The gaps: extend the API, or work around them? | Extend the API, for all of them: the recommendation was four of seven, and the rule stated at the top of this plan settles the other three and adds GAP-8 and GAP-9. One API release, 2.1.0. |
| D5 | The API's parity export runs this browser's rule code (F11). What happens to it when that code is deleted? | Freeze it. The committed results stay as the record that the API matched the browser at the switch; a copy of the four deleted files is kept with the export. From then on the API's own tests define the rules. |
| D6 | HLP-4, paths between two elements: part of this upgrade? | Yes, in phase 3. |

## Risks

* **Behaviour that looks the same but is not.** The helpers match the
  browser on the test model. The real model can hold a case the test model
  lacks. The comparison mode (UP-5) is the answer, and the reason phase 3
  keeps the old code until its end.
* **More requests, slower clicks.** Today a click is answered from memory.
  After phase 4 many clicks cost a request. The helpers answer in 20 to 70
  ms on the real model, and the response cache (UP-4) makes repeats free,
  but a chatty sequence (one request per tree row, say) would be felt.
  Each phase-4 step is measured.
* **The tests depend on the API folder** (D3). A browser checkout without
  the API next to it cannot run its tests. Accepted; `test.bat` says what is
  missing.
* **Two things released together.** After D4 the browser needs API 2.1.0. `GET /health` reports the version; the browser should
  say clearly when the API is too old, instead of failing on a missing
  parameter.
* **`app.js` was 5,170 lines** (3,571 when this was written). Since 2.8.0 it is
  split into the modules of `js/app/` (EN-6, done), which makes phase 4 safer. Before, doing it first was an
  option, not part of this plan.
