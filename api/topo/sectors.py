"""Creating sectors: from a selection of crags, or by turning a multi-wall crag into a sector."""

from typing import TypedDict

from geoalchemy2 import WKBElement
from sqlalchemy.orm import Session

from topo.api.errors import ApiError
from topo.editing import delete_crag
from topo.models import Area, Crag, Route, Wall
from topo.slugs import unique_slug

CRAG_COPIED_FIELDS = (
    "rock_type", "height_min", "height_max", "aspects", "formations", "approach_minutes",
    "child_friendly", "surroundings", "description", "approach_description",
)  # fmt: skip
ROUTE_COPIED_FIELDS = (
    "number", "name", "grade", "grade_sort", "length_m", "protection", "first_ascent", "year", "description",
)  # fmt: skip


class ToSectorPreview(TypedDict):
    kind: str  # "sektor", or "region" when the crag sits directly in an obszar
    sector_name: str
    crags: list[str]
    copied_routes: int
    unplaced: int


def region_of(area: Area) -> Area:
    """The region itself, or the parent region of a sector."""
    if area.kind == "region":
        return area
    if area.kind == "sektor" and area.parent is not None:
        return area.parent
    raise ApiError(422, "invalid_area", "Skała może należeć tylko do regionu albo sektora")


def make_sector(session: Session, region: Area, name: str, description: str | None, crags: list[Crag]) -> Area:
    for crag in crags:
        if region_of(crag.area) is not region:
            raise ApiError(422, "crag_outside_region", f"Skała „{crag.name}” jest poza tym regionem")
    sector = Area(
        kind="sektor", parent=region, name=name, description=description,
        slug=unique_slug(session, Area, name), source="manual",
    )  # fmt: skip
    session.add(sector)
    for crag in crags:
        crag.area = sector
    session.flush()
    return sector


def _target_kind(crag: Crag) -> str:
    return "region" if crag.area.kind == "obszar" else "sektor"


def _require_walls(crag: Crag) -> list[Wall]:
    walls = list(crag.walls)
    if len(walls) < 2:
        raise ApiError(422, "single_wall", "Skała ma tylko jedną ścianę")
    return walls


def _placement(walls: list[Wall]) -> dict[int, list[Wall]]:
    """For every route with lines, the walls (in wall order) that carry its lines."""
    placement: dict[int, list[Wall]] = {}
    for wall in walls:
        for route_id in dict.fromkeys(line.route_id for line in wall.lines if line.route_id is not None):
            placement.setdefault(route_id, []).append(wall)
    return placement


def _crag_name(crag: Crag, wall: Wall, n: int) -> str:
    return wall.name or f"{crag.name} — ściana {n}"


def to_sector_preview(crag: Crag) -> ToSectorPreview:
    walls = _require_walls(crag)
    return {
        "kind": _target_kind(crag),
        "sector_name": crag.name,
        "crags": [_crag_name(crag, wall, n) for n, wall in enumerate(walls, 1)],
        "copied_routes": sum(len(on) - 1 for on in _placement(walls).values()),
        "unplaced": len(walls) - 1,
    }


def crag_to_sector(session: Session, crag: Crag) -> tuple[Area, list[Crag]]:
    """One transaction; walls and first-wall routes keep their ids, so reverting the transaction restores the crag."""
    walls = _require_walls(crag)
    placement = _placement(walls)
    if _target_kind(crag) == "region":  # no region above a crag in an obszar, so the new area is a region
        sector = Area(
            kind="region", parent=crag.area, name=crag.name, description=crag.description,
            slug=unique_slug(session, Area, crag.name), source="manual",
        )  # fmt: skip
        session.add(sector)
        session.flush()
    else:
        sector = make_sector(session, region_of(crag.area), crag.name, crag.description, [])
    origin = bytes(crag.location.data)
    new_crags: list[Crag] = []
    for n, wall in enumerate(walls, 1):
        name = _crag_name(crag, wall, n)
        new = Crag(
            area=sector, name=name, slug=unique_slug(session, Crag, name),
            location=WKBElement(origin, srid=4326), needs_location=n > 1, source="manual",
            **{field: getattr(crag, field) for field in CRAG_COPIED_FIELDS},
        )  # fmt: skip
        session.add(new)
        session.flush()  # the next crag's unique_slug must see this one
        new_crags.append(new)
    by_wall = {wall.id: new for wall, new in zip(walls, new_crags, strict=True)}
    lines_of = {wall.id: list(wall.lines) for wall in walls}
    for route in list(crag.routes):
        on = placement.get(route.id, [])
        route.crag = by_wall[on[0].id] if on else new_crags[0]
        for wall in on[1:]:
            copy = Route(
                crag=by_wall[wall.id], source="manual", **{f: getattr(route, f) for f in ROUTE_COPIED_FIELDS}
            )
            session.add(copy)
            for line in lines_of[wall.id]:
                if line.route_id == route.id:
                    line.route = copy
    for wall in walls:
        wall.crag = by_wall[wall.id]
    session.flush()
    session.expire(crag)
    delete_crag(session, crag)
    session.flush()
    return sector, new_crags
