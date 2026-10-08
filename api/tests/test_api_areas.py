from tests import factories as f
from topo.db import refresh_area_geom


def seed(session):
    jura = f.area(session, "Jura Krakowsko-Częstochowska", kind="obszar")
    region = f.area(session, "Dolina Kobylańska", parent=jura)
    sektor = f.area(session, "Grupa Żabiego Konia", kind="sektor", parent=region)
    zabi = f.crag(session, sektor, "Żabi Koń", lng=19.756, lat=50.156)
    f.route(session, zabi, "A", grade="VI.2")
    lone = f.crag(session, region, "Samotna", lng=19.76, lat=50.16)
    f.route(session, lone, "B", grade="IV")
    f.route(session, lone, "C", grade="VI.5")
    empty = f.area(session, "Pusty", kind="sektor", parent=region)
    refresh_area_geom(session)
    return region, empty


def test_area_detail(client, session):
    region, _ = seed(session)
    body = client.get(f"/api/areas/{region.slug}").json()

    assert body["kind"] == "region"
    assert [p["name"] for p in body["path"]] == ["Jura Krakowsko-Częstochowska"]
    children = {c["name"]: c for c in body["children"]}
    assert (children["Grupa Żabiego Konia"]["crag_count"], children["Grupa Żabiego Konia"]["route_count"]) == (1, 1)
    assert (children["Pusty"]["crag_count"], children["Pusty"]["route_count"]) == (0, 0)
    [crag] = body["crags"]
    assert crag["name"] == "Samotna"
    assert crag["route_count"] == 2
    assert crag["grade_bands"] == [1, 0, 0, 1]
    assert len(body["center"]) == 2
    assert len(body["bbox"]) == 4


def test_empty_area_detail_has_no_geometry(client, session):
    _, empty = seed(session)
    body = client.get(f"/api/areas/{empty.slug}").json()

    assert body["center"] is None
    assert body["bbox"] is None
    assert body["crags"] == []
    assert [p["name"] for p in body["path"]] == ["Jura Krakowsko-Częstochowska", "Dolina Kobylańska"]


def test_area_not_found(client):
    response = client.get("/api/areas/nie-ma")
    assert response.status_code == 404
    assert response.json()["message"] == "Nie znaleziono: obszar"
