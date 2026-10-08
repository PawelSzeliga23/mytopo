import pytest
from sqlalchemy import delete, text
from sqlalchemy.exc import IntegrityError

from tests import factories as f
from topo.db import refresh_area_geom
from topo.grades import grade_sort
from topo.models import Area, Crag, LinePoint, RouteLine
from topo.slugs import unique_slug


def test_crag_roundtrip_with_walls_lines_points(session):
    region = f.area(session, "Dolina Kobylańska")
    crag = f.crag(session, region, "Żabi Koń", aspects=["W", "NW"], formations=["filar"])
    route = f.route(session, crag, "Lewy kant", grade="V+", number=1)
    wall = f.wall(session, crag)
    f.line(session, wall, route=route)
    session.expire_all()

    loaded = session.get(Crag, crag.id)
    assert loaded.aspects == ["W", "NW"]
    assert loaded.area.name == "Dolina Kobylańska"
    assert loaded.routes[0].grade_sort == grade_sort("V+")
    line = loaded.walls[0].lines[0]
    assert line.route.name == "Lewy kant"
    assert [p.kind for p in line.points] == ["start", "ring", "stanowisko"]
    assert loaded.walls[0].depth_status == "pending"
    assert loaded.walls[0].version == 1
    assert loaded.source == "manual"


def test_point_outside_unit_square_is_rejected(session):
    region = f.area(session, "R")
    line = f.line(session, f.wall(session, f.crag(session, region, "C")))
    session.add(LinePoint(line_id=line.id, sort_order=9, x=1.2, y=0.5, kind="ring"))
    with pytest.raises(IntegrityError):
        session.flush()


def test_point_kind_is_checked(session):
    region = f.area(session, "R")
    line = f.line(session, f.wall(session, f.crag(session, region, "C")))
    session.add(LinePoint(line_id=line.id, sort_order=9, x=0.2, y=0.5, kind="spit"))
    with pytest.raises(IntegrityError):
        session.flush()


def test_area_kind_is_checked(session):
    session.add(Area(name="X", slug="x", kind="dolina"))
    with pytest.raises(IntegrityError):
        session.flush()


def test_source_id_is_unique_per_source(session):
    f.area(session, "A", source="portalgorski", source_id="34", slug="a")
    with pytest.raises(IntegrityError):
        f.area(session, "B", source="portalgorski", source_id="34", slug="b")


def test_manual_records_may_share_empty_source_id(session):
    f.area(session, "A", slug="a")
    f.area(session, "B", slug="b")


def test_area_geom_aggregates_descendant_crags(session):
    jura = f.area(session, "Jura", kind="obszar")
    region = f.area(session, "Dolina Będkowska", parent=jura)
    sektor = f.area(session, "Sektor Zbędowych Skał", kind="sektor", parent=region)
    kolkowa = f.crag(session, sektor, "Kołkowa Skała", lng=19.70, lat=50.17)
    f.route(session, kolkowa, "A", grade="VI")
    f.route(session, kolkowa, "B", grade="VI.1")
    dupeczka = f.crag(session, region, "Dupeczka", lng=19.72, lat=50.18)  # bez sektora
    f.route(session, dupeczka, "C", grade="V")
    empty = f.area(session, "Pusty Sektor", kind="sektor", parent=region)
    refresh_area_geom(session)

    rows = {
        r.area_id: r
        for r in session.execute(
            text("SELECT area_id, crag_count, route_count, ST_GeometryType(hull) AS hull_type FROM area_geom")
        )
    }
    assert (rows[region.id].crag_count, rows[region.id].route_count) == (2, 3)
    assert (rows[jura.id].crag_count, rows[jura.id].route_count) == (2, 3)
    assert rows[sektor.id].crag_count == 1
    assert rows[sektor.id].hull_type == "ST_Polygon"
    assert rows[region.id].hull_type == "ST_Polygon"
    assert empty.id not in rows


def test_unique_slug_uses_context_then_number(session):
    region = f.area(session, "Dolina Będkowska")
    f.crag(session, region, "Kapliczka", slug="kapliczka")
    assert unique_slug(session, Crag, "Kapliczka", ["Dolina Kobylańska"]) == "kapliczka-dolina-kobylanska"

    f.crag(session, region, "Kapliczka (2)", slug="kapliczka-dolina-kobylanska")
    assert unique_slug(session, Crag, "Kapliczka", ["Dolina Kobylańska"]) == "kapliczka-2"
    assert unique_slug(session, Crag, "Żabi Koń") == "zabi-kon"


def test_area_cannot_be_its_own_parent(session):
    region = f.area(session, "R")
    with pytest.raises(IntegrityError):
        session.execute(text("UPDATE area SET parent_id = id WHERE id = :id"), {"id": region.id})


def test_area_geom_refresh_terminates_on_parent_cycle(session):
    a = f.area(session, "A")
    b = f.area(session, "B")
    f.crag(session, a, "Skała A", lng=19.70, lat=50.17)
    f.crag(session, b, "Skała B", lng=19.72, lat=50.18)
    session.execute(text("UPDATE area SET parent_id = :b WHERE id = :a"), {"a": a.id, "b": b.id})
    session.execute(text("UPDATE area SET parent_id = :a WHERE id = :b"), {"a": a.id, "b": b.id})
    # Turn a regression (endless recursion) into a failure instead of a hang
    session.execute(text("SET LOCAL statement_timeout = '10s'"))
    refresh_area_geom(session)

    counts = {r.area_id: r.crag_count for r in session.execute(text("SELECT area_id, crag_count FROM area_geom"))}
    assert counts == {a.id: 2, b.id: 2}


def test_variant_branch_point_must_belong_to_parent_line(session):
    wall = f.wall(session, f.crag(session, f.area(session, "R"), "C"))
    main = f.line(session, wall)
    other = f.line(session, wall, sort_order=1)
    session.add(
        RouteLine(
            wall=wall, parent_line_id=main.id, parent_point_id=other.points[1].id,
            points=[LinePoint(sort_order=0, x=0.5, y=0.5, kind="start")],
        )
    )
    with pytest.raises(IntegrityError):
        session.flush()


def test_variant_needs_both_parent_columns(session):
    wall = f.wall(session, f.crag(session, f.area(session, "R"), "C"))
    main = f.line(session, wall)
    session.add(RouteLine(wall=wall, parent_line_id=main.id))
    with pytest.raises(IntegrityError):
        session.flush()


def test_parent_line_and_variant_saved_in_one_flush(session):
    wall = f.wall(session, f.crag(session, f.area(session, "R"), "C"))
    main = RouteLine(
        wall=wall,
        points=[LinePoint(sort_order=i, x=0.5, y=y, kind=k) for i, (y, k) in enumerate([(0.9, "start"), (0.5, "ring")])],
    )
    variant = RouteLine(
        wall=wall, sort_order=1, parent_line=main, parent_point=main.points[1],
        points=[LinePoint(sort_order=0, x=0.6, y=0.3, kind="stanowisko")],
    )
    session.add_all([variant, main])
    session.flush()
    session.expire_all()

    loaded = session.get(RouteLine, variant.id)
    assert loaded.parent_line_id == main.id
    assert loaded.parent_point_id == main.points[1].id
    assert loaded.parent_line is main
    assert loaded.parent_point is main.points[1]
    assert [line.id for line in wall.lines] == [main.id, variant.id]


def test_deleting_branch_point_detaches_variant(session):
    wall = f.wall(session, f.crag(session, f.area(session, "R"), "C"))
    main = f.line(session, wall)
    variant = f.line(session, wall, sort_order=1, parent_line_id=main.id, parent_point_id=main.points[1].id)
    session.execute(delete(LinePoint).where(LinePoint.id == main.points[1].id))
    session.expire_all()

    loaded = session.get(RouteLine, variant.id)
    assert (loaded.parent_line_id, loaded.parent_point_id) == (None, None)


def test_deleting_parent_line_detaches_variant(session):
    wall = f.wall(session, f.crag(session, f.area(session, "R"), "C"))
    main = f.line(session, wall)
    variant = f.line(session, wall, sort_order=1, parent_line_id=main.id, parent_point_id=main.points[1].id)
    session.execute(delete(RouteLine).where(RouteLine.id == main.id))
    session.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))  # run the deferred FK check now, not at commit
    session.expire_all()

    loaded = session.get(RouteLine, variant.id)
    assert (loaded.parent_line_id, loaded.parent_point_id) == (None, None)
