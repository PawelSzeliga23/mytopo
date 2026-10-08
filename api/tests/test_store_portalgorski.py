import io
from pathlib import Path

import pytest
from PIL import Image
from sqlalchemy import func, select
from sqlalchemy_continuum import version_class

from topo.history import set_author
from topo.importer.portalgorski.parse import parse_paths, parse_rock_page
from topo.importer.portalgorski.store import IMPORT_AUTHOR, ImportReport, WallInput, store_rock
from topo.importer.portalgorski.types import LineData, PointData, RouteData, WallTopo
from topo.models import Area, Crag, LinePoint, Route, RouteLine, Wall

FIXTURES = Path(__file__).parent / "fixtures" / "portalgorski"
SIZES = {45: (1600, 1063), 46: (1063, 1600), 2531: (1600, 1143), 2533: (1008, 1600), 2534: (1600, 990), 2535: (996, 1600), 2536: (1600, 1082)}


def jpeg(size) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, (90, 90, 90)).save(buffer, "JPEG")
    return buffer.getvalue()


def load(name):
    return (FIXTURES / name).read_bytes()


def wall_inputs(page, paths=None, sizes=SIZES):
    paths = paths or {}
    return [
        WallInput(ref=ref, topo=paths.get(ref.source_id, WallTopo(lines=[], routes=[])), image=jpeg(sizes[ref.source_id]))
        for ref in page.walls
    ]


def import_zabi(session, tmp_path, report=None, paths46=None, sizes=SIZES):
    page = parse_rock_page(load("skala111.html"))
    report = report or ImportReport()
    set_author(session, IMPORT_AUTHOR)
    crag = store_rock(session, tmp_path, page, wall_inputs(page, {46: paths46 or parse_paths(load("paths46.json"))}, sizes), report)
    session.commit()
    return crag, report


def test_store_rock_creates_hierarchy_crag_walls(session, tmp_path):
    crag, report = import_zabi(session, tmp_path)

    assert [(a.kind, a.name, a.source_id) for a in _chain(crag.area)] == [
        ("obszar", "Jura Krakowsko Częstochowska", "obszar:34"),
        ("region", "Dolina Kobylańska", "region:100"),
        ("sektor", "Grupa Żabiego Konia", "sektor:102"),
    ]
    assert (crag.name, crag.slug, crag.source, crag.source_id) == ("Żabi Koń", "zabi-kon", "portalgorski", "111")
    assert (crag.child_friendly, crag.surroundings, crag.aspects) == (True, "Otwarta przestrzeń", ["W", "NW"])
    assert [w.source_id for w in crag.walls] == ["45", "46", "2531"]
    wall46 = crag.walls[1]
    assert (wall46.image_width, wall46.image_height, wall46.depth_status) == (1063, 1600, "pending")
    assert (tmp_path / wall46.image_path).exists()
    assert report.crags_created == 1 and report.errors == []


def test_store_rock_routes_lines_points(session, tmp_path):
    crag, report = import_zabi(session, tmp_path)
    routes = {r.source_id: r for r in crag.routes}
    assert len(routes) == 9
    kant = routes["287"]
    assert (kant.number, kant.name, kant.grade, kant.protection, kant.year, kant.length_m) == (
        1, "Lewy kant Żabiego Konia", "V+", "9r + ST", 1972, 25.0,
    )
    assert kant.grade_sort is not None

    wall46 = crag.walls[1]
    lines = {line.source_id: line for line in wall46.lines}
    assert len(lines) == 9
    first = lines["287"]
    assert first.route is kant
    assert first.sort_order == 10
    assert (first.points[0].x, first.points[0].y) == pytest.approx((312 / 1063, 711 / 1600))
    assert first.points[0].kind == "start"

    variant = lines["291"]
    assert variant.parent_line is lines["290"]
    assert variant.parent_point.source_id == "2022"
    assert report.lines == 9 and report.routes == 9


def test_reimport_keeps_manual_route_edit(session, tmp_path):
    crag, _ = import_zabi(session, tmp_path)
    route = next(r for r in crag.routes if r.source_id == "287")
    set_author(session, "Ola", "poprawka nazwy")
    route.name = "Lewy kant (poprawiony)"
    session.commit()

    _, report = import_zabi(session, tmp_path)
    session.refresh(route)
    assert route.name == "Lewy kant (poprawiony)"
    assert any("Lewy kant (poprawiony)" in item for item in report.skipped_manual)


def test_line_outside_image_is_skipped(session, tmp_path):
    sizes = {**SIZES, 46: (500, 500)}
    crag, report = import_zabi(session, tmp_path, sizes=sizes)
    assert crag.walls[1].lines == []
    assert len(report.bad_lines) == 9
    assert len(crag.routes) == 9  # drogi zostają, nawet gdy linie są pominięte


def test_unknown_grade_and_point_kind_are_reported(session, tmp_path):
    raw = load("paths2533.json").replace(b"VI.3+", b"6a+").replace(b"ogranicznik", b"kolec")
    page = parse_rock_page(load("skala955.html"))
    report = ImportReport()
    set_author(session, IMPORT_AUTHOR)
    crag = store_rock(session, tmp_path, page, wall_inputs(page, {2533: parse_paths(raw)}), report)
    session.commit()

    [route] = crag.routes
    assert (route.grade, route.grade_sort) == ("6a+", None)
    assert report.unknown_grades == ["Szczyrzyc / Droga krzyżowa: 6a+"]
    kinds = [p.kind for p in crag.walls[0].lines[0].points]
    assert kinds[3] == "przelot"
    assert len(report.unknown_point_kinds) == 1


def test_rock_directly_under_area(session, tmp_path):
    page = parse_rock_page(load("skala955.html"))
    set_author(session, IMPORT_AUTHOR)
    crag = store_rock(session, tmp_path, page, wall_inputs(page), ImportReport())
    session.commit()
    assert (crag.area.kind, crag.area.name) == ("obszar", "Beskidy")
    assert session.scalar(select(func.count()).select_from(Area)) == 1


def _chain(area):
    chain = []
    while area is not None:
        chain.append(area)
        area = area.parent
    return list(reversed(chain))


def _reimport_after_manual(session, tmp_path, action):
    crag, _ = import_zabi(session, tmp_path)
    set_author(session, "Ola", "usunięcie")
    action(crag)
    session.commit()
    return import_zabi(session, tmp_path)


def test_manually_deleted_route_is_not_recreated(session, tmp_path):
    def action(crag):
        session.delete(next(r for r in crag.routes if r.source_id == "287"))

    crag, report = _reimport_after_manual(session, tmp_path, action)
    assert session.scalar(select(Route).where(Route.source_id == "287")) is None
    assert any("usunięte ręcznie: droga" in item for item in report.skipped_manual)


def test_manually_deleted_line_freezes_wall_topo(session, tmp_path):
    def action(crag):
        session.delete(next(line for line in crag.walls[1].lines if line.source_id == "290"))

    crag, report = _reimport_after_manual(session, tmp_path, action)
    wall46 = crag.walls[1]
    assert session.scalar(select(RouteLine).where(RouteLine.source_id == "290")) is None
    assert len(wall46.lines) == 8
    assert any("topo ściany" in item for item in report.skipped_manual)


def test_manually_deleted_point_is_not_recreated(session, tmp_path):
    def action(crag):
        line = next(line for line in crag.walls[1].lines if line.source_id == "287")
        assert len(line.points) == 11
        session.delete(line.points[-1])

    crag, _ = _reimport_after_manual(session, tmp_path, action)
    line = next(line for line in crag.walls[1].lines if line.source_id == "287")
    session.refresh(line)
    assert len(line.points) == 10


def test_page_without_coordinates_creates_nothing(session, tmp_path):
    from dataclasses import replace

    page = replace(parse_rock_page(load("skala111.html")), lat=None)
    set_author(session, IMPORT_AUTHOR)
    with pytest.raises(ValueError):
        store_rock(session, tmp_path, page, [], ImportReport())
    assert session.scalar(select(func.count()).select_from(Area)) == 0


def test_unknown_topo_keeps_existing_lines(session, tmp_path):
    crag, _ = import_zabi(session, tmp_path)
    before = sorted((line.id, line.source_id) for line in crag.walls[1].lines)
    assert len(before) == 9

    page = parse_rock_page(load("skala111.html"))
    walls = [
        WallInput(ref=ref, topo=None if ref.source_id == 46 else WallTopo(lines=[], routes=[]), image=jpeg(SIZES[ref.source_id]))
        for ref in page.walls
    ]
    report = ImportReport()
    set_author(session, IMPORT_AUTHOR)
    store_rock(session, tmp_path, page, walls, report)
    session.commit()

    session.expire_all()
    wall46 = session.scalar(select(Wall).where(Wall.source_id == "46"))
    assert sorted((line.id, line.source_id) for line in wall46.lines) == before
    assert len(crag.routes) == 9
    assert report.errors == []


def _wall45_with_kant() -> WallTopo:
    return WallTopo(
        lines=[
            LineData(
                source_id=90287, order=3, branch_order=0, color="#e11d48", parent_source_id=None, parent_point_source_id=None,
                points=[
                    PointData(source_id=990001, x=400, y=1000, kind="start", visible=False, raw_kind="ring"),
                    PointData(source_id=990002, x=420, y=100, kind="stanowisko", visible=True, raw_kind="stanowisko"),
                ],
            )
        ],
        routes=[
            RouteData(
                source_id=90287, name="Lewy kant Żabiego Konia", protection="9r + ST", grade="V+",
                first_ascent=None, year=1972, length_m=25.0,
            )
        ],
    )


def _import_two_walls(session, tmp_path):
    page = parse_rock_page(load("skala111.html"))
    report = ImportReport()
    set_author(session, IMPORT_AUTHOR)
    paths = {45: _wall45_with_kant(), 46: parse_paths(load("paths46.json"))}
    crag = store_rock(session, tmp_path, page, wall_inputs(page, paths), report)
    session.commit()
    return crag, report


def test_same_route_on_two_walls_is_one_route(session, tmp_path):
    crag, report = _import_two_walls(session, tmp_path)

    kants = session.scalars(select(Route).where(Route.crag_id == crag.id, Route.name == "Lewy kant Żabiego Konia")).all()
    assert len(kants) == 1
    [kant] = kants
    assert (kant.source_id, kant.number) == ("90287", 3)  # pierwsza ściana (45) zakłada drogę
    kant_lines = session.scalars(select(RouteLine).where(RouteLine.route_id == kant.id)).all()
    assert sorted(line.wall.source_id for line in kant_lines) == ["45", "46"]
    assert report.merged_routes == 1
    assert len(crag.routes) == 9
    assert session.scalar(select(Route).where(Route.source_id == "287")) is None

    versions = {
        model: session.scalar(select(func.count()).select_from(version_class(model)))
        for model in (Route, RouteLine, LinePoint)
    }
    _, again = _import_two_walls(session, tmp_path)
    assert again.merged_routes == 1
    assert {
        model: session.scalar(select(func.count()).select_from(version_class(model)))
        for model in (Route, RouteLine, LinePoint)
    } == versions


def test_reimport_counts_areas_and_reports_manual_area(session, tmp_path):
    crag, report = import_zabi(session, tmp_path)
    assert report.areas_created == 3

    set_author(session, "Ola", "poprawka obszaru")
    crag.area.name = "Grupa Żabiego Konia (poprawiona)"
    session.commit()

    _, again = import_zabi(session, tmp_path)
    assert again.areas_created == 0
    assert "obszar Grupa Żabiego Konia (poprawiona)" in again.skipped_manual
