import pytest

from tests import factories as f
from topo.db import refresh_area_geom
from topo.queries import route_kinds

TRAD_POINTS = ((0.5, 0.9, "start"), (0.5, 0.5, "przelot"), (0.5, 0.1, "stanowisko"))


@pytest.mark.parametrize(
    ("protection", "expected"),
    [("4r + ST", "sport"), ("10r", "sport"), ("3s + RZ", "sport"), ("1h", "sport"), ("3s + 1p + ST", "sport"),
     ("ST", "trad"), ("2ST", "trad"), ("DRZ", "trad"), ("1p", "trad"), (None, "trad")],
)  # fmt: skip
def test_kind_from_protection_text(session, protection, expected):
    crag = f.crag(session, f.area(session, "Dolina"), "Skała")
    route = f.route(session, crag, "Droga", protection=protection)

    assert route_kinds(session, [route.id]) == {route.id: expected}


@pytest.mark.parametrize(("point", "expected"), [("ring", "sport"), ("hak", "sport"), ("ucho", "sport"), ("przelot", "trad")])
def test_kind_from_points_on_topo(session, point, expected):
    crag = f.crag(session, f.area(session, "Dolina"), "Skała")
    route = f.route(session, crag, "Droga", protection="ST")
    f.line(session, f.wall(session, crag), route, points=((0.5, 0.9, "start"), (0.5, 0.5, point)))

    assert route_kinds(session, [route.id]) == {route.id: expected}


def seed(session):
    """A region with a sector: Żabi Koń (sector) 1 sport V+, 1 trad VI.5; Samotna (region) 1 trad IV."""
    jura = f.area(session, "Jura", kind="obszar")
    region = f.area(session, "Dolina Kobylańska", parent=jura)
    sektor = f.area(session, "Grupa Żabiego Konia", kind="sektor", parent=region)
    zabi = f.crag(session, sektor, "Żabi Koń")
    f.route(session, zabi, "Sport", grade="V+", protection="4r + ST")
    trad = f.route(session, zabi, "Trad", grade="VI.5")
    f.line(session, f.wall(session, zabi), trad, points=TRAD_POINTS)
    lone = f.crag(session, region, "Samotna")
    f.route(session, lone, "Rysa", grade="IV", protection="ST")
    refresh_area_geom(session)
    return region


def test_map_statistics_per_kind(client, session):
    seed(session)
    crags = {c["properties"]["name"]: c["properties"] for c in client.get("/api/map/crags").json()["features"]}
    zabi = crags["Żabi Koń"]
    assert (zabi["route_count"], zabi["by_kind"]["sport"]["route_count"], zabi["by_kind"]["trad"]["route_count"]) == (2, 1, 1)
    assert (zabi["by_kind"]["sport"]["grade_min"], zabi["by_kind"]["sport"]["grade_max"]) == ("V+", "V+")
    assert zabi["by_kind"]["trad"]["grade_bands"] == [0, 0, 0, 1]
    assert crags["Samotna"]["by_kind"]["sport"] == {
        "route_count": 0, "grade_bands": [0, 0, 0, 0], "grade_min": None, "grade_min_sort": None, "grade_max": None, "grade_max_sort": None,
    }  # fmt: skip

    [region] = client.get("/api/map/areas", params={"kind": "region"}).json()["features"]
    props = region["properties"]
    assert (props["crag_count"], props["route_count"]) == (2, 3)
    assert props["by_kind"]["sport"] == {"crag_count": 1, "route_count": 1, "grade_bands": [1, 0, 0, 0]}
    assert props["by_kind"]["trad"] == {"crag_count": 2, "route_count": 2, "grade_bands": [1, 0, 0, 1]}


def test_area_page_statistics_per_kind(client, session):
    region = seed(session)
    body = client.get(f"/api/areas/{region.slug}").json()

    [sector] = body["children"]
    assert (sector["route_count"], sector["by_kind"]["sport"]["route_count"], sector["by_kind"]["trad"]["crag_count"]) == (2, 1, 1)
    crags = {c["name"]: c for c in body["crags"]}
    assert crags["Samotna"]["by_kind"]["trad"]["route_count"] == 1
    assert crags["Samotna"]["by_kind"]["sport"]["route_count"] == 0


def test_crag_routes_carry_their_kind(client, session):
    seed(session)
    body = client.get("/api/crags/zabi-kon").json()

    assert {r["name"]: r["kind"] for r in body["routes"]} == {"Sport": "sport", "Trad": "trad"}


def test_search_by_kind(client, session):
    region = seed(session)
    session.commit()

    def search(kind, **params):
        return client.get("/api/search", params={"kind": kind, **params}).json()

    assert [r["name"] for r in search("sport", area=region.slug)["routes"]] == ["Sport"]
    assert sorted(r["name"] for r in search("trad", area=region.slug)["routes"]) == ["Rysa", "Trad"]
    assert [(c["name"], c["route_count"]) for c in search("sport", q="zabi")["crags"]] == [("Żabi Koń", 1)]
    assert [c["name"] for c in search("sport", q="samotna")["crags"]] == []
    assert [c["name"] for c in search("trad", q="samotna")["crags"]] == ["Samotna"]
    assert [a["name"] for a in search("sport", q="grupa")["areas"]] == ["Grupa Żabiego Konia"]
    assert [a["name"] for a in search("sport", q="jura")["areas"]] == ["Jura"]
    assert client.get("/api/search", params={"q": "a", "kind": "boulder"}).status_code == 422
