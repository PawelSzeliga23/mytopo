"""Write parsed Portal Górski data to the database: idempotent upserts that never overwrite manual edits."""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from geoalchemy2 import WKTElement
from geoalchemy2.shape import to_shape
import sqlalchemy as sa
from sqlalchemy import select
from sqlalchemy.orm import Session

from topo.grades import grade_sort
from sqlalchemy_continuum import version_class

from topo.history import has_manual_version, is_manually_edited
from topo.importer.portalgorski.parse import KNOWN_POINT_KINDS
from topo.importer.portalgorski.types import LineData, RockPage, WallRef, WallTopo
from topo.media import InvalidImage, store_wall_image
from topo.models import Area, Crag, LinePoint, Route, RouteLine, Wall
from topo.slugs import unique_slug

SOURCE = "portalgorski"
IMPORT_AUTHOR = "import:portalgorski"
EDGE_TOLERANCE = 0.01


@dataclass
class WallInput:
    ref: WallRef
    topo: WallTopo
    image: bytes | None


@dataclass
class ImportReport:
    crags_created: int = 0
    crags_updated: int = 0
    walls: int = 0
    routes: int = 0
    lines: int = 0
    points: int = 0
    invalid_urls: list[str] = field(default_factory=list)
    skipped_manual: list[str] = field(default_factory=list)
    unknown_grades: list[str] = field(default_factory=list)
    unknown_point_kinds: list[str] = field(default_factory=list)
    bad_lines: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


def store_rock(session: Session, media_root: Path, page: RockPage, walls: list[WallInput], report: ImportReport) -> Crag:
    if page.lat is None or page.lng is None:
        raise ValueError(f"Skała {page.name} nie ma współrzędnych")
    area = _store_areas(session, page)
    crag = _store_crag(session, page, area, report)
    for index, wall_input in enumerate(walls):
        _store_wall(session, Path(media_root), crag, index, wall_input, report)
    session.flush()
    return crag


def _deleted_manually(session: Session, model: type, source_id: str) -> bool:
    """True if a person deleted (or otherwise manually versioned) the row that this source id maps to."""
    version = version_class(model)
    return has_manual_version(session, model, version.source == SOURCE, version.source_id == source_id)


def _find(session: Session, model: type, source_id: str) -> Any:
    return session.scalar(select(model).where(model.source == SOURCE, model.source_id == source_id))


def _assign(obj: Any, **fields: Any) -> bool:
    changed = False
    for name, value in fields.items():
        if getattr(obj, name) != value:
            setattr(obj, name, value)
            changed = True
    return changed


def _store_areas(session: Session, page: RockPage) -> Area:
    parent: Area | None = None
    for item in page.path:
        source_id = f"{item.kind}:{item.source_id}"
        area = _find(session, Area, source_id)
        if area is None:
            if _deleted_manually(session, Area, source_id):
                raise ValueError(f"Obszar {item.name} został usunięty ręcznie; pominięto skałę {page.name}")
            context = [parent.name] if parent is not None else []
            area = Area(
                source=SOURCE, source_id=source_id, kind=item.kind, name=item.name,
                slug=unique_slug(session, Area, item.name, context), source_url=item.url, parent=parent,
            )
            session.add(area)
            session.flush()
        elif not is_manually_edited(session, Area, [area.id]):
            _assign(area, name=item.name, source_url=item.url, parent_id=parent.id if parent else None)
        parent = area
    if parent is None:
        raise ValueError(f"Skała {page.name} nie ma obszaru w ścieżce")
    return parent


def _store_crag(session: Session, page: RockPage, area: Area, report: ImportReport) -> Crag:
    fields = dict(
        area_id=area.id, name=page.name, source_url=page.url, rock_type=page.rock_type,
        height_min=page.height_min, height_max=page.height_max, aspects=page.aspects,
        formations=page.formations, approach_minutes=page.approach_minutes,
        child_friendly=page.child_friendly, surroundings=page.surroundings, description=page.description,
    )
    crag = _find(session, Crag, str(page.source_id))
    if crag is None:
        if _deleted_manually(session, Crag, str(page.source_id)):
            raise ValueError(f"Skała {page.name} została usunięta ręcznie; pominięto import")
        context = [item.name for item in reversed(page.path)]
        crag = Crag(
            source=SOURCE, source_id=str(page.source_id), slug=unique_slug(session, Crag, page.name, context),
            location=_location(page), **fields,
        )
        session.add(crag)
        session.flush()
        report.crags_created += 1
        return crag
    if is_manually_edited(session, Crag, [crag.id]):
        report.skipped_manual.append(f"skała {crag.name}")
        return crag
    changed = _assign(crag, **fields)
    current = to_shape(crag.location)
    if abs(current.x - page.lng) > 1e-9 or abs(current.y - page.lat) > 1e-9:
        crag.location = _location(page)
        changed = True
    if changed:
        report.crags_updated += 1
    return crag


def _location(page: RockPage) -> WKTElement:
    return WKTElement(f"POINT({page.lng} {page.lat})", srid=4326)


def _store_wall(session: Session, media_root: Path, crag: Crag, index: int, wall_input: WallInput, report: ImportReport) -> None:
    ref = wall_input.ref
    label = f"{crag.name} / {ref.name or ref.source_id}"
    fields = dict(crag_id=crag.id, name=ref.name, description=ref.description, sort_order=index, source_url=ref.image_url)
    wall = _find(session, Wall, str(ref.source_id))
    if wall is None:
        if _deleted_manually(session, Wall, str(ref.source_id)):
            report.skipped_manual.append(f"usunięte ręcznie: ściana {label}")
            return
        wall = Wall(source=SOURCE, source_id=str(ref.source_id), **fields)
        session.add(wall)
        session.flush()
    elif is_manually_edited(session, Wall, [wall.id]):
        report.skipped_manual.append(f"ściana {label}")
    else:
        _assign(wall, **fields)
    report.walls += 1

    if wall.image_path is None and wall_input.image is not None:
        try:
            stored = store_wall_image(media_root, wall.id, wall_input.image)
        except InvalidImage:
            report.errors.append(f"{label}: nieprawidłowe zdjęcie")
        else:
            _assign(
                wall, image_original_path=stored.original_path, image_path=stored.image_path,
                thumb_path=stored.thumb_path, image_width=stored.width, image_height=stored.height,
            )

    routes = _store_routes(session, crag, wall_input.topo, report)
    if wall.image_width and wall.image_height:
        _store_lines(session, label, wall, wall_input.topo, routes, report)
    elif wall_input.topo.lines:
        report.bad_lines.append(f"{label}: brak zdjęcia, pominięto {len(wall_input.topo.lines)} linii")


def _store_routes(session: Session, crag: Crag, topo: WallTopo, report: ImportReport) -> dict[int, Route]:
    numbers = {line.source_id: line.order for line in topo.lines}
    routes: dict[int, Route] = {}
    for data in topo.routes:
        sort = grade_sort(data.grade)
        if data.grade and sort is None:
            report.unknown_grades.append(f"{crag.name} / {data.name}: {data.grade}")
        fields = dict(
            crag_id=crag.id, number=numbers.get(data.source_id), name=data.name, grade=data.grade,
            grade_sort=sort, protection=data.protection, first_ascent=data.first_ascent,
            year=data.year, length_m=data.length_m,
        )
        route = _find(session, Route, str(data.source_id))
        if route is None:
            if _deleted_manually(session, Route, str(data.source_id)):
                report.skipped_manual.append(f"usunięte ręcznie: droga {data.name} ({crag.name})")
                continue
            route = Route(source=SOURCE, source_id=str(data.source_id), **fields)
            session.add(route)
        elif is_manually_edited(session, Route, [route.id]):
            report.skipped_manual.append(f"droga {route.name} ({crag.name})")
        else:
            _assign(route, **fields)
        routes[data.source_id] = route
        report.routes += 1
    session.flush()
    return routes


def _store_lines(session: Session, label: str, wall: Wall, topo: WallTopo, routes: dict[int, Route], report: ImportReport) -> None:
    existing = session.scalars(select(RouteLine).where(RouteLine.wall_id == wall.id)).all()
    point_ids = [point.id for line in existing for point in line.points]
    line_version, point_version = version_class(RouteLine), version_class(LinePoint)
    wall_line_ids = sa.select(line_version.id).where(line_version.wall_id == wall.id)
    if (
        is_manually_edited(session, RouteLine, [line.id for line in existing])
        or is_manually_edited(session, LinePoint, point_ids)
        or has_manual_version(session, RouteLine, line_version.wall_id == wall.id)
        or has_manual_version(session, LinePoint, point_version.line_id.in_(wall_line_ids))
    ):
        report.skipped_manual.append(f"topo ściany {label}")
        return

    lines: dict[int, RouteLine] = {}
    points: dict[int, LinePoint] = {}
    for data in topo.lines:
        normalized = _normalize(data, wall.image_width, wall.image_height)
        if normalized is None:
            report.bad_lines.append(f"{label}: linia {data.source_id} wychodzi poza zdjęcie")
            continue
        line = _find(session, RouteLine, str(data.source_id))
        if line is None:
            if _deleted_manually(session, RouteLine, str(data.source_id)):
                report.skipped_manual.append(f"usunięte ręcznie: linia {data.source_id} ({label})")
                continue
            line = RouteLine(source=SOURCE, source_id=str(data.source_id))
            session.add(line)
        _assign(
            line, wall_id=wall.id, route=routes.get(data.source_id), color=data.color,
            sort_order=data.order * 10 + data.branch_order,
        )
        keep: set[str] = set()
        for index, (point_data, (x, y)) in enumerate(zip(data.points, normalized)):
            if point_data.raw_kind and point_data.raw_kind.lower() not in KNOWN_POINT_KINDS:
                report.unknown_point_kinds.append(f"{label}: {point_data.raw_kind}")
            point = _find(session, LinePoint, str(point_data.source_id))
            if point is None:
                if _deleted_manually(session, LinePoint, str(point_data.source_id)):
                    report.skipped_manual.append(f"usunięte ręcznie: punkt {point_data.source_id} ({label})")
                    continue
                point = LinePoint(source=SOURCE, source_id=str(point_data.source_id))
                session.add(point)
            _assign(point, line=line, sort_order=index, x=x, y=y, kind=point_data.kind, visible=point_data.visible)
            points[point_data.source_id] = point
            keep.add(str(point_data.source_id))
        for stale in [p for p in line.points if p.source == SOURCE and p.source_id not in keep]:
            line.points.remove(stale)
        lines[data.source_id] = line
        report.lines += 1
        report.points += len(data.points)
    session.flush()

    for data in topo.lines:
        line = lines.get(data.source_id)
        if line is None:
            continue
        parent_line = lines.get(data.parent_source_id) if data.parent_source_id else None
        parent_point = points.get(data.parent_point_source_id) if data.parent_point_source_id else None
        if parent_line is None or parent_point is None or parent_point.line is not parent_line:
            parent_line, parent_point = None, None
        _assign(line, parent_line=parent_line, parent_point=parent_point)

    present = {str(data.source_id) for data in topo.lines}
    for stale in existing:
        if stale.source == SOURCE and stale.source_id not in present:
            session.delete(stale)
    session.flush()


def _normalize(data: LineData, width: int, height: int) -> list[tuple[float, float]] | None:
    result = []
    for point in data.points:
        x, y = point.x / width, point.y / height
        low, high = -EDGE_TOLERANCE, 1 + EDGE_TOLERANCE
        if not (low <= x <= high and low <= y <= high):
            return None
        result.append((min(max(x, 0.0), 1.0), min(max(y, 0.0), 1.0)))
    return result
