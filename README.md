# ArchiMate Browser

*Formerly ArchimateXMI Browser (folder `ArchimateXMIBrowser`, launcher
`archimatexmibrowser.bat`), renamed on 2026-10-19; before that ArchiXMI
Browser (folder `ArchiXMIBrowser`), renamed on 2026-10-14. Settings,
baskets and layouts saved in the browser are kept: their storage keys, and
the `ARCHIXMI_*` environment variables, keep their names. `deploy` updates
an installation made under the old name.*

A lightweight, dependency-free HTML/JavaScript/CSS prototype for **browsing an
ArchiMate 3 model** served by the
[ArchiMate API](../ArchiMateAPI/README.md) (version 2.10.0 or later; the
browser uses `/api/v2`), and **visualizing** selected parts of it — with **PlantUML + the ArchiMate
stdlib macros**, or with a **native SVG renderer** that redraws stored views
using their original coordinates.

> Status: version 2.33.0. It browses and draws; with a key
> that may write (role `editor`, API 3.15.0 and 3.16.0) it also edits:
> created views ([Created views](#created-views-saving-a-diagram-as-a-view-2220)),
> elements and relationships, the palette, deleting and filing
> ([Editing](#editing-2230)); with role `admin`, model import and delete
> ([Import and delete models](#import-and-delete-models)) and the links of
> models to Archi files. Changes others make show at once in a bar (the
> API's change events, 3.17.0). Each feature names the API version it needs;
> the Browser starts with 2.10.0. [CHANGELOG.md](CHANGELOG.md) lists the changes;
> [ACCESS_RIGHTS.md](ACCESS_RIGHTS.md) points to the guide to keys and roles.
> In the source folder (not in the install package), see
> [IMPROVEMENTS.md](IMPROVEMENTS.md) for known limitations and the roadmap,
> and [PLAN.md](PLAN.md) for the move of the model logic to API v2, which is
> finished.

---

## Quick start

Prerequisites: Python 3.9+ (standard library only — no `pip install`), a
modern browser (Chrome/Edge/Firefox; needs ES modules and
`CompressionStream`), and a running ArchiMate API, version 2.10.0 or later
(default `http://127.0.0.1:8000`). The API's folder is expected next to this
one, as `ArchiMateAPI` (or under an earlier name, `ArchimateXMIAPI` or
`ArchiXMIAPI`).

```bash
archimatebrowser.bat run
```

which starts the browser and opens **http://127.0.0.1:8090/** in the default
web browser (`archimatebrowser.bat start` only starts it), or, equivalently:

```bash
python server/serve.py --env-file ../ArchiMateAPI/.env --open
```

`archimatebrowser.bat` (Windows):

| Command | Does |
| --- | --- |
| `archimatebrowser.bat install` | Checks Python, sets up the API key (creates `.env` from `.env.example` and opens it in Notepad, unless there is one here or in the API folder next to this one), checks that the API answers, then runs the browser |
| `archimatebrowser.bat deploy C:\Apps\ArchiMateBrowser [start]` | From an unzipped install package: installs into that folder, or updates the installation there. See *Installing and updating with deploy* |
| `archimatebrowser.bat start [options]` | Starts the browser |
| `archimatebrowser.bat run [options]` | Starts it and opens the page (`--open`) |
| `archimatebrowser.bat test [options]` | Runs the tests (see *Tests*) |

It may sit in this folder or in the folder that holds `ArchiMateBrowser\`.
Options are passed on to `serve.py` (or, for `test`, to `tests/run_tests.py`).

`server/serve.py` options:

| Option | Default | Purpose |
| --- | --- | --- |
| `--port` | `8090` | Port of the browser app |
| `--bind` | `127.0.0.1` | Interface to listen on (localhost only by default) |
| `--api` | `http://127.0.0.1:8000` (env `ARCHIXMI_API`) | Root URL of the API, **without** `/api/v2` |
| `--api-key` | env `ARCHIXMI_API_KEY` | `X-API-Key` injected into proxied requests |
| `--env-file` | – | Read the key from a dotenv file (read-only): `ARCHIXMI_API_KEY=`, or else `API_KEY=`, e.g. `../ArchiMateAPI/.env` |
| `--csp-allow` | env `ARCHIXMI_CSP_ALLOW` (space-separated) | Extra origin the page may contact under the Content-Security-Policy, e.g. a self-hosted PlantUML server `http://127.0.0.1:8088` or a directly used API; repeatable |
| `--no-csp` | – | Send no Content-Security-Policy header |
| `--open` | – | Open the app in the default web browser once the server listens |
| `--exit-with-stdin` | – | Stop when standard input is closed: for a program that starts the server for itself, such as the MCP server's images (2.29.0). `--port 0` then takes any free port; the first line printed names the address |

`archimatebrowser.bat` finds the key itself, so none has to be typed into the browser.
It passes `--env-file` with the first of these that exists:

1. `.env` in this folder, with a line `ARCHIXMI_API_KEY=<key>`. **Recommended:**
   give the browser a key of its own with the role `reader` (see *API keys
   and roles* in the API's README). The browser only reads, and with such a
   key *Import model…* and *Delete model…* are not offered. The file is not
   committed (`.gitignore`).
2. `.env` of the API folder (`..\ArchiMateAPI` or `..\ArchiMateAPI`): its
   `API_KEY`, the admin key, which may do everything. **Only when the
   browser listens on `127.0.0.1`** (the default, one person on their own
   machine); with `--bind 0.0.0.0` it is not added (2.13.0).

**Deleting a model someone changed** (2.15.0). *Delete model* deletes the
model only as the page loaded it: if someone changed it since (API 3.12.0
or newer), nothing is deleted and the dialog says who changed it.

**Changes made elsewhere** (2.14.0; at once since 2.26.0). While a model is
open, the Browser listens to the API's change events (API 3.17.0) and learns
within about a second that it changed (through the MCP server, another
person, a script); with an older API, or while the events cannot be had, it
checks every 15 seconds (`changeCheckSeconds`). A bar then says so, and who
changed it; the list of models follows models made or deleted elsewhere; *Refresh* loads
the changes, *Show changes* lists them. With a key that may read the API's
record of changes (role editor), the details of an element, relationship or
view have a *History* section, and the model's details its *Recent changes*:
50 at a time, newest first, and *Show N older changes* for the rest (2.28.0).

**Signing in** (2.13.0). With users of the API's database (API 3.11.0),
each person signs in with their own key: the top bar shows *Sign in*, or
who they work as (*Jana Novák (editor)*), with *Sign out* in its menu. The
key is checked with the API before it is kept, for the browser session or,
ticked, remembered. When the API refuses the key in use, the sign-in dialog
opens by itself and says why. On a shared installation leave
`ARCHIXMI_API_KEY` at a reader key for those who only look, or empty so
that everyone signs in. Changes are then recorded under each person's name
in the API's record of changes.

Any extra arguments are forwarded, e.g. `archimatebrowser.bat start --port 9000` or
`archimatebrowser.bat run --csp-allow http://127.0.0.1:8088`.

### Security headers (EN-3)

`serve.py` sends a **Content-Security-Policy** with the app's own files.
Scripts may only come from this server: no inline script, no `eval`. So text
from a model that ends up in the page (names, documentation, a PlantUML
SVG) cannot run code, read the API key or send data elsewhere. Besides this
server, the page may contact only the public PlantUML server
(`https://www.plantuml.com`) and the origins given with `--csp-allow`.
Styles may be inline, because generated and PlantUML SVGs use them; plugins
(`object`), `<base>` and framing by other sites are blocked. It also sends
`X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`, so the
PlantUML server doesn't learn the page's URL.

When *Settings* points at a PlantUML server or API that the policy doesn't
allow, the dialog says so and shows the `--csp-allow` option to add. If the
browser blocks something anyway, the status line names the blocked origin.
API answers relayed by the proxy are passed through unchanged.

### Why a small server?

`serve.py` serves the static app **and** reverse-proxies `/api/*` and
`/health` to the API, so the page and the API share one origin and the API
needs no CORS. It also injects the API key (a page never sees it), and it
sends the security headers, among them the Content-Security-Policy (EN-3).
It stays the default way to run the browser.

### Running without the proxy (API-3)

The app is static files, so any web server can serve the folder, as long as
the API allows the page's origin:

1. In the API's `.env`, set `CORS_ORIGINS` to the origin the page is served
   from, e.g. `CORS_ORIGINS=http://127.0.0.1:8091`, and restart the API.
2. Serve this folder, e.g. `python -m http.server 8091 --bind 127.0.0.1`
   in it, and open `http://127.0.0.1:8091/`.
3. In *Settings → Connection*, set the **API base URL** to the API itself,
   e.g. `http://127.0.0.1:8000/api/v2`, and the **API key**: without the
   proxy the page sends it. Use a key with the role `reader`. A key is kept
   for the browser session only, unless *Remember the key in this browser* is ticked.

What the proxy gave is then up to that server: the security headers
(`Content-Security-Policy` and the others, see *Security headers* above)
are not sent by `http.server`. Every request to the API is a cross-origin
one; the API answers the browser's preflight requests itself, and the
browser caches them for `CORS_MAX_AGE` seconds. Checked on 2026-10-24
with the fixture model: the model, the tree, the details and the diagrams
work, every request going straight to the API.

The reverse also works: `serve.py` serving the page and *Settings* pointing
at an API on another origin. The policy of the page must then allow that
origin: `--csp-allow http://127.0.0.1:8000`.

> **`localhost` or `127.0.0.1`** (API-7). On Windows `localhost` resolves to
> IPv6 `::1` first. The API's normal run (`python -m app`, which
> `archimateapi.bat start` runs) listens on both
> `127.0.0.1` and `::1`, so `localhost` answers at once there. Its
> development run (`archimateapi.bat run`, uvicorn with reload) listens on
> IPv4 only, and every request to `localhost` then waits about 2 s first.
> The proxy's default stays `http://127.0.0.1:8000`, which is fast with
> both.

---

## Features

### Layout of the page

* **Top bar:** the model picker, with the **⋮ model actions** menu next to
  it (*Refresh*, *Import model…*, *Export model*, *Export as SQLite
  database* (2.17.0, API 3.13.0), *Export .archimate*,
  *Update from file* and *Linked file…* for a linked model, and, set apart,
  *Delete model…*). *Refresh* (2.12.0) loads the model list and the open
  model again from the API: models and changes made elsewhere, for example
  through the MCP server, appear; the open tabs stay;
  the search field; the status line (counts, messages); *Settings*.
* **Left pane:** three sections, each collapsible with its ▾ and each
  scrolling on its own: the **basket** (its actions, and the elements you
  collected as an *Elements* group, like the search results), the **search results** (while there are
  some; *Close* hides them, and so does opening another model; a model
  opened again after an update searches again) and the **model tree**. What is collapsed is
  remembered in this browser; a new search opens its results again. With
  the tree collapsed, the basket and the results may use the whole height.
* **Centre pane:** the diagram's title, with the **Share** menu (*Copy
  link*, *Download .svg*, *Download .png*, *Copy image*, *Download elements
  as CSV*, *Download as JSON*, *Copy source*, *Download .puml*, *Open
  PlantUML image*) and the **⋮** menu that shows the diagram as
  *Diagram*, *PlantUML* or *Source* (the one shown is ticked). Below, three
  tabs: **Options** (*Direction*, *Neighbour depth*, *Follow* of generated
  diagrams), **Filters** and **Layout**. One of their panels is open at a
  time; the open tab is highlighted, and a click on it closes the panel.
  Each panel ends with **Set to default**, which resets only what that tab
  holds (disabled while it is at its defaults):
  * *Options*: top → bottom, neighbour depth 1, follow both directions;
  * *Filters*: every element and relationship type, no property filter, any
    language (*Label* and *Colour by* stay: they are in *Layout*);
  * *Layout*: the *Balanced* preset, no nesting, no *Label* or *Colour by*.
    Moved elements stay; *Manual → Reset* is for those.
  Then the drill-down trail and the diagram, with its tools in the top
  right corner: zoom, *Fit*, *Map*, *← Back*, *Tidy* / *Undo* / *Reset* and
  **Clear diagram**, which asks first.
* **Right pane:** the details of what is selected.

The menus open with a click or ↓/↑, move with ↑/↓ (wrapping around), Home
and End, and close with Escape (back to their button), a click outside or a
chosen item; the right-click menus behave the same. On a touch screen a
long press opens a right-click menu (2.18.0). An action that cannot
be used now is shown disabled; actions the API key may not use (import,
delete) are not shown.

* **Options that do not change the diagram shown** are dimmed, with a
  tooltip that says why: *Direction* for a stored view (it keeps its own
  layout), *Neighbour depth* for everything but a neighbourhood, *Follow*
  for everything but a neighbourhood and the explorer. They stay usable,
  since depth and *Follow* also set what *Neighbourhood diagram*,
  *+ neighbours* and the explorer use next.
* **An empty basket** shows a one-line hint instead of its buttons.
* The Options / Filters / Layout tabs are the same on every screen size.
* **Property options and another model:** when the model opened next has
  no property of the name that the property filter, *Label* or *Colour by*
  uses, that option is removed (a filter would leave every diagram empty, a
  label or colours would show nothing), and the status line says which.
  Options on properties the model has stay.
* **Closing the side panes, full screen** (2.28.0): ◧ and ◨ in the
  diagram's header close the model tree and the details pane (and open them
  again); the choice is remembered. ⛶ makes the page full screen with both
  panes closed; Esc leaves it and brings them back. The same is in the
  commands (Ctrl+K): *Hide the model tree*, *Hide the details pane*, *Full
  screen*.
* **Narrow windows** (900 px and less, e.g. a tablet in portrait) show one
  pane at a time, with a **Tree | Diagram | Details** switcher under the top
  bar. The pane follows what you do: an item picked in the tree (or
  *Details* in a menu) shows its details, a view or another diagram shows
  the diagram, a search shows its results in the tree pane.

### Model tree (left pane)

```
🗂 <Model>                              → model attributes, counts per layer, properties, metadata
 ├ 📁 Folders                           ← GET /organizations (only if the model has an <organizations> tree); right-click: the whole model
 ├ ◧ Elements                           grouped client-side; right-click: a diagram of the whole model (2.28.0)
 │   └ <Layer> (Strategy, Business, Application, Technology, Physical,
 │       │      Motivation, Implementation & Migration, Other)
 │       └ <Element type> (count)       → type summary, "Diagram of these elements"
 │           └ <Element>  n↗ m↙          → element details
 │               ├ ↗ <target element>   (Serving →)      outgoing relationships
 │               └ ↙ <source element>   (← Flow)         incoming relationships
 │                   └ … (infinitely expandable graph navigation)
 ├ ⇢ Relationships
 │   └ <Relationship type> (count)
 │       └ Source → Target              → relationship details; children = endpoints
 ├ 🖼 Views
 │   └ <View>                           → selecting renders the view
 │       └ node tree (nesting as in the diagram)
 ├ 🏷 Property definitions               → the definitions, each name a link to its details
 │   └ <Property> (data type)         → the property's details
 │       └ <Value> (count)            → the values elements give it, most frequent first
 └ ℹ Metadata
```

* Lazy expansion, “Show more…” paging for long lists (200 at a time).
* **Reveal in tree:** when an item is selected anywhere other than the
  tree (a details-pane link, a diagram click, or a deep-link URL), the tree
  expands to the item's canonical location and highlights it: *Elements →
  layer → type → element*, *Relationships → type → relationship*, or
  *Views → view*. Lazy branches load on demand and “Show more” pages are
  followed. Search results don't move the tree; use **Show in tree** in the
  details pane for that. Clicks inside the tree also leave it where it is,
  for example when following an element's relationships.
* Keyboard: ↑/↓ move, →/← expand/collapse (or go to parent), Enter toggles,
  Home/End go to the first/last row, `*` expands the siblings, typing the
  start of a name goes to the next row that has it, Context Menu key or
  Shift+F10 opens the context menu. Screen readers hear each row's level,
  its position among its siblings, and whether it is open (EN-4, 2.14.0).
* **The diagram from the keyboard** (EN-4, 2.14.0): Tab to the drawing, then
  the arrow keys move from element to element (to the nearest one in that
  direction; one off screen is brought into view), Enter or Space shows its
  details, the Context Menu key or Shift+F10 opens its menu, `+` shows its
  related elements, Escape returns to the drawing. Following a link in the
  details moves the focus to the details of what it opened. The page's
  colours pass WCAG AA contrast in both themes (a test checks them).
* **Commands** (2.21.0, CM-11): **Ctrl+K** anywhere (also while typing in
  the search), or the ⌘ button next to the search. Type a few letters of an
  element, a relationship or a view, choose it, then choose what to do with
  it: the same actions as in its menu. The commands of the diagram and the
  model are found by their words (*fit*, *tidy*, *select all*, *export*…).
  What is selected is offered first. ↑/↓ choose, Enter runs, Ctrl+Enter
  opens a diagram in a new tab, Backspace in the empty field goes back to
  the search, Escape closes.
* **Keyboard shortcuts** (2.19.0; **?** lists them, so does *Keyboard
  shortcuts* in the diagram's menu):

  | Key | Does |
  | --- | --- |
  | Ctrl+K | The commands (above) |
  | Delete | Hides from the diagram the element focused in the drawing, else the selected elements, else the element or relationship whose details are shown (generated diagrams; a stored view says to make an editable copy) |
  | Backspace | *← Back*: undoes the last step of the diagram, so it shows what Delete hid |
  | Ctrl+A | Selects every element of the diagram |
  | Escape | Clears a highlighted path, then the selection |

  They act in the diagram, or when nothing has the focus; not while typing,
  in a dialog or a menu, in the trees (where Delete removes a basket row) or
  on the tab bars (where Delete closes a diagram tab). The menus show the
  key next to the entry (*Hide from diagram* Del, *← Back* ⌫, *Select all
  elements* Ctrl+A).
* **Context menu** (right-click on an item, in the model tree and in search
  results) lists everything you can do with it:

  | Item | Actions |
  | --- | --- |
  | Element | Details · Neighbourhood diagram · Neighbourhood with relationship types… · Explore · Add to diagram (or *✓ In diagram*) · Expand in diagram (+N) · Hide from diagram · Collapse · Impact analysis · Dependencies · Add to / Remove from basket · Show in tree (by type) · Show in folders · Copy name |
  | Relationship | Details · Source: … · Target: … · Diagram of both ends · Neighbourhood diagram · Add both ends to diagram · Add both ends to basket · Show in tree · Copy name |
  | View | Open view (and details) · Automatic layout of its elements · Editable copy (keeps the arrangement) · Add to diagram (its elements, in their arrangement; with a generated diagram open) · Add its elements to basket · Edit as script… (a recipe, 2.34.0) · Show in tree · Copy name. The same actions as in the opened view's menu |
  | Folder | Details · Diagram of folder · Add to diagram (+N) · Add elements to basket · Copy name |
  | Element type | Details · Diagram of these elements · Add to diagram (+N) · Add all to basket · Select them |
  | Layer (*Business*, …) | Details · Diagram of the layer · Add to diagram (+N) · Add all to basket · Select them · Diagram filter: only this layer |
  | Relationship type (*Serving*, …, *Connected to relationships*) | Details · Diagram of the N relationships (their ends, connected by this type only) · Add their ends to diagram · Add their ends to basket · Diagram filter: only / hide this type |
  | Property (under *Property definitions*) | Colour diagrams by it (or stop) · Show it in diagram labels (or stop) · Only elements where it is set / not set · Remove the property filter · Find items with it (`@name` search) |
  | Value of a property (under the property) | Only elements where &lt;property&gt; = &lt;value&gt; · Remove the property filter · Find items with it (`@name=value` search) |
  | Model (root) | Details and statistics · Refresh · Recipe script… · Export model · Import model… · Delete model… · Copy name · Copy link to the model |
  | Search result headings (*Elements*, *Relationships*, *Views*) | Diagram of the results (of the relationships' ends; of the views' elements) · Explore · Add to diagram · Add to basket · Select them · Copy names |

  Actions that don't apply are left out; for example *Expand* and *Hide*
  only appear when the element is in the current generated diagram. With a
  stored view open, *Add to diagram* reads *Add to new diagram*.
  Impact/dependency analysis uses the options last set in the details
  pane. A view added from the menu keeps its arrangement, placed right of
  the diagram. The top-level headings (Folders, Elements, Relationships,
  Views) keep the browser's own menu. Layers and relationship types can
  also be dragged into the diagram, like types and folders. A numbered
  pill (*+N*) says how many elements an item adds; a plain number how many
  it acts on.
  The menu works with the keyboard (↑/↓, Enter, Escape returns to the tree).
* **Search** (top bar) lists the matching elements, relationships and views
  above the tree, each kind under its own heading with the number of hits.
  The API does the searching (`GET /models/{id}/search`). The text is looked
  for in names and documentation, without regard to case. The best match
  comes first: a name that equals the text, then one that starts with it,
  then one where a later word starts with it, then any other name that
  contains it, then a hit in the documentation, which the row says
  (*in the documentation*). A kind with more than 50 hits shows the first
  50 and a row *Show 50 more of …*, which fetches the next page.

### Details (right pane)

At the top: the type (badge and layer), the name, the folder the item is
filed in (each folder a link), and the actions (*Neighbourhood diagram*,
*Explore*, *Add to diagram*, …, *Show in tree*, *Show in folders*). Below
them the details are in **tabs** (2.19.0):

| Tab | Shows |
| --- | --- |
| Properties | Documentation (also when there is none, 2.30.0), the endpoints (a relationship, each marked *on diagram* or *add to diagram*, 2.30.0), attributes (IDs, XMI identifier, access type, influence modifier, …), property values (with `xml:lang`), the **views that show the item**; for a view its drill-down links in both directions |
| Relationships | Outgoing and incoming relationships as links; for a relationship, the relationships attached to it. A related element drawn in the diagram shown is marked *on diagram* (2.28.0); a click on the mark brings it into view in the diagram, marks it and makes it flash (2.30.0). One that is not drawn has *add to diagram*, while a generated diagram (or none) is shown (2.30.0) |
| Impact analysis | The analysis of an element (see *Impact analysis*) |
| History | The changes recorded for the item (for keys that may write) |

A view and the model have *Properties* and *History*. The tab chosen stays
for the next item that has it: with *Impact analysis* open you can click
through elements and see each one's analysis. The analysis and the history
are asked for only when their tab is shown. ←/→ move between the tabs.
A **property** (under *Property definitions*) shows its data type and XMI
identifier, how many elements have it and how many different values, its
languages, and its values with the number of elements that have each; a
click on a value searches for the items that have it. The overview of the
property definitions links each name to its details.
Links navigate between items; the
URL hash (`#model=1&element=42`, `&relationship=…`, `&view=…`) is a deep link.

**Right-click** (or the Context Menu key / Shift+F10 on a focused link)
opens the same context menus as in the model tree:

* **Relationship lists** (outgoing, incoming, attached to a relationship):
  the element link at the other end gives the element menu; the rest of the
  row, including ⓘ, gives the relationship menu.
* **Folder paths and sub-folder lists:** the folder menu (*Diagram of
  folder*, *Add to diagram*, *Add elements to basket*, *Show in folders*,
  …).
* **View lists** (*Views showing this element*, *Links to views*, *Linked
  from*): the view menu (*Open view*, *Add to diagram* in the view's
  arrangement, *Automatic layout of its elements*, *Add its elements to
  basket*, …).
* **Impact-analysis results:** the element menu, plus two path actions:
  * *Diagram of the path from &lt;start&gt;* (n steps): the elements along
    the analysis path.
  * *Copy the path as text*, e.g. “ERP Core —Flow→ Kafka —Flow→ Payment
    Service —Realization→ …”.

### Selecting several elements

One selection of elements is shared by the model tree, search results,
diagrams and the basket:

| Where | How |
| --- | --- |
| Model tree, search results | **Ctrl-click** adds or removes a row; **Shift-click** adds the rows from the last clicked one; **Ctrl+Space** on the keyboard. |
| Diagram tab | **Ctrl-** or **Shift-click** an element; **Shift-drag** (or Ctrl-drag) on the diagram selects an area: every element the area touches, except a container the area lies entirely inside. |
| Basket | Ctrl-click a row, as in the model tree. |
| Menus | *Select them* (types, layers, search results), *Select both ends* (relationships), *Select these elements* (legend entries), *Select all elements* (diagram background), *Select all of them* (basket). |

Selected elements are outlined (dashed blue in diagrams). A bar under the
diagram info shows *N selected* with their names, **Actions…** and
**Clear**. Right-clicking any selected element (in the tree, a diagram or
the basket) opens one menu for all of them:

* *Diagram of the selection*, *Diagram with neighbours*, *Explore*.
* *Add to diagram* (+N not shown yet, or *✓ All in diagram*), *Hide from
  diagram*.
* *Impact analysis of all of them* and *Dependencies of all of them*: one
  analysis with every selected element at level 0
  (`d=im~459.502~i~5`).
* *Add to basket*, *Remove from basket*, *Copy names*, *Clear selection*.

Dragging one of them in a generated diagram moves them all (see *Moving
elements*).

A plain click on an item, or Escape, ends the selection. Ctrl-clicking a
second element keeps the element that was selected before.

### Diagrams (centre pane)

Diagram sources:

| Source | How |
| --- | --- |
| **Stored view** | Select a view in the tree (or *Show view*). |
| **Element neighbourhood** | *Neighbourhood diagram* on an element/relationship; depth 1–3 (toolbar). |
| **Neighbourhood with relationship types** (2.33.0, API 3.24.0) | *Neighbourhood with relationship types…* on an element: the depth, and for incoming and for outgoing relationships either all types or the ones ticked, e.g. every incoming relationship but outgoing only *Serving* and *Realization*. The types are followed at every step; the diagram shows every relationship among the elements reached. The title names the types, the link keeps them, and the toolbar's depth and *Follow* still apply. The last choice is remembered in this browser. |
| **Element type** | Select a type node → *Diagram of these elements*. |
| **Layer** | Right-click a layer (*Business*, …) → *Diagram of the layer*. |
| **Relationship type** | Right-click a type under *Relationships* → *Diagram of the N relationships*: their ends, connected by that type only. |
| **Basket** | Collect elements (*Add to basket*, *Add view elements to basket*, *Add all to basket*) → *Diagram of basket* or *+ neighbours*. |

Tabs:

* **Diagram** (default): drawn in the browser by `js/viewsvg.js`, with
  ArchiMate notation (layer colours, type icons, diamonds, triangles,
  dashed/dotted lines, access arrows). Mouse-wheel zoom, drag to pan; click
  a node or relationship to open its details. **Nothing leaves your machine.**
  * **Size:** a diagram is shown whole, shrunk when it is larger than the
    pane, but never enlarged beyond its own size (one diagram unit per
    pixel): a diagram of one or a few elements shows them at the size they
    have in any other diagram, in the middle of the pane. While nothing is
    zoomed or panned, the view follows the size of the pane; *Fit* returns
    to it. Zooming in further is always possible.
  * **Minimap:** after zooming in so that part of the diagram is off screen,
    an overview appears in the bottom-right corner. The blue frame marks
    what you see; click or drag in the overview to move there. The **Map**
    button (top right) turns it off or on (remembered).
  * *Stored views* use their own coordinates, bendpoints and colours.
  * **Right-click an element** in the diagram for its context menu.
    * **In a stored view:** the same actions as in the model tree, such as
      Details, Neighbourhood diagram, Explore, *Add to new diagram*, Impact
      analysis, Dependencies, the basket, Show in tree or folders, and Copy
      name.
    * **In a generated diagram:** the explorer actions come first: show
      related elements (all, outgoing, incoming, or per relationship type)
      and Hide. The same general actions follow.
  * **Right-click a box that isn't a model element** (stored views). The
    menu offers what the box has:
    * **Drill-down link:** *Open view*, *View details*, *Editable copy of
      that view*, *Automatic layout of its elements*, *Add its elements to
      basket*.
    * **Group or container with nested elements:** *Diagram of the N
      elements inside*, *Editable copy of the group (keeps the
      arrangement)*, *Add the N elements inside to basket*.
    * **Label or note:** *Copy text* and *Copy documentation*; for a label
      showing an element or relationship, also *Details of …*.

    An element box that also links to a view gets *Open linked view* at the
    top of its element menu. Boxes with nothing to offer fall back to the
    background menu.
  * **Right-click the background** (empty canvas):
    * **View:** *Fit to window*, *Zoom 100 % here* (one diagram unit per
      screen pixel, centred on the click), *Zoom in here*, *Zoom out*,
      *Show/Hide overview map*.
    * **Generated diagrams:** *Tidy*, *Undo*, *Reset layout*, *← Back*,
      *Layout options…*, *Show the N hidden relationships* (after *Hide this
      relationship*), and *Add basket here* (the basket's elements are
      dropped at the clicked point).
    * **Selection:** *Clear highlight* (after highlighting a path), *Select
      all elements*, *Selection (N)…* and *Clear selection*.
    * **Any diagram:** *Clear diagram*, *Copy link*, *Download .svg/.png*.
    * **Stored views also:** *View details*, *Automatic layout of its
      elements*, *Editable copy (keeps the arrangement)* (a generated diagram
      laid out like the view, which can then be expanded, dragged and tidied),
      *Add its elements to basket*, and *Basket in a new diagram*. The view's
      menu in the tree has the same actions.
    * **Notes in an editable copy** (CM-14): the copy keeps the view's notes
      (text boxes that are not links to other views) where the view has
      them, and the lines between notes and elements. A note can be dragged
      like an element, its lines follow; right-click it for *Hide note* and
      *Copy text*. A line goes when either of its ends is hidden (hiding an
      element keeps its notes); *← Back* brings both back. Groups of the view
      are not copied, and the PlantUML tab shows no notes. *Automatic layout
      of its elements* keeps the notes and their lines too, placed by the
      layout (`d=el~…~<view>.<note>…`).
  * **Right-click a relationship** (its line, or the small dot that stands
    for a relationship other relationships attach to) in any diagram:
    * Details, *Source: …* and *Target: …* (select that end, which can
      itself be a relationship).
    * *Diagram of both ends*, *Neighbourhood diagram*.
    * *Add to diagram (both ends)*, or *✓ Both ends in diagram*.
    * *Show the N relationships attached to it*: when other relationships
      connect to this one, adds the elements at their other ends, so they
      are drawn from a dot on its line.
    * *Select both ends*, *Add both ends to basket*, *Show in tree*, *Copy
      name*.
    * **Diagram only:** *Highlight the &lt;type&gt; path through it* follows
      relationships of the same type in the diagram, forwards from its
      target and backwards from its source (Association: both ways), and
      dims everything else. A click on the background or Escape clears it.
      *Hide this relationship* (generated diagrams) removes the line and
      keeps the arrangement. The diagram becomes an explorer diagram that
      remembers the hidden relationships (`d=ex~…~…~<relationship ids>`);
      the background menu shows them again.

    The model tree and search results offer the same menu for relationships,
    without the diagram-only items.
  * **Right-click a legend entry** (colour by property, or distance in
    impact diagrams): *Select these elements*, *Add them to basket*,
    *Diagram of them*. For a property legend also *Only elements where
    &lt;property&gt; = this value*, *Hide elements with this value* (*does
    not equal* filter), *Remove the property filter* and *Stop colouring
    by &lt;property&gt;*. In a stored view, what the filters leave out is
    faded.
  * **Right-click the overview map:** *Centre the view here*, *Zoom in
    here*, *Fit to window*, *Hide overview map*.
  * **Right-click the diagram title** (or the breadcrumb trail): *Copy
    link*, *Copy title*; for views *View details*, *Show in tree* and
    *Back to “…”* for each view on the trail; *Download .svg/.png*.
  * **Right-click *← Back*** for the earlier explorer steps (newest first,
    e.g. *2. Explorer: ERP Core (51 elements)*); pick one to jump straight
    there.
  * *Generated diagrams* (neighbourhood, basket, type, folder, impact) are
    laid out automatically by **ELK**, the Eclipse Layout Kernel (see
    *Automatic layout* below).
* **PlantUML** (optional): the same diagram rendered by the configured
  PlantUML server with the ArchiMate stdlib macros. It is rendered **only
  when you open this tab** (or click *Render with PlantUML*), because the
  source, including element names, is sent to the server. The tab you used
  last is remembered. The PlantUML image is clickable: the SVG is fetched and
  inlined after removing scripts and event handlers. Clicking an element or
  relationship opens its details, and clicking empty space switches between
  fit-to-width and actual size. Right-click opens the same menus as in the
  native diagram (2.18.0): an element's, a relationship's, a linked view's,
  and on empty space the diagram's. If the server does not allow CORS, a plain
  `<img>` is shown instead (not clickable). For stored views, nesting is
  kept (parents become `rectangle … { }` blocks).
* **Source**: the PlantUML text, for export (*Copy source*, *Download
  .puml* in the *Share* menu) or editing. *Render edited source* renders it in the PlantUML tab.

### Several diagrams in tabs

Several diagrams can be open at once (BR-15). A diagram opens in the tab
shown, replacing what it showed, as it always did. To keep it and open the
next one beside it:

* the **⧉** button at the end of a menu entry that opens a diagram
  (*Neighbourhood diagram*, *Explore*, *Add to diagram*, *Impact
  analysis*, *Diagram of folder*, *Open view* …; 2.16.0). *Add to
  diagram* ⧉ makes a new diagram of the elements;
* **Ctrl-click** (Cmd-click on a Mac) or **middle-click** such an entry,
  or a button of the details pane that opens a diagram;
* *Duplicate in a new tab* and *New empty tab* in the menu of the diagram's
  background.

The **tab bar** above the diagram shows the open diagrams, also a single
one (2.16.0):

| Action | Does |
| --- | --- |
| Click a tab | Shows it. Its drawing was kept: zoom, moved elements, *Undo*, the explorer's *← Back* are as you left them |
| × or middle-click on a tab | Closes it (not the only one), after a question when it has a diagram (2.19.0) |
| Right-click a tab | *Duplicate*, *Copy link*, *Close*, *Close the others* |
| **+** | A new tab with an empty diagram |
| ← / → on a focused tab, Delete | Moves between tabs, closes one (after the same question) |

Each tab has **its own diagram filters, property options (label, colour,
filter by a property) and layout options**; a new tab starts with those of
the tab it was opened from, and the panels show those of the tab shown.
Diagram options (direction, depth, nesting) apply to every tab. The URL,
*Copy link* and the stored layouts describe the tab shown, so a link still
shares one diagram. Two tabs with the same diagram share its stored manual
layout; *Undo* is per tab.

The open tabs are kept for the model in this browser tab (sessionStorage)
and come back after a reload: the tab of the URL is drawn, the others when
they are first shown. At most 15 tabs can be open.

How it works: every tab is a *document* (`js/app/state.js`) with its own
diagram, drawing, layout, explorer history and options; `js/app/tabs.js`
opens, shows, closes and restores them. A layout or a view that is still
loading keeps the document it was started for, so its result lands in its
own tab even when another one is shown by then.

### Automatic layout (ELK)

Generated diagrams use ELK's *layered* algorithm, running in a Web Worker so
the page stays responsive (`js/elklayout.js`, vendored library in
`vendor/elk/`, EPL-2.0):

* **Orthogonal edge routing**, with relationship labels placed by ELK.
  Direction follows the toolbar (top → bottom / left → right).
* **ArchiMate reading order:** Serving, Realization and Specialization are
  laid out against their arrow direction. What is served or realised sits
  above its provider, and the general concept above the specialised one,
  similar to layered ArchiMate views. Arrows are still drawn source → target.
* **Hub-friendly layering:** neighbourhoods are often stars, e.g. one
  component with 40+ neighbours. Up to 150 elements, ELK's Coffman-Graham
  layering bounds each layer to about √n elements, giving roughly a 1.6
  aspect ratio. For ERP Core at depth 1 that's 2,662×1,582 px instead of a
  4,571 px wide single row. Larger diagrams use ELK's default layering,
  which is much faster: 543 elements in about 1.2 s.
* **Hubs (bundled edges):** an element with 5 or more relationship ends gets
  one *port* per relationship type and side. All Assignments leaving ERP Core
  start from one point and run together as a trunk, instead of forming a
  "comb" of 40+ parallel lines. In the ERP Core neighbourhood, 52 ends share
  10 points. Containers (see nesting) get no ports: ELK can't combine ports
  on compound nodes with its network-simplex placement.
* **Component packing:** unconnected parts of a diagram are laid out
  separately and packed into rows. With nesting, the 543-element
  Application folder shrank from 33,050×4,523 px to 7,727×7,176 px.
  Isolated elements skip ELK.
* **Speed:** up to 100 nodes per component use network-simplex placement
  (most compact). Larger ones use linear segments (110 nodes: 1.3 s instead
  of 6.6 s). Above 150 they use ELK's default layering. If ELK rejects an
  option combination, the layout is retried without hub ports, then with
  Brandes-Köpf placement.
* **Highlights:** focus elements (the start of a neighbourhood or impact
  analysis) get a bold outline. Relationships on relationships use the same
  helper dot as in PlantUML (BR-6), placed inside the innermost container
  holding both ends. Property colours, labels and legends apply as before.
* Typical timings: 51 elements in under 1.2 s, 109 elements / 158
  relationships in about 1.3 s, 543 elements in 2–6 s. A *Laying out…* note
  is shown meanwhile.
* **Download .svg** and **Download .png** (*Share* menu) save the whole native diagram,
  whatever is zoomed into. Both work for stored views too, unless the
  PlantUML tab is in front, which downloads PlantUML's own image instead.
  * **SVG:** self-contained (inline icons and styles).
  * **PNG:** drawn in the browser at 2× resolution. Very large diagrams are
    scaled down to at most 16,000 px per side and 100 megapixels, which
    browsers accept. For example, 600 elements became 15,358×6,511 px at
    73 % in about 1 s. The status bar reports the size and any reduction.
  * Selection and hover highlights are not exported; the focus outline is.
* **Copy image** (*Share* menu) puts the same PNG in the clipboard, to paste
  into a document or a chat (PlantUML's PNG when the PlantUML tab is in
  front). It needs a browser that allows writing images to the clipboard
  (Chrome, Edge, Firefox 127+, Safari); otherwise it is disabled.
* **Download elements as CSV** (*Share* menu): one row per element shown,
  semicolon-separated, UTF-8 with BOM, so that Excel with Czech regional
  settings opens it in columns. Columns: `id`, `xmiIdentifier`, `type`,
  `layer`, `name`, `documentation`, `folder` (its path, `A › B`; the first
  place of an element filed more than once) and `properties`, a JSON object
  (`{"Owner":"Finance","Cost":"1200"}`; a property with values in several
  languages is `{"cs":"…","en":"…"}`, repeated values a list).
* **Download as JSON** (*Share* menu): what the diagram shows, without
  coordinates: `diagram` (title, kind, link, model, the stored view or the
  view an editable copy's notes come from, the filters, the time),
  `elements` (as in the CSV), `relationships` (type, name, documentation,
  source and target, access type, influence modifier, direction,
  properties), `notes`, `groups` (label and the elements inside),
  `viewLinks` (boxes that open another view) and `lines` (plain lines;
  their ends are `{"element": id}`, `{"note": xmiIdentifier}`, `{"group":
  label}` or `{"viewLink": viewId}`). In a stored view, what the filters fade
  is marked `"faded": true`; in a generated diagram, what they hide is not
  in it.

### Nesting in generated diagrams (optional)

*Layout* tab → **Nesting**: *Off* (the default), *Composition and
Aggregation*, or *Only inside a Grouping*; *… and Assignment too* adds
Assignment to either. When on, generated diagrams (neighbourhood, basket,
type, folder, impact) draw these relationships as Archi does: the parent
element becomes a box containing the child, and the relationship is not
drawn as a line. With *Only inside a Grouping* (API 2.9.0,
`nesting.containerTypes`), only a Grouping is drawn around its parts; the
other Composition and Aggregation stay lines.

The choice is remembered in this browser and travels with diagram links
(`n=`, see *Moved elements*): a link opens with the nesting it was copied
with.

* **Nesting rules** (`js/nesting.js`): the relationship's source is the
  parent and its target the child. Each element gets at most one parent
  (Composition before Aggregation before Assignment, then by id), and
  cycles are skipped. Junctions are never nested. Relationships that other
  relationships attach to stay lines.
* Other relationships between an element and one of its ancestors can't be
  drawn (the line would run inside the box); they are left out and counted
  in the info line, e.g. *“41 relationship(s) shown as nesting, 1 more
  between nested elements not drawn”*.
* **Layout:** ELK hierarchical layout (`INCLUDE_CHILDREN`) in absolute
  coordinates. Each container bounds its own layers to about √k children,
  so 26 functions assigned to one component form a block (1,198×677 px)
  rather than a 2,105 px row.
* The **PlantUML** export nests the same way (parents become
  `rectangle "Name\n«Type»" { … }` blocks).
* Stored views always keep their own nesting. Changing the choice re-renders
  the current generated diagram.

### Explorer: growing a diagram step by step

**Explore** (element details, or the basket) starts a diagram with just
the chosen element(s). A single element starts with its related elements
too if there are at most 12. You then grow the diagram from there:

* **+N badge:** each element shows how many related elements are not in the
  diagram yet. Click the badge, or double-click the element, to add them.
  The count follows the toolbar's *Follow* setting and the active filters.
* **Right-click** an element for choices:
  * *Show all related*, *outgoing →* or *incoming ←*.
  * One relationship type in one direction, e.g. *← Serving +5* or
    *Assignment → +23*; types are listed with their counts, biggest first.
  * *Hide from diagram*, *Collapse* (below) and *Details*.

  The menu works with the keyboard (arrow keys, Enter, Escape). The details
  pane also offers *Expand in diagram (+N)* for elements in the current
  diagram.
* **Collapse and show one level** (2.28.0, right-click an element of a
  generated diagram): what hangs off the element folds away as with
  *Collapse*, then its directly related elements are shown (the *Follow*
  direction and the filters apply); one step, which *← Back* undoes.
* **Collapse** (right-click an element, also in any generated diagram):
  folds away the element's related elements and whatever hangs off them,
  but keeps the way to the **selected element** (the one you last clicked):
  *Collapse, keeping the way to ERP*. On the selected element itself, or
  with nothing selected and no start element shown, it is *Collapse around
  this element*: everything connected to it folds away. The diagram need not
  be a tree: an element still connected to the selected one another way
  stays, and so do elements not connected to the collapsed one at all. The
  way kept is the shortest; two equally short ways both stay. The entry
  shows how many elements fold away (disabled at 0); the element then has
  its +N badge again, and *← Back* undoes the step. Lines between the
  elements that stay are kept.
* **Any generated diagram can grow:** double-clicking or right-clicking an
  element in a neighbourhood, basket, type, folder or impact diagram turns
  it into an explorer diagram. Each of them shows the +N badges too
  (2.19.0; before, only explorer diagrams did).
* **Stable arrangement:** elements already shown keep their row and order.
  The current positions are fed to ELK's interactive strategies (as in
  *Tidy*), and new elements are hinted next to the element they came from.
  They go after it in the layered order when the relationship points that
  way (e.g. its Assignment targets) and before it otherwise (e.g. the
  elements it serves). Large expansions wrap into rows of about √n
  elements. New elements flash green briefly.
* **With nesting on**, a newly added container wraps the shown elements it
  now contains where they are. For example, adding *Billing Robot* puts its
  box around *Send Notification to Customer*. A new element that belongs in a
  shown container goes inside it, below its current content.
* **ELK workaround:** elkjs 0.12.0 swaps the width and height of
  containers when nesting is combined with its interactive strategies (used
  by explorer steps and *Tidy*) in a top-to-bottom layout. Such layouts are
  therefore computed left-to-right on the transposed graph and transposed
  back, which gives the same layered result.
* **Large expansions:** when an expansion at least doubles the diagram, a
  fresh automatic layout is used instead, which reads better. ERP Core's 50
  related elements get the same layout as its neighbourhood diagram.
* **← Back** (top right of the diagram) steps back through expansions,
  hides, additions and clears, up to 50 steps.
* **Clear diagram** (tools on the diagram, or its right-click menu) asks
  *Are you sure?* and then empties the diagram (`d=ex~~`). Build your
  own from there: select an element in the tree (or search, details, a
  diagram) and choose **Add to diagram** in its details.
  * If an element related to it is already shown, the new one goes next to
    it, as with an expansion. Otherwise it starts a column right of the
    diagram.
  * With a stored view open, or no diagram yet, it starts a new diagram with
    that element.
  * The button reads *✓ In diagram* when the element is already there.
  * An element added explicitly is kept even if the diagram filter hides it;
    the status bar says so.
  * Hiding the last element leaves an empty diagram.
* **Drag & drop:** drag an element from the model tree or the search
  results onto the Diagram tab. A dashed outline and *Drop to add to the
  diagram* show where it can go.
  * The drop point counts: the element joins the row you drop it on (or a
    new row between rows), in the order implied by the horizontal position.
    It is a layout hint for the interactive layout, so the rest of the
    diagram keeps its arrangement.
  * Dragging a **relationship** adds the elements at both of its ends.
  * Dragging a **folder** adds all elements filed in it, sub-folders
    included; an element **type group** (e.g. *Application Component*)
    adds all elements of that type. Folders without elements can't be
    dragged.
  * **Basket:** drag a basket row to add that element, or the *Elements*
    group or the *Basket: N elements* label to add the whole basket.
  * **Search results:** drag the *Elements* group to add the found
    elements (as *Diagram of the results* in its menu), or the
    *Relationships* group to add the ends of the found relationships (as
    *Diagram of their ends*), or the *Views* group to add the elements shown
    in the found views (as *Diagram of their elements*).
  * **Views:** dragging a stored view adds the elements shown in it, keeping
    the view's arrangement. Their positions in the view, centred on the
    drop point, become the layout hints, so the result keeps the view's rows
    and their order, tidied by ELK.
    * For *Order Handling View* (24 elements), all 32 left/right pairs
      within rows were kept, and 221 of 243 above/below pairs. The rest move
      where relationships form cycles that ELK has to break.
    * This also applies to an empty diagram, so *Clear diagram* plus a
      dragged view gives an automatically tidied copy of the view that you
      can expand.
    * Elements the diagram already has stay where they are. Labels, groups
      without an element and view references are not added; nor are
      relationships that aren't in the model (only real model
      relationships are drawn).
  * Many elements at once wrap into rows of about √n below the drop point,
    which become rows of the layout. If they at least double the diagram,
    a fresh automatic layout is used instead, as with explorer expansions.
    More than 400 elements in total ask for confirmation.
  * Unconnected elements that would land on top of the existing diagram
    are moved below it. To put them above, drop them above the diagram's
    top edge (zoom out or pan first).
  * Dropping onto a stored view, or with no diagram, starts a new diagram.
  * Elements already shown are reported, not duplicated; the status bar
    names the source, e.g. *Added 14 elements of folder Application › Order
    domain (1 already shown)*.
* **Links and reloads:** an explorer diagram is a diagram definition
  (`d=ex~<start ids>~<shown ids>`), and its arrangement is stored as a manual
  layout (`m=`). Reloading or sharing the link reproduces it exactly.
  Dragging, *Tidy*, *Undo* and *Reset* work as in any generated diagram.
* Exporting, PlantUML and the minimap work as usual; the +N badges are not
  exported.

### Layout options and moving elements

**Layout** (a tab above the diagram) opens a panel for generated diagrams (stored views keep
their own coordinates):

* **Presets:** *Compact* (60 % spacing), *Balanced* (default) and *Readable*
  (160 % spacing, plus more effort on avoiding crossings). The **Spacing**
  slider (40–250 %) scales all ELK distances between elements, lines and
  unconnected parts.
* **Strategy** overrides the size-dependent defaults:
  * *Layers:* bounded width (Coffman-Graham), shortest edges (network
    simplex) or longest path (fewest layers).
  * *Placement:* network simplex, Brandes-Köpf or linear segments.
  * *Lines:* orthogonal, polyline or curved (splines).
  * *Bundle at busy elements:* turns the hub ports on or off.
* **Labels → Relationship names** (2.32.0) draws the names of relationships
  next to their lines, or not. It applies to every diagram, stored views
  included, at once and without a new layout, and to *Download .svg/.png*
  and *Copy image*; it is remembered in this browser.

  Any change re-lays the diagram. The button shows the active preset
  (*Layout: Readable*, or *Custom*).

**Moving elements:** drag an element in the Diagram tab; dragging empty
space still pans. Its relationships fade while you drag and are re-routed
orthogonally on drop, attached to the facing sides of both elements and
spread along each side. A container moves with everything nested in it, and
grows when a nested element is dragged past its edge. Dragging one of the
selected elements moves all of them (one step for *Undo*); dragging an
element that is not selected moves only that one.

Three buttons, top right of the diagram and in the panel:

* **Tidy:** runs ELK again with the current positions as hints, using its
  *interactive* strategies. Elements stay in the row (or column) and order you
  dragged them to, and everything else is re-arranged around them with clean
  routes. For example, dragging an element past the right end of its row
  keeps it last in that row.
* **Undo:** reverts the last move, Tidy or Reset (up to 50 steps).
* **Reset:** forgets the manual layout.

Manual positions are **remembered per diagram** in this browser
(`localStorage`, key `archixmi-manual-layouts`, the 200 most recently changed
diagrams). A diagram here means its definition, filters, property options,
direction, nesting mode and layout options together. They are also part of
the diagram link, so **Copy link** shares the arrangement:

| Parameter | Meaning |
| --- | --- |
| `lo=s1.6_t20_la_pa_ro_h1` | layout options: spacing, thoroughness, layers, placement, lines, hubs (omitted for *Balanced*) |
| `n=3` | nesting: `0` off, `1` Composition and Aggregation, `2` and Assignment, `3` and `4` the same only inside a Grouping (in every link to a generated diagram) |
| `m=TB.n0!<hints>!<pins>` | manual layout: direction and nesting mode it belongs to, then `e<id>.<x>.<y>` positions joined by `_` (hints after Tidy; pins for moved elements) |

Opening a link with `m=` adopts its direction, nesting mode and layout
options, and one with `n=` its nesting. A link with neither `lo=` nor `m=`
keeps the reader's own layout options; one without `n=` (copied before) the
reader's nesting. With hints for all elements, a link grows to about 15 characters
per element (1.6 kB for 109 elements).

### Notation in the Diagram tab

* **Element shapes (ArchiMate rectangle notation):**
  * Behaviour (processes, functions, interactions, capability, course of
    action, work package): rounded corners.
  * Services: pills.
  * Events: notched left, pointed right.
  * Value stream: chevron.
  * Motivation elements: cut corners. Value is an ellipse, Meaning a cloud.
  * Business/data object: header band. Contract: two bands. Product: a
    small tab.
  * Representation and deliverable: wavy bottom.
  * Artifact: folded corner. Technology node: 3D box.
  * Grouping: dashed with a name tab.
  * Junctions: fixed 15 px dots, whatever box the view stores.
  * Everything else: rectangle.

  The type icon stays inside curved or cut outlines.
* **Stored view styling** (Open Exchange Format):
  * Fill and line colours, with their *alpha* (percent) as opacity, and
    line width.
  * Font family, size, bold/italic/underline/strikethrough and colour, for
    nodes and connection labels. 9 pt, Archi's default, renders at 11 px as
    before.
  * Connection *source/target attachment points* (absolute).

  Text position/alignment isn't part of the exchange format or the API (see
  API-12 in IMPROVEMENTS.md), so labels are centred, or at the top for
  containers and groupings.

Toolbar: layout direction (top→bottom / left→right), neighbour depth and
**Follow** (both directions / outgoing → / ← incoming). An open
neighbourhood diagram re-renders when either changes. *Outgoing* follows
relationships from source to target (what an element serves, realises,
triggers…), and *incoming* follows them backwards (what it depends on or is
served by). Then **Filters**,
**Copy link**, copy source, download `.puml`, download `.svg` (PlantUML image
or native layout), and open image in a new tab. A line under the basket
summarises the diagram, e.g. *“46 elements · 70 relationships · filter
“Application Cooperation” hides 5 element(s) …”*.

### Diagram filters

*Filters* opens a panel that controls which **element types** and
**relationship types** appear in generated diagrams (neighbourhood, basket,
element type):

* **Viewpoint presets:** Organization, Business Process Cooperation,
  Application Cooperation, Application Usage, Technology Usage, Layered,
  Information Structure, Motivation, Strategy, and Implementation & Migration.
  Their element sets are *simplified* from the ArchiMate 3.1 basic viewpoints
  (see `VIEWPOINTS` in `js/filters.js`). Editing a preset makes it *Custom*.
* **Layers:** one checkbox per layer (shows a partial state when only some
  of the layer's types are on). **Element types:** individual types, grouped
  by layer, each layer with its own *all* / *none* (2.28.0).
  **Relationships:** the 11 relationship types. Each group has *all* /
  *none* shortcuts.
* **Hide relationships** (2.17.0, API 3.13.0): rules that leave out
  relationships by their type and the element types of their ends, e.g.
  *Flow from Node to Node*, or *any from Application Service to any*.
  Choose the type, the source and the target type (each *any* by default;
  the element types are grouped by layer) and *Hide*; × on a rule shows
  them again. *Serving from Application Service to Business Process* hides
  those Serving relationships only and keeps the others. The menu of a relationship in a
  diagram or the tree offers the rule for relationships like it: *Diagram
  filter: hide Flow: Node → Node*. In a stored view they are faded.
* Filters also steer the **neighbourhood walk**: hidden relationship types
  are not followed, and hidden elements are neither shown nor expanded
  further. The focus (seed) elements are always shown.
* **Stored views** keep their layout: what the filters leave out (element
  types, the property filter, relationship types) is **faded**, and so are
  the lines that end on a faded element. The info line counts them
  (*faded by the filters: 3 element(s), 1 relationship(s)*). This is in the
  *Diagram* tab; the PlantUML rendering of a stored view is not faded.
* The current filter is remembered in this browser and changes re-render the
  open diagram immediately.
* **Right-click a chip** (layer, element type or relationship type): *Only
  this …*, *All except this*, *All element/relationship types*, *Reset the
  filter*; element types and layers also offer their diagram.
* **Saved filters:** right-click the *Viewpoint* list for every preset
  (✓ marks the current one), your saved filters, *Save the current filter
  as…* and *Delete saved “…”*. Saved filters appear in the list under
  *Saved filters* and by name on the *Filters* button. They are kept in
  this browser's settings.

### ArchiMate icons (sprites)

Element and relationship types are shown with their ArchiMate icon next to
the text acronym (e.g. `[icon] Cmp`). This applies to tree badges, details,
basket chips, the filter panel, the impact panel and relationship lists. In
*Diagram* tab diagrams the icon sits in each element's top-right corner, as
in ArchiMate notation, with the acronym as fallback.

* **Source:** `inputs/archi_sprites.svg`, PlantUML's `listsprites` output for
  the ArchiMate stdlib (credit: archimatetool.com). It contains 139 sprites:
  116 vector paths and 23 embedded 15×15 PNGs.
* **Licence:** the icons are not covered by this project's MIT licence.
  PlantUML (GPL-3.0-or-later by default, also LGPL, Apache 2.0, EPL 2.0 and
  MIT at the user's option) holds them as built-in sprites and credits them
  to Archi (MIT); neither names the icon files separately, and the files
  carry no licence of their own. [img/sprites/NOTICE.md](img/sprites/NOTICE.md)
  has the details and the links.
* **Extraction:** `python tools/extract_sprites.py` (stdlib only, re-runnable)
  writes one file per sprite to `img/sprites/<name>.svg|.png`, plus:
  * `img/sprites/sprites.json`: manifest with file names and inline data
    (path data or PNG data URI). Diagrams embed icons from it, so
    downloaded SVGs stay self-contained.
  * `img/sprites/index.html`: a gallery showing every sprite on white and
    on a layer colour.
* **Processing:**
  * Vector sprites get a square, tight viewBox from the path's exact
    bounding box. Lines, Béziers and arcs are sampled; checked against the
    browser's `getBBox()` for all 116.
  * PNGs already had transparent backgrounds.
  * Three PNGs drawn in business yellow with an olive outline
    (`business-activity`, `business-meaning`, `business-value`) were
    converted to black ink on transparent, matching the rest of the set.
* **Backgrounds:** sprites are black line art, so in the UI they always sit
  on a light background. Element icons use the layer colour of their badge;
  relationship icons use a light grey chip. This keeps them visible in dark
  mode and on the selected (blue) tree row.
* **Mapping:** `ELEMENT_SPRITES` / `RELATIONSHIP_SPRITES` in `js/archimate.js`
  use the layer-specific variants, e.g. `application-data-object`,
  `technology-system-software`, `motivation-value`, `strategy-course-of-action`.
  A directed association uses `association-unidirect`. All 62 element types
  and 11 relationship types are mapped. If `sprites.json` is missing, badges
  fall back to text only.

### Folders

The folders of the model's `<organizations>` are loaded along with the
model, with what each holds; what is filed in a folder is asked for when it
is needed:

* **Tree:** *Folders* shows the folder hierarchy (sub-folders first, then
  the filed elements, relationships and views, each kind in the folder's
  order, asked for when the folder opens). Each folder shows its recursive
  content count (*58 el · 12 rel · 3 views*, or *empty*). A filed view is a
  view row like those of the *Views* branch: select it to open the view,
  expand it to see its nodes.
* **Folder details:** the path, direct and recursive counts, sub-folders,
  and the element types inside. Actions: **Diagram of folder** (all
  elements in the folder and its sub-folders, with the usual filters,
  `d=fo~<id>`), **Add N element(s) to basket**, and *Show in tree*.
* **Element and relationship details** show a **Folder** row, e.g.
  📁 *Application › Sales domain › Data Object*, with clickable folders, plus
  **Show in folders**, which reveals the item in the Folders branch. The
  default *Show in tree* still uses the Elements and Relationships branches.
* Deep links: `#model=1&folder=<id>`.

### Paths between two elements

*Paths from here…* in the menu of an element, then *Paths from … to here* in
the menu of another, draws the **shortest paths** between the two: up to
three, each at most six relationships long, with everything that lies on
them. With exactly two elements selected, the selection menu offers *Paths
between the two*. The direction of relationships is ignored, junctions
count as elements of a path, and a path may lead over a relationship that
ends on a relationship. The diagram is a generated diagram like the others:
it can be grown, rearranged and shared (`d=pa~<from>~<to>`). When there is
no such path, the status line says so and the current diagram stays.

### Impact analysis

Element details contain an **Impact analysis** panel. The API finds the
transitive closure from the element over selected relationship types, using
ArchiMate dependency semantics (shown in the panel from `PROPAGATION` in
`js/impact.js`):

| Relationship | A change propagates |
| --- | --- |
| Serving, Realization, Assignment, Flow, Triggering, Influence | source → target (the target depends on the source) |
| Composition, Aggregation | part (target) → whole (source) |
| Access | data (target) → behaviour (source) |
| Specialization | general (target) → specialised (source) |
| Association | both ways |

* **Impact (what depends on it)** follows the propagation direction.
  **Dependencies (what it needs)** follows it backwards.
* **Max depth** 1–10. The result says when more would be found beyond it.
  Default relationship types: Serving, Realization, Assignment,
  Composition, Aggregation, Access, Flow and Triggering. Influence,
  Specialization and Association are off by default; *defaults* resets
  them. The panel's settings are remembered.
* Junctions are pass-through and don't add a level. A relationship endpoint
  that is a relationship resolves to that relationship's elements.
* **Results** are listed by level, each showing where it was reached from
  (e.g. *from Admin Portal —Serving→*). Actions: **Impact diagram** (the start
  element plus everything found, drawn along the traversed relationships
  only and coloured by distance, unless property colouring is on;
  `d=im~<id>~i|d~<depth>[~types]`), **Add to basket**, and **CSV**
  (level, name, type, layer, via relationship, from, XMI identifier;
  the API writes it, with the semicolon since API 3.2.0).
* **Several start elements:** select them (see *Selecting several
  elements*) and choose *Impact analysis of all of them* or *Dependencies
  of all of them*. All start at level 0; each element found is listed once,
  at its shortest distance from any of them.
* Type and property filters are not applied, because the analysis should
  be complete. The info line says so when filters are active.

### Reports

The model menu (⋮ in the top bar) has three reports, computed by the API
(3.6.0 or newer; an older API answers with a note that the report needs it).
They open in a wide dialog; what they list leads back into the model: a
name selects the element (or opens the view) and closes the dialog,
*Diagram* draws the elements as a generated diagram.

* **Quality report:** what is probably unfinished or wrong, one section per
  check with its count: elements in no view, elements without
  relationships, elements, relationships and views in no folder, elements
  of one type with the same name, views without nodes, empty labels
  (drill-down links whose view was deleted), and, with API 3.7.0,
  relationships ArchiMate does not allow between the types of their ends
  (each named with its ends and their types). Each list shows up to 200
  items; element lists have *Diagram* for all of them.
* **Relationship matrix:** rows and columns are each an element set: the
  basket, the elements of the diagram, a layer, or an element type of the
  model. They are connected *directly* (a relationship type or any, and a
  direction) or *along a path* of two or three steps (e.g. Realization →,
  then Serving →: components that realize a service that serves a process).
  The grid shows how many paths connect each pair; a number lists its paths
  (*Billing Module —Realization→ Billing Service —Serving→ Order Handling*)
  with *Diagram* of their elements. *Download as CSV* gets the grid from the
  API, semicolon-separated like the other downloads.
* **Landscape map:** the elements below root elements (an element set) as
  nested boxes: along Composition and Aggregation, optionally with the
  elements that realize them or are assigned to them, up to 1 to 6 levels.
  *Colour by* colours the boxes by a property, with a legend. An element
  that also lies below another element has a dashed border; every element
  is shown once, under its preferred parent. *Diagram* in a box draws it
  with everything below it.

### Import and delete models

* **Rename model…** (2.30.0, the model's details and menu, admin) changes
  its name and documentation.
* **New model…** (2.28.0, ⋮ model actions, admin) creates a new, empty
  model with a name and documentation, by default with Archi's top-level
  folders (Strategy, Business, Application, Technology & Physical,
  Motivation, Implementation & Migration, Other, Relations, Views), and
  opens it. With an editor key (*✎ Edit*) it is then filled in the Browser.
* **Import model…** (⋮ model actions in the top bar) uploads an ArchiMate Open Exchange file
  (`POST /models/import`, multipart) and opens the new model. API errors are
  explained in the dialog: *409* means a model with the same identifier
  already exists, and *422/400* list the validation details.
* **A copy of a model** (API 2.10.0): a model made by copying the file of
  another one keeps its identifier. After the *409*, **Import as a separate
  model** imports it anyway (`asNew=true`); both models then have the
  identifier, and the model's number tells them apart. When several models
  have the file's identifier, the *409* lists them, and the dialog offers
  *Replace “…”* for each, the one with the file's name first.
* **Replacing a model** with a new version of its file, exported again
  from its source (API 2.3.0 and 2.4.0, BL-33, BL-34): tick *Replace the
  model with the file's identifier, if there is one*, or, after a *409*,
  click *Replace it* (or *Replace “…”* for one of several models that have
  the identifier: the replace then goes to that model, `modelId`).
  1. **Preview.** The browser first asks the API what replacing would do
     (`POST /models/import?replace=true&dryRun=true`: the API runs the
     import and rolls it back). The dialog lists, for elements,
     relationships and views, how many would be added, removed and kept;
     what would be added and removed, by name and type with the XMI
     identifier; what would be kept but differs (name, type, property
     values before and after, documentation, ends); the first 15 of each
     (API 3.10.0; an older API gives the XMI identifiers only), and what the
     import would leave out. Nothing is changed yet.
  2. **Confirm.** *Replace the model* replaces the model's content in one
     step (`replace=true`), but only the version that was previewed
     (`expectedRevision`). If the model was changed in between, nothing is
     replaced and the dialog says so; *Import* shows a new preview.
     Choosing another file, or unticking the box, clears the preview.

  A file that fails leaves the model as it was; a file of a model that is
  not there yet is imported at once, without a preview. The model keeps its
  number and is then loaded again. Everything in it may get new ids;
  diagram links, moved elements and baskets name items by XMI identifier,
  so they still fit, and folders are named by their path (see *Basket and
  shareable diagram links*).
* **Import warnings:** the API reports every item and reference of the file
  that it could not import, for example a folder item that refers to
  something that is not an element, relationship or view. The dialog then
  lists them (the first 15) and stays open until you close it; the model is
  imported and opened all the same. A file that validates normally gives no
  warnings.
* **Roles:** import, replace and delete need an API key with the role `admin`. The browser
  asks the API what the key in use may do (`GET /auth/me`) and hides the two
  buttons when it may not. A request the API still refuses (403) is answered
  with a message that names the role of the key.
* **Delete model…** deletes the current model (`DELETE /models/{id}`). The
  dialog shows what will be deleted, and the button only enables once the
  model's **exact name** is typed. Its saved basket is removed too.
  Export the model first if you might need it again.
* Besides the [created views](#created-views-saving-a-diagram-as-a-view-2220) (2.22.0), these are the only
  write operations in the browser. The proxy forwards POST/PUT/DELETE with a 10-minute timeout for large imports.

### Editing (2.23.0)

**✎ Edit** in the top bar turns on editing in this browser tab. It is off
by default, and only a key that may write sees it. Then the details of an
element or a relationship show a form:

* name, documentation and type (an element's: the types of its layer
  first; a relationship's: the types ArchiMate allows between its ends,
  asked of the API);
* a relationship's access type, influence or direction;
* its property values: change one, remove one (✕), add one in the last
  row.

*Save* sends what changed in one request (`POST …/changes`, one
transaction), checked against the version the form was opened with. When
someone saved the item in between, the form says who, when and what, and
offers *Take theirs* or *Save mine anyway*. The record of changes keeps the
earlier values: in *History*, *Put back* copies an earlier name or
documentation into the form.

**Creating** (2.24.0): with Edit on, a generated diagram has a **palette**
at its left, with every element type (by layer, with a filter) and every
relationship type, each with its ArchiMate sprite. Drag an element type onto
the diagram, or click it and then a place, and name it: it is created there
and filed in its layer's folder. For a relationship, click *Connect*, then
the source and the target, and choose one of the types ArchiMate allows
between them; or choose the type first. *New element here…* (the diagram's
menu), *Connect to…* (an element's) and *New … element…* (a type in the
tree) do the same from the keyboard.

**Removing and organising** (2.25.0): *Delete…* an element or a
relationship. It asks first and names what goes with it: the relationships,
and the views it is taken out of. *File in folder…* moves an element, a
relationship or a view of the source to another folder. Folders get *New
folder…*, *Rename…*, *Move to…* and *Delete…*; a folder with contents is
deleted only after choosing where they go, and what is filed in it stays.

Only a model **mastered here** can be edited (API 3.16.0, BL-58): one made
through the API, or imported and kept here. A model linked to a file is
updated from that file and stays read-only; the switch says why. The
model's details show which it is, and how many changes were made here since
the last import. A replace from a file that would undo those changes asks
first and lists them (BL-57). The design is the API's
`BROWSER_EDITING.md`.

### Created views: saving a diagram as a view (2.22.0)

A view is either one of the **model's source** (it came with the imported or
linked file) or a **created view**: one saved here, by the MCP server or by a
script, through the API (3.15.0, BL-56). What a source view shows is never
changed; created views are marked with a pencil (✎) in the tree, the tabs and
the commands. All views are listed directly under **Views** (2.31.0): the
source's in the model's order, then the created views and recipes by name.
Their details say who made them and when (*Created by*, *Created on*), and
which view they copy.

* **Renaming and deleting a view of the source** (2.31.0, API 3.23.0): on a
  model mastered here, *Rename…* and *Delete…* are offered for the views
  that came with the model's file too. Deleting one asks first; a replace of
  the model from a file that has the view brings it back. On a model linked
  to a file its views are changed in Archi.

* **Save as view…** (the button above a generated diagram, or its menu)
  stores the diagram as it is drawn: the positions of the automatic layout
  with your moves, the boxes nested in boxes, the notes of an editable copy
  and the relationships shown. It asks for a name. An *editable copy* of a
  source view saved this way is a copy of it (*copy of view “…”*); the
  source view stays as it is.
* **Edit view** (a created view's details or menu) opens it as a diagram,
  each element where the view has it, with a bar: *Save*, *Save as new
  view…*, *Discard*. Everything a generated diagram offers works there:
  dragging, *Tidy*, adding, expanding, hiding. *Save* writes the diagram
  back into the view; if someone saved it in between, nothing is
  overwritten and the status line says so.
* **Rename…** and **Delete…** (it asks first and cannot be undone).
* When an update from the model's source took elements or relationships
  out of a created view (they are gone, or a relationship now joins other
  elements), its details list them until you *Dismiss* the list.

Only a key that may write sees these actions; a reader key and an offline
copy show created views but offer none of them. The API's
`CREATED_VIEWS.md` describes the rules: an export of the model holds the
created views only on request, and an update from the source keeps them.

Since 2.30.0 a view saved this way keeps where each line meets its boxes
(the connection's attachment points), so the orthogonal lines of the
automatic layout stay at right angles. A view saved before draws a line's
ends towards the middle of its boxes until it is saved again.

### Recipes (2.30.0)

A **recipe** (API 3.22.0) keeps how a generated diagram is made, not how it
was drawn: what it draws and its filters, property options, layout options,
nesting and moved elements, as the diagram's link carries them. Opening it
draws the diagram again from the model as it is then, so new elements and
relationships appear in it.

* **Save as recipe…** (the button above a generated diagram, or its menu)
  asks for a name and documentation. Recipes are listed under **Views**
  (📜) in the tree.
* **Opening one** (a click in the tree, *Open view* in its details) draws its
  diagram. The button above the diagram then says *Save recipe “…”*: it
  writes the diagram as it is now (expanded, filtered, with other options)
  back into the recipe.
* **Rename…** and **Delete…**, as for a created view. Its details show the
  recipe itself.
* Saving, renaming and deleting need a key that may write; opening one
  needs only reading. An offline copy holds the recipes too.

### Recipe scripts (2.33.0)

A **recipe script** (API 3.24.0) makes the recipes of many diagrams at once,
in a few readable lines, e.g. *one diagram for each business service with
Status XY, with every incoming relationship and outgoing Serving and
Realization*:

```
script "Service reviews"
for each BusinessService where @Status = "XY"
  diagram "Service: {name}"
    neighbourhood depth 1
      incoming all
      outgoing Serving, Realization
    layout readable
```

The language is described in the API's
[RECIPE_SCRIPTS.md](https://github.com/rnovicky/ArchiMateAPI/blob/main/RECIPE_SCRIPTS.md).

* **Recipe script…** in the model's menu (the ⋮ next to the model list, the
  model in the tree, or the command palette) opens the editor. It starts with
  an example; what you write is kept in this browser, per model. *Tab*
  indents by two spaces.
* **Check** (*Ctrl+Enter*) asks the API what the script would make and changes
  nothing. Every error is listed with its line and a suggestion ("did you mean
  BusinessService?"); a click on it selects that line. Otherwise the list
  shows each recipe as *new*, *changed* (and what: name, documentation, what
  it draws) or *unchanged*, compared with the recipes the script made last
  time, and the *obsolete* ones that run made and the script no longer makes.
  *Show* draws one in a new tab.
* **Create / update (N)** makes and updates them, in one change. It is offered
  once the script, as it is now, has been checked without errors; *Also
  delete the obsolete recipes* deletes those too. The new recipes appear
  under *Views* (📜), and their details say which script made them.
* **Running it again** updates the script's own recipes instead of making
  them twice, so a script can be kept and run whenever the model changes.
* Checking needs only reading; *Create / update* needs a key that may write.
  An offline copy does not offer scripts.
* **Kept scripts** (2.34.0, API 3.25.0): every run keeps the script with the
  model. *Open a kept script…* above the editor lists them, so a script
  written elsewhere, by someone else or with Claude, is opened, changed and
  run again.

### Editing a recipe as a script (2.34.0)

**Edit as script…** on a recipe (its menu, and a button in its details; API
3.25.0) shows what the recipe draws, its filters and options as the lines of
a recipe script: one `diagram` block, e.g.

```
diagram "ERP landscape"
  neighbourhood of "ERP" depth 2
  hide Junction
  layout readable
```

* *Check* says what saving would change (the name, the documentation, what it
  draws); *Save* writes it into the recipe, which keeps its place and links;
  *Show* draws the checked recipe in a new tab.
* What a script cannot say is listed above the editor and left out when
  saving: positions moved by hand, notes, the Layout panel's layering and
  placement. An explore diagram cannot be written as a script; the dialog
  says so. A documentation of several lines stays out and is kept.
* **A recipe made by a recipe script** is changed in its script, since the
  next run would set it back: *Open the script* opens the kept script with
  that diagram's line selected; *Detach and edit…* edits the recipe alone and
  takes it from the script.

### Images for the MCP server: render mode (2.29.0)

The ArchiMate MCP server (1.12.0) saves diagrams as PNG or SVG files for
reports with its `diagram_image` tool, and the Browser draws them. The MCP
server starts a Browser server of its own (`serve.py --port 0
--exit-with-stdin`, on 127.0.0.1, without a key: every request carries the
key of the MCP server in its header) and opens `…/?render` in Chrome or Edge
without a window. Nobody needs to start the Browser for it.

In render mode (`js/app/render.js`) the page opens no model at start and
offers `window.archiRender`:

| Call | Does |
| --- | --- |
| `await draw(link, { direction })` | Draws the diagram of a Browser link (a whole link, `#…` or the parameters): a stored view as it is stored, a generated diagram with the link's filters (`f=`), property options (`p=`), nesting (`n=`, default none) and layout options (`lo=`, default Balanced); `direction` `TB` (default) or `LR`. Answers `{ title, width, height, info }`; throws with the reason (no such model, not in the model, layout failed) |
| `svg()` | The diagram drawn, as a standalone SVG, as *Download .svg* makes it |
| `await png(scale)` | … as PNG, as *Download .png* makes it: `{ base64, width, height, scale }` (scale 2 by default; smaller for diagrams larger than a browser's canvas allows) |

The page says it is ready with `<html data-render="ready">`. It opens the
model again when its revision has changed, so an image shows the model as it
is. Nothing asks a question (no "more than 400 elements" check), the PlantUML
tab is not used, and the settings a link does not carry are the defaults.

### Offline copies (2.20.0)

**Share as offline copy…** in the ⋮ model menu makes **one HTML file** that
shows the open model in a desktop browser, **without the API, a server or
anything installed**: give it to colleagues by mail, Teams or a shared folder,
and they open it with a double-click. It needs API 3.14.0 (the entry is not
shown with an older one) and a key that may read.

* **What it is:** the model as it is at that moment (one snapshot, taken from
  one state of the database), read-only. A banner at the top says so: *Offline
  copy of "…", revision 12, taken on … by robert. Read-only: changes made since
  are not in it.* The file name has the date: `Model_offline_2026-10-29.html`.
* **What works** as in the Browser: the tree with folders, types and layers,
  the details with their tabs, the search (also by property), stored views and
  their drill-down links, neighbourhood diagrams, the explorer (+N, expand,
  hide, collapse, Back), diagrams of the basket, a folder, a type, a layer or a
  relationship type, nesting, impact analysis (panel, diagram, CSV), paths,
  diagram filters and hide rules, property labels, colours and filters, the
  diagram tabs, the basket, multi-selection, the keyboard shortcuts, the
  reports (quality, matrix, landscape map), SVG and PNG downloads, *Copy image*,
  the CSV downloads, the Czech UI and links within the file.
* **A part, or with a password** (2.27.0): the dialog of *Share as offline
  copy…* offers the whole model, the folder selected in the tree, or the
  open view (API 3.19.0); the copy then holds that and what it needs, and
  its banner names the part. A drill-down link to a view the part does not
  hold says that the view is not in the copy (2.27.2). With a password the model in the file is
  encrypted (AES-GCM, PBKDF2), and the copy asks for the password before it
  shows anything; a forgotten password cannot be recovered.
* **What it leaves out:** what needs the API or a server: import, export,
  delete, linked files, *Refresh*, sign-in, the History tab and the change bar,
  and the PlantUML view (it would send the model to a PlantUML server). The
  Settings keep the language.
* **Browsers:** current Chrome and Edge on a desktop (the tests open copies
  in both). Firefox has what the copy uses (import maps, compression streams)
  but has not been tried. Phones and tablets are not supported: opening an
  HTML file from their files usually does not run its scripts.
* **Size:** the Browser itself, ELK and the icons take about 1.2 MB of the
  file (compressed); a model of about a thousand elements and 70 views adds
  about 0.6 MB, so its file has about 1.8 MB.
* **Confidentiality:** the file holds the whole model readably, and anyone who
  has it can read it; there are no access rights in it, and it cannot be taken
  back. Share it as you would share an export of the model.

How it works: the API answers the whole model in one request
(`GET /models/{id}/snapshot`, API 3.14.0), and the file carries that snapshot,
the Browser's own code, stylesheet and markup, ELK and the icons, compressed. In
the copy a stand-in of the API (`js/offline/`) answers every request of the
Browser from the snapshot in memory, with the API's rules ported (the graph
helpers, the search, the reports); the rest of the Browser is unchanged, so a
copy behaves as the Browser does. A page opened from disk may not load its
modules from files, so they travel in the page and become Blob URLs named by an
import map. A test asks the stand-in and the real API the same questions about
both test models and compares the answers (`tests/unit/offline.test.js`), and
`run_tests.py` opens copies from disk in headless Chrome or Edge.

### Relationships on relationships and junctions

ArchiMate allows a relationship to connect to another relationship, typically
an association that annotates a relationship. The sample model has seven.

* **Diagrams:** PlantUML cannot attach a line to a line. A relationship that
  other relationships attach to is drawn in **two halves meeting at a small
  grey dot**: the source decoration (diamond, assignment dot, read arrow) on
  the first half and the target head on the second. The attached
  relationship connects to the dot. Clicking the dot or either half selects
  the relationship. Chains (a relationship on a relationship on a
  relationship) are resolved as a closure.
* **Neighbourhood walk:** reaching a relationship endpoint continues to the
  *elements* of that relationship in the same hop, so the construct is
  complete. **Junctions are pass-through**: `A → (And) → B` counts as one
  hop.
* **Tree:** *Relationships → Connected to relationships* lists them all.
  When you expand an element, an endpoint that is a relationship shows as an
  expandable relationship node. A relationship's children include the
  relationships attached to it (⤷).
* **Details:** relationship endpoints show as
  `[Composition: ERP Core → Junction]`, and a relationship lists the
  relationships attached to it. The *Diagram* button includes the elements
  behind relationship endpoints and attached relationships.

### View drill-down

Views can link to other views through *diagram model references*
(`viewRefId` on nodes/connections). In the sample model, overview views such
as *Sales Overview* link to their 15 detail views.

* **Diagram tab:** references are grey boxes with a blue **↗**. A plain box
  opens the referenced view on click. A box that frames other nodes (common
  on overview views) behaves like a group: its title is at the top, and only
  the title (or a double-click) opens the view, so clicks on the framed
  elements still select them. An element node that also drills down gets a
  separate clickable ↗ in its corner. Connections with `viewRefId` open on
  double-click.
* **PlantUML:** references are `↗ name` cards (or containers, when nested
  nodes exist); clicking one drills down.
* **Tree:** references inside a view's node tree are ↗ *view link* entries
  that drill down when selected.
* **Breadcrumbs:** drilling down shows a trail above the diagram, e.g.
  *Sales Overview › Sales Quotes View › Sales Customer Portal View*.
  Click a crumb to go back up. The browser **Back** button also works,
  because each drill-down adds a history entry. The trail is part of the
  link (`d=v~13~17.19` = view 13, reached via 17 then 19).
* **Details:** a view lists its **Links to views** and, under **Linked
  from**, the views that link to it.

### Properties

The property names used in the model are offered with their usage count.
*Label* and *Colour by* are in the *Layout* tab (row *Properties*), the
property filter and *Language* in the lower part of the *Filters* panel:

* **Label:** adds `name: value` as a small italic second line to every
  element in PlantUML diagrams and in the *Diagram* tab renderer.
* **Colour by:** fills elements by property value instead of by layer,
  with a legend (a PlantUML `legend`, or an overlay in *Diagram* tab).
  Categorical values get distinct light colours; if all values are numeric,
  a light-to-orange ramp is used. Elements without the property are grey.
  In PlantUML, coloured elements are drawn as
  `archimate #colour "label" <<stereotype>>` (the same sprite stereotypes as the
  stdlib macros), so the ArchiMate icons are kept.
* **Only where:** a property filter (*is set / is not set / equals /
  contains / does not equal*, case-insensitive, with value suggestions) for neighbourhood,
  basket and type diagrams. Like the type filters, it also limits the
  neighbourhood walk.
* **Language:** appears when the model has `xml:lang` values. It picks the
  preferred language for multi-language properties (fallback: a value
  without language, then the first one).

Label and colour also apply to **stored views**; in a stored view, elements
the property filter leaves out are faded. The *Layout* button names them when set (*Layout: colour: Cost*).
Tooltips in the tree and in *Diagram* tab list each element's properties.

**Property search:** the search box also accepts `@name` (is set),
`@name=value` (equals), `@name~text` (contains) and `@name!` (not set). The
API does this search as well, on elements, relationships and views. The
name of the property and the value are compared without regard to case.
Conditions join with **AND** and **OR** (2.28.0, API 3.20.0):
`@Owner=Sales AND @Cost OR @Status!` finds the items with Owner Sales and a
Cost, and those without a Status. AND binds tighter than OR, and there are
no parentheses; AND and OR are written in capitals, so `@Owner=Sales and
Marketing` is one condition with that value.
Where an item has several values of the property, for example one per
language, *equals* and *contains* hold when one of them matches.
These run client-side over elements, relationships and views; the API's
search only covers names and documentation. Example: `@domain=finance`.

### Basket and shareable diagram links

* The basket is **saved per model** in `localStorage` (key
  `archixmi-basket:<api base>:<model XMI id>`). It stores element **XMI
  identifiers**, not database ids, so it survives re-importing the model. It
  is restored when the model is opened.
* The basket is the first section of the left pane, above the search
  results and the model tree: its actions (*Diagram of basket*,
  *+ neighbours*, *Explore*, *Clear*), then its elements as a tree, the
  same as the search results: an **Elements** group with one row per
  element, each as in the model tree (type badge, *n↗ m↙* relationship
  counts, its relationships and the elements at their other ends below
  it).
* Basket rows: click to select the element, Ctrl-click to select several,
  drag one into the diagram. **Right-click** a row for the element's
  context menu, the same as in the model tree. **×** at the end of a row
  (shown on hover and on the selected row), the **Delete** key on a selected
  row, or *Remove from basket* in its menu takes it out. Right-click the **Elements** group, or the *Basket: N
  elements* label, for the whole basket:
  * *Diagram of basket*
  * *Diagram with neighbours*
  * *Explore*
  * *Add all to diagram*
  * *Select all of them*
  * *Sort by name* / *Sort by type* / *Order as added* (remembered)
  * *Copy names*, *Copy XMI identifiers* (one per line; they survive a
    re-import), *Download as CSV* (name, type, layer, XMI identifier; semicolon-separated)
  * *Clear basket*

  The rows are navigated with the keyboard like the model tree; the
  Context Menu key or Shift+F10 opens a row's menu. *Clear* asks for confirmation when the basket has more than
  five elements.
* Every diagram has a definition in the URL hash, so **Copy link** (in the *Share* menu, or the
  address bar) reopens the same diagram:

  | `d=` | Diagram |
  | --- | --- |
  | `el~459.502.68` | these elements (e.g. the basket) |
  | `nb~1~459` | neighbourhood of 459 at depth 1 (`nb~1~459~o` outgoing only, `~i` incoming only) |
  | `nb~1~459~b~~Serving.Realization` | (2.33.0) the same, following only these relationship types in a direction, at every step: `~<b\|o\|i>~<incoming types>~<outgoing types>`, an empty list for every type; here every incoming relationship, outgoing only Serving and Realization |
  | `ty~ApplicationEvent` | all elements of a type |
  | `la~business` | all elements of a layer |
  | `wm` | every element of the model (2.28.0, API 3.20.0) |
  | `rt~Serving` | the ends of all Serving relationships, connected by Serving only (`rt~@rel`: relationships on relationships) |
  | `v~4` | stored view 4 (`v~13~17.19`: reached by drilling down 17 → 19 → 13) |
  | `fo~506` | all elements in folder 506 and its sub-folders |
  | `im~459~i~5` | impact of 459, depth 5 (`~d~` = dependencies; optional `~Serving.Flow` = relationship types; `im~459.502~…` = from several elements) |
  | `ex~459~459.502.68` | explorer started from 459, currently showing 459, 502 and 68 (`ex~~` = empty diagram; a fourth part lists hidden relationships; a fifth, `<view>.<note>…`, the notes of an editable copy, by XMI identifier) |

  A diagram link also carries its filter in `f=`: `vp:<preset>`, or the
  shorter of the shown (`ie:`/`ir:`) or hidden (`xe:`/`xr:`) type lists.
  Property options travel in `p=` (`l:<label>~c:<colour>~f:<name>.<op>.<value>~g:<lang>`).
  A link without `f=`/`p=` means *no filter / no property options*, so
  recipients see what the sender saw. Layout options and moved elements travel
  in `lo=` and `m=` (see *Layout options and moving elements*).
  `vn=<name>` (2.22.1) makes the diagram a **proposed view**: a bar offers
  *Save as view…* with the name filled in. The MCP server's `propose_view`
  writes such links.
* **Links name items by XMI identifier** (BR-17), so they keep working
  when the model is replaced with a new version of its file, which may give
  its items new ids. The table above shows ids for brevity; a link written
  by the browser has `model=id-mymodel&d=nb~1~id-3f2a…&element=id-3f2a…`,
  and moved elements in `m=` are named the same way (`eid-3f2a….400.300`).
  An identifier is written as it is when it has only letters, digits and
  `-` (as Archi's do); other characters become `*` and two hex digits.
  **Folders** have no identifier when Archi exports them, so a folder is
  named by its path of labels from the top (BR-18): `@`, the labels, `:`
  between them (`fo~@Application:ERP*20domain`). Where sibling folders
  share a label, or an item has neither, the link has its id.

  When a link is opened, the browser asks the API for the ids of all its
  identifiers and folder paths (`POST …/resolve`, API 2.5.0 and 2.6.0). Links with
  ids, written before, still work. What the model no longer has is left
  out of the diagram, and the status line says how many items that were.
  Moved elements are stored in this browser the same way, so they are
  found again after a replace; ones stored before are moved over when
  the diagram is next opened.

  **Models that share an identifier** (API 2.10.0, a model copied by
  copying its file): their links name them by number (`model=7`). A link
  written before, with the identifier, names all of them; the browser then
  asks which one to open (*Cancel* opens the oldest). Baskets and moved
  elements stay with the oldest of them; a copy keeps its own, under its
  identifier and number. When copies also share the name, the model list
  shows their numbers.

**Export model** (⋮ model actions in the top bar) downloads the whole model via
`GET /models/{id}/export`. A model whose views have lines without ends (a
`Line` lacking its source or target) is valid by the exchange format, but
Archi cannot import it. The browser asks the API first
(`GET …/export/check`, API 2.7.0) and, for such a model, shows the lines
(view, identifier, the missing end) and asks: **Leave them out** (the file
for Archi, without those lines and the connections that end on them),
**Export as is**, or *Cancel*.

**Archi files and linked models** (API 2.8.0, BR-20). Where the API has Archi,
*Import model…* also takes Archi's own `.archimate` files, and **Export
.archimate** downloads the model in that format; Archi converts them on the
server, which takes a few seconds.

A model can be **linked** to a file on the server, an `.archimate` file or
(API 3.1.0) an `.xml` exchange file, which needs no Archi: it is then
updated from that file and cannot be changed otherwise.

* **Link a file on the server…** (in the import dialog; admin key) imports
  the file and links the new model to it. The path is the server's, below a
  folder the API allows (`LINKED_FILES_DIRS`); leave *Update every* empty to
  update by hand only. When the file holds a model that is there already,
  several times or linked to another file (API 2.10.0), the dialog offers
  *Link “…”* for each of them, or **Import as a separate model**.
* **Browse…** (2.28.0, API 3.20.0) next to *File on the server* picks the
  file instead of typing its path: the folders the server allows, then a
  folder's sub-folders and its `.archimate` and `.xml` files, with size,
  date and the model a file is linked to already; *↑ Up* goes back. A click
  on a file fills in its path.
* **Linked file…** (model menu) shows the link: the file, the interval, the
  last update and the last check with its result, and the next check. An
  admin can change the interval or the file, link a model that is not
  linked yet, or **Unlink** it, after which it can be changed again.
* **Update from file** (model menu, the model's details, or *Update now* in
  the dialog; editor key) updates it now. An unchanged file is not read
  again; otherwise the dialog or the status line says what changed, and the
  model is opened again.

### Errors and an unavailable API

When something cannot be loaded, the pane or section that needed it says so
and offers **Retry**. This covers the model list or model in the tree pane, the
details pane (and its *Links to views*, *Find views…* and model properties
sections), a stored view in the diagram pane, search results, and tree
branches that load on expand. For a missing or wrong API key (401), or a key
whose role does not allow the request (403), there is also *Open settings*.

The browser needs API 2.10.0 or later. It asks the API for its version before
it opens a model, and with an older one the tree pane says which version is
needed and which one answered, instead of failing later on a request the
API does not know.

If the API cannot be reached at all (no network, the API stopped, or the
proxy answering *502 Bad Gateway*), a red **banner** appears under the top
bar. It checks the API's `/health` every few seconds (3 s, doubling up to
30 s; *Retry now* checks at once) and disappears when the API answers
again. `/health` fails while the API's database is down, so the banner stays
until requests for data will really work. Everything that failed because of the outage then **retries by
itself**, so you don't have to click through the panes.

Quick clicks are safe: choosing another element, view, search or model
**cancels** the requests still running for the previous one, so a slow
answer can never replace what you chose later.

### Settings

*Settings* (top bar) stores the following in this browser's `localStorage`,
in three groups: **General** (UI language), **Connection** (API base URL,
default `/api/v2`, i.e. the proxy; API key) and **Diagrams** (PlantUML server
URL and options; up to how many elements a diagram of the whole model is
offered, 300 by default (2.28.0); the nesting is in the *Layout* tab). Under the base URL the dialog shows the
browser's own version (2.7.0 onwards, in `js/version.js`; the CHANGELOG's
first heading is the same) and the version of the API that answers there.
The groups scroll; *Cancel* and *Save* stay in view.

A base URL saved by an earlier version of the browser, ending in `/api/v1`,
is changed to `/api/v2` when the page loads (API 3.0.0 no longer serves
`/api/v1` at all). Baskets and manual layouts are
stored per base URL; they are moved along, so they are still there.

**API key:** on your own machine best left empty: `archimatebrowser.bat` makes the proxy
add it to every request, so the key never reaches the browser. With a key of your own
(API 3.11.0), *Sign in* in the top bar sets it here. If you do type one in, it is
kept in **session storage** only. The browser forgets it when closed, and a
new tab asks for it again (tabs opened from the app usually inherit it).
Tick *Remember the key in this browser* to keep it in `localStorage`
instead; any script running on this origin can read it there. A key saved
before this option existed stays remembered until you change it.

**Language:** English or Czech (*Čeština*). *Browser default* uses Czech
when the browser's language is Czech, otherwise English. Changing it
reloads the page; the open model, selection and diagram stay (they are in
the URL). Translated is the user interface: menus, buttons, details-pane
headings, tooltips, messages. Model content (names, documentation,
properties) is shown as stored, and ArchiMate concept names (element and
relationship types, layers, viewpoint presets) stay in English, as usual in
Czech architecture practice. Exported files (CSV columns, PlantUML source)
keep English identifiers.

**All CSV files** (the basket, *Download elements as CSV*, an impact
analysis) have one format: every field quoted, separated by a **semicolon**,
rows ended by CRLF, UTF-8 with a BOM. Excel with Czech regional settings
(the comma is the decimal mark there) opens them straight into columns.
The impact analysis CSV comes from the API, which writes the semicolon on
request since 3.2.0; an older API answers with commas.

**Pane widths:** drag the border between the model tree and the diagram, or
between the diagram and the details pane. Widths are remembered;
double-click a border to reset it. With the keyboard: Tab to a border, then
←/→ (Shift for larger steps), Home resets. On narrow windows (≤ 900 px) one
pane is shown at a time (see *Layout of the page*) and there are no borders
to drag.

> **Privacy:** the *Diagram* tab (default) never sends data anywhere. Only
> the optional *PlantUML* tab contacts a server: by default the public
> `https://www.plantuml.com/plantuml`, which receives the diagram source,
> including element names, each time you open that tab for a diagram. For
> confidential models, run your own server, e.g.
> `docker run -d -p 8088:8080 plantuml/plantuml-server:jetty`, and set the
> PlantUML server to `http://127.0.0.1:8088`. PlantUML's own small server
> works too, without Docker: `java -jar plantuml.jar -picoweb:4242`, and the
> PlantUML server `http://localhost:4242/plantuml` (2.27.1: long diagrams go
> to its `/render`). Either way, start the Browser with
> `--csp-allow http://localhost:4242` (or the Docker server's address), so
> that the page may contact it.

---

## Architecture

No build step and no npm: plain ES modules loaded by `index.html`. The only
third-party code is ELK, vendored in `vendor/elk/` (elkjs 0.12.0, EPL-2.0,
`elk-api.js` plus the `elk-worker.min.js` Web Worker), so the app works
offline.

```
ArchiMateBrowser/
├── index.html          # page skeleton: top bar, 3 panes, settings dialog
├── css/app.css         # layout, tree, details, diagram styles (light/dark)
├── js/
│   ├── app.js          # wiring: the page's start-up, in order; no declarations of its own (EN-6)
│   ├── app/            # the application, what app.js wires (split from it, EN-6):
│   │   ├── state.js    #   the shared `state` object and `$`
│   │   ├── ui.js       #   status line, errors, retry, cancellation, permissions
│   │   ├── treespecs.js #  what the model tree, the basket and the search results show
│   │   ├── details.js  #   the details pane, impact analysis
│   │   ├── routing.js  #   selection, URL hash, references by XMI identifier
│   │   ├── basket.js   #   the basket
│   │   ├── diagram.js  #   diagrams: rendering, explorer, drag and drop, notes of an editable copy
│   │   ├── menus.js    #   context menus, multi-selection, legend, diagram chrome
│   │   ├── panels.js   #   Options / Filters / Layout panels, diagram definitions, view drill-down
│   │   ├── models.js   #   model loading, search, settings, import / delete, linked models
│   │   ├── reports.js  #   quality report, relationship matrix, landscape map (ALT-4, API 3.6.0)
│   │   ├── offline.js  #   "Share as offline copy…", the banner of an offline copy (2.20.0)
│   │   ├── actions.js  #   the action registry: every action on an item, once; menus, buttons, keys and commands are made from it (CM-11)
│   │   ├── palette.js  #   the commands, Ctrl+K (2.21.0)
│   │   ├── tabs.js     #   diagram tabs: one document each, opened, switched, closed, remembered (BR-15)
│   │   ├── history.js  #   what others change: the change bar from the API's change events or polling, the History tab (MU-13, MU-14, MU-17)
│   │   ├── signin.js   #   signing in with one's own API key, who is signed in (MU-4, 2.13.0)
│   │   ├── views.js    #   created views: Save as view, Edit view, rename, delete, what an update took out (BR-25, 2.22.0)
│   │   ├── editing.js  #   ✎ Edit: the edit form of an element or a relationship, saves, conflicts (BR-11, 2.23.0)
│   │   ├── toolbox.js  #   the palette for creating elements and relationships while editing (2.24.0)
│   │   ├── manage.js   #   deleting elements and relationships (asking first), filing, folders (2.25.0)
│   │   ├── keys.js     #   keyboard shortcuts (2.19.0), from the actions' keys
│   │   ├── render.js   #   render mode (?render): images of diagrams for the MCP server (RN-1, 2.29.0)
│   │   └── shell.js    #   left pane, panel switching, narrow windows, downloads
│   ├── api.js          # REST client, pagination, error mapping, request cancellation (EN-2), kept answers of the POST helpers
│   ├── connection.js   # API reachability: outage detection, /health polling, recovery (EN-2)
│   ├── events.js       # the API's change events: the stream read with fetch, parsed, opened again (MU-14, 2.26.0)
│   ├── graph.js        # the graph rules, asked of the API: neighbourhood, set, impact, counts, paths
│   ├── store.js        # per-model cache: elements, relationships, views, adjacency index
│   ├── viewcontent.js  # the content of a created view, from a generated diagram or a stored view (BR-25)
│   ├── tree.js         # generic lazy tree widget (keyboard navigation, paging)
│   ├── archimate.js    # ArchiMate metadata: layers, colours, badges, PlantUML macro names
│   ├── plantuml.js     # PlantUML source generators + deflate/base64 URL encoding
│   ├── elklayout.js    # automatic layout of generated diagrams with ELK (Web Worker), hub ports, component packing
│   ├── nesting.js      # optional nesting of Composition/Aggregation(/Assignment) in generated diagrams
│   ├── layoutprefs.js  # Layout panel options (presets, spacing, ELK strategies) + URL encoding
│   ├── explorer.js     # explorer: hidden related elements, per-type counts, position hints for new elements
│   ├── manual.js       # moved elements: pins, orthogonal re-routing, Tidy hints, storage + URL encoding
│   ├── refs.js         # items in links and stored layouts: XMI identifiers and folder paths as tokens (BR-17, BR-18)
│   ├── menu.js         # keyboard of the context menus and the page menus (UX-6)
│   ├── filters.js      # diagram filters: viewpoint presets, URL encoding, filter panel UI
│   ├── properties.js   # property label/colour/filter options, colour scales, @-search, panel UI
│   ├── impact.js       # impact/dependency analysis: propagation semantics, closure, CSV
│   ├── csv.js          # the one CSV format of all downloads: quoted, semicolon, CRLF, BOM
│   ├── viewsvg.js      # native SVG renderer (zoom/pan/click/drag), SVG/PNG export, minimap
│   ├── i18n.js         # UI translation: t(), plurals, static page (EN-7)
│   ├── i18n-cs.js      # Czech strings (keys = English source strings)
│   ├── panes.js        # resizable panes with remembered widths (EN-7)
│   ├── offline/        # offline copies (2.20.0): a stand-in of the API over a model's snapshot
│   │   ├── standin.js  #   a fetch()-shaped stand-in: lists, views, folders, search, resolve
│   │   ├── graph.js    #   the API's graph rules and helpers, ported (neighbourhood, subgraph, impact, counts, paths)
│   │   ├── reports.js  #   the reports: quality (from the snapshot), matrix and hierarchy (ported)
│   │   ├── model.js    #   the snapshot indexed; Python's casefold and ordering
│   │   ├── layers.js   #   the API's layer of every element type
│   │   ├── package.js  #   the offline page: modules, ELK, icons and the snapshot in one HTML file
│   └── config.js       # settings in localStorage (the API key in sessionStorage unless remembered, EN-3)
├── vendor/elk/         # elkjs 0.12.0 (elk-api.js, elk-worker.min.js, LICENSE.md: EPL-2.0)
├── img/sprites/        # one ArchiMate icon per file + sprites.json + index.html gallery (generated)
├── inputs/             # source material, e.g. archi_sprites.svg (PlantUML sprite sheet)
├── tools/extract_sprites.py  # splits inputs/archi_sprites.svg into img/sprites/
├── server/serve.py     # static server + reverse proxy (stdlib only)
├── archimatebrowser.bat # Windows script: install, start, run, test
├── .env.example        # template of this folder's .env (ARCHIXMI_API_KEY)
├── createinstallpackage.ps1  # builds a distributable install package (see below)
├── tests/              # EN-1: unit + smoke tests, fixture model, test server (starts a real API with a stand-in for Archi), headless runner (see Development)
├── deploy.ps1          # installs or updates an installation from a package (shared with the API and the MCP server)
├── runtests.ps1        # runs the tests (tests/run_tests.py)
├── README.md
├── CHANGELOG.md        # what changed, by version (since 2.7.0)
├── ACCESS_RIGHTS.md    # short: keys and roles for the Browser; the guide is the API's ACCESS_RIGHTS.md
│                       # working documents (not in the install package):
├── PLAN.md             # the upgrade to API v2: phases, tracker, gaps in the API, decisions
└── IMPROVEMENTS.md     # the backlog (BR-, UX-, CM-, PU-, EN- items)
```

The specification of the API changes the Browser asked for is in the API's
folder: [API_IMPROVEMENTS.md](../ArchiMateAPI/API_IMPROVEMENTS.md) and
[API_IMPROVEMENTS_2.md](../ArchiMateAPI/API_IMPROVEMENTS_2.md).

### Data loading

Opening a model (`ModelStore.load()`) costs four requests, whatever the
size of the model: the **view list**, the **statistics** (the counts in the
tree, the status line and the model details), the **index of the properties
in use** (the *Properties* panel) and the **folders with their counts**,
without what is filed in them. No element and no relationship is loaded
(phase 4 of [PLAN.md](PLAN.md), since 2.9.0).

`ModelStore` is a cache (UP-3). Every answer that brings elements or
relationships fills it: the graph helpers (asked for complete items, with
their properties), a stored view with the elements and relationships it
shows, the search, the lists below. Look-ups (`store.element(id)`,
`store.relationship(id)`) stay synchronous and answer what is cached, so
each entry point of the page first makes sure of what it will show:
`store.ensure({ elements, relationships })` asks for the missing ones by
`ids=`, a relationship with its ends (and the ends of an end that is a
relationship), so that it can be named. What is cached is not asked for
again while the model is open.

Asked for when they are needed, and kept:

* the elements of a **type** when its tree row opens, sorted by name, each
  with its relationship counts (`include=degree`), which give the `n↗ m↙`
  of the row (HLP-6);
* the **relationships of a type**, ordered by their ends (`sort=ends`), and
  of an element (the details, its tree row), of a relationship (those
  attached to it), each list with its ends (`include=ends`);
* what is **filed in a folder** when its row opens or its details show;
* where every element is filed, for the folder column of the exports.

Everything else is one request when it is needed: a stored view, the views
that show an element or relationship, the links between views, the folder
an item is filed in, the elements filed below a folder, the elements of a
view with their positions, and every search. Every request can be cancelled
(`AbortController`): each pane runs one job at a time, and a new one aborts
the previous (EN-2). On the real model of about 1,000 elements, 1,500
relationships and 70 views, opening it fetches 62 KB in four requests
instead of 1.3 MB in eight before 2.9.0; opening the largest type (186
elements) is one request of 49 KB, the details of an element three small
ones.

**What belongs to a diagram is decided by the API** (`js/graph.js`): which
elements lie in a neighbourhood, which relationships to draw between the
elements of a set, what an impact analysis reaches, how many related
elements an explorer can still show, what to nest, and the paths between
two elements. The diagram filters, also a filter by property, are part of
the question, so the API applies them while it walks the model. A diagram
costs one such request and one for the "+N" counts of its elements.

Four of these helpers use `POST`, which a browser does not cache. `js/api.js`
keeps their answers with the `ETag` the API sends and asks again with
`If-None-Match`; while the model has not changed the API answers
`304 Not Modified` without computing anything.

No code of the browser walks the relationships of the model: the API
answers every question of what is related to what. The browser's own rule
code, and the comparison mode that checked the API against it (phase 3: on
the sample model every neighbourhood, impact, count and set gave the same
result both ways), went in 2.8.0 (UP-5, UP-6).

### Clickable PlantUML: how mapping works

The generators in `plantuml.js` return `{ source, refs }`. `refs.entities`
maps each PlantUML alias to an element id: `e<elementId>` in element
diagrams, `n<nodeId>` in view diagrams. `refs.links` lists the relationship
lines in source order. The PlantUML server (1.2023 or later) annotates its
SVG with `<g class="entity|cluster" data-qualified-name="…alias">` and
`<g class="link" data-entity-1=… data-entity-2=…>`. `annotateSvg()` uses these
to set `data-element` / `data-relationship` on the groups. Links are matched
per (source, target) pair in order, so parallel relationships between the same
two elements map correctly. A transparent 10 px stroke is added along each
link so thin arrows are easy to click. The *Diagram* tab renderer sets the
same `data-*` attributes, so both diagrams share the selection highlight.

### API endpoints used

All below `/api/v2`, except `/health`.

| Endpoint | Used for |
| --- | --- |
| `GET /health` | the API-down banner; the API's version in *Settings*; the "API too old" message |
| `POST /models/{id}/resolve` | BR-17, BR-18: the ids of the XMI identifiers and folder paths in an opened link |
| `GET /auth/me` | what the key in use may do: *Import* and *Delete* are hidden without the permission |
| `GET /models` | model selector |
| `GET /models/{id}` | model switch |
| `GET /models/{id}/elements?type=…&include=degree` | the elements of a type, with their relationship counts: tree rows, type and layer actions |
| `GET /models/{id}/elements?ids=…&include=degree` | elements not cached yet (HLP-8): a link, the basket, search results, folder rows |
| `GET /models/{id}/relationships?include=ends` | with `type` and `sort=ends`: the relationships of a type; with `sourceElementId` / `targetElementId`: of an element; with `sourceRelationshipId` / `targetRelationshipId`: attached to a relationship; with `onRelationship=true`: on relationships; with `ids`: not cached yet |
| `GET /models/{id}/stats` | counts in the tree, the status line, the model details and the delete dialog |
| `GET /models/{id}/properties/index` | the properties in use, for the *Properties* panel |
| `GET /models/{id}/views` | view list |
| `GET /models/{id}/views/{vid}/content?include=concepts&fields=full` | a stored view: its node tree and connections, with the elements and relationships it shows, in one request |
| `GET /models/{id}/views/{vid}/elements?positions=true` | the elements of a view and where they are: *add to diagram*, *add to basket*, drag |
| `GET /models/{id}/views/{vid}/links` | *Links to views* and *Linked from* in the view details |
| `GET /models/{id}/elements/{id}/views`, `…/relationships/{id}/views` | the views that show an element or a relationship |
| `GET /models/{id}/organizations?counts=true&foldersOnly=true` | Folders branch, with what every folder holds (loaded with the model); without `foldersOnly`: where elements are filed, for the exports |
| `GET /models/{id}/organizations/{id}/contents` | what is filed in a folder (`recursive=false&order=model`): its tree row, its details; the elements filed in it and below it: folder diagram, basket, drag, element types in the details |
| `GET /models/{id}/elements/{id}/folder` (also `relationships`, `views`) | the folder an item is filed in: details, *Show in folders* |
| `GET /models/{id}/property-definitions` | property definitions |
| `GET /models/{id}/properties` | model-level properties |
| `GET /models/{id}/metadata` | metadata blocks |
| `POST /models/{id}/graph/neighbourhood` | neighbourhood diagrams; what expanding an element adds; where to put an element added to a diagram |
| `POST /models/{id}/graph/subgraph` | diagrams of a set: basket, selection, type, layer, folder, relationship type, explorer steps; nesting |
| `POST /models/{id}/graph/impact` | impact panel, impact diagram, CSV (`Accept: text/csv`) |
| `GET /models/{id}/analysis/quality` | the quality report (API 3.6.0; relationships not allowed since 3.7.0) |
| `POST /models/{id}/graph/matrix` | the relationship matrix, and its CSV (`Accept: text/csv`; API 3.6.0) |
| `POST /models/{id}/graph/hierarchy` | the landscape map (API 3.6.0) |
| `POST /models/{id}/graph/expansion-counts` | the "+N" of every element of a generated diagram, and its menu per type |
| `GET /models/{id}/graph/paths` | paths between two elements |
| `GET /models/{id}/search` | text search and property search: one page per kind (elements, relationships, views), best match first |
| `GET /models/{id}/export` | XMI download |
| `GET /models/{id}/snapshot` | *Share as offline copy…*: everything about the model in one answer (API 3.14.0) |
| `POST /models/import` | XMI import (multipart `file`); answers `{ model, warnings }` |
| `DELETE /models/{id}` | model deletion (typed-name confirmation) |
| `POST /models/{id}/views` with `content` | *Save as view…* (API 3.15.0) |
| `PUT /models/{id}/views/{vid}/content` | *Save* of an edited created view, *Dismiss* of what an update took out (`If-Match`) |
| `PUT` / `DELETE /models/{id}/views/{vid}` | *Rename…*, *Delete…* of a created view (`If-Match`) |
| `POST /models/{id}/changes` | *Save* of an edited element or relationship: its fields and properties in one transaction (2.23.0) |
| `GET /metamodel/relationships?source=…&target=…` | the types a relationship may have between its ends, in the edit form |

### Element type → PlantUML macro

`js/archimate.js` maps every `ElementType` from `xmi_oas.json` to a stdlib
macro: `Business*` → `Business_*` (`Contract` → `Business_Contract`,
`Representation` → `Business_Representation`, `Product` → `Business_Product`),
`Application*` / `DataObject` → `Application_*`, technology types →
`Technology_*`, physical → `Physical_*`, motivation → `Motivation_*`,
strategy → `Strategy_*`, `WorkPackage`/`Deliverable`/`ImplementationEvent`/
`Plateau`/`Gap` → `Implementation_*`, `Location` → `Other_Location`,
`Grouping` → `Grouping`, `AndJunction`/`OrJunction` → `Junction_And`/`Junction_Or`.
Relationships map to `Rel_<Type>`. Access uses `Rel_Access_r/_w/_rw` by
`accessType`, and a directed association uses `Rel_Association_dir`. A
relationship that other relationships attach to is written as two raw arrows
through a helper `circle`. The arrow strings are copied from the macros
(`*--`, `@-->>`, `~~|>`…) and split into source decoration + line + target
head (see *Relationships on relationships* above).

All element and relationship macros were checked against plantuml.com using a
synthetic diagram (no syntax errors).

---

## Creating an install package

`createinstallpackage.ps1` builds a self-contained, deployable copy of the
browser, in the same way as the API's script of the same name: the page,
`css/`, `js/`, `img/`, `vendor/`, `server/serve.py`, `archimatebrowser.bat`,
`deploy.ps1`, `.env.example`, `README.md`, `CHANGELOG.md` and
`ACCESS_RIGHTS.md`, and `MANIFEST.txt`, the list of its files, with dev-only material
(`tests/`, `tools/`, `inputs/`, the working documents `IMPROVEMENTS.md`,
`PLAN.md`, caches, `.env`, git metadata) left out.

The Markdown files in the package (README, CHANGELOG, ...) link to files the
package leaves out, such as the working documents and the other projects'
files. The script rewrites those links to the same file in the project's
public repository on GitHub (`https://github.com/rnovicky/<project>`), so
that they work in an installation; links to files in the package stay
relative.

```powershell
.\createinstallpackage.ps1
```

This creates, under `dist/` by default, `ArchiMateBrowser_<timestamp>.zip`:
the package, ready to copy to a target machine and unzip there. The folder
it is put together in is deleted afterwards (`-KeepFolder` keeps it).

`<timestamp>` is `yyyyMMdd-HHmmss`. Useful parameters:

| Parameter | Default | Purpose |
| --- | --- | --- |
| `-OutputDir` | `dist` (under the project root) | Where the timestamped zip (and folder) are created |
| `-NoZip` | off | Skip zipping; only produce the folder |
| `-KeepFolder` | off | Keep the uncompressed folder next to the `.zip` |

### Installing and updating with deploy

As for the API (its README, *Installing and updating with deploy*): keep the
browser in one fixed folder, e.g. `C:\Apps\ArchiMateBrowser`, unzip the
new package anywhere, stop the browser, and run from the unzipped folder:

```bat
archimatebrowser.bat deploy C:\Apps\ArchiMateBrowser
archimatebrowser.bat deploy C:\Apps\ArchiMateBrowser start
```

or `.\deploy.ps1 -Target C:\Apps\ArchiMateBrowser [-Package <the .zip>] [-Start]`.
An empty folder gets a new installation (`.env` from `.env.example`: set
the key). An existing one is updated in place: the script stops while
something answers on port 8090, copies the installation to
`<folder>.backup-<timestamp>`, replaces the package's files, deletes those
the new version lacks (`MANIFEST.txt` lists a package's files; an older
installation is cleaned in `css/`, `js/`, `img/`, `vendor/` and `server/`
only), keeps `.env` and your own files, and lists settings that are new or
unknown. With `start`, it starts the browser in a window of its own.

### Installing by hand

On the target machine, with Python 3.9+ (nothing to `pip install`) and an
API of version 2.10.0 or later running, on Windows: unzip the package and run
`archimatebrowser.bat install`, which does the steps below and opens the page. By hand:

```bash
# unzip ArchiMateBrowser_<timestamp>.zip, then:
cd ArchiMateBrowser_<timestamp>

copy .env.example .env           # Windows — cp on macOS/Linux
# edit .env: set ARCHIXMI_API_KEY, preferably a key with the role "reader"

archimatebrowser.bat run              # or: python server/serve.py --env-file .env --open
```

The page is **http://127.0.0.1:8090/**. The package's folder name usually
differs from `ArchiMateAPI`, so `archimatebrowser.bat` does not find the API's
`.env` next to it; the `.env` in the package folder is the way to give the
key. For an API that is not at `http://127.0.0.1:8000`, add
`--api <root URL>` (or set `ARCHIXMI_API`); other options are listed under
*Quick start*.

## Development

### Tests (EN-1)

```bash
python tests/run_tests.py
```

(or `archimatebrowser.bat test`, or `.\runtests.ps1`, which lints the Python
parts with `ruff` first; the API's `runtests.ps1 -WithClients` runs it too,
so that a change of the API is tested against the browser). The tests run
against the **real API**, so the browser is
tested with the answers it will get in use, and no second copy of the API's
behaviour has to be kept here. They need:

* Python and Chrome, Chromium or Edge;
* the API's folder next to this one (`..\ArchiMateAPI`, an older checkout's
  `..\ArchimateXMIAPI`, or `ARCHIXMI_API_DIR`), with the API's Python packages installed: in
  `.venv` of that folder, or for the Python that runs the tests
  (`ARCHIXMI_API_PYTHON` names another one).

The API's own database and `.env` are not used or changed. The test API
runs with `REQUIRE_IF_MATCH=true` (2.29.0): it refuses a change that says no
version, so the tests show that every write of the app sends one (the
version of what it shows); the tests' own writes, which stand for someone
else, send `If-Match: *`. `ARCHIMATE_TEST_REQUIRE_IF_MATCH=false` runs them
against an API that does not ask. The run exits
with 0 when everything passes, 1 on failures and 2 when the API could not be
started, and takes about three minutes:

1. `tests/test_server.py` creates a temporary SQLite database
   (`alembic upgrade head`), starts the API on a free port with keys of its
   own, and imports two models through `POST /models/import`:
   * the **fixture model** `tests/fixture/model.json` (14 elements with
     properties, a junction, a relationship on a relationship, nested view
     nodes, a drill-down link, folders, and 230 filler elements so that one
     type has more rows than a tree page). `tests/fixture_xml.py` turns it
     into an exchange file. Most tests use it.
   * the API's **synthetic test model**
     (`tests/fixtures/Synthetic_Model.xml` in the API folder), for what the
     fixture lacks: views in folders, connections on connections, property
     values in several languages.
2. The same server serves the app, with `serve.py`'s handler, and proxies
   `/api/*` and `/health` to that API. `GET /__test/ids.json` gives the tests
   the ids the API assigned (`tests/unit/fixture.js`: `M`, `E`, `R(n)`,
   `V(n)`, `F(label)`, `SYN`). `POST /__test/api` changes how the API
   appears: `{"down": true}` unreachable (502), `{"delay": ms}` slow,
   `{"role": "reader"}` the proxy uses a reader key, `{"old": true}` like an
   API before 2.0.0.
3. Headless Chrome/Edge opens `tests/index.html`, which runs every test with
   a small harness (`tests/harness.js`: `describe`, `test`, `assert`,
   `waitFor`) and posts the results back; the runner prints the failures.
   Lines that start with `[test-server]` show requests the API refused; some
   tests cause them on purpose.
4. The offline copies the smoke tests saved (2.20.0) are opened **from disk**
   (`file://`) in headless Chrome or Edge, driven in real time through the
   DevTools protocol (`tests/cdp.py`, standard library only): the model, a
   neighbourhood diagram laid out in ELK's worker, a stored view.

What is covered (about 210 tests):

| File | Covers |
| --- | --- |
| `unit/offline.test.js` | **The offline copy's stand-in of the API against the real API** (2.20.0): for both test models, the same questions to both and the same answers, compared field by field: the model, statistics and properties; elements and relationships with every filter the Browser uses; views, their content, elements, links and where items are shown; the folder tree, contents and paths; the search (words, parts, documentation, property values, every property form, pages); resolve; neighbourhood, subgraph, impact (also as CSV), expansion counts and paths, each with the filter, hide-rule and nesting variants; the reports. A change of the API's rules that the stand-in does not follow fails here |
| `unit/viewcontent.test.js` | **Created views** (2.22.0): a generated diagram and a stored view turned into a view's content (nesting, notes, a relationship drawn through a dot, connections on connections), and the API taking it, giving it back and refusing a stale save (412) |
| `unit/archimate.test.js` | **Type check against the API spec:** every `ElementType`, `RelationshipType`, `AccessType` and `NodeType` of `xmi_oas.json` is mapped (layer, PlantUML macro and stereotype, badge, sprite, impact propagation), and the browser knows no extra types; viewpoints, impact defaults and nesting use known types only. |
| `unit/plantuml.test.js` | Encoding (round trip through deflate + PlantUML base64, Czech text), label escaping, macro mapping, access/association variants, skipped relationships, helper dots for relationships on relationships, nesting, colour/legend, stored-view export, SVG sanitising and click mapping. |
| `unit/store.test.js` | Opening a model without its elements and relationships, the cache (`ensure` by ids, complete items, ends of relationships, ids the model does not have), the elements of a type with their counts, the relationships of an element, of a type and on relationships, the API's statistics, the version the browser needs, paging (page size, order, progress, the API's limit); from the API: the folders without their items and what is filed in one, folder counts, contents, order and paths (also views filed in folders, on the synthetic model), a view in one request, where an element or relationship is shown, links between views, the elements of a view with their positions, the property index. |
| `unit/graph.test.js` | **The graph rules asked of the API**: neighbourhood (direction, junctions, relationship ends, depth), type and property filters and what they left out, the sets of a subgraph, left-out relationships, nesting, impact and dependencies with what to draw and the CSV, expansion counts, paths, and the kept answers of the POST helpers (`304`). |
| `unit/impact.test.js`, `filters.test.js`, `properties.test.js`, `i18n.test.js`, `layout.test.js`, `viewsvg.test.js` | The impact options and the path to a reached element; filter and property link encodings and operators; translations (plurals, placeholders, **every `t()` key has a Czech entry**); layout options, manual positions, collapse and real ELK layouts (no overlaps, nested children inside containers); the view renderer (selection, area selection, zoom, *Fit* that never enlarges beyond the standard size, SVG/PNG export, and connections that end on connections, in the drawing and in the PlantUML export of a view). |
| `smoke/app.test.js` | The whole app in an iframe, driven like a user: model loading, tree paging, neighbourhood and filter links, stored views and drill-down, filters in a stored view (faded, not hidden), context menus, explorer expand/Back, Copy image and the CSV and JSON downloads of a stored view and an editable copy, the basket's CSV in the same format, notes in an editable copy (with their lines, moved, hidden, Back, in the link) and in the automatic layout of a view, the same view actions in the tree and the opened view, collapse (keeping the way to the selected element, around it, Back), basket persistence, search, multi-selection (with dragging all selected elements at once), the Czech UI, resizable panes, the menus of the page (keyboard, Escape, one at a time, Share disabled without a diagram, the ⋮ view menu with its ticked choice), the Options / Filters / Layout tabs (one panel at a time, highlighted, *Set to default* in each, a property filter, label or colour removed for a model without the property, Label and Colour by in the Layout tab and also for a stored view, the same on a narrow window), the left pane's sections (order, the basket as a tree with its Elements group, counts, sub-tree and menus, bold label, *Close*, own scrolling, collapsing remembered, results opened again by a new search), *Clear diagram* on the diagram behind a confirmation, the search result groups (elements, relationships, views) dragged into the diagram, × and Delete on basket rows; **UX:** the empty-basket hint, options marked when they do not change the diagram shown, one pane at a time in a narrow window and the pane following the action, Home/End and wrapping in the right-click menus. **BR-17:** a link with ids is written again with XMI identifiers, moved elements arrive with a link and are stored by identifier, the model is replaced so that every element gets a new id, and the same link and the stored positions still work; a folder (label with a space and a slash) is linked by its path, and the link still works after the replace gave it a new id; an item the model no longer has is left out and reported. With a simulated outage: the error state with Retry, the banner and automatic recovery; a slow view cancelled by choosing another. **API v2:** the search groups and their totals, a view filed in a folder, a reader key (no *Import* / *Delete*), a real import with warnings, two replaces of that model with a preview (after a refused second import, and with a changed file, once refused because the model changed after the preview) and a real delete, models that share an identifier (a copy imported as a separate model, one of two replaced, a link by the identifier that asks which model, a linked file imported as a separate model), the API's version in *Settings*, a stored `/api/v1` base moved to `/api/v2`, the message for an API older than 2.0.0, and that no request of the run went to `/api/v1`. **Phase 2:** folder and views in the element details, views of a relationship, links of a view in both directions, views as search results, paging of a long result, where a hit was found and the ranking, the four forms of the property search (also on views and relationships), folder details and folder diagram, a stored view with connections on connections, a view's elements into the basket, and an API that is too old by its version. **Phase 3:** impact diagram and panel, diagrams of a layer, a relationship type and the relationships on relationships, a property filter applied by the API, nesting, explorer steps with their counts, paths from the menus and by link. **Tabs (BR-15):** a diagram duplicated into a second tab, switching without drawing again, a filter in one tab only, closing, Ctrl- and middle-click opening new tabs, the tabs restored after a reload and drawn when shown, and a diagram still loading that lands in its own tab while another is shown. **Reports:** the quality report (also a relationship ArchiMate does not allow, on the synthetic model), the relationship matrix (direct and along a path, a cell's paths drawn) and the landscape map. Also the export of a model with lines without ends (the dialog: leave them out, as is, cancel). **2.19.0:** closing a tab asks (×, Delete, Cancel keeps it), Delete / Backspace / Ctrl+A / ? in the diagram and not in a text field, a hide rule made from element types in the Filters tab, +N in a neighbourhood diagram, the details in tabs (the folder under the name, the analysis asked for when its tab is shown, the tab kept for the next item). **2.21.0:** the buttons of the details are those of the item's menu, in its order; the commands (Ctrl+K, also from the search field; what is selected first; an item found by the search and its actions, filtered; Backspace back; Enter runs; commands of the diagram by their words; the ⌘ button), the list of keys made from the actions. |
| `unit/connection.test.js` | EN-2: which errors count as an outage, the down → `/health` polling → restored cycle, cancelled requests (`ABORTED`, also for paged lists) and a simulated 502 from the proxy. `/health` with the API's version; `auth/me` for the admin and the reader key, and a 403 for a reader that tries to delete. |
| `unit/refs.test.js` | BR-17, BR-18: XMI identifiers and folder paths as link tokens (escaping and back, digits are ids) and the API's `resolve` of both. |
| `unit/security.test.js` | EN-3: the Content-Security-Policy and other headers `serve.py` sends (the test server reuses its handler, so every test runs under the policy), `/__proxy/info`'s allowed origins, the API key kept in session storage unless remembered. Also the settings migration: a stored `/api/v1` base, and the baskets and manual layouts stored under it, move to `/api/v2`. The smoke tests fail on any CSP violation, check the Settings warning for a blocked PlantUML server, and run PNG export and the ELK worker under the policy. |

Options: `--filter <text>` (e.g. `store`, `smoke`), `--headed` (visible
browser), `--serve` (only start the server; open the printed URL in any
browser to run or debug the tests there), `BROWSER_BIN=<path>` to choose the
browser. When adding a feature, add its test to the matching file (new files
go into `TEST_FILES` in `tests/runner.js`), and extend the fixture if needed
(`tests/fixture/model.json`; ids in tests go through `E`, `R(n)`, `V(n)` and
`F(label)`, never as plain numbers, because the API assigns them).

### Notes

* Edit files and reload. `serve.py` sends `Cache-Control: no-store` for
  static files and ignores `If-Modified-Since`/`If-None-Match`. The standard
  library handler compares file times to the second, so after quick
  successive edits it answered *304 Not Modified* and the browser kept
  stale JavaScript. **Restart a running `serve.py` / `archimatebrowser.bat` once** to
  pick this up.
* The browser and the API are two projects, each a git repository of its
  own, developed side by side. The browser never changes the API's files at
  run time: the proxy only reads `API_KEY` from its `.env` when `--env-file`
  is given, and the tests start the API on a temporary database. When the
  browser needs something the API cannot answer, the API is extended; see
  the gaps in [PLAN.md](PLAN.md).
* **Translations (EN-7):** wrap every user-visible string in `t()` from
  `js/i18n.js`, written in English: `t('Diagram of basket')`. Use
  placeholders for variable parts, `t('Added {name}.', { name })`, and
  `'one|other'` keys with `n` for plurals,
  `t('{n} element|{n} elements', { n })`. A Czech entry for a plural is an
  array `[one, 2–4, 5+]`. When one English word needs different Czech
  words, prefix a context: `t('selection::Clear')` shows *Clear* in English.
  Add the Czech text to `js/i18n-cs.js` under the
  same English key; a missing entry simply shows English. In
  `index.html`, plain texts and `title`/`placeholder`/`aria-label` are
  translated by exact match; a sentence with inline markup gets a
  `data-i18n="html.<id>"` key whose Czech value is HTML. Never pass model
  content (names, property values) through `t()` as the key.

## License

MIT, see [LICENSE](LICENSE). Third-party code keeps its own licence (ELK in `vendor/elk/` is EPL-2.0, see its `LICENSE.md`).
The ArchiMate icons in `img/sprites/` come from PlantUML's built-in sprites, credited to Archi, and are not covered
by this project's licence: see [img/sprites/NOTICE.md](img/sprites/NOTICE.md).
