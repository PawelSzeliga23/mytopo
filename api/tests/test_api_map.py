import pytest

from tests import factories as f
from topo.db import refresh_area_geom


def seed(session):
    jura = f.area(session, "Jura Krakowsko-Częstochowska", kind="obszar")
    region = f.area(session, "Dolina Kobylańska", parent=jura)
    sektor = f.area(session, "Grupa Żabiego Konia", kind="sektor", parent=region)
    zabi = f.crag(session, sektor, "Żabi Koń", lng=19.756, lat=50.156)
    for name, grade in [("A", "V+"), ("B", "VI.1"), ("C", "VI.5"), ("D", None)]:
        f.route(session, zabi, name, grade=grade)
    lone = f.crag(session, region, "Samotna", lng=19.76, lat=50.16)
    f.route(session, lone, "E", grade="IV")
    f.area(session, "Pusty", kind="sektor", parent=region)
    refresh_area_geom(session)


def test_map_regions_as_center_points(client, session):
    seed(session)
    data = client.get("/api/map/areas", params={"kind": "region"}).json()

    assert data["type"] == "FeatureCollection"
    [feature] = data["features"]
    assert feature["geometry"]["type"] == "Point"
    props = feature["properties"]
    assert props["name"] == "Dolina Kobylańska"
    assert (props["crag_count"], props["route_count"]) == (2, 5)
    minx, miny, maxx, maxy = props["bbox"]
    assert minx < 19.756 < maxx and miny < 50.156 < maxy
    assert props["center"] == pytest.approx(feature["geometry"]["coordinates"])


def test_map_sectors_as_hulls_skip_empty(client, session):
    seed(session)
    data = client.get("/api/map/areas", params={"kind": "sektor", "geometry": "hull"}).json()

    assert [feat["properties"]["name"] for feat in data["features"]] == ["Grupa Żabiego Konia"]
    assert data["features"][0]["geometry"]["type"] == "Polygon"


def test_map_crags_with_grade_bands(client, session):
    seed(session)
    data = client.get("/api/map/crags").json()
    by_name = {feat["properties"]["name"]: feat for feat in data["features"]}

    zabi = by_name["Żabi Koń"]
    assert zabi["geometry"]["coordinates"] == pytest.approx([19.756, 50.156])
    assert zabi["properties"]["route_count"] == 4
    assert zabi["properties"]["grade_bands"] == [1, 1, 0, 1]
    assert zabi["properties"]["in_sector"] is True
    assert by_name["Samotna"]["properties"]["in_sector"] is False
    assert zabi["properties"]["area_kind"] == "sektor"
    assert by_name["Samotna"]["properties"]["area_kind"] == "region"


def test_map_areas_rejects_unknown_kind(client):
    response = client.get("/api/map/areas", params={"kind": "dolina"})
    assert response.status_code == 422
    body = response.json()
    assert body["code"] == "validation_error"
    assert body["message"] == "Nieprawidłowe dane w zapytaniu"


def test_unknown_api_path_uses_error_format(client):
    response = client.get("/api/nie-ma-takiej-strony")
    assert response.status_code == 404
    assert response.json()["code"] == "not_found"
