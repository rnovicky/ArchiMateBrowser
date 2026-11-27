# Changelog

Version numbers start at 2.7.0 (2026-10-23); before, changes were listed
by date, with the version of the ArchiMate API they need.

## 2.32.0 (2026-11-27)

* **The model list by name:** the models in the drop-down at the top are
  sorted by name (without regard to case; numbers in names in their order),
  no longer by id. Copies with the same name keep their id after the name.
* **Relationship names can be hidden:** *Layout → Labels → Relationship
  names* turns the names drawn next to the lines on or off, in every
  diagram at once (generated diagrams and stored views), without a new
  layout. *Download .svg/.png* and *Copy image* follow it. The choice is
  remembered in this browser; *Set to default* shows them again.
* **Install package:** links in its Markdown files to files it leaves out
  (the working documents, the API's files) now point to the same file on
  GitHub.

## 2.31.0 (2026-11-20)

Renaming and deleting views of the model's source needs the ArchiMate API
3.23.0.

* **Every view directly under Views:** the views of the model's source in
  the model's order, then the created views and recipes by name, each with
  its icon (🖼, ✎, 📜). The groups *Created views* (by who made them) and
  *Recipes* are gone. Who made a created view or recipe, and when, is in
  its details (*Created by*, *Created on*) and its tooltip in the tree.
* **Views of the model's source are renamed and deleted** (*Rename…*,
  *Delete…*, in their details and menu) on a model mastered here, with a key
  that may write. Deleting one asks first and says that a replace of the
  model from a file that has the view brings it back. What a source view
  shows is not edited; *Edit view* stays for created views. On a model linked
  to a file its views are changed in Archi.

## 2.30.0 (2026-11-20)

Seven features and a fix. Recipes need the ArchiMate API 3.22.0; the rest
works with the API as before.

* **Rename model…** (the model's details and menu, admin): its name and
  documentation.
* **Documentation** is shown in the details of every element,
  relationship, view and model, also when there is none (*No
  documentation.*).
* **"on diagram" and "add to diagram":** on the *Relationships* tab and at
  a relationship's *Source* and *Target*, a related element drawn in the
  diagram shown is marked *on diagram*; one that is not has *add to
  diagram* (while a generated diagram, or none, is shown: a stored view is
  not added to). A click on *on diagram* brings the element into view in
  the diagram, marks it and makes it flash; the details stay.
* **Recipes** (API 3.22.0): *Save as recipe…* (above a generated diagram,
  or its menu) keeps how the diagram is made, as its link carries it: what
  it draws, the filters, property options, layout options, nesting and
  moved elements, without positions of its own. Recipes are listed in the
  tree under *Views › Recipes* (📜). Opening one draws its diagram again
  from the model as it is then; changed, it is saved back with *Save recipe
  “…”*. A recipe is renamed and deleted like a created view; its details
  show the recipe.
* **Renaming and deleting saved views:** *Rename…* and *Delete…* are
  offered for created views and recipes, in their details and in the tree's
  menu, with a key that may write (role `editor` or `admin`). With a reader
  key, or the placeholder key of a new installation's `.env`, they are not
  offered.

Fix:

* **A diagram saved as a view keeps its lines:** saving now keeps where each
  line meets its boxes (the connection's attachment points), so the
  orthogonal lines of the automatic layout stay at right angles; before, a
  stored view drew a line's ends towards the middle of its boxes, which
  slanted them. Views saved before keep their slanted ends until they are
  saved again (*Edit view*, *Save*).

## 2.29.0 (2026-11-09)

Images of diagrams for the ArchiMate MCP server 1.12.0 (its `diagram_image`
tool, for reports and documents). Nothing changes for people using the
Browser.

* **Render mode (RN-1):** the page opened as `…/?render` opens no model by
  itself and offers `window.archiRender` to the program that opened it:
  `draw(link, { direction })` draws the diagram of a Browser link (a stored
  view as it is stored, a generated diagram with the link's filters,
  nesting and layout options), `svg()` and `png(scale)` hand it over as
  *Download .svg* and *Download .png* make it. Nothing asks a question (the
  "more than 400 elements" check is skipped), the PlantUML tab is never
  used, and an error is reported to the caller with its reason. What a
  link leaves out is the default, not what an earlier image used.
* **`serve.py`:** `--port 0` takes any free port, and the first line it
  prints names it; `--exit-with-stdin` stops the server when its standard
  input closes, so that a server started by another program ends with it.
* **Folders say their version:** *Rename…*, *Move to…* and *Delete…* of a
  folder send the version of the folder the tree shows (`expectedVersion`),
  as every other change of the Browser already did. Someone who changed the
  folder since is not overwritten (`412`), and an API with
  `REQUIRE_IF_MATCH=true`, which refuses a change that says no version
  (`428`), takes them.
* **Tests:** the test API runs with `REQUIRE_IF_MATCH=true` (not taken from
  the API's own `.env`), so the tests show that every write of the app sends
  a version; a new smoke test checks that the test API refuses one without,
  and that `GET /auth/me` says so (`requireIfMatch`, API 3.21.0). The tests'
  own writes, which stand for someone else, send `If-Match: *`.
  `ARCHIMATE_TEST_REQUIRE_IF_MATCH=false` runs them against an API that does
  not ask.
* **Tests:** the folder smoke test (BR-11 step 3) waits until the app reports
  a deleted element before it opens the next item: the app still selects the
  model after the delete's request, which now and then undid the test's next
  step.

## 2.28.0 (2026-11-06)

Three fixes and seven features. The link picker, the whole-model diagram and
AND/OR in the property search need the ArchiMate API 3.20.0; the rest works
with the API as before.

Fixes:

* **Arrowheads in a newly opened diagram:** every drawing had its
  arrowheads under the same ids, so a diagram in a second tab could use
  those of a hidden tab, which Chrome does not draw: lines without ends
  until the page was refreshed. Each drawing now has its own.
* **The History tab shows every change:** 50 at a time, newest first, with
  *Show N older changes* until all are there (it stopped at 20 for the
  model, 50 for an item).
* **The link dialog picks the file:** *Browse…* next to *File on the
  server* lists the folders the server allows, then a folder's sub-folders
  and its `.archimate` and `.xml` files (size, date, and the model a file is
  linked to already); a click fills the path. Admins only, as linking is.

New:

* **New model…** (model menu, admin): a new, empty model, by default with
  Archi's top-level folders (Strategy, Business, …, Relations, Views), opened
  at once. Also offered when the API holds no model yet.
* **A diagram of the whole model:** right-click *Folders* or *Elements* in
  the tree. Offered for a model of at most 300 elements; *Settings → Diagram
  of the whole model: up to* changes the number (0: never). The link writes
  it as `d=wm`.
* **Collapse and show one level** (right-click an element of a generated
  diagram): what hangs off the element folds away, then its directly
  related elements are shown, in one step; *← Back* undoes it.
* **AND and OR in the property search:** `@Owner=Sales AND @Cost OR
  @Status!` finds what has Owner Sales and a Cost, and what has no Status.
  AND binds tighter than OR; written in capitals, so that *Sales and
  Marketing* stays a value. Offline copies search the same way.
* **Close the side panes, full screen:** ◧ and ◨ in the diagram's header
  close the model tree and the details pane (remembered), ⛶ makes the page
  full screen with both closed (Esc leaves it and brings them back). Also in
  the commands (Ctrl+K).
* **"on diagram" on the Relationships tab:** a related element drawn in the
  diagram shown (generated or a stored view) is marked, and the marks follow
  the diagram.
* **Filters → Element types:** *all* / *none* for each layer's group.

## 2.27.2 (2026-10-30)

* **Drill-down links in a copy of part of a model** (BR-24): a link to a
  view the copy does not hold now says so (its tooltip: *Opens view: a view
  not in this offline copy*; a click: *The view this link opens is not in
  this offline copy*) instead of reporting an error.
* **Phones and tablets** are no longer an open point of BR-24: they mostly
  do not run the scripts of a local HTML file, and offline copies stay a
  desktop feature.

## 2.27.1 (2026-10-30)

PlantUML (PU-2 to PU-5) tried against a real PlantUML server (PlantUML's
own PicoWeb server, 1.2026.9); what it showed is fixed.

* **A stored view keeps its rows:** each relationship is now drawn the way
  it goes in the view (sideways between elements of one row, else up or
  down), with the stdlib's `Rel_…_Right`, `_Left`, `_Up`, `_Down`. Before,
  the relationships, drawn downwards, outweighed the hidden links and broke
  the rows.
* **Long diagrams by POST also with PicoWeb** (`java -jar plantuml.jar
  -picoweb`): it takes the diagram at `/render`, sent so that the browser
  needs no CORS preflight. The PlantUML server (plantuml-server,
  plantuml.com) still gets it at `<server>/svg`; when neither answers with
  an SVG, the long URL is tried.
* **The hand-drawn look** uses `!option handwritten true`: PlantUML writes
  a warning into the diagram for the old `skinparam handwritten`.
* **One legend:** the colours of a property and the element types are one
  legend (PlantUML drew only the last of two). Grouping, which has no
  sprite, is left out of the types.

## 2.27.0 (2026-10-30)

* **Offline copies of a part, and with a password** (BR-24). *Share as
  offline copy…* now asks first:
  * **What:** the whole model, the folder selected in the tree (and what is
    in it), or the view that is open (and what it shows), with the
    elements and relationships they need. Needs the ArchiMate API 3.19.0
    (`…/snapshot?folder=…&view=…`). The copy's banner names the part.
  * **A password** (optional, typed twice): the model in the file is then
    encrypted (AES-GCM, the key derived from the password with PBKDF2,
    600,000 rounds), the page asks for the password before it shows
    anything, and its title names no model. A wrong password is refused;
    a forgotten one cannot be recovered.
* **A palette element stays where it is dropped** (or clicked): it is
  pinned there, as if moved, instead of the layout fitting it in nearby.
* **Long relationship-type lists in a submenu** (CM-10): a diagram
  element's menu puts more than six relationship types into *Show by
  relationship type ▸*, which opens inside the menu, by a click or →; ←
  closes it.
* **PlantUML** (PU-2 to PU-5):
  * a diagram whose URL would be longer than 4000 characters is sent to the
    PlantUML server by `POST` (servers and proxies refuse long URLs);
  * a stored view keeps its arrangement: its rows and their order become
    hidden links, always top to bottom;
  * an element that contains others shows its type's ArchiMate icon instead
    of the type's name in the box;
  * a stored view's own fill, line and text colours are kept; *Settings*
    can add a legend of the element types, and a hand-drawn look.

## 2.26.0 (2026-10-30)

Stage 3 of the multi-user epic, "fresh readers" (MU-13 with MU-14; the API's
`EPIC_STAGE3_DECISIONS.md`, U5, U8, U9). Uses the change events of the
ArchiMate API 3.17.0; with an older API it polls as before.

* **Changes made elsewhere show at once:** the open model's change events
  come through a stream that stays open, and the change bar appears within
  about a second, with who changed what (for editors) straight from the
  event. A model that does not change costs no requests.
* **The list of models follows by itself** when a model is made, renamed,
  imported or deleted elsewhere; the open model is not touched.
* **A model deleted elsewhere** while open: the bar says so.
* **The page's own changes** are told apart by the request id it sends
  with each write (`X-Request-Id`), so they never show the bar, also with
  the same person editing in two tabs.
* **Polling is the fallback:** every `changeCheckSeconds` (15) while the
  stream cannot be had (an older API, a proxy that cuts long requests, too
  many streams open); the stream is tried again meanwhile.
* `server/serve.py` passes an answer that stays open on as it comes,
  instead of waiting for its end.
* The record of changes names an unlinked model (*unlinked from its file*,
  API 3.17.0).

## 2.25.1 (2026-10-29)

* **✎ Edit says what it does in its tooltip:** *Editing is on: … Click to
  turn it off.* or *Editing is off. Click to turn on editing …*. Switching it
  no longer writes this into the status line. The button stays blue while
  editing is on.

## 2.25.0 (2026-10-29)

* **Editing, step 3: removing and organising** (BR-11; the API's
  `BROWSER_EDITING.md`). With ✎ Edit on:
  * **Delete…** an element or a relationship. It asks first and says what
    goes with it: an element's relationships and the views it is taken out
    of, a relationship's attached relationships and its views. It cannot be
    undone; the record of changes keeps what was there.
  * **File in folder…** an element, a relationship, or a view of the source
    (a created view is not filed): it leaves its folders for the one chosen
    from a filtered list of paths.
  * **Folders:** *New folder…* (in a folder, or *New top-level folder…* in
    the model's menu), *Rename…*, *Move to…* (another folder or the top
    level, never below itself), *Delete…*: an empty folder after a
    question, one with contents after choosing where they go. What is filed
    in a folder is never deleted with it.
  * Each is one request, one transaction. The tree, the diagram and the
    details follow.
* With this, BR-11 (editing in the Browser) is done: change, create, remove.

## 2.24.0 (2026-10-29)

* **Editing, step 2: creating** (BR-11; E15 of the API's `BROWSER_EDITING.md`).
  With ✎ Edit on, a generated diagram (a created view being edited among
  them) has a **palette** at its left: every element type by layer and every
  relationship type, each with its ArchiMate sprite, a filter field, and
  layers that fold. The diagram moves to the palette's right.
  * **A new element:** drag a type onto the diagram, or click it and then a
    place. The name is asked for, and the element is created there, filed
    in its layer's folder and selected. An element of the same type and
    name is named first; creating another one is allowed.
  * **A new relationship:** *Connect*, then click the source and the target
    element; the palette then offers only the types ArchiMate allows
    between them. Or choose a type first, then its source and target. A
    pair it may not join is refused, with the types that would do. Esc ends
    either.
  * **Without the mouse:** *New element here…* in the diagram's menu (a type
    from a filtered list), *Connect to…* in an element's, *New … element…* on
    a type in the tree; Ctrl+K offers them too.

## 2.23.1 (2026-10-29)

* **Fix:** the dialog of *Save as view…* and *Rename…* showed *Name* and
  *Documentation* side by side on one line; each is on a line of its own
  now, with its field below it.

## 2.23.0 (2026-10-29)

Needs API 3.16.0 for what is new (BL-57, BL-58); with an older API the
Browser offers no editing.

* **Editing, step 1** (BR-11; the API's `BROWSER_EDITING.md`): **✎ Edit** in
  the top bar, off by default and kept per browser tab, turns the details of
  an element or a relationship into a form. Change the name, the
  documentation, the type (an element's: its layer's types first; a
  relationship's: the types ArchiMate allows between its ends) and a
  relationship's attributes. Change, add or remove property values. *Save*
  sends what changed in one request (one transaction), checked against the
  version the form was opened with. The tree, the diagram and the details
  show it at once, and the change bar does not count it as someone else's.
  * **Someone saved in between:** the form says who, when and what, and
    offers *Take theirs* or *Save mine anyway*. Nothing is overwritten
    unasked.
  * **History** offers *Put back* for an earlier name or documentation.
  * **Only a model mastered here** can be edited. A model linked to a file
    is read-only, and the switch says why. Only with a key that may write,
    never in an offline copy.
* **The model's details** say where its master is: here, with how many
  changes since the last import, or its linked file.
* **A replace that would undo changes made here** (API BL-57) asks first:
  the preview says how many changes, by whom and the newest ones. The
  button reads *Replace the model, undoing n change(s)*. A refused replace
  offers the same, and so does linking such a model to a file.

## 2.22.1 (2026-10-29)

* **A proposed view:** a diagram link with `vn=<name>` (the MCP server's
  `propose_view`, MCP 1.9.0) shows a bar above the diagram, *Proposed view
  “…”: arrange it, then save it.*, whose *Save as view…* has the name filled
  in. A key that may not write is told so. The link keeps the name until the
  view is saved.

## 2.22.0 (2026-10-29)

Needs API 3.15.0 for what is new; with an older API the Browser works as
before and offers none of it.

* **Created views** (BR-25, the Browser's first writes; API BL-56). A view is
  one of the model's source or a created view, marked ✎ and listed under
  *Views › Created views* by who made it; its details say who made it, when,
  and which view it copies. Source views are never changed.
  * **Save as view…** above a generated diagram (and in its menu): the
    diagram as drawn, with your moves, nesting, notes and the relationships
    shown, as a new view. An editable copy of a source view becomes a copy
    of it.
  * **Edit view**: the created view as a diagram, each element where the
    view has it, with *Save*, *Save as new view…* and *Discard*. A view
    saved by someone else meanwhile is not overwritten (`If-Match`).
  * **Rename…**, **Delete…** (asks first).
  * What an update from the source took out of a created view is listed in
    its details until it is dismissed.
  * Only with a key that may write; never in an offline copy. The change
    bar does not count the page's own saves as changes by others.

## 2.21.0 (2026-10-29)

* **Commands (Ctrl+K)**, also the ⌘ button next to the search: type to
  find an element, a relationship or a view of the model, choose it and
  then what to do with it: the actions of its menu. The commands of the
  diagram and the model (*Fit to window*, *Tidy*, *Select all elements*,
  *Copy link*, *Download .png*, *Export model*…) are found by their words
  too. What is selected is offered first. ↑/↓ choose, Enter runs,
  Ctrl+Enter opens a diagram in a new tab, Backspace goes back from an item
  to the search. Works in an offline copy too.
* **One action registry** (CM-11, `js/app/actions.js`): every action on an
  element, a relationship, a view, a folder, a type, a layer, a relationship
  type, a property, the model, the basket and the diagram is defined once.
  The context menus, the buttons of the details, the keyboard shortcuts and
  their list, and the commands are made from it, so they offer the same
  actions under the same names and in the same order. What this changes:
  * the buttons of the details are named as in the menus: *Show in tree (by
    type)* for an element, *Add to new diagram* when no diagram can take it,
    *Diagram of both ends* and *Add both ends to basket* for a relationship,
    *Add its elements to basket* for a view, *Add elements to basket* (with
    their number) for a folder, *Show in folders* for a folder;
  * a relationship's details also offer *Show the n relationships attached
    to it*, and its *Diagram of both ends* shows its two ends, as in its menu
    (before, the button also took in the relationships attached to it);
  * *Show in folders* is in the menus of relationships and views too;
  * the model's menu does not offer *Import model…* and *Delete model…* to a
    key that may not do them, nor *Refresh* and *Export* in an offline copy.

## 2.20.0 (2026-10-29)

Needs API 3.14.0 for the new entry; with an older API it is not shown.

* **Share as offline copy…** in the ⋮ model menu: one HTML file that shows
  the open model in a desktop browser without the API, a server or anything
  installed, for colleagues. It is the model as it is at that moment,
  read-only, and says so in a banner (revision, when, by whom). Everything
  that reads works as in the Browser: the tree, details, search, stored views,
  neighbourhood and explorer diagrams, filters, impact analysis, paths, the
  reports, downloads. What needs the API or a server is not offered: import,
  export, delete, linked files, sign-in, the history, and the PlantUML view.
  A model of about a thousand elements gives a file of about 1.8 MB. See
  *Offline copies* in the README.
* Under the hood: a stand-in of the API (`js/offline/`) answers the Browser's
  requests from the model's snapshot, with the API's rules ported; a test
  compares its answers with the real API's for both test models, and
  `run_tests.py` opens copies from disk in headless Chrome or Edge.

## 2.19.0 (2026-10-27)

* **The details pane in tabs:** *Properties* (documentation, endpoints of a
  relationship, attributes, property values, the views that show the item),
  *Relationships* (outgoing and incoming; for a relationship, those attached
  to it), *Impact analysis* and *History*. The type, the name and the action
  buttons stay above them. The tab chosen stays for the next item, so you
  can click through elements with *Impact analysis* open; the analysis and
  the history are asked for only when their tab is shown. A view and the
  model have *Properties* and *History*.
* **The folder under the name**, without a heading; *Show in folders* comes
  after *Show in tree*.
* **Closing a diagram tab asks first** (×, middle-click, Delete on a tab,
  *Close*, *Close the others*), as *Clear diagram* does: a closed tab cannot
  be opened again. An empty tab closes without asking.
* **Keyboard shortcuts:** **Delete** hides the selected elements (or the
  element focused in the drawing, or the selected relationship) from the
  diagram, **Backspace** is *← Back*, **Ctrl+A** selects every element of
  the diagram, **?** lists the keys (also *Keyboard shortcuts* in the
  diagram's menu). The menus show the keys next to their entries (CM-10).
  They are left alone while typing, in dialogs, the trees and the tab bars.
* **Fix: the hide rules offered no element types.** The lists of the source
  and the target type in the Filters tab had only *any* and *a
  relationship*; the types, grouped by layer, were lost on the way. Now a
  rule like *Serving from Application Service to Business Process* can be
  made there, keeping the other Serving relationships.
* **+N on every generated diagram:** a neighbourhood, basket, folder, impact
  or paths diagram shows how many related elements each element has that are
  not in it yet, as the explorer did; before, only the explorer showed them,
  though a double-click expanded any of them.

## 2.18.0 (2026-10-26)

* **Fix: a link opened while something was still loading could be
  ignored.** By the time the page handled the change of its address, the
  thing still loading could have written the address of before over it, and
  the page showed that. It now takes the link from the event itself. It made
  a different smoke test fail now and then; four full runs in a row pass.
* **Right-click on the PlantUML drawing** (CM-2): an element's, a
  relationship's and a linked view's menu, as in the native diagram; empty
  space gives the diagram's menu.
* **A long press opens the menu on a touch screen** (CM-10): on tablets and
  phones, where there is no right button (iOS Safari sends no right-click of
  its own). A tap stays a tap.
* **Icons** on frequent actions (UX-3): *Options*, *Filters*, *Layout*,
  *Share*, *Copy link*, *Copy image*, the downloads and exports, *Refresh*.
  Drawn in the text colour, so they follow the theme and need nothing from
  the network; the text stays.
* Tests: a wait that times out can say what the page showed (`waitFor`'s
  `what` may be a function).

## 2.17.0 (2026-10-26)

Needs API 3.13.0 for both; with an older API the rules are sent but
ignored, and the export entry is not shown.

* **Hide relationships by their type and the types of their ends:** rules
  in the diagram filter (Filters tab), e.g. *Flow from Node to Node* or
  *anything from Application Service*. A relationship's menu offers the
  rule for relationships like it (*Diagram filter: hide Flow: Node →
  Node*). The rules go into the link and into saved filters, steer the
  neighbourhood and the expansion counts like the type filters, and fade
  the relationships they hide in a stored view.
* **Export as SQLite database** in the model's ⋮ menu: the model as an
  SQLite file with the API's tables.

## 2.16.0 (2026-10-26)

* **The tab of the diagram is always shown**, also when only one diagram
  is open: its title, and **+** for another. The only tab has no ×.
* **"In a new diagram"** for every menu entry that opens or replaces a
  diagram (Neighbourhood diagram, Explore, Add to diagram, Diagram of …,
  Impact analysis, Dependencies, Paths, Open view, Editable copy, Automatic
  layout, …): the **⧉** button at the end of the entry's row opens it in a
  tab of its own, as a Ctrl- or middle-click did. *Add to diagram* ⧉ makes
  a new diagram of the elements instead of adding them to the one shown.
  The separate *Open view in a new tab* entry is gone: it is *Open view* ⧉.
* **Copy image** in the diagram's context menu and in the menu of its
  title, next to *Download .svg* and *Download .png*.

## 2.15.0 (2026-10-26)

Stage 2 of the multi-user epic, "safe concurrent writes" (the API's
`EPIC_STAGE2_DECISIONS.md`, T7), the Browser's part.

* **Delete model checks the model as the page has it:** with API 3.12.0 or
  newer the Browser sends the model's revision (`If-Match`), and a model
  someone changed after the page loaded it is not deleted. The dialog says
  so, and who changed it: refresh the model and look at the changes first.
  With an older API it deletes as before.

## 2.14.0 (2026-10-26)

What others change, made visible: stage 3 (MU-13) and part of stage 5
(MU-17) of the multi-user epic. The history needs API 3.11.0 (3.11.1
recommended) and a key with the role editor; the rest works with any API
from 2.10.0.

* **The model was changed elsewhere** (MU-13): every 15 seconds while the
  page is visible (and at once when it becomes visible again), the Browser
  asks the API for the open model's revision. When it has grown, a bar says
  so, with who changed it and with which client (*1 change(s) by jnovak
  (ArchiMate MCP 1.7.1)*), for a key that may read the record of changes.
  *Refresh* loads the changes (the tabs stay), *Show changes* lists them in
  the details, *Dismiss* keeps working with the model as loaded (the bar
  comes back with the next change). Nothing is reloaded by itself. The
  interval is the setting `changeCheckSeconds` (15; 0: never).
* **History in the details** (MU-17): an element, a relationship and a view
  have a *History* section: who changed what, and when, newest first, with
  names and values before and after; the model's details list its *Recent
  changes*, with links to the items. From the API's record of changes, for
  keys with the role editor; for readers the sections are not shown.

* **Accessibility** (EN-4):
  * The trees (model, search results, basket) follow the WAI-ARIA tree
    pattern: each row has its level, its position and the number of its
    siblings, its selected and busy state, and is named by its label; the
    selected row is the tree's active descendant. Home, End, `*` (expand
    the siblings) and typing the start of a name work as the pattern says.
  * The diagram from the keyboard: the drawing is one tab stop; the arrow
    keys move between elements (an element off screen comes into view),
    Enter or Space shows the details, the Context Menu key or Shift+F10 the
    menu, `+` the related elements, Escape returns to the drawing. Elements
    are named for screen readers (*Order Handling, Business Process*), and
    the focus is drawn in the accent colour.
  * Following a link in the details moves the focus to the heading of what
    it opened.
  * A test checks the contrast of the page's colours in both themes and of
    dark text on every layer colour (WCAG AA, 4.5:1): all pass.

## 2.13.0 (2026-10-26)

Stage 1 of the multi-user epic, "who and when" (the API's
`EPIC_STAGE1_DECISIONS.md`, S7, S8, S12), the Browser's part. Works with any
API from 2.10.0; users with their own keys come with API 3.11.0.

* **Sign in** (MU-4): the top bar shows who you work as, *Name (role)*, or
  *Sign in*. Its menu says with which key, and offers *Sign in…* (or *Sign
  in with another key…*) and *Sign out*. The sign-in dialog takes your own
  API key, checks it with the API before keeping it, and keeps it for the
  browser session, or remembered with a tick (the key of *Settings →
  Connection*, as before). When the API refuses the key in use (`401`), the
  dialog opens by itself and says why: unknown, revoked, expired, or the
  user disabled (API 3.11.0). A key that expires within 14 days is
  mentioned in the status line.
* **The proxy adds the API's admin key only on the person's own machine**:
  the fallback to `API_KEY` of the API's `.env` is used only when the
  Browser listens on `127.0.0.1` (the default). On a shared machine
  (`--bind 0.0.0.0`) it adds a key only when one is set
  (`ARCHIXMI_API_KEY`, recommended: a reader key for those who only look;
  empty: everyone signs in). **This changes what a shared installation that
  relied on the admin fallback does: set `ARCHIXMI_API_KEY`, or sign in.**
* **`X-Client: ArchiMate Browser 2.13.0`** on the requests through the
  proxy, so that the API's record of changes names the Browser.
* A refused key's message says to sign in, and the error boxes offer *Sign
  in…* for a `401` (*Open settings* stays for a `403`).

## 2.12.0 (2026-10-25)

* **Refresh** (BR-21): in the ⋮ model menu and in the menu of the model in
  the tree. It loads the model list and the open model again from the API,
  so that a model created elsewhere (for example by the MCP server's
  `create_model`) appears in the picker, and elements, relationships,
  properties and folders added or changed elsewhere show in the tree, the
  details and the diagrams. The open tabs and the diagram shown stay; a
  model that is gone gives way to the first one.
* **The replace preview names what changes** (BR-16, with API 3.10.0,
  BL-36): what would be added and removed is listed by name and type, with
  the XMI identifier after it, and what would be kept but differs is
  listed too: a new name or type, property values before and after,
  changed documentation or ends. The result after the replace says the
  same. With an older API the XMI identifiers are listed, as before.

## 2.11.0 (2026-10-24)

* **Several diagrams open at once, in tabs** (BR-15). A diagram opens in
  the tab shown, as before; **Ctrl-click** (Cmd on a Mac) or a
  **middle-click** on a menu entry or a button of the details pane opens it
  in a new tab, and so do *Open view in a new tab* (the menu of a view in
  the tree), *Duplicate in a new tab* and *New empty tab* (the menu of the
  diagram's background). With two or more, a tab bar shows them: click to
  switch (the drawing stays as it was, with its zoom, manual layout, undo
  and explorer history), × or a middle-click to close, right-click to
  duplicate, copy the link or close the others; the arrow keys move between
  tabs. At most 15.
* **Each tab has its own filters, property options and layout options**; a
  new tab starts with those of the tab it was opened from. The link (and the
  URL) is the tab shown.
* The open tabs come back after a reload of the page (this browser tab
  only); the others are drawn when they are first shown.
* A diagram still loading finishes in its own tab when another is shown
  meanwhile; before, every diagram shared one state, and a slow layout could
  draw over the next diagram.

## 2.10.0 (2026-10-24)

* The **quality report** shows the API's new check (API 3.7.0, BL-51):
  relationships ArchiMate does not allow between the types of their ends,
  each named with its ends and their types. An older API answers without
  it.

## 2.9.0 (2026-10-24)

* **A model is loaded on demand, not whole** (phase 4, UP-3, UP-6, HLP-6,
  HLP-8). Opening it costs four requests whatever its size: the view list,
  the statistics, the property index and the folders, without what is filed
  in them. Elements and relationships are asked for when the page shows
  them and kept while the model is open. On the real model of about 1,000
  elements and 1,500 relationships, opening it fetches 62 KB instead of
  1.3 MB.
* The tree's `n↗ m↙` come from the API (`include=degree`); the
  relationships of a type are ordered by their ends by the API.
* The *Folders* branch asks for what is filed in a folder when the folder
  opens: elements, then relationships, then views, each in the folder's
  order (before: all in the order of the file). Items filed at the top
  level, outside any folder, are no longer listed there.
* The basket is restored a moment after the tree: its stored identifiers
  are resolved by the API.
* A menu that needs something first (a relationship's, a type's, a layer's)
  opens when the answer is there.
* The plan of the upgrade to API v2 is finished (phase 5): the README
  describes loading on demand, the endpoints used and how to run the
  browser without its proxy (API-3, with the API's `CORS_ORIGINS`); the
  proxy keeps `127.0.0.1` as the API's address (API-7); unused Czech
  strings are removed.
* Needs API 3.5.0 for the smaller folder tree (`foldersOnly`); with an
  older one the full tree is loaded, as before. The minimum stays 2.10.0.

## 2.8.0 (2026-10-24)

* **The browser's own graph rules are gone** (phase 4, UP-5, UP-6): the
  local neighbourhood, impact analysis, hidden neighbours and nesting, the
  comparison mode that checked the API against them (*Settings → Advanced*),
  and their tests. Every question of what is related to what goes to the
  API, as it has since phase 3. About 350 lines less; the test run takes
  112 s instead of 148 s.
* **Reports** (ALT-4), in the model menu, on API 3.6.0 (an older API gives
  a note): the **quality report** (what is probably unfinished or wrong,
  per check), the **relationship matrix** (rows and columns from the basket,
  the diagram, a layer or a type, connected directly or along a path of 2
  or 3 steps; a cell lists its paths and draws them; CSV) and the
  **landscape map** (nested boxes along Composition and Aggregation,
  optionally with the elements that realize them or are assigned to them,
  coloured by a property). Names select, *Diagram* draws.
* **`app.js` split into modules** (EN-6): its 5,170 lines are eleven
  modules in `js/app/` (state, ui, treespecs, details, routing, basket,
  diagram, menus, panels, models, shell). `app.js` keeps only the
  statements that run at start-up, in their order, so nothing behaves
  differently; all 173 tests pass unchanged. The i18n test checks the new
  files too.

## 2.7.0 (2026-10-23)

* **`runtests.ps1`:** lint of the Python parts (`ruff`, `ruff.toml`), then
  the tests. The API's `runtests.ps1 -WithClients` runs it as well.
* Two backlog ids were used twice: *Collapse* (2026-10-21) and *Notes in an
  editable copy* (2026-10-22) were released as CM-10 and CM-11, the ids of
  two open items in `IMPROVEMENTS.md`. They are CM-13 and CM-14 now, here
  and in the code.
* **A version number:** 2.7.0, in `js/version.js`, shown in the Settings
  dialog next to the API's version. `deploy.ps1` reads it, and takes any
  version number as newer than an installation that has only a date.

* `deploy.ps1` also stops when a program started from the installation
  (its `.venv`'s Python) still runs, not only when the port answers. The
  script is the same in the packages of the ArchiMate API, the browser and
  the new ArchiMate MCP server; `$UsesDatabase` in its settings block says
  whether it backs up and migrates a database.
* `createinstallpackage.ps1` leaves only the `.zip` in `dist/`; the folder
  it builds the package in is deleted afterwards (`-KeepFolder` keeps it).
* **All CSV downloads in one format** (*js/csv.js*): every field quoted,
  separated by a semicolon, CRLF, UTF-8 with BOM. The basket's CSV and the
  impact analysis CSV used commas; the latter is the API's and comes with
  the semicolon from API 3.2.0 on (`csvDelimiter`), an older API still
  answers with commas.
* **Share → Copy image:** the diagram's PNG in the clipboard.
* **Share → Download elements as CSV:** the diagram's elements with id, XMI
  identifier, type, layer, name, documentation, folder and properties (as
  JSON); semicolon-separated, UTF-8 with BOM.
* **Share → Download as JSON:** what the diagram shows (elements,
  relationships, notes, groups, links to views, lines) with attributes and
  properties, without coordinates.

## 2026-10-22

* **A view's menu in the tree** has the same actions as the menu of the
  opened view, *Editable copy (keeps the arrangement)* included (it
  replaces *Add to new diagram*; *Add to diagram* stays while a generated
  diagram is open).
* **Automatic layout of its elements** keeps the view's notes and their
  lines too (placed by the layout; movable and hideable as in the editable
  copy).
* **Notes in an editable copy** (CM-14): *Editable copy (keeps the
  arrangement)* of a view keeps the view's notes and the lines between
  notes and elements. Notes can be dragged (their lines follow) and hidden
  (*Hide note*); a line goes when either end is hidden, and *← Back* brings
  it back. The diagram link carries the notes. Notes have an invisible box,
  so they are easier to grab and right-click, in stored views too.

## 2026-10-20

* The model menu's *Import XMI…* and *Export XMI* are now **Import model…**
  and **Export model** (the dialog is *Import model*): they also take and
  give Archi's `.archimate` files.
* *Link a file on the server…* says that an `.xml` exchange file can be
  linked too (API 3.1.0; it needs no Archi on the server).
* **Set to default** at the end of the *Options*, *Filters* and *Layout*
  panels resets that tab's settings (and only those) to their initial
  state; disabled while they are. Moved elements stay (*Manual → Reset*).
* **Another model with property options on:** when the model has no
  property of the name that the property filter, *Label* or *Colour by*
  uses, that option is removed, with a note in the status line.
* Fixed: changing *Follow* in an explorer diagram raised an error instead
  of updating the "+N" badges.

## 2026-10-19

* **Collapse** in generated diagrams (CM-13): right-click an element →
  *Collapse, keeping the way to <selected element>* folds away its related
  elements and what hangs off them, except the way to the selected element;
  on the selected element itself, *Collapse around this element* folds away
  everything connected to it. Elements still connected to the selected one
  another way stay; *← Back* undoes it.
* **Renamed:** the ArchimateXMI Browser is now the **ArchiMate Browser**, in
  the folder `ArchiMateBrowser`; the launcher is `archimatebrowser.bat` (was
  `archimatexmibrowser.bat`), the packages `ArchiMateBrowser_<timestamp>`.
  The API is the ArchiMate API, expected next to it as `ArchiMateAPI` (its
  earlier names are still found). `deploy.ps1` updates an installation that
  still has the old launcher. Saved settings, baskets and layouts and the
  `ARCHIXMI_*` variables keep their names.

## 2026-10-17

* **Installing and updating with `deploy.ps1`** (in the package, and
  `archimatebrowser.bat deploy <folder> [start]`): installs into a fixed
  folder, or updates the installation there in place, with a backup; keeps
  `.env` and your own files, and deletes the files the new version lacks
  (packages list their files in `MANIFEST.txt`). See README → *Installing
  and updating with deploy*.
* **API 3.0.0**, which serves `/api/v2` only, works as before: the browser
  uses nothing else. A stored `/api/v1` base URL is still moved to
  `/api/v2` when the page loads. Still needs API 2.10.0 or later.

## 2026-10-16 (needs API 2.10.0)

* **Filters in stored views:** what the diagram filters leave out (element
  types, the property filter, relationship types) is now faded in a stored
  view, with the lines that end on a faded element; the view keeps its
  layout. The info line counts what is faded. The PlantUML rendering of a
  view is not faded.
* **Label and Colour by moved to the Layout tab** (row *Properties*): they
  change how diagrams look, stored views included, while the *Filters* tab
  keeps what is shown (the property filter and its *Language*). The
  *Layout* button names them when set.
* **Move all selected elements at once:** dragging one of the selected
  elements of a generated diagram moves all of them, as one step for
  *Undo*. Dragging an element that is not selected moves only that one.
* **Models that share an identifier** (API 2.10.0): a model copied by
  copying its file keeps the identifier.
  * Import: after the *409*, **Import as a separate model**; with several
    models of the identifier, *Replace “…”* for each, the one with the
    file's name first.
  * *Link a file on the server…*: *Link “…”* for one of the models, or
    **Import as a separate model**.
  * Links name such models by number. A link by the identifier that names
    several asks which one to open. Baskets and moved elements stay with
    the oldest; a copy keeps its own. Copies with the same name show their
    number in the model list.
* **Nesting in the Layout tab:** *Show Composition and Aggregation as nested
  boxes* moved from Settings to the *Layout* tab, as *Nesting*: *Off*,
  *Composition and Aggregation*, or the new *Only inside a Grouping* (only a
  Grouping is drawn around its parts; API 2.9.0), with *… and Assignment
  too*. Diagram links carry the choice (`n=`).
* **Property definitions:** each property lists the values elements give it,
  most frequent first, with their counts (from the API's index). A value's
  menu filters diagrams by it (*Only elements where … = …*), which moved
  there from the property's menu. Selecting a property shows its details:
  data type, how many elements have it, its languages and values; the
  overview of the definitions links each name to them.

## 2026-10-15 (needs API 2.8.0)

* **Archi files and linked models** (BR-20). *Import XMI…* also takes Archi's
  own `.archimate` files, and the model menu has **Export .archimate**; the
  API converts them with Archi. **Link a file on the server…** (import
  dialog) imports an `.archimate` file on the server and keeps the model
  updated from it; **Linked file…** shows and changes the link, and
  **Update from file** updates the model now. A linked model is read-only.
* **Export of lines without ends** (BR-19, API 2.7.0). A model whose views
  have lines without a source or target (valid, but refused by Archi) is
  exported only after a question: leave them out, or export as is.
* `createinstallpackage.ps1` works in a deep `-OutputDir` (paths over 260
  characters), and packs only `README.md` and `CHANGELOG.md` of the documents.
* **Search results belong to their model.** Opening another model closes
  them; a model opened again after an update is searched again.
* **Left pane** in three collapsible sections that scroll on their own: the
  basket, the search results and the model tree. The basket is a tree like
  the search results, with a menu for the whole basket; its rows have × on
  hover and the Delete key. The groups of the search results (elements,
  relationships, views) can be dragged into the diagram.
* **Diagram:** the title line has the **⋮** menu (Diagram, PlantUML, Source)
  and the **Share** menu (Copy link and the downloads); *Options*, *Filters*
  and *Layout* are tabs, one panel at a time; *Clear diagram* is among the
  tools on the diagram and asks first.

## 2026-10-14 (needs API 2.6.0)

* **Replacing a model** with a new version of its file, in the import dialog,
  after a preview of the changes (API 2.3.0 and 2.4.0).
* **Links that survive a replace** (BR-17, BR-18): links and moved elements
  name items by XMI identifier, and folders by their path of labels.
* **UI rework:** the model actions and the export in menus, one diagram
  toolbar, grouped settings; one pane at a time on narrow screens, option
  hints, a hint in an empty basket, the same keys in all menus.
* *Fit* never enlarges a diagram beyond its own size.
* Renamed from ArchiXMI Browser to **ArchimateXMI Browser**; one Windows
  script, `archimatexmibrowser.bat` (install, start, run, test);
  `createinstallpackage.ps1` builds an install package.

## 2026-10-11 (needs API 2.2.0)

* **The browser is an API v2 client** (phases 1 to 3 of the upgrade):
  single look-ups and searches, and the graph rules (neighbourhood, impact,
  paths, expansion counts, nesting), are asked of the API instead of being
  computed in the browser.
