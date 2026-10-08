import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from tests import factories as f
from topo.db import refresh_area_geom
from topo.grades import grade_sort
from topo.models import Area, Crag, LinePoint
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
