# The ArchiMate icons in this folder

The icons here (`*.svg`, `*.png`, and their data in `sprites.json`) are
extracted by `tools/extract_sprites.py` from PlantUML's built-in ArchiMate
sprites (`<$archimate/...>`, the output of PlantUML's `listsprites`, kept as
`inputs/archi_sprites.svg`). In the PlantUML source they are in
[`src/main/resources/sprites/archimate`](https://github.com/plantuml/plantuml/tree/master/src/main/resources/sprites/archimate).
PlantUML's listing credits them to [archimatetool.com](https://www.archimatetool.com),
the Archi project.

They are **not** covered by this project's MIT licence. What is known about
their own licence:

* **PlantUML** is distributed by default under the GPL-3.0-or-later, and its
  source is also available, at the user's option, under the LGPL, Apache 2.0,
  EPL 2.0 and MIT licences
  ([LICENSES.md](https://github.com/plantuml/plantuml/blob/master/LICENSES.md)),
  © 2009–2026 Arnaud Roques. The licence files do not name the sprite files
  separately, and the sprite files carry no licence or credit of their own.
* **Archi** is under the MIT licence
  ([License.txt](https://github.com/archimatetool/archi/blob/master/License.txt)),
  © 2013–2026 Phillip Beauvoir, Jean-Baptiste Sarrodie, The Open Group. The
  licence does not mention its icons separately.

Changes made here: each vector icon got a square, tight viewBox; three PNG
icons drawn in yellow and olive were turned into black line art like the
rest. Anyone who redistributes these icons apart from this project should
check the terms above for their own use.

ArchiMate® is a registered trademark of The Open Group.
