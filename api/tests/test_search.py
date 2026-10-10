import pytest

from tests import factories as f


@pytest.fixture
def data(session):
    jura = f.area(session, "Jura", kind="obszar")
    kobylanska = f.area(session, "Dolina Kobylańska", parent=jura)
    bedkowska = f.area(session, "Dolina Będkowska", parent=jura)
    zabie = f.area(session, "Grupa Żabiego Konia", kind="sektor", parent=kobylanska)
    zabi = f.crag(session, zabie, "Żabi Koń")
    ponad = f.crag(session, kobylanska, "Ponad Gnój Turnia")
    sokolica = f.crag(session, bedkowska, "Sokolica")
    f.wall(session, zabi, "Żabia Ściana Wschodnia")
    f.wall(session, ponad, None)
    f.route(session, zabi, "Rysa Żabia", "VI.1", length_m=20)
    f.route(session, zabi, "Filar", "VI.3")
    f.route(session, ponad, "Prawa rysa", "VI.2+")
    f.route(session, ponad, "Lewa rysa", "V")
    f.route(session, sokolica, "Rysa Sokola", "VI")
    f.route(session, sokolica, "100% rysa_x", "IV")
    session.commit()
    return {"jura": jura, "kobylanska": kobylanska, "zabie": zabie, "zabi": zabi}


def search(client, **params):
    response = client.get("/api/search", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def names(items):
    return [item["name"] for item in items]


def test_diacritics_and_case_insensitive(client, data):
    body = search(client, q="zabi")
    assert names(body["crags"]) == ["Żabi Koń"]
    assert names(body["areas"]) == ["Grupa Żabiego Konia"]
    assert names(body["walls"]) == ["Żabia Ściana Wschodnia"]
    assert names(body["routes"]) == ["Rysa Żabia"]
    assert body["areas"][0] | {"id": 0} == {"id": 0, "name": "Grupa Żabiego Konia", "slug": "grupa-zabiego-konia", "kind": "sektor", "parent_name": "Dolina Kobylańska"}
    assert body["crags"][0]["area_name"] == "Grupa Żabiego Konia" and body["crags"][0]["route_count"] == 2
    assert body["walls"][0]["crag_slug"] == "zabi-kon"
    route = body["routes"][0]
    assert (route["grade"], route["crag_name"], route["crag_slug"], route["length_m"]) == ("VI.1", "Żabi Koń", "zabi-kon", 20)


def test_wall_named_like_its_crag_is_not_suggested(client, session, data):
    f.wall(session, data["zabi"], "żabi kon")
    session.commit()
    assert names(search(client, q="zabi")["walls"]) == ["Żabia Ściana Wschodnia"]


def test_prefix_matches_first(client, data):
    assert names(search(client, q="rysa")["routes"]) == ["Rysa Sokola", "Rysa Żabia", "100% rysa_x", "Lewa rysa", "Prawa rysa"]


def test_wildcards_are_literal(client, data):
    assert names(search(client, q="0% rysa_")["routes"]) == ["100% rysa_x"]
    assert search(client, q="__")["routes"] == []


def test_type_filter(client, data):
    body = search(client, q="rysa", type="crags")
    assert body["routes"] == [] and body["totals"]["routes"] == 0
    body = search(client, q="zabi", type="routes")
    assert (body["areas"], body["crags"], body["walls"]) == ([], [], [])
    assert names(body["routes"]) == ["Rysa Żabia"]


def test_grade_and_area_filters(client, data):
    body = search(client, q="rysa", grade_min="VI", grade_max="VI.2+", area="dolina-kobylanska")
    assert names(body["routes"]) == ["Rysa Żabia", "Prawa rysa"]  # Sokola is in another valley, Lewa is V


def test_filters_without_text_list_routes(client, data):
    body = search(client, grade_min="VI.1", area="jura")
    assert names(body["routes"]) == ["Filar", "Prawa rysa", "Rysa Żabia"]
    assert (body["areas"], body["crags"], body["walls"]) == ([], [], [])


def test_short_query_gives_nothing(client, data):
    assert search(client, q="r") == {"areas": [], "crags": [], "walls": [], "routes": [], "totals": {"areas": 0, "crags": 0, "walls": 0, "routes": 0}}


def test_route_pages(client, session, data):
    for n in range(25):
        f.route(session, data["zabi"], f"Droga {n:02d}", "V")
    session.commit()
    first = search(client, q="droga")
    assert len(first["routes"]) == 20 and first["totals"]["routes"] == 25
    second = search(client, q="droga", offset=20)
    assert names(second["routes"]) == [f"Droga {n:02d}" for n in range(20, 25)]


def test_bad_parameters(client, data):
    assert client.get("/api/search", params={"q": "rysa", "grade_min": "XX"}).status_code == 422
    assert client.get("/api/search", params={"q": "rysa", "area": "nie-ma"}).status_code == 404
    assert client.get("/api/search", params={"q": "rysa", "type": "inne"}).status_code == 422
