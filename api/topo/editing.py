"""Shared helpers of the edit endpoints (crags, routes, walls, and later sectors, history and revert)."""

import math
from collections.abc import Iterable
from typing import Any

from geoalchemy2 import WKTElement
from geoalchemy2.shape import to_shape
from sqlalchemy import select
from sqlalchemy.orm import Session

from topo.api.errors import ApiError
from topo.grades import grade_sort, normalize_grade
from topo.models import Area, Crag, Route, RouteLine, Wall


def location_from(lnglat: tuple[float, float]) -> WKTElement:
    lon, lat = lnglat
    if not (math.isfinite(lon) and math.isfinite(lat) and -180 <= lon <= 180 and -90 <= lat <= 90):
        raise ApiError(422, "invalid_location", "Nieprawidłowe położenie")
    return WKTElement(f"POINT({lon!r} {lat!r})", srid=4326)


def location_of(crag_or_version: Any) -> list[float]:
    point = to_shape(crag_or_version.location)
    return [round(point.x, 7), round(point.y, 7)]


def apply_grade(route: Route, raw: str | None) -> None:
    if raw is None or not raw.strip():
        route.grade = route.grade_sort = None
        return
    sort = grade_sort(raw)
    if sort is None:
        raise ApiError(422, "invalid_grade", f"Nieznana wycena „{raw}” — przykłady: VI, VI.1+, VI.2/3")
    route.grade, route.grade_sort = normalize_grade(raw), sort


def apply_fields(obj: Any, data: dict[str, Any]) -> set[str]:
    """Set the attributes that differ from the current values; return the names actually changed."""
    changed: set[str] = set()
    for name, value in data.items():
        if getattr(obj, name) != value:
            setattr(obj, name, value)
            changed.add(name)
    return changed


def area_kind_ok(area: Area) -> bool:
    return area.kind in ("region", "sektor")


def _detach_outside_variants(session: Session, lines: Iterable[RouteLine]) -> None:
    """Unhook variants (of other lines) that branch off the given lines, so deleting them leaves the variants intact."""
    ids = {line.id for line in lines}
    if not ids:
        return
    outside = session.scalars(select(RouteLine).where(RouteLine.parent_line_id.in_(ids), RouteLine.id.not_in(ids)))
    for child in outside:
        child.parent_line = None
        child.parent_point = None
    session.flush()


def _delete_lines(session: Session, lines: list[RouteLine]) -> None:
    _detach_outside_variants(session, lines)
    for line in lines:
        session.delete(line)


# Deletes go through the ORM (never DB cascades) so that Continuum writes a version row for every removed record.
def delete_route(session: Session, route: Route) -> None:
    lines = list(session.scalars(select(RouteLine).where(RouteLine.route_id == route.id)))
    _delete_lines(session, lines)
    session.delete(route)


def delete_wall(session: Session, wall: Wall) -> None:
    _detach_outside_variants(session, wall.lines)
    session.delete(wall)


def delete_crag(session: Session, crag: Crag) -> None:
    _detach_outside_variants(session, [line for wall in crag.walls for line in wall.lines])
    session.delete(crag)
