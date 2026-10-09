"""Saving the topo of one photo from the editor: the whole draft against the database, in one history transaction."""


from dataclasses import dataclass
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session
from sqlalchemy_continuum import version_class

from topo.api.errors import ApiError
from topo.changes import ObjectChange
from topo.db import refresh_area_geom
from topo.editing import apply_fields, apply_grade, bump_wall_versions, delete_line
from topo.grades import grade_band
from topo.models import LinePoint, Route, RouteLine, Wall
from topo.schemas_edit import LineIn, WallLinesIn

# route_line.color is not drawn (the viewers colour lines by grade); kept consistent with the imported data.
LINE_COLORS: tuple[str, ...] = ("#00BFFF", "#0000FF", "#FF0000", "#000000")
UNGRADED_COLOR = "#e11d48"
# Not drawn as a bolt: the start (a numbered circle marks it) and helper points shaping the line — as in the import.
HIDDEN_KINDS = frozenset({"start", "przelot"})


class VersionConflict(Exception):
    def __init__(self, current: int):
        super().__init__(f"wall version is {current}")
        self.current = current


@dataclass
class SaveResult:
    version: int
    ids: dict[str, int]


def line_color(route: Route | None) -> str:
    band = grade_band(route.grade_sort) if route is not None else None
    return UNGRADED_COLOR if band is None else LINE_COLORS[band]


def walls_touched(session: Session, changes: list[ObjectChange]) -> set[int]:
    """Walls whose lines or points a transaction changed (from the before/after values, so deleted ones count)."""
    walls: set[int] = set()
    line_ids: set[int] = set()
    for change in changes:
        values = [v for v in (change.before, change.after) if v]
        if change.model is RouteLine:
            walls.update(v["wall_id"] for v in values if v.get("wall_id") is not None)
        elif change.model is LinePoint:
            line_ids.update(v["line_id"] for v in values if v.get("line_id") is not None)
    if line_ids:
        version = version_class(RouteLine)
        walls.update(session.scalars(sa.select(version.wall_id).where(version.id.in_(line_ids)).distinct()))
    return walls


def _invalid(message: str) -> ApiError:
    return ApiError(422, "invalid_topo", message)


def _validate(wall: Wall, body: WallLinesIn, route_ids: set[int]) -> None:
    lines = {line.id: line for line in wall.lines}
    refs = [obj.ref for line in body.lines for obj in (line, *line.points) if obj.ref] + [r.ref for r in body.new_routes]
    if len(refs) != len(set(refs)):
        raise _invalid("Powtórzony identyfikator obiektu (ref)")
    new_route_refs = {route.ref for route in body.new_routes}
    for line in body.lines:
        if line.id is not None and line.id not in lines:
            raise _invalid("Linia nie należy do tej ściany")
        own_points = {point.id for point in lines[line.id].points} if line.id is not None else set()
        for point in line.points:
            if point.id is not None and point.id not in own_points:
                raise _invalid("Punkt nie należy do tej linii")
        if line.route_id is not None and line.route_id not in route_ids:
            raise _invalid("Droga nie należy do tej skały")
        if line.route_ref is not None and line.route_ref not in new_route_refs:
            raise _invalid("Nieznana nowa droga")
    _validate_parents(body.lines)


def _line_key(line_id: int | None, line_ref: str | None) -> str | None:
    return f"id:{line_id}" if line_id is not None else (f"ref:{line_ref}" if line_ref is not None else None)


def _validate_parents(lines: list[LineIn]) -> None:
    by_key = {_line_key(line.id, line.ref): line for line in lines}
    parent_of: dict[str, str] = {}
    for line in lines:
        if line.parent is None:
            continue
        parent_key = _line_key(line.parent.line_id, line.parent.line_ref)
        parent = by_key.get(parent_key) if parent_key else None
        if parent is None:
            raise _invalid("Wariant wskazuje linię spoza tego zdjęcia")
        point_ids = {p.id for p in parent.points if p.id is not None}
        point_refs = {p.ref for p in parent.points if p.ref is not None}
        if not (line.parent.point_id in point_ids or line.parent.point_ref in point_refs):
            raise _invalid("Wariant wskazuje punkt spoza linii rodzica")
        parent_of[_line_key(line.id, line.ref)] = parent_key  # type: ignore[index]
    for start in parent_of:
        seen = {start}
        current = parent_of.get(start)
        while current is not None:
            if current in seen:
                raise _invalid("Wariant nie może pochodzić od samego siebie")
            seen.add(current)
            current = parent_of.get(current)


def save_wall_lines(session: Session, wall: Wall, body: WallLinesIn) -> SaveResult | None:
    """Apply the editor's draft to the photo; None when nothing changed (the caller rolls back)."""
    if body.version != wall.version:
        raise VersionConflict(wall.version)
    crag_routes = {route.id: route for route in session.scalars(sa.select(Route).where(Route.crag_id == wall.crag_id))}
    _validate(wall, body, set(crag_routes))
    changed = 0
    ids: dict[str, int] = {}

    routes_by_ref: dict[str, Route] = {}
    for new in body.new_routes:
        route = Route(crag_id=wall.crag_id, name=new.name.strip(), source="manual")
        apply_grade(route, new.grade)
        session.add(route)
        routes_by_ref[new.ref] = route
        changed += 1
    session.flush()
    ids.update({ref: route.id for ref, route in routes_by_ref.items()})

    existing_lines = {line.id: line for line in wall.lines}
    # Taken before anything is added: new points join `line.points` through the relationship and must not count as
    # saved points missing from the body (they would be deleted again).
    original_points = {line_id: list(line.points) for line_id, line in existing_lines.items()}
    lines_by_key: dict[str, RouteLine] = {}
    points_by_ref: dict[str, LinePoint] = {}
    points_by_id: dict[int, LinePoint] = {}
    kept_points: set[int] = set()
    for line_in in body.lines:
        route = crag_routes.get(line_in.route_id) if line_in.route_id is not None else routes_by_ref.get(line_in.route_ref or "")
        values: dict[str, Any] = {"route_id": route.id if route else None, "sort_order": line_in.sort_order}
        if line_in.id is not None:
            line = existing_lines[line_in.id]
            # Colour follows the route only when the route changes: an untouched imported line keeps its colour.
            if line.route_id != values["route_id"]:
                values["color"] = line_color(route)
            changed += len(apply_fields(line, values))
        else:
            line = RouteLine(wall=wall, color=line_color(route), **values)
            session.add(line)
            changed += 1
        lines_by_key[_line_key(line_in.id, line_in.ref)] = line  # type: ignore[index]
        own = {point.id: point for point in line.points} if line_in.id is not None else {}
        for point_in in line_in.points:
            point_values = {
                "sort_order": point_in.sort_order, "x": point_in.x, "y": point_in.y,
                "kind": point_in.kind, "visible": point_in.kind not in HIDDEN_KINDS,
            }  # fmt: skip
            if point_in.id is not None:
                point = own[point_in.id]
                if point.kind == point_in.kind:
                    point_values["visible"] = point.visible  # an imported hidden bolt stays hidden until its kind changes
                changed += len(apply_fields(point, point_values))
                kept_points.add(point.id)
                points_by_id[point.id] = point
            else:
                point = LinePoint(line=line, **point_values)
                session.add(point)
                points_by_ref[point_in.ref] = point  # type: ignore[index]
                changed += 1
    session.flush()
    ids.update({ref: lines_by_key[f"ref:{ref}"].id for ref in (l.ref for l in body.lines if l.ref)})
    ids.update({ref: point.id for ref, point in points_by_ref.items()})

    for line_in in body.lines:
        line = lines_by_key[_line_key(line_in.id, line_in.ref)]  # type: ignore[index]
        parent_line = parent_point = None
        if line_in.parent is not None:
            parent_line = lines_by_key[_line_key(line_in.parent.line_id, line_in.parent.line_ref)]  # type: ignore[index]
            parent_point = points_by_id.get(line_in.parent.point_id) if line_in.parent.point_id is not None else points_by_ref[line_in.parent.point_ref]  # type: ignore[index]
        changed += len(apply_fields(line, {
            "parent_line_id": parent_line.id if parent_line else None,
            "parent_point_id": parent_point.id if parent_point else None,
        }))  # fmt: skip
    session.flush()

    kept_lines = {line_in.id for line_in in body.lines if line_in.id is not None}
    doomed_points = [
        point for line_id in kept_lines for point in original_points[line_id] if point.id not in kept_points
    ]
    if doomed_points:
        doomed_ids = [point.id for point in doomed_points]
        # Lines elsewhere (other photos) branching off a removed point lose the link instead of blocking the delete.
        for child in session.scalars(sa.select(RouteLine).where(RouteLine.parent_point_id.in_(doomed_ids))):
            changed += len(apply_fields(child, {"parent_line_id": None, "parent_point_id": None}))
        for point in doomed_points:
            session.delete(point)
            changed += 1
    for line_id, line in existing_lines.items():
        if line_id not in kept_lines:
            delete_line(session, line)
            changed += 1
    session.flush()

    if changed == 0:
        return None
    bump_wall_versions(session, [wall.id])
    refresh_area_geom(session)
    session.commit()
    session.refresh(wall)
    return SaveResult(version=wall.version, ids=ids)
