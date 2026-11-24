"""The browser's fixture model as an ArchiMate Open Exchange file (UP-2).

``tests/fixture/model.json`` is the readable source of the fixture. The test
server imports it into the real API, and for that it has to be an exchange
file. Identifiers are built from the numbers of the fixture, so a test can
name an item of the fixture and look up the id the API gave it:

    element 6        id-e6        relationship 108   id-r108
    view 1           id-v1        node 5             id-n5
    connection 3     id-c3        property def. 2    id-pd2

Folders have no identifier in the exchange format; tests find them by label.

Python standard library only::

    python tests/fixture_xml.py > fixture.xml
"""

from __future__ import annotations

import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

AM = "http://www.opengroup.org/xsd/archimate/3.0/"
XSI = "http://www.w3.org/2001/XMLSchema-instance"
XML = "http://www.w3.org/XML/1998/namespace"

FIXTURE = Path(__file__).resolve().parent / "fixture" / "model.json"
FILLER_FIRST_ID = 1001  # generated DataObjects, so one type has more rows than a tree page


def _q(tag: str) -> str:
    return f"{{{AM}}}{tag}"


def _text(parent, tag: str, text: str | None, lang: str | None = "en"):
    if not text:
        return
    child = ET.SubElement(parent, _q(tag))
    if lang:
        child.set(f"{{{XML}}}lang", lang)
    child.text = text


def _properties(parent, values: dict | None, definition_id: dict):
    if not values:
        return
    container = ET.SubElement(parent, _q("properties"))
    for name, value in values.items():
        prop = ET.SubElement(container, _q("property"), propertyDefinitionRef=f"id-pd{definition_id[name]}")
        ET.SubElement(prop, _q("value")).text = value


def _node(parent, n: dict):
    node = ET.SubElement(parent, _q("node"), identifier=f"id-n{n['id']}",
                         x=str(n["x"]), y=str(n["y"]), w=str(n["w"]), h=str(n["h"]))
    node.set(f"{{{XSI}}}type", n["type"])
    if n.get("el") is not None:
        node.set("elementRef", f"id-e{n['el']}")
    _text(node, "label", n.get("label"))
    _text(node, "documentation", n.get("documentation"))
    if n.get("viewRef") is not None:
        ET.SubElement(node, _q("viewRef"), ref=f"id-v{n['viewRef']}")
    for child in n.get("children", []):
        _node(node, child)


def _organization(parent, o: dict):
    if o.get("el") is not None:
        ET.SubElement(parent, _q("item"), identifierRef=f"id-e{o['el']}")
    elif o.get("rel") is not None:
        ET.SubElement(parent, _q("item"), identifierRef=f"id-r{o['rel']}")
    elif o.get("view") is not None:
        ET.SubElement(parent, _q("item"), identifierRef=f"id-v{o['view']}")
    else:
        item = ET.SubElement(parent, _q("item"))
        _text(item, "label", o.get("label"))
        for child in o.get("children", []):
            _organization(item, child)


def build(raw: dict) -> bytes:
    ET.register_namespace("", AM)
    ET.register_namespace("xsi", XSI)
    root = ET.Element(_q("model"), identifier=raw["model"]["xmiIdentifier"], version=raw["model"].get("version", "1.0"))
    root.set(f"{{{XSI}}}schemaLocation", f"{AM} http://www.opengroup.org/xsd/archimate/3.1/archimate3_Diagram.xsd")
    _text(root, "name", raw["model"]["name"])
    _text(root, "documentation", raw["model"].get("documentation"))
    definition_id = {p["name"]: p["id"] for p in raw["propertyDefinitions"]}

    elements = ET.SubElement(root, _q("elements"))
    filler = [{"id": FILLER_FIRST_ID + i, "type": "DataObject", "name": f"Filler {i + 1:03d}"} for i in range(raw.get("filler", 0))]
    for e in [*raw["elements"], *filler]:
        element = ET.SubElement(elements, _q("element"), identifier=f"id-e{e['id']}")
        element.set(f"{{{XSI}}}type", e["type"])
        _text(element, "name", e.get("name"))
        _text(element, "documentation", e.get("documentation"))
        _properties(element, e.get("props"), definition_id)

    relationships = ET.SubElement(root, _q("relationships"))
    for r in raw["relationships"]:
        end = lambda el, rel: f"id-e{r[el]}" if r.get(el) is not None else f"id-r{r[rel]}"  # noqa: E731
        relationship = ET.SubElement(relationships, _q("relationship"), identifier=f"id-r{r['id']}",
                                     source=end("s", "sr"), target=end("t", "tr"))
        relationship.set(f"{{{XSI}}}type", r["type"])
        if r.get("accessType"):
            relationship.set("accessType", r["accessType"])
        if r.get("isDirected") is not None:
            relationship.set("isDirected", "true" if r["isDirected"] else "false")
        _text(relationship, "name", r.get("name"))

    organizations = ET.SubElement(root, _q("organizations"))
    for o in raw["organizations"]:
        _organization(organizations, o)

    definitions = ET.SubElement(root, _q("propertyDefinitions"))
    for p in raw["propertyDefinitions"]:
        definition = ET.SubElement(definitions, _q("propertyDefinition"), identifier=f"id-pd{p['id']}", type=p["dataType"])
        _text(definition, "name", p["name"], lang=None)

    diagrams = ET.SubElement(ET.SubElement(root, _q("views")), _q("diagrams"))
    for v in raw["views"]:
        view = ET.SubElement(diagrams, _q("view"), identifier=f"id-v{v['id']}")
        view.set(f"{{{XSI}}}type", "Diagram")
        if v.get("viewpoint"):
            view.set("viewpoint", v["viewpoint"])
        _text(view, "name", v["name"])
        _text(view, "documentation", v.get("documentation"))
        for n in v["nodes"]:
            _node(view, n)
        for c in v["connections"]:
            connection = ET.SubElement(view, _q("connection"), identifier=f"id-c{c['id']}")
            connection.set(f"{{{XSI}}}type", "Relationship" if c.get("rel") is not None else "Line")
            if c.get("rel") is not None:
                connection.set("relationshipRef", f"id-r{c['rel']}")
            for attr in ("s", "t"):
                if c.get(attr) is not None:
                    connection.set("source" if attr == "s" else "target", f"id-n{c[attr]}")
            _text(connection, "label", c.get("label"))
            if c.get("viewRef") is not None:
                ET.SubElement(connection, _q("viewRef"), ref=f"id-v{c['viewRef']}")
            for b in c.get("bendpoints", []):
                ET.SubElement(connection, _q("bendpoint"), x=str(b["x"]), y=str(b["y"]))

    return b'<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding="utf-8")


def fixture_xml(path: Path = FIXTURE) -> bytes:
    return build(json.loads(path.read_text(encoding="utf-8")))


if __name__ == "__main__":
    sys.stdout.buffer.write(fixture_xml())
