"""Parsers for topo.portalgorski.pl pages and JSON responses."""

import html
import json
import re
from typing import Any

from selectolax.lexbor import LexborHTMLParser as HTMLParser

from topo.importer.portalgorski.types import (
    LineData,
    PointData,
    RockPage,
    RockRef,
    RouteData,
    StartList,
    TrailItem,
    WallRef,
    WallTopo,
)

BASE_URL = "https://topo.portalgorski.pl"
START_URL = f"{BASE_URL}/topo/json/start"
PATHS_URL = f"{BASE_URL}/topo/topoEditor/loadPaths"

_OBJECT_URL = re.compile(r",(obszar|region|sektor|skala),(\d+)$")
_WALL = re.compile(
    r'<h5>(?P<name>[^<]*)</h5>\s*<div>\s*<div class="description darker">(?P<desc>.*?)</div>\s*'
    r'<div>\s*<div class="topoEditor[^"]*" id="topoEditor_(?P<id>\d+)"',
    re.S,
)
_WALL_ID = re.compile(r'id="topoEditor_(\d+)"')
_WALL_IMAGE = re.compile(r"TopoEditorFactory\(\{\s*id:\s*(?P<id>\d+),\s*imageMain:\s*'(?P<image>[^']+)'")
_HEIGHT = re.compile(r"min\.\s*([\d.]+)\s*m.*?max\.\s*([\d.]+)\s*m", re.S)
_MINUTES = re.compile(r"(\d+)\s*min")
_HOURS = re.compile(r"(\d+(?:[.,]\d+)?)\s*h")
_LENGTH = re.compile(r"([\d.,]+)\s*m")
_ROUTE_ROW = re.compile(r"pathLiBottom_(\d+)")

_POINT_KINDS = {
    "ring": "ring",
    "hak": "hak",
    "ucho skalne": "ucho",
    "stanowisko": "stanowisko",
    "stanowisko zjazdowe": "stanowisko",
    "dwa ringi zjazdowe": "stanowisko",
    "ogranicznik": "ogranicznik",
    "spit": "ring",
    "ring zjazdowy": "stanowisko",
    "pętla": "ucho",
    "niewidoczny fragment drogi": "przelot",
}
KNOWN_POINT_KINDS = frozenset(_POINT_KINDS)
_INVISIBLE_KINDS = frozenset({"niewidoczny fragment drogi"})


def map_point(kind_name: str, type_id: int | None, index: int) -> tuple[str, bool]:
    """Portal point → (our kind, visible). typeId 1 marks a helper point that is not a bolt.

    An unknown kind becomes an invisible helper point (przelot); store reports it as unknown.
    """
    name = kind_name.strip().lower()
    if type_id == 1:
        if index == 0:
            return "start", False
        if name == "ring":
            return "przelot", False
        return _POINT_KINDS.get(name, "przelot"), False
    if name in _INVISIBLE_KINDS or name not in _POINT_KINDS:
        return "przelot", False
    return _POINT_KINDS[name], True


def parse_start(raw: bytes) -> StartList:
    rocks: dict[int, RockRef] = {}
    invalid: list[str] = []
    for item in json.loads(raw)["results"]:
        if item.get("type") != "rock":
            continue
        match = _OBJECT_URL.search(item.get("url", ""))
        if match is None or match.group(1) != "skala":
            invalid.append(item.get("url", ""))
            continue
        source_id = int(match.group(2))
        rocks.setdefault(
            source_id,
            RockRef(
                source_id=source_id,
                name=html.unescape(item["title"]).strip(),
                url=BASE_URL + item["url"],
                lat=float(item["lat"]),
                lng=float(item["lng"]),
            ),
        )
    return StartList(rocks=list(rocks.values()), invalid_urls=invalid)


def parse_rock_page(raw: bytes) -> RockPage:
    text = raw.decode("utf-8", errors="replace")  # page embeds a stray ISO-8859-2 URL in a Facebook iframe
    tree = HTMLParser(text)
    trail = _trail(tree)
    if not trail or trail[-1].kind != "skala":
        raise ValueError("Nie rozpoznano strony skały")
    rock = trail[-1]
    images = {int(m["id"]): BASE_URL + m["image"] for m in _WALL_IMAGE.finditer(text)}
    blocks = {int(m["id"]): m for m in _WALL.finditer(text)}
    walls = []
    for wall_id in dict.fromkeys(int(i) for i in _WALL_ID.findall(text)):
        block = blocks.get(wall_id)
        walls.append(
            WallRef(
                source_id=wall_id,
                name=(_clean(html.unescape(block["name"])) or None) if block else None,
                description=_html_to_text(block["desc"]) if block else None,
                image_url=images.get(wall_id),
            )
        )
    return RockPage(
        source_id=rock.source_id,
        name=rock.name,
        url=rock.url,
        path=trail[:-1],
        description=_description(tree),
        walls=walls,
        **_details(tree),
    )


def parse_paths(raw: bytes) -> WallTopo:
    data = json.loads(raw)
    if data.get("status") != 1:
        raise ValueError(f"Portal zwrócił status {data.get('status')} dla topo")
    lines = []
    for path in data.get("data") or []:
        raw_points = path.get("points") or []
        points = []
        for index, point in enumerate(raw_points):
            kind, visible = map_point(point.get("kindName") or "", point.get("typeId"), index)
            points.append(
                PointData(
                    source_id=int(point["pointId"]),
                    x=float(point["x"]),
                    y=float(point["y"]),
                    kind=kind,
                    visible=visible,
                    raw_kind=(point.get("kindName") or "").strip(),
                )
            )
        parent_point = next((p["parentPointId"] for p in raw_points if p.get("parentPointId")), None)
        lines.append(
            LineData(
                source_id=int(path["pathId"]),
                order=int(path.get("order") or 0),
                branch_order=int(path.get("branchOrder") or 0),
                color=path.get("color") or "#e11d48",
                parent_source_id=_int_or_none(path.get("parentPathId")),
                parent_point_source_id=_int_or_none(parent_point),
                points=points,
            )
        )
    return WallTopo(lines=lines, routes=_route_table(data.get("pathsListBottom") or ""))


def _route_table(fragment: str) -> list[RouteData]:
    routes = []
    for row in HTMLParser(fragment).css("tr.pathLiBottom"):
        match = _ROUTE_ROW.fullmatch(row.attributes.get("id") or "")
        cells = [_clean(cell.text()) for cell in row.css("td")]
        if match is None or len(cells) < 8:
            continue
        _number, name, protection, grade, _rating, author, year, length = cells[:8]
        length_match = _LENGTH.search(length)
        routes.append(
            RouteData(
                source_id=int(match.group(1)),
                name=name,
                protection=protection or None,
                grade=grade or None,
                first_ascent=author or None,
                year=int(year) if year.isdigit() else None,
                length_m=float(length_match.group(1).replace(",", ".")) if length_match else None,
            )
        )
    return routes


def _trail(tree: HTMLParser) -> list[TrailItem]:
    menu = tree.css_first("#treeMenu")
    if menu is None:
        return []
    items = []
    for link in menu.css("ul.tree li.leafmenu a"):
        href = link.attributes.get("href") or ""
        match = _OBJECT_URL.search(href)
        if match:
            items.append(
                TrailItem(kind=match.group(1), source_id=int(match.group(2)), name=_clean(link.text()), url=BASE_URL + href)
            )
    return items


def _details(tree: HTMLParser) -> dict[str, Any]:
    details: dict[str, Any] = {
        "lat": None, "lng": None, "rock_type": None, "height_min": None, "height_max": None,
        "aspects": [], "formations": [], "approach_minutes": None, "child_friendly": None, "surroundings": None,
    }
    for row in tree.css("table.tblData tr"):
        icon = row.css_first("div.itemIcon")
        cells = row.css("td")
        if icon is None or len(cells) < 2:
            continue
        code = next((c for c in (icon.attributes.get("class") or "").split() if c != "itemIcon"), "")
        cell = cells[1]
        value = _clean(cell.text())
        if code == "pGPS":
            small = cell.css_first("span.dataSm")
            if small is not None:
                details["lat"], details["lng"] = _coordinates(small.text())
        elif code == "pRT":
            details["rock_type"] = value or None
        elif code == "pH":
            match = _HEIGHT.search(value)
            if match:
                details["height_min"], details["height_max"] = float(match.group(1)), float(match.group(2))
        elif code == "pWF":
            details["aspects"] = [img.attributes["alt"] for img in cell.css("img") if img.attributes.get("alt")]
        elif code == "pRF":
            details["formations"] = [part.strip() for part in cell.text().split("\xa0") if part.strip()]
        elif code == "pT":
            details["approach_minutes"] = _minutes(value)
        elif code == "pCF":
            details["child_friendly"] = {"TAK": True, "NIE": False}.get(value.upper())
        elif code == "pRL":
            details["surroundings"] = value or None
    return details


def _coordinates(text: str) -> tuple[float | None, float | None]:
    """"lat , lng" → floats; anything unparsable → (None, None), the rock is then reported as without coordinates."""
    parts = text.split(",")
    if len(parts) != 2:
        return None, None
    try:
        return float(parts[0]), float(parts[1])
    except ValueError:
        return None, None


def _description(tree: HTMLParser) -> str | None:
    for box in tree.css("div.box"):
        title = box.css_first("h3")
        if title is not None and _clean(title.text()) == "Opis i dojście":
            desc = box.css_first("span.desc")
            return _html_to_text(desc.html or "") if desc is not None else None
    return None


def _minutes(value: str) -> int | None:
    hours = _HOURS.search(value)
    minutes = _MINUTES.search(value)
    if hours is None and minutes is None:
        return None
    return (round(float(hours.group(1).replace(",", ".")) * 60) if hours else 0) + (int(minutes.group(1)) if minutes else 0)


def _html_to_text(fragment: str) -> str | None:
    fragment = re.sub(r"(?i)<br\s*/?>|</p>", "\n", fragment)
    text = HTMLParser(fragment).text().replace("\xa0", " ")
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.split("\n")]
    joined = "\n".join(line for line in lines if line)
    return joined or None


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("\xa0", " ")).strip()


def _int_or_none(value: Any) -> int | None:
    return int(value) if value not in (None, "", 0) else None
